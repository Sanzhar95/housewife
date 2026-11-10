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
const ROOMS3 = [{ name: 'Спальня', type: 'bedroom' }, { name: 'Гостиная', type: 'living' }, { name: 'Детская', type: 'kids' }];
function ready(x, rooms, settings) {
  return x.L.apply('saveCleanRooms', x.L.emptyData(), [rooms || ROOMS3, settings || {}]).data;
}
const done = (x, d, ids) => x.L.apply('cleanDone', d, [ids]);
const supplyOf = (d, kind) => d.supplies.find(s => s.kind === kind);

test('пустые данные: 5 типовых расходников, остаток не указан, минимум = расход × 5; генеральных 8; не готово', () => {
  const d = mk().L.emptyData();
  assert.strictEqual(d.settings.ready, false);
  assert.deepStrictEqual(d.supplies.map(s => [s.kind, s.per, s.min, s.stock, s.unit]),
    [['floor', 40, 200, null, 'МЛ'], ['kitchen', 30, 150, null, 'МЛ'], ['bath', 60, 300, null, 'МЛ'], ['wc', 50, 250, null, 'МЛ'], ['dust', 15, 75, null, 'МЛ']]);
  assert.strictEqual(d.generals.length, 8);
});

test('3 комнаты + кухня, коридор, ванная, туалет: каждый день ≤ 60 мин, воскресенье свободно', () => {
  const x = mk(), st = x.L.state(ready(x));
  st.days.forEach(d => assert.ok(d.min <= 60, d.name + ' ' + d.min));
  assert.strictEqual(st.days[6].min, 0);
  assert.strictEqual(st.days[6].rest, true);
  assert.strictEqual(st.tasks.filter(t => !t.gen).length, 13);   // 5 в комнатах + кухня 3 + коридор 1 + ванная 2 + туалет 2
  assert.strictEqual(st.totalMin, st.tasks.reduce((a, t) => a + t.min, 0));
});

test('не больше одной тяжёлой задачи в день', () => {
  const x = mk(), st = x.L.state(ready(x));
  st.days.forEach(d => assert.ok(d.ids.map(id => st.tasks.find(t => t.id === id)).filter(t => t.heavy).length <= 1, d.name));
});

test('повторы одного дела (детская ×2, кухня ×2) не ближе 3 дней', () => {
  const x = mk(), st = x.L.state(ready(x));
  const groups = {};
  st.tasks.forEach(t => { const g = t.id.split('.').slice(0, 2).join('.'); (groups[g] = groups[g] || []).push(t.day); });
  const multi = Object.values(groups).filter(a => a.length > 1);
  assert.ok(multi.length >= 2);
  multi.forEach(a => assert.ok(Math.abs(a[0] - a[1]) >= 3, JSON.stringify(a)));
});

test('раскладка детерминирована', () => {
  const a = mk(), b = mk();
  assert.deepStrictEqual(a.L.state(ready(a)).tasks.map(t => [t.id, t.day]), b.L.state(ready(b)).tasks.map(t => [t.id, t.day]));
});

test('тексты: больше 8 комнат — ошибка; пустое имя = «Комната N»', () => {
  const x = mk();
  assert.throws(() => x.L.apply('saveCleanRooms', x.L.emptyData(), [new Array(9).fill({ name: 'x' }), {}]), /Комнат может быть не больше 8\./);
  const d = x.L.apply('saveCleanRooms', x.L.emptyData(), [[{ name: '' }, { name: '  ' }], {}]).data;
  assert.deepStrictEqual(d.rooms.map(r => r.name), ['Комната 1', 'Комната 2']);
});

test('настройки: все 7 дней отдыха недопустимо → [7]; лимит в границах', () => {
  const x = mk();
  const d = x.L.apply('saveCleanSettings', ready(x), [{ rest: [1, 2, 3, 4, 5, 6, 7], limit: 5 }]).data;
  assert.deepStrictEqual(d.settings.rest, [7]);
  assert.strictEqual(d.settings.limit, 20);
});

test('«Завтра»: переносит на следующий рабочий день, остальные дела не двигаются, выходной пропускается', () => {
  const x = mk('2026-11-02'), d0 = ready(x, ROOMS3, { rest: [2, 7] });
  const s0 = x.L.state(d0);
  const t = s0.tasks.find(t => t.day === 1);
  const r = x.L.apply('cleanLater', d0, [t.id]).data, s1 = x.L.state(r);
  assert.strictEqual(s1.tasks.find(y => y.id === t.id).day, 3);   // вторник — выходной
  assert.strictEqual(s1.tasks.find(y => y.id === t.id).moved, true);
  s0.tasks.filter(y => y.id !== t.id).forEach(y => assert.strictEqual(s1.tasks.find(z => z.id === y.id).day, y.day, y.id));
  s1.tasks.forEach(y => assert.ok(s1.days[y.day - 1].rest === false));
});

