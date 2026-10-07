'use strict';

// Xodimlar ro'yxatini amoCRM foydalanuvchilari va OnlinePBX ichki raqamlaridan to'ldirish.
// Bitta odam bir necha manbadan kelsa ham ro'yxatda bir marta turadi:
//   1) amoCRM ID yoki ichki raqam allaqachon biror xodimga yozilgan bo'lsa — o'tkazib yuboriladi;
//   2) ismi mavjud xodimga mos kelsa — yangi xodim ochilmaydi, ID/raqam o'sha xodimga biriktiriladi;
//   3) aks holda yangi xodim qo'shiladi.

const db = require('./db');

const SEED_PLACEHOLDER = 'yangi xodim';
// Sotuvchi bo'lmagan rollar: bunday foydalanuvchilar "faol emas" holda qo'shiladi (doskada ko'rinmaydi)
const NON_SALES_ROLE = /^(rop|роп|direktor|директор|rahbar|руководитель|admin|админ)/i;

const CYR = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

// Ismni solishtirish uchun soddalashtirish: kirill -> lotin, "Molohat" = "Maloxat" = "Малоҳат"
// (o/a, x/h, q/k farqlari va tutuq belgilari hisobga olinmaydi).
function fold(s) {
  return String(s ?? '').toLowerCase()
    .replace(/[а-яёўқғҳ]/g, (ch) => CYR[ch] ?? ch)
    .replace(/[ʻʼ‘’`´']/g, '')
    .replace(/kh/g, 'h').replace(/x/g, 'h').replace(/q/g, 'k').replace(/o/g, 'a')
    .replace(/(.)\1+/g, '$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
const words = (s) => fold(s).split(' ').filter(Boolean);

// Ism bo'yicha mos xodim: to'liq mos kelsa — o'sha; "Asadbek" ~ "Abdujamalov Asadbek" kabi
// qisman moslik faqat bitta nomzod bo'lgandagina qabul qilinadi (adashtirib yubormaslik uchun).
function findByName(employees, name) {
  const n = fold(name);
  if (!n) return null;
  const exact = employees.find((e) => fold(e.name) === n);
  if (exact) return exact;
  const w = words(name);
  const partial = employees.filter((e) => {
    const ew = words(e.name);
    return ew.length > 0 && (ew.every((x) => w.includes(x)) || w.every((x) => ew.includes(x)));
  });
  return partial.length === 1 ? partial[0] : null;
}

function newEmployee(name, extra) {
  return {
    id: db.newId(), name: String(name).trim().slice(0, 80), role: 'Sotuv menejer', photo: '', extensions: [], amoUserId: '', active: true,
    createdAt: new Date().toISOString(), ...extra,
  };
}

const hasData = (state, id) => [state.entries, state.auto].some((bucket) => Object.values(bucket).some((day) => day[id]));

// `from` xodimini `into` ga qo'shib yuborish (ichki raqamlar, rasm va statistikasi bilan)
function absorb(state, into, from) {
  into.extensions = [...new Set([...(into.extensions || []), ...(from.extensions || [])])];
  if (!into.photo && from.photo) into.photo = from.photo;
  for (const bucket of [state.entries, state.auto]) {
    for (const day of Object.values(bucket)) {
      if (!day[from.id]) continue;
      day[into.id] = { ...day[from.id], ...(day[into.id] || {}) };
      delete day[from.id];
    }
  }
  state.employees = state.employees.filter((e) => e !== from);
}

// Ro'yxatda allaqachon ikki marta turgan odamlarni birlashtirish: amoCRM'ga bog'lanmagan yozuv
// ismi bo'yicha amoCRM'dan kelgan yagona xodimga mos kelsa — unga qo'shib yuboriladi.
function dedupe(state) {
  const merged = [];
  for (const loose of state.employees.filter((e) => !e.amoUserId)) {
    const match = findByName(state.employees.filter((e) => e.amoUserId), loose.name);
    if (!match) continue;
    absorb(state, match, loose);
    merged.push(`${loose.name} → ${match.name}`);
  }
  return merged;
}

// force = false: avval yuklanib, keyin admin o'chirgan xodimlar qayta qo'shilmaydi
function merge(state, { amoUsers = [], pbxUsers = [] }, { force = false } = {}) {
  state.imported ??= { amo: [], pbx: [] };
  const seenAmo = new Set(state.imported.amo);
  const seenPbx = new Set(state.imported.pbx);
  const result = { added: [], linked: [], removed: [], merged: [], skipped: [] };

  for (const u of amoUsers) {
    const id = String(u.id ?? '').trim();
    const name = String(u.name ?? '').trim();
    if (!id || !name) continue;
    const known = state.employees.some((e) => String(e.amoUserId || '') === id);
    const wasSeen = seenAmo.has(id);
    seenAmo.add(id);
    if (known) continue;
    if (wasSeen && !force) {
      result.skipped.push(name); // avval yuklangan, keyin admin o'chirgan
      continue;
    }
    const match = findByName(state.employees.filter((e) => !e.amoUserId), name);
    if (match) {
      match.amoUserId = id;
      result.linked.push(match.name);
    } else {
      const sales = !u.admin && !NON_SALES_ROLE.test(String(u.role || '').trim()) && !NON_SALES_ROLE.test(name);
      state.employees.push(newEmployee(name, { amoUserId: id, active: sales }));
      result.added.push(sales ? name : `${name} (faol emas)`);
    }
  }

  for (const u of pbxUsers) {
    const num = String(u.num ?? '').trim();
    const name = String(u.name ?? '').trim();
    // ismsiz yoki ismi faqat raqam bo'lgan yozuvni kimligini bilib bo'lmaydi
    if (!num || !name || /^[\d\s+()-]+$/.test(name)) continue;
    const known = state.employees.some((e) => (e.extensions || []).map(String).includes(num));
    const wasSeen = seenPbx.has(num);
    seenPbx.add(num);
    if (known || (wasSeen && !force)) continue;
    const match = findByName(state.employees, name);
    if (match) {
      match.extensions = [...new Set([...(match.extensions || []), num])];
      result.linked.push(match.name);
    } else {
      state.employees.push(newEmployee(name, { extensions: [num] }));
      result.added.push(name);
    }
  }

  result.merged = dedupe(state);

  // Haqiqiy xodimlar kelgach, boshlang'ich namuna "Yangi xodim" (bo'sh bo'lsa) olib tashlanadi
  if (state.employees.some((e) => e.amoUserId || (e.extensions || []).length)) {
    state.employees = state.employees.filter((e) => {
      const placeholder = fold(e.name) === fold(SEED_PLACEHOLDER) && !e.amoUserId && !(e.extensions || []).length && !e.photo && !hasData(state, e.id);
      if (placeholder) result.removed.push(e.name);
      return !placeholder;
    });
  }

  state.imported = { amo: [...seenAmo], pbx: [...seenPbx] };
  result.linked = [...new Set(result.linked)];
  return result;
}

// Ichki raqam kimniki ekanini ovozlar bo'yicha aniqlash.
// votes: [{ ext, userId, out }] — bitta qo'ng'iroq = bitta ovoz (qo'ng'iroqni amoCRM'da kim nomiga yozilgani).
// Chiquvchi qo'ng'iroqlar ishonchliroq (kiruvchi javobsizlar ko'pincha rahbar nomiga yoziladi),
// shuning uchun ular yetarli bo'lsa faqat o'shalar hisoblanadi.
// amoUsers berilsa: raqamdan faol qo'ng'iroq qilayotgan odam xodimlar ro'yxatida bo'lmasa (masalan, avval
// o'chirilgan), u qayta qo'shiladi — qo'ng'iroq qilayotgan sotuvchining natijasi doskadan tushib qolmasligi uchun.
function linkExtensions(state, votes, freeExts, amoUsers = []) {
  const linked = [];
  const taken = new Set(state.employees.flatMap((e) => (e.extensions || []).map(String)));
  for (const ext of freeExts.map(String)) {
    if (taken.has(ext)) continue;
    const mine = votes.filter((v) => String(v.ext) === ext);
    const outgoing = mine.filter((v) => v.out);
    const pool = outgoing.length >= 3 ? outgoing : mine;
    const count = {};
    for (const v of pool) count[v.userId] = (count[v.userId] || 0) + 1;
    const [winner, n] = Object.entries(count).sort((a, b) => b[1] - a[1])[0] || [];
    if (!winner || n < 2 || n / pool.length < 0.6) continue;
    let emp = state.employees.find((e) => String(e.amoUserId || '') === winner);
    let note = '';
    if (!emp) {
      const u = amoUsers.find((x) => String(x.id) === winner);
      const sales = u && !u.admin && !NON_SALES_ROLE.test(String(u.role || '').trim()) && !NON_SALES_ROLE.test(String(u.name || ''));
      // faqat ishonchli holatda: o'zi tergan (chiquvchi) kamida 5 ta qo'ng'iroq va sotuvchi roli
      if (!sales || outgoing.length < 3 || n < 5) continue;
      emp = newEmployee(u.name, { amoUserId: winner });
      state.employees.push(emp);
      state.imported ??= { amo: [], pbx: [] };
      state.imported.amo = [...new Set([...(state.imported.amo || []), winner])];
      note = ' (qayta qo\'shildi)';
    }
    emp.extensions = [...new Set([...(emp.extensions || []), ext])];
    taken.add(ext);
    linked.push(`${ext} → ${emp.name}${note}`);
  }
  return linked;
}

module.exports = { merge, dedupe, linkExtensions, findByName, fold };
