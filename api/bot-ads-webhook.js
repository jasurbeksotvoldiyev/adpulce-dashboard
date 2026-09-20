// Bot 3 (reklama maslahatchisi) — Telegram webhook. Jamoa (3 kishi) istalgan
// vaqtda kreativ/reklama bo'yicha savol berishi yoki maslahat so'rashi mumkin.
// Javob berishda joriy kunlik kreativ statistikasi + (mavjud bo'lsa) video
// darslardan tayyorlangan bilim bazasi ishlatiladi.

const { sendMessage } = require('../lib/telegram');
const { askClaude } = require('../lib/claude');
const { getProjects } = require('../lib/projects');
const { getCreativeStats } = require('../lib/fb-ads');
const { getKnowledgeBase } = require('../lib/knowledge');

function getAllowedIds() {
  return (process.env.TEAM_ALLOWED_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

async function buildContext() {
  const projects = await getProjects();
  const lines = [];
  for (const p of projects) {
    try {
      const ads = await getCreativeStats(p.fbAccountId, 'today');
      const adLines = ads.map(a => `  - ${a.adName}: sarf=${a.spend} ${p.currency}, lead=${a.leads}, narxi=${a.cpl ?? '—'}`).join('\n') || '  (bugun ma\'lumot yo\'q)';
      lines.push(`${p.name} (KPI: ${p.kpiLeadPrice} ${p.currency}):\n${adLines}`);
    } catch (err) {
      lines.push(`${p.name}: xato — ${err.message}`);
    }
  }
  return lines.join('\n\n');
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).json({ ok: true });
    return;
  }

  const expectedSecret = process.env.ADS_BOT_WEBHOOK_SECRET;
  if (expectedSecret && req.headers['x-telegram-bot-api-secret-token'] !== expectedSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const botToken = process.env.ADS_BOT_TOKEN;
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
      await sendMessage(botToken, chatId, "Salom! Men AdPulce reklama maslahatchisiman. Kreativlar, auditoriya yoki byudjet bo'yicha savolingizni yozing.");
      return;
    }

    const [context, knowledge] = await Promise.all([buildContext(), getKnowledgeBase()]);

    const system = `Sen AdPulce reklama agentligining ichki target-reklama maslahatchisisan. Jamoa a'zolari senga kreativlar, auditoriya, byudjet bo'yicha maslahat so'rashadi.

Bugungi loyihalar va kreativlar holati:
${context || "Hozircha loyiha qo'shilmagan."}
${knowledge ? `\nQo'shimcha bilim bazasi (target bo'yicha ichki qoidalar):\n${knowledge}` : ''}

Qisqa, amaliy va o'zbek tilida javob ber. Agar aniq raqamli ma'lumot yo'q bo'lsa, umumiy target-reklama tajribangga tayanib maslahat ber.`;

    const answer = await askClaude({
      system,
      messages: [{ role: 'user', content: text }],
      maxTokens: 700,
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
