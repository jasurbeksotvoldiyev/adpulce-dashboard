// Loyihalar ro'yxatini bulutda (KV) saqlash/o'qish — projects-admin.html shu orqali ishlaydi.

const { getProjects, saveProjects } = require('../lib/projects');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const projects = await getProjects();
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(projects);
      return;
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!Array.isArray(body)) {
        res.status(400).json({ error: "Noto'g'ri format: massiv kutilgan edi" });
        return;
      }
      await saveProjects(body);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
