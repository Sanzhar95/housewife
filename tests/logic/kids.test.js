'use strict';
// Модуль «Дети»: расписание дня, «Собрано», баннер, события, дни рождения, первый запуск, нормализация.
const test = require('node:test');
const assert = require('node:assert');
const KidsLogic = require('../../public/kids-logic.js');

/** Среда 11 ноября 2026 (день недели 3); время по умолчанию 12:00. */
function mk(now) {
  let n = 0;
  const clock = { now: now || '2026-11-11 12:00' };
  const L = KidsLogic.create({ id: () => 'id' + (++n), now: () => clock.now, today: () => clock.now.slice(0, 10) });
  return { L, clock };
}
const run = (L, d, name, ...args) => L.apply(name, d, args);

function family(L) {
  // Алия — школа + бассейн (Вт, Чт), Тимур — садик
  let d = run(L, null, 'setup', [{ name: 'Алия', kind: 'school' }, { name: 'Тимур', kind: 'kg' }],
    [{ kid: 0, tpl: 'school' }, { kid: 0, tpl: 'pool' }, { kid: 1, tpl: 'kg' }]).data;
  return d;
}

test('пустые данные: не готово, ничего на сегодня, баннера нет, «Кто отвозит» по умолчанию', () => {
  const { L } = mk();
  const st = L.state(null);
  assert.strictEqual(st.ready, false);
  assert.deepStrictEqual(st.todayItems, []);
  assert.strictEqual(st.banner, null);
  assert.deepStrictEqual(st.people, ['Я', 'Муж']);
  assert.strictEqual(st.todayIdx, 3);
  assert.strictEqual(st.monday, '2026-11-09');
});

test('первый запуск: дети и занятия из шаблонов, списки вещей заполнены, ready', () => {
  const { L } = mk();
  const r = run(L, null, 'setup', [{ name: ' Алия ', kind: 'school' }, { name: '', kind: 'kg' }], [{ kid: 0, tpl: 'school' }, { kid: 0, tpl: 'pool' }, { kid: 5, tpl: 'pool' }, { kid: 0, tpl: 'нет' }]);
  assert.strictEqual(r.data.ready, true);
  assert.strictEqual(r.data.kids.length, 1);
  assert.strictEqual(r.data.kids[0].name, 'Алия');
  assert.strictEqual(r.data.acts.length, 2, 'неверные ребёнок/шаблон пропускаются');
  const pool = r.data.acts.find(a => a.name === 'Бассейн');
  assert.deepStrictEqual(pool.days, [2, 4]);
  assert.ok(pool.bring.includes('Шапочка'));
  assert.strictEqual(pool.driver, 'Я');
  assert.match(r.notice, /2 зан/);
  assert.throws(() => run(L, null, 'setup', [{ name: '  ' }], []), /имя/);
});

test('расписание: сегодня (Ср) школа и садик, завтра (Чт) ещё бассейн; по времени', () => {
  const { L } = mk();
  const st = L.state(family(L));
  assert.deepStrictEqual(st.todayItems.map(i => i.name).sort(), ['Садик', 'Школа']);
  assert.deepStrictEqual(st.tomorrowItems.map(i => i.name).sort(), ['Бассейн', 'Садик', 'Школа']);
  const t = st.tomorrowItems;
  assert.ok(t.findIndex(i => i.name === 'Бассейн') > t.findIndex(i => i.name === 'Школа'), '17:00 после 08:00');
  assert.strictEqual(t.find(i => i.name === 'Бассейн').kidName, 'Алия');
  assert.strictEqual(st.week.length, 7);
  assert.strictEqual(st.week[5].items.length, 0, 'суббота пустая');
});

