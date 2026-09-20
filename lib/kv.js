// Umumiy bulut (Redis/KV) o'qish-yozish yordamchisi. agentstvo-data.js'dagi bilan
// bir xil Vercel KV / Upstash ulanishidan foydalanadi (KV_REST_API_URL/TOKEN yoki
// UPSTASH_REDIS_REST_URL/TOKEN environment variable'lari).

function getConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

async function kvGetRaw(key) {
  const { url, token } = getConfig();
  if (!url || !token) throw new Error("Bulut bazasi ulanmagan (KV_REST_API_URL/TOKEN yo'q)");
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`KV GET xatosi: ${r.status}`);
  const data = await r.json();
  return data.result;
}

async function kvSetRaw(key, value) {
  const { url, token } = getConfig();
  if (!url || !token) throw new Error("Bulut bazasi ulanmagan (KV_REST_API_URL/TOKEN yo'q)");
  const r = await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`KV SET xatosi: ${r.status}`);
  return r.json();
}

async function getJSON(key, fallback = null) {
  const raw = await kvGetRaw(key);
  if (raw === null || raw === undefined) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

async function setJSON(key, value) {
  return kvSetRaw(key, JSON.stringify(value));
}

module.exports = { getJSON, setJSON };
