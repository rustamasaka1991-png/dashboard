'use strict';

// amoCRM API v4 klienti (uzoq muddatli token bilan).
// Yutilgan bitimlar (status_id = 142) closed_at bo'yicha olinadi va
// responsible_user_id orqali xodimga bog'lanadi; summa = lead.price.

const fail = (status, message) => Object.assign(new Error(message), { status });

function cfgFrom(settings) {
  const s = settings.amo || {};
  return {
    subdomain: (process.env.AMO_SUBDOMAIN || s.subdomain || '').trim().replace(/\.amocrm\.(ru|com)$/i, ''),
    token: (process.env.AMO_TOKEN || s.token || '').trim(),
    baseDomain: (process.env.AMO_BASE_DOMAIN || s.baseDomain || 'amocrm.ru').trim(),
    pipelineId: String(s.pipelineId || '').trim(),
    wonStatusId: Number(s.wonStatusId || 142),
  };
}

function isConfigured(settings) {
  const c = cfgFrom(settings);
  return Boolean(c.subdomain && c.token);
}

// Uzoq muddatli token (JWT) ichidagi ochiq ma'lumot: akkaunt domeni va amal qilish muddati
function tokenInfo(token) {
  try {
    const p = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return { baseDomain: typeof p.base_domain === 'string' ? p.base_domain : '', exp: Number(p.exp) || 0 };
  } catch {
    return null;
  }
}

// Subdomen kiritilmagan bo'lsa, uni tokenning o'zi orqali amoCRM'dan so'rab olamiz
async function detectSubdomain(settings) {
  const c = cfgFrom(settings);
  if (!c.token) throw fail(400, 'amoCRM sozlanmagan (token kerak)');
  const hint = "Subdomenni qo'lda kiriting (amoCRM manzilidagi xxx.amocrm.ru ning xxx qismi).";
  let res, text;
  try {
    res = await fetch(`https://www.${c.baseDomain}/oauth2/account/subdomain`, {
      headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    text = await res.text();
  } catch (err) {
    throw fail(502, `amoCRM serveriga ulanib bo'lmadi: ${err.cause?.code || err.name || err.message}. ${hint}`);
  }
  if (res.status === 401) throw fail(502, "amoCRM token noto'g'ri yoki muddati o'tgan (HTTP 401)");
  let sub = '';
  try {
    sub = String(JSON.parse(text).subdomain || '').toLowerCase();
  } catch { /* pastda xato beriladi */ }
  if (!res.ok || !/^[a-z0-9-]+$/.test(sub)) throw fail(502, `amoCRM subdomenni aniqlab bo'lmadi (HTTP ${res.status}). ${hint}`);
  return sub;
}

async function get(settings, pathAndQuery) {
  const c = cfgFrom(settings);
  if (!c.subdomain || !c.token) throw fail(400, 'amoCRM sozlanmagan (subdomain va token kerak)');
  let res, text;
  try {
    res = await fetch(`https://${c.subdomain}.${c.baseDomain}${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 204) return null;
    text = await res.text();
  } catch (err) {
    throw fail(502, `amoCRM serveriga ulanib bo'lmadi: ${err.cause?.code || err.name || err.message}`);
  }
  if (res.status === 401) throw fail(502, "amoCRM token noto'g'ri yoki muddati o'tgan (HTTP 401)");
  if (!res.ok) throw fail(502, `amoCRM xatosi HTTP ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw fail(502, `amoCRM javobi JSON emas (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
}

async function users(settings) {
  const json = await get(settings, '/api/v4/users?limit=250&with=role');
  return (json?._embedded?.users || []).map((u) => ({
    id: String(u.id), name: u.name, email: u.email,
    active: u.rights?.is_active !== false, admin: u.rights?.is_admin === true, role: u._embedded?.roles?.[0]?.name || '',
  }));
}

// OnlinePBX integratsiyasi amoCRM'ga yozgan qo'ng'iroq eslatmalari: [{ uniq (qo'ng'iroq uuid), userId }]
async function callNotes(settings, fromUnix) {
  const out = [];
  let failed = 0, lastError;
  const entities = ['leads', 'contacts', 'companies'];
  for (const entity of entities) {
    try {
      for (let page = 1; page <= 40; page++) {
        const q = `filter[note_type][]=call_in&filter[note_type][]=call_out&filter[updated_at][from]=${fromUnix}&limit=250&page=${page}`;
        const json = await get(settings, `/api/v4/${entity}/notes?${q}`);
        const notes = json?._embedded?.notes || [];
        for (const n of notes) {
          if (n.params?.uniq && n.created_by) out.push({ uniq: String(n.params.uniq), userId: String(n.created_by), out: n.note_type === 'call_out' });
        }
        if (notes.length < 250 || !json?._links?.next) break;
      }
    } catch (err) {
      failed++;
      lastError = err;
    }
  }
  if (failed === entities.length) throw lastError;
  return out;
}

async function pipelines(settings) {
  const json = await get(settings, '/api/v4/leads/pipelines');
  return (json?._embedded?.pipelines || []).map((p) => ({
    id: String(p.id),
    name: p.name,
    statuses: (p._embedded?.statuses || []).map((s) => ({ id: String(s.id), name: s.name })),
  }));
}

// [fromUnix, toUnix) oralig'ida yopilgan yutuqli bitimlar
async function wonLeads(settings, fromUnix, toUnix) {
  const c = cfgFrom(settings);
  const out = [];
  for (let page = 1; page <= 200; page++) {
    const q = new URLSearchParams({
      'filter[closed_at][from]': String(fromUnix),
      'filter[closed_at][to]': String(toUnix - 1),
      limit: '250',
      page: String(page),
    });
    if (c.pipelineId) q.append('filter[pipeline_id][]', c.pipelineId);
    const json = await get(settings, `/api/v4/leads?${q}`);
    const leads = json?._embedded?.leads || [];
    for (const l of leads) {
      if (Number(l.status_id) !== c.wonStatusId) continue;
      if (c.pipelineId && String(l.pipeline_id) !== c.pipelineId) continue;
      out.push({ id: l.id, price: Number(l.price) || 0, userId: String(l.responsible_user_id), closedAt: Number(l.closed_at) });
    }
    if (leads.length < 250 || !json?._links?.next) break;
  }
  return out;
}

module.exports = { cfgFrom, isConfigured, tokenInfo, detectSubdomain, users, callNotes, pipelines, wonLeads };
