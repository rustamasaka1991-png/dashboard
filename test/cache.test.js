'use strict';
// Tezlik: serverless nusxa xotirasidagi holatni qayta ishlatish, versiya (X-Rev), CDN keshi, rasm manzili.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uzg-cache-'));
process.env.VERCEL = '1';
process.env.KV_REST_API_URL = 'https://kv.test';
process.env.KV_REST_API_TOKEN = 'kv-token';
process.env.ADMIN_PASSWORD = 'vercel-parol';

const store = new Map();
let reads = 0;
function redis(cmd) {
  const [op, key, value, ...flags] = cmd;
  if (op === 'MGET') { reads++; return cmd.slice(1).map((k) => store.get(k) ?? null); }
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
  if (String(url).startsWith('https://api2.onlinepbx.ru')) {
    const calls = [
      { uuid: 'a', accountcode: 'outbound', user_talk_time: 90, events: [{ type: 'user', number: '100' }] },
      { uuid: 'b', accountcode: 'outbound', user_talk_time: 0, events: [{ type: 'user', number: '100' }] },
      { uuid: 'c', accountcode: 'outbound', user_talk_time: 45, events: [{ type: 'user', number: '109' }] },
      { uuid: 'd', accountcode: 'inbound', user_talk_time: 0, events: [{ type: 'user', number: '109' }] },
    ];
    const data = url.endsWith('auth.json') ? { key_id: 'id', key: 'sec' } : url.endsWith('user/get.json') ? [] : calls;
    return { ok: true, status: 200, text: async () => JSON.stringify({ status: '1', data }) };
  }
  if (!String(url).startsWith('https://kv.test')) return realFetch(url, opts);
  const body = JSON.parse(opts.body);
  const json = String(url).endsWith('/pipeline') ? body.map((c) => ({ result: redis(c) })) : { result: redis(body) };
  return { ok: true, status: 200, text: async () => JSON.stringify(json) };
};
const unpack = (part) => JSON.parse(zlib.gunzipSync(Buffer.from(store.get('uzgrow:' + part).slice(3), 'base64')).toString('utf8'));
const pack = (part, obj) => store.set('uzgrow:' + part, 'gz:' + zlib.gzipSync(JSON.stringify(obj)).toString('base64'));

const { server } = require('../server');
let base;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function call(method, url, body, headers = {}) {
  const res = await realFetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, json: type.includes('json') ? await res.json() : null, bytes: type.includes('json') ? null : Buffer.from(await res.arrayBuffer()) };
}

test("ketma-ket so'rovlar omborni qayta o'qimaydi; yangi versiya so'ralsa — o'qiydi", async () => {
  const first = await call('GET', '/api/dashboard');
  assert.strictEqual(first.status, 200);
  const rev0 = Number(first.headers.get('x-rev'));
  assert.ok(rev0 > 0);
  assert.strictEqual(first.json.rev, rev0);

  reads = 0;
  await call('GET', '/api/dashboard');
  await call('GET', '/api/dashboard?period=week');
  assert.strictEqual(reads, 0, 'xotiradagi nusxa ishlatilishi kerak');

  // boshqa serverless nusxa yozdi (versiyasi kattaroq)
  const core = unpack('core');
  core.settings.companyName = 'Yangi nom';
  core._rev = rev0 + 1000;
  pack('core', core);
  assert.notStrictEqual((await call('GET', '/api/dashboard')).json.settings.companyName, 'Yangi nom'); // kesh — hali eski
  const fresh = await call('GET', '/api/dashboard', undefined, { 'X-Rev': String(rev0 + 1000) });
  assert.strictEqual(fresh.json.settings.companyName, 'Yangi nom');
  assert.strictEqual((await call('GET', `/api/dashboard?_rev=${rev0 + 5000}`)).status, 200); // "_rev" ham xuddi shunday ishlaydi
});

