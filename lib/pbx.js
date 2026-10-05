'use strict';

// OnlinePBX HTTP API klienti.
// 1) POST {base}/{domain}/auth.json  (auth_key=API_KEY)  -> data.key_id, data.key
// 2) So'rovlar "x-pbx-authentication: key_id:key" sarlavhasi bilan yuboriladi.
// 3) Qo'ng'iroqlar tarixi: POST {base}/{domain}/mongo_history/search.json
//    (start_stamp_from, start_stamp_to — bitta so'rovda maksimal 1 hafta).

let session = null; // { cacheKey, keyId, key }

const fail = (status, message) => Object.assign(new Error(message), { status });

function cfgFrom(settings) {
  const s = settings.pbx || {};
  return {
    domain: (process.env.PBX_DOMAIN || s.domain || '').trim(),
    apiKey: (process.env.PBX_API_KEY || s.apiKey || '').trim(),
    baseUrl: (process.env.PBX_API_BASE || s.baseUrl || 'https://api2.onlinepbx.ru').replace(/\/+$/, ''),
  };
}

function isConfigured(settings) {
  const c = cfgFrom(settings);
  return Boolean(c.domain && c.apiKey);
}

async function postForm(url, params, headers = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') body.append(k, String(v));
  // OnlinePBX ba'zan sekin javob beradi — tarmoq xatosi yoki kutish vaqti tugasa bir marta qayta urinamiz
  let res, text;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers },
        body,
        signal: AbortSignal.timeout(45000),
      });
      text = await res.text();
      break;
    } catch (err) {
      if (attempt >= 2) throw fail(502, `OnlinePBX serveriga ulanib bo'lmadi: ${err.cause?.code || err.name || err.message}`);
    }
  }
  try {
    return JSON.parse(text);
  } catch {
    throw fail(502, `OnlinePBX javobi JSON emas (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

async function auth(c) {
  const json = await postForm(`${c.baseUrl}/${c.domain}/auth.json`, { auth_key: c.apiKey });
  if (String(json.status) !== '1' || !json.data?.key) {
    const reason = String(json.comment || json.errorCode || JSON.stringify(json).slice(0, 200));
    if (/disabled/i.test(reason)) {
      throw fail(502, `OnlinePBX akkaunti (${c.domain}) o'chirilgan: litsenziya faol emas yoki to'lov qilinmagan. Kalit va sozlamalar to'g'ri — akkauntni OnlinePBX'da faollashtirish yoki boshqa (faol) akkaunt domenini kiritish kerak.`);
    }
    throw fail(502, `OnlinePBX avtorizatsiya xatosi (domen va API kalitni tekshiring): ${reason}`);
  }
  session = { cacheKey: c.domain + '|' + c.apiKey, keyId: json.data.key_id, key: json.data.key };
  return session;
}

async function request(settings, method, params = {}) {
  const c = cfgFrom(settings);
  if (!c.domain || !c.apiKey) throw fail(400, 'OnlinePBX sozlanmagan (domain va API kalit kerak)');
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!session || session.cacheKey !== c.domain + '|' + c.apiKey) await auth(c);
    const json = await postForm(`${c.baseUrl}/${c.domain}/${method}`, params, {
      'x-pbx-authentication': `${session.keyId}:${session.key}`,
    });
    if (String(json.status) === '1') return json.data;
    const notAuth = json.isNotAuth || /auth/i.test(String(json.comment || json.errorCode || ''));
    if (notAuth && attempt === 0) {
      session = null;
      continue;
    }
    throw fail(502, `OnlinePBX xatosi (${method}):${json.comment || json.errorCode || JSON.stringify(json).slice(0, 200)}`);
  }
  throw fail(502, 'OnlinePBX: avtorizatsiyadan o\'tib bo\'lmadi');
}

// [fromUnix, toUnix) oralig'idagi qo'ng'iroqlar
async function fetchCalls(settings, fromUnix, toUnix) {
  const data = await request(settings, 'mongo_history/search.json', {
    start_stamp_from: fromUnix,
    start_stamp_to: toUnix - 1,
  });
  return Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
}

// Ichki raqamlar ro'yxati: [{ num, name }]
async function users(settings) {
  const data = await request(settings, 'user/get.json');
  const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  return list
    .filter((u) => u && typeof u === 'object' && u.num !== undefined && u.enabled !== false && String(u.enabled) !== '0')
    .map((u) => ({ num: String(u.num).trim(), name: String(u.name ?? '').trim() }));
}

const num = (v) => (v === undefined || v === null ? '' : String(v).trim());

// Qo'ng'iroqdan xodimning ichki raqami(lar)ini topish uchun nomzodlar
function callNumbers(call) {
  const dir = String(call.accountcode || '').toLowerCase();
  const primary = dir === 'inbound' ? [call.destination_number, call.caller_id_number] : [call.caller_id_number, call.destination_number];
  const extra = [call.user, call.sub_number, call.user_number];
  for (const ev of Array.isArray(call.events) ? call.events : []) {
    extra.push(ev?.number, ev?.user, ev?.destination_number, ev?.caller_id_number);
  }
  return [...primary, ...extra].map(num).filter(Boolean);
}

// Qo'ng'iroqni bajargan/qabul qilgan ichki raqam: OnlinePBX har bir qo'ng'iroqqa "user" hodisasini yozadi.
// Bir nechta bo'lsa (navbat bo'yicha jiringlagan) — oxirgisi. Hodisa yo'q bo'lsa '' qaytadi.
function callUser(call) {
  const users = (Array.isArray(call.events) ? call.events : []).filter((ev) => ev?.type === 'user' && num(ev.number));
  return users.length ? num(users[users.length - 1].number) : '';
}

function talkSeconds(call) {
  for (const k of ['user_talk_time', 'talk_time', 'billsec']) {
    const v = Number(call[k]);
    if (Number.isFinite(v) && v >= 0 && call[k] !== undefined && call[k] !== null && call[k] !== '') return v;
  }
  return 0;
}

module.exports = { cfgFrom, isConfigured, request, fetchCalls, users, callNumbers, callUser, talkSeconds, auth };
