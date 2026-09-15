// AdPulce Agency dashboard — login/parol bilan himoyalangan kirish darvozasi.
// Bu fayl Vercel'da ishlaydi. Login/parol Vercel muhit o'zgaruvchilarida
// (Environment Variables) saqlanadi — kodning ichida hech qanday parol yo'q.

const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;

  // Agar Vercel'da o'zgaruvchilar sozlanmagan bo'lsa, xato ko'rsatamiz
  // (parolsiz ochib qo'ymaslik uchun ataylab shunday).
  if (!user || !pass) {
    res.status(500).send('Sozlash xatosi: BASIC_AUTH_USER / BASIC_AUTH_PASS Vercel muhit o\'zgaruvchilarida topilmadi.');
    return;
  }

  const expected = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  const auth = req.headers['authorization'];

  if (!auth || auth !== expected) {
    res.setHeader('WWW-Authenticate', 'Basic realm="AdPulce Agency Dashboard"');
    res.status(401).send('Kirish uchun login va parol kerak.');
    return;
  }

  try {
    const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(html);
  } catch (err) {
    res.status(500).send('Dashboard fayli topilmadi: ' + err.message);
  }
};
