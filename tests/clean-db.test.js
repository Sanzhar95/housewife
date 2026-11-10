'use strict';
// Проверки базы для модуля «Уборка» (003_clean.sql). Без SUPABASE_DB_URL пропускаются (см. tools/local-pg.sh).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const T = require('./helpers/db');

const skip = T.available() ? false : 'нет SUPABASE_DB_URL (строка подключения Postgres) — проверки базы пропущены';
const get = as => T.rpcJson('public.clean_get', '', as);
const save = (as, v, data) => T.rpcJson('public.clean_save', v + ', ' + T.json(data), as);

let A, B;
before(() => { if (skip) return; T.cleanup(); A = T.createFamily('A'); B = T.createFamily('B'); });
after(() => { if (!skip) T.cleanup(); });

test('новая семья: clean_get → data=null, version=0', { skip }, () => {
  assert.deepEqual(get(A.owner), { data: null, version: 0 });
});

test('clean_save: данные сохраняются, версия растёт, чужая семья не видит', { skip }, () => {
  assert.equal(save(A.owner, 0, { rooms: [{ id: 'r1', name: 'Спальня', type: 'bedroom' }] }), 1);
  assert.equal(save(B.owner, 0, { rooms: [{ id: 'r1', name: 'Чужая', type: 'kids' }] }), 1);
  assert.equal(get(A.owner).data.rooms[0].name, 'Спальня');
  assert.equal(get(B.owner).data.rooms[0].name, 'Чужая');
  assert.equal(T.must('select count(*) from public.clean_data', { as: A.owner }), '1');
});

test('неверная версия → version_conflict, данные не изменились', { skip }, () => {
  const r = T.sql('select public.clean_save(7, ' + T.json({ rooms: [] }) + ')', { as: A.owner });
  assert.equal(r.ok, false);
  assert.match(r.err, /version_conflict/);
  assert.equal(get(A.owner).data.rooms.length, 1);
  assert.equal(save(A.owner, 1, { rooms: [], x: 1 }), 2);
});

test('прямой insert/update/delete в clean_data из браузера запрещён', { skip }, () => {
  for (const q of [`insert into public.clean_data (household_id) values ('${A.hid}')`,
                   `update public.clean_data set data = '{}'`, 'delete from public.clean_data']) {
    assert.equal(T.sql(q, { as: A.owner }).ok, false, q);
  }
  assert.equal(get(A.owner).version, 2);
});

test('не объект / слишком большие данные / без входа → отказ; кухня не затронута', { skip }, () => {
  assert.equal(T.sql("select public.clean_save(2, '[1]'::jsonb)", { as: A.owner }).ok, false);
  assert.equal(T.sql("select public.clean_save(2, jsonb_build_object('a', repeat('x', 600000)))", { as: A.owner }).ok, false);
  assert.equal(T.sql('select public.clean_get()').ok, false);
  assert.equal(T.rpcJson('public.get_state', '', A.owner).version, 0);   // версия кухни не менялась
});

test('миграция идемпотентна: повторный запуск не стирает данные', { skip }, () => {
  const fs = require('node:fs'), path = require('node:path');
  T.must(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '003_clean.sql'), 'utf8'));
  assert.equal(get(A.owner).version, 2);
});
