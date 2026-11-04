'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ImportDishes = require('../public/import-dishes.js');
const Logic = require('../public/logic.js');
const det = require('./helpers/det');
const snapshot = require('./fixtures/state.synthetic.snapshot.json');

const HEAD = ['Блюдо', 'Тип', 'Приёмы пищи', 'С гарниром', 'Порций в рецепте', 'Хватает на, раз', 'Заметка', 'Продукт', 'Количество', 'Ед.'];
const EMPTY = { products: [], dishes: [] };
const ST = {
  products: [{ id: 'p1', name: 'Рис', unit: 'КГ' }, { id: 'p2', name: 'Молоко', unit: 'Л' }, { id: 'p3', name: 'Лёд', unit: 'ШТ' }],
  dishes: [{ id: 'd1', name: 'Ёжики' }]
};
// строка: [блюдо, тип, приёмы, с гарниром, порций, раз, заметка, продукт, кол-во, ед.]
const row = (...c) => { const r = c.slice(); while (r.length < 10) r.push(''); return r; };
const run = (rows, st) => ImportDishes.parse([HEAD].concat(rows), st || EMPTY);
const one = (rows, st) => { const p = run(rows, st); assert.ok(p.ok, p.error); return p.dishes[0]; };

test('HEAD: 10 заголовков из спеки', () => {
  assert.deepStrictEqual(ImportDishes.HEAD, HEAD);
});

test('заголовки: регистр и пробелы не важны', () => {
  const head = HEAD.map(h => '  ' + h.toUpperCase() + ' ');
  const p = ImportDishes.parse([head, row('Суп')], EMPTY);
  assert.ok(p.ok);
  assert.strictEqual(p.dishes.length, 1);
});

test('заголовки: другой порядок, лишний или недостающий столбец, пустой файл', () => {
  const msg = 'Это не наш бланк. Скачайте бланк блюд и заполните его';
  const swapped = HEAD.slice(); swapped[0] = HEAD[1]; swapped[1] = HEAD[0];
  const p1 = ImportDishes.parse([swapped, row('Суп')], EMPTY);
  assert.strictEqual(p1.ok, false);
  assert.strictEqual(p1.error, msg);
  assert.deepStrictEqual(p1.dishes, []);
  assert.strictEqual(ImportDishes.parse([HEAD.concat(['Лишний']), row('Суп')], EMPTY).error, msg);
  assert.strictEqual(ImportDishes.parse([HEAD.slice(0, 9), row('Суп')], EMPTY).error, msg);
  assert.strictEqual(ImportDishes.parse([['Название', 'Ед.']], EMPTY).ok, false);
  const e = ImportDishes.parse([], EMPTY);
  assert.strictEqual(e.ok, false);
  assert.ok(e.error);
  assert.strictEqual(ImportDishes.parse([['', '']], EMPTY).ok, false);
});

test('заголовки: пустые ячейки справа от 10-го столбца допустимы (так отдаёт SheetJS)', () => {
  assert.ok(ImportDishes.parse([HEAD.concat(['', '']), row('Суп')], EMPTY).ok);
});

test('только заголовок: ok, блюд нет', () => {
  const p = ImportDishes.parse([HEAD], EMPTY);
  assert.ok(p.ok);
  assert.deepStrictEqual(p.dishes, []);
  assert.strictEqual(p.newProducts, 0);
});

test('пустое название продолжает предыдущее блюдо; столбцы 2-7 берутся из первой строки', () => {
  const d = one([
    row('Плов', 'основное', 'обед', 'да', 6, 2, 'вкусно', 'Рис', 0.5, 'кг'),
    row('', 'гарнир', 'завтрак', 'нет', 1, 1, 'другое', 'Молоко', 1, 'л')
  ], ST);
  assert.strictEqual(d.name, 'Плов');
  assert.strictEqual(d.type, 'main');
  assert.deepStrictEqual(d.meals, ['Обед']);
  assert.strictEqual(d.withSide, true);
  assert.strictEqual(d.portions, 6);
  assert.strictEqual(d.times, 2);
  assert.strictEqual(d.note, 'вкусно');
  assert.strictEqual(d.ing.length, 2);
  assert.strictEqual(d.status, 'new');
});

