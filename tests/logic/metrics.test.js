'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Logic = require('../../public/logic.js');
const det = require('../helpers/det');
const { createOracle } = require('../oracle/gs-runner');
const sheets = require('../fixtures/sheets.synthetic.json');

function mk(iso) {
  const clock = det.clock(iso);
  const L = Logic.create({ rng: det.rng(1), id: det.idGen(100), now: clock.now, today: clock.today });
  return { L, clock, S: createOracle(sheets).getState() };
}
const entries = (st, action) => st.log.filter(e => e.action === action);

test('замена блюда пишет «Блюдо заменено»', () => {
  const t = mk();
  const a = t.L.apply('rerollItem', t.S, ['35409132', false]);
  assert.strictEqual(entries(a, 'Блюдо заменено').length, 1);
  assert.strictEqual(entries(a, 'Блюдо заменено')[0]._new, true);
  const dish = a.dishes.find(d => d.id === a.plan.find(i => i.id === '35409132').dish);
  assert.strictEqual(entries(a, 'Блюдо заменено')[0].obj, dish.name);
});

test('ручной выбор, добавление и удаление тоже пишутся (по одной записи); ошибки — нет', () => {
  const t = mk();
  const a = t.L.apply('setItem', t.S, ['pl000005', 'ds000004']);
  assert.strictEqual(entries(a, 'Блюдо заменено').length, 1);
  const b = t.L.apply('addItem', a, [5, 'Ужин', 'main', 'ds000001', false]);
  assert.strictEqual(entries(b, 'Блюдо заменено').length, 2);
  const id = b.plan.find(i => i.day === 5 && i.meal === 'Ужин').id;
  const c = t.L.apply('removeItem', b, [id]);
  assert.strictEqual(entries(c, 'Блюдо заменено').length, 3);
  assert.match(entries(c, 'Блюдо заменено')[0].details, /убрано/);
  const d = t.L.apply('setItem', c, ['pl000005', '']);                  // пустое значение убирает запись
  assert.strictEqual(entries(d, 'Блюдо заменено').length, 4);
  assert.throws(() => t.L.apply('rerollItem', t.S, ['pl000001', false]), /уже приготовлено/);
});

test('touchMenu: не чаще раза в час', () => {
  const t = mk('2026-11-03T12:00:00+05:00');
  let s = t.L.apply('touchMenu', t.S, []);
  assert.strictEqual(entries(s, 'Меню открыто').length, 1);
  t.clock.set('2026-11-03T12:59:00+05:00');
  s = t.L.apply('touchMenu', s, []);
  assert.strictEqual(entries(s, 'Меню открыто').length, 1);
  t.clock.set('2026-11-03T13:01:00+05:00');
  s = t.L.apply('touchMenu', s, []);
  assert.strictEqual(entries(s, 'Меню открыто').length, 2);
  assert.ok(Logic.create({ rng: Math.random, id: () => 'x', now: () => '', today: () => '' }).actions.includes('touchMenu'));
});

test('другие действия не пишут эти записи', () => {
  const t = mk();
  const a = t.L.apply('adjustStock', t.S, ['pr000001', 1, 700]);
  assert.strictEqual(entries(a, 'Блюдо заменено').length + entries(a, 'Меню открыто').length, 0);
});
