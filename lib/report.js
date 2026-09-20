// Barcha loyihalar bo'yicha lead statistikasi va KPI holatini yig'ib, Telegram'ga
// yuborishga tayyor matn shakliga keltiradi. Bot 1'ning hisobot va KPI-tekshiruv
// endpointlari shu yerdagi funksiyalardan foydalanadi.

const { getProjects } = require('./projects');
const { getProjectStats } = require('./history');

function fmtMoney(n, currency){
  const num = Number(n) || 0;
  if(currency === 'USD') return '$' + num.toFixed(2);
  return Math.round(num).toLocaleString('uz-UZ') + " so'm";
}

/** Har loyiha uchun bugungi statistikani va KPI holatini yig'adi. */
async function collectProjectStats(datePreset = 'today') {
  const projects = await getProjects();
  const results = [];
  for (const p of projects) {
    try {
      const stats = await getProjectStats(p, datePreset);
      // Lead yo'q, lekin kamida bitta lead narxicha sarflangan bo'lsa ham KPI'dan oshgan hisoblanadi
      // KPI belgilanmagan loyihada (kpiLeadPrice yo'q) ogohlantirish berilmaydi
      const hasKpi = p.kpiLeadPrice > 0;
      const overKpi = hasKpi && (stats.cpl !== null ? stats.cpl > p.kpiLeadPrice : stats.spend >= p.kpiLeadPrice);
      results.push({ project: p, stats, overKpi, error: null });
    } catch (err) {
      results.push({ project: p, stats: null, overKpi: false, error: err.message, unavailable: !!err.unavailable });
    }
  }
  return results;
}

function buildTeamReportText(rows, datePreset) {
  const label = datePreset === 'yesterday' ? 'Kecha' : 'Bugun';
  if (rows.length === 0) {
    return `<b>${label}gi hisobot</b>\n\nHali loyiha qo'shilmagan. /loyihalar sahifasidan qo'shing.`;
  }
  const lines = rows.map(r => {
    if (r.unavailable) return `ℹ️ <b>${r.project.name}</b> — ${r.error}`;
    if (r.error) return `⚠️ <b>${r.project.name}</b> — xato: ${r.error}`;
    const { stats, project, overKpi } = r;
    const cplText = stats.cpl !== null ? fmtMoney(stats.cpl, project.currency) : (overKpi ? "lead yo'q" : '—');
    const hasKpi = project.kpiLeadPrice > 0;
    const flag = overKpi ? ' 🔴 KPI dan oshgan!' : (hasKpi ? ' ✅' : '');
    const kpiText = hasKpi ? fmtMoney(project.kpiLeadPrice, project.currency) : 'belgilanmagan';
    return `<b>${project.name}</b>\nLeadlar: ${stats.leads} · Sarf: ${fmtMoney(stats.spend, project.currency)} · Lead narxi: ${cplText} (KPI: ${kpiText})${flag}`;
  });
  return `<b>${label}gi hisobot</b>\n\n` + lines.join('\n\n');
}

module.exports = { collectProjectStats, buildTeamReportText, fmtMoney };
