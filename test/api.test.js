'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const net = require('net');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uzg-api-'));
process.env.ADMIN_PASSWORD = 'test-parol';
const { server, loginFails } = require('../server');

let base, port;
test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});
test.after(() => server.close());

async function call(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// fetch manzilni tozalab yuboradi, shuning uchun "xom" so'rov qatori alohida yuboriladi
function rawStatus(requestLine) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(requestLine + '\r\nHost: x\r\nConnection: close\r\n\r\n'));
    let buf = '';
    s.on('data', (c) => (buf += c));
    s.on('close', () => resolve(Number(buf.split(' ')[1])));
    s.on('error', reject);
  });
}

test("noto'g'ri so'rovlar serverni yiqitmaydi", async () => {
  assert.strictEqual(await rawStatus('GET // HTTP/1.1'), 400);
  assert.strictEqual(await rawStatus('GET /%E0%A4%A HTTP/1.1'), 400);
  assert.strictEqual((await call('POST', '/api/login', 'null')).status, 400);
  assert.strictEqual((await call('GET', '/api/me', undefined, 'é'.repeat(64))).json.admin, false);
  assert.strictEqual((await call('GET', '/api/dashboard?period=custom&from=2000-01-01&to=2100-12-31')).status, 400);
  assert.strictEqual((await call('GET', '/api/dashboard')).status, 200);
});

test('admin: kirish, himoyalangan yo\'llar, parolni almashtirish', async () => {
  assert.strictEqual((await call('GET', '/api/entries')).status, 401);
  assert.strictEqual((await call('POST', '/api/login', { password: 'xato' })).status, 401);
  const login = await call('POST', '/api/login', { password: 'test-parol' });
  assert.strictEqual(login.status, 200);
  const token = login.json.token;
  assert.strictEqual((await call('GET', '/api/entries', undefined, token)).status, 200);

  assert.strictEqual((await call('POST', '/api/password', { current: 'xato', next: 'yangi-parol' }, token)).status, 400);
  assert.strictEqual((await call('POST', '/api/password', { current: 'test-parol', next: '123' }, token)).status, 400);
  const changed = await call('POST', '/api/password', { current: 'test-parol', next: 'yangi-parol' }, token);
  assert.strictEqual(changed.status, 200);
  assert.strictEqual((await call('GET', '/api/me', undefined, token)).json.admin, false, 'eski token bekor bo\'lishi kerak');
  assert.strictEqual((await call('GET', '/api/me', undefined, changed.json.token)).json.admin, true);
  assert.strictEqual((await call('POST', '/api/login', { password: 'test-parol' })).status, 401);
  assert.strictEqual((await call('POST', '/api/login', { password: 'yangi-parol' })).status, 200);
});

test('natija kiritish va tokenlarni yashirish', async () => {
  const token = (await call('POST', '/api/login', { password: 'yangi-parol' })).json.token;
  const emp = (await call('GET', '/api/employees', undefined, token)).json[0];
  assert.strictEqual((await call('POST', '/api/entries', { date: '2026-02-31', rows: [] }, token)).status, 400);
  const saved = await call('POST', '/api/entries', { date: '2026-10-05', rows: [{ employeeId: emp.id, conversion: '2.5', sales: '1500', script: '' }] }, token);
  assert.strictEqual(saved.status, 200);
  const d = (await call('GET', '/api/dashboard?date=2026-10-05')).json;
  const row = d.rows.find((r) => r.id === emp.id);
  assert.strictEqual(row.day.values.conversion, 2.5);
  assert.strictEqual(row.day.values.sales, 1500);
  assert.strictEqual(d.settings.pbx.apiKey, '');
  assert.strictEqual(d.settings.amo.token, '');
});

test("parolni tanlab topishga qarshi cheklov", async () => {
  loginFails.clear();
  for (let i = 0; i < 8; i++) assert.strictEqual((await call('POST', '/api/login', { password: 'x' + i })).status, 401);
  assert.strictEqual((await call('POST', '/api/login', { password: 'yangi-parol' })).status, 429);
  loginFails.clear();
  assert.strictEqual((await call('POST', '/api/login', { password: 'yangi-parol' })).status, 200);
});
