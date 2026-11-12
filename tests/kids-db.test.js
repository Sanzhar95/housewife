'use strict';
// Проверки базы для модуля «Дети» (004_kids.sql). Без SUPABASE_DB_URL пропускаются (см. tools/local-pg.sh).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const T = require('./helpers/db');

const skip = T.available() ? false : 'нет SUPABASE_DB_URL (строка подключения Postgres) — проверки базы пропущены';
const get = as => T.rpcJson('public.kids_get', '', as);
const save = (as, v, data) => T.rpcJson('public.kids_save', v + ', ' + T.json(data), as);

let A, B;
before(() => { if (skip) return; T.cleanup(); A = T.createFamily('A'); B = T.createFamily('B'); });
after(() => { if (!skip) T.cleanup(); });

test('новая семья: kids_get → data=null, version=0', { skip }, () => {
  assert.deepEqual(get(A.owner), { data: null, version: 0 });
});

test('kids_save: данные сохраняются, версия растёт, чужая семья не видит', { skip }, () => {
  assert.equal(save(A.owner, 0, { kids: [{ id: 'r1', name: 'Спальня', type: 'bedroom' }] }), 1);
  assert.equal(save(B.owner, 0, { kids: [{ id: 'r1', name: 'Чужая', type: 'kids' }] }), 1);
  assert.equal(get(A.owner).data.kids[0].name, 'Спальня');
  assert.equal(get(B.owner).data.kids[0].name, 'Чужая');
  assert.equal(T.must('select count(*) from public.kids_data', { as: A.owner }), '1');
});

test('неверная версия → version_conflict, данные не изменились', { skip }, () => {
  const r = T.sql('select public.kids_save(7, ' + T.json({ kids: [] }) + ')', { as: A.owner });
  assert.equal(r.ok, false);
  assert.match(r.err, /version_conflict/);
  assert.equal(get(A.owner).data.kids.length, 1);
  assert.equal(save(A.owner, 1, { kids: [], x: 1 }), 2);
});

test('прямой insert/update/delete в kids_data из браузера запрещён', { skip }, () => {
  for (const q of [`insert into public.kids_data (household_id) values ('${A.hid}')`,
                   `update public.kids_data set data = '{}'`, 'delete from public.kids_data']) {
    assert.equal(T.sql(q, { as: A.owner }).ok, false, q);
  }
  assert.equal(get(A.owner).version, 2);
});

test('не объект / слишком большие данные / без входа → отказ; кухня не затронута', { skip }, () => {
  assert.equal(T.sql("select public.kids_save(2, '[1]'::jsonb)", { as: A.owner }).ok, false);
  assert.equal(T.sql("select public.kids_save(2, jsonb_build_object('a', repeat('x', 600000)))", { as: A.owner }).ok, false);
  assert.equal(T.sql('select public.kids_get()').ok, false);
  assert.equal(T.rpcJson('public.get_state', '', A.owner).version, 0);   // версия кухни не менялась
});

test('миграция идемпотентна: повторный запуск не стирает данные', { skip }, () => {
  const fs = require('node:fs'), path = require('node:path');
  T.must(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '004_kids.sql'), 'utf8'));
  assert.equal(get(A.owner).version, 2);
});
