'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

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

let state = null;
let saveTimer = null;

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

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let raw = null;
  if (fs.existsSync(FILE)) {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  }
  state = {
    settings: deepMerge(DEFAULT_SETTINGS, raw?.settings),
    employees: raw?.employees ?? SEED_EMPLOYEES.map((e, i) => ({
      id: newId(), name: e.name, role: e.role, photo: '', extensions: [], amoUserId: '', active: true, order: i, createdAt: new Date().toISOString(),
    })),
    entries: raw?.entries ?? {}, // qo'lda kiritilgan: entries[date][empId] = {script, conversion, sales, deals, calls, talkMin}
    auto: raw?.auto ?? {}, // integratsiyadan: auto[date][empId] = {calls, attempts, talkSec, deals, sales}
    syncLog: raw?.syncLog ?? {},
  };
  if (!raw) saveNow();
  return state;
}

function get() {
  if (!state) load();
  return state;
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state));
  fs.renameSync(tmp, FILE);
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveNow, 300);
}

module.exports = { load, get, save, saveNow, newId, deepMerge, DEFAULT_SETTINGS, FILE };
