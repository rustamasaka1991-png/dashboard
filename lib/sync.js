'use strict';

const db = require('./db');
const pbx = require('./pbx');
const amo = require('./amo');
const D = require('./dates');
const roster = require('./roster');

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
    // "user" hodisasi bo'lsa — faqat o'sha raqam (navbatdagi boshqa raqamlarga yozilib ketmasin)
    const user = pbx.callUser(call);
    const empId = user ? extMap.get(user) : pbx.callNumbers(call).map((n) => extMap.get(n)).find(Boolean);
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

// Xodimlar ro'yxatini amoCRM va OnlinePBX'dan to'ldirish (takrorlarsiz — lib/roster.js)
// manual = true: admin tugmani bosgan — ichki raqamlarni bog'lash darhol va 7 kunlik qo'ng'iroqlar bo'yicha
async function importRoster({ force = false, manual = false, linkDays = manual ? 7 : 2 } = {}) {
  const state = db.get();
  const sources = {};
  const errors = {};
  if (amo.isConfigured(state.settings)) {
    try {
      sources.amoUsers = (await amo.users(state.settings)).filter((u) => u.active);
    } catch (err) {
      errors.amo = err.message;
    }
  }
  if (pbx.isConfigured(state.settings)) {
    try {
      sources.pbxUsers = await pbx.users(state.settings);
    } catch (err) {
      errors.pbx = err.message;
    }
  }
  const result = roster.merge(state, sources, { force });
  result.extensions = [];
  // Egasi yo'q ichki raqamlar bo'lsa — amoCRM'dagi qo'ng'iroq yozuvlaridan kimniki ekanini aniqlaymiz.
  // Avtomatik rejimda soatiga bir marta (har 5 daqiqada ortiqcha so'rov yubormaslik uchun).
  const taken = new Set(state.employees.flatMap((e) => (e.extensions || []).map(String)));
  const freeExts = (sources.pbxUsers || []).map((u) => u.num).filter((n) => !taken.has(n));
  const due = linkDays > 0 && (manual || Date.now() - lastLinkAt > 3600 * 1000);
  if (freeExts.length && sources.amoUsers && due) {
    lastLinkAt = Date.now();
    try {
      result.extensions = roster.linkExtensions(state, await extensionVotes(state.settings, new Set(freeExts), linkDays), freeExts);
    } catch (err) {
      errors.link = err.message;
    }
    result.unlinked = freeExts.filter((n) => !state.employees.some((e) => (e.extensions || []).map(String).includes(n)));
  }
  const changed = result.added.length || result.linked.length || result.removed.length || result.merged.length || result.extensions.length;
  // takrorlar birlashtirilganda statistika ham ko'chadi — shunda hamma bo'lak yoziladi
  if (changed) db.saveNow(result.merged.length ? undefined : 'core');
  if (changed && manual) await db.flush();
  return { ...result, errors, sources: { amo: sources.amoUsers?.length ?? null, pbx: sources.pbxUsers?.length ?? null } };
}

// Oxirgi kunlardagi qo'ng'iroqlar: OnlinePBX'dagi ichki raqam + amoCRM eslatmasidagi xodim (uuid bo'yicha)
let lastLinkAt = 0;
async function extensionVotes(settings, exts, days) {
  const t = D.today();
  const byUuid = new Map();
  const dayList = D.eachDay(D.addDays(t, -(days - 1)), t);
  let failed = 0, lastError;
  for (const d of dayList) {
    const from = D.dayStartUnix(d);
    let calls;
    try {
      calls = await pbx.fetchCalls(settings, from, from + 86400);
    } catch (err) {
      // bitta kun yuklanmasa, qolgan kunlar bilan davom etamiz
      failed++;
      lastError = err;
      continue;
    }
    for (const call of calls) {
      const ext = pbx.callUser(call);
      if (ext && exts.has(ext) && call.uuid) byUuid.set(String(call.uuid), ext);
    }
  }
  if (failed === dayList.length) throw lastError;
  if (!byUuid.size) return [];
  const notes = await amo.callNotes(settings, D.dayStartUnix(D.addDays(t, -(days - 1))));
  const votes = [];
  const used = new Set();
  for (const n of notes) {
    const ext = byUuid.get(n.uniq);
    if (!ext || used.has(n.uniq)) continue; // bitta qo'ng'iroq bitim va kontaktga ikki marta yozilishi mumkin
    used.add(n.uniq);
    votes.push({ ext, userId: n.userId, out: n.out });
  }
  return votes;
}


