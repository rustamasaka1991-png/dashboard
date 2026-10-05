'use strict';
// Namuna ma'lumotlar: dashboardni integratsiyasiz ko'rib chiqish uchun.
// Ishlatish: npm run demo   (data/db.json'dagi auto/entries'ni joriy yil uchun to'ldiradi)
const db = require('../lib/db');
const D = require('../lib/dates');

const state = db.load();
const t = D.today();
const from = `${t.slice(0, 4)}-01-01`;
// Har bir xodim uchun "kuch" koeffitsienti
const power = [0.9, 1.15, 0.7, 1.0, 0.85, 1.05];
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

for (const d of D.eachDay(from, t)) {
  if (D.weekday(d) === 0) continue; // yakshanba dam
  state.auto[d] = {};
  state.entries[d] = {};
  state.employees.forEach((e, i) => {
    const k = power[i % power.length] * (0.8 + rnd() * 0.4);
    const calls = Math.round(70 * k);
    const deals = Math.round(calls * (0.01 + 0.025 * k * rnd()));
    state.auto[d][e.id] = { calls, attempts: calls + Math.round(rnd() * 30), talkSec: Math.round(175 * 60 * k), deals, sales: 0 };
    state.entries[d][e.id] = {
      script: Math.round(70 * k * (0.9 + rnd() * 0.2)),
      conversion: Math.round(2 * k * (0.7 + rnd() * 0.5) * 10) / 10,
      sales: Math.round((1250 * k * (0.6 + rnd() * 0.7)) / 10) * 10,
    };
  });
}
db.saveNow();
console.log(`Demo ma'lumotlar yozildi: ${from} — ${t}, ${state.employees.length} xodim.`);
