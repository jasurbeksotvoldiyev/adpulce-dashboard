// Bot 1 — tezkor KPI tekshiruvi (masalan har 15-30 daqiqada). Tashqi cron xizmati
// shu endpointni GET bilan chaqiradi:  https://.../api/bot-team-kpi-check?secret=CRON_SECRET
//
// Spam bo'lmasligi uchun: har loyiha uchun kuniga faqat BIR MARTA — "KPI'dan
// birinchi marta oshgan" paytda — xabar yuboriladi. Ertasi kuni holat tozalanadi.

const { sendMessage } = require('../lib/telegram');
const { collectProjectStats, fmtMoney } = require('../lib/report');
const { getJSON, setJSON } = require('../lib/kv');

const ALERT_STATE_KEY = 'kpi_alert_state_v1';

function getAllowedIds() {
  return (process.env.TEAM_ALLOWED_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function today() {
  return new Date().toISOString().slice(0, 10);
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
    const state = await getJSON(ALERT_STATE_KEY, {});
    const day = today();
    const ids = getAllowedIds();
    let alertedCount = 0;

    for (const r of rows) {
      if (r.error) continue;
      const key = r.project.id;
      const alreadyAlertedToday = state[key] && state[key].date === day;

      if (r.overKpi && !alreadyAlertedToday) {
        const text = `🔴 <b>KPI ogohlantirish</b>\n\n<b>${r.project.name}</b> loyihasining lead narxi KPI'dan oshib ketdi!\n\nLead narxi: ${fmtMoney(r.stats.cpl, r.project.currency)}\nKPI: ${fmtMoney(r.project.kpiLeadPrice, r.project.currency)}`;
        for (const chatId of ids) {
          await sendMessage(botToken, chatId, text).catch(() => {});
        }
        state[key] = { date: day, alerted: true };
        alertedCount++;
      } else if (!r.overKpi && state[key] && state[key].date === day) {
        // Kun ichida tuzalgan bo'lsa, xabar holatini tozalaymiz — yana oshsa qayta xabar beriladi
        delete state[key];
      }
    }

    await setJSON(ALERT_STATE_KEY, state);
    res.status(200).json({ ok: true, checked: rows.length, alerted: alertedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
