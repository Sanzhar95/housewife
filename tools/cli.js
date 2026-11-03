'use strict';
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');

function env() {
  const out = {};
  const file = path.join(__dirname, '..', '.env');
  if (fs.existsSync(file)) fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(l => { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); });
  return Object.assign(out, process.env);
}
function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()); }));
}
/** Пароль вводится без отображения и нигде не сохраняется. */
function askHidden(q) {
  return new Promise(res => {
    process.stdout.write(q);
    const rl = readline.createInterface({ input: process.stdin, terminal: true });
    rl._writeToOutput = () => {};
    rl.question('', a => { rl.close(); process.stdout.write('\n'); res(a); });
  });
}
/** .json листов или .xlsx (тогда превращаем через Python и openpyxl). */
function loadSheets(file) {
  if (/\.json$/i.test(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const tmp = path.join(require('node:os').tmpdir(), 'dk-sheets-' + process.pid + '.json');
  const r = spawnSync('python3', [path.join(__dirname, 'xlsx-to-sheets.py'), file, tmp], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('Не удалось прочитать xlsx (нужен python3 и openpyxl): ' + (r.stderr || r.stdout));
  const data = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.unlinkSync(tmp);
  return data;
}
async function connect() {
  const e = env();
  if (!e.SUPABASE_URL || !e.SUPABASE_ANON_KEY) throw new Error('Заполните SUPABASE_URL и SUPABASE_ANON_KEY в .env');
  const api = require('./supabase-http').create(e.SUPABASE_URL, e.SUPABASE_ANON_KEY);
  const email = await ask('Почта (аккаунт владельца семьи): ');
  const pass = await askHidden('Пароль: ');
  await api.login(email, pass);
  return api;
}
module.exports = { ask, askHidden, loadSheets, connect };
