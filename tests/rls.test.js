'use strict';
// Проверка базы: защита по семье, версия, откат, приглашения. Запуск: SUPABASE_DB_URL=… node --test tests/rls.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const T = require('./helpers/db');

const skip = T.available() ? false : 'нет SUPABASE_DB_URL (строка подключения Postgres) — проверки базы пропущены';
const apply = (as, version, changes) => T.rpcJson('public.apply_changes', version + ', ' + T.json(changes), as);
const state = as => T.rpcJson('public.get_state', '', as);
const prod = (id, name, extra) => Object.assign({ id, name, unit: 'КГ', stock: 1, min: 0.5 }, extra || {});

let A, B;
before(() => { if (skip) return; T.cleanup(); A = T.createFamily('A'); B = T.createFamily('B'); });
after(() => { if (!skip) T.cleanup(); });

test('пустая семья: get_state возвращает пустые массивы, version=0 и me', { skip }, () => {
  const s = state(A.owner);
  for (const k of ['products', 'dishes', 'ing', 'plan', 'log', 'purchases']) assert.deepEqual(s[k], [], k);
  assert.equal(s.version, 0);
  assert.equal(s.me.role, 'owner');
  assert.equal(s.me.email, A.owner.email);
  assert.deepEqual(s.settings, { email: '', weekStart: '', portions: 0 });
});

test('apply_changes: данные доходят, версия растёт, чужая семья не видна', { skip }, () => {
  assert.equal(apply(A.owner, 0, { products: { upsert: [prod('p1', 'Рис')], delete: [] } }), 1);
  assert.equal(apply(B.owner, 0, { products: { upsert: [prod('p1', 'Чужой рис'), prod('p2', 'Мука')], delete: [] } }), 1);
  assert.deepEqual(state(A.owner).products.map(p => p.name), ['Рис']);
  assert.deepEqual(state(B.owner).products.map(p => p.name), ['Чужой рис', 'Мука']);
});

test('чужая семья: select возвращает 0 строк', { skip }, () => {
  const tables = ['products', 'dishes', 'dish_items', 'plan', 'purchases', 'log', 'households'];
  for (const t of tables) {
    const col = t === 'households' ? 'id' : 'household_id';
    assert.equal(T.must(`select count(*) from public.${t} where ${col} = '${B.hid}'`, { as: A.owner }), '0', t);
  }
  assert.equal(T.must('select count(*) from public.products', { as: A.owner }), '1');
  assert.equal(T.must('select count(*) from public.members', { as: A.owner }), '1');
});

test('прямой insert/update/delete в таблицы данных запрещён', { skip }, () => {
  const bad = [
    `insert into public.products (household_id, id) values ('${A.hid}', 'x')`,
    `update public.products set name = 'взлом'`,
    `delete from public.products`,
    `update public.households set version = 99`,
    `insert into public.members (household_id, user_id, role) values ('${A.hid}', '${B.owner.id}', 'owner')`,
    `insert into public.log (household_id, action) values ('${A.hid}', 'x')`
  ];
  for (const q of bad) { const r = T.sql(q, { as: A.owner }); assert.equal(r.ok, false, q); assert.match(r.err, /permission denied|row-level security/, q); }
  assert.equal(state(A.owner).products[0].name, 'Рис');
});

test('invites недоступна из браузера', { skip }, () => {
  const r = T.sql('select * from public.invites', { as: A.owner });
  assert.equal(r.ok, false);
  assert.match(r.err, /permission denied/);
});

test('apply_changes участника семьи A не меняет семью B (одинаковые ID)', { skip }, () => {
  const vB = state(B.owner).version;
  apply(A.owner, state(A.owner).version, { products: { upsert: [prod('p1', 'Рис A2')], delete: [] } });
  apply(A.owner, state(A.owner).version, { products: { upsert: [], delete: ['p2'] } });
  const b = state(B.owner);
  assert.equal(b.version, vB);
  assert.deepEqual(b.products.map(p => p.name), ['Чужой рис', 'Мука']);
});

