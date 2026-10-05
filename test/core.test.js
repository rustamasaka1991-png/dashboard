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
  const d = stats.dashboard(state, { date: '2026-10-06', period: 'week', today: '2026-10-06' });
  assert.strictEqual(d.rows[0].id, b.id);
  assert.strictEqual(d.rows[0].rank, 1);
  assert.ok(d.rows[0].dailyPlanDone);
  assert.strictEqual(d.dailyBonus[0].id, b.id);
  assert.strictEqual(d.workDays, 6);
  assert.strictEqual(d.plans.period.calls, 420);
});

test("sana tekshiruvi: faqat haqiqiy kalendar sanalari", () => {
  assert.ok(D.isDate('2026-02-28'));
  assert.ok(!D.isDate('2026-02-31'));
  assert.ok(!D.isDate('0001-01-01'));
  assert.ok(!D.isDate('9999-12-31'));
  assert.strictEqual(D.daysBetween('2026-10-01', '2026-10-31'), 31);
});

test("juda katta oraliq rad etiladi", () => {
  const state = db.get();
  assert.throws(
    () => stats.dashboard(state, { period: 'custom', from: '2000-01-01', to: '2100-12-31' }),
    (err) => err.status === 400,
  );
  // noto'g'ri sanalar joriy oyga qaytadi
  assert.strictEqual(stats.dashboard(state, { period: 'custom', from: '0001-01-01', to: '9999-12-31', date: '2026-10-05' }).range.from, '2026-10-01');
});

test("oy o'rtasida rang va ball o'tgan ish kunlariga nisbatan hisoblanadi", () => {
  const state = db.get();
  // 2026-yil oktabr: 27 ish kuni (yakshanbalarsiz), 5-oktabrgacha 4 tasi o'tgan
  const today = '2026-10-05';
  assert.strictEqual(stats.paceFor(state.settings, { from: '2026-10-01', to: '2026-10-31' }, today), 4 / 27);
  assert.strictEqual(stats.paceFor(state.settings, { from: '2026-09-01', to: '2026-09-30' }, today), 1);
  const c = state.employees[2];
  for (const d of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05']) {
    state.entries[d] = { ...state.entries[d], [c.id]: { calls: 70, talkMin: 175, script: 70, conversion: 2, sales: 1250 } };
  }
  const d = stats.dashboard(state, { date: today, period: 'month', today, ids: [c.id] });
  const p = d.rows[0].period;
  assert.strictEqual(Math.round(p.pct.calls), 17); // 280 / 1680 — ekrandagi foiz to'liq planga nisbatan
  assert.ok(p.pacePct.calls > 100, 'kunlik rejani bajarayotgan xodim grafikdan orqada ko\'rinmasligi kerak');
  assert.ok(d.rows[0].score > 100);
});

test("og'irligi 0 bo'lgan KPI kunlik bonusga to'sqinlik qilmaydi", () => {
  const state = db.get();
  const a = state.employees[0];
  state.entries['2026-11-02'] = { [a.id]: { calls: 80, talkMin: 200, conversion: 3, sales: 2000 } }; // skript bali kiritilmagan
  const opts = { date: '2026-11-02', period: 'week', today: '2026-11-02', ids: [a.id] };
  assert.strictEqual(stats.dashboard(state, opts).rows[0].dailyPlanDone, false);
  state.settings.weights.script = 0;
  assert.strictEqual(stats.dashboard(state, opts).rows[0].dailyPlanDone, true);
  state.settings.weights.script = 20;
});

test("avto-konversiya davr bo'yicha: jami sotuv / jami aloqa", () => {
  const state = db.get();
  const a = state.employees[0];
  state.settings.conversionSource = 'auto';
  state.auto['2026-12-01'] = { [a.id]: { calls: 10, deals: 1 } }; // 10%
  state.auto['2026-12-02'] = { [a.id]: { calls: 90, deals: 1 } }; // 1.1%
  assert.strictEqual(stats.aggregate(state, a.id, '2026-12-01', '2026-12-02').conversion, 2);
  state.settings.conversionSource = 'manual';
});

