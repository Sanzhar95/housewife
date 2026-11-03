'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildConfig } = require('../build.js');

const root = path.join(__dirname, '..');
const jwt = role => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.sig';
const run = env => spawnSync(process.execPath, [path.join(root, 'build.js')], { env: Object.assign({ PATH: process.env.PATH }, env), encoding: 'utf8' });

test('build.js без переменных: ненулевой код и сообщение по-русски', () => {
  const r = run({ CONFIG_OUT: path.join(os.tmpdir(), 'never.js') });
  // .env разработчика может подставить значения — тогда этот тест не про это
  if (fs.existsSync(path.join(root, '.env'))) return;
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /Не заданы SUPABASE_URL и SUPABASE_ANON_KEY/);
});

test('build.js с переменными пишет config.js с обоими значениями', () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-')), 'config.js');
  const r = run({ SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_ANON_KEY: jwt('anon'), CONFIG_OUT: out });
  assert.strictEqual(r.status, 0, r.stderr);
  const text = fs.readFileSync(out, 'utf8');
  assert.match(text, /"SUPABASE_URL": "https:\/\/abc\.supabase\.co"/);
  assert.match(text, /SUPABASE_ANON_KEY/);
  assert.ok(!/service_role/.test(text));
});

test('ключ service_role останавливает сборку', () => {
  assert.strictEqual(buildConfig({ SUPABASE_URL: 'https://a.supabase.co', SUPABASE_ANON_KEY: jwt('service_role') }).ok, false);
  assert.match(buildConfig({ SUPABASE_URL: 'https://a.supabase.co', SUPABASE_ANON_KEY: 'sb_secret_abc' }).error, /секретный ключ/);
  assert.strictEqual(buildConfig({ SUPABASE_URL: 'http://a.supabase.co', SUPABASE_ANON_KEY: jwt('anon') }).ok, false);
  assert.strictEqual(buildConfig({ SUPABASE_URL: 'https://a.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_xyz' }).ok, true);
});

test('все файлы оболочки service worker существуют (кроме vendor/supabase.js и config.js — их кладут вручную/сборка)', () => {
  const sw = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
  const shell = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  const generated = ['/config.js', '/vendor/supabase.js', '/'];
  const missing = shell.filter(f => !generated.includes(f) && !fs.existsSync(path.join(root, 'public', f)));
  assert.deepStrictEqual(missing, []);
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  [...html.matchAll(/<script src="(\/[^"]+)"/g)].map(m => m[1]).forEach(f => assert.ok(shell.includes(f), f + ' должен быть в оболочке SW'));
});

test('manifest.json: standalone, start_url «/»', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.json'), 'utf8'));
  assert.strictEqual(m.display, 'standalone');
  assert.strictEqual(m.start_url, '/');
});
