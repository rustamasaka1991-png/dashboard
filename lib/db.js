'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');
const BACKUP = path.join(DATA_DIR, 'db.backup.json');

const DEFAULT_SETTINGS = {
  companyName: 'Uz-Grow',
  companyTagline: 'GREENHOUSE SOLUTIONS',
  title: "SOTUV BO'LIMI",
  subtitle: 'KUNLIK VA OYLIK KPI VA NATIJALAR',
  currency: '$',
  // Kunlik plan (har bir xodim uchun)
  plans: { calls: 70, talkMin: 175, script: 70, conversion: 2, sales: 1250 },
  workDaysPerMonth: 24,
  workDaysPerWeek: 6,
  // Dam olish kunlari (0 = yakshanba). "Oraliq" filtrida ish kunlarini hisoblash uchun.
  daysOff: [0],
  dailyBonus: "100.000 so'm",
  dailyBonusText: "Kunlik rejani to'liq bajargan 1-2-3 o'rin xodimlarga",
  monthlyBonusText: "Oyda eng ko'p sotuv qilgan xodimga (1-o'rin)",
  // Reyting balli uchun KPI og'irliklari va bitta KPI uchun maksimal foiz
  weights: { calls: 20, talkMin: 20, script: 20, conversion: 20, sales: 20 },
  scoreCap: 150,
  // Shuncha sekunddan uzun suhbat "real aloqa" hisoblanadi
  minTalkSec: 30,
  // Qo'ng'iroqlar yo'nalishi: all | outbound | inbound
  callDirection: 'all',
  // Konversiya: manual (qo'lda) yoki auto (sotuvlar soni / real aloqa)
  conversionSource: 'manual',
  syncMinutes: 5,
  pbx: { domain: '', apiKey: '', baseUrl: 'https://api2.onlinepbx.ru' },
  amo: { subdomain: '', token: '', baseDomain: 'amocrm.ru', pipelineId: '', wonStatusId: 142 },
};

const SEED_EMPLOYEES = [
  { name: 'Asadbek', role: 'Sotuv menejer' },
  { name: 'Molohat', role: 'Sotuv menejer' },
  { name: 'Yangi xodim', role: 'Sotuv menejer' },
];


// ---------- Ombor turi ----------
// Kompyuterda: data/db.json fayli. Vercel (serverless) da fayl tizimi doimiy emas, shuning uchun
// ma'lumot tashqi omborda saqlanadi — Supabase (Postgres jadvali) yoki Upstash Redis. Ikkalasi ham REST
// orqali, kutubxonasiz. Qaysi biri ishlatilishi muhit o'zgaruvchilaridan aniqlanadi.
const SUPA_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
// Faqat server kaliti (secret / service_role): jadvalda tokenlar turadi, shuning uchun u RLS bilan yopiq bo'lishi
// va ochiq (publishable / anon) kalit bilan o'qilmasligi kerak.
const SUPA_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPA_TABLE = process.env.SUPABASE_TABLE || 'dashboard_kv';
const KV_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const BACKEND = SUPA_URL && SUPA_KEY ? 'supabase' : KV_URL && KV_TOKEN ? 'redis' : '';
const REMOTE = Boolean(BACKEND);
const SERVERLESS = Boolean(process.env.VERCEL);
const KV_PREFIX = process.env.KV_PREFIX || 'uzgrow';

// Holat uch bo'lakda saqlanadi — bir vaqtda ishlayotgan so'rovlar bir-birining yozganini bosib ketmasligi uchun
// (sinxronizatsiya faqat "auto"ni, natija kiritish faqat "entries"ni, sozlamalar faqat "core"ni yozadi).
const PARTS = {
  core: ['settings', 'employees', 'auth', 'imported'],
  entries: ['entries'],
  auto: ['auto', 'syncLog'],
};

let state = null;
let saveTimer = null;
let holds = 0;
const dirty = new Set();
// Holat versiyasi (oxirgi yozilgan vaqt, ms). Brauzer o'zi ko'rgan eng yangi versiyani yuboradi —
// shunda xotiradagi nusxa undan eski bo'lsa ombordan qayta o'qiladi, yangi bo'lsa qayta o'qish shart emas.
let rev = 0;
let loadedAt = 0;
const timing = { read: 0, write: 0 };

