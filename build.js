#!/usr/bin/env node
// Создаёт public/config.js из .env (локально) или из переменных окружения (Netlify): SUPABASE_URL и SUPABASE_ANON_KEY.
// Публичный (anon) ключ попадает на сайт — это нормально: данные защищены правилами базы (RLS).
// Ключ service_role на сайт попадать не должен никогда, поэтому сборка с ним останавливается.
const fs = require('fs');
const path = require('path');

function readDotEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
  return out;
}

function jwtRole(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')).role || ''; }
  catch (e) { return ''; }
}

/** → { ok: true, config } или { ok: false, error } */
function buildConfig(env) {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) return { ok: false, error: 'Не заданы SUPABASE_URL и SUPABASE_ANON_KEY. Заполните .env (локально) или переменные окружения в Netlify.' };
  if (!/^https:\/\//.test(url)) return { ok: false, error: 'SUPABASE_URL должен начинаться с https://' };
  if (/service_role/.test(jwtRole(key)) || /^sb_secret_/.test(key)) return { ok: false, error: 'Это секретный ключ (service_role). На сайт можно только публичный ключ (anon / publishable). Остановлено.' };
  return { ok: true, config: { SUPABASE_URL: url, SUPABASE_ANON_KEY: key } };
}

function main() {
  const env = Object.assign({}, readDotEnv(path.join(__dirname, '.env')), process.env);
  const r = buildConfig(env);
  if (!r.ok) { console.error(r.error); process.exit(1); }
  const out = env.CONFIG_OUT || path.join(__dirname, 'public', 'config.js');
  fs.writeFileSync(out, 'window.APP_CONFIG = ' + JSON.stringify(r.config, null, 2) + ';\n');
  console.log('config.js создан: ' + out);
}

if (require.main === module) main();
module.exports = { buildConfig, jwtRole };
