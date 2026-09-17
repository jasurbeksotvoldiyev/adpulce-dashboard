// Telegram'da yangi xabar kelganda SendSeven shu endpointga so'rov yuboradi.
// Bu funksiya Claude'ning haqiqiy (kuchli) API tokenini hech qachon SendSeven'ga
// ko'rsatmaydi — token faqat shu yerda, Vercel environment variable sifatida
// saqlanadi va faqat Anthropic serveriga (ichkarida) yuboriladi.
//
// Kerakli Vercel environment variable'lar:
//   JARVIS_FIRE_URL     - claude.ai'dagi routine'ning "Fire URL"i
//   JARVIS_FIRE_TOKEN   - o'sha routine uchun generatsiya qilingan token
//   JARVIS_RELAY_SECRET - SendSeven so'rovini tasdiqlash uchun oddiy maxfiy so'z
//                         (bu Claude tokeni emas, past darajali himoya)

module.exports = async (req, res) => {
  const secret = req.query.secret || req.headers['x-relay-secret'];
  if (!process.env.JARVIS_RELAY_SECRET || secret !== process.env.JARVIS_RELAY_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // SendSeven webhook tasdiqlash so'rovi ("challenge"): kelgan qiymatni aynan
  // shu ko'rinishda qaytarib yuboramiz, hech qanday Jarvis'ni ishga tushirmasdan.
  const bodyChallenge = req.body && typeof req.body === 'object' ? req.body.challenge : undefined;
  const challenge = bodyChallenge || req.query.challenge;
  if (challenge) {
    res.status(200).json({ challenge });
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const fireUrl = process.env.JARVIS_FIRE_URL;
  const fireToken = process.env.JARVIS_FIRE_TOKEN;
  if (!fireUrl || !fireToken) {
    res.status(500).json({ error: "Vercel'da JARVIS_FIRE_URL / JARVIS_FIRE_TOKEN sozlanmagan" });
    return;
  }

  try {
    const r = await fetch(fireUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${fireToken}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({}),
    });
    const text = await r.text();
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status, body: text.slice(0, 500) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
