'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Logic = require('../../public/logic.js');
const det = require('../helpers/det');
const { makePair } = require('../helpers/pair');
const sheets = require('../fixtures/sheets.synthetic.json');

const U = Logic.util;

test('единицы: fmtQ / conv / sameFam', () => {
  assert.strictEqual(U.fmtQ(0.25, 'КГ'), '250 г');
  assert.strictEqual(U.fmtQ(1500, 'МЛ'), '1,5 л');
  assert.strictEqual(U.fmtQ(0.333333, 'Л'), '333,333 мл');
  assert.strictEqual(U.fmtQ(0, 'КГ'), '0 кг');
  assert.strictEqual(U.conv(1500, 'Г', 'КГ'), 1.5);
  assert.strictEqual(U.conv(2, 'КГ', 'Л'), 2);           // разные семейства: без пересчёта
  assert.ok(U.sameFam('Л', 'МЛ') && !U.sameFam('Л', 'КГ'));
});

test('num: запятая, пробелы, пустое, отрицательное', () => {
  assert.strictEqual(U.num('0,5'), 0.5);
  assert.strictEqual(U.num(' 1 200,25 '), 1200.25);
  assert.strictEqual(U.num(''), 0);
  assert.throws(() => U.num('-1'), /неотрицательными/);
  assert.throws(() => U.unit('штука'), /КГ, Г, Л, МЛ или ШТ/);
  assert.strictEqual(U.unit(' кг '), 'КГ');
});

test('timesOf / typeKey / mealsOf', () => {
  assert.deepStrictEqual([0, 1, 2, '3', 99, 'x'].map(U.timesOf), [1, 1, 2, 3, 7, 1]);
  assert.deepStrictEqual(['Гарнир', 'салат', 'Доп', 'Основное', ''].map(U.typeKey), ['side', 'extra', 'extra', 'main', 'main']);
  assert.deepStrictEqual(U.mealsOf('Обед, Ужин'), ['Обед', 'Ужин']);
  assert.deepStrictEqual(U.mealsOf(''), ['Завтрак', 'Обед', 'Ужин']);
});

test('getState через apply совпадает с эталоном и не меняет вход', () => {
  const p = makePair(sheets);
  const before = JSON.stringify(p.state);
  p.step('getState');
  assert.strictEqual(JSON.stringify(p.state), before);
});

test('apply не мутирует исходное состояние при ошибке', () => {
  const p = makePair(sheets);
  const before = JSON.stringify(p.state);
  assert.throws(() => p.logic.apply('deleteProduct', p.state, ['нет']), /Продукт не найден/);
  assert.strictEqual(JSON.stringify(p.state), before);
  assert.throws(() => p.logic.apply('нет-такого', p.state, []), /Неизвестное действие/);
});

test('notice прошлого действия не «залипает»', () => {
  const p = makePair(sheets);
  const withNotice = Object.assign({}, p.state, { notice: 'старое' });
  const out = p.logic.apply('getState', withNotice, []);
  assert.strictEqual(out.notice, undefined);
});

test('новые записи журнала помечены _new, старые — нет; пометка переживает следующее действие', () => {
  const p = makePair(sheets);
  const a = p.logic.apply('saveProduct', p.state, [{ name: 'Сахар', unit: 'КГ', stock: 1, min: 0, total: 500 }]);
  assert.strictEqual(a.log[0]._new, true);
  assert.strictEqual(a.log[a.log.length - 1]._new, undefined);
  assert.strictEqual(a.purchases[a.purchases.length - 1]._new, true);
  const b = p.logic.apply('saveProduct', a, [{ name: 'Мука', unit: 'КГ', stock: 0, min: 0 }]);
  assert.strictEqual(b.log.filter(e => e._new).length, 2);
  assert.strictEqual(b.purchases.filter(e => e._new).length, 1);
});

test('те же rng/id: последовательность ID совпадает с эталоном', () => {
  const p = makePair(sheets, { startId: 5 });
  p.step('saveProduct', { name: 'Тест', unit: 'ШТ', stock: 0, min: 0 });
  assert.ok(p.state.products.some(x => x.id === det.idGen(5)()));
});
