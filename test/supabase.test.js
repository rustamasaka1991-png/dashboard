'use strict';
// Vercel rejimi, ombor — Supabase (bu yerda PostgREST'ning xotiradagi soxta nusxasi).
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uzg-supa-'));
process.env.VERCEL = '1';
process.env.SUPABASE_URL = 'https://proj.supabase.co/';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
process.env.ADMIN_PASSWORD = 'vercel-parol';
process.env.STATE_CACHE_MS = '0'; // har so'rovda ombordan o'qish (keshlash alohida testda)

const rows = new Map(); // key -> { value, updated_at }
let mode = 'ok'; // 'ok' | 'no-table' | 'rls'
const calls = [];
const reply = (status, body) => ({ ok: status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
function postgrest(url, opts) {
  const u = new URL(url);
  assert.strictEqual(u.pathname, '/rest/v1/dashboard_kv');
  assert.strictEqual(opts.headers.apikey, 'sb_secret_test');
  assert.strictEqual(opts.headers.Authorization, 'Bearer sb_secret_test');
  calls.push(opts.method);
  if (mode === 'no-table') return reply(404, { code: 'PGRST205', message: "Could not find the table 'public.dashboard_kv' in the schema cache" });
  const q = u.searchParams;
  if (opts.method === 'GET') {
    if (mode === 'rls') return reply(200, []); // RLS qatorlarni jimgina yashiradi
    const keys = [...q.get('key').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    return reply(200, keys.filter((k) => rows.has(k)).map((k) => ({ key: k, value: rows.get(k).value })));
  }
  if (opts.method === 'POST') {
    if (mode === 'rls') return reply(403, { code: '42501', message: 'new row violates row-level security policy for table "dashboard_kv"' });
    const body = JSON.parse(opts.body);
    const upsert = q.get('on_conflict') === 'key' && /merge-duplicates/.test(opts.headers.Prefer || '');
    if (!upsert && body.some((r) => rows.has(r.key))) return reply(409, { code: '23505', message: 'duplicate key value violates unique constraint' });
    for (const r of body) rows.set(r.key, { value: r.value, updated_at: r.updated_at });
    return reply(201);
  }
  if (opts.method === 'DELETE') {
    const k = q.get('key').replace(/^eq\./, '');
    const before = q.get('updated_at')?.replace(/^lt\./, '');
    if (rows.has(k) && (!before || rows.get(k).updated_at < before)) rows.delete(k);
    return reply(204);
  }
  throw new Error('kutilmagan so\'rov: ' + opts.method);
}
const realFetch = global.fetch;
global.fetch = async (url, opts) => (String(url).startsWith('https://proj.supabase.co/') ? postgrest(url, opts) : realFetch(url, opts));
const read = (part) => JSON.parse(zlib.gunzipSync(Buffer.from(rows.get('uzgrow:' + part).value.slice(3), 'base64')).toString('utf8'));

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

test("sozlash xatolari tushunarli xabar beradi: jadval yo'q / ochiq kalit qo'yilgan", async () => {
  mode = 'no-table';
  const a = await call('GET', '/api/dashboard');
  assert.strictEqual(a.status, 503);
  assert.match(a.json.error, /jadvali topilmadi/);
  mode = 'rls';
  const b = await call('GET', '/api/dashboard');
  assert.strictEqual(b.status, 503);
  assert.match(b.json.error, /secret \(service_role\) kalit/);
  mode = 'ok';
});

test("Supabase: boshlang'ich to'ldirish, bo'laklab yozish, zaxiradan tiklash", async () => {
  assert.strictEqual((await call('GET', '/api/dashboard')).status, 200);
  assert.deepStrictEqual([...rows.keys()].sort(), ['uzgrow:auto', 'uzgrow:core', 'uzgrow:entries']);
  assert.deepStrictEqual(fs.readdirSync(process.env.DATA_DIR), []);

  const token = (await call('POST', '/api/login', { password: 'vercel-parol' })).json.token;
  const emp = (await call('GET', '/api/employees', undefined, token)).json[0];
  const coreBefore = rows.get('uzgrow:core').value;
  await call('POST', '/api/entries', { date: '2026-10-05', rows: [{ employeeId: emp.id, conversion: '3', sales: '700' }] }, token);
  assert.deepStrictEqual(read('entries').entries['2026-10-05'][emp.id], { conversion: 3, sales: 700 });
  assert.strictEqual(rows.get('uzgrow:core').value, coreBefore, '"core" qayta yozilmasligi kerak');

  const backup = (await call('GET', '/api/backup', undefined, token)).json;
  backup.settings.companyName = 'Tiklangan';
  assert.strictEqual((await call('POST', '/api/restore', backup, token)).status, 200);
  assert.strictEqual(read('core').settings.companyName, 'Tiklangan');
  assert.strictEqual((await call('GET', '/api/dashboard?date=2026-10-05')).json.rows.find((r) => r.id === emp.id).day.values.sales, 700);
});

test("Supabase: sinxronizatsiya qulfi (band bo'lsa o'tkazib yuboriladi, eskirgan qulf olib tashlanadi)", async () => {
  const core = read('core');
  core.settings.pbx = { domain: 'pbx1.onpbx.ru', apiKey: 'k', baseUrl: 'https://api2.onlinepbx.ru' };
  core.employees[0].extensions = ['100'];
  rows.set('uzgrow:core', { value: 'gz:' + zlib.gzipSync(JSON.stringify(core)).toString('base64'), updated_at: new Date().toISOString() });
  const supaFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (!String(url).startsWith('https://api2.onlinepbx.ru')) return supaFetch(url, opts);
    const data = url.endsWith('auth.json') ? { key_id: 'id', key: 'sec' } : url.endsWith('user/get.json') ? [{ num: '100', name: '' }]
      : [{ uuid: 'u1', accountcode: 'outbound', caller_id_number: '100', user_talk_time: 90, events: [{ type: 'user', number: '100' }] }];
    return { ok: true, status: 200, text: async () => JSON.stringify({ status: '1', data }) };
  };
  try {
    // boshqa nusxa hozirgina qulflagan
    rows.set('uzgrow:lock:sync', { value: '1', updated_at: new Date().toISOString() });
    assert.strictEqual((await call('POST', '/api/sync/auto')).json.skipped, 'running');
    // qulf 10 daqiqa oldin qolib ketgan (funksiya uzilib qolgan) — olib tashlanadi va sinxronizatsiya ishlaydi
    rows.set('uzgrow:lock:sync', { value: '1', updated_at: new Date(Date.now() - 600000).toISOString() });
    const r = (await call('POST', '/api/sync/auto')).json;
    assert.ok(r.ok && r.result.pbx.ok, JSON.stringify(r));
    assert.ok(!rows.has('uzgrow:lock:sync'));
    assert.ok(read('auto').syncLog.lastRun);
  } finally {
    global.fetch = supaFetch;
  }
});
