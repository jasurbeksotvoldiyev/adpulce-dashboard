// Bot 2 — har kuni ~23:59 (Toshkent) klient guruhlariga o'z loyihasi bo'yicha kunlik hisobot yuboradi.
// Tashqi cron (GitHub Actions) GET bilan chaqiradi: /api/bot-client-daily-report?secret=CRON_SECRET

const { sendMessage } = require('../lib/telegram');
const { getProjects } = require('../lib/projects');
const { buildClientDailyReport } = require('../lib/client-report');

async function notifyTeam(text) {
  const token = process.env.TEAM_BOT_TOKEN;
  if (!token) return;
  const ids = (process.env.TEAM_ALLOWED_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const id of ids) await sendMessage(token, id, text).catch(() => {});
}

module.exports = async (req, res) => {
  if (!process.env.CRON_SECRET || req.query.secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const botToken = process.env.CLIENT_BOT_TOKEN;
  if (!botToken) {
    res.status(500).json({ error: 'CLIENT_BOT_TOKEN sozlanmagan' });
    return;
  }

  try {
    const projects = (await getProjects()).filter(p => p.groupChatId);
    const summary = { groups: projects.length, sent: 0, skippedNoActivity: 0, failed: [] };

    for (const p of projects) {
      try {
        const text = await buildClientDailyReport(p);
        if (!text) { summary.skippedNoActivity++; continue; }
        await sendMessage(botToken, p.groupChatId, text);
        summary.sent++;
      } catch (err) {
        summary.failed.push(`${p.name}: ${err.message}`);
      }
    }

    if (summary.failed.length) {
      await notifyTeam(`⚠️ <b>Klient guruhlariga hisobot yuborilmadi</b>\n\n${summary.failed.join('\n')}`);
    }
    res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
