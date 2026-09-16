// Agentstvo moliya ma'lumotlarini bulutda (Redis/KV) saqlash — shu orqali
// barcha kompyuterlardan/brauzerlardan bir xil ma'lumot ko'rinadi.
//
// Buning uchun Vercel loyihasiga Storage bo'limidan Redis (masalan Upstash)
// ma'lumotlar bazasi ulanishi va loyihaga bog'lanishi kerak — shunda
// quyidagi environment variable'lar avtomatik qo'shiladi:
//   KV_REST_API_URL / KV_REST_API_TOKEN
//   (yoki to'g'ridan-to'g'ri Upstash ulansa: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)

const KEY = 'agentstvo_finance_v1';

function getConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

async function kvGet(url, token, key) {
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`KV GET xatosi: ${r.status}`);
  const data = await r.json();
  return data.result;
}

async function kvSet(url, token, key, value) {
  const r = await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`KV SET xatosi: ${r.status}`);
  return r.json();
}

module.exports = async (req, res) => {
  const { url, token } = getConfig();
  if (!url || !token) {
    res.status(500).json({
      error: "Bulut bazasi ulanmagan: Vercel loyihaga Storage → Redis (KV) qo'shing va ulang.",
    });
    return;
  }

  try {
    if (req.method === 'GET') {
      const raw = await kvGet(url, token, KEY);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(raw ? JSON.parse(raw) : null);
      return;
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || !Array.isArray(body.agencyIncome) || !Array.isArray(body.agencyExpense)) {
        res.status(400).json({ error: "Noto'g'ri ma'lumot formati" });
        return;
      }
      await kvSet(url, token, KEY, JSON.stringify(body));
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
