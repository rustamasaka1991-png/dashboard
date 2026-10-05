'use strict';

const D = require('./dates');

const KPIS = ['calls', 'talkMin', 'script', 'conversion', 'sales'];
// Davr davomida yig'iladigan KPI'lar (plani ish kunlariga ko'paytiriladi)
const CUMULATIVE = new Set(['calls', 'talkMin', 'sales']);
// "Oraliq" filtri uchun maksimal uzunlik (kun)
const MAX_RANGE_DAYS = 1100;

function workDays(settings, period, range) {
  const perMonth = Number(settings.workDaysPerMonth) || 24;
  switch (period) {
    case 'day':
      return 1;
    case 'week':
      return Number(settings.workDaysPerWeek) || 6;
    case 'month':
      return perMonth;
    case 'year':
      return perMonth * 12;
    default: {
      const off = new Set(settings.daysOff || [0]);
      return Math.max(1, D.eachDay(range.from, range.to).filter((d) => !off.has(D.weekday(d))).length);
    }
  }
}

// Davrning qancha qismi o'tgani (0..1): o'tgan ish kunlari / davrdagi ish kunlari.
// Tugagan (yoki hali boshlanmagan) davr uchun 1 — ya'ni to'liq plan bilan solishtiriladi.
function paceFor(settings, range, today) {
  if (range.to <= today || range.from > today) return 1;
  const off = new Set(settings.daysOff || [0]);
  let all = 0, passed = 0;
  for (const d of D.eachDay(range.from, range.to)) {
    if (off.has(D.weekday(d))) continue;
    all++;
    if (d <= today) passed++;
  }
  return all && passed ? passed / all : 1;
}

const isNum = (v) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));

// Bitta xodimning bitta kundagi ko'rsatkichlari (qo'lda kiritilgani avtomatikdan ustun)
function dayValues(state, date, empId) {
  const { settings } = state;
  const e = state.entries[date]?.[empId] || {};
  const a = state.auto[date]?.[empId] || {};
  const calls = isNum(e.calls) ? Number(e.calls) : Number(a.calls) || 0;
  const talkMin = isNum(e.talkMin) ? Number(e.talkMin) : (Number(a.talkSec) || 0) / 60;
  const deals = isNum(e.deals) ? Number(e.deals) : Number(a.deals) || 0;
  const sales = isNum(e.sales) ? Number(e.sales) : Number(a.sales) || 0;
  const script = isNum(e.script) ? Number(e.script) : null;
  let conversion = isNum(e.conversion) ? Number(e.conversion) : null;
  let convAuto = false;
  if (conversion === null && settings.conversionSource === 'auto' && calls > 0) {
    conversion = (deals / calls) * 100;
    convAuto = true;
  }
  return { calls, talkMin, script, conversion, sales, deals, convAuto };
}

function aggregate(state, empId, from, to) {
  const v = { calls: 0, talkMin: 0, sales: 0, deals: 0 };
  let sSum = 0, sN = 0, cSum = 0, cN = 0;
  // Avto-konversiya kunlari: kunlik foizlarning o'rtachasi emas, jami sotuv / jami aloqa
  let aDeals = 0, aCalls = 0, aN = 0;
  for (const d of D.eachDay(from, to)) {
    if (!state.entries[d]?.[empId] && !state.auto[d]?.[empId]) continue;
    const x = dayValues(state, d, empId);
    v.calls += x.calls;
    v.talkMin += x.talkMin;
    v.sales += x.sales;
    v.deals += x.deals;
    if (x.script !== null) { sSum += x.script; sN++; }
    if (x.convAuto) { aDeals += x.deals; aCalls += x.calls; aN++; }
    else if (x.conversion !== null) { cSum += x.conversion; cN++; }
  }
  if (aN) { cSum += (aDeals / aCalls) * 100 * aN; cN += aN; }
  v.script = sN ? sSum / sN : null;
  v.conversion = cN ? cSum / cN : null;
  return v;
}

function planFor(settings, wd) {
  const p = settings.plans;
  return {
    calls: p.calls * wd,
    talkMin: p.talkMin * wd,
    script: p.script,
    conversion: p.conversion,
    sales: p.sales * wd,
  };
}

function percents(values, plan) {
  const out = {};
  for (const k of KPIS) {
    const v = values[k];
    out[k] = v === null || !plan[k] ? 0 : (v / plan[k]) * 100;
  }
  return out;
}

// Hisobga olinadigan KPI'lar: plani va og'irligi 0 dan katta bo'lganlar
function activeKpis(settings) {
  const w = settings.weights || {};
  return KPIS.filter((k) => Number(settings.plans?.[k]) > 0 && Number(w[k] ?? 20) > 0);
}

function score(settings, pct) {
  const w = settings.weights || {};
  const cap = Number(settings.scoreCap) || 150;
  let sum = 0, wsum = 0;
  for (const k of activeKpis(settings)) {
    const wk = Number(w[k] ?? 20);
    sum += Math.min(pct[k], cap) * wk;
    wsum += wk;
  }
  return wsum ? sum / wsum : 0;
}

