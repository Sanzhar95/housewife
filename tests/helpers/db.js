'use strict';
// Помощники для проверки базы (tests/rls.test.js): запросы через psql, тестовые семьи и пользователи, уборка за собой.
// Нужна переменная SUPABASE_DB_URL (строка подключения Postgres). Тесты создают ТОЛЬКО семьи с именем TEST-… и пользователей @dk-test.invalid.
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const URL_ = process.env.SUPABASE_DB_URL || '';
const available = () => !!URL_ && spawnSync('psql', ['--version']).status === 0;
const lit = s => "'" + String(s).replace(/'/g, "''") + "'";
const json = o => '$dkjson$' + JSON.stringify(o) + '$dkjson$::jsonb';

function wrap(sql, as, role) {
  let pre = '';
  if (as || role) {
    pre += 'begin;\nset local role ' + (role || 'authenticated') + ';\n';
    if (as) pre += "select set_config('request.jwt.claims', " + lit(JSON.stringify({ sub: as.id, email: as.email, role: 'authenticated' })) + ", true) as _x \\gset\n";
    return pre + sql + '\n;\ncommit;\n';
  }
  return sql + '\n';
}

/** Выполнить SQL. as — {id,email}: от имени пользователя (роль authenticated); role:'anon' — как аноним. */
function sql(text, opts = {}) {
  const r = spawnSync('psql', [URL_, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: wrap(text, opts.as, opts.role), encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function must(text, opts) { const r = sql(text, opts); if (!r.ok) throw new Error(r.err); return r.out; }
const rpcJson = (fn, args, as) => JSON.parse(must('select ' + fn + '(' + (args || '') + ')', { as }));

let n = 0;
const uniq = () => Date.now().toString(36) + (n++).toString(36) + crypto.randomBytes(2).toString('hex');

function userSql(email, token) {
  const meta = token === undefined ? '{}' : JSON.stringify({ invite: token });
  return 'insert into auth.users (email, raw_user_meta_data) values (' + lit(email) + ', ' + lit(meta) + '::jsonb) returning id';
}
/** Регистрация как это делает signUp: строка в auth.users с токеном в метаданных. */
function signUp(token, email) {
  email = email || ('u' + uniq() + '@dk-test.invalid');
  const r = sql(userSql(email, token));
  return { ok: r.ok, err: r.err, id: r.ok ? r.out.split('\n')[0] : null, email };
}
/** Новая тестовая семья: { hid, owner:{id,email} } */
function createFamily(label) {
  const tok = must("select public.admin_new_family_invite(" + lit('TEST-' + label + '-' + uniq()) + ")");
  const u = signUp(tok);
  if (!u.ok) throw new Error(u.err);
  const hid = must("select household_id from public.members where user_id = '" + u.id + "'");
  return { hid, owner: { id: u.id, email: u.email } };
}
function inviteToken(owner) { return must('select public.create_invite()', { as: owner }); }
function joinFamily(owner) { const t = inviteToken(owner); const u = signUp(t); if (!u.ok) throw new Error(u.err); return { id: u.id, email: u.email, token: t }; }

/** Одновременная регистрация: первая держит транзакцию 1,5 с, вторая стартует во время неё. */
function raceSignUp(token) {
  const run = (email, hold) => new Promise(res => {
    const p = spawn('psql', [URL_, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-']);
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => res({ ok: code === 0, err: err.trim(), email }));
    p.stdin.end('begin;\n' + userSql(email, token) + ';\n' + (hold ? 'select pg_sleep(1.5);\n' : '') + 'commit;\n');
  });
  const e1 = 'r1' + uniq() + '@dk-test.invalid', e2 = 'r2' + uniq() + '@dk-test.invalid';
  const a = run(e1, true);
  return new Promise(r => setTimeout(r, 400)).then(() => Promise.all([a, run(e2, false)]));
}

function cleanup() {
  sql("delete from auth.users where email like '%@dk-test.invalid'; delete from public.households where name like 'TEST-%'; delete from public.invites where family_name like 'TEST-%' or household_id is null;");
}

module.exports = { available, sql, must, rpcJson, json, lit, signUp, createFamily, joinFamily, inviteToken, raceSignUp, cleanup };
