// Telegram Bot API bilan ishlash uchun kichik yordamchi funksiyalar.
// Har bot o'z tokeni bilan ishlaydi — token chaqiruvchi tomonidan beriladi.

async function sendMessage(botToken, chatId, text, extra = {}) {
  const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      ...extra,
    }),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(`Telegram xatosi: ${data.description || r.status}`);
  return data.result;
}

module.exports = { sendMessage };