function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Xom (fayl / Redis / zaxira nusxadan o'qilgan) ma'lumotdan to'liq holat yasash
function build(raw) {
  return {
    settings: deepMerge(DEFAULT_SETTINGS, raw?.settings),
    employees: Array.isArray(raw?.employees) ? raw.employees : SEED_EMPLOYEES.map((e, i) => ({
      id: newId(), name: e.name, role: e.role, photo: '', extensions: [], amoUserId: '', active: true, order: i, createdAt: new Date().toISOString(),
    })),
    entries: raw?.entries ?? {}, // qo'lda kiritilgan: entries[date][empId] = {script, conversion, sales, deals, calls, talkMin}
    auto: raw?.auto ?? {}, // integratsiyadan: auto[date][empId] = {calls, attempts, talkSec, deals, sales}
    syncLog: raw?.syncLog ?? {},
    imported: raw?.imported ?? { amo: [], pbx: [] }, // bir marta yuklangan amoCRM ID / ichki raqamlar (lib/roster.js)
    auth: raw?.auth ?? null, // Sozlamalarda o'zgartirilgan admin parol: { salt, hash }
  };
}

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let raw = null;
  if (fs.existsSync(FILE)) {
    try {
      raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (err) {
      throw Object.assign(
        new Error(`Ma'lumotlar fayli buzilgan: ${FILE} (${err.message}). Uni "${path.basename(BACKUP)}" zaxira nusxasi bilan almashtiring yoki o'chirib tashlang.`),
        { code: 'DB_CORRUPT' },
      );
    }
  }
  state = build(raw);
  if (!raw) saveNow();
  return state;
}

function get() {
  if (!state) {
    if (REMOTE || SERVERLESS) throw new Error("Ma'lumotlar hali yuklanmagan (db.refresh chaqirilmagan)");
    load();
  }
  return state;
}

// ---------- Redis (Upstash REST) ----------
const pack = (obj) => 'gz:' + zlib.gzipSync(JSON.stringify(obj)).toString('base64');
function unpack(value) {
  if (value === null || value === undefined) return null;
  return JSON.parse(String(value).startsWith('gz:') ? zlib.gunzipSync(Buffer.from(String(value).slice(3), 'base64')).toString('utf8') : value);
}

async function kv(command, pipeline = false) {
  let res, text;
  try {
    res = await fetch(pipeline ? KV_URL + '/pipeline' : KV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(15000),
    });
    text = await res.text();
  } catch (err) {
    throw Object.assign(new Error(`Ma'lumotlar omboriga (Redis) ulanib bo'lmadi: ${err.cause?.code || err.name || err.message}`), { status: 503 });
  }
  let json = null;
  try { json = JSON.parse(text); } catch { /* pastda xato beriladi */ }
  const failed = !res.ok || !json || json.error || (Array.isArray(json) && json.find((x) => x.error));
  if (failed) {
    const reason = json?.error || (Array.isArray(json) && json.find((x) => x.error)?.error) || text.slice(0, 200);
    throw Object.assign(new Error(`Ma'lumotlar ombori (Redis) xatosi (HTTP ${res.status}): ${reason}`), { status: 503 });
  }
  return pipeline ? json.map((x) => x.result) : json.result;
}

const redisStore = {
  read: (keys) => kv(['MGET', ...keys]),
  write: (pairs) => kv(pairs.map(([k, v]) => ['SET', k, v]), true),
  lock: async (k, ttlSec) => (await kv(['SET', k, '1', 'NX', 'EX', String(ttlSec)])) === 'OK',
  unlock: (k) => kv(['DEL', k]),
};

