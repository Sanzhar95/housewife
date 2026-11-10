'use strict';
const test = require('node:test');
const assert = require('node:assert');
const CleanLogic = require('../../public/clean-logic.js');

/** today — 'yyyy-MM-dd'; по умолчанию понедельник 2026-11-02. */
function mk(today) {
  let n = 0, t = today || '2026-11-02';
  const L = CleanLogic.create({ id: () => 'id' + String(++n).padStart(6, '0'), now: () => t + ' 09:00', today: () => t });
  return { L, setToday: d => { t = d; } };
}
/** Выбор по умолчанию (как в прототипе) и режим «По дням-темам». */
const ready = (x, settings, picks) => x.L.apply('saveCleanPicks', x.L.emptyData(), [picks || [], settings || {}]).data;
const done = (x, d, ids) => x.L.apply('cleanDone', d, [ids]);
const supplyOf = (d, kind) => d.supplies.find(s => s.kind === kind);
const dayOf = (st, id) => st.tasks.find(t => t.id === id).day;
const noGens = (x, d) => { for (const g of d.generals) d = x.L.apply('saveGeneral', d, [{ id: g.id, last: '2026-11-01' }]).data; return d; };

test('пустые данные: 18 дел в списке, выбор по умолчанию, дни-темы, выходной — суббота, не готово', () => {
  const d = mk().L.emptyData();
  assert.strictEqual(d.settings.ready, false);
  assert.strictEqual(d.settings.mode, 'themes');
  assert.deepStrictEqual(d.settings.rest, [6]);
  assert.strictEqual(d.picks.length, 18);
  assert.deepStrictEqual(d.picks.filter(p => p.on).map(p => p.id),
    ['vac', 'dust', 'floor', 'tidy', 'stove', 'cab', 'counter', 'shower', 'wc', 'mirror', 'wash', 'iron', 'hall', 'plants']);
  const m = Object.fromEntries(d.picks.map(p => [p.id, p.min]));
  assert.deepStrictEqual([m.vac, m.dust, m.floor, m.shower, m.stove, m.cab, m.iron, m.wash], [30, 20, 30, 30, 30, 30, 25, 30]);
  assert.deepStrictEqual(d.supplies.map(s => [s.kind, s.per, s.min, s.stock]),
    [['floor', 40, 200, null], ['kitchen', 30, 150, null], ['bath', 60, 300, null], ['wc', 50, 250, null], ['dust', 15, 75, null]]);
  assert.strictEqual(d.generals.length, 8);
});

test('дни-темы: Пн стирка, Вт пылесос+пыль+полы, Ср плита+шкафы, Чт душевая+туалет, Сб выходной, Вс глажка', () => {
  const x = mk(), st = x.L.state(noGens(x, ready(x)));
  assert.strictEqual(dayOf(st, 'wash.1'), 1);
  ['vac.1', 'dust.1', 'floor.1'].forEach(id => assert.strictEqual(dayOf(st, id), 2, id));
  ['stove.1', 'cab.1'].forEach(id => assert.strictEqual(dayOf(st, id), 3, id));
  ['shower.1', 'wc.1'].forEach(id => assert.strictEqual(dayOf(st, id), 4, id));
  assert.strictEqual(dayOf(st, 'iron.1'), 7);
  assert.strictEqual(st.days[5].rest, true);
  assert.strictEqual(st.days[5].min, 0);
  st.tasks.filter(t => ['wash', 'vac', 'dust', 'floor', 'stove', 'cab', 'shower', 'wc', 'iron'].indexOf(t.group) >= 0).forEach(t => assert.strictEqual(t.rnd, false, t.id));
});

test('случайные дела: только в рабочие дни, помечены 🎲, раскладка не прыгает при повторном расчёте', () => {
  const x = mk(), d = ready(x), a = x.L.state(d), b = x.L.state(d);
  const rnd = a.tasks.filter(t => t.rnd);
  assert.ok(rnd.length >= 4);
  rnd.forEach(t => assert.ok(t.day !== 6, t.id + ' в выходной'));
  assert.deepStrictEqual(a.tasks.map(t => [t.id, t.day]), b.tasks.map(t => [t.id, t.day]));
});

test('случайные дела раскладываются поровну: каждое ложится в один из самых свободных дней', () => {
  const x = mk(), st = x.L.state(noGens(x, ready(x, { mode: 'mix' })));
  const work = st.days.filter(d => !d.rest).map(d => d.min);
  assert.ok(Math.max(...work) - Math.min(...work) <= 30, JSON.stringify(work));
});