test('пустая строка пропускается, продолжение без блюда — ошибка', () => {
  const p = run([row(), row('', '', '', '', '', '', '', 'Рис', 1, 'кг')], ST);
  assert.ok(p.ok);
  assert.strictEqual(p.dishes.length, 1);
  assert.strictEqual(p.dishes[0].status, 'err');
  assert.match(p.dishes[0].err, /строка 3/);
});

test('одно блюдо двумя непоследовательными группами (регистр, ё/е, пробелы)', () => {
  const p = run([
    row('Борщ', '', '', '', '', '', '', 'Рис', 1, 'кг'),
    row('Суп', '', '', '', '', '', '', 'Молоко', 1, 'л'),
    row('  борщ ', '', '', '', '', '', '', 'Молоко', 2, 'л')
  ], ST);
  assert.strictEqual(p.dishes.length, 2);
  assert.strictEqual(p.dishes[0].name, 'Борщ');
  assert.strictEqual(p.dishes[0].ing.length, 2);
  assert.strictEqual(p.dishes[1].ing.length, 1);
});

test('тип: русские слова и синонимы, пусто -> main, мусор -> ошибка блюда', () => {
  const t = v => run([row('Х', v)]).dishes[0];
  assert.strictEqual(t('основное').type, 'main');
  assert.strictEqual(t('Гарнир').type, 'side');
  assert.strictEqual(t('салат').type, 'extra');
  assert.strictEqual(t('доп').type, 'extra');
  assert.strictEqual(t('Дополнительное').type, 'extra');
  assert.strictEqual(t('').type, 'main');
  const bad = t('десерт');
  assert.strictEqual(bad.status, 'err');
  assert.match(bad.err, /строка 2/);
});

test('приёмы пищи: через запятую, регистр, пусто -> все три, мусор -> ошибка', () => {
  const m = v => run([row('Х', '', v)]).dishes[0];
  assert.deepStrictEqual(m('завтрак, Обед').meals, ['Завтрак', 'Обед']);
  assert.deepStrictEqual(m('Ужин, завтрак').meals, ['Завтрак', 'Ужин']);
  assert.deepStrictEqual(m('').meals, ['Завтрак', 'Обед', 'Ужин']);
  assert.strictEqual(m('полдник').status, 'err');
  assert.strictEqual(m('обед, полдник').status, 'err');
});

test('с гарниром: да/нет/пусто — настоящий boolean; мусор -> ошибка', () => {
  const w = v => run([row('Х', '', '', v)]).dishes[0];
  assert.strictEqual(w('да').withSide, true);
  assert.strictEqual(w('Да').withSide, true);
  assert.strictEqual(w('нет').withSide, false);
  assert.strictEqual(w('').withSide, false);
  assert.strictEqual(typeof w('').withSide, 'boolean');
  assert.strictEqual(w('наверное').status, 'err');
});

test('числа: запятая, пробел-разделитель тысяч, неразрывный пробел', () => {
  const d = one([
    row('Х', '', '', '', '1,5', '', '', 'Рис', '0,5', 'кг'),
    row('', '', '', '', '', '', '', 'Молоко', '1 500', 'мл'),
    row('', '', '', '', '', '', '', 'Лёд', '1 5', 'шт')
  ], ST);
  assert.strictEqual(d.status, 'new', d.err);
  assert.strictEqual(d.portions, 1.5);
  assert.strictEqual(d.ing[0].qty, 0.5);
  assert.strictEqual(d.ing[1].qty, 1.5);       // 1500 мл = 1,5 л в единице продукта
  assert.strictEqual(d.ing[1].unit, 'Л');
  assert.strictEqual(d.ing[2].qty, 15);
});

test('число: не число -> ошибка; порций > 100 и times не целое -> ошибка; times > 7 обрезается как в действии', () => {
  assert.strictEqual(run([row('Х', '', '', '', 'много')]).dishes[0].status, 'err');
  assert.strictEqual(run([row('Х', '', '', '', 101)]).dishes[0].status, 'err');
  assert.strictEqual(run([row('Х', '', '', '', -1)]).dishes[0].status, 'err');
  assert.strictEqual(run([row('Х', '', '', '', '', 1.5)]).dishes[0].status, 'err');
  assert.strictEqual(run([row('Х', '', '', '', '', 0)]).dishes[0].status, 'err');
  assert.strictEqual(run([row('Х', '', '', '', '', 9)]).dishes[0].times, 7);
  assert.strictEqual(run([row('Х')]).dishes[0].times, 1);
  assert.strictEqual(run([row('Х')]).dishes[0].portions, 0);
});

