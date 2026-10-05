'use strict';

/* ================= yordamchilar ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let tzOffsetH = 5; // kompaniya vaqt zonasi (serverdan keladi: TZ_OFFSET_HOURS)
const MONTHS = ['YANVAR', 'FEVRAL', 'MART', 'APREL', 'MAY', 'IYUN', 'IYUL', 'AVGUST', 'SENTABR', 'OKTABR', 'NOYABR', 'DEKABR'];
const WEEKDAYS = ['YAKSHANBA', 'DUSHANBA', 'SESHANBA', 'CHORSHANBA', 'PAYSHANBA', 'JUMA', 'SHANBA'];
const PERIOD_LABEL = { week: 'HAFTALIK', month: 'OYLIK', year: 'YILLIK', custom: 'ORALIQ' };
const PERIOD_BTN = { week: 'Hafta', month: 'Oy', year: 'Yil', custom: 'Oraliq' };

let token = localStorage.getItem('uzg.token') || '';
let isAdmin = false;
let defaultPassword = false;
let employeesCache = [];
let refreshTimer = null;
const ui = Object.assign({ period: 'month', date: '', from: '', to: '', ids: [], sort: 'score' }, safeJson(localStorage.getItem('uzg.ui')));
ui.date = ''; // har doim bugundan boshlanadi

function safeJson(s) {
  try { return JSON.parse(s) || {}; } catch { return {}; }
}
function saveUi() {
  try { localStorage.setItem('uzg.ui', JSON.stringify({ period: ui.period, from: ui.from, to: ui.to, ids: ui.ids, sort: ui.sort })); } catch { /* */ }
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token && path !== '/api/login') {
      token = ''; localStorage.removeItem('uzg.token'); isAdmin = false; updateAuthBtn();
    }
    throw new Error(data.error || 'Xatolik: HTTP ' + res.status);
  }
  return data;
}

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), err ? 6000 : 2800);
}

