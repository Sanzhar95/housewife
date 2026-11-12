'use strict';
// Хранилище «Детей» = CleanStore с функциями kids_get / kids_save: пустая база, запись, конфликт версий, копия.
const test = require('node:test');
const assert = require('node:assert');
const KidsLogic = require('../../public/kids-logic.js');
const CleanStore = require('../../public/clean-store.js');

function fakeDb() {
  const db = { data: null, version: 0, calls: [], conflictOnce: 0 };
  db.rpc = async (name, args) => {
    db.calls.push(name);
    if (name === 'kids_get') return { data: db.data && JSON.parse(JSON.stringify(db.data)), version: db.version };
    if (name !== 'kids_save') throw new Error('не та функция: ' + name);
    if (db.conflictOnce > 0) { db.conflictOnce--; db.data = Object.assign({}, db.data, { people: ['Я', 'Муж', 'Бабушка'] }); db.version++; throw new Error('version_conflict'); }
    if (args.expected_version !== db.version) throw new Error('version_conflict');
    db.data = JSON.parse(JSON.stringify(args.new_data)); db.version++;
    return db.version;
  };
  return db;
}
function mk() {
  let n = 0;
  const logic = KidsLogic.create({ id: () => 'id' + (++n), now: () => '2026-11-11 19:00', today: () => '2026-11-11' });
  const db = fakeDb();
  return { db, store: CleanStore.create({ rpc: db.rpc, logic, get: 'kids_get', save: 'kids_save', format: 'dk-kids', label: '«Детей»' }) };
}

test('пустая база: load не пишет; setup записывает версию 1 через kids_save', async () => {
  const { db, store } = mk();
  assert.strictEqual((await store.load()).ready, false);
  assert.deepStrictEqual(db.calls, ['kids_get']);
  const r = await store.act('setup', [{ name: 'Алия', kind: 'school' }], [{ kid: 0, tpl: 'school' }]);
  assert.strictEqual(r.state.ready, true);
  assert.strictEqual(db.version, 1);
  assert.strictEqual(db.data.acts.length, 1);
  assert.match(r.notice, /Готово/);
});

test('конфликт версий: правка с другого телефона сохраняется, действие применяется заново', async () => {
  const { db, store } = mk();
  await store.load();
  await store.act('setup', [{ name: 'Алия' }], []);
  db.conflictOnce = 1;
  const r = await store.act('saveKid', { name: 'Тимур' });
  assert.strictEqual(r.state.kids.length, 2);
  assert.deepStrictEqual(db.data.people, ['Я', 'Муж', 'Бабушка']);
});

test('копия: формат dk-kids, чужой файл — понятная ошибка', async () => {
  const { store } = mk();
  await store.load();
  await store.act('setup', [{ name: 'Алия' }], []);
  const json = store.exportJson();
  assert.strictEqual(JSON.parse(json).format, 'dk-kids');
  await assert.rejects(store.importJson(JSON.stringify({ format: 'dk-clean', data: {} })), /копия «Детей»/);
  const st = await store.importJson(json);
  assert.strictEqual(st.kids[0].name, 'Алия');
});
