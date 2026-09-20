// Facebook Marketing API'dan loyihaning lead statistikasini olish.
// FB_USER_TOKEN — .env / Vercel environment variable'da saqlangan uzoq muddatli token.

const LEAD_ACTION_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'];
const GRAPH_VERSION = 'v21.0';

function extractLeadCount(actions = []) {
  let total = 0;
  actions.forEach(a => {
    if (LEAD_ACTION_TYPES.includes(a.action_type)) total += Number(a.value) || 0;
  });
  return total;
}

/**
 * accountId: "act_1234567890" ko'rinishida (yoki oldiga "act_" qo'shilmagan raqam)
 * datePreset: "today" | "yesterday" | "this_month" ...
 */
async function getLeadStats(accountId, datePreset = 'today') {
  const token = process.env.FB_USER_TOKEN;
  if (!token) throw new Error('FB_USER_TOKEN sozlanmagan');
  const acc = accountId.startsWith('act_') ? accountId : `act_${accountId}`;

  const params = new URLSearchParams({
    fields: 'spend,actions',
    date_preset: datePreset,
    access_token: token,
  });
  const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${acc}/insights?${params}`);
  const data = await r.json();
  if (data.error) throw new Error(`FB Ads xatosi: ${data.error.message}`);

  const row = (data.data && data.data[0]) || { spend: '0', actions: [] };
  const spend = Number(row.spend) || 0;
  const leads = extractLeadCount(row.actions);
  const cpl = leads > 0 ? spend / leads : null;

  return { spend, leads, cpl, datePreset };
}

/**
 * Har bir reklama (ad/kreativ) darajasida statistika — Bot 3'ning kunlik
 * tahlili uchun. Qaysi kreativ ishlagani/ishlamagani shu yerdan aniqlanadi.
 */
async function getCreativeStats(accountId, datePreset = 'today') {
  const token = process.env.FB_USER_TOKEN;
  if (!token) throw new Error('FB_USER_TOKEN sozlanmagan');
  const acc = accountId.startsWith('act_') ? accountId : `act_${accountId}`;

  const params = new URLSearchParams({
    level: 'ad',
    fields: 'ad_name,spend,actions',
    date_preset: datePreset,
    limit: '200',
    access_token: token,
  });
  const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${acc}/insights?${params}`);
  const data = await r.json();
  if (data.error) throw new Error(`FB Ads xatosi: ${data.error.message}`);

  return (data.data || []).map(row => {
    const spend = Number(row.spend) || 0;
    const leads = extractLeadCount(row.actions);
    return { adName: row.ad_name || '(nomsiz)', spend, leads, cpl: leads > 0 ? spend / leads : null };
  });
}

module.exports = { getLeadStats, getCreativeStats };