// Vaqt belgisi (ms yoki ISO satr) -> kompaniya vaqt zonasidagi sana va soat
function localParts(t = Date.now()) {
  const iso = new Date(new Date(t).getTime() + tzOffsetH * 36e5).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
const nowParts = () => localParts();
const todayStr = () => nowParts().date;
function addDays(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
function longDate(d) {
  const dt = new Date(d + 'T00:00:00Z');
  return { day: `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`, wd: WEEKDAYS[dt.getUTCDay()] };
}
const shortDate = (d) => d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4);

const intFmt = (n) => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ');
function money(n, cur) {
  const v = Math.round(n).toLocaleString('en-US');
  return cur === '$' || !cur ? '$' + v : v + ' ' + esc(cur);
}
function fmtVal(k, v, cur) {
  if (v === null || v === undefined) return '—';
  if (k === 'calls' || k === 'talkMin') return intFmt(v);
  if (k === 'script') return String(Math.round(v));
  if (k === 'conversion') return (Math.round(v * 10) / 10).toFixed(1) + '%';
  if (k === 'sales') return money(v, cur);
  return String(v);
}
const pctClass = (p) => (p >= 100 ? 'green' : p >= 65 ? 'orange' : 'red');
const initials = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
function avatar(e, cls = 'avatar') {
  return e.photo ? `<div class="${cls}"><img src="${esc(e.photo)}" alt=""></div>` : `<div class="${cls}">${esc(initials(e.name))}</div>`;
}

/* ================= ikonlar ================= */
const ICON = {
  phone: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" stroke-linecap="round"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 2h8l6 6v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm7 1.5V9h5.5L13 3.5zM8 12v1.6h8V12H8zm0 3.4V17h8v-1.6H8zm0-6.8v1.6h3V8.6H8z"/></svg>',
  funnel: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 4h18l-7 8.5V19l-4 2v-8.5L3 4z"/></svg>',
  bars: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="13" width="4" height="8" rx="1"/><rect x="10" y="8" width="4" height="13" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7.5" r="4.5"/><path d="M3 21c0-5 4-8 9-8s9 3 9 8H3z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7" r="3.6"/><circle cx="5" cy="9" r="2.6"/><circle cx="19" cy="9" r="2.6"/><path d="M5.5 20c0-4 3-6.5 6.5-6.5s6.5 2.5 6.5 6.5h-13zM0.5 19c0-3 1.8-5 4.3-5 .8 0 1.5.2 2.1.5A8 8 0 0 0 4 19H.5zM23.5 19c0-3-1.8-5-4.3-5-.8 0-1.5.2-2.1.5A8 8 0 0 1 20 19h3.5z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2.5" fill="#fff" stroke="#fff"/><path d="M3 9.5h18" stroke="#0b3b1d" stroke-width="2"/><path d="M7.5 3v4M16.5 3v4" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><g fill="#0b3b1d" stroke="none"><rect x="6" y="12" width="3" height="2.4" rx=".5"/><rect x="10.5" y="12" width="3" height="2.4" rx=".5"/><rect x="15" y="12" width="3" height="2.4" rx=".5"/><rect x="6" y="16" width="3" height="2.4" rx=".5"/><rect x="10.5" y="16" width="3" height="2.4" rx=".5"/><rect x="15" y="16" width="3" height="2.4" rx=".5"/></g></svg>',
  coin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15.9V19h-2v-1.1c-1.6-.3-2.9-1.3-3-3h1.9c.1.9.9 1.4 2.1 1.4 1.3 0 1.9-.6 1.9-1.3 0-.8-.5-1.2-2.2-1.6-2-.5-3.3-1.2-3.3-3 0-1.4 1.1-2.4 2.6-2.7V6.6h2v1.1c1.5.3 2.5 1.3 2.6 2.8h-1.9c-.1-.8-.7-1.3-1.7-1.3-1.1 0-1.7.5-1.7 1.2 0 .7.6 1 2.2 1.4 2 .5 3.3 1.2 3.3 3.1 0 1.5-1.1 2.6-2.8 3z"/></svg>',
};
const LEAF_LOGO = '<svg viewBox="0 0 48 48"><path fill="#3ddc6a" d="M24 44c0-16 8-30 20-36-2 18-9 31-20 36z"/><path fill="#fff" d="M24 44C24 31 17 20 5 15c1 15 8 25 19 29z"/></svg>';
const TROPHY = (id) => `<svg viewBox="0 0 64 64" class="ico"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#d99a10"/></linearGradient></defs><path fill="url(#${id})" d="M18 6h28v6h10v6c0 8-6 13-12 14-2 5-6 8-10 9v7h8v6H22v-6h8v-7c-4-1-8-4-10-9-6-1-12-6-12-14v-6h10V6zm-6 12c0 4 3 7 6 8V18h-6zm40 0h-6v8c3-1 6-4 6-8z"/><rect x="16" y="54" width="32" height="6" rx="2" fill="#b77c0a"/></svg>`;
const CROWN_MONEY = '<svg viewBox="0 0 64 64" class="ico"><rect x="6" y="40" width="40" height="14" rx="2" fill="#2f9e46"/><rect x="10" y="34" width="40" height="14" rx="2" fill="#3cbf57"/><rect x="14" y="28" width="40" height="14" rx="2" fill="#4bd468"/><circle cx="34" cy="35" r="4" fill="#2f9e46"/><path d="M30 6l6 8 7-10 6 10 6-8-3 18H33z" fill="#ffc83d" stroke="#c98a00" stroke-width="1.5"/></svg>';

function medal(rank, size = 44) {
  if (rank === 1) {
    return `<svg class="medal" width="${size}" height="${size}" viewBox="0 0 64 64"><path fill="#f6b819" d="M16 6h32v6h9v5c0 8-6 13-12 14-2 5-6 8-11 9v6h7v6H23v-6h7v-6c-5-1-9-4-11-9-6-1-12-6-12-14v-5h9V6zm-5 11c0 4 2 7 5 8v-8h-5zm42 0h-5v8c3-1 5-4 5-8z"/><rect x="18" y="54" width="28" height="6" rx="2" fill="#b77c0a"/><text x="32" y="29" text-anchor="middle" font-size="18" font-weight="900" fill="#fff" font-family="Montserrat,sans-serif">1</text></svg>`;
  }
  const c = rank === 2 ? ['#eef2f1', '#a9b4b0', '#7d8a85'] : ['#f0a868', '#c06b2c', '#8a4515'];
  return `<svg class="medal" width="${size}" height="${size}" viewBox="0 0 64 64"><path d="M20 2h10l4 14H24zM34 2h10l-4 14H30z" fill="${c[2]}"/><circle cx="32" cy="38" r="22" fill="${c[1]}"/><circle cx="32" cy="38" r="17" fill="${c[0]}"/><text x="32" y="46" text-anchor="middle" font-size="22" font-weight="900" fill="${c[2]}" font-family="Montserrat,sans-serif">${rank}</text></svg>`;
}

/* ================= KPI ustunlari ================= */
const COLS = [
  { k: 'calls', title: '1. GAPLASHISH / REAL ALOQA', short: 'GAPLASHISH / REAL ALOQA', icon: 'phone', planFmt: (v) => intFmt(v) + ' ta', sub: '(kamida)' },
  { k: 'talkMin', title: '2. SUHBAT VAQTI', short: 'SUHBAT VAQTI', icon: 'clock', planFmt: (v) => intFmt(v) + ' minut', sub: '(kamida)' },
  { k: 'script', title: '3. SOTUV SKRIPT BALI', short: 'SKRIPT BALI', icon: 'doc', planFmt: (v) => intFmt(v) + ' ball', sub: '(kamida)' },
  { k: 'conversion', title: '4. KONVERSIYA', short: 'KONVERSIYA', icon: 'funnel', planFmt: (v) => v + ' %', sub: 'Uchrashuv → Shartnoma → Sotuv (kamida)' },
  { k: 'sales', title: '5. SOTUV SUMMASI', short: 'SOTUV SUMMASI', icon: 'bars', planFmt: null, sub: '(kamida)' },
];

function lineText(k, b, isPeriod, cur) {
  const v = b.values[k];
  const p = b.plan[k];
  switch (k) {
    case 'calls': return `${fmtVal(k, v)} <span>/ ${intFmt(p)}</span>`;
    case 'talkMin': return `${fmtVal(k, v)} <span>/ ${intFmt(p)} min</span>`;
    case 'script': return `${fmtVal(k, v)} <span>/ ${isPeriod ? '≥' + p + " (o'rtacha)" : p}</span>`;
    case 'conversion': return `${fmtVal(k, v)} <span>/ ${p}%</span>`;
    case 'sales': return `${fmtVal(k, v, cur)} <span>/ ${money(p, cur)}</span>`;
    default: return '';
  }
}

const CUMULATIVE = ['calls', 'talkMin', 'sales'];

// Foiz — natija / to'liq plan. Rang — davrning o'tgan qismiga nisbatan (pacePct):
// oy o'rtasida grafikdan oldinda bo'lgan xodim yashil ko'rinadi. Chiziqcha — bugun qayerda bo'lish kerakligi.
function mline(col, b, isPeriod, cur, pace = 1) {
  const pct = b.pct[col.k] || 0;
  const cls = pctClass(b.pacePct?.[col.k] ?? pct);
  const icon = col.k === 'sales' && !isPeriod ? ICON.coin : ICON[col.icon];
  const tick = isPeriod && pace > 0 && pace < 1 && CUMULATIVE.includes(col.k)
    ? `<u style="left:${(pace * 100).toFixed(1)}%" title="Bugungi kungacha reja: ${Math.round(pace * 100)}%"></u>` : '';
  return `<div class="mline">
    <div class="lbl">${icon}${lineText(col.k, b, isPeriod, cur)}</div>
    <div class="pct c-${cls}">${Math.round(pct)}%</div>
    <div class="bar"><i class="b-${cls}" style="width:${Math.min(100, pct).toFixed(1)}%"></i>${tick}</div>
  </div>`;
}

/* ================= umumiy filtr paneli ================= */
function filtersHtml(d, { sort = true } = {}) {
  const active = employeesCache.filter((e) => e.active !== false);
  const selCount = ui.ids.filter((id) => active.some((e) => e.id === id)).length;
  const empLabel = selCount ? `${selCount} ta xodim` : 'Hammasi';
  return `<div class="filters">
    <div class="seg" id="perSeg">${Object.entries(PERIOD_BTN).map(([p, l]) => `<button data-p="${p}" class="${ui.period === p ? 'on' : ''}">${l}</button>`).join('')}</div>
    <button class="btn ghost sm" id="prevDay" title="Oldingi kun">‹</button>
    <input type="date" class="input" id="fDate" value="${d.date}" title="Kun">
    <button class="btn ghost sm" id="nextDay" title="Keyingi kun">›</button>
    ${d.date !== d.today ? '<button class="btn sm" id="todayBtn" title="Bugungi kunga qaytish">Bugun</button>' : ''}
    ${ui.period === 'custom' ? `<input type="date" class="input" id="fFrom" value="${d.range.from}" title="Dan"> — <input type="date" class="input" id="fTo" value="${d.range.to}" title="Gacha">` : `<span class="hint">${shortDate(d.range.from)} — ${shortDate(d.range.to)}</span>`}
    <div class="dd">
      <button class="btn ghost sm" id="empBtn">Xodimlar: ${esc(empLabel)} ▾</button>
      <div class="dd-menu" id="empMenu" hidden>
        ${active.map((e) => `<label><input type="checkbox" value="${e.id}" ${ui.ids.includes(e.id) ? 'checked' : ''}> ${esc(e.name)}</label>`).join('') || '<div class="hint">Xodim yo\'q</div>'}
        <div class="dd-actions"><button class="btn sm" id="empApply">Qo'llash</button><button class="btn ghost sm" id="empAll">Hammasi</button></div>
      </div>
    </div>
    ${sort ? `<select class="input" id="fSort" title="Saralash">
      <option value="score">Saralash: Reyting</option>
      ${COLS.map((c) => `<option value="${c.k}" ${ui.sort === c.k ? 'selected' : ''}>Saralash: ${c.short.toLowerCase()}</option>`).join('')}
    </select>` : ''}
    <span class="grow"></span>
    <button class="btn ghost sm" id="refreshBtn">↻ Yangilash</button>
  </div>`;
}

function bindFilters(rerender) {
  $$('#perSeg button').forEach((b) => b.addEventListener('click', () => { ui.period = b.dataset.p; saveUi(); rerender(); }));
  // Bugungi sana tanlansa ui.date bo'shatiladi — shunda avtomatik yangilanish va yarim tundagi kun almashishi ishlayveradi
  const setDate = (v) => { ui.date = !v || v === todayStr() ? '' : v; rerender(); };
  $('#fDate')?.addEventListener('change', (e) => setDate(e.target.value));
  $('#prevDay')?.addEventListener('click', () => setDate(addDays($('#fDate').value || todayStr(), -1)));
  $('#nextDay')?.addEventListener('click', () => setDate(addDays($('#fDate').value || todayStr(), 1)));
  $('#todayBtn')?.addEventListener('click', () => setDate(''));
  const onRange = () => { ui.from = $('#fFrom').value; ui.to = $('#fTo').value; saveUi(); if (ui.from && ui.to) rerender(); };
  $('#fFrom')?.addEventListener('change', onRange);
  $('#fTo')?.addEventListener('change', onRange);
  $('#fSort')?.addEventListener('change', (e) => { ui.sort = e.target.value; saveUi(); rerender(); });
  $('#refreshBtn')?.addEventListener('click', rerender);
  const menu = $('#empMenu');
  $('#empBtn')?.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  menu?.addEventListener('click', (e) => e.stopPropagation());
  $('#empApply')?.addEventListener('click', () => { ui.ids = $$('#empMenu input:checked').map((i) => i.value); saveUi(); rerender(); });
  $('#empAll')?.addEventListener('click', () => { ui.ids = []; saveUi(); rerender(); });
}
document.addEventListener('click', () => { const m = $('#empMenu'); if (m) m.hidden = true; });

function dashQuery() {
  const q = new URLSearchParams({ period: ui.period });
  if (ui.date) q.set('date', ui.date);
  if (ui.period === 'custom' && ui.from && ui.to) { q.set('from', ui.from); q.set('to', ui.to); }
  if (ui.ids.length) q.set('ids', ui.ids.join(','));
  return '/api/dashboard?' + q;
}

/* ================= DASHBOARD ================= */
function headerHtml(s) {
  const now = nowParts();
  const ld = longDate(now.date);
  const words = (s.title || '').trim().split(/\s+/);
  const last = words.length > 1 ? words.pop() : '';
  return `<header class="hdr">
    <div class="logo">${LEAF_LOGO}<div><b>${esc(s.companyName)}</b><small>${esc(s.companyTagline)}</small></div></div>
    <div class="title"><h1>${esc(words.join(' '))} <span>${esc(last)}</span></h1><p>${esc(s.subtitle)}</p></div>
    <div class="datebox">${ICON.calendar}<div><b>BUGUN</b><div class="big" id="hdrDate">${ld.day}</div><small id="hdrWd">${ld.wd}</small></div></div>
    <div class="clock" id="clock">${now.time}</div>
  </header>`;
}

function bonusHtml(d) {
  const s = d.settings;
  const winners = d.dailyBonus.length
    ? d.dailyBonus.map((w, i) => `<span class="chip">${i + 1}. ${esc(w.name)}</span>`).join('')
    : '<span class="chip muted">Hozircha rejani to\'liq bajargan yo\'q</span>';
  const leader = d.monthLeader ? `<span class="chip">👑 ${esc(d.monthLeader.name)} — ${money(d.monthLeader.sales, s.currency)}</span>` : '<span class="chip muted">Hali sotuv yo\'q</span>';
  return `<section class="bonus-row">
    <div class="bonus">${TROPHY('tg1')}<div><h3>KUNLIK BONUS</h3><div class="val">${esc(s.dailyBonus)}</div><p>${esc(s.dailyBonusText)}</p><div class="winners">${winners}</div></div></div>
    <div class="bonus center"><div class="ico">${ICON.calendar}</div><div><h3>Oylik ish kuni</h3><div class="val">${s.workDaysPerMonth} kun</div><p>(1 oyda) · Hisobot davri: <b>${PERIOD_LABEL[d.period].toLowerCase()}</b>, ${d.workDays} ish kuni</p></div></div>
    <div class="bonus"><div style="display:flex;align-items:center;gap:12px;flex:1">${TROPHY('tg2')}<div><h3 class="gold">OYLIK BONUS</h3><p>${esc(s.monthlyBonusText)}</p><div class="winners">${leader}</div></div></div>${CROWN_MONEY}</div>
  </section>`;
}

function boardHtml(d) {
  const s = d.settings;
  const cur = s.currency;
  const PL = PERIOD_LABEL[d.period];
  const dayLbl = d.date === d.today ? 'KUNLIK' : `KUNLIK (${shortDate(d.date)})`;
  let html = '<div class="board-wrap"><div class="board">';

  // Kunlik plan
  html += `<div class="cell plan-label">${ICON.user}<div><b>KUNLIK PLAN</b><small>(har bir xodim uchun)</small></div></div>`;
  for (const c of COLS) {
    const v = d.plans.day[c.k];
    html += `<div class="cell plan-card">${ICON[c.icon]}<div class="txt"><div class="t">${c.title}</div><div class="v">${c.k === 'sales' ? money(v, cur) : c.planFmt(v)}</div><div class="s">${c.sub}</div></div></div>`;
  }
  // Davr plani
  html += `<div class="cell period-plan label">${ICON.users.replace('<svg', '<svg style="color:#1b7a3b"')}<div><b>${PL} PLAN</b> <small>(${d.workDays} kun)</small></div></div>`;
  for (const c of COLS) {
    const v = d.plans.period[c.k];
    let txt;
    if (c.k === 'talkMin') txt = `${intFmt(v)} minut<small>(${intFmt(v / 60)} soat)</small>`;
    else if (c.k === 'script') txt = `Har kuni ≥${v} ball`;
    else if (c.k === 'conversion') txt = `≥ ${v} %<small>(davr davomida)</small>`;
    else if (c.k === 'sales') txt = money(v, cur);
    else txt = `${intFmt(v)} ta`;
    html += `<div class="cell period-plan">${ICON[c.icon].replace('<svg', '<svg style="color:#1b5e35"')}<div class="v ${c.k === 'script' ? 'sm' : ''}">${txt}</div></div>`;
  }
  // Sarlavhalar
  html += `<div class="cell col-head">XODIM<small>Reyting: ${PL.toLowerCase()} ball</small></div>`;
  for (const c of COLS) html += `<div class="cell col-head">${c.short}<small>↑ ${dayLbl.toLowerCase()} · ↓ ${PL.toLowerCase()} natija / plan</small></div>`;

  // Xodimlar
  const rows = [...d.rows];
  if (ui.sort !== 'score') rows.sort((a, b) => (b.period.pct[ui.sort] || 0) - (a.period.pct[ui.sort] || 0));
  if (!rows.length) {
    html += `<div class="empty">Xodimlar yo'q. <a href="#/xodimlar">Xodim qo'shing</a>.</div>`;
  }
  for (const r of rows) {
    const top = r.rank === 1 && r.score > 0;
    html += `<div class="cell emp ${top ? 'first' : ''}">${avatar(r)}<div class="nm"><b title="${esc(r.name)}">${esc(r.name)}</b><small>${esc(r.role || '')}</small><span class="score">${Math.round(r.score)} ball · #${r.rank}</span></div>${r.rank <= 3 && r.score > 0 ? medal(r.rank) : ''}</div>`;
    for (const c of COLS) html += `<div class="cell metric ${top ? 'first' : ''}">${mline(c, r.day, false, cur)}${mline(c, r.period, true, cur, d.pace)}</div>`;
  }
  // Jami
  if (rows.length) {
    html += `<div class="cell total emp">${ICON.users}<div><b>JAMI NATIJA</b><small>(${d.totals.count} XODIM)</small></div></div>`;
    for (const c of COLS) html += `<div class="cell total metric">${mline(c, d.totals.day, false, cur)}${mline(c, d.totals.period, true, cur, d.pace)}</div>`;
  }
  html += '</div></div>';
  return html;
}

function footHtml(d) {
  const sy = d.sync;
  const st = (on, ok, err) => (!on ? 'ulanmagan' : err ? 'xato: ' + esc(err) : ok ? 'oxirgi sinx.: ' + localParts(ok).time : 'kutilmoqda');
  const paceNote = d.pace < 1 ? ` · ${PERIOD_LABEL[d.period].toLowerCase()} qatorda rang bugungi kungacha bo'lgan rejaga nisbatan (chiziqcha = ${Math.round(d.pace * 100)}%)` : '';
  return `<div class="footnote">
    <span>OnlinePBX: ${st(sy.pbx, sy.lastOk.pbx, sy.lastError.pbx)}</span>
    <span>amoCRM: ${st(sy.amo, sy.lastOk.amo, sy.lastError.amo)}</span>
    <span>Ranglar: ≥100% yashil · 65–99% sariq · &lt;65% qizil${paceNote}</span>
  </div>`;
}

function updateSyncDot(sy) {
  const dot = $('#syncDot');
  if (!dot || !sy) return;
  const err = (sy.pbx && sy.lastError.pbx) || (sy.amo && sy.lastError.amo);
  dot.className = 'sync-dot ' + (err ? 'err' : sy.pbx || sy.amo ? 'ok' : 'warn');
  dot.title = err ? 'Integratsiya xatosi: ' + err : sy.pbx || sy.amo ? 'Integratsiya ulangan' : 'Integratsiya ulanmagan (Sozlamalar)';
}

async function renderDashboard() {
  const d = await api(dashQuery());
  if (current !== 'dashboard') return;
  tzOffsetH = Number.isFinite(d.tzOffsetHours) ? d.tzOffsetHours : tzOffsetH;
  $('#view').innerHTML = headerHtml(d.settings) + bonusHtml(d) + filtersHtml(d) + boardHtml(d) + footHtml(d);
  bindFilters(renderDashboard);
  updateSyncDot(d.sync);
  maybeAutoSync(d.sync, renderDashboard);
  fitTv();
}

// Ma'lumot eskirgan bo'lsa (serverda fon jarayoni yo'q — masalan Vercel'da), ochiq turgan sahifa
// sinxronizatsiyani o'zi boshlaydi va tugagach ekranni yangilaydi. Server ortiqcha ishlamaydi.
let autoSyncAt = 0;
function maybeAutoSync(sy, rerender) {
  if (!sy?.stale || Date.now() - autoSyncAt < 60000) return;
  autoSyncAt = Date.now();
  fetch('/api/sync/auto', { method: 'POST' })
    .then((r) => (r.ok ? r.json() : null))
    .then((r) => { if (r?.ok && (current === 'dashboard' || current === 'rating') && !ui.date) rerender().catch(() => {}); })
    .catch(() => {});
}

/* ================= TV rejim: butun doskani ekranga sig'dirish ================= */
function fitTv() {
  const m = $('#view');
  const tv = document.body.classList.contains('tv');
  m.style.transform = m.style.width = m.style.marginBottom = '';
  document.body.classList.remove('tv-fit');
  if (!tv) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  // Doska 1100px dan tor bo'lmasin; juda ko'p xodim bo'lsa 0.5 dan kichraymaydi (pastga aylantiriladi)
  const maxZ = vw / 1100, minZ = 0.5;
  let z = 1;
  for (let i = 0; i < 4; i++) {
    m.style.width = vw / z + 'px';
    z = Math.max(minZ, Math.min(maxZ, vh / m.offsetHeight));
  }
  m.style.width = vw / z + 'px';
  m.style.transform = `scale(${z})`;
  m.style.marginBottom = -(m.offsetHeight * (1 - z)) + 'px';
  document.body.classList.toggle('tv-fit', m.offsetHeight * z <= vh + 1);
}
window.addEventListener('resize', () => { if (document.body.classList.contains('tv')) fitTv(); });

/* ================= REYTING ================= */
function spark(trend, cap) {
  if (!trend || trend.length < 2) return '';
  const w = 120, h = 30, max = Math.max(cap, ...trend.map((t) => t.score));
  const pts = trend.map((t, i) => `${((i / (trend.length - 1)) * w).toFixed(1)},${(h - 2 - (t.score / max) * (h - 4)).toFixed(1)}`).join(' ');
  const y100 = (h - 2 - (100 / max) * (h - 4)).toFixed(1);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="0" x2="${w}" y1="${y100}" y2="${y100}" stroke="rgba(255,255,255,.2)" stroke-dasharray="3 3"/><polyline points="${pts}" fill="none" stroke="#3ddc6a" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

async function renderRating() {
  const d = await api(dashQuery());
  if (current !== 'rating') return;
  tzOffsetH = Number.isFinite(d.tzOffsetHours) ? d.tzOffsetHours : tzOffsetH;
  const s = d.settings, cur = s.currency, PL = PERIOD_LABEL[d.period];
  const top = d.rows.slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean);
  const pod = order.map((r) => `<div class="pod p${r.rank}">${medal(r.rank, 48)}${avatar(r)}<b>${esc(r.name)}</b><div class="sub">${esc(r.role || '')}</div>
    <div class="sc">${Math.round(r.score)}</div><div class="sub">reyting ball</div>
    <div class="stats"><span>${ICON.phone.replace('<svg', '<svg width="14" height="14"')} ${intFmt(r.period.values.calls)}</span><span>${money(r.period.values.sales, cur)}</span><span>${fmtVal('conversion', r.period.values.conversion)}</span></div></div>`).join('');

  const rows = d.rows.map((r) => {
    const sc = Math.round(r.score);
    const cell = (k) => `<td class="num">${fmtVal(k, r.period.values[k], cur)}<span class="pctxt c-${pctClass(r.period.pacePct[k])}">${Math.round(r.period.pct[k])}%</span></td>`;
    const bonus = d.dailyBonus.findIndex((w) => w.id === r.id);
    return `<tr>
      <td><span class="rank-badge ${r.rank <= 3 && r.score > 0 ? 'r' + r.rank : ''}">${r.rank}</span></td>
      <td>${avatar(r, 'mini-av')}<b>${esc(r.name)}</b>${bonus >= 0 ? ` <span class="chip">Kunlik bonus ${bonus + 1}-o'rin</span>` : ''}${d.monthLeader?.id === r.id ? ' <span class="chip">👑 Oy lideri</span>' : ''}</td>
      <td><b>${sc}</b><span class="scorebar"><i class="b-${pctClass(r.score)}" style="width:${Math.min(100, (r.score / (s.scoreCap || 150)) * 100)}%"></i></span></td>
      ${cell('calls')}${cell('talkMin')}${cell('script')}${cell('conversion')}${cell('sales')}
      <td>${spark(r.trend, 100)}</td>
    </tr>`;
  }).join('');

  $('#view').innerHTML = `
    <div class="panel"><div class="panel-head"><div><h2>🏆 Xodimlar reytingi — ${PL.toLowerCase()}</h2>
      <div class="hint">Ball = KPI bajarilish foizlarining o'rtachasi (og'irliklar Sozlamalarda; bitta KPI uchun maksimal ${s.scoreCap}%). 100 ball = reja to'liq bajarilmoqda${d.pace < 1 ? ` (davrning o'tgan ${Math.round(d.pace * 100)}% qismiga nisbatan)` : ''}. Kim yaxshi ishlasa — tepaga chiqadi.</div></div></div>
      ${filtersHtml(d, { sort: false })}
    </div>
    ${d.rows.length ? `<div class="podium">${pod}</div>` : ''}
    <div class="panel"><div class="table-wrap"><table class="tbl">
      <thead><tr><th>#</th><th>Xodim</th><th>Ball</th><th class="num">Real aloqa</th><th class="num">Suhbat, min</th><th class="num">Skript</th><th class="num">Konversiya</th><th class="num">Sotuv</th><th>Dinamika</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="9" class="hint">Ma\'lumot yo\'q</td></tr>'}</tbody>
    </table></div></div>`;
  bindFilters(renderRating);
  updateSyncDot(d.sync);
  maybeAutoSync(d.sync, renderRating);
}

/* ================= NATIJA KIRITISH ================= */
let entriesDate = '';
async function renderEntries() {
  if (!isAdmin) return needLogin();
  entriesDate ||= todayStr();
  const [d, s] = await Promise.all([api('/api/entries?date=' + entriesDate), api('/api/settings')]);
  if (current !== 'entries') return;
  const fields = [
    { k: 'calls', l: 'Real aloqa (ta)', auto: (r) => r.auto.calls },
    { k: 'talkMin', l: 'Suhbat (min)', auto: (r) => (r.auto.talkSec != null ? Math.round(r.auto.talkSec / 60) : undefined) },
    { k: 'script', l: 'Skript ball' },
    { k: 'conversion', l: 'Konversiya %', auto: (r) => (s.conversionSource === 'auto' && r.values.conversion != null && r.manual.conversion == null ? r.values.conversion.toFixed(1) : undefined) },
    { k: 'deals', l: 'Sotuvlar soni', auto: (r) => r.auto.deals },
    { k: 'sales', l: `Sotuv summasi (${esc(s.currency)})`, auto: (r) => r.auto.sales },
  ];
  const rows = d.rows.filter((r) => r.active).map((r) => `<tr data-id="${r.employeeId}">
    <td><b>${esc(r.name)}</b></td>
    ${fields.map((f) => {
      const a = f.auto ? f.auto(r) : undefined;
      return `<td><input class="input" type="number" min="0" step="any" data-f="${f.k}" value="${r.manual[f.k] ?? ''}" placeholder="${a !== undefined ? 'avto: ' + a : ''}"></td>`;
    }).join('')}
  </tr>`).join('');
  $('#view').innerHTML = `<div class="panel">
    <div class="panel-head"><div><h2>Natija kiritish</h2>
      <div class="hint">Skript bali, konversiya va sotuv summasini shu yerda qo'lda kiritasiz. Bo'sh qoldirilgan maydonlarda OnlinePBX / amoCRM'dan kelgan avtomatik qiymat ishlatiladi (kulrang "avto" yozuvi). Qo'lda kiritilgan qiymat har doim ustun.</div></div>
      <div style="display:flex;gap:6px;align-items:center"><button class="btn ghost sm" id="ePrev">‹</button><input type="date" class="input" id="eDate" value="${d.date}"><button class="btn ghost sm" id="eNext">›</button></div>
    </div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Xodim</th>${fields.map((f) => `<th>${f.l}</th>`).join('')}</tr></thead><tbody>${rows || '<tr><td colspan="7" class="hint">Faol xodim yo\'q</td></tr>'}</tbody></table></div>
    <div class="form-actions"><button class="btn" id="eSave">Saqlash</button></div>
  </div>`;
  const go = (v) => { entriesDate = v; renderEntries(); };
  $('#eDate').addEventListener('change', (e) => go(e.target.value));
  $('#ePrev').addEventListener('click', () => go(addDays(entriesDate, -1)));
  $('#eNext').addEventListener('click', () => go(addDays(entriesDate, 1)));
  $('#eSave').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    try {
      const out = $$('tbody tr[data-id]').map((tr) => {
        const row = { employeeId: tr.dataset.id };
        $$('input', tr).forEach((i) => (row[i.dataset.f] = i.value));
        return row;
      });
      await api('/api/entries', { method: 'POST', body: { date: entriesDate, rows: out } });
      toast('Saqlandi ✓');
    } catch (e) { toast(e.message, true); } finally { ev.target.disabled = false; }
  });
}

