// AdPulce Agency dashboard — login/parol bilan himoyalangan kirish darvozasi.
// Bu fayl Vercel'da ishlaydi. Login/parol Vercel muhit o'zgaruvchilarida
// (Environment Variables) saqlanadi — kodning ichida hech qanday parol yo'q.
//
// Yo'l (URL) bo'yicha turli sahifalar turli login/parol bilan himoyalanadi.
// /jasurbekfinance parolsiz ochiladi — himoyasi faqat link hech qayerda
// e'lon qilinmaganiga (topib bo'lmasligiga) tayanadi.

const fs = require('fs');
const path = require('path');

const ROUTES = [
  {
    prefix: '/jasurbekfinance',
    file: 'finance-shaxsiy.html',
    noAuth: true,
  },
];
const DEFAULT_ROUTE = {
  file: 'dashboard.html',
  userEnv: 'BASIC_AUTH_USER',
  passEnv: 'BASIC_AUTH_PASS',
  realm: 'AdPulce Agency Dashboard',
};

module.exports = (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  const route = ROUTES.find(r => urlPath === r.prefix || urlPath.startsWith(r.prefix + '/')) || DEFAULT_ROUTE;

  if (route.noAuth) {
    try {
      const html = fs.readFileSync(path.join(__dirname, route.file), 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(html);
    } catch (err) {
      res.status(500).send('Sahifa fayli topilmadi: ' + err.message);
    }
    return;
  }

  const user = process.env[route.userEnv];
  const pass = process.env[route.passEnv];

  // Agar Vercel'da o'zgaruvchilar sozlanmagan bo'lsa, xato ko'rsatamiz
  // (parolsiz ochib qo'ymaslik uchun ataylab shunday).
  if (!user || !pass) {
    res.status(500).send(`Sozlash xatosi: ${route.userEnv} / ${route.passEnv} Vercel muhit o'zgaruvchilarida topilmadi.`);
    return;
  }

  const expected = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  const auth = req.headers['authorization'];

  if (!auth || auth !== expected) {
    res.setHeader('WWW-Authenticate', `Basic realm="${route.realm}"`);
    res.status(401).send('Kirish uchun login va parol kerak.');
    return;
  }

  try {
    const html = fs.readFileSync(path.join(__dirname, route.file), 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(html);
  } catch (err) {
    res.status(500).send('Sahifa fayli topilmadi: ' + err.message);
  }
};
