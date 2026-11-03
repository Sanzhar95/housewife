'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makePair } = require('../helpers/pair');
const sheets = require('../fixtures/sheets.synthetic.json');

const clone = x => JSON.parse(JSON.stringify(x));
function withStock(fn) { const s = clone(sheets); fn(s['Продукты'].slice(1)); return s; }

const SEEDS = [1, 2, 3, 4, 5];

for (const seed of SEEDS) {
  test('generateWeek (seed ' + seed + '): из имеющегося и без учёта склада', () => {
    for (const onlyAvail of [true, false]) {
      const p = makePair(sheets, { seed });
      const r = p.step('generateWeek', { onlyAvail });
      assert.ok(r.state && r.state.plan.length > 0, 'меню должно составиться');
      p.step('generateWeek', { onlyAvail, meals: ['Ужин'], sides: false, leftovers: false });
      p.check();
    }
  });
}

test('generateWeek: понедельник, воскресенье, другая неделя (план сбрасывается)', () => {
  for (const now of ['2026-11-09T09:00:00+05:00', '2026-11-08T23:30:00+05:00', '2026-11-02T00:10:00+05:00']) {
    const p = makePair(sheets, { now, seed: 3 });
    p.step('generateWeek', { onlyAvail: false });
    p.check();
  }
});

test('generateWeek: пустой склад, нет блюд, нет приёмов', () => {
  const empty = withStock(rows => rows.forEach(r => { r[3] = 0; }));
  const p = makePair(empty, { seed: 2 });
  p.step('generateWeek', { onlyAvail: true });
  const noDishes = clone(sheets); noDishes['Блюда'].length = 1; noDishes['Состав'].length = 1; noDishes['План'].length = 1;
  const q = makePair(noDishes);
  assert.ok(q.step('generateWeek', {}).error);
  assert.ok(makePair(sheets).step('generateWeek', { meals: [] }).error);
});

test('generateWeek: невыполненные «вчерашние» старой недели теряются как в эталоне (особенность 3)', () => {
  const p = makePair(sheets, { now: '2026-11-10T10:00:00+05:00', seed: 4 });
  const before = p.state.plan.filter(i => i.left).length;
  assert.ok(before >= 1);
  p.step('generateWeek', { onlyAvail: false, leftovers: false });
  p.check();
});

test('addItem / rerollItem / setItem / removeItem', () => {
  for (const seed of SEEDS) {
    const p = makePair(sheets, { seed });
    p.step('addItem', 4, 'Обед', 'main', '', true);
    p.step('addItem', 4, 'Обед', 'main', '', false);                    // основное уже есть
    p.step('addItem', 4, 'Обед', 'extra', '', false);
    p.step('addItem', 5, 'Ужин', 'main', 'ds000002', true);             // блюдо с гарниром
    p.step('addItem', 5, 'Завтрак', 'main', 'ds000003', false);
    p.step('addItem', 9, 'Ужин', 'main', '');                           // неверный день
    p.step('addItem', 1, 'Полдник', 'main', '');
    p.step('addItem', 5, 'Ужин', 'extra', 'нет');
    const it = p.state.plan.find(i => i.day === 4 && i.meal === 'Обед' && i.kind === 'main');
    p.step('rerollItem', it.id, true);
    p.step('rerollItem', it.id, false);
    p.step('rerollItem', 'pl000001', false);                            // уже приготовлено
    p.step('rerollItem', 'нет', false);
    p.step('setItem', it.id, 'ds000003');
    p.step('setItem', it.id, 'ds000004');
    p.step('setItem', it.id, 'нет');
    p.step('setItem', 'pl000001', 'ds000002');
    p.step('removeItem', it.id);
    p.step('removeItem', it.id);
    p.step('removeItem', 'pl000001');
    p.step('setItem', 'pl000005', '');                                  // пустое значение убирает запись
    p.check();
  }
});

test('rerollItem в пустом/безвыходном случае: нет других блюд, нет салатов', () => {
  const s = withStock(rows => rows.forEach(r => { r[3] = 0; }));
  const p = makePair(s, { seed: 1 });
  p.step('rerollItem', 'pl000005', true);
  p.step('addItem', 6, 'Ужин', 'extra', '', true);
  const one = clone(sheets); one['Блюда'] = one['Блюда'].filter((r, i) => i === 0 || ['ds000001', 'ds000005'].includes(r[0]));
  const q = makePair(one);
  q.step('rerollItem', 'pl000002', false);
  q.step('addItem', 6, 'Ужин', 'extra', '', false);
});

test('setSide / rerollSide (до и после готовки)', () => {
  for (const seed of SEEDS) {
    const p = makePair(sheets, { seed });
    p.step('setSide', '35409132', 'ds000006');
    p.step('setSide', '35409132', '');
    p.step('setSide', '35409132', undefined);                           // особенность 5
    p.step('setSide', '35409132', 'нет');
    p.step('setSide', 'pl000004', 'ds000005');                          // гарнир только к основному
    p.step('rerollSide', '35409132', true);
    p.step('rerollSide', '35409132', false);
    p.step('rerollSide', 'pl000002', false);                            // вчерашнее
    p.step('setSide', 'pl000001', 'ds000005');                          // уже приготовлено: пересчёт склада
    p.step('rerollSide', 'pl000001', false);
    p.step('setSide', 'pl000001', 'ds000005');
    p.check();
  }
});
