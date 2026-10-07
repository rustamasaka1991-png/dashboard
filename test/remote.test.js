'use strict';
// Vercel (serverless) rejimi: ma'lumot faylda emas, Upstash Redis'da (bu yerda — xotiradagi soxta Redis).
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uzg-remote-'));
process.env.VERCEL = '1';
process.env.KV_REST_API_URL = 'https://kv.test';
process.env.KV_REST_API_TOKEN = 'kv-token';
process.env.ADMIN_PASSWORD = 'vercel-parol';
process.env.STATE_CACHE_MS = '0'; // har so'rovda ombordan o'qish (keshlash alohida testda)

const store = new Map();
const commands = [];
function redis(cmd) {
  commands.push(cmd[0]);
  const [op, key, value, ...flags] = cmd;
  if (op === 'MGET') return cmd.slice(1).map((k) => store.get(k) ?? null);
  if (op === 'SET') {
    if (flags.includes('NX') && store.has(key)) return null;
    store.set(key, value);
    return 'OK';
  }
  if (op === 'DEL') return store.delete(key) ? 1 : 0;
  throw new Error('kutilmagan buyruq: ' + op);
}
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  if (!String(url).startsWith('https://kv.test')) return realFetch(url, opts);
  assert.strictEqual(opts.headers.Authorization, 'Bearer kv-token');
  const body = JSON.parse(opts.body);
  const json = String(url).endsWith('/pipeline') ? body.map((c) => ({ result: redis(c) })) : { result: redis(body) };
  return { ok: true, status: 200, text: async () => JSON.stringify(json) };
};
const read = (part) => JSON.parse(zlib.gunzipSync(Buffer.from(store.get('uzgrow:' + part).slice(3), 'base64')).toString('utf8'));
const write = (part, obj) => store.set('uzgrow:' + part, 'gz:' + zlib.gzipSync(JSON.stringify(obj)).toString('base64'));

const { server } = require('../server');
let base;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function call(method, url, body, token) {
  const res = await realFetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test("birinchi so'rov omborni boshlang'ich ma'lumot bilan to'ldiradi, faylga hech narsa yozilmaydi", async () => {
  const d = await call('GET', '/api/dashboard');
  assert.strictEqual(d.status, 200);
  assert.deepStrictEqual([...store.keys()].sort(), ['uzgrow:auto', 'uzgrow:core', 'uzgrow:entries']);
  assert.strictEqual(read('core').employees.length, 3);
  assert.deepStrictEqual(fs.readdirSync(process.env.DATA_DIR), []);
});

test("har bir yozuv faqat o'z bo'lagini yangilaydi; boshqa nusxa yozgani keyingi so'rovda ko'rinadi", async () => {
  const token = (await call('POST', '/api/login', { password: 'vercel-parol' })).json.token;
  const emp = (await call('GET', '/api/employees', undefined, token)).json[0];

  commands.length = 0;
  await call('POST', '/api/entries', { date: '2026-10-05', rows: [{ employeeId: emp.id, sales: '900' }] }, token);
  assert.deepStrictEqual(commands, ['MGET', 'SET']); // faqat "entries" yozildi
  assert.strictEqual(read('entries').entries['2026-10-05'][emp.id].sales, 900);

  // boshqa serverless nusxa sozlamani o'zgartirdi deb tasavvur qilamiz
  const core = read('core');
  core.settings.companyName = 'Boshqa nusxa';
  write('core', core);
  const d = (await call('GET', '/api/dashboard?date=2026-10-05')).json;
  assert.strictEqual(d.settings.companyName, 'Boshqa nusxa');
  assert.strictEqual(d.rows.find((r) => r.id === emp.id).day.values.sales, 900);
});

test("zaxira nusxa: yuklab olish va tiklash", async () => {
  const token = (await call('POST', '/api/login', { password: 'vercel-parol' })).json.token;
  assert.strictEqual((await call('GET', '/api/backup')).status, 401);
  const backup = (await call('GET', '/api/backup', undefined, token)).json;
  assert.strictEqual(backup.app, 'uzgrow-dashboard');
  assert.strictEqual((await call('POST', '/api/restore', { nimadir: 1 }, token)).status, 400);

  backup.employees.push({ id: 'abc123', name: 'Tiklangan xodim', extensions: ['105'], amoUserId: '', active: true });
  backup.settings.plans.calls = 99;
  const r = await call('POST', '/api/restore', backup, token);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(read('core').employees.length, 4);
  assert.strictEqual((await call('GET', '/api/dashboard')).json.plans.day.calls, 99);
});

test("so'rov bo'yicha sinxronizatsiya: ulanmagan bo'lsa ishlamaydi, ulangan va eskirgan bo'lsa ishlaydi", async () => {
  assert.strictEqual((await call('POST', '/api/sync/auto')).json.skipped, 'not-configured');

  const core = read('core');
  core.settings.pbx = { domain: 'pbx1.onpbx.ru', apiKey: 'k', baseUrl: 'https://api2.onlinepbx.ru' };
  core.employees[0].extensions = ['100'];
  write('core', core);
  const empId = core.employees[0].id;
  const kvFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (!String(url).startsWith('https://api2.onlinepbx.ru')) return kvFetch(url, opts);
    const data = url.endsWith('auth.json') ? { key_id: 'id', key: 'sec' } : url.endsWith('user/get.json') ? [{ num: '100', name: '' }]
      : [{ uuid: 'u1', accountcode: 'outbound', caller_id_number: '100', user_talk_time: 90, events: [{ type: 'user', number: '100' }] }];
    return { ok: true, status: 200, text: async () => JSON.stringify({ status: '1', data }) };
  };
  try {
    assert.strictEqual((await call('GET', '/api/dashboard')).json.sync.stale, true);
    const r = (await call('POST', '/api/sync/auto')).json;
    assert.ok(r.ok && r.result.pbx.ok, JSON.stringify(r));
    assert.ok(!store.has('uzgrow:lock:sync'), 'qulf bo\'shatilishi kerak');
    const auto = read('auto');
    assert.ok(auto.syncLog.lastRun);
    assert.strictEqual(Object.values(auto.auto).filter((day) => day[empId]?.calls === 1).length, 2); // kecha va bugun
    assert.strictEqual((await call('GET', '/api/dashboard')).json.sync.stale, false);
    assert.strictEqual((await call('POST', '/api/sync/auto')).json.skipped, 'fresh');
  } finally {
    global.fetch = kvFetch;
  }
});
