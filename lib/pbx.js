'use strict';

// OnlinePBX HTTP API klienti.
// 1) POST {base}/{domain}/auth.json  (auth_key=API_KEY)  -> data.key_id, data.key
// 2) So'rovlar "x-pbx-authentication: key_id:key" sarlavhasi bilan yuboriladi.
// 3) Qo'ng'iroqlar tarixi: POST {base}/{domain}/mongo_history/search.json
//    (start_stamp_from, start_stamp_to — bitta so'rovda maksimal 1 hafta).

let session = null; // { cacheKey, keyId, key }

function cfgFrom(settings) {
  const s = settings.pbx || {};
  return {
    domain: (process.env.PBX_DOMAIN || s.domain || '').trim(),
    apiKey: (process.env.PBX_API_KEY || s.apiKey || '').trim(),
    baseUrl: (process.env.PBX_API_BASE || s.baseUrl || 'https://api2.onlinepbx.ru').replace(/\/+$/, ''),
  };
}

function isConfigured(settings) {
  const c = cfgFrom(settings);
  return Boolean(c.domain && c.apiKey);
}

async function postForm(url, params, headers = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') body.append(k, String(v));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers },
    body,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`OnlinePBX javobi JSON emas (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  return json;
}

async function auth(c) {
  const json = await postForm(`${c.baseUrl}/${c.domain}/auth.json`, { auth_key: c.apiKey });
  if (String(json.status) !== '1' || !json.data?.key) {
    throw new Error(`OnlinePBX avtorizatsiya xatosi: ${json.comment || json.errorCode || JSON.stringify(json).slice(0, 200)}`);
  }
  session = { cacheKey: c.domain + '|' + c.apiKey, keyId: json.data.key_id, key: json.data.key };
  return session;
}

async function request(settings, method, params = {}) {
  const c = cfgFrom(settings);
  if (!c.domain || !c.apiKey) throw new Error('OnlinePBX sozlanmagan (domain va API kalit kerak)');
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!session || session.cacheKey !== c.domain + '|' + c.apiKey) await auth(c);
    const json = await postForm(`${c.baseUrl}/${c.domain}/${method}`, params, {
      'x-pbx-authentication': `${session.keyId}:${session.key}`,
    });
    if (String(json.status) === '1') return json.data;
    const notAuth = json.isNotAuth || /auth/i.test(String(json.comment || json.errorCode || ''));
    if (notAuth && attempt === 0) {
      session = null;
      continue;
    }
    throw new Error(`OnlinePBX xatosi (${method}): ${json.comment || json.errorCode || JSON.stringify(json).slice(0, 200)}`);
  }
  throw new Error('OnlinePBX: avtorizatsiyadan o\'tib bo\'lmadi');
}

// [fromUnix, toUnix) oralig'idagi qo'ng'iroqlar
async function fetchCalls(settings, fromUnix, toUnix) {
  const data = await request(settings, 'mongo_history/search.json', {
    start_stamp_from: fromUnix,
    start_stamp_to: toUnix - 1,
  });
  return Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
}

const num = (v) => (v === undefined || v === null ? '' : String(v).trim());

// Qo'ng'iroqdan xodimning ichki raqami(lar)ini topish uchun nomzodlar
function callNumbers(call) {
  const dir = String(call.accountcode || '').toLowerCase();
  const primary = dir === 'inbound' ? [call.destination_number, call.caller_id_number] : [call.caller_id_number, call.destination_number];
  const extra = [call.user, call.sub_number, call.user_number];
  for (const ev of Array.isArray(call.events) ? call.events : []) {
    extra.push(ev?.number, ev?.user, ev?.destination_number, ev?.caller_id_number);
  }
  return [...primary, ...extra].map(num).filter(Boolean);
}

function talkSeconds(call) {
  for (const k of ['user_talk_time', 'talk_time', 'billsec']) {
    const v = Number(call[k]);
    if (Number.isFinite(v) && v >= 0 && call[k] !== undefined && call[k] !== null && call[k] !== '') return v;
  }
  return 0;
}

module.exports = { cfgFrom, isConfigured, request, fetchCalls, callNumbers, talkSeconds, auth };
