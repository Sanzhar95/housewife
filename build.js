#!/usr/bin/env node
// Создаёт public/config.js из файла .env (локально) или из переменных окружения (Cloudflare Pages).
// Токен не хранится в git, но попадает на сам сайт: см. раздел «Безопасность» в README.
const fs = require('fs');
const path = require('path');

function readDotEnv() {
  const file = path.join(__dirname, '.env');
  const out = {};
  if (!fs.existsSync(file)) return out;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
  return out;
}

const env = Object.assign({}, readDotEnv(), process.env);
const KEYS = ['API_URL', 'API_TOKEN', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const cfg = {};
KEYS.forEach(function (k) { if (env[k]) cfg[k] = env[k]; });

if (!cfg.API_URL || !cfg.API_TOKEN) {
  console.error('Не заданы API_URL и API_TOKEN. Заполните .env (локально) или переменные окружения в Cloudflare Pages.');
  process.exit(1);
}

fs.writeFileSync(
  path.join(__dirname, 'public', 'config.js'),
  'window.APP_CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n'
);
console.log('public/config.js создан. Ключи: ' + Object.keys(cfg).join(', '));