// pct      — natija / davrning to'liq plani (ekrandagi foiz)
// pacePct  — natija / bugungi kungacha bo'lishi kerak bo'lgan plan (rang va reyting bali uchun)
function finish(settings, values, plan, pace) {
  const pct = percents(values, plan);
  const pacePct = {};
  for (const k of KPIS) pacePct[k] = CUMULATIVE.has(k) && pace > 0 && pace < 1 ? pct[k] / pace : pct[k];
  return { values, plan, pct, pacePct, score: score(settings, pacePct) };
}

function block(state, empId, from, to, wd, pace = 1) {
  return finish(state.settings, aggregate(state, empId, from, to), planFor(state.settings, wd), pace);
}

function totalsBlock(state, blocks, wd, pace = 1) {
  const n = blocks.length || 1;
  const values = { calls: 0, talkMin: 0, sales: 0, deals: 0 };
  let sSum = 0, sN = 0, cSum = 0, cN = 0;
  for (const b of blocks) {
    values.calls += b.values.calls;
    values.talkMin += b.values.talkMin;
    values.sales += b.values.sales;
    values.deals += b.values.deals;
    if (b.values.script !== null) { sSum += b.values.script; sN++; }
    if (b.values.conversion !== null) { cSum += b.values.conversion; cN++; }
  }
  values.script = sN ? sSum / sN : null;
  values.conversion = cN ? cSum / cN : null;
  const one = planFor(state.settings, wd);
  const plan = { ...one, calls: one.calls * n, talkMin: one.talkMin * n, sales: one.sales * n };
  return finish(state.settings, values, plan, pace);
}

function trend(state, empId, range, today) {
  const off = new Set(state.settings.daysOff || [0]);
  const days = D.eachDay(range.from, range.to > today ? today : range.to).filter((d) => !off.has(D.weekday(d)));
  if (days.length <= 62) {
    return days.map((d) => ({ label: d, score: block(state, empId, d, d, 1).score }));
  }
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  return months.map((m) => {
    const r = D.periodRange('month', m + '-01');
    return { label: m, score: block(state, empId, r.from, r.to, workDays(state.settings, 'month', r), paceFor(state.settings, r, today)).score };
  });
}

function dashboard(state, { date, period, from, to, ids, today = D.today() }) {
  const { settings } = state;
  date = D.isDate(date) ? date : today;
  period = ['week', 'month', 'year', 'custom'].includes(period) ? period : 'month';
  const range = D.periodRange(period, date, from, to);
  if (D.daysBetween(range.from, range.to) > MAX_RANGE_DAYS) {
    throw Object.assign(new Error(`Oraliq juda katta (maksimal ${MAX_RANGE_DAYS} kun)`), { status: 400 });
  }
  const wd = workDays(settings, period, range);
  const pace = paceFor(settings, range, today);
  const filter = ids && ids.length ? new Set(ids) : null;
  const active = state.employees.filter((e) => e.active !== false);
  const emps = active.filter((e) => !filter || filter.has(e.id));
  const kpis = activeKpis(settings);

  const rows = emps.map((e) => {
    const day = block(state, e.id, date, date, 1);
    const per = block(state, e.id, range.from, range.to, wd, pace);
    return {
      id: e.id,
      name: e.name,
      role: e.role,
      photo: e.photo,
      day,
      period: per,
      score: per.score,
      dailyPlanDone: kpis.length > 0 && kpis.every((k) => day.pct[k] >= 100),
      trend: trend(state, e.id, range, today),
    };
  });
  rows.sort((a, b) => b.score - a.score || b.period.values.sales - a.period.values.sales || a.name.localeCompare(b.name));
  rows.forEach((r, i) => (r.rank = i + 1));

  const dailyBonus = rows
    .filter((r) => r.dailyPlanDone)
    .sort((a, b) => b.day.score - a.day.score)
    .slice(0, 3)
    .map((r) => ({ id: r.id, name: r.name, score: r.day.score }));

  // Oy lideri xodimlar filtriga bog'liq emas — barcha faol xodimlar ichidan
  const mr = D.periodRange('month', date);
  const monthLeader = active
    .map((e) => ({ id: e.id, name: e.name, sales: aggregate(state, e.id, mr.from, mr.to).sales }))
    .filter((x) => x.sales > 0)
    .sort((a, b) => b.sales - a.sales)[0] || null;

  return {
    date,
    period,
    range,
    workDays: wd,
    pace,
    plans: { day: planFor(settings, 1), period: planFor(settings, wd) },
    rows,
    totals: {
      day: totalsBlock(state, rows.map((r) => r.day), 1),
      period: totalsBlock(state, rows.map((r) => r.period), wd, pace),
      count: rows.length,
    },
    dailyBonus,
    monthLeader,
  };
}

module.exports = { dashboard, dayValues, aggregate, workDays, paceFor, KPIS, MAX_RANGE_DAYS };