/* ================= XODIMLAR ================= */
async function renderEmployees() {
  if (!isAdmin) return needLogin();
  employeesCache = await api('/api/employees');
  if (current !== 'employees') return;
  $('#view').innerHTML = `<div class="panel">
    <div class="panel-head"><div><h2>Xodimlar</h2><div class="hint">Xodim qo'shish, tahrirlash, o'chirish. OnlinePBX ichki raqami va amoCRM foydalanuvchi ID'si orqali qo'ng'iroqlar va sotuvlar avtomatik bog'lanadi.</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="importEmp" title="amoCRM foydalanuvchilari va OnlinePBX ichki raqamlaridan">⟳ amoCRM / OnlinePBX'dan yuklash</button><button class="btn" id="addEmp">+ Xodim qo'shish</button></div></div>
    <div class="hint" style="margin:-4px 0 12px">Yangi xodimlar har sinxronizatsiyada o'zi qo'shiladi. Bitta odam ikkala tizimda bo'lsa ham bir marta chiqadi (ismi bo'yicha birlashtiriladi). Sotuvchi bo'lmaganlarni (rahbar, buxgalter) o'chirib qo'ying — ular qayta qo'shilmaydi.</div>
    <div id="importResult"></div>
    <div class="emp-cards">${employeesCache.map((e) => `<div class="emp-card ${e.active === false ? 'off' : ''}">${avatar(e)}<div class="info">
      <b>${esc(e.name)}</b>${e.active === false ? ' <span class="chip muted">faol emas</span>' : ''}
      <div class="meta">${esc(e.role || '')}<br>Ichki raqam(lar): <b>${esc((e.extensions || []).join(', ') || '—')}</b><br>amoCRM ID: <b>${esc(e.amoUserId || '—')}</b></div>
      <div class="acts"><button class="btn ghost sm" data-edit="${e.id}">Tahrirlash</button>
      <button class="btn ghost sm" data-toggle="${e.id}">${e.active === false ? 'Faollashtirish' : 'Faolsizlantirish'}</button>
      <button class="btn danger sm" data-del="${e.id}">O'chirish</button></div></div></div>`).join('') || '<div class="hint">Hali xodim yo\'q</div>'}</div>
  </div>`;
  $('#addEmp').addEventListener('click', () => employeeForm());
  $('#importEmp').addEventListener('click', (ev) => withBtn(ev.target, async () => {
    const r = await api('/api/employees/import', { method: 'POST', body: {} });
    const lines = [];
    if (r.added.length) lines.push(`<span class="c-green"><b>Qo'shildi (${r.added.length}):</b></span> ${esc(r.added.join(', '))}`);
    if (r.linked.length) lines.push(`<b>Mavjud xodimga biriktirildi (${r.linked.length}):</b> ${esc(r.linked.join(', '))}`);
    if (r.merged?.length) lines.push(`<b>Takrorlar birlashtirildi (${r.merged.length}):</b> ${esc(r.merged.join(', '))}`);
    if (r.extensions?.length) lines.push(`<span class="c-green"><b>Ichki raqamlar bog'landi:</b></span> ${esc(r.extensions.join(', '))}`);
    if (!r.added.length && !r.linked.length && !r.merged?.length && !r.extensions?.length) lines.push("Yangi xodim topilmadi — ro'yxat allaqachon to'liq.");
    if (r.unlinked?.length) lines.push(`Egasi aniqlanmagan ichki raqamlar: <b>${esc(r.unlinked.join(', '))}</b> — oxirgi 7 kunda ulardan qo'ng'iroq bo'lmagan. Kimniki ekanini bilsangiz, xodimni tahrirlab qo'lda yozing.`);
    const SRC = { amo: 'amoCRM', pbx: 'OnlinePBX', link: "Ichki raqamlarni bog'lash" };
    for (const [src, msg] of Object.entries(r.errors || {})) lines.push(`<span class="c-red">${SRC[src] || src}: ${esc(msg)}</span>`);
    await renderEmployees();
    $('#importResult').innerHTML = `<p class="hint" style="margin:0 0 12px;font-size:13px">${lines.join('<br>')}</p>`;
  }, '#importResult'));
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => employeeForm(employeesCache.find((e) => e.id === b.dataset.edit))));
  $$('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const e = employeesCache.find((x) => x.id === b.dataset.toggle);
    try { await api('/api/employees/' + e.id, { method: 'PUT', body: { active: e.active === false } }); renderEmployees(); } catch (err) { toast(err.message, true); }
  }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const e = employeesCache.find((x) => x.id === b.dataset.del);
    if (!confirm(`"${e.name}" o'chirilsinmi? Uning barcha statistikasi ham o'chadi va u amoCRM / OnlinePBX'dan qayta yuklanmaydi.\n(Statistikani saqlash uchun "Faolsizlantirish"ni tanlang.)`)) return;
    try { await api('/api/employees/' + e.id + '?purge=1', { method: 'DELETE' }); toast("O'chirildi"); renderEmployees(); } catch (err) { toast(err.message, true); }
  }));
}