// Holat (oxirgi sinxronizatsiya vaqti, xatolar) omborda ham saqlanadi — serverless nusxalar va qayta
// ishga tushirishlar orasida yo'qolmasligi uchun.
function persistStatus(state) {
  state.syncLog = { lastRun: status.lastRun, lastOk: { ...status.lastOk }, lastError: { ...status.lastError }, lastLinkAt };
}
function restoreStatus() {
  if (status.running) return;
  const log = db.get().syncLog || {};
  if (!log.lastRun && !log.lastLinkAt) return;
  status.lastRun = log.lastRun || null;
  status.lastOk = { pbx: null, amo: null, ...log.lastOk };
  status.lastError = { pbx: null, amo: null, ...log.lastError };
  lastLinkAt = Number(log.lastLinkAt) || 0;
}

const busy = () => Object.assign(new Error('Sinxronizatsiya allaqachon ishlayapti, biroz kuting'), { status: 409 });

async function syncRange(fromDate, toDate) {
  if (status.running) throw busy();
  status.running = true;
  db.hold();
  let locked = false;
  try {
    locked = await db.lock('sync', 150);
    if (!locked) throw busy();
    const state = db.get();
    const result = { pbx: null, amo: null };
    // avval yangi xodimlar — shunda ularning statistikasi ham shu sinxronizatsiyada to'ladi
    result.roster = await importRoster().catch((err) => ({ added: [], linked: [], removed: [], errors: { roster: err.message } }));
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
    persistStatus(state);
    db.save('auto');
    await db.flush();
    return result;
  } finally {
    if (locked) await db.unlock('sync');
    db.release();
    status.running = false;
  }
}

const syncEveryMs = () => Math.max(1, Number(db.get().settings.syncMinutes) || 5) * 60 * 1000;
const configured = () => pbx.isConfigured(db.get().settings) || amo.isConfigured(db.get().settings);

// Oxirgi sinxronizatsiya eskirganmi (dashboard shunga qarab /api/sync/auto ni chaqiradi)
function isStale() {
  if (!configured() || status.running) return false;
  return !status.lastRun || Date.now() - Date.parse(status.lastRun) > syncEveryMs();
}

// So'rov bo'yicha sinxronizatsiya: serverless muhitda fon jarayoni yo'q, shuning uchun bugun va kechani
// ochiq turgan dashboard (yoki Vercel Cron) yangilab turadi. Tez-tez chaqirilsa ham ortiqcha ishlamaydi.
async function autoSync() {
  if (!configured()) return { skipped: 'not-configured' };
  if (!isStale()) return { skipped: status.running ? 'running' : 'fresh' };
  const t = D.today();
  try {
    return { ok: true, result: await syncRange(D.addDays(t, -1), t) };
  } catch (err) {
    if (err.status === 409) return { skipped: 'running' };
    throw err;
  }
}

let timer = null;
function startScheduler() {
  clearInterval(timer);
  if (db.SERVERLESS) return; // serverless'da doimiy jarayon yo'q — autoSync() ishlatiladi
  const tick = () => autoSyncNow().catch((err) => console.error('[sync]', err.message));
  timer = setInterval(tick, syncEveryMs());
  setTimeout(tick, 2000);
}
async function autoSyncNow() {
  const t = D.today();
  try {
    await syncRange(D.addDays(t, -1), t);
  } catch (err) {
    if (err.status !== 409) throw err;
  }
}

module.exports = { syncRange, importRoster, autoSync, isStale, restoreStatus, startScheduler, status };
