// Bot 3 uchun: har bir kreativni "ishladi / ishlamadi / hali erta" toifasiga
// ajratadi va Claude'dan qisqa tavsiya oladi.

const { getProjectCreatives } = require('./history');
const { askClaude } = require('./claude');
const { fmtMoney } = require('./report');

/** Kreativni baholash uchun minimal sarf chegarasi — KPI'ning yarmi (valyutadan
    qat'i nazar loyihaga mos ravishda o'lchanadi). Shundan kam sarflangan bo'lsa,
    hali xulosa chiqarish erta hisoblanadi. */
function classify(ad, kpiLeadPrice) {
  const minSpend = kpiLeadPrice * 0.5;
  if (ad.spend < minSpend) return 'erta';
  if (ad.leads === 0) return 'ishlamadi';
  return ad.cpl <= kpiLeadPrice ? 'ishladi' : 'ishlamadi';
}

async function analyzeProject(project) {
  const { level, items } = await getProjectCreatives(project);
  const classified = items.map(ad => ({ ...ad, verdict: classify(ad, project.kpiLeadPrice) }));

  const working = classified.filter(a => a.verdict === 'ishladi');
  const notWorking = classified.filter(a => a.verdict === 'ishlamadi');
  const early = classified.filter(a => a.verdict === 'erta');

  return { project, level, ads: classified, working, notWorking, early };
}

function formatAdLine(ad, currency) {
  const cplText = ad.cpl !== null ? fmtMoney(ad.cpl, currency) : '—';
  return `• ${ad.adName} — sarf ${fmtMoney(ad.spend, currency)}, lead ${ad.leads}, narxi ${cplText}`;
}

function buildAnalysisText(result) {
  const { project, level, working, notWorking, early } = result;
  const heading = level === 'ad'
    ? 'kunlik kreativ tahlili'
    : "kunlik kampaniya tahlili (reklama darajasidagi ma'lumot hali yo'q)";
  const parts = [`<b>${project.name}</b> — ${heading}`];

  if (working.length) {
    parts.push(`✅ <b>Ishladi:</b>\n` + working.map(a => formatAdLine(a, project.currency)).join('\n'));
  }
  if (notWorking.length) {
    parts.push(`🔴 <b>Ishlamadi:</b>\n` + notWorking.map(a => formatAdLine(a, project.currency)).join('\n'));
  }
  if (early.length) {
    parts.push(`⏳ <b>Hali erta (sarf kam):</b>\n` + early.map(a => formatAdLine(a, project.currency)).join('\n'));
  }
  if (!working.length && !notWorking.length && !early.length) {
    parts.push("Bugun bu loyiha bo'yicha reklama ma'lumoti topilmadi.");
  }
  return parts.join('\n\n');
}

async function buildAdviceText(result) {
  const { project, level, working, notWorking, early } = result;
  if (notWorking.length === 0) return null;
  const unit = level === 'ad' ? 'kreativlar' : 'kampaniyalar';

  const context = `Loyiha: ${project.name} (KPI lead narxi: ${project.kpiLeadPrice} ${project.currency})
Ishlamagan ${unit}:
${notWorking.map(a => `- ${a.adName}: sarf ${a.spend} ${project.currency}, lead ${a.leads}, narxi ${a.cpl ?? '—'}`).join('\n')}
Ishlagan ${unit} soni: ${working.length}, hali erta bo'lganlar: ${early.length}`;

  return askClaude({
    system: `Sen target reklama bo'yicha tajribali maslahatchisan. Quyidagi ${level === 'ad' ? 'kreativ' : 'kampaniya'} tahlili asosida NEGA ishlamagan bo'lishi mumkinligi va nima qilish kerakligi haqida 3-4 qisqa amaliy tavsiya ber (masalan: kreativni to'xtatish, auditoriyani o'zgartirish, byudjetni qayta taqsimlash, yangi kreativ sinash). O'zbek tilida, qisqa va aniq yoz.`,
    messages: [{ role: 'user', content: context }],
    maxTokens: 400,
  }).catch(() => null);
}

module.exports = { analyzeProject, buildAnalysisText, buildAdviceText };