test('«Собрано»: отметка на дату, снимается, старые отметки (>30 дней) удаляются сами', () => {
  const { L, clock } = mk();
  let d = family(L);
  const st = L.state(d);
  const pool = st.tomorrowItems.find(i => i.name === 'Бассейн');
  d = run(L, d, 'pack', pool.key, st.tomorrow, true).data;
  assert.strictEqual(L.state(d).tomorrowItems.find(i => i.key === pool.key).packed, true);
  assert.strictEqual(L.state(d).todayItems.some(i => i.packed), false, 'отметка только на свою дату');
  d = run(L, d, 'pack', pool.key, st.tomorrow, false).data;
  assert.strictEqual(L.state(d).tomorrowItems.find(i => i.key === pool.key).packed, false);
  assert.deepStrictEqual(d.packed, {});
  d = run(L, d, 'pack', pool.key, st.tomorrow, true).data;
  clock.now = '2026-12-20 10:00';
  assert.deepStrictEqual(L.normalize(d).packed, {}, 'через 30+ дней отметка удалена');
  assert.throws(() => run(L, d, 'pack', 'a:нет', '2026-12-20', true), /Такого занятия нет/);
});

test('баннер: днём — несобранное на сегодня и ещё не начавшееся; вечером — на завтра', () => {
  const { L, clock } = mk('2026-11-11 07:30');
  let d = family(L);
  let b = L.state(d).banner;
  assert.strictEqual(b.evening, false);
  assert.strictEqual(b.items.length, 2);
  clock.now = '2026-11-11 12:00';
  assert.strictEqual(L.state(d).banner, null, 'в 12:00 школа и садик уже начались');
  clock.now = '2026-11-11 19:00';
  b = L.state(d).banner;
  assert.strictEqual(b.evening, true);
  assert.strictEqual(b.date, '2026-11-12');
  assert.deepStrictEqual(b.items.map(i => i.name).sort(), ['Бассейн', 'Садик', 'Школа']);
  const st = L.state(d);
  st.tomorrowItems.forEach(i => { d = run(L, d, 'pack', i.key, st.tomorrow, true).data; });
  assert.strictEqual(L.state(d).banner, null, 'всё собрано — баннера нет');
});

test('событие: сохраняется, видно в своём дне, напоминание за N дней, прошлая дата — ошибка', () => {
  const { L, clock } = mk('2026-11-11 10:00');
  let d = family(L);
  const kid = d.kids[0].id;
  d = run(L, d, 'saveEvent', { kid, date: '2026-11-14', time: '10:30', name: 'Стоматолог', type: 'doctor', bring: 'Полис, бахилы', driver: 'Бабушка', remind: 3 }).data;
  const ev = d.events[0];
  assert.deepStrictEqual(ev.bring, ['Полис', 'бахилы']);
  assert.ok(d.people.includes('Бабушка'), 'новый «кто отвозит» запоминается');
  let st = L.state(d);
  assert.strictEqual(st.upcoming[0].in, 3);
  assert.strictEqual(st.week[5].items[0].name, 'Стоматолог');
  assert.strictEqual(st.banner.remind.length, 1, 'за 3 дня — напоминание');
  clock.now = '2026-11-13 19:00';
  st = L.state(d);
  assert.ok(st.banner.items.some(i => i.key === 'e:' + ev.id), 'вечером накануне — в списке «собрать на завтра»');
  assert.strictEqual(st.banner.remind.length, 0, 'без повтора в напоминаниях');
  assert.throws(() => run(L, d, 'saveEvent', { date: '2026-11-01', name: 'Прошлое' }), /прошла/);
  assert.throws(() => run(L, d, 'saveEvent', { date: '', name: 'Без даты' }), /дату/);
  d = run(L, d, 'deleteEvent', ev.id).data;
  assert.strictEqual(d.events.length, 0);
});

