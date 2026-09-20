// Botlarning asosiy ma'lumot manbai: soatlik yangilanadigan history.json (dashboard
// avtomatikasi Facebook Ads'dan MCP orqali yig'ib repo'ga yozadi). Facebook ilovasi
// (FB_APP_ID) Meta tomonidan bloklangani uchun Graph API'ga to'g'ridan-to'g'ri
// murojaat qilinmaydi.

const HISTORY_URL = 'https://raw.githubusercontent.com/jasurbeksotvoldiyev/adpulce-dashboard/main/history.json';
const EXTERNAL_URL = 'https://raw.githubusercontent.com/jasurbeksotvoldiyev/adpulce-dashboard/main/external-stats.json';
const EXTERNAL_MAX_AGE_MIN = 180;
const ADS_URL = 'https://raw.githubusercontent.com/jasurbeksotvoldiyev/adpulce-dashboard/main/ads-daily.json';
const CACHE_MS = 60 * 1000;

let cache = { at: 0, data: null };
let adsCache = { at: 0, data: null };

// Meta Ads MCP yoqilmagan akkauntlar (masalan Super Kitobxon) ma'lumoti Ads Manager'dan
// mahalliy vazifa orqali external-stats.json ga yoziladi va shu yerda history'ga qo'shiladi.
async function loadExternal() {
  try {
    const r = await fetch(EXTERNAL_URL);
    return r.ok ? await r.json() : null;
  } catch (e) {
    return null;
  }
}

function mergeExternal(history, ext) {
  if (!ext) return;
  for (const [day, byKey] of Object.entries(ext.days || {})) {
    history.days[day] = history.days[day] || {};
    Object.assign(history.days[day], byKey);
  }
  history.campaigns = history.campaigns || {};
  for (const [day, byKey] of Object.entries(ext.campaigns || {})) {
    history.campaigns[day] = history.campaigns[day] || {};
    Object.assign(history.campaigns[day], byKey);
  }
}

async function loadHistory() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  const [r, ext] = await Promise.all([fetch(HISTORY_URL), loadExternal()]);
  if (!r.ok) throw new Error(`history.json o'qilmadi: ${r.status}`);
  const data = await r.json();
  mergeExternal(data, ext);
  data.__externalUpdatedAt = ext && ext.updatedAt ? Date.parse(ext.updatedAt) : null;
  cache = { at: Date.now(), data };
  return cache.data;
}

// Asia/Tashkent DST qilmaydi — doimiy UTC+5
function tashkentDay(offsetDays = 0) {
  return new Date(Date.now() + 5 * 3600 * 1000 + offsetDays * 86400 * 1000).toISOString().slice(0, 10);
}

// Kechki hisobotlar 23:59 ga rejalashtirilgan, lekin cron ba'zan kechikib yarim tundan
// keyin ishga tushadi — bunda "bugun" o'rniga hisobot kuni sifatida KECHA olinadi.
function isPastMidnightRun() {
  return new Date(Date.now() + 5 * 3600 * 1000).getUTCHours() < 6;
}

function reportDay() {
  return tashkentDay(isPastMidnightRun() ? -1 : 0);
}

function shiftDay(day, offsetDays) {
  return new Date(Date.parse(day + 'T00:00:00Z') + offsetDays * 86400 * 1000).toISOString().slice(0, 10);
}

function dayFor(datePreset) {
  if (datePreset === 'yesterday') return tashkentDay(-1);
  if (datePreset === 'report') return reportDay();
  return tashkentDay(0);
}

function requireKey(project) {
  // Ma'lumot manbai vaqtincha yo'q loyiha (masalan Meta Ads MCP yoqilmagan) — tushunarli xabar bilan
  if (project.dataUnavailable) {
    const err = new Error(`ma'lumot hozircha mavjud emas (${project.dataUnavailable})`);
    err.unavailable = true;
    throw err;
  }
  if (!project.historyKey) {
    throw new Error(`"${project.name}" dashboard ma'lumotiga ulanmagan (historyKey yo'q)`);
  }
  return project.historyKey;
}

// Tashqi manbali loyihada bugungi ma'lumot eskirgan bo'lsa (vazifa ishlamayotgan bo'lsa),
// noto'g'ri raqam ko'rsatmaslik uchun "mavjud emas" deb qaytariladi.
function assertExternalFresh(project, history, day) {
  if (!project.externalSource || day !== tashkentDay(0)) return;
  // Vazifa kunduzi (08:15–23:15) ishlaydi; tunda tekshiruv yo'q
  if (new Date(Date.now() + 5 * 3600 * 1000).getUTCHours() < 9) return;
  const at = history.__externalUpdatedAt;
  const ageMin = at ? (Date.now() - at) / 60000 : Infinity;
  if (ageMin > EXTERNAL_MAX_AGE_MIN) {
    const err = new Error(`ma'lumot eskirgan${at ? ` (oxirgi yangilanish ${new Date(at + 5 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')})` : ''}`);
    err.unavailable = true;
    throw err;
  }
}

async function getProjectStatsByDay(project, day) {
  const key = requireKey(project);
  const history = await loadHistory();
  assertExternalFresh(project, history, day);
  const row = (history.days[day] || {})[key] || { spend: 0, leads: 0 };
  const spend = Number(row.spend) || 0;
  const leads = Number(row.leads) || 0;
  return { spend, leads, cpl: leads > 0 ? spend / leads : null, day };
}

async function getProjectStats(project, datePreset = 'today') {
  const stats = await getProjectStatsByDay(project, dayFor(datePreset));
  return { ...stats, datePreset };
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

// Reklama (ad) darajasidagi kunlik ma'lumot — kunlik vazifa (adpulce-daily-ads-snapshot)
// Meta Ads MCP orqali yig'ib ads-daily.json ga yozadi.
async function loadAds() {
  if (adsCache.data && Date.now() - adsCache.at < CACHE_MS) return adsCache.data;
  const r = await fetch(ADS_URL);
  if (!r.ok) throw new Error(`ads-daily.json o'qilmadi: ${r.status}`);
  adsCache = { at: Date.now(), data: await r.json() };
  return adsCache.data;
}

// Bugungi reklama darajasidagi ma'lumot bo'lsa shuni, bo'lmasa kampaniya darajasini qaytaradi
async function getProjectCreatives(project) {
  const key = requireKey(project);
  try {
    const file = await loadAds();
    const list = file && file.date === reportDay() && file.ads ? file.ads[key] : null;
    if (Array.isArray(list)) {
      return {
        level: 'ad',
        items: list.map(a => {
          const spend = Number(a.spend) || 0;
          const leads = Number(a.leads) || 0;
          return {
            adName: a.campaign ? `${a.name} (${a.campaign})` : a.name,
            spend, leads, cpl: leads > 0 ? spend / leads : null,
          };
        }),
      };
    }
  } catch (e) {
    // fayl yo'q yoki eskirgan — kampaniya darajasiga qaytamiz
  }
  return { level: 'campaign', items: await getProjectCampaigns(project, 'report') };
}

module.exports = { getProjectStats, getProjectStatsByDay, getProjectCampaigns, getProjectCreatives, tashkentDay, reportDay, shiftDay };
