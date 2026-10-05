'use strict';

// amoCRM API v4 klienti (uzoq muddatli token bilan).
// Yutilgan bitimlar (status_id = 142) closed_at bo'yicha olinadi va
// responsible_user_id orqali xodimga bog'lanadi; summa = lead.price.

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

async function get(settings, pathAndQuery) {
  const c = cfgFrom(settings);
  if (!c.subdomain || !c.token) throw new Error('amoCRM sozlanmagan (subdomain va token kerak)');
  const res = await fetch(`https://${c.subdomain}.${c.baseDomain}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${c.token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`amoCRM xatosi HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function users(settings) {
  const json = await get(settings, '/api/v4/users?limit=250');
  return (json?._embedded?.users || []).map((u) => ({ id: String(u.id), name: u.name, email: u.email }));
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

module.exports = { cfgFrom, isConfigured, users, pipelines, wonLeads };
