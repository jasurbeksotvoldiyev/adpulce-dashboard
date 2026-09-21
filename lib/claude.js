// To'g'ridan-to'g'ri Anthropic API orqali Claude'ga savol yuborish.
// ANTHROPIC_API_KEY environment variable orqali beriladi (console.anthropic.com).

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

// Claude javobi Markdown'da keladi, Telegram esa HTML rejimida yuboriladi — shuning uchun
// belgilarni escape qilib, **qalin** / sarlavha / ro'yxatni Telegram HTML'iga aylantiramiz.
function toTelegramHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^\s*[-*]\s+/gm, '• ');
}

async function askClaude({ system, messages, maxTokens = 1024 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY sozlanmagan');

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(`Claude API xatosi: ${data.error?.message || r.status}`);
  return toTelegramHtml((data.content || []).map(b => b.text || '').join('\n').trim());
}

module.exports = { askClaude, toTelegramHtml };
