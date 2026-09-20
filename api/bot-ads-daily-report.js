// Bot 3 — kunlik (har kuni ~23:59, Asia/Tashkent) kreativ tahlili. Tashqi cron
// xizmati shu endpointni GET bilan chaqiradi:
//   https://.../api/bot-ads-daily-report?secret=CRON_SECRET

const { sendMessage } = require('./lib/telegram');
const { getProjects } = require('./lib/projects');
const { analyzeProject, buildAnalysisText, buildAdviceText } = require('./lib/ads-analysis');

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

  const botToken = process.env.ADS_BOT_TOKEN;
  if (!botToken) {
    res.status(500).json({ error: 'ADS_BOT_TOKEN sozlanmagan' });
    return;
  }

  try {
    const projects = await getProjects();
    const ids = getAllowedIds();
    let sent = 0;

    for (const project of projects) {
      try {
        const result = await analyzeProject(project);
        let text = buildAnalysisText(result);
        const advice = await buildAdviceText(result);
        if (advice) text += `\n\n💡 <b>Tavsiya:</b>\n${advice}`;

        for (const chatId of ids) {
          await sendMessage(botToken, chatId, text).catch(() => {});
        }
        sent++;
      } catch (err) {
        for (const chatId of ids) {
          await sendMessage(botToken, chatId, `⚠️ <b>${project.name}</b> tahlilida xato: ${err.message}`).catch(() => {});
        }
      }
    }

    res.status(200).json({ ok: true, projectsAnalyzed: sent, total: projects.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
