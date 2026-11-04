'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Logic = require('../../public/logic.js');
const det = require('../helpers/det');
const snapshot = require('../fixtures/state.synthetic.snapshot.json');

function mk() {
  const clock = det.clock('2026-11-03T12:00:00+05:00');
  const L = Logic.create({ rng: det.rng(1), id: det.idGen(500), now: clock.now, today: clock.today });
  return { L, S: JSON.parse(JSON.stringify(snapshot)) };
}
const imp = (t, rows, s) => t.L.apply('importDishes', s || t.S, [rows]);
const dishByName = (s, n) => s.dishes.find(d => d.name === n);
const prodByName = (s, n) => s.products.find(p => p.name === n);

test('importDishes: действие зарегистрировано (аналога в Code.gs нет, в сравнительных тестах не участвует)', () => {
  assert.ok(mk().L.actions.includes('importDishes'));
});

test('новое блюдо с составом: qty переведено в единицу продукта, склад не меняется', () => {
  const t = mk();
  const rice = prodByName(t.S, 'Рис');           // КГ
  const before = JSON.stringify(t.S.products);
  const s = imp(t, [{
    name: 'Рис с молоком', type: 'main', meals: ['Завтрак'], withSide: true, portions: 3, times: 2, note: 'сладкий',
    ing: [{ product: 'рис', qty: 300, unit: 'г' }, { product: 'Молоко', qty: 0.5, unit: 'л' }]
  }]);
  const d = dishByName(s, 'Рис с молоком');
  assert.ok(d);
  assert.strictEqual(d.type, 'main');
  assert.deepStrictEqual(d.meals, ['Завтрак']);
  assert.strictEqual(d.withSide, true);
  assert.strictEqual(d.portions, 3);
  assert.strictEqual(d.times, 2);
  assert.strictEqual(d.note, 'сладкий');
  const rows = s.ing.filter(i => i.dish === d.id);
  assert.strictEqual(rows.length, 2);
  const r = rows.find(i => i.product === rice.id);
  assert.strictEqual(r.qty, 0.3);
  assert.strictEqual(r.unit, 'Г');
  assert.strictEqual(JSON.stringify(s.products), before);
  assert.match(s.notice, /Загружено блюд: 1/);
  assert.match(s.notice, /новых продуктов: 0/);
});

test('тип и приёмы: ключи и русские слова, значения по умолчанию', () => {
  const t = mk();
  const s = imp(t, [
    { name: 'А', type: 'side' }, { name: 'Б', type: 'extra' }, { name: 'В', type: 'салат' },
    { name: 'Г', type: 'гарнир', withSide: true, times: 3 }, { name: 'Д' }
  ]);
  assert.deepStrictEqual(['А', 'Б', 'В', 'Г', 'Д'].map(n => dishByName(s, n).type), ['side', 'extra', 'extra', 'side', 'main']);
  assert.deepStrictEqual(dishByName(s, 'Д').meals, ['Завтрак', 'Обед', 'Ужин']);
  assert.strictEqual(dishByName(s, 'Г').withSide, false);   // только у основного
  assert.strictEqual(dishByName(s, 'Г').times, 1);
  assert.strictEqual(dishByName(s, 'Д').portions, 0);
  assert.strictEqual(dishByName(s, 'Д').times, 1);
});

test('блюдо с таким названием уже есть (регистр, ё/е) — пропущено, существующее не тронуто', () => {
  const t = mk();
  t.S.dishes.push({ id: 'dsE', name: 'Ёжики', note: '', type: 'main', meals: ['Обед'], withSide: false, portions: 0, times: 1 });
  const ingBefore = JSON.stringify(t.S.ing);
  const dishesBefore = JSON.stringify(t.S.dishes);
  const s = imp(t, [
    { name: 'плов', ing: [{ product: 'Рис', qty: 1, unit: 'кг' }] },
    { name: '  ежики ', note: 'другое' }
  ]);
  assert.strictEqual(JSON.stringify(s.dishes), dishesBefore);
  assert.strictEqual(JSON.stringify(s.ing), ingBefore);
  assert.match(s.notice, /уже есть/);
  assert.match(s.notice, /Загружено блюд: 0/);
});

test('неизвестный продукт создаётся (unit из файла, stock 0, min 0); известный находится без учёта регистра и ё/е', () => {
  const t = mk();
  t.S.products.push({ id: 'prE', name: 'Лёд', unit: 'КГ', stock: 1, min: 0 });
  const n = t.S.products.length;
  const s = imp(t, [{ name: 'Коктейль', ing: [{ product: 'лед', qty: 0.2, unit: 'кг' }, { product: 'Манго', qty: 2, unit: 'шт' }] }]);
  assert.strictEqual(s.products.length, n + 1);
  const mango = prodByName(s, 'Манго');
  assert.strictEqual(mango.unit, 'ШТ');
  assert.strictEqual(mango.stock, 0);
  assert.strictEqual(mango.min, 0);
  assert.strictEqual(s.products.find(p => p.id === 'prE').stock, 1);
  const d = dishByName(s, 'Коктейль');
  assert.strictEqual(s.ing.filter(i => i.dish === d.id).length, 2);
  assert.match(s.notice, /новых продуктов: 1/);
});