function resizeImage(file, size = 240) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const k = Math.max(size / img.width, size / img.height);
      const w = img.width * k, h = img.height * k;
      c.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function employeeForm(e = null) {
  let photo = e?.photo || '';
  openModal(`<h2>${e ? 'Xodimni tahrirlash' : 'Yangi xodim'}</h2>
    <div class="form-col">
      <div class="photo-pick"><div id="phPrev">${avatar({ name: e?.name || '?', photo })}</div>
        <div><input type="file" accept="image/*" id="phFile" class="input"><div style="margin-top:6px"><button class="btn ghost sm" id="phClear" type="button">Rasmni olib tashlash</button></div></div></div>
      <label class="field">Ism familiya *<input class="input" id="fName" value="${esc(e?.name || '')}" maxlength="80"></label>
      <label class="field">Lavozim<input class="input" id="fRole" value="${esc(e?.role ?? 'Sotuv menejer')}" maxlength="80"></label>
      <label class="field">OnlinePBX ichki raqam(lar)i<input class="input" id="fExt" value="${esc((e?.extensions || []).join(', '))}" placeholder="masalan: 101, 102"><span class="hint">Bir nechta bo'lsa vergul bilan. Raqamlarni Sozlamalar → "OnlinePBX'ni tekshirish" orqali ko'rish mumkin.</span></label>
      <label class="field">amoCRM foydalanuvchi ID<input class="input" id="fAmo" value="${esc(e?.amoUserId || '')}" placeholder="masalan: 1234567"><span class="hint">Sozlamalar → "amoCRM'ni tekshirish" foydalanuvchilar ro'yxatini ID bilan ko'rsatadi.</span></label>
      <label style="display:flex;gap:8px;align-items:center;font-weight:600"><input type="checkbox" id="fActive" ${e?.active === false ? '' : 'checked'}> Faol (dashboardda ko'rinadi)</label>
    </div>
    <div class="form-actions"><button class="btn ghost" id="fCancel">Bekor qilish</button><button class="btn" id="fSave">Saqlash</button></div>`);
  $('#phFile').addEventListener('change', async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    try { photo = await resizeImage(f); $('#phPrev').innerHTML = avatar({ name: '', photo }); } catch { toast("Rasmni o'qib bo'lmadi", true); }
  });
  $('#phClear').addEventListener('click', () => { photo = ''; $('#phPrev').innerHTML = avatar({ name: $('#fName').value || '?' }); });
  $('#fCancel').addEventListener('click', closeModal);
  $('#fSave').addEventListener('click', async (ev) => {
    const body = { name: $('#fName').value, role: $('#fRole').value, extensions: $('#fExt').value, amoUserId: $('#fAmo').value, active: $('#fActive').checked, photo };
    ev.target.disabled = true;
    try {
      await api(e ? '/api/employees/' + e.id : '/api/employees', { method: e ? 'PUT' : 'POST', body });
      closeModal(); toast('Saqlandi ✓'); renderEmployees();
    } catch (err) { toast(err.message, true); ev.target.disabled = false; }
  });
}

