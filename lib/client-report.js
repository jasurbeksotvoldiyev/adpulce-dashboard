// Klient guruhlariga yuboriladigan kunlik hisobot matni (faqat shu loyihaning o'z ma'lumoti).

const { getProjectStatsByDay, reportDay, shiftDay } = require('./history');
const { fmtMoney } = require('./report');

function line(stats, currency) {
  const cpl = stats.cpl !== null ? fmtMoney(stats.cpl, currency) : '—';
  return `${stats.leads} lead · ${fmtMoney(stats.spend, currency)} · narxi ${cpl}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Hisobot matnini qaytaradi; hech qanday reklama faoliyati bo'lmasa null (yuborilmaydi). */
async function buildClientDailyReport(project) {
  const day = reportDay();
  const [today, prev] = await Promise.all([
    getProjectStatsByDay(project, day),
    getProjectStatsByDay(project, shiftDay(day, -1)),
  ]);
  if (today.spend === 0 && today.leads === 0) return null;

  const diff = today.leads - prev.leads;
  const trend = prev.leads === 0 && prev.spend === 0
    ? ''
    : `\n\nKecha: ${line(prev, project.currency)}\nLeadlar kechaga nisbatan: ${diff > 0 ? '+' : ''}${diff}`;

  return `📊 <b>${esc(project.name)} — kunlik hisobot</b>\n📅 ${day}\n\nLeadlar: <b>${today.leads}</b>\nSarf: <b>${fmtMoney(today.spend, project.currency)}</b>\nLead narxi: <b>${today.cpl !== null ? fmtMoney(today.cpl, project.currency) : '—'}</b>${trend}`;
}

module.exports = { buildClientDailyReport };