test('«🎲 Перемешать»: случайные дела меняют дни, дела со своим днём остаются; разные недели — разная раскладка', () => {
  const x = mk(), d0 = ready(x), s0 = x.L.state(d0);
  let d = d0, changed = false;
  for (let i = 0; i < 5 && !changed; i++) {
    d = x.L.apply('cleanShuffle', d, []).data;
    const s = x.L.state(d);
    s0.tasks.filter(t => !t.rnd).forEach(t => assert.strictEqual(dayOf(s, t.id), t.day, t.id));
    changed = s0.tasks.some(t => t.rnd && dayOf(s, t.id) !== t.day);
  }
  assert.ok(changed, 'перемешивание ничего не поменяло');
  assert.ok(d.seeds['2026-11-02'] >= 1);
});

test('«Перемешать» не трогает сделанное, но снимает переносы', () => {
  const x = mk(), d0 = ready(x), s0 = x.L.state(d0);
  const a = s0.tasks.find(t => t.rnd && t.day >= 1);
  const b = s0.tasks.find(t => t.day === 1 && t.id !== a.id && !t.gen);
  let d = done(x, d0, a.id).data;
  d = x.L.apply('cleanLater', d, [b.id]).data;
  const d2 = x.L.apply('cleanShuffle', d, []).data, s2 = x.L.state(d2);
  assert.strictEqual(dayOf(s2, a.id), a.day);
  assert.strictEqual(s2.tasks.find(t => t.id === a.id).done, true);
  assert.strictEqual(s2.tasks.find(t => t.id === b.id).moved, false);
});

test('«Всё вперемешку»: своих дней нет, все дела случайные, выходной свободен', () => {
  const x = mk(), st = x.L.state(ready(x, { mode: 'mix' }));
  assert.ok(st.tasks.every(t => t.rnd));
  assert.strictEqual(st.days[5].min, 0);
});

test('дело 2–3 раза в неделю: копии не в один день и не в соседние', () => {
  const x = mk();
  let d = ready(x);
  d = x.L.apply('savePick', d, [{ id: 'counter', times: 3 }]).data;
  d = x.L.apply('savePick', d, [{ id: 'wash', times: 2 }]).data;
  const st = x.L.state(d);
  for (const g of ['counter', 'wash']) {
    const ds = st.tasks.filter(t => t.group === g).map(t => t.day).sort();
    assert.strictEqual(ds.length, g === 'counter' ? 3 : 2);
    for (let i = 1; i < ds.length; i++) assert.ok(ds[i] - ds[i - 1] >= 2, g + ' ' + ds);
  }
  assert.strictEqual(dayOf(st, 'wash.1'), 1);   // первая стирка — в свой день
});

test('шторка дела: минуты, день, «Не делаю»; последнее дело выключить нельзя; неизвестное дело — ошибка', () => {
  const x = mk();
  let d = ready(x);
  d = x.L.apply('savePick', d, [{ id: 'iron', min: 30, day: 5 }]).data;
  let st = x.L.state(d);
  assert.strictEqual(dayOf(st, 'iron.1'), 5);
  assert.strictEqual(st.tasks.find(t => t.id === 'iron.1').min, 30);
  d = x.L.apply('savePick', d, [{ id: 'iron', day: 0 }]).data;
  assert.strictEqual(x.L.state(d).tasks.find(t => t.id === 'iron.1').rnd, true);
  d = x.L.apply('savePick', d, [{ id: 'iron', on: false }]).data;
  assert.ok(!x.L.state(d).tasks.some(t => t.group === 'iron'));
  assert.throws(() => x.L.apply('savePick', d, [{ id: 'нет' }]), /Такого дела нет в списке\./);
  let one = x.L.apply('saveCleanPicks', x.L.emptyData(), [x.L.emptyData().picks.map(p => ({ id: p.id, on: p.id === 'wash' })), {}]).data;
  assert.throws(() => x.L.apply('savePick', one, [{ id: 'wash', on: false }]), /Отметьте хотя бы одно дело\./);
  assert.throws(() => x.L.apply('saveCleanPicks', one, [one.picks.map(p => ({ id: p.id, on: false })), {}]), /Отметьте хотя бы одно дело\./);
});

