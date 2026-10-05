'use strict';

if (Number(process.versions.node.split('.')[0]) < 18) {
  console.error(`XATO: Node.js 18 yoki undan yangi versiya kerak (sizda ${process.version}). https://nodejs.org dan LTS versiyani o'rnating.`);
  process.exit(1);
}

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- .env (qo'shimcha kutubxonasiz) ---
(function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

const db = require('./lib/db');
const D = require('./lib/dates');
const stats = require('./lib/stats');
const sync = require('./lib/sync');
const pbx = require('./lib/pbx');
const amo = require('./lib/amo');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const PUBLIC = path.join(__dirname, 'public');
const MAX_BODY = 3 * 1024 * 1024;

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest();
// Uzunligi har xil satrlarni ham vaqt bo'yicha xavfsiz solishtirish
const safeEqual = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));

// Admin parol: Sozlamalarda o'zgartirilgan bo'lsa db.json'dagi xesh, aks holda .env dagi ADMIN_PASSWORD
function checkPassword(password) {
  const auth = db.get().auth;
  if (auth?.hash) {
    const hash = crypto.scryptSync(String(password), Buffer.from(auth.salt, 'hex'), 32);
    return crypto.timingSafeEqual(hash, Buffer.from(auth.hash, 'hex'));
  }
  return safeEqual(password, ADMIN_PASSWORD);
}
function adminToken() {
  const auth = db.get().auth;
  return sha256('uzgrow-dashboard:' + (auth?.hash ? 'h:' + auth.hash : 'p:' + ADMIN_PASSWORD)).toString('hex');
}
const isDefaultPassword = () => !db.get().auth?.hash && ADMIN_PASSWORD === 'admin';

// Parolni tanlab topishga qarshi: bitta IP'dan ketma-ket xato urinishlar cheklanadi
const LOGIN_MAX_FAILS = 8;
const LOGIN_LOCK_MS = 5 * 60 * 1000;
const loginFails = new Map(); // ip -> { n, until }

// ---------- yordamchilar ----------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "So'rov juda katta"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reject(new HttpError(400, "JSON noto'g'ri"));
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reject(new HttpError(400, "So'rov obyekt bo'lishi kerak"));
      resolve(body);
    });
    req.on('error', reject);
  });
}

function isAdmin(req) {
  const h = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return Boolean(h) && safeEqual(h, adminToken());
}

function loginGuard(ip) {
  const f = loginFails.get(ip);
  if (f && Date.now() >= f.until) loginFails.delete(ip);
  else if (f && f.n >= LOGIN_MAX_FAILS) throw new HttpError(429, "Juda ko'p xato urinish. 5 daqiqadan keyin qayta urinib ko'ring.");
}
function loginFailed(ip) {
  if (loginFails.size > 5000) loginFails.clear();
  const f = loginFails.get(ip) || { n: 0, until: 0 };
  f.n++;
  f.until = Date.now() + LOGIN_LOCK_MS;
  loginFails.set(ip, f);
}

function requireAdmin(req) {
  if (!isAdmin(req)) throw new HttpError(401, 'Admin sifatida kiring');
}

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const optNum = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? undefined : Number(v));

