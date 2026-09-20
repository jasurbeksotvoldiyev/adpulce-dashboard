// Bot 2 (klient boti) — har klient /start <KOD> yuborib o'z loyihasini bir marta
// bog'laydi, shundan keyin istalgan vaqtda yozib o'z loyihasi bo'yicha bugungi/
// kechagi lead narxini so'rashi mumkin. Har klient FAQAT o'zining loyihasini ko'radi.

const { sendMessage } = require('../lib/telegram');
const { askClaude } = require('../lib/claude');
const { getProjects, saveProjects } = require('../lib/projects');
const { getProjectStats } = require('../lib/history');
const { fmtMoney } = require('../lib/report');

function findByCode(projects, code) {
  const norm = (code || '').trim().toUpperCase();
  return projects.find(p => p.clientCode === norm);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function teamIds() {
  return (process.env.TEAM_ALLOWED_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Guruh buyruqlari. Guruhni faqat agentlik xodimlari (TEAM_ALLOWED_IDS) ulay oladi —
// aks holda kod nomi ma'lum bo'lgani uchun begona guruh boshqa klient hisobotini olib qo'yishi mumkin edi.
async function handleGroup(botToken, message) {
  const chatId = message.chat.id;
  const text = message.text.trim().replace(/^(\/[A-Za-z_]+)@\w+/, '$1');
  const [cmd, arg] = text.split(/\s+/);
  const isTeam = teamIds().includes(String(message.from && message.from.id));
  const projects = await getProjects();
  const mine = projects.filter(p => String(p.groupChatId) === String(chatId));

  if (cmd === '/start' || cmd === '/ulash') {
    if (!arg) {
      await sendMessage(botToken, chatId, "Salom! Bu guruhni loyihaga ulash uchun agentlik xodimi <code>/ulash KOD</code> deb yozsin (masalan /ulash BOOKING). Ulangach har kuni 23:59 da shu loyiha bo'yicha kunlik hisobot yuboraman.");
      return;
    }
    if (!isTeam) {
      await sendMessage(botToken, chatId, "Guruhni faqat agentlik xodimlari ulay oladi.");
      return;
    }
    const project = findByCode(projects, arg);
    if (!project) {
      await sendMessage(botToken, chatId, "Bunday kod topilmadi. Kodni tekshiring.");
      return;
    }
    project.groupChatId = chatId;
    project.groupTitle = message.chat.title || String(chatId);
    await saveProjects(projects);
    await sendMessage(botToken, chatId, `✅ Bu guruh <b>${esc(project.name)}</b> loyihasiga ulandi.\n\nHar kuni soat 23:59 da shu loyiha bo'yicha kunlik hisobot yuboraman. Hozirgi holatni bilish uchun /bugun yoki /kecha deb yozing.`);
    return;
  }

  if (cmd === '/uzish') {
    if (!isTeam) return;
    const target = arg ? findByCode(projects, arg) : null;
    const list = target ? [target] : mine;
    list.forEach(p => { if (String(p.groupChatId) === String(chatId)) { p.groupChatId = null; p.groupTitle = null; } });
    await saveProjects(projects);
    await sendMessage(botToken, chatId, "Guruh loyihadan uzildi.");
    return;
  }

  if (cmd === '/bugun' || cmd === '/kecha' || cmd === '/hisobot') {
    if (!mine.length) {
      await sendMessage(botToken, chatId, "Bu guruh hali loyihaga ulanmagan. Agentlik xodimi /ulash KOD deb yozsin.");
      return;
    }
    const preset = cmd === '/kecha' ? 'yesterday' : 'today';
    for (const p of mine) {
      const stats = await getProjectStats(p, preset);
      await sendMessage(botToken, chatId, formatClientStats(p, stats, preset === 'yesterday' ? 'Kecha' : 'Bugun'));
    }
  }
}

async function notifyTeam(text) {
  const token = process.env.TEAM_BOT_TOKEN;
  if (!token) return;
  const ids = (process.env.TEAM_ALLOWED_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const id of ids) await sendMessage(token, id, text).catch(() => {});
}

function findByChatId(projects, chatId) {
  return projects.find(p => String(p.clientChatId) === String(chatId));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).json({ ok: true });
    return;
  }

  const expectedSecret = process.env.CLIENT_BOT_WEBHOOK_SECRET;
  if (expectedSecret && req.headers['x-telegram-bot-api-secret-token'] !== expectedSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const botToken = process.env.CLIENT_BOT_TOKEN;
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const message = body && body.message;

  if (!message || !message.text || !botToken) {
    res.status(200).json({ ok: true });
    return;
  }

  const chatId = message.chat.id;
  const text = message.text.trim();

  try {
    if (message.chat.type === 'group' || message.chat.type === 'supergroup') {
      await handleGroup(botToken, message);
      return;
    }

    const projects = await getProjects();
    const linked = findByChatId(projects, chatId);

    // --- bog'lash: /start KOD yoki /start (deep-link kodsiz) ---
    if (text.startsWith('/start')) {
      const parts = text.split(/\s+/);
      const code = parts[1];
      if (!code) {
        if (linked) {
          await sendMessage(botToken, chatId, `Siz allaqachon <b>${linked.name}</b> loyihasiga bog'langansiz. Bugungi holatni bilish uchun "bugun" deb yozing.`);
        } else {
          await sendMessage(botToken, chatId, "Salom! Loyihangizni bog'lash uchun sizga berilgan kodni yuboring (masalan: /start ABC123).");
        }
        return;
      }
      const project = findByCode(projects, code);
      if (!project) {
        await sendMessage(botToken, chatId, "Bunday kod topilmadi. Kodni to'g'ri kiritganingizga ishonch hosil qiling yoki agentligingizga murojaat qiling.");
        return;
      }
      // Kod loyiha nomidan olingani uchun oson topiladi — shuning uchun bitta loyiha faqat
      // BIR hisobga bog'lanadi va bog'lanish haqida jamoaga xabar boradi.
      if (project.clientChatId && String(project.clientChatId) !== String(chatId)) {
        await sendMessage(botToken, chatId, "Bu loyiha allaqachon boshqa hisobga bog'langan. Agentligingizga murojaat qiling.");
        return;
      }
      if (linked && linked.id !== project.id) {
        await sendMessage(botToken, chatId, `Siz allaqachon <b>${esc(linked.name)}</b> loyihasiga bog'langansiz.`);
        return;
      }
      const firstTime = !project.clientChatId;
      const from = message.from || {};
      const label = [from.first_name, from.last_name].filter(Boolean).join(' ') + (from.username ? ` (@${from.username})` : '');
      project.clientChatId = chatId;
      project.clientLabel = label.trim() || String(chatId);
      await saveProjects(projects);
      await sendMessage(botToken, chatId, `✅ Loyihangiz bog'landi: <b>${esc(project.name)}</b>\n\nEndi istalgan vaqtda "bugun" yoki "kecha" deb yozib lead narxini bilib olishingiz mumkin, yoki savolingizni yozing.`);
      if (firstTime) await notifyTeam(`🔗 <b>Klient bog'landi</b>\n\nLoyiha: <b>${esc(project.name)}</b>\nHisob: ${esc(project.clientLabel)}\n\nAgar bu siz kutgan klient bo'lmasa, /loyihalar sahifasidan "Uzish" tugmasini bosing.`);
      return;
    }

    if (!linked) {
      await sendMessage(botToken, chatId, "Hali loyihangiz bog'lanmagan. Sizga berilgan kodni yuboring (masalan: /start ABC123).");
      return;
    }

    // --- tezkor kalit so'zlar (faqat SO'Z sifatida yolg'iz yozilsa — "bugun narxi
    // qanday?" kabi to'liq savollar pastdagi Claude'ga tushishi uchun aniq moslik kerak) ---
    const normalized = text.toLowerCase().trim().replace(/[?!.,]+$/, '');
    if (normalized === 'kecha') {
      const stats = await getProjectStats(linked, 'yesterday');
      await sendMessage(botToken, chatId, formatClientStats(linked, stats, 'Kecha'));
      return;
    }
    if (normalized === 'bugun') {
      const stats = await getProjectStats(linked, 'today');
      await sendMessage(botToken, chatId, formatClientStats(linked, stats, 'Bugun'));
      return;
    }

    // --- erkin savol — faqat shu klientning o'z loyihasi konteksti bilan ---
    const todayStats = await getProjectStats(linked, 'today').catch(() => null);
    const yesterdayStats = await getProjectStats(linked, 'yesterday').catch(() => null);
    const context = `Loyiha: ${linked.name}
Bugun: ${todayStats ? `leadlar=${todayStats.leads}, sarf=${todayStats.spend}, lead narxi=${todayStats.cpl ?? '—'}` : "ma'lumot yo'q"}
Kecha: ${yesterdayStats ? `leadlar=${yesterdayStats.leads}, sarf=${yesterdayStats.spend}, lead narxi=${yesterdayStats.cpl ?? '—'}` : "ma'lumot yo'q"}
Valyuta: ${linked.currency}`;

    const answer = await askClaude({
      system: `Sen AdPulce reklama agentligining klient yordamchisisan. Faqat shu klientning O'Z loyihasi haqida gapirasan, boshqa loyihalar haqida ma'lumot yo'q va berma.
${context}

Qisqa, tushunarli va o'zbek tilida javob ber.`,
      messages: [{ role: 'user', content: text }],
    });
    await sendMessage(botToken, chatId, answer || "Kechirasiz, javob topa olmadim.");
  } catch (err) {
    const text = err.unavailable ? `Kechirasiz, ${err.message}.` : 'Xato yuz berdi: ' + err.message;
    await sendMessage(botToken, chatId, text).catch(() => {});
  } finally {
    // Javob so'nggida yuboriladi — aks holda Vercel funksiyani vaqtidan oldin
    // to'xtatib qo'yishi va Telegram'ga xabar yetib bormasligi mumkin edi.
    res.status(200).json({ ok: true });
  }
};

function formatClientStats(project, stats, label) {
  const cplText = stats.cpl !== null ? fmtMoney(stats.cpl, project.currency) : '—';
  return `<b>${label} — ${project.name}</b>\n\nLeadlar: ${stats.leads}\nSarf: ${fmtMoney(stats.spend, project.currency)}\nLead narxi: ${cplText}`;
}
