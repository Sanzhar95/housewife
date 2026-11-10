'use strict';
const test = require('node:test');
const assert = require('node:assert');
const CleanLogic = require('../../public/clean-logic.js');
const CleanStore = require('../../public/clean-store.js');

/** «База» в памяти с той же проверкой версии, что в clean_save. */
function fakeDb() {
  const db = { data: null, version: 0, calls: [], conflictOnce: 0, other: null };
  db.rpc = async (name, args) => {
    db.calls.push(name);
    if (name === 'clean_get') return { data: db.data && JSON.parse(JSON.stringify(db.data)), version: db.version };
    if (db.conflictOnce > 0) { db.conflictOnce--; if (db.other) { db.data = db.other(db.data); db.version++; } throw new Error('version_conflict'); }
    if (args.expected_version !== db.version) throw new Error('version_conflict');
    db.data = JSON.parse(JSON.stringify(args.new_data)); db.version++;
    return db.version;
  };
  return db;
}
function mk() {
  let n = 0;
  const logic = CleanLogic.create({ id: () => 'id' + (++n), now: () => '2026-11-02 09:00', today: () => '2026-11-02' });
  const db = fakeDb();
  return { logic, db, store: CleanStore.create({ rpc: db.rpc, logic }) };
}
const ROOMS = [{ name: 'Спальня', type: 'bedroom' }];

test('пустая база: load ничего не пишет; первое действие создаёт данные с версией 1', async () => {
  const { db, store } = mk();
  const st = await store.load();
  assert.strictEqual(st.ready, false);
  assert.strictEqual(db.version, 0);
  const r = await store.act('saveCleanRooms', ROOMS, {});
  assert.strictEqual(r.state.ready, true);
  assert.strictEqual(db.version, 1);
  assert.strictEqual(db.data.supplies.length, 5);
});

test('конфликт версий: чужая правка не теряется, действие применяется заново к свежим данным', async () => {
  const { db, store, logic } = mk();
  await store.load();
  await store.act('saveCleanRooms', ROOMS, {});
  const sid = db.data.supplies[0].id;
  db.conflictOnce = 1;
  db.other = d => logic.apply('restockSupply', d, [d.supplies[1].id, 300]).data;   // с другого телефона купили средство
  const r = await store.act('restockSupply', sid, 500);
  const s = db.data.supplies;
  assert.strictEqual(s[0].stock, 500);
  assert.strictEqual(s[1].stock, 300);                                   // чужая правка осталась
  assert.strictEqual(r.state.supplies[1].stock, 300);
});

test('постоянный конфликт: после нескольких попыток — понятная ошибка, данные целы', async () => {
  const { db, store } = mk();
  await store.act('saveCleanRooms', ROOMS, {});
  const before = JSON.stringify(db.data);
  db.conflictOnce = 99;
  await assert.rejects(store.act('saveCleanSettings', { limit: 90 }), /Данные изменились на другом телефоне\. Попробуйте ещё раз/);
  assert.strictEqual(JSON.stringify(db.data), before);
});

test('ошибка логики: в базу ничего не пишется, очередь не ломается', async () => {
  const { db, store } = mk();
  await store.act('saveCleanRooms', ROOMS, {});
  const v = db.version;
  await assert.rejects(store.act('restockSupply', 'нет', 5), /Такого расходника нет\./);
  assert.strictEqual(db.version, v);
  await store.act('saveCleanSettings', { limit: 45 });
  assert.strictEqual(db.data.settings.limit, 45);
});

test('быстрые нажатия подряд идут по очереди: без потерянных обновлений', async () => {
  const { db, store } = mk();
  await store.act('saveCleanRooms', ROOMS, {});
  const id = db.data.supplies[0].id;
  await Promise.all([store.act('restockSupply', id, 100), store.act('restockSupply', id, 100), store.act('restockSupply', id, 100)]);
  assert.strictEqual(db.data.supplies[0].stock, 300);
});

test('копия JSON: выгрузка и загрузка возвращают те же данные; чужой файл — понятная ошибка', async () => {
  const a = mk(), b = mk();
  await a.store.act('saveCleanRooms', [{ name: 'Детская', type: 'kids' }], { limit: 45, rest: [6, 7] });
  const text = a.store.exportJson();
  const st = await b.store.importJson(text);
  assert.strictEqual(st.settings.limit, 45);
  assert.deepStrictEqual(b.db.data.rooms.map(r => r.name), ['Детская']);
  await assert.rejects(b.store.importJson('не json'), /Не получилось прочитать файл/);
  await assert.rejects(b.store.importJson('{"a":1}'), /Это не копия «Уборки»/);
  assert.strictEqual(b.db.data.rooms.length, 1);                          // после ошибок данные целы
});
