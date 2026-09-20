// Loyihalar registri: har loyihaning FB akkaunti, KPI (maqsad lead narxi) va
// klient bog'lanish kodi shu yerda saqlanadi. projects-admin.html orqali tahrirlanadi.

const { getJSON, setJSON } = require('./kv');

const KEY = 'projects_v1';

/* Loyiha shakli:
   { id, name, fbAccountId, kpiLeadPrice, currency, clientCode, clientChatId } */

async function getProjects() {
  return getJSON(KEY, []);
}

async function saveProjects(projects) {
  return setJSON(KEY, projects);
}

module.exports = { getProjects, saveProjects };