function cleanEmployee(body, existing = {}) {
  const e = { ...existing };
  if (body.name !== undefined) e.name = str(body.name, 80);
  if (body.role !== undefined) e.role = str(body.role, 80);
  if (body.photo !== undefined) {
    const p = String(body.photo || '');
    if (p && !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(p) && !/^https?:\/\//.test(p)) throw new HttpError(400, 'Rasm formati noto\'g\'ri');
    if (p.length > 600000) throw new HttpError(400, 'Rasm juda katta');
    e.photo = p;
  }
  if (body.extensions !== undefined) {
    const list = Array.isArray(body.extensions) ? body.extensions : String(body.extensions).split(/[,\s;]+/);
    e.extensions = [...new Set(list.map((x) => str(x, 30)).filter(Boolean))];
  }
  if (body.amoUserId !== undefined) e.amoUserId = str(body.amoUserId, 30);
  if (body.active !== undefined) e.active = Boolean(body.active);
  if (!e.name) throw new HttpError(400, 'Xodim ismi kerak');
  return e;
}

function publicSettings(settings) {
  const s = JSON.parse(JSON.stringify(settings));
  const p = pbx.cfgFrom(settings);
  const a = amo.cfgFrom(settings);
  s.pbx = {
    domain: p.domain, baseUrl: p.baseUrl, apiKey: '', hasApiKey: Boolean(p.apiKey),
    fromEnv: Boolean(process.env.PBX_API_KEY || process.env.PBX_DOMAIN),
  };
  s.amo = {
    subdomain: a.subdomain, baseDomain: a.baseDomain, pipelineId: a.pipelineId, wonStatusId: a.wonStatusId,
    token: '', hasToken: Boolean(a.token), tokenExpires: a.token ? amo.tokenInfo(a.token)?.exp || 0 : 0, fromEnv: Boolean(process.env.AMO_TOKEN || process.env.AMO_SUBDOMAIN),
  };
  return s;
}

const AMO_DOMAINS = ['amocrm.ru', 'amocrm.com', 'kommo.com'];

function applySettings(current, body) {
  const s = JSON.parse(JSON.stringify(current));
  for (const k of ['companyName', 'companyTagline', 'title', 'subtitle', 'currency', 'dailyBonus', 'dailyBonusText', 'monthlyBonusText']) {
    if (body[k] !== undefined) s[k] = str(body[k], 200);
  }
  for (const k of ['workDaysPerMonth', 'workDaysPerWeek', 'scoreCap', 'minTalkSec', 'syncMinutes']) {
    const v = optNum(body[k]);
    if (v !== undefined && v >= 0) s[k] = v;
  }
  if (Array.isArray(body.daysOff)) s.daysOff = [...new Set(body.daysOff.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  if (['all', 'outbound', 'inbound'].includes(body.callDirection)) s.callDirection = body.callDirection;
  if (['manual', 'auto'].includes(body.conversionSource)) s.conversionSource = body.conversionSource;
  for (const group of ['plans', 'weights']) {
    if (body[group] && typeof body[group] === 'object') {
      for (const k of stats.KPIS) {
        const v = optNum(body[group][k]);
        if (v !== undefined && v >= 0) s[group][k] = v;
      }
    }
  }
  if (body.pbx && typeof body.pbx === 'object') {
    if (body.pbx.domain !== undefined) {
      const domain = str(body.pbx.domain, 100).replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
      if (domain && !/^[a-z0-9.-]+$/.test(domain)) throw new HttpError(400, "OnlinePBX domeni noto'g'ri (masalan: pbx12345.onpbx.ru)");
      s.pbx.domain = domain;
    }
    if (body.pbx.baseUrl) {
      const baseUrl = str(body.pbx.baseUrl, 200).replace(/\/+$/, '');
      if (!/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(baseUrl)) throw new HttpError(400, 'OnlinePBX API manzili https:// bilan boshlanishi kerak');
      s.pbx.baseUrl = baseUrl;
    }
    if (body.pbx.apiKey) s.pbx.apiKey = str(body.pbx.apiKey, 300);
    if (body.pbx.clearApiKey) s.pbx.apiKey = '';
  }
  if (body.amo && typeof body.amo === 'object') {
    if (body.amo.subdomain !== undefined) {
      const sub = str(body.amo.subdomain, 100).replace(/^https?:\/\//, '').replace(/[./].*$/, '').toLowerCase();
      if (sub && !/^[a-z0-9-]+$/.test(sub)) throw new HttpError(400, "amoCRM subdomeni noto'g'ri (masalan: uzgrow)");
      s.amo.subdomain = sub;
    }
    if (body.amo.baseDomain) {
      const baseDomain = str(body.amo.baseDomain, 50).toLowerCase();
      if (!AMO_DOMAINS.includes(baseDomain)) throw new HttpError(400, 'amoCRM domeni faqat: ' + AMO_DOMAINS.join(', '));
      s.amo.baseDomain = baseDomain;
    }
    if (body.amo.pipelineId !== undefined) s.amo.pipelineId = str(body.amo.pipelineId, 30);
    const ws = optNum(body.amo.wonStatusId);
    if (ws) s.amo.wonStatusId = ws;
    if (body.amo.token) {
      s.amo.token = str(body.amo.token, 4000).replace(/^Bearer\s+/i, '');
      // Token qaysi domenga tegishli ekanini o'zi biladi (amocrm.ru / amocrm.com / kommo.com)
      const tokenDomain = amo.tokenInfo(s.amo.token)?.baseDomain;
      if (AMO_DOMAINS.includes(tokenDomain)) s.amo.baseDomain = tokenDomain;
    }
    if (body.amo.clearToken) s.amo.token = '';
  }
  return s;
}

// Token bor, lekin subdomen yo'q bo'lsa — subdomenni amoCRM'dan avtomatik aniqlab saqlaymiz
async function ensureAmoSubdomain(state) {
  const c = amo.cfgFrom(state.settings);
  if (c.subdomain || !c.token) return;
  state.settings.amo.subdomain = await amo.detectSubdomain(state.settings);
  db.saveNow('core');
}

// ---------- API ----------
async function api(req, res, url) {
  const state = db.get();
  const route = `${req.method} ${url.pathname}`;
  const q = Object.fromEntries(url.searchParams);

  if (route === 'POST /api/login') {
    // Internetga ochiq muhitda standart "admin" paroli bilan kirishga yo'l qo'yilmaydi
    if (db.SERVERLESS && isDefaultPassword()) {
      throw new HttpError(403, "Admin parol o'rnatilmagan. Vercel'da: Settings -> Environment Variables -> ADMIN_PASSWORD qo'shing va qayta deploy qiling.");
    }
    // x-forwarded-for faqat Vercel ortida ishonchli (kompyuterda uni istalgan kishi soxtalashtira oladi)
    const ip = (db.SERVERLESS && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
    loginGuard(ip);
    const body = await readBody(req);
    if (!checkPassword(String(body.password ?? ''))) {
      loginFailed(ip);
      throw new HttpError(401, "Parol noto'g'ri");
    }
    loginFails.delete(ip);
    return send(res, 200, { token: adminToken(), defaultPassword: isDefaultPassword() });
  }
  if (route === 'GET /api/me') {
    const admin = isAdmin(req);
    return send(res, 200, { admin, defaultPassword: admin && isDefaultPassword() });
  }
  if (route === 'POST /api/password') {
    requireAdmin(req);
    const body = await readBody(req);
    if (!checkPassword(String(body.current ?? ''))) throw new HttpError(400, "Joriy parol noto'g'ri");
    const next = String(body.next ?? '');
    if (next.length < 6 || next.length > 200) throw new HttpError(400, "Yangi parol kamida 6 ta belgidan iborat bo'lsin");
    const salt = crypto.randomBytes(16);
    state.auth = { salt: salt.toString('hex'), hash: crypto.scryptSync(next, salt, 32).toString('hex') };
    db.saveNow('core');
    return send(res, 200, { token: adminToken() });
  }

  if (route === 'GET /api/dashboard') {
    const ids = q.ids ? q.ids.split(',').filter(Boolean) : null;
    const data = stats.dashboard(state, { date: q.date, period: q.period, from: q.from, to: q.to, ids });
    return send(res, 200, {
      ...data,
      today: D.today(),
      tzOffsetHours: D.OFFSET_H,
      settings: publicSettings(state.settings),
      sync: { ...sync.status, stale: sync.isStale(), pbx: pbx.isConfigured(state.settings), amo: amo.isConfigured(state.settings) },
    });
  }

  if (route === 'GET /api/settings') return send(res, 200, publicSettings(state.settings));
  if (route === 'PUT /api/settings') {
    requireAdmin(req);
    state.settings = applySettings(state.settings, await readBody(req));
    db.saveNow('core');
    // aniqlab bo'lmasa saqlash to'xtamaydi — sababi "amoCRM'ni tekshirish"da ko'rsatiladi
    await ensureAmoSubdomain(state).catch(() => {});
    sync.startScheduler();
    return send(res, 200, publicSettings(state.settings));
  }

  if (route === 'GET /api/employees') {
    const admin = isAdmin(req);
    return send(res, 200, state.employees.map((e) => (admin ? e : { id: e.id, name: e.name, role: e.role, photo: e.photo, active: e.active })));
  }
  if (route === 'POST /api/employees') {
    requireAdmin(req);
    const e = cleanEmployee(await readBody(req), { id: db.newId(), extensions: [], amoUserId: '', photo: '', role: 'Sotuv menejer', active: true, createdAt: new Date().toISOString() });
    state.employees.push(e);
    db.saveNow('core');
    return send(res, 201, e);
  }
  if (route === 'POST /api/employees/import') {
    requireAdmin(req);
    const body = await readBody(req);
    if (!pbx.isConfigured(state.settings) && !amo.isConfigured(state.settings)) {
      throw new HttpError(400, 'Avval Sozlamalarda amoCRM yoki OnlinePBX ni ulang');
    }
    db.hold();
    try {
      return send(res, 200, await sync.importRoster({ force: body.force === true, manual: true }));
    } finally {
      db.release();
    }
  }
  const empMatch = url.pathname.match(/^\/api\/employees\/([a-z0-9]+)$/);
  if (empMatch) {
    requireAdmin(req);
    const idx = state.employees.findIndex((e) => e.id === empMatch[1]);
    if (idx < 0) throw new HttpError(404, 'Xodim topilmadi');
    if (req.method === 'PUT') {
      state.employees[idx] = cleanEmployee(await readBody(req), state.employees[idx]);
      db.saveNow('core');
      return send(res, 200, state.employees[idx]);
    }
    if (req.method === 'DELETE') {
      const [removed] = state.employees.splice(idx, 1);
      if (q.purge === '1') {
        for (const bucket of [state.entries, state.auto]) for (const d of Object.keys(bucket)) delete bucket[d][removed.id];
      }
      db.saveNow();
      return send(res, 200, { ok: true });
    }
  }

  if (route === 'GET /api/entries') {
    requireAdmin(req);
    const date = D.isDate(q.date) ? q.date : D.today();
    return send(res, 200, {
      date,
      rows: state.employees.map((e) => ({
        employeeId: e.id,
        name: e.name,
        active: e.active !== false,
        manual: state.entries[date]?.[e.id] || {},
        auto: state.auto[date]?.[e.id] || {},
        values: stats.dayValues(state, date, e.id),
      })),
    });
  }
  if (route === 'POST /api/entries') {
    requireAdmin(req);
    const body = await readBody(req);
    if (!D.isDate(body.date)) throw new HttpError(400, 'Sana noto\'g\'ri');
    const fields = ['script', 'conversion', 'sales', 'deals', 'calls', 'talkMin'];
    for (const row of Array.isArray(body.rows) ? body.rows : []) {
      if (!row || typeof row !== 'object') continue;
      if (!state.employees.some((e) => e.id === row.employeeId)) continue;
      const cur = { ...(state.entries[body.date]?.[row.employeeId] || {}) };
      for (const f of fields) {
        if (!(f in row)) continue;
        const v = optNum(row[f]);
        if (v === undefined || v < 0) delete cur[f];
        else cur[f] = v;
      }
      state.entries[body.date] ??= {};
      if (Object.keys(cur).length) state.entries[body.date][row.employeeId] = cur;
      else delete state.entries[body.date][row.employeeId];
    }
    db.saveNow('entries');
    return send(res, 200, { ok: true });
  }

  if (route === 'POST /api/sync') {
    requireAdmin(req);
    const body = await readBody(req);
    const to = D.isDate(body.to) ? body.to : D.today();
    const from = D.isDate(body.from) ? body.from : to;
    if (from > to) throw new HttpError(400, 'Oraliq noto\'g\'ri');
    if (D.eachDay(from, to).length > 400) throw new HttpError(400, 'Maksimal oraliq 400 kun');
    return send(res, 200, await sync.syncRange(from, to));
  }
  if (route === 'GET /api/sync') return send(res, 200, sync.status);
  // Ochiq turgan dashboard va Vercel Cron chaqiradi: ma'lumot eskirgan bo'lsagina bugun va kechani yangilaydi
  if (route === 'GET /api/sync/auto' || route === 'POST /api/sync/auto') return send(res, 200, await sync.autoSync());

  // Zaxira nusxa: butun ma'lumotni (sozlamalar, kalitlar, xodimlar, statistika) yuklab olish va tiklash.
  // Kompyuterdagi ma'lumotni Vercel'ga ko'chirish ham shu orqali.
  if (route === 'GET /api/backup') {
    requireAdmin(req);
    const { settings, employees, entries, auto, imported, auth } = state;
    return send(res, 200, { app: 'uzgrow-dashboard', savedAt: new Date().toISOString(), settings, employees, entries, auto, imported, auth });
  }
  if (route === 'POST /api/restore') {
    requireAdmin(req);
    const body = await readBody(req);
    if (body.app !== 'uzgrow-dashboard' || !body.settings || !Array.isArray(body.employees)) {
      throw new HttpError(400, "Bu fayl dashboard zaxira nusxasi emas");
    }
    for (const k of ['entries', 'auto']) if (body[k] && (typeof body[k] !== 'object' || Array.isArray(body[k]))) throw new HttpError(400, "Zaxira fayli buzilgan");
    const employees = body.employees.filter((e) => e && typeof e === 'object' && /^[a-z0-9]+$/.test(String(e.id)) && typeof e.name === 'string' && e.name.trim());
    const auth = body.auth && /^[0-9a-f]+$/.test(String(body.auth.salt)) && /^[0-9a-f]+$/.test(String(body.auth.hash)) ? { salt: body.auth.salt, hash: body.auth.hash } : null;
    db.replace({ settings: body.settings, employees, entries: body.entries, auto: body.auto, imported: body.imported, auth });
    sync.startScheduler();
    return send(res, 200, { ok: true, employees: employees.length, token: adminToken() });
  }

  if (route === 'POST /api/test/pbx') {
    requireAdmin(req);
    const t = D.today();
    const calls = await pbx.fetchCalls(state.settings, D.dayStartUnix(t), D.dayStartUnix(t) + 86400);
    const numbers = {};
    for (const c of calls) for (const n of pbx.callNumbers(c)) if (n.length <= 6) numbers[n] = (numbers[n] || 0) + 1;
    return send(res, 200, { ok: true, todayCalls: calls.length, internalNumbers: numbers, sample: calls[0] || null });
  }
  if (route === 'POST /api/test/amo') {
    requireAdmin(req);
    await ensureAmoSubdomain(state);
    const [users, pipelines] = await Promise.all([amo.users(state.settings), amo.pipelines(state.settings)]);
    return send(res, 200, { ok: true, users, pipelines });
  }

  throw new HttpError(404, 'Topilmadi');
}

// ---------- statik fayllar ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

function serveStatic(req, res, url) {
  let p;
  try {
    p = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, "Manzil noto'g'ri");
  }
  // Vercel'da public/ fayllarini CDN beradi; funksiyaga faqat "/" keladi — uni index.html ga yo'naltiramiz
  if (db.SERVERLESS && p === '/') {
    res.writeHead(302, { Location: '/index.html' + url.search, 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// So'rovlarni qayta ishlovchi: kompyuterda http serverga, Vercel'da api/index.js orqali funksiyaga ulanadi
async function handler(req, res) {
  try {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      throw new HttpError(400, "Manzil noto'g'ri");
    }
    if (url.pathname.startsWith('/api/')) {
      await db.refresh();
      sync.restoreStatus();
      try {
        await api(req, res, url);
      } finally {
        await db.flush();
      }
    } else serveStatic(req, res, url);
  } catch (err) {
    // status'siz xato — kutilmagan ichki xato: tafsiloti faqat server oynasiga yoziladi
    if (!err.status) console.error('[server]', req.method, req.url, err.stack || err.message);
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Serverda ichki xato' });
    else res.destroy();
  }
}

const server = http.createServer(handler);

async function main() {
  try {
    await db.refresh();
    sync.restoreStatus();
  } catch (err) {
    console.error('XATO: ' + err.message);
    process.exit(1);
  }
  if (isDefaultPassword()) console.warn('DIQQAT: admin parol hali "admin". Dashboardga kirib, Sozlamalar -> "Admin parol" bo\'limida o\'zgartiring!');
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`XATO: ${PORT}-port band. Dastur allaqachon ochiq bo'lishi mumkin — brauzerda http://localhost:${PORT} ni oching yoki .env da PORT ni o'zgartiring.`);
    } else {
      console.error('Serverni ishga tushirib bo\'lmadi:', err.message);
    }
    process.exit(1);
  });
  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Uz-Grow dashboard ishga tushdi: ${url}`);
    console.log('To\'xtatish uchun shu oynani yoping (yoki Ctrl+C).');
    if (process.env.OPEN_BROWSER === '1') {
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      require('child_process').exec(cmd, () => {});
    }
    sync.startScheduler();
  });
  const shutdown = () => {
    db.saveNow();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) main();

// Vercel bu faylni kirish nuqtasi sifatida ishlatadi va asosiy eksport funksiya bo'lishini talab qiladi
module.exports = Object.assign(handler, { server, handler, applySettings, loginFails });