test('день рождения повторяется каждый год, напоминание по умолчанию за 7 дней', () => {
  const { L } = mk('2026-11-11 10:00');
  let d = family(L);
  d = run(L, d, 'saveEvent', { date: '2020-11-15', name: 'ДР Димы — подарок', type: 'bday' }).data;
  assert.strictEqual(d.events[0].remind, 7);
  const st = L.state(d);
  assert.strictEqual(st.upcoming[0].when, '2026-11-15');
  assert.strictEqual(st.upcoming[0].in, 4);
  assert.strictEqual(KidsLogic.nextBday('2020-02-29', '2027-01-01'), '2027-02-28');
  assert.strictEqual(KidsLogic.nextBday('2020-03-01', '2026-11-11'), '2027-03-01');
});

test('занятие: проверка полей, правка, удаление вместе с отметками; ребёнок удаляется с занятиями', () => {
  const { L } = mk();
  let d = family(L);
  const kid = d.kids[1].id;
  assert.throws(() => run(L, d, 'saveAct', { kid, name: 'Танцы', days: [] }), /день/);
  assert.throws(() => run(L, d, 'saveAct', { kid, name: '', days: [1] }), /занятие/);
  assert.throws(() => run(L, d, 'saveAct', { kid: 'чужой', name: 'X', days: [1] }), /ребёнка/);
  d = run(L, d, 'saveAct', { kid, name: 'Танцы', emo: '💃', days: [3, 3, 9, 1], time: '9:05', place: 'ДК', driver: 'Муж', bring: ['Чешки', 'Чешки', ''] }).data;
  const a = d.acts.find(x => x.name === 'Танцы');
  assert.deepStrictEqual(a.days, [1, 3]);
  assert.strictEqual(a.time, '09:05');
  assert.deepStrictEqual(a.bring, ['Чешки']);
  d = run(L, d, 'saveAct', Object.assign({}, a, { time: '25:00' })).data;
  assert.strictEqual(d.acts.find(x => x.id === a.id).time, '', 'неверное время — пусто');
  d = run(L, d, 'pack', 'a:' + a.id, '2026-11-11', true).data;
  d = run(L, d, 'deleteAct', a.id).data;
  assert.ok(!d.acts.some(x => x.id === a.id));
  assert.deepStrictEqual(d.packed, {});
  const ev = run(L, d, 'saveEvent', { kid, date: '2026-11-20', name: 'Утренник', type: 'party' }).data;
  const after = run(L, ev, 'deleteKid', kid).data;
  assert.strictEqual(after.kids.length, 1);
  assert.ok(!after.acts.some(x => x.kid === kid));
  assert.strictEqual(after.events[0].kid, '', 'событие остаётся — для всей семьи');
});

test('«Кто отвозит»: список правится, пустой нельзя', () => {
  const { L } = mk();
  let d = run(L, null, 'savePeople', ['Я', ' Бабушка ', 'Я', '']).data;
  assert.deepStrictEqual(d.people, ['Я', 'Бабушка']);
  assert.throws(() => run(L, d, 'savePeople', ['']), /хотя бы/);
});

test('нормализация: мусор не ломает, apply не меняет исходные данные', () => {
  const { L } = mk();
  const junk = { kids: [{ id: 'k', name: 'А' }, null, { name: 'без id' }], acts: [{ id: 'x', kid: 'нет', name: 'Танцы', days: 'Пн' }], events: [{ id: 'e', name: 'X', date: 'вчера' }], packed: { '2026-11-11': ['a:x', 'мусор'], 'не дата': ['a:x'] }, people: [] };
  const n = L.normalize(junk);
  assert.strictEqual(n.kids.length, 1);
  assert.strictEqual(n.acts[0].kid, '');
  assert.deepStrictEqual(n.acts[0].days, []);
  assert.strictEqual(n.events.length, 0);
  assert.deepStrictEqual(n.packed, { '2026-11-11': ['a:x'] });
  assert.deepStrictEqual(n.people, ['Я', 'Муж']);
  const src = family(L), copy = JSON.stringify(src);
  run(L, src, 'saveKid', { name: 'Новый' });
  assert.strictEqual(JSON.stringify(src), copy);
  assert.throws(() => run(L, src, 'нетТакого'), /Неизвестное действие/);
});