test('день-тема попал на выходной → дело раскладывается случайно, не в выходной', () => {
  const x = mk(), st = x.L.state(ready(x, { rest: [7] }));
  const t = st.tasks.find(y => y.id === 'iron.1');
  assert.strictEqual(t.rnd, true);
  assert.notStrictEqual(t.day, 7);
});

test('настройки: все 7 дней отдыха недопустимо → [6]; неизвестный режим → «По дням-темам»', () => {
  const x = mk();
  const d = x.L.apply('saveCleanSettings', ready(x), [{ rest: [1, 2, 3, 4, 5, 6, 7], mode: 'xxx' }]).data;
  assert.deepStrictEqual(d.settings.rest, [6]);
  assert.strictEqual(d.settings.mode, 'themes');
});

test('«Завтра»: на следующий рабочий день (выходной пропускается), остальные дела не двигаются', () => {
  const x = mk('2026-11-02'), d0 = ready(x, { rest: [2, 6] }), s0 = x.L.state(d0);
  const t = s0.tasks.find(y => y.id === 'wash.1');
  const r = x.L.apply('cleanLater', d0, [t.id]).data, s1 = x.L.state(r);
  assert.strictEqual(dayOf(s1, t.id), 3);
  assert.strictEqual(s1.tasks.find(y => y.id === t.id).moved, true);
  s0.tasks.filter(y => y.id !== t.id).forEach(y => assert.strictEqual(dayOf(s1, y.id), y.day, y.id));
  s1.tasks.forEach(y => assert.ok(!s1.days[y.day - 1].rest, y.id));
});

test('«Завтра» без свободных дней — понятная ошибка; сделанное не переносится', () => {
  const x = mk(), d0 = ready(x), s0 = x.L.state(d0);
  const last = s0.tasks.find(t => t.id === 'iron.1');
  assert.throws(() => x.L.apply('cleanLater', d0, [last.id]), /На этой неделе больше нет свободных дней\. Оставьте на сегодня или отметьте сделанной\./);
  const d1 = done(x, d0, last.id).data;
  assert.throws(() => x.L.apply('cleanLater', d1, [last.id]), /Эта задача уже сделана\./);
});

test('«Готово» запоминает положение ВСЕХ дел недели, остальные не прыгают', () => {
  const x = mk(), d0 = ready(x), s0 = x.L.state(d0);
  const d1 = done(x, d0, s0.tasks[0].id).data;
  assert.strictEqual(d1.rows.filter(r => r.week === '2026-11-02').length, s0.tasks.length);
  assert.deepStrictEqual(x.L.state(d1).tasks.map(t => [t.id, t.day]), s0.tasks.map(t => [t.id, t.day]));
});

test('расходники: полы списывают средство для полов, пылесос — ничего; отмена возвращает точно', () => {
  const x = mk();
  let d = ready(x);
  d = x.L.apply('saveSupply', d, [Object.assign({}, supplyOf(d, 'floor'), { stock: 1000 })]).data;
  const d0 = done(x, d, 'vac.1').data;
  assert.strictEqual(supplyOf(d0, 'floor').stock, 1000);
  const d1 = done(x, d, 'floor.1').data;
  assert.strictEqual(supplyOf(d1, 'floor').stock, 960);
  assert.strictEqual(supplyOf(d1, 'bath').stock, null);
  const d2 = x.L.apply('cleanUndo', d1, ['floor.1']).data;
  assert.strictEqual(supplyOf(d2, 'floor').stock, 1000);
  assert.strictEqual(d2.rows.find(r => r.id === 'floor.1').done, '');
});

test('расходники: остаток меньше нормы — списывается остаток и возвращается ровно он; заметка «Заканчивается»', () => {
  const x = mk();
  let d = ready(x);
  d = x.L.apply('saveSupply', d, [Object.assign({}, supplyOf(d, 'bath'), { stock: 25 })]).data;
  const r = done(x, d, 'shower.1');
  assert.strictEqual(supplyOf(r.data, 'bath').stock, 0);
  assert.strictEqual(r.notice, 'Заканчивается: Средство для ванной');
  assert.strictEqual(supplyOf(x.L.apply('cleanUndo', r.data, ['shower.1']).data, 'bath').stock, 25);
  assert.strictEqual(done(x, ready(x), 'floor.1').notice, '');   // без учёта — без заметки
});