test('единица не из семьи продукта — ошибка этого блюда; остальные загружены; продукты ошибочного блюда не сохраняются', () => {
  const t = mk();
  const n = t.S.products.length;
  const s = imp(t, [
    { name: 'Плохое', ing: [{ product: 'Новинка', qty: 1, unit: 'шт' }, { product: 'Рис', qty: 1, unit: 'л' }] },
    { name: 'Хорошее', ing: [{ product: 'Рис', qty: 1, unit: 'кг' }] }
  ]);
  assert.ok(!dishByName(s, 'Плохое'));
  assert.ok(dishByName(s, 'Хорошее'));
  assert.ok(!prodByName(s, 'Новинка'));
  assert.strictEqual(s.products.length, n);
  assert.match(s.notice, /Загружено блюд: 1/);
  assert.match(s.notice, /Пропущено: Плохое \(/);
  assert.strictEqual(s.ing.filter(i => !t.S.dishes.some(d => d.id === i.dish) && i.dish !== dishByName(s, 'Хорошее').id).length, 0);
});

test('ошибки: нет единицы у нового продукта, нет количества, порций больше лимита', () => {
  const t = mk();
  const s = imp(t, [
    { name: 'Э1', ing: [{ product: 'Новый', qty: 1 }] },
    { name: 'Э2', ing: [{ product: 'Рис', qty: 0, unit: 'кг' }] },
    { name: 'Э3', portions: 1000 }
  ]);
  assert.strictEqual(s.dishes.length, t.S.dishes.length);
  assert.match(s.notice, /Загружено блюд: 0/);
  assert.match(s.notice, /Э1 \(/);
  assert.match(s.notice, /Э2 \(/);
  assert.match(s.notice, /Э3 \(/);
});

test('один продукт дважды в блюде суммируется в одну позицию', () => {
  const t = mk();
  const rice = prodByName(t.S, 'Рис');
  const s = imp(t, [{ name: 'Двойной', ing: [{ product: 'Рис', qty: 300, unit: 'г' }, { product: 'рис', qty: 0.2, unit: 'кг' }] }]);
  const rows = s.ing.filter(i => i.dish === dishByName(s, 'Двойной').id);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].product, rice.id);
  assert.strictEqual(rows[0].qty, 0.5);
});

test('двойной вызов: второй раз ничего не создаётся', () => {
  const t = mk();
  const rows = [{ name: 'Новое', ing: [{ product: 'Манго', qty: 1, unit: 'шт' }] }];
  const a = imp(t, rows);
  const b = imp(t, rows, a);
  assert.match(b.notice, /Загружено блюд: 0/);
  assert.match(b.notice, /уже есть/);
  assert.strictEqual(b.dishes.length, a.dishes.length);
  assert.strictEqual(b.products.length, a.products.length);
  assert.strictEqual(b.ing.length, a.ing.length);
});

test('пустые названия пропускаются; пустой массив — состояние не меняется', () => {
  const t = mk();
  const e = imp(t, []);
  assert.strictEqual(e.notice, 'Нечего загружать.');
  assert.deepStrictEqual(Object.assign({}, e, { notice: undefined }), Object.assign({}, t.S, { notice: undefined }));
  const e2 = imp(t, [{ name: '  ' }, { name: '' }]);
  assert.strictEqual(e2.notice, 'Нечего загружать.');
  assert.strictEqual(e2.dishes.length, t.S.dishes.length);
  assert.strictEqual(e2.log.length, t.S.log.length);
  const s = imp(t, [{ name: '' }, { name: 'Единственное' }]);
  assert.strictEqual(s.dishes.length, t.S.dishes.length + 1);
});

test('журнал и неизменность исходного состояния', () => {
  const t = mk();
  const before = JSON.stringify(t.S);
  const s = imp(t, [{ name: 'Журнальное', ing: [{ product: 'Манго', qty: 1, unit: 'шт' }] }, { name: 'Плов' }]);
  assert.strictEqual(JSON.stringify(t.S), before);
  const e = s.log.filter(x => x.action === 'Загрузка блюд из Excel');
  assert.strictEqual(e.length, 1);
  assert.strictEqual(e[0]._new, true);
  assert.strictEqual(e[0].details, 'блюд: 1, новых продуктов: 1, пропущено: 1');
  assert.strictEqual(s.plan.length, t.S.plan.length);
});
