// Botlarning asosiy ma'lumot manbai: soatlik yangilanadigan history.json (dashboard
// avtomatikasi Facebook Ads'dan MCP orqali yig'ib repo'ga yozadi). Facebook ilovasi
// (FB_APP_ID) Meta tomonidan bloklangani uchun Graph API'ga to'g'ridan-to'g'ri
// murojaat qilinmaydi.

const HISTORY_URL = 'https://raw.githubusercontent.com/jasurbeksotvoldiyev/adpulce-dashboard/main/history.json';
const CACHE_MS = 60 * 1000;

let cache = { at: 0, data: null };

async function loadHistory() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  const r = await fetch(HISTORY_URL);
  if (!r.ok) throw new Error(`history.json o'qilmadi: ${r.status}`);
  cache = { at: Date.now(), data: await r.json() };
  return cache.data;
}

// Asia/Tashkent DST qilmaydi — doimiy UTC+5
function tashkentDay(offsetDays = 0) {
  return new Date(Date.now() + 5 * 3600 * 1000 + offsetDays * 86400 * 1000).toISOString().slice(0, 10);
}

function dayFor(datePreset) {
  return datePreset === 'yesterday' ? tashkentDay(-1) : tashkentDay(0);
}

function requireKey(project) {
  if (!project.historyKey) {
    throw new Error(`"${project.name}" dashboard ma'lumotiga ulanmagan (historyKey yo'q)`);
  }
  return project.historyKey;
}

async function getProjectStats(project, datePreset = 'today') {
  const key = requireKey(project);
  const history = await loadHistory();
  const row = (history.days[dayFor(datePreset)] || {})[key] || { spend: 0, leads: 0 };
  const spend = Number(row.spend) || 0;
  const leads = Number(row.leads) || 0;
  return { spend, leads, cpl: leads > 0 ? spend / leads : null, datePreset };
}

// Kampaniya darajasidagi bo'linma — {adName, spend, leads, cpl} shaklida
async function getProjectCampaigns(project, datePreset = 'today') {
  const key = requireKey(project);
  const history = await loadHistory();
  const items = ((history.campaigns || {})[dayFor(datePreset)] || {})[key] || [];
  return items.map(c => {
    const spend = Number(c.spend) || 0;
    const leads = Number(c.leads) || 0;
    return { adName: c.name || '(nomsiz)', spend, leads, cpl: leads > 0 ? spend / leads : null };
  });
}

module.exports = { getProjectStats, getProjectCampaigns, tashkentDay };