test('«Купила»: прибавляет к остатку; ошибки', () => {
  const x = mk(), d = ready(x), id = supplyOf(d, 'wc').id;
  assert.strictEqual(supplyOf(x.L.apply('restockSupply', d, [id, '500']).data, 'wc').stock, 500);
  assert.throws(() => x.L.apply('restockSupply', d, [id, 0]), /Сколько купили\?/);
  assert.throws(() => x.L.apply('restockSupply', d, ['нет', 5]), /Такого расходника нет\./);
  assert.throws(() => x.L.apply('saveSupply', d, [{ name: ' ' }]), /Напишите название\./);
});

test('генеральная: ровно одна в неделю, самая просроченная; сделанная остаётся; отмена возвращает дату', () => {
  const x = mk();
  let d = ready(x);
  assert.strictEqual(x.L.state(d).tasks.filter(t => t.gen).length, 1);
  d = noGens(x, d);
  d = x.L.apply('saveGeneral', d, [{ id: 'g_tile', last: '2026-09-01' }]).data;
  const g = x.L.state(d).tasks.find(t => t.gen);
  assert.strictEqual(g.id, 'g:g_tile');
  assert.notStrictEqual(g.day, 6);
  const r = done(x, d, g.id).data;
  assert.strictEqual(r.generals.find(y => y.id === 'g_tile').last, '2026-11-02');
  const st2 = x.L.state(r);
  assert.strictEqual(st2.tasks.filter(t => t.gen).length, 1);
  assert.strictEqual(st2.tasks.find(t => t.gen).done, true);
  assert.strictEqual(x.L.apply('cleanUndo', r, [g.id]).data.generals.find(y => y.id === 'g_tile').last, '2026-09-01');
});

test('генеральная: «пора», если прошло ≥ период×30−3 дней; отключённая не попадает в план; ошибки', () => {
  const x = mk();
  let d = noGens(x, ready(x));
  assert.strictEqual(x.L.state(d).tasks.filter(t => t.gen).length, 0);
  d = x.L.apply('saveGeneral', d, [{ id: 'g_win', last: '2026-08-08' }]).data;
  assert.strictEqual(x.L.state(d).tasks.filter(t => t.gen).length, 0);
  d = x.L.apply('saveGeneral', d, [{ id: 'g_win', last: '2026-08-07' }]).data;
  assert.strictEqual(x.L.state(d).tasks.find(t => t.gen).id, 'g:g_win');
  d = x.L.apply('saveGeneral', d, [{ id: 'g_win', on: false }]).data;
  assert.strictEqual(x.L.state(d).tasks.filter(t => t.gen).length, 0);
  assert.throws(() => x.L.apply('saveGeneral', d, [{ id: 'g_win', months: 5 }]), /Раз в 1, 2 или 3 месяца\./);
  assert.throws(() => x.L.apply('saveGeneral', d, [{ id: 'g_win', last: '1.2.2026' }]), /Дата: год-месяц-день\./);
  assert.throws(() => x.L.apply('saveGeneral', d, [{ id: 'нет' }]), /Такой генеральной задачи нет\./);
});

test('смена дел и настроек сбрасывает переносы, но не сделанное', () => {
  const x = mk(), d0 = ready(x);
  let d = done(x, d0, 'wash.1').data;
  d = x.L.apply('cleanLater', d, ['vac.1']).data;
  assert.ok(x.L.state(d).tasks.find(t => t.id === 'vac.1').moved);
  for (const [name, args] of [['saveCleanSettings', [{ mode: 'mix' }]], ['savePick', [{ id: 'iron', min: 20 }]], ['saveCleanPicks', [[], {}]]]) {
    const r = x.L.apply(name, d, args).data, s = x.L.state(r);
    assert.strictEqual(s.tasks.find(t => t.id === 'wash.1').done, true, name);
    assert.strictEqual(s.tasks.find(t => t.id === 'vac.1').moved, false, name);
  }
});

test('просроченные помечены late; «быстрая уборка» ≤ 15 минут, без генеральных, сначала сегодняшние и просроченные', () => {
  const x = mk('2026-11-02'), d = ready(x);
  x.setToday('2026-11-04');
  const st = x.L.state(d);
  assert.ok(st.tasks.some(t => t.late));
  st.tasks.forEach(t => assert.strictEqual(t.late, t.day < 3 && !t.done, t.id));
  const q = st.quick.map(id => st.tasks.find(t => t.id === id));
  assert.ok(q.length >= 1 && q.reduce((a, t) => a + t.min, 0) <= 15);
  q.forEach(t => assert.ok(!t.gen && !t.done));
  const r = x.L.apply('cleanDone', d, [st.quick]).data;
  st.quick.forEach(id => assert.strictEqual(x.L.state(r).tasks.find(t => t.id === id).done, true));
});

