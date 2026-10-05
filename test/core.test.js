'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uzg-'));
process.env.TZ_OFFSET_HOURS = '5';
const db = require('../lib/db');
const D = require('../lib/dates');
const stats = require('../lib/stats');
const sync = require('../lib/sync');

test('davr oraliqlari', () => {
  assert.deepStrictEqual(D.periodRange('week', '2026-10-08'), { from: '2026-10-05', to: '2026-10-11' });
  assert.deepStrictEqual(D.periodRange('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepStrictEqual(D.periodRange('year', '2026-02-10'), { from: '2026-01-01', to: '2026-12-31' });
  assert.strictEqual(D.dayStartUnix('2026-10-05'), Date.UTC(2026, 9, 4, 19) / 1000);
});

test("qo'lda kiritilgan qiymat avtomatikdan ustun", () => {
  const state = db.load();
  const e = state.employees[0];
  state.auto['2026-10-05'] = { [e.id]: { calls: 50, talkSec: 6000, deals: 1, sales: 500 } };
  state.entries['2026-10-05'] = { [e.id]: { sales: 1250, script: 80 } };
  const v = stats.dayValues(state, '2026-10-05', e.id);
  assert.strictEqual(v.calls, 50);
  assert.strictEqual(v.talkMin, 100);
  assert.strictEqual(v.sales, 1250);
  assert.strictEqual(v.script, 80);
  assert.strictEqual(v.conversion, null);
  state.settings.conversionSource = 'auto';
  assert.strictEqual(stats.dayValues(state, '2026-10-05', e.id).conversion, 2);
  state.settings.conversionSource = 'manual';
});

test('reyting: yaxshi ishlagan xodim tepada', () => {
  const state = db.get();
  const [a, b] = state.employees;
  state.entries['2026-10-06'] = {
    [a.id]: { calls: 30, talkMin: 60, script: 50, conversion: 1, sales: 300 },
    [b.id]: { calls: 80, talkMin: 200, script: 90, conversion: 3, sales: 2000 },
  };
  const d = stats.dashboard(state, { date: '2026-10-06', period: 'week' });
  assert.strictEqual(d.rows[0].id, b.id);
  assert.strictEqual(d.rows[0].rank, 1);
  assert.ok(d.rows[0].dailyPlanDone);
  assert.strictEqual(d.dailyBonus[0].id, b.id);
  assert.strictEqual(d.workDays, 6);
  assert.strictEqual(d.plans.period.calls, 420);
});

test('OnlinePBX sinxronizatsiyasi (mock)', async () => {
  const state = db.get();
  const [a, b] = state.employees;
  a.extensions = ['101'];
  b.extensions = ['102'];
  state.settings.pbx = { domain: 'pbx1.onpbx.ru', apiKey: 'k', baseUrl: 'https://api2.onlinepbx.ru' };
  const calls = [
    { accountcode: 'outbound', caller_id_number: '101', destination_number: '998901112233', user_talk_time: 120 },
    { accountcode: 'outbound', caller_id_number: '101', destination_number: '998901112234', user_talk_time: 10 },
    { accountcode: 'inbound', caller_id_number: '998901112235', destination_number: '102', user_talk_time: 300 },
    { accountcode: 'local', caller_id_number: '101', destination_number: '102', user_talk_time: 500 },
  ];
  const seen = [];
  global.fetch = async (url, opts) => {
    seen.push({ url, headers: opts.headers });
    const body = url.endsWith('auth.json') ? { status: '1', data: { key_id: 'id', key: 'sec' } } : { status: '1', data: calls };
    return { status: 200, ok: true, text: async () => JSON.stringify(body) };
  };
  const r = await sync.syncRange(D.today(), D.today());
  assert.ok(r.pbx.ok, JSON.stringify(r));
  assert.match(seen[1].url, /mongo_history\/search\.json$/);
  assert.strictEqual(seen[1].headers['x-pbx-authentication'], 'id:sec');
  const auto = state.auto[D.today()];
  assert.deepStrictEqual([auto[a.id].calls, auto[a.id].attempts, auto[a.id].talkSec], [1, 2, 130]);
  assert.deepStrictEqual([auto[b.id].calls, auto[b.id].attempts, auto[b.id].talkSec], [1, 1, 300]);
});