test('«Завтра» без свободных дней — понятная ошибка; сделанное не переносится', () => {
  const x = mk(), d0 = ready(x), s0 = x.L.state(d0);
  const last = s0.tasks.filter(t => t.day === 6)[0];
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

test('расходники: списываются по виду уборки только при указанном остатке и возвращаются точно', () => {
  const x = mk();
  let d = ready(x);
  const floor = supplyOf(d, 'floor');
  d = x.L.apply('saveSupply', d, [Object.assign({}, floor, { stock: 1000 })]).data;
  const t = x.L.state(d).tasks.find(y => y.k === 'floor');
  const d1 = done(x, d, t.id).data;
  assert.strictEqual(supplyOf(d1, 'floor').stock, 960);
  assert.strictEqual(supplyOf(d1, 'bath').stock, null);          // учёт не ведётся — не трогаем
  const d2 = x.L.apply('cleanUndo', d1, [t.id]).data;
  assert.strictEqual(supplyOf(d2, 'floor').stock, 1000);
  assert.strictEqual(d2.rows.find(r => r.id === t.id).done, '');
});

test('расходники: остаток меньше нормы — списывается остаток и возвращается ровно он', () => {
  const x = mk();
  let d = ready(x);
  d = x.L.apply('saveSupply', d, [Object.assign({}, supplyOf(d, 'floor'), { stock: 25 })]).data;
  const t = x.L.state(d).tasks.find(y => y.k === 'floor');
  const r = done(x, d, t.id);
  assert.strictEqual(supplyOf(r.data, 'floor').stock, 0);
  assert.strictEqual(r.notice, 'Заканчивается: Средство для полов');
  assert.strictEqual(supplyOf(x.L.apply('cleanUndo', r.data, [t.id]).data, 'floor').stock, 25);
});

test('расходники: «Заканчивается» только когда остаток ≤ минимума; без учёта заметки нет', () => {
  const x = mk();
  let d = ready(x);
  const t = x.L.state(d).tasks.find(y => y.k === 'floor');
  assert.strictEqual(done(x, d, t.id).notice, '');
  d = x.L.apply('saveSupply', d, [Object.assign({}, supplyOf(d, 'floor'), { stock: 1000 })]).data;
  assert.strictEqual(done(x, d, t.id).notice, '');
  assert.deepStrictEqual(x.L.state(d).low, []);
});

test('«Купила»: прибавляет к остатку (если не следили — начинаем с этого); ошибки', () => {
  const x = mk(), d = ready(x), id = supplyOf(d, 'wc').id;
  assert.strictEqual(supplyOf(x.L.apply('restockSupply', d, [id, '500']).data, 'wc').stock, 500);
  assert.throws(() => x.L.apply('restockSupply', d, [id, 0]), /Сколько купили\?/);
  assert.throws(() => x.L.apply('restockSupply', d, ['нет', 5]), /Такого расходника нет\./);
  assert.throws(() => x.L.apply('saveSupply', d, [{ name: ' ' }]), /Напишите название\./);
});

test('генеральная: ровно одна в неделю, самая просроченная; сделанная остаётся в плане; отмена возвращает дату', () => {
  const x = mk();
  let d = ready(x);
  let st = x.L.state(d);
  assert.strictEqual(st.tasks.filter(t => t.gen).length, 1);          // ни разу не делали — все «пора»
  assert.strictEqual(st.general.filter(g => g.inPlan).length, 1);
  d = x.L.apply('saveGeneral', d, [{ id: 'g_tile', last: '2026-09-01' }]).data;   // 62 дня при периоде 1 мес.
  for (const g of d.generals) if (g.id !== 'g_tile') d = x.L.apply('saveGeneral', d, [{ id: g.id, last: '2026-11-01' }]).data;
  st = x.L.state(d);
  const g = st.tasks.find(t => t.gen);
  assert.strictEqual(g.id, 'g:g_tile');
  const r = done(x, d, g.id).data;
  assert.strictEqual(r.generals.find(y => y.id === 'g_tile').last, '2026-11-02');
  const st2 = x.L.state(r);
  assert.strictEqual(st2.tasks.filter(t => t.gen).length, 1);          // осталась в плане, сделанная
  assert.strictEqual(st2.tasks.find(t => t.gen).done, true);
  const u = x.L.apply('cleanUndo', r, [g.id]).data;
  assert.strictEqual(u.generals.find(y => y.id === 'g_tile').last, '2026-09-01');
});

test('генеральная: «пора», если прошло ≥ период×30−3 дней; отключённая не попадает в план', () => {
  const x = mk();
  let d = ready(x);
  for (const g of d.generals) d = x.L.apply('saveGeneral', d, [{ id: g.id, last: '2026-11-01' }]).data;
  assert.strictEqual(x.L.state(d).tasks.filter(t => t.gen).length, 0);
  d = x.L.apply('saveGeneral', d, [{ id: 'g_win', last: '2026-08-08' }]).data;    // 86 дней = 90−4 → ещё нет
  assert.strictEqual(x.L.state(d).tasks.filter(t => t.gen).length, 0);
  d = x.L.apply('saveGeneral', d, [{ id: 'g_win', last: '2026-08-07' }]).data;    // 87 дней = 90−3 → пора
  assert.strictEqual(x.L.state(d).tasks.find(t => t.gen).id, 'g:g_win');
  d = x.L.apply('saveGeneral', d, [{ id: 'g_win', on: false }]).data;
  assert.strictEqual(x.L.state(d).tasks.filter(t => t.gen).length, 0);
  assert.throws(() => x.L.apply('saveGeneral', d, [{ id: 'g_win', months: 5 }]), /Раз в 1, 2 или 3 месяца\./);
  assert.throws(() => x.L.apply('saveGeneral', d, [{ id: 'g_win', last: '1.2.2026' }]), /Дата: год-месяц-день\./);
  assert.throws(() => x.L.apply('saveGeneral', d, [{ id: 'нет' }]), /Такой генеральной задачи нет\./);
});

test('генеральная в плане занимает место: день с ней не превышает лимит', () => {
  const x = mk(), st = x.L.state(ready(x));
  assert.ok(st.tasks.some(t => t.gen));
  st.days.forEach(d => assert.ok(d.min <= 60, d.name + ' ' + d.min));
});

test('смена настроек и комнат сбрасывает переносы, но не сделанное', () => {
  const x = mk(), d0 = ready(x), s0 = x.L.state(d0);
  const a = s0.tasks.find(t => t.day === 1 && !t.gen), b = s0.tasks.find(t => t.day === 1 && t.id !== a.id && !t.gen);
  let d = done(x, d0, a.id).data;
  d = x.L.apply('cleanLater', d, [b.id]).data;
  assert.ok(x.L.state(d).tasks.find(t => t.id === b.id).moved);
  const d2 = x.L.apply('saveCleanSettings', d, [{ limit: 90 }]).data;
  assert.strictEqual(x.L.state(d2).tasks.find(t => t.id === a.id).done, true);
  assert.strictEqual(x.L.state(d2).tasks.find(t => t.id === b.id).moved, false);
  const d3 = x.L.apply('saveCleanRooms', d, [ROOMS3.slice(0, 2).map((r, i) => Object.assign({ id: d.rooms[i].id }, r)), {}]).data;
  assert.strictEqual(x.L.state(d3).tasks.find(t => t.id === a.id).done, true);
  assert.strictEqual(d3.rows.filter(r => !r.done).length, 0);
});

test('просроченные: невыполненные с прошлых дней помечены late; «быстрая уборка» ≤ 15 минут и без тяжёлых', () => {
  const x = mk('2026-11-02'), d = ready(x);
  x.setToday('2026-11-04');                                           // среда
  const st = x.L.state(d);
  assert.ok(st.tasks.some(t => t.late === (t.day < 3) && t.late));
  const q = st.quick.map(id => st.tasks.find(t => t.id === id));
  assert.ok(q.length >= 1 && q.reduce((a, t) => a + t.min, 0) <= 15);
  q.forEach(t => assert.ok(!t.heavy && !t.gen && !t.done));
  assert.ok(q.every((t, i) => i === 0 || (t.day > 3) >= (q[i - 1].day > 3)));   // сначала сегодняшние и просроченные
  const r = x.L.apply('cleanDone', d, [st.quick]).data;
  st.quick.forEach(id => assert.strictEqual(x.L.state(r).tasks.find(t => t.id === id).done, true));
});

test('отмена неотмеченной задачи — ошибка; неизвестная задача — ошибка', () => {
  const x = mk(), d = ready(x);
  assert.throws(() => x.L.apply('cleanUndo', d, ['x.0.1']), /Эта задача и так не отмечена\./);
  assert.throws(() => x.L.apply('cleanDone', d, ['нет.0.1']), /Этой задачи уже нет в плане\. Обновите страницу\./);
});

test('неделя считается от понедельника; в новой неделе дела не «залипают» как сделанные', () => {
  const x = mk('2026-11-03');                                         // вторник
  const d0 = ready(x), t = x.L.state(d0).tasks[0];
  assert.strictEqual(x.L.state(d0).week, '2026-11-02');
  const d1 = done(x, d0, t.id).data;
  x.setToday('2026-11-09');                                           // следующий понедельник
  const st = x.L.state(d1);
  assert.strictEqual(st.week, '2026-11-09');
  assert.strictEqual(st.tasks.filter(y => y.done).length, 0);
});

test('нормализация идемпотентна и не теряет данные; неизвестные поля (в том числе кухня) отбрасываются', () => {
  const x = mk(), d = ready(x);
  assert.deepStrictEqual(x.L.normalize(d), d);
  assert.deepStrictEqual(x.L.normalize(x.L.normalize({ kitchen: [1], products: [2], rooms: [{ id: 'a', name: 'К', type: 'bad' }] })).rooms, [{ id: 'a', name: 'К', type: 'bedroom' }]);
  assert.strictEqual(x.L.normalize(null).generals.length, 8);
});

test('apply не меняет исходные данные и не знает про кухню', () => {
  const x = mk(), d = ready(x), snap = JSON.stringify(d);
  const t = x.L.state(d).tasks[0];
  x.L.apply('cleanDone', d, [t.id]);
  x.L.apply('saveSupply', d, [{ name: 'Тряпки', unit: 'ШТ', stock: 3, min: 1, kind: '', per: 0 }]);
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