test('отмена неотмеченной задачи — ошибка; неизвестная задача — ошибка', () => {
  const x = mk(), d = ready(x);
  assert.throws(() => x.L.apply('cleanUndo', d, ['wash.1']), /Эта задача и так не отмечена\./);
  assert.throws(() => x.L.apply('cleanDone', d, ['нет.1']), /Этой задачи уже нет в плане\. Обновите страницу\./);
});

test('новая неделя: сделанное прошлой недели не «залипает»; своя случайная раскладка', () => {
  const x = mk('2026-11-03');
  const d0 = ready(x);
  assert.strictEqual(x.L.state(d0).week, '2026-11-02');
  const d1 = done(x, d0, 'wash.1').data;
  x.setToday('2026-11-09');
  const st = x.L.state(d1);
  assert.strictEqual(st.week, '2026-11-09');
  assert.strictEqual(st.tasks.filter(y => y.done).length, 0);
});

test('переход со старой версии (комнаты): данные целы, один раз показываем выбор дел', () => {
  const x = mk();
  const old = { settings: { limit: 60, rest: [7], kitchen: true, hall: true, split: true, remind: false, ready: true },
    rooms: [{ id: 'r1', name: 'Спальня', type: 'bedroom' }], rows: [{ week: '2026-11-02', id: 'r1.0.1', day: 1, moved: false, done: '2026-11-02 10:00', spent: '', prev: '' }],
    generals: [{ id: 'g_win', on: true, months: 3, last: '2026-10-01' }], supplies: [{ id: 's1', name: 'Полы', unit: 'МЛ', stock: 300, min: 200, kind: 'floor', per: 40 }] };
  const n = x.L.normalize(old);
  assert.strictEqual(n.settings.ready, false);
  assert.strictEqual(n.settings.remind, false);
  assert.deepStrictEqual(n.settings.rest, [7]);
  assert.deepStrictEqual(n.rooms, old.rooms);
  assert.strictEqual(n.rows.length, 1);
  assert.strictEqual(n.generals.find(g => g.id === 'g_win').last, '2026-10-01');
  assert.strictEqual(n.supplies[0].stock, 300);
  const r = x.L.apply('saveCleanPicks', old, [[], { mode: 'themes' }]).data;
  assert.strictEqual(r.settings.ready, true);
  assert.strictEqual(x.L.normalize(r).settings.ready, true);
  assert.strictEqual(r.supplies[0].stock, 300);
});

test('нормализация идемпотентна; неизвестные поля (в том числе кухня) отбрасываются', () => {
  const x = mk(), d = ready(x);
  assert.deepStrictEqual(x.L.normalize(d), d);
  const n = x.L.normalize({ kitchen: [1], products: [2], picks: [{ id: 'iron', min: 999, times: 9, day: 12 }, { id: 'zzz', on: true }] });
  assert.strictEqual(n.kitchen, undefined);
  assert.deepStrictEqual(n.picks.find(p => p.id === 'iron'), { id: 'iron', on: true, min: 25, times: 1, day: 7 });
  assert.ok(!n.picks.some(p => p.id === 'zzz'));
  assert.strictEqual(x.L.normalize(null).generals.length, 8);
});

test('apply не меняет исходные данные и не знает про кухню', () => {
  const x = mk(), d = ready(x), snap = JSON.stringify(d);
  x.L.apply('cleanDone', d, ['wash.1']);
  x.L.apply('cleanShuffle', d, []);
  x.L.apply('savePick', d, [{ id: 'iron', on: false }]);
  assert.strictEqual(JSON.stringify(d), snap);
  assert.throws(() => x.L.apply('cookDish', d, []), /Неизвестное действие/);
});

test('свой расходник добавляется и удаляется; единица проверяется', () => {
  const x = mk();
  let d = ready(x);
  d = x.L.apply('saveSupply', d, [{ name: 'Губки', unit: 'кг?', stock: '', min: '2', kind: 'zzz', per: '1' }]).data;
  const s = d.supplies.find(y => y.name === 'Губки');
  assert.deepStrictEqual([s.unit, s.stock, s.min, s.kind, s.per], ['МЛ', null, 2, '', 1]);
  assert.strictEqual(x.L.apply('deleteSupply', d, [s.id]).data.supplies.some(y => y.id === s.id), false);
});
