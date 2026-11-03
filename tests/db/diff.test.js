'use strict';
const test = require('node:test');
const assert = require('node:assert');
const DB = require('../../public/db.js');
const { createOracle } = require('../oracle/gs-runner');
const Logic = require('../../public/logic.js');
const det = require('../helpers/det');
const sheets = require('../fixtures/sheets.synthetic.json');

const base = () => createOracle(sheets).getState();
const light = s => JSON.parse(JSON.stringify({ products: s.products, dishes: s.dishes, ing: s.ing, plan: s.plan, settings: s.settings }));
const mk = () => Logic.create({ rng: det.rng(1), id: det.idGen(1), now: det.clock().now, today: det.clock().today });

test('diff: без изменений → null', () => {
  const a = light(base());
  assert.strictEqual(DB.diff(a, JSON.parse(JSON.stringify(a))), null);
});

test('diff: новая, изменённая и удалённая строка в каждой таблице', () => {
  const a = light(base()), b = JSON.parse(JSON.stringify(a));
  b.products[0].stock = 99; b.products.push({ id: 'new00001', name: 'Новый', unit: 'ШТ', stock: 1, min: 0 }); b.products.splice(2, 1);
  b.dishes[1].name = 'Другое'; b.dishes.pop();
  b.ing[0].qty = 7; b.ing.pop(); b.ing.push({ dish: 'ds000001', product: 'pr000004', qty: 1, unit: 'Л' });
  b.plan[0].done = false; b.plan.push({ id: 'npl00001', day: 1, meal: 'Обед', kind: 'main', dish: 'ds000001', side: '', done: false, date: '', left: false, portions: 0, from: '' }); b.plan.shift();
  b.settings.weekStart = '2026-11-09'; b.settings.portions = 5;
  const d = DB.diff(a, b);
  assert.deepStrictEqual(d.products.upsert.map(r => r.id).sort(), ['new00001', 'pr000001']);
  assert.deepStrictEqual(d.products.delete, [a.products[2].id]);
  assert.strictEqual(d.dishes.upsert.length, 1); assert.deepStrictEqual(d.dishes.delete, [a.dishes[7].id]);
  assert.deepStrictEqual(d.ing.delete, [{ dish: a.ing[17].dish, product: a.ing[17].product }]);
  assert.ok(d.ing.upsert.some(r => r.qty === 7));
  assert.ok(d.plan.upsert.some(r => r.id === 'npl00001'));
  assert.deepStrictEqual(d.settings, { weekStart: '2026-11-09', portions: 5 });
});

test('diff: ключ состава — пара блюдо+продукт', () => {
  const a = light(base()), b = JSON.parse(JSON.stringify(a));
  b.ing = b.ing.filter(i => !(i.dish === 'ds000001' && i.product === 'pr000001'));
  assert.deepStrictEqual(DB.diff(a, b).ing.delete, [{ dish: 'ds000001', product: 'pr000001' }]);
});

test('действие логики → diff содержит ровно изменённые строки; журнал и приходы приходят отдельно', () => {
  const s = base(), L = mk();
  const n = L.apply('adjustStock', s, ['pr000001', 1, 700]);
  const d = DB.diff(light(s), light(n));
  assert.deepStrictEqual(Object.keys(d), ['products']);
  assert.strictEqual(d.products.upsert.length, 1);
  assert.strictEqual(n.log.filter(e => e._new).length, 1);
  assert.strictEqual(n.purchases.filter(e => e._new).length, 1);
});

test('названия с эмодзи, кавычками и кириллицей не искажаются при JSON-обмене', () => {
  const s = base(), L = mk();
  const name = 'Мёд "липовый" 🍯 д\'Артаньян';
  const n = L.apply('saveProduct', s, [{ name, unit: 'Г', stock: 1, min: 0 }]);
  const d = DB.diff(light(s), light(n));
  assert.strictEqual(JSON.parse(JSON.stringify(d)).products.upsert[0].name, name);
});

test('cleanError: тексты для людей', () => {
  assert.strictEqual(DB.cleanError({ message: 'Failed to fetch' }), 'Нет связи. Попробуйте ещё раз');
  assert.strictEqual(DB.cleanError({ message: 'JWT expired', status: 401 }), 'Войдите заново');
  assert.strictEqual(DB.cleanError({ message: 'Invalid login credentials' }), 'Неверная почта или пароль');
  assert.match(DB.cleanError({ message: 'version_conflict' }), /другом телефоне/);
  assert.strictEqual(DB.cleanError(new Error('Не хватает продуктов:\nРис')), 'Не хватает продуктов:\nРис');
  assert.strictEqual(DB.cleanError({ message: 'duplicate key value violates' }), 'Не получилось сохранить. Попробуйте ещё раз');
});
