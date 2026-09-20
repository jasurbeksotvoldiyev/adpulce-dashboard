// Bot 1 (jamoa boti) — Telegram webhook. Faqat TEAM_ALLOWED_IDS'dagi 3 kishi
// (Jasurbek, Kamoliddin, Baxrom) savol-javob qila oladi. /hisobot buyrug'i darhol
// joriy holatni chiqaradi, boshqa har qanday matn Claude'ga yuboriladi.

const { sendMessage } = require('../lib/telegram');
const { askClaude } = require('../lib/claude');
const { collectProjectStats, buildTeamReportText } = require('../lib/report');

function getAllowedIds() {
  return (process.env.TEAM_ALLOWED_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).json({ ok: true });
    return;
  }

  // Telegram webhook maxfiy tokeni (setWebhook chaqirilganda secret_token bilan birga beriladi)
  const expectedSecret = process.env.TEAM_BOT_WEBHOOK_SECRET;
  if (expectedSecret && req.headers['x-telegram-bot-api-secret-token'] !== expectedSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const botToken = process.env.TEAM_BOT_TOKEN;
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const message = body && body.message;

  if (!message || !message.text || !botToken) {
    res.status(200).json({ ok: true });
    return;
  }

  const chatId = message.chat.id;
  const fromId = String(message.from.id);
  const text = message.text.trim();

  try {
    if (!getAllowedIds().includes(fromId)) {
      await sendMessage(botToken, chatId, "Kechirasiz, bu bot faqat jamoa a'zolari uchun.");
      return;
    }

    if (text === '/start') {
      await sendMessage(botToken, chatId, "Salom! Men AdPulce jamoa botiman.\n\n/hisobot — joriy holatni ko'rish\nYoki loyihalar haqida savol bering.");
      return;
    }

    if (text === '/hisobot') {
      const rows = await collectProjectStats('today');
      await sendMessage(botToken, chatId, buildTeamReportText(rows, 'today'));
      return;
    }

    // Erkin savol — Claude'ga joriy loyiha ma'lumotlari bilan birga yuboramiz
    const rows = await collectProjectStats('today');
    const contextText = rows.map(r => {
      if (r.error) return `${r.project.name}: xato (${r.error})`;
      return `${r.project.name}: leadlar=${r.stats.leads}, sarf=${r.stats.spend}, lead narxi=${r.stats.cpl ?? '—'}, KPI=${r.project.kpiLeadPrice} ${r.project.currency}`;
    }).join('\n');

    const answer = await askClaude({
      system: `Sen AdPulce reklama agentligining ichki jamoa yordamchisisan. Jamoa a'zolari (Jasurbek, Kamoliddin, Baxrom) senga loyihalar haqida savol berishadi.
Bugungi loyihalar holati:
${contextText || 'Hozircha loyiha qo\'shilmagan.'}

Qisqa, aniq va o'zbek tilida javob ber.`,
      messages: [{ role: 'user', content: text }],
    });
    await sendMessage(botToken, chatId, answer || "Kechirasiz, javob topa olmadim.");
  } catch (err) {
    await sendMessage(botToken, chatId, 'Xato yuz berdi: ' + err.message).catch(() => {});
  } finally {
    // Javob so'nggida yuboriladi — aks holda Vercel funksiyani vaqtidan oldin
    // to'xtatib qo'yishi va Telegram'ga xabar yetib bormasligi mumkin edi.
    res.status(200).json({ ok: true });
  }
};