test('продукт без количества -> ошибка блюда; количество без продукта -> ошибка', () => {
  const a = one([row('Х', '', '', '', '', '', '', 'Рис', '', 'кг')], ST);
  assert.strictEqual(a.status, 'err');
  assert.match(a.err, /строка 2/);
  assert.strictEqual(one([row('Х', '', '', '', '', '', '', 'Рис', 0, 'кг')], ST).status, 'err');
  const b = one([row('Х', '', '', '', '', '', '', '', 1, 'кг')], ST);
  assert.strictEqual(b.status, 'err');
  assert.match(b.err, /строка 2/);
  assert.strictEqual(one([row('Х', '', '', '', '', '', '', 'Рис', 'пол', 'кг')], ST).status, 'err');
});

test('единица: не из семьи продукта -> ошибка; новый продукт без единицы -> ошибка; непонятная единица -> ошибка', () => {
  assert.strictEqual(one([row('Х', '', '', '', '', '', '', 'Рис', 1, 'л')], ST).status, 'err');
  assert.strictEqual(one([row('Х', '', '', '', '', '', '', 'Лёд', 1, 'кг')], ST).status, 'err');   // шт только к шт
  const n = one([row('Х', '', '', '', '', '', '', 'Манго', 1, '')], ST);
  assert.strictEqual(n.status, 'err');
  assert.match(n.err, /строка 2/);
  assert.strictEqual(one([row('Х', '', '', '', '', '', '', 'Рис', 1, 'ведро')], ST).status, 'err');
});

test('единица у существующего продукта пустая -> берётся единица продукта; синонимы единиц', () => {
  const d = one([
    row('Х', '', '', '', '', '', '', 'Рис', 2, ''),
    row('', '', '', '', '', '', '', 'Молоко', 500, 'Миллилитров')
  ], ST);
  assert.strictEqual(d.status, 'new', d.err);
  assert.deepStrictEqual(d.ing[0], { product: 'Рис', qty: 2, unit: 'КГ', isNew: false });
  assert.deepStrictEqual(d.ing[1], { product: 'Молоко', qty: 0.5, unit: 'Л', isNew: false });
});

test('ё/е и регистр при поиске блюда и продукта; блюдо уже есть -> exists', () => {
  const p = run([
    row('ежики', '', '', '', '', '', '', 'Рис', 1, 'кг'),
    row('Коктейль', '', '', '', '', '', '', 'лед', 2, 'шт')
  ], ST);
  assert.strictEqual(p.dishes[0].status, 'exists');
  assert.strictEqual(p.dishes[1].status, 'new');
  assert.strictEqual(p.dishes[1].ing[0].isNew, false);
  assert.strictEqual(p.dishes[1].ing[0].product, 'Лёд');
  assert.strictEqual(p.newProducts, 0);
});

test('один продукт дважды в блюде суммируется в единице продукта', () => {
  const d = one([
    row('Х', '', '', '', '', '', '', 'Рис', 300, 'г'),
    row('', '', '', '', '', '', '', 'рис', 0.2, 'кг')
  ], ST);
  assert.strictEqual(d.ing.length, 1);
  assert.strictEqual(d.ing[0].qty, 0.5);
  assert.strictEqual(d.ing[0].unit, 'КГ');
});

test('newProducts: уникальные новые продукты только у блюд со статусом new', () => {
  const p = run([
    row('А', '', '', '', '', '', '', 'Манго', 1, 'шт'),
    row('', '', '', '', '', '', '', 'Киви', 1, 'шт'),
    row('Б', '', '', '', '', '', '', 'манго', 2, 'шт'),
    row('Ошибочное', '', '', '', '', '', '', 'Папайя', 1, 'шт'),
    row('', '', '', '', '', '', '', 'Рис', 1, 'л'),
    row('Ёжики', '', '', '', '', '', '', 'Гуава', 1, 'шт')
  ], ST);
  assert.deepStrictEqual(p.dishes.map(d => d.status), ['new', 'new', 'err', 'exists']);
  assert.strictEqual(p.newProducts, 2);
  assert.strictEqual(p.dishes[0].ing[0].isNew, true);
  assert.strictEqual(p.dishes[1].ing[0].isNew, true);   // новый и для блюда Б: в файле он впервые создан блюдом А
});

