'use strict';
// Заглушка Supabase для проверки интерфейса в браузере: вход и «база» в localStorage, логика базы — из tests/helpers/fake-server.js.
const fs = require('node:fs');
const path = require('node:path');

function stubSource(seedState) {
  const fake = fs.readFileSync(path.join(__dirname, '..', 'helpers', 'fake-server.js'), 'utf8');
  return `
(function () {
  const module = { exports: {} };
  ${fake}
  const makeServer = module.exports.createFakeServer;
  const SEED = ${JSON.stringify(seedState)};
  const KEY = 'stub-db', SES = 'stub-session';
  let srv = makeServer(SEED);
  try { const saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved) { srv.t = saved.t; srv.settings = saved.settings; srv.log = saved.log; srv.purchases = saved.purchases; srv.version = saved.version; } } catch (e) {}
  const save = () => localStorage.setItem(KEY, JSON.stringify({ t: srv.t, settings: srv.settings, log: srv.log, purchases: srv.purchases, version: srv.version }));
  window.__stub = { srv, reset() { localStorage.removeItem(KEY); localStorage.removeItem(SES); localStorage.removeItem('stub-admin'); localStorage.removeItem('stub-clean'); }, delay: 0 };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  window.supabase = { createClient() {
    return {
      auth: {
        async getSession() { const s = localStorage.getItem(SES); return { data: { session: s ? JSON.parse(s) : null } }; },
        async signInWithPassword(a) {
          await sleep(window.__stub.delay);
          if (a.password !== 'password1' || a.email !== 'mama@example.com') return { data: {}, error: { message: 'Invalid login credentials' } };
          const ses = { user: { email: a.email } }; localStorage.setItem(SES, JSON.stringify(ses)); return { data: { session: ses }, error: null };
        },
        async signUp(a) {
          if (a.options.data.invite !== 'goodtoken123') return { data: {}, error: { message: 'Database error saving new user' } };
          const ses = { user: { email: a.email } }; localStorage.setItem(SES, JSON.stringify(ses)); return { data: { session: ses }, error: null };
        },
        async signOut() { localStorage.removeItem(SES); },
        async updateUser() { return { error: null }; }
      },
      async rpc(name, args) {
        if (name === 'create_invite') return { data: 'newtoken456789', error: null };
        if (name === 'clean_get') { const c = JSON.parse(localStorage.getItem('stub-clean') || 'null'); return { data: c ? { data: c.data, version: c.version } : { data: null, version: 0 }, error: null }; }
        if (name === 'clean_save') {
          const c = JSON.parse(localStorage.getItem('stub-clean') || '{"data":null,"version":0}');
          if (args.expected_version !== c.version) return { data: null, error: { message: 'version_conflict' } };
          localStorage.setItem('stub-clean', JSON.stringify({ data: args.new_data, version: c.version + 1 })); return { data: c.version + 1, error: null };
        }
        if (name === 'is_admin') return { data: localStorage.getItem('stub-admin') === '1', error: null };
        if (name === 'admin_create_family_invite') return { data: 'family' + String(args.family_name).length + 'token', error: null };
        const r = await srv.rpc(name, args); save(); await sleep(window.__stub.delay); return r;
      }
    };
  } };
})();`;
}
module.exports = { stubSource };
