'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makePair } = require('../helpers/pair');
const sheets = require('../fixtures/sheets.synthetic.json');

const clone = x => JSON.parse(JSON.stringify(x));
const rich = () => { const s = clone(sheets); s['Продукты'].slice(1).forEach(r => { r[3] = 50; }); return s; };

test('cookItem: обычная готовка, порции, повтор, нехватка', () => {
  const p = makePair(sheets);
  p.step('cookItem', '35409132', { portions: '6' });                     // курица+гречка на 6 порций
  p.step('cookItem', '35409132', {});                                    // уже приготовлено
  p.step('cookItem', 'pl000005');                                        // омлет
  p.step('cookItem', 'нет');
  p.step('cookItem', 'pl000002');                                        // вчерашнее: склад не меняется
  p.check();
  const q = makePair(sheets);
  q.step('cookItem', '35409132', { portions: '100' });                   // не хватает
  q.step('cookItem', '35409132', { portions: '101' });                   // больше максимума
  q.check();
});

test('cookItem: «хватает на N раз», target, none, src, особенность 2', () => {
  for (const seed of [1, 2]) {
    const p = makePair(rich(), { seed });
    p.step('addItem', 3, 'Ужин', 'main', 'ds000004', false);             // Котлеты, times=3
    const it = p.state.plan.find(i => i.day === 3 && i.meal === 'Ужин');
    p.step('cookItem', it.id, {});                                       // остатки уходят в следующие дни
    p.step('undoItem', it.id);                                           // и убираются (особенность 1 — рецепт не менялся)
    p.step('cookItem', it.id, { times: 2 });
    p.step('undoItem', it.id);
    p.step('cookItem', it.id, { target: { day: 6, meal: 'Обед' } });
    p.step('undoItem', it.id);
    p.step('cookItem', it.id, { target: 'none' });
    p.step('undoItem', it.id);
    p.step('cookItem', it.id, { day: 4, meal: 'Обед' });                 // старый формат {day, meal}
    p.step('undoItem', it.id);
    p.step('cookItem', it.id, { target: { day: 9, meal: 'Обед' } });     // неверный слот
    p.check();
  }
});

test('остатки не переносятся на следующую неделю (особенность 4: текст уведомления)', () => {
  const p = makePair(rich());
  p.step('addItem', 7, 'Ужин', 'main', 'ds000004', false);
  const it = p.state.plan.find(i => i.day === 7 && i.meal === 'Ужин');
  p.step('cookItem', it.id, { times: 3 });
  p.step('addLeftover', 7, 'Обед', 'ds000001', 'ds000006');
  p.step('addLeftover', 7, 'Полдник', 'ds000001', '');
  p.step('addLeftover', 3, 'Обед', 'нет', '');
  p.step('addLeftover', 2, 'Обед', 'ds000001', '');                      // слот занят
  p.step('addLeftover', 5, 'Ужин', 'ds000002', 'ds000005');              // занят приготовленным
  p.check();
});

test('cookMeal и setLeftover', () => {
  const p = makePair(rich());
  p.step('cookMeal', 2, 'Ужин', { portions: '3' });                      // основное + доп + гарнир
  p.step('cookMeal', 2, 'Ужин', {});                                     // нечего готовить
  p.step('cookMeal', 2, 'Обед', {});                                     // только вчерашнее
  p.step('cookMeal', 3, 'Завтрак', { portions: '2,5', times: 2 });
  p.step('setLeftover', 'pl000004', true);
  p.step('setLeftover', 'pl000004', false);
  p.step('setLeftover', 'pl000001', true);                               // уже приготовлено
  p.check();
});

test('undoItem: отмена, не приготовленное, после смены рецепта (особенность 1)', () => {
  const p = makePair(rich());
  p.step('undoItem', 'pl000005');                                        // ещё не приготовлено
  p.step('cookItem', 'pl000005', {});
  p.step('setIngredient', 'ds000003', 'pr000005', 8, 'ШТ');              // рецепт изменили после готовки
  p.step('undoItem', 'pl000005');                                        // вернётся по новому рецепту — как в эталоне
  p.step('undoItem', 'pl000001');                                        // приготовленный Плов, рядом вчерашнее from
  p.check();
});

test('смена гарнира у приготовленного, нехватка для нового гарнира', () => {
  const p = makePair(rich());
  p.step('cookItem', '35409132', {});
  p.step('setSide', '35409132', 'ds000006');
  p.step('rerollSide', '35409132', false);
  const poor = clone(sheets);
  poor['Продукты'].slice(1).forEach(r => { if (r[0] === 'pr0000001') r[3] = 0.3; });
  const q = makePair(poor);
  q.step('setSide', 'pl000001', 'ds000005');
  q.step('setSide', 'pl000001', 'ds000006');
  q.step('setSide', 'pl000001', 'ds000005');                             // гречка есть, рис возвращён
  q.check();
});

test('cookDish вне меню: с гарниром, порции, нехватка, гарнир как блюдо', () => {
  const p = makePair(rich());
  p.step('cookDish', 'ds000002', 'ds000005', { portions: '8' });
  p.step('cookDish', 'ds000004', 'ds000006', { times: 3 });
  p.step('cookDish', 'ds000005', '', {});                                 // гарнир сам по себе
  p.step('cookDish', 'ds000001', 'ds000006', { target: { day: 6, meal: 'Ужин' } });
  p.step('cookDish', 'нет', '', {});
  p.step('cookDish', 'ds000002', 'нет', {});
  p.check();
  const q = makePair(sheets);
  q.step('cookDish', 'ds000004', '', {});                                // нет фарша
  q.check();
});

test('пересечение минимума выдаёт notice «Заканчиваются»; порции дробные', () => {
  const p = makePair(sheets);
  const r = p.step('cookItem', 'pl000005', { portions: '4' });           // яйца 10 → 2, минимум 4
  assert.match(r.state.notice, /^Заканчиваются: .*Яйца/);
  const q = makePair(sheets);
  const r2 = q.step('cookItem', 'pl000005', { portions: '1,5' });
  assert.strictEqual(r2.state.notice, undefined);
  q.check();
});