/* ================= SOZLAMALAR ================= */
async function renderSettings() {
  if (!isAdmin) return needLogin();
  const s = await api('/api/settings');
  if (current !== 'settings') return;
  const num = (id, v, step = 'any') => `<input class="input" type="number" min="0" step="${step}" id="${id}" value="${v ?? ''}">`;
  const txt = (id, v, ph = '') => `<input class="input" id="${id}" value="${esc(v ?? '')}" placeholder="${esc(ph)}">`;
  const kpiNames = { calls: "Real aloqa (ta)", talkMin: 'Suhbat vaqti (min)', script: 'Skript bali', conversion: 'Konversiya (%)', sales: `Sotuv summasi (${esc(s.currency)})` };
  const t = todayStr();
  $('#view').innerHTML = `
  ${defaultPassword ? `<div class="panel warn"><b>⚠️ Admin parol hali standart ("admin").</b> Tarmoqdagi istalgan kishi kirib, ma'lumotlarni o'zgartira oladi — pastdagi "Admin parol" bo'limida uni almashtiring.</div>` : ''}
  <div class="panel"><h2>KPI plan va bonuslar</h2>
    <h3>Kunlik plan (har bir xodim uchun)</h3>
    <div class="grid-form">${Object.entries(kpiNames).map(([k, l]) => `<label class="field">${l}${num('p_' + k, s.plans[k])}</label>`).join('')}</div>
    <h3>Ish kunlari</h3>
    <div class="grid-form">
      <label class="field">Oyda ish kuni${num('workDaysPerMonth', s.workDaysPerMonth, 1)}</label>
      <label class="field">Haftada ish kuni${num('workDaysPerWeek', s.workDaysPerWeek, 1)}</label>
      <div class="field" style="grid-column: span 2">Dam olish kunlari (oraliq va dinamika uchun)<div class="checks" id="daysOff">${WEEKDAYS.map((w, i) => `<label><input type="checkbox" value="${i}" ${s.daysOff.includes(i) ? 'checked' : ''}>${w.toLowerCase()}</label>`).join('')}</div></div>
    </div>
    <h3>Bonuslar va sarlavhalar</h3>
    <div class="grid-form">
      <label class="field">Kunlik bonus${txt('dailyBonus', s.dailyBonus)}</label>
      <label class="field">Kunlik bonus izohi${txt('dailyBonusText', s.dailyBonusText)}</label>
      <label class="field">Oylik bonus izohi${txt('monthlyBonusText', s.monthlyBonusText)}</label>
      <label class="field">Kompaniya nomi${txt('companyName', s.companyName)}</label>
      <label class="field">Logo ostidagi yozuv${txt('companyTagline', s.companyTagline)}</label>
      <label class="field">Sarlavha${txt('title', s.title)}</label>
      <label class="field">Kichik sarlavha${txt('subtitle', s.subtitle)}</label>
      <label class="field">Valyuta belgisi${txt('currency', s.currency)}</label>
    </div>
    <h3>Reyting hisoblash</h3>
    <div class="grid-form">${Object.entries(kpiNames).map(([k, l]) => `<label class="field">Og'irlik: ${l.replace(/ \(.*\)/, '')}${num('w_' + k, s.weights[k])}</label>`).join('')}
      <label class="field">Bitta KPI uchun maks. foiz${num('scoreCap', s.scoreCap)}</label></div>
    <h3>Hisoblash qoidalari</h3>
    <div class="grid-form">
      <label class="field">Real aloqa: suhbat kamida (sekund)${num('minTalkSec', s.minTalkSec, 1)}</label>
      <label class="field">Hisoblanadigan qo'ng'iroqlar<select class="input" id="callDirection">
        <option value="all" ${s.callDirection === 'all' ? 'selected' : ''}>Hammasi (kiruvchi + chiquvchi)</option>
        <option value="outbound" ${s.callDirection === 'outbound' ? 'selected' : ''}>Faqat chiquvchi</option>
        <option value="inbound" ${s.callDirection === 'inbound' ? 'selected' : ''}>Faqat kiruvchi</option></select></label>
      <label class="field">Konversiya manbai<select class="input" id="conversionSource">
        <option value="manual" ${s.conversionSource === 'manual' ? 'selected' : ''}>Qo'lda kiritiladi</option>
        <option value="auto" ${s.conversionSource === 'auto' ? 'selected' : ''}>Avto: sotuvlar soni / real aloqa</option></select></label>
      <label class="field">Avto-sinxronizatsiya (daqiqa)${num('syncMinutes', s.syncMinutes, 1)}</label>
    </div>
    <div class="form-actions"><button class="btn" id="saveMain">Saqlash</button></div>
  </div>

  <div class="panel"><h2>OnlinePBX (qo'ng'iroqlar)</h2>
    <div class="hint">API kalitni olish: <code>panel.onlinepbx.ru</code> → Sozlamalar / Integratsiya → <b>API</b> → kalit yaratish. Har bir xodimga uning ichki raqamini (Xodimlar bo'limida) yozing.${s.pbx.fromEnv ? '<br>⚠️ Qiymatlar .env faylidan olinmoqda (u ustun).' : ''}</div>
    <div class="grid-form" style="margin-top:10px">
      <label class="field">Domen${txt('pbxDomain', s.pbx.domain, 'pbx12345.onpbx.ru')}</label>
      <label class="field">API kalit ${s.pbx.hasApiKey ? '(saqlangan ✓)' : ''}<input class="input" type="password" id="pbxKey" placeholder="${s.pbx.hasApiKey ? '•••••• (o\'zgartirish uchun yangisini kiriting)' : 'API kalit'}" autocomplete="off"></label>
      <label class="field">API manzil${txt('pbxBase', s.pbx.baseUrl)}</label>
    </div>
    <div class="form-actions"><button class="btn ghost" id="testPbx">OnlinePBX'ni tekshirish</button><button class="btn" id="savePbx">Saqlash</button></div>
    <div id="pbxResult"></div>
  </div>

  <div class="panel"><h2>amoCRM (sotuvlar)</h2>
    <div class="hint">Token olish: amoCRM → <b>amoMarket</b> → ⋯ → <b>Integratsiya yaratish</b> (xususiy) → "Kalitlar va kirish" → <b>Uzoq muddatli token</b>. Yutilgan bitimlar (status 142 "Muvaffaqiyatli") yopilgan sanasi bo'yicha mas'ul xodimga yoziladi, summa = bitim byudjeti.${s.amo.fromEnv ? '<br>⚠️ Qiymatlar .env faylidan olinmoqda (u ustun).' : ''}</div>
    <div class="grid-form" style="margin-top:10px">
      <label class="field">Subdomen (bo'sh qolsa, tokendan aniqlanadi)${txt('amoSub', s.amo.subdomain, 'avtomatik')}</label>
      <label class="field">Domen<select class="input" id="amoBase">${['amocrm.ru', 'amocrm.com', 'kommo.com'].map((x) => `<option ${s.amo.baseDomain === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="field">Uzoq muddatli token ${s.amo.hasToken ? `(saqlangan ✓${s.amo.tokenExpires ? ', ' + shortDate(localParts(s.amo.tokenExpires * 1000).date) + ' gacha' : ''})` : ''}<input class="input" type="password" id="amoToken" placeholder="${s.amo.hasToken ? '•••••• (o\'zgartirish uchun yangisini kiriting)' : 'token'}" autocomplete="off"></label>
      <label class="field">Voronka ID (ixtiyoriy)${txt('amoPipe', s.amo.pipelineId, 'hammasi')}</label>
      <label class="field">"Yutildi" status ID${num('amoWon', s.amo.wonStatusId, 1)}</label>
    </div>
    <div class="form-actions"><button class="btn ghost" id="testAmo">amoCRM'ni tekshirish</button><button class="btn" id="saveAmo">Saqlash</button></div>
    <div id="amoResult"></div>
  </div>

  <div class="panel"><h2>Sinxronizatsiya</h2>
    <div class="hint">Bugungi va kechagi ma'lumotlar har ${s.syncMinutes} daqiqada avtomatik yangilanadi. Eski davrni (masalan, butun oy) yuklash uchun oraliqni tanlang.</div>
    <div class="grid-form" style="margin-top:10px;align-items:end">
      <label class="field">Dan<input type="date" class="input" id="syFrom" value="${t.slice(0, 8)}01"></label>
      <label class="field">Gacha<input type="date" class="input" id="syTo" value="${t}"></label>
      <div><button class="btn" id="syncBtn">Hozir sinxronlash</button></div>
    </div>
    <div id="syncResult"></div>
  </div>

  <div class="panel"><h2>Zaxira nusxa va ko'chirish</h2>
    <div class="hint">Butun ma'lumot (sozlamalar, ulangan kalitlar, xodimlar, statistika) bitta faylga yuklab olinadi. Shu fayl orqali ma'lumotni boshqa joyga — masalan, kompyuterdan Vercel'dagi saytga — ko'chirish mumkin. <b>Faylda kalitlar bor: uni hech kimga yubormang.</b></div>
    <div class="form-actions" style="justify-content:flex-start"><button class="btn ghost" id="backupBtn">⬇ Zaxira nusxani yuklab olish</button>
      <label class="btn ghost" style="cursor:pointer">⬆ Fayldan tiklash<input type="file" id="restoreFile" accept="application/json,.json" hidden></label></div>
    <div id="backupResult"></div>
  </div>

  <div class="panel"><h2>Admin parol</h2>
    <div class="hint">Parol shu kompyuterda shifrlangan holda saqlanadi. Unutib qo'ysangiz: dasturni to'xtating, <code>data/db.json</code> faylidan <code>"auth"</code> qismini o'chiring — parol yana <code>.env</code> dagi <code>ADMIN_PASSWORD</code> bo'ladi.</div>
    <form id="passF" class="grid-form" style="margin-top:10px;align-items:end">
      <label class="field">Joriy parol<input class="input" type="password" id="pwCur" autocomplete="current-password"></label>
      <label class="field">Yangi parol (kamida 6 belgi)<input class="input" type="password" id="pwNew" autocomplete="new-password"></label>
      <label class="field">Yangi parol (takror)<input class="input" type="password" id="pwNew2" autocomplete="new-password"></label>
      <div><button class="btn" type="submit">Parolni o'zgartirish</button></div>
    </form>
  </div>`;

  $('#backupBtn').addEventListener('click', (ev) => withBtn(ev.target, async () => {
    const data = await api('/api/backup');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `uzgrow-dashboard-${todayStr()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    $('#backupResult').innerHTML = `<p class="hint">Yuklab olindi: ${data.employees.length} xodim, ${Object.keys(data.auto).length} kunlik statistika.</p>`;
  }, '#backupResult'));
  $('#restoreFile').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const body = JSON.parse(await file.text());
      if (!confirm(`"${file.name}" faylidan tiklansinmi?\nHozirgi barcha ma'lumot (sozlamalar, xodimlar, statistika, admin parol) shu fayldagisi bilan almashtiriladi.`)) return;
      const r = await api('/api/restore', { method: 'POST', body });
      token = r.token; localStorage.setItem('uzg.token', token);
      toast(`Tiklandi ✓ (${r.employees} xodim)`); renderSettings();
    } catch (e) { $('#backupResult').innerHTML = `<p class="c-red"><b>✗ ${esc(e instanceof SyntaxError ? "Fayl JSON emas" : e.message)}</b></p>`; }
  });

  $('#passF').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if ($('#pwNew').value !== $('#pwNew2').value) return toast('Yangi parollar bir xil emas', true);
    try {
      const r = await api('/api/password', { method: 'POST', body: { current: $('#pwCur').value, next: $('#pwNew').value } });
      token = r.token; localStorage.setItem('uzg.token', token); defaultPassword = false;
      toast("Parol o'zgartirildi ✓"); renderSettings();
    } catch (e) { toast(e.message, true); }
  });

  const n = (id) => $('#' + id).value;
  $('#saveMain').addEventListener('click', () => saveSettings({
    plans: Object.fromEntries(Object.keys(kpiNames).map((k) => [k, n('p_' + k)])),
    weights: Object.fromEntries(Object.keys(kpiNames).map((k) => [k, n('w_' + k)])),
    workDaysPerMonth: n('workDaysPerMonth'), workDaysPerWeek: n('workDaysPerWeek'),
    daysOff: $$('#daysOff input:checked').map((o) => Number(o.value)),
    dailyBonus: n('dailyBonus'), dailyBonusText: n('dailyBonusText'), monthlyBonusText: n('monthlyBonusText'),
    companyName: n('companyName'), companyTagline: n('companyTagline'), title: n('title'), subtitle: n('subtitle'), currency: n('currency'),
    scoreCap: n('scoreCap'), minTalkSec: n('minTalkSec'), callDirection: n('callDirection'), conversionSource: n('conversionSource'), syncMinutes: n('syncMinutes'),
  }));
  const pbxBody = () => ({ pbx: { domain: n('pbxDomain'), apiKey: n('pbxKey'), baseUrl: n('pbxBase') } });
  const amoBody = () => ({ amo: { subdomain: n('amoSub'), baseDomain: n('amoBase'), token: n('amoToken'), pipelineId: n('amoPipe'), wonStatusId: n('amoWon') } });
  $('#savePbx').addEventListener('click', () => saveSettings(pbxBody()));
  $('#saveAmo').addEventListener('click', () => saveSettings(amoBody()));

  $('#testPbx').addEventListener('click', (ev) => withBtn(ev.target, async () => {
    await api('/api/settings', { method: 'PUT', body: pbxBody() });
    const r = await api('/api/test/pbx', { method: 'POST' });
    const nums = Object.entries(r.internalNumbers).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', ');
    $('#pbxResult').innerHTML = `<p class="c-green"><b>✓ Ulandi.</b> Bugun ${r.todayCalls} ta qo'ng'iroq.</p>
      <p class="hint">Qo'ng'iroqlarda uchragan qisqa (ichki) raqamlar: <b>${esc(nums || '—')}</b></p>
      ${r.sample ? `<details><summary class="hint">Namuna qo'ng'iroq (JSON)</summary><pre class="code">${esc(JSON.stringify(r.sample, null, 2))}</pre></details>` : ''}`;
  }, '#pbxResult'));
  $('#testAmo').addEventListener('click', (ev) => withBtn(ev.target, async () => {
    await api('/api/settings', { method: 'PUT', body: amoBody() });
    const r = await api('/api/test/amo', { method: 'POST' });
    // subdomen tokendan avtomatik aniqlangan bo'lishi mumkin — maydonni yangilaymiz
    const saved = await api('/api/settings');
    $('#amoSub').value = saved.amo.subdomain; $('#amoBase').value = saved.amo.baseDomain; $('#amoToken').value = '';
    $('#amoResult').innerHTML = `<p class="c-green"><b>✓ Ulandi.</b></p>
      <h3>Foydalanuvchilar (ID → Xodimlar bo'limiga yozing)</h3>
      <div class="table-wrap"><table class="tbl" style="min-width:0"><tr><th>ID</th><th>Ism</th><th>Email</th></tr>${r.users.map((u) => `<tr><td><b>${u.id}</b></td><td>${esc(u.name)}</td><td>${esc(u.email || '')}</td></tr>`).join('')}</table></div>
      <h3>Voronkalar</h3>
      ${r.pipelines.map((p) => `<p class="hint"><b>${esc(p.name)}</b> — ID <b>${p.id}</b><br>${p.statuses.map((x) => `${esc(x.name)} (${x.id})`).join(' · ')}</p>`).join('')}`;
  }, '#amoResult'));
  $('#syncBtn').addEventListener('click', (ev) => withBtn(ev.target, async () => {
    const r = await api('/api/sync', { method: 'POST', body: { from: n('syFrom'), to: n('syTo') } });
    const fmt = (x, name) => (!x ? `${name}: ulanmagan` : x.ok ? `${name}: ✓ (${x.calls ?? x.leads} ta yozuv)` : `${name}: ✗ ${esc(x.error)}`);
    $('#syncResult').innerHTML = `<p class="hint">${fmt(r.pbx, 'OnlinePBX')}<br>${fmt(r.amo, 'amoCRM')}</p>`;
  }, '#syncResult'));
}

async function saveSettings(body) {
  try { await api('/api/settings', { method: 'PUT', body }); toast('Saqlandi ✓'); renderSettings(); } catch (e) { toast(e.message, true); }
}
async function withBtn(btn, fn, resultSel) {
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = 'Kuting...';
  try { await fn(); } catch (e) { if (resultSel) $(resultSel).innerHTML = `<p class="c-red"><b>✗ ${esc(e.message)}</b></p>`; else toast(e.message, true); } finally { btn.disabled = false; btn.textContent = old; }
}

/* ================= modal / auth ================= */
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }
$('#modalX').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function needLogin() {
  $('#view').innerHTML = `<div class="panel" style="max-width:480px;margin:40px auto;text-align:center"><h2>Admin bo'limi</h2><p class="hint">Bu bo'lim uchun admin parol bilan kiring.</p><button class="btn" id="needLoginBtn">Kirish</button></div>`;
  $('#needLoginBtn').addEventListener('click', loginForm);
}