test("CDN keshi: tomoshabin javobi keshlanadi, _rev bilan so'ralgani va yozuvlar — yo'q", async () => {
  assert.match((await call('GET', '/api/dashboard')).headers.get('cache-control'), /s-maxage=\d+/);
  assert.strictEqual((await call('GET', '/api/dashboard?_rev=1')).headers.get('cache-control'), 'no-store');
  assert.strictEqual((await call('GET', '/api/me')).headers.get('cache-control'), 'no-store');
  assert.match((await call('GET', '/api/dashboard')).headers.get('server-timing'), /db-read;dur=\d+/);
});

test("o'z yozuvi darhol ko'rinadi; qo'lda kiritilgan qiymat belgilanadi; rasm alohida manzildan", async () => {
  const token = (await call('POST', '/api/login', { password: 'vercel-parol' })).json.token;
  const auth = { Authorization: 'Bearer ' + token };
  const emp = (await call('GET', '/api/employees', undefined, auth)).json[0];

  const saved = await call('POST', '/api/entries', { date: '2026-10-05', rows: [{ employeeId: emp.id, conversion: '2.5' }] }, auth);
  const rev = Number(saved.headers.get('x-rev'));
  const d = (await call('GET', '/api/dashboard?date=2026-10-05', undefined, { ...auth, 'X-Rev': String(rev) })).json;
  const row = d.rows.find((r) => r.id === emp.id);
  assert.strictEqual(row.day.values.conversion, 2.5);
  assert.deepStrictEqual(row.day.manual, ['conversion']);
  assert.deepStrictEqual(d.employees.map((e) => e.id).includes(emp.id), true);

  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  await call('PUT', '/api/employees/' + emp.id, { photo: 'data:image/png;base64,' + png }, auth);
  const withPhoto = (await call('GET', '/api/dashboard', undefined, auth)).json.rows.find((r) => r.id === emp.id);
  assert.match(withPhoto.photo, new RegExp(`^/api/photo/${emp.id}\\?v=[0-9a-f]{10}$`));
  const img = await call('GET', withPhoto.photo);
  assert.strictEqual(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('cache-control'), /immutable/);
  assert.deepStrictEqual(img.bytes, Buffer.from(png, 'base64'));
  assert.strictEqual((await call('GET', '/api/photo/yoq123')).status, 404);
});

test("jami qo'ng'iroqlar soni va egasiz ichki raqamlar ko'rsatiladi", async () => {
  const token = (await call('POST', '/api/login', { password: 'vercel-parol' })).json.token;
  const auth = { Authorization: 'Bearer ' + token };
  const emp = (await call('GET', '/api/employees', undefined, auth)).json[0];
  await call('PUT', '/api/employees/' + emp.id, { extensions: '100' }, auth);
  await call('PUT', '/api/settings', { pbx: { domain: 'pbx1.onpbx.ru', apiKey: 'k' } }, auth);
  const synced = await call('POST', '/api/sync', {}, auth);
  assert.ok(synced.json.pbx.ok, JSON.stringify(synced.json));

  const d = (await call('GET', '/api/dashboard', undefined, auth)).json;
  const row = d.rows.find((r) => r.id === emp.id);
  assert.deepStrictEqual([row.day.values.calls, row.day.values.attempts], [1, 2]); // 2 ta terilgan, 1 tasi real aloqa
  assert.strictEqual(d.totals.day.values.attempts, 2);
  assert.deepStrictEqual(d.unassigned, [{ ext: '109', attempts: 2, calls: 1 }]);

  // 109 raqami xodimga yozilgach ogohlantirish yo'qoladi (keyingi sinxronizatsiyada qo'ng'iroqlari ham hisoblanadi)
  await call('PUT', '/api/employees/' + emp.id, { extensions: '100, 109' }, auth);
  assert.deepStrictEqual((await call('GET', '/api/dashboard', undefined, auth)).json.unassigned, []);
});
