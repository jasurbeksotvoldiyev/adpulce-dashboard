// Bot 3'ning qo'shimcha bilim bazasi — 100+ target video darslardan tayyorlanadigan
// transkript/xulosalar shu yerga (KV'ga) matn sifatida joylanadi va har javobda
// system prompt'ga qo'shiladi. Hozircha bo'sh — keyinroq to'ldiriladi.

const { getJSON, setJSON } = require('./kv');

const KEY = 'ads_knowledge_v1';

async function getKnowledgeBase() {
  return getJSON(KEY, '');
}

async function saveKnowledgeBase(text) {
  return setJSON(KEY, text);
}

module.exports = { getKnowledgeBase, saveKnowledgeBase };