function loginForm() {
  openModal(`<h2>Admin kirish</h2><form id="loginF" class="form-col"><label class="field">Parol<input class="input" type="password" id="lPass" autofocus></label>
    <div class="form-actions"><button class="btn" type="submit">Kirish</button></div></form>`);
  $('#lPass').focus();
  $('#loginF').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/login', { method: 'POST', body: { password: $('#lPass').value } });
      token = r.token; localStorage.setItem('uzg.token', token); isAdmin = true; defaultPassword = Boolean(r.defaultPassword);
      updateAuthBtn(); closeModal(); route();
      if (defaultPassword) toast('Parol hali standart ("admin") — Sozlamalarda o\'zgartiring!', true); else toast('Xush kelibsiz!');
    } catch (err) { toast(err.message, true); }
  });
}

function updateAuthBtn() { $('#authBtn').textContent = isAdmin ? 'Chiqish' : 'Kirish'; }
$('#authBtn').addEventListener('click', () => {
  if (isAdmin) { token = ''; isAdmin = false; localStorage.removeItem('uzg.token'); updateAuthBtn(); route(); }
  else loginForm();
});
function setTv(on) {
  document.body.classList.toggle('tv', on);
  if (on) { ui.date = ''; closeModal(); }
  if (on && current !== 'dashboard') location.hash = '#/'; else if (current === 'dashboard') fitTv();
}
$('#tvBtn').addEventListener('click', () => {
  setTv(true);
  document.documentElement.requestFullscreen?.().catch(() => {});
  toast('TV rejimdan chiqish: Esc yoki ekranni ikki marta bosing');
});
document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement) fitTv(); else setTv(false); });
document.addEventListener('dblclick', () => { if (document.body.classList.contains('tv')) { setTv(false); document.exitFullscreen?.().catch(() => {}); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('tv') && !document.fullscreenElement) setTv(false); });

