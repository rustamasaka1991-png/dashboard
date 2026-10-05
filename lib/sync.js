'use strict';

const db = require('./db');
const pbx = require('./pbx');
const amo = require('./amo');
const D = require('./dates');

const status = { running: false, lastRun: null, lastError: { pbx: null, amo: null }, lastOk: { pbx: null, amo: null } };

function extensionMap(employees) {
  const map = new Map();
  for (const e of employees) for (const x of e.extensions || []) if (String(x).trim()) map.set(String(x).trim(), e.id);
  return map;
}

function ensureAuto(state, date, empId) {
  state.auto[date] ??= {};
  state.auto[date][empId] ??= {};
  return state.auto[date][empId];
}

// Bitta kun uchun PBX statistikasi
async function syncPbxDay(date) {
  const state = db.get();
  const { settings, employees } = state;
  const from = D.dayStartUnix(date);
  const calls = await pbx.fetchCalls(settings, from, from + 86400);
  const extMap = extensionMap(employees);
  const minTalk = Number(settings.minTalkSec) || 0;
  const dirFilter = settings.callDirection || 'all';
  const agg = {};
  for (const call of calls) {
    const dir = String(call.accountcode || '').toLowerCase();
    if (dir === 'local') continue;
    if (dirFilter !== 'all' && dir && dir !== dirFilter) continue;
    const empId = pbx.callNumbers(call).map((n) => extMap.get(n)).find(Boolean);
    if (!empId) continue;
    const talk = pbx.talkSeconds(call);
    const a = (agg[empId] ??= { calls: 0, attempts: 0, talkSec: 0 });
    a.attempts++;
    if (talk > 0) a.talkSec += talk;
    if (talk >= minTalk && talk > 0) a.calls++;
  }
  for (const e of employees) {
    const a = agg[e.id] || { calls: 0, attempts: 0, talkSec: 0 };
    Object.assign(ensureAuto(state, date, e.id), a);
  }
  return calls.length;
}

// Oraliq uchun amoCRM yutuqli bitimlari (bir so'rovda)
async function syncAmoRange(fromDate, toDate) {
  const state = db.get();
  const { settings, employees } = state;
  const leads = await amo.wonLeads(settings, D.dayStartUnix(fromDate), D.dayStartUnix(D.addDays(toDate, 1)));
  const byUser = new Map(employees.filter((e) => e.amoUserId).map((e) => [String(e.amoUserId), e.id]));
  // tozalash
  for (const d of D.eachDay(fromDate, toDate)) {
    for (const e of employees) {
      if (state.auto[d]?.[e.id]) Object.assign(state.auto[d][e.id], { deals: 0, sales: 0 });
    }
  }
  for (const l of leads) {
    const empId = byUser.get(l.userId);
    if (!empId) continue;
    const a = ensureAuto(state, D.dateOfUnix(l.closedAt), empId);
    a.deals = (a.deals || 0) + 1;
    a.sales = (a.sales || 0) + l.price;
  }
  return leads.length;
}

async function syncRange(fromDate, toDate) {
  if (status.running) throw new Error('Sinxronizatsiya allaqachon ishlayapti');
  status.running = true;
  const state = db.get();
  const result = { pbx: null, amo: null };
  try {
    if (pbx.isConfigured(state.settings)) {
      try {
        let n = 0;
        for (const d of D.eachDay(fromDate, toDate)) {
          if (d > D.today()) break;
          n += await syncPbxDay(d);
        }
        result.pbx = { ok: true, calls: n };
        status.lastOk.pbx = new Date().toISOString();
        status.lastError.pbx = null;
      } catch (err) {
        result.pbx = { ok: false, error: err.message };
        status.lastError.pbx = err.message;
      }
    }
    if (amo.isConfigured(state.settings)) {
      try {
        // amoCRM'ga katta oraliqni oylik bo'laklarda so'raymiz
        let n = 0;
        let start = fromDate;
        while (start <= toDate) {
          let end = D.addDays(start, 30);
          if (end > toDate) end = toDate;
          n += await syncAmoRange(start, end);
          start = D.addDays(end, 1);
        }
        result.amo = { ok: true, leads: n };
        status.lastOk.amo = new Date().toISOString();
        status.lastError.amo = null;
      } catch (err) {
        result.amo = { ok: false, error: err.message };
        status.lastError.amo = err.message;
      }
    }
    status.lastRun = new Date().toISOString();
    db.save();
    return result;
  } finally {
    status.running = false;
  }
}

let timer = null;
function startScheduler() {
  clearInterval(timer);
  const tick = async () => {
    const t = D.today();
    try {
      await syncRange(D.addDays(t, -1), t);
    } catch (err) {
      if (!/allaqachon/.test(err.message)) console.error('[sync]', err.message);
    }
  };
  const minutes = Math.max(1, Number(db.get().settings.syncMinutes) || 5);
  timer = setInterval(tick, minutes * 60 * 1000);
  setTimeout(tick, 2000);
}

module.exports = { syncRange, startScheduler, status };