test('amoCRM: token ichidagi domen va subdomenni avtomatik aniqlash (mock)', async () => {
  const amo = require('../lib/amo');
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${part({ alg: 'none' })}.${part({ base_domain: 'kommo.com', exp: 1814313600 })}.imzo`;
  assert.deepStrictEqual(amo.tokenInfo(token), { baseDomain: 'kommo.com', exp: 1814313600 });
  assert.strictEqual(amo.tokenInfo('jwt-emas'), null);

  const settings = { amo: { subdomain: '', token, baseDomain: 'kommo.com' } };
  const realFetch = global.fetch;
  let seen;
  global.fetch = async (url, opts) => {
    seen = { url, auth: opts.headers.Authorization };
    return { status: 200, ok: true, text: async () => JSON.stringify({ id: 1, subdomain: 'UzGrow', domain: 'uzgrow.kommo.com' }) };
  };
  try {
    assert.strictEqual(await amo.detectSubdomain(settings), 'uzgrow');
    assert.strictEqual(seen.url, 'https://www.kommo.com/oauth2/account/subdomain');
    assert.strictEqual(seen.auth, 'Bearer ' + token);
    global.fetch = async () => ({ status: 401, ok: false, text: async () => '{}' });
    await assert.rejects(amo.detectSubdomain(settings), /token noto'g'ri/);
  } finally {
    global.fetch = realFetch;
  }
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
    const pbxUsers = [{ num: '101', name: 'Boshqa ism' }, { num: '103', name: 'Dilnoza Karimova' }, { num: '104', name: 'dilnoza  karimova' }, { num: '105', name: '105' }];
    const data = url.endsWith('auth.json') ? { key_id: 'id', key: 'sec' } : url.endsWith('user/get.json') ? pbxUsers : calls;
    const body = { status: '1', data };
    return { status: 200, ok: true, text: async () => JSON.stringify(body) };
  };
  const r = await sync.syncRange(D.today(), D.today());
  assert.ok(r.pbx.ok, JSON.stringify(r));
  const history = seen.find((x) => /mongo_history\/search\.json$/.test(x.url));
  assert.strictEqual(history.headers['x-pbx-authentication'], 'id:sec');
  const auto = state.auto[D.today()];
  assert.deepStrictEqual([auto[a.id].calls, auto[a.id].attempts, auto[a.id].talkSec], [1, 2, 130]);
  assert.deepStrictEqual([auto[b.id].calls, auto[b.id].attempts, auto[b.id].talkSec], [1, 1, 300]);
  // xodimlar OnlinePBX'dan ham yuklanadi: 101 allaqachon bor, 103 va 104 — bitta odam, 105 — ismsiz
  assert.deepStrictEqual(r.roster.added, ['Dilnoza Karimova']);
  const dilnoza = state.employees.filter((e) => /dilnoza/i.test(e.name));
  assert.strictEqual(dilnoza.length, 1);
  assert.deepStrictEqual(dilnoza[0].extensions, ['103', '104']);
});

test("xodimlarni yuklash: takrorlar birlashtiriladi, o'chirilganlar qaytmaydi", () => {
  const roster = require('../lib/roster');
  const emp = (name, extra = {}) => ({ id: db.newId(), name, extensions: [], amoUserId: '', photo: '', active: true, ...extra });
  const state = { employees: [emp('Asadbek'), emp('Molohat'), emp('Yangi xodim')], entries: {}, auto: {} };
  const amoUsers = [
    { id: 11, name: 'Asadbek Karimov' }, // mavjud "Asadbek"ga biriktiriladi
    { id: 12, name: 'Sardor Aliyev' },
    { id: 13, name: 'Sardor Aliyev' }, // boshqa ID — boshqa odam
  ];
  const pbxUsers = [
    { num: '201', name: 'MOLOHAT' },
    { num: '202', name: 'Sardor  aliyev' }, // ikkita "Sardor Aliyev"dan birinchisiga
    { num: '203', name: 'Javlon' },
  ];
  const r1 = roster.merge(state, { amoUsers, pbxUsers });
  assert.deepStrictEqual(r1.added, ['Sardor Aliyev', 'Sardor Aliyev', 'Javlon']);
  assert.deepStrictEqual(r1.linked, ['Asadbek', 'Molohat', 'Sardor Aliyev']);
  assert.deepStrictEqual(r1.removed, ['Yangi xodim']);
  assert.deepStrictEqual(state.employees.map((e) => [e.name, e.amoUserId, e.extensions.join()]), [
    ['Asadbek', '11', ''], ['Molohat', '', '201'], ['Sardor Aliyev', '12', '202'], ['Sardor Aliyev', '13', ''], ['Javlon', '', '203'],
  ]);

  // qayta yuklash hech narsani ko'paytirmaydi
  const r2 = roster.merge(state, { amoUsers, pbxUsers });
  assert.deepStrictEqual([r2.added, r2.linked, state.employees.length], [[], [], 5]);

  // admin o'chirgan xodim keyingi yuklashda qaytmaydi, yangi kelgani esa qo'shiladi
  state.employees = state.employees.filter((e) => e.name !== 'Javlon');
  const r3 = roster.merge(state, { amoUsers: [...amoUsers, { id: 14, name: 'Nodira' }], pbxUsers });
  assert.deepStrictEqual(r3.added, ['Nodira']);
  assert.ok(!state.employees.some((e) => e.name === 'Javlon'));
  assert.deepStrictEqual(roster.merge(state, { pbxUsers }, { force: true }).added, ['Javlon']);
});

test("xodimlar: boshqacha yozilgan ism ham bitta odam, rahbarlar faol emas", () => {
  const roster = require('../lib/roster');
  assert.strictEqual(roster.fold('Molohat'), roster.fold('Maloxat'));
  assert.strictEqual(roster.fold('Малоҳат'), roster.fold('Molohat'));
  assert.notStrictEqual(roster.fold('Nodira'), roster.fold('Nodir'));

  const emp = (name, extra = {}) => ({ id: db.newId(), name, extensions: [], amoUserId: '', photo: '', active: true, ...extra });
  // "Molohat" qo'lda ochilgan, "Toxirova Maloxat" esa amoCRM'dan avval alohida yuklanib qolgan
  const loose = emp('Molohat', { extensions: ['101'] });
  const fromAmo = emp('Toxirova Maloxat', { amoUserId: '21' });
  const state = { employees: [loose, fromAmo], entries: { '2026-10-05': { [loose.id]: { sales: 500 } } }, auto: {} };
  const r = roster.merge(state, {
    amoUsers: [{ id: 21, name: 'Toxirova Maloxat' }, { id: 22, name: 'Direktor aka', admin: true }, { id: 23, name: 'ROP', role: 'ROP' }, { id: 24, name: 'Islom', role: 'Sotuvchi' }],
  });
  assert.deepStrictEqual(r.merged, ['Molohat → Toxirova Maloxat']);
  assert.deepStrictEqual(state.employees.map((e) => [e.name, e.active, e.extensions.join()]), [
    ['Toxirova Maloxat', true, '101'], ['Direktor aka', false, ''], ['ROP', false, ''], ['Islom', true, ''],
  ]);
  assert.deepStrictEqual(state.entries['2026-10-05'], { [fromAmo.id]: { sales: 500 } });
});

test("ichki raqam egasi amoCRM'dagi qo'ng'iroq yozuvlaridan aniqlanadi", () => {
  const roster = require('../lib/roster');
  const pbx = require('../lib/pbx');
  assert.strictEqual(pbx.callUser({ events: [{ type: 'transfer', number: '5100' }, { type: 'user', number: '100' }, { type: 'user', number: '101' }] }), '101');
  assert.strictEqual(pbx.callUser({ events: [{ type: 'transfer', number: '5100' }] }), '');

  const emp = (name, amoUserId) => ({ id: db.newId(), name, extensions: [], amoUserId, active: true });
  const state = { employees: [emp('Asadbek', '1'), emp('Maloxat', '2'), emp('Rahbar', '9')] };
  const vote = (ext, userId, out, n) => Array.from({ length: n }, () => ({ ext, userId, out }));
  const votes = [
    ...vote('100', '1', true, 40), ...vote('100', '9', false, 60), // javobsiz kiruvchilar rahbar nomiga yozilgan — chiquvchilar hal qiladi
    ...vote('101', '2', false, 3), ...vote('101', '9', false, 1),
    ...vote('102', '1', false, 1), // bitta ovoz yetarli emas
    ...vote('103', '1', false, 2), ...vote('103', '2', false, 2), // teng — noaniq
  ];
  assert.deepStrictEqual(roster.linkExtensions(state, votes, ['100', '101', '102', '103', '104']), ['100 → Asadbek', '101 → Maloxat']);
  assert.deepStrictEqual(state.employees.map((e) => e.extensions.join()), ['100', '101', '']);
});