/* ================= router ================= */
const VIEWS = { '': 'dashboard', reyting: 'rating', kiritish: 'entries', xodimlar: 'employees', sozlamalar: 'settings' };
const RENDER = { dashboard: renderDashboard, rating: renderRating, entries: renderEntries, employees: renderEmployees, settings: renderSettings };
let current = '';

async function route() {
  const key = location.hash.replace(/^#\/?/, '').split('?')[0];
  current = VIEWS[key] || 'dashboard';
  $$('.nav-links a').forEach((a) => a.classList.toggle('active', a.dataset.view === current));
  try {
    if (current === 'dashboard' || current === 'rating') employeesCache = await api('/api/employees');
    await RENDER[current]();
  } catch (e) {
    $('#view').innerHTML = `<div class="panel"><h2>Xatolik</h2><p class="c-red">${esc(e.message)}</p></div>`;
  }
}
window.addEventListener('hashchange', route);

// Soat va avtomatik yangilanish
setInterval(() => {
  const n = nowParts();
  const c = $('#clock');
  if (c) c.textContent = n.time;
  const ld = longDate(n.date);
  if ($('#hdrDate')) { $('#hdrDate').textContent = ld.day; $('#hdrWd').textContent = ld.wd; }
}, 1000);
refreshTimer = setInterval(() => {
  const menuOpen = $('#empMenu') && !$('#empMenu').hidden;
  if ((current === 'dashboard' || current === 'rating') && !menuOpen && $('#modal').hidden && !ui.date) RENDER[current]().catch(() => {});
}, 60000);

(async function init() {
  try {
    const me = token ? await api('/api/me') : {};
    isAdmin = Boolean(me.admin); defaultPassword = Boolean(me.defaultPassword);
  } catch { isAdmin = false; }
  // "#/?tv" manzili — televizor uchun: sahifa darhol TV rejimda ochiladi
  if (/[?&]tv\b/.test(location.hash) || /[?&]tv\b/.test(location.search)) document.body.classList.add('tv');
  if (!isAdmin && token) { token = ''; localStorage.removeItem('uzg.token'); }
  updateAuthBtn();
  route();
})();