// ---------- Supabase (PostgREST) ----------
// Jadval (Supabase -> SQL Editor'da bir marta yaratiladi, README'ga qarang):
//   create table public.dashboard_kv (key text primary key, value text not null, updated_at timestamptz not null default now());
//   alter table public.dashboard_kv enable row level security;
async function supa(method, query, body, prefer) {
  let res, text;
  try {
    res = await fetch(`${SUPA_URL}/rest/v1/${SUPA_TABLE}${query}`, {
      method,
      headers: {
        apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    text = await res.text();
  } catch (err) {
    throw Object.assign(new Error(`Ma'lumotlar omboriga (Supabase) ulanib bo'lmadi: ${err.cause?.code || err.name || err.message}`), { status: 503 });
  }
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* matn holicha qoladi */ }
  if (res.ok) return json;
  if (res.status === 409) return { conflict: true };
  const code = json?.code || '';
  let reason = json?.message || text.slice(0, 200);
  if (res.status === 404 || code === 'PGRST205' || code === '42P01') {
    reason = `"${SUPA_TABLE}" jadvali topilmadi — Supabase'dagi SQL Editor'da README'dagi buyruqni ishga tushiring`;
  } else if (res.status === 401 || res.status === 403 || code === '42501') {
    reason = "ruxsat yo'q — SUPABASE_SECRET_KEY ga ochiq (publishable/anon) kalit emas, secret (service_role) kalit qo'yilishi kerak";
  }
  throw Object.assign(new Error(`Ma'lumotlar ombori (Supabase) xatosi (HTTP ${res.status}): ${reason}`), { status: 503 });
}

const quoted = (keys) => keys.map((k) => `"${k}"`).join(',');
const supabaseStore = {
  async read(keys) {
    const rows = (await supa('GET', `?select=key,value&key=in.(${encodeURIComponent(quoted(keys))})`)) || [];
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return keys.map((k) => map.get(k) ?? null);
  },
  async write(pairs) {
    const now = new Date().toISOString();
    await supa('POST', '?on_conflict=key', pairs.map(([k, v]) => ({ key: k, value: v, updated_at: now })), 'resolution=merge-duplicates,return=minimal');
  },
  // Qulf — alohida qator: muddati o'tgani o'chiriladi, keyin qo'shishga urinamiz (bor bo'lsa 409 qaytadi)
  async lock(k, ttlSec) {
    const expired = new Date(Date.now() - ttlSec * 1000).toISOString();
    await supa('DELETE', `?key=eq.${encodeURIComponent(k)}&updated_at=lt.${encodeURIComponent(expired)}`, undefined, 'return=minimal');
    const r = await supa('POST', '', [{ key: k, value: '1', updated_at: new Date().toISOString() }], 'return=minimal');
    return !r?.conflict;
  },
  unlock: (k) => supa('DELETE', `?key=eq.${encodeURIComponent(k)}`, undefined, 'return=minimal'),
};

const store = BACKEND === 'supabase' ? supabaseStore : redisStore;

const key = (part) => `${KV_PREFIX}:${part}`;

// Har bir so'rov boshida chaqiriladi. Fayl rejimida holat xotirada turadi; Redis rejimida qayta o'qiladi
// (boshqa serverless nusxa yozgan bo'lishi mumkin). Uzoq amal (sinxronizatsiya) ketayotganda o'qilmaydi.
// minRev   — so'rovchi ko'rgan eng yangi versiya (undan eski nusxa bilan javob berilmaydi)
// maxAgeMs — xotiradagi nusxa shuncha yangi bo'lsa ombor qayta o'qilmaydi (tezlik uchun)
async function refresh({ minRev = 0, maxAgeMs = 0 } = {}) {
  timing.read = timing.write = 0;
  if (!REMOTE) {
    if (SERVERLESS) {
      throw Object.assign(
        new Error("Ma'lumotlar ombori ulanmagan. Vercel'da: Settings -> Environment Variables ga SUPABASE_URL va SUPABASE_SECRET_KEY qo'shing, keyin Redeploy qiling."),
        { status: 503 },
      );
    }
    if (!state) load();
    return state;
  }
  if (state && holds > 0) return state;
  if (state && dirty.size) await flush(); // oldingi so'rovda yozilmay qolgani bo'lsa — avval o'shani yozamiz
  if (state && rev >= minRev && Date.now() - loadedAt < maxAgeMs) return state;
  const t0 = Date.now();
  const values = await store.read(Object.keys(PARTS).map(key));
  timing.read = Date.now() - t0;
  const raw = {};
  let seen = 0;
  for (const v of values) {
    const part = unpack(v) || {};
    seen = Math.max(seen, Number(part._rev) || 0);
    delete part._rev;
    Object.assign(raw, part);
  }
  const empty = values.every((v) => v === null || v === undefined);
  state = build(empty ? null : raw);
  rev = Math.max(seen, 1); // versiyasiz (eski) yozuvlar ham "1" deb olinadi — kesh ishlashi uchun
  loadedAt = Date.now();
  if (empty) {
    // ombor bo'sh — boshlang'ich ma'lumotni yozamiz; yozib bo'lmasa (masalan, ruxsat yo'q) xato qaytadi
    Object.keys(PARTS).forEach((p) => dirty.add(p));
    try {
      await flush();
    } catch (err) {
      reset();
      throw err;
    }
  }
  return state;
}

// So'rov xato bilan tugaganda: xotiradagi (yarim o'zgargan bo'lishi mumkin) holatni tashlab yuboramiz —
// keyingi so'rov ombordan qayta o'qiydi. Fayl rejimida va uzoq amal ketayotganda hech narsa qilinmaydi.
function reset() {
  if (!REMOTE || holds > 0) return;
  state = null;
  loadedAt = 0;
  dirty.clear();
}

// Uzoq amal davomida holatni qayta o'qishni to'xtatib turish (shu nusxadagi boshqa so'rovlar uchun)
function hold() { holds++; }
function release() { holds = Math.max(0, holds - 1); }

// Redis rejimida: o'zgargan bo'laklarni yozish. So'rov oxirida va uzoq amallar oxirida chaqiriladi.
async function flush() {
  if (!REMOTE || !dirty.size || !state) return;
  const parts = [...dirty];
  dirty.clear();
  const next = Math.max(rev + 1, Date.now());
  const t0 = Date.now();
  try {
    await store.write(parts.map((p) => [key(p), pack({ ...Object.fromEntries(PARTS[p].map((k) => [k, state[k]])), _rev: next })]));
  } catch (err) {
    parts.forEach((p) => dirty.add(p));
    throw err;
  }
  timing.write += Date.now() - t0;
  rev = next;
  loadedAt = Date.now();
}

// Bir vaqtda faqat bitta sinxronizatsiya ishlashi uchun qulf (serverless nusxalar orasida)
async function lock(name, ttlSec) {
  if (!REMOTE) return true;
  return store.lock(key('lock:' + name), ttlSec);
}
async function unlock(name) {
  if (REMOTE) await store.unlock(key('lock:' + name)).catch(() => {});
}

// Har kuni birinchi saqlashdan oldin oldingi holat zaxiraga ko'chiriladi
let backupDay = '';
function backupOncePerDay() {
  const day = new Date().toISOString().slice(0, 10);
  if (backupDay === day) return;
  backupDay = day;
  try {
    if (fs.existsSync(FILE)) fs.copyFileSync(FILE, BACKUP);
  } catch { /* zaxira ixtiyoriy */ }
}

// part: 'core' | 'entries' | 'auto' — nima o'zgargani (berilmasa hammasi). Fayl rejimida butun fayl yoziladi.
function saveNow(part) {
  if (REMOTE || SERVERLESS) {
    (part ? [part] : Object.keys(PARTS)).forEach((p) => dirty.add(p));
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = null;
  rev = Math.max(rev + 1, Date.now());
  backupOncePerDay();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, FILE);
}

function save(part) {
  if (REMOTE || SERVERLESS) return saveNow(part);
  if (saveTimer) return;
  saveTimer = setTimeout(saveNow, 300);
}

// Zaxira nusxadan tiklash: butun holat almashtiriladi
function replace(raw) {
  state = build(raw);
  saveNow();
  return state;
}

module.exports = {
  load, get, save, saveNow, refresh, flush, reset, hold, release, lock, unlock, replace, newId, deepMerge,
  getRev: () => rev, timing,
  DEFAULT_SETTINGS, FILE, REMOTE, SERVERLESS,
};