test('новый продукт в другой семье единиц, чем создан раньше в файле -> ошибка второго блюда (как в действии)', () => {
  const p = run([
    row('А', '', '', '', '', '', '', 'Манго', 1, 'шт'),
    row('Б', '', '', '', '', '', '', 'Манго', 1, 'кг')
  ]);
  assert.deepStrictEqual(p.dishes.map(d => d.status), ['new', 'err']);
  assert.strictEqual(p.newProducts, 1);
});

test('лимиты: 500 блюд и 5000 строк', () => {
  const dishes = n => Array.from({ length: n }, (_, i) => row('Блюдо ' + i));
  assert.ok(ImportDishes.parse([HEAD].concat(dishes(500)), EMPTY).ok);
  const over = ImportDishes.parse([HEAD].concat(dishes(501)), EMPTY);
  assert.strictEqual(over.ok, false);
  assert.match(over.error, /500/);
  assert.deepStrictEqual(over.dishes, []);
  const lines = n => [row('Одно')].concat(Array.from({ length: n - 1 }, () => row('', '', '', '', '', '', '', 'Рис', 1, 'кг')));
  assert.ok(ImportDishes.parse([HEAD].concat(lines(5000)), ST).ok);
  const o2 = ImportDishes.parse([HEAD].concat(lines(5001)), ST);
  assert.strictEqual(o2.ok, false);
  assert.match(o2.error, /5000/);
});

test('normUnit: синонимы, ? и пустая', () => {
  const n = ImportDishes.normUnit;
  assert.strictEqual(n('Кг.'), 'КГ');
  assert.strictEqual(n('грамм'), 'Г');
  assert.strictEqual(n('L'), 'Л');
  assert.strictEqual(n('миллилитров'), 'МЛ');
  assert.strictEqual(n('штук'), 'ШТ');
  assert.strictEqual(n('ведро'), '?');
  assert.strictEqual(n(''), '');
  assert.strictEqual(n(null), '');
});

test('templateRows: заголовок + 3 примера, сам разбирается без ошибок на пустом состоянии', () => {
  const rows = ImportDishes.templateRows();
  assert.deepStrictEqual(rows[0], HEAD);
  assert.ok(rows.every(r => r.length === 10));
  const p = ImportDishes.parse(rows, EMPTY);
  assert.ok(p.ok, p.error);
  assert.strictEqual(p.dishes.length, 3);
  p.dishes.forEach(d => assert.strictEqual(d.status, 'new', d.name + ': ' + d.err));
  assert.deepStrictEqual(p.dishes.map(d => d.ing.length), [3, 2, 1]);
  assert.strictEqual(p.dishes[0].withSide, true);
  assert.strictEqual(p.dishes[2].type, 'side');
  assert.ok(p.newProducts >= 5);
});

test('toRows: только new, в формате importDishes, проходит через Logic без ошибок', () => {
  const state = JSON.parse(JSON.stringify(snapshot));
  const p = ImportDishes.parse(ImportDishes.templateRows().concat([
    row('Ёжики', '', '', '', '', '', '', 'Рис', 1, 'кг'),
    row('Плохое', '', '', '', '', '', '', 'Рис', 1, 'л')
  ]), { products: state.products, dishes: state.dishes.concat([{ id: 'x', name: 'Ёжики' }]) });
  assert.ok(p.ok, p.error);
  const rows = ImportDishes.toRows(p);
  assert.strictEqual(rows.length, p.dishes.filter(d => d.status === 'new').length);
  rows.forEach(r => {
    assert.deepStrictEqual(Object.keys(r).sort(), ['ing', 'meals', 'name', 'note', 'portions', 'times', 'type', 'withSide']);
    assert.strictEqual(typeof r.withSide, 'boolean');
    r.ing.forEach(i => assert.deepStrictEqual(Object.keys(i).sort(), ['product', 'qty', 'unit']));
  });
  const clock = det.clock('2026-11-03T12:00:00+05:00');
  const L = Logic.create({ rng: det.rng(1), id: det.idGen(500), now: clock.now, today: clock.today });
  const s = L.apply('importDishes', state, [rows]);
  assert.match(s.notice, new RegExp('Загружено блюд: ' + rows.length));
  assert.ok(!/Пропущено/.test(s.notice), s.notice);
  assert.strictEqual(s.dishes.length, state.dishes.length + rows.length);
  assert.match(s.notice, new RegExp('новых продуктов: ' + p.newProducts));
});