test('неверная expected_version → version_conflict, данные не изменились', { skip }, () => {
  const before_ = state(A.owner);
  const r = T.sql('select public.apply_changes(' + (before_.version + 5) + ', ' + T.json({ products: { upsert: [prod('p9', 'Лишний')], delete: [] } }) + ')', { as: A.owner });
  assert.equal(r.ok, false);
  assert.match(r.err, /version_conflict/);
  assert.deepEqual(state(A.owner), before_);
});

test('ошибка внутри changes откатывает всё', { skip }, () => {
  const before_ = state(A.owner);
  const r = T.sql('select public.apply_changes(' + before_.version + ', ' + T.json({
    products: { upsert: [prod('ok1', 'Валидный'), { id: null, name: 'Без ID' }], delete: ['p1'] },
    log: [{ when: '2026-11-03 10:00', action: 'Тест', obj: 'x', details: '' }],
    settings: { weekStart: '2026-11-02' }
  }) + ')', { as: A.owner });
  assert.equal(r.ok, false);
  assert.deepEqual(state(A.owner), before_);
});

test('регистрация без токена / с неверным / просроченным / использованным → отказ, пользователя нет', { skip }, () => {
  const none = T.signUp(undefined); assert.equal(none.ok, false);
  const wrong = T.signUp('нет-такого-токена'); assert.equal(wrong.ok, false);
  const t = T.inviteToken(A.owner);
  T.must(`update public.invites set expires_at = now() - interval '1 minute' where token_hash = public._hash('${t}')`);
  const old = T.signUp(t); assert.equal(old.ok, false); assert.match(old.err, /использована или устарела/);
  const t2 = T.inviteToken(A.owner);
  const first = T.signUp(t2); assert.equal(first.ok, true);
  const again = T.signUp(t2); assert.equal(again.ok, false);
  for (const u of [none, wrong, old, again]) assert.equal(T.must(`select count(*) from auth.users where email = '${u.email}'`), '0', u.email);
});

test('два одновременных signUp по одной ссылке: ровно один успех', { skip }, async () => {
  const t = T.inviteToken(A.owner);
  const [a, b] = await T.raceSignUp(t);
  assert.equal([a, b].filter(x => x.ok).length, 1, JSON.stringify([a.err, b.err]));
  const members = T.must(`select count(*) from public.members where household_id = '${A.hid}' and role = 'member' and user_id in (select id from auth.users where email in ('${a.email}', '${b.email}'))`);
  assert.equal(members, '1');
});

test('участник (member) вызывает create_invite → отказ; владелец → ссылка работает, роль member', { skip }, () => {
  const m = T.joinFamily(A.owner);
  assert.equal(state(m).me.role, 'member');
  const r = T.sql('select public.create_invite()', { as: m });
  assert.equal(r.ok, false);
  assert.match(r.err, /только владелец/);
  // участник видит и меняет данные своей семьи
  assert.equal(apply(m, state(m).version, { products: { upsert: [prod('pm', 'От мужа')], delete: [] } }) > 0, true);
  assert.equal(state(A.owner).products.some(p => p.id === 'pm'), true);
  // но не чужой
  assert.equal(T.must(`select count(*) from public.products where household_id = '${B.hid}'`, { as: m }), '0');
});

test('anon не может вызвать get_state/apply_changes/create_invite/admin_new_family_invite', { skip }, () => {
  for (const q of ['select public.get_state()', "select public.apply_changes(0, '{}'::jsonb)", 'select public.create_invite()', "select public.admin_new_family_invite('x')"]) {
    const r = T.sql(q, { role: 'anon' });
    assert.equal(r.ok, false, q); assert.match(r.err, /permission denied/, q);
  }
  for (const q of ["select public.admin_new_family_invite('x')", 'select public.handle_new_user()']) {
    const r = T.sql(q, { as: A.owner });
    assert.equal(r.ok, false, q); assert.match(r.err, /permission denied/, q);
  }
  assert.equal(T.sql('select count(*) from public.products', { role: 'anon' }).ok, false);
});

