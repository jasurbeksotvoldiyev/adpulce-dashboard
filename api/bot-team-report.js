// Bot 1 — davriy (masalan soatlik) umumiy hisobot. Tashqi cron xizmati
// (cron-job.org yoki mavjud avtomatlashtiruv) shu endpointni GET bilan chaqiradi:
//   https://.../api/bot-team-report?secret=CRON_SECRET

const { sendMessage } = require('./lib/telegram');
const { collectProjectStats, buildTeamReportText } = require('./lib/report');

function getAllowedIds() {
  return (process.env.TEAM_ALLOWED_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

module.exports = async (req, res) => {
  const secret = req.query.secret;
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const botToken = process.env.TEAM_BOT_TOKEN;
  if (!botToken) {
    res.status(500).json({ error: 'TEAM_BOT_TOKEN sozlanmagan' });
    return;
  }

  try {
    const rows = await collectProjectStats('today');
    const text = buildTeamReportText(rows, 'today');
    const ids = getAllowedIds();
    for (const chatId of ids) {
      await sendMessage(botToken, chatId, text).catch(() => {});
    }
    res.status(200).json({ ok: true, sentTo: ids.length, projects: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