test('кириллица, эмодзи, кавычки, апострофы и дробные числа доходят до get_state без изменений', { skip }, () => {
  const C = T.createFamily('C');
  const name = `Сыр «Гауда» 🧀 "острый" it's 100% \\ ; --`;
  const ch = {
    products: { upsert: [prod('c1', name, { stock: 0.1 + 0.2, min: 1 / 3, unit: 'Г' })], delete: [] },
    dishes: { upsert: [{ id: 'd1', name: 'Борщ 🍲', note: `с "перцем" и 'чесноком'`, type: 'main', meals: ['Обед', 'Ужин'], withSide: true, portions: 4, times: 2 }], delete: [] },
    ing: { upsert: [{ dish: 'd1', product: 'c1', qty: 0.25, unit: 'КГ' }], delete: [] },
    plan: { upsert: [
      { id: '35409132', day: 2, meal: 'Ужин', kind: 'main', dish: 'd1', side: '', done: false, date: '', left: false, portions: 0, from: '' },
      { id: 'pl2', day: 2, meal: 'Завтрак', kind: 'main', dish: 'd1', side: '', done: true, date: '2026-11-03 08:00', left: true, portions: 3, from: 'x' },
      { id: 'pl3', day: 1, meal: 'Ужин', kind: 'side', dish: 'd1', side: '', done: false, date: '', left: false, portions: 0, from: '' },
      { id: 'pl4', day: 2, meal: 'Ужин', kind: 'side', dish: 'd1', side: '', done: false, date: '', left: false, portions: 0, from: '' }
    ], delete: [] },
    settings: { weekStart: '2026-11-02', portions: 4, email: 'a@b.kz' },
    log: [{ when: '2026-11-03 10:00', action: 'Первое', obj: name, details: 'а' }, { when: '2026-11-03 10:01', action: 'Второе', obj: '', details: 'б' }],
    purchases: [{ when: '2026-11-03 10:00', product: 'c1', qty: 1.5, unit: 'Г', total: null, price: null }, { when: '2026-11-03 10:05', product: 'c1', qty: 2, unit: 'Г', total: 900, price: 450 }]
  };
  assert.equal(apply(C.owner, 0, ch), 1);
  const s = state(C.owner);
  assert.deepEqual(s.products, ch.products.upsert);
  assert.deepEqual(s.dishes, ch.dishes.upsert);
  assert.deepEqual(s.ing, ch.ing.upsert);
  assert.deepEqual(s.plan.map(p => p.id), ['pl3', 'pl2', '35409132', 'pl4']);   // день, приём, основное раньше доп.
  assert.deepEqual(s.settings, { email: 'a@b.kz', weekStart: '2026-11-02', portions: 4 });
  assert.deepEqual(s.log.map(l => l.action), ['Второе', 'Первое']);              // новые первыми
  assert.deepEqual(s.purchases, ch.purchases);                                   // по возрастанию, null сохраняется
  // удаление состава по паре и обнуление настроек
  apply(C.owner, 1, { ing: { upsert: [], delete: [{ dish: 'd1', product: 'c1' }] }, settings: { portions: 0, email: '' } });
  const s2 = state(C.owner);
  assert.deepEqual(s2.ing, []);
  assert.deepEqual(s2.settings, { email: '', weekStart: '2026-11-02', portions: 0 });
});

test('миграция синтетической выгрузки: get_state совпадает с ожидаемым состоянием', { skip }, () => {
  const { buildMigration, compare } = require('../tools/migration');
  const m = buildMigration(require('./fixtures/sheets.synthetic.json'));
  const C = T.createFamily('M');
  apply(C.owner, 0, m.changes);
  const s = state(C.owner);
  ['products', 'dishes', 'ing'].forEach(k => assert.deepEqual(s[k], m.state[k], k));
  assert.deepEqual(s.plan.map(p => p.id).sort(), m.state.plan.map(p => p.id).sort());
  assert.deepEqual(s.settings.weekStart, m.state.settings.weekStart);
});
