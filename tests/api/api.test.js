'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Auth = require('../../public/auth.js');
const DB = require('../../public/db.js');
const Logic = require('../../public/logic.js');
const ApiFactory = require('../../public/api.js');
const det = require('../helpers/det');
const { createOracle } = require('../oracle/gs-runner');
const { createFakeServer } = require('../helpers/fake-server');
const sheets = require('../fixtures/sheets.synthetic.json');

function makeApi(opt) {
  const server = createFakeServer(opt && opt.empty ? { products: [], dishes: [], ing: [], plan: [], settings: { email: '', weekStart: '', portions: 0 }, log: [], purchases: [] } : createOracle(sheets).getState());
  const clock = det.clock();
  const logic = Logic.create({ rng: det.rng(1), id: det.idGen(100), now: clock.now, today: clock.today });
  const db = DB.create({ client: server, logic });
  return { server, db, api: ApiFactory.create({ db, logic }) };
}

test('каждое имя из call()/act() в прежнем клиенте есть в API', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'legacy', 'Index.html'), 'utf8');
  const names = new Set([...html.matchAll(/\b(?:call|act)\('([A-Za-z_]+)'/g)].map(m => m[1]));
  const { api } = makeApi();
  const missing = [...names].filter(n => typeof api[n] !== 'function');
  assert.deepStrictEqual(missing, []);
  assert.ok(names.size >= 20);
});

test('getState загружает один раз, действия возвращают состояние с notice', async () => {
  const { api, server } = makeApi();
  const s = await api.getState();
  assert.strictEqual(s.products.length, 12);
  const s2 = await api.cookItem('pl000005', { portions: '4' });
  assert.match(s2.notice, /Заканчиваются/);
  assert.strictEqual(server.calls.filter(c => c.name === 'get_state').length, 1);
});

test('ошибка логики → отклонённый Promise с русским текстом', async () => {
  const { api } = makeApi();
  await api.getState();
  await assert.rejects(api.deleteProduct('нет'), /Продукт не найден/);
});

test('пустая семья: getState без ошибок, пустые списки', async () => {
  const { api } = makeApi({ empty: true });
  const s = await api.getState();
  assert.deepStrictEqual([s.products, s.dishes, s.ing, s.plan, s.log, s.purchases], [[], [], [], [], [], []]);
  const s2 = await api.saveProduct({ name: 'Рис', unit: 'КГ', stock: 1, min: 0 });
  assert.strictEqual(s2.products.length, 1);
  await assert.rejects(api.generateWeek({}), /хотя бы одно основное блюдо/);
});

test('saveSettings(portions) без e-mail', async () => {
  const { api } = makeApi();
  await api.getState();
  const s = await api.saveSettings('5');
  assert.strictEqual(s.settings.portions, 5);
  assert.strictEqual(s.settings.email, '');
});

test('exportXlsx без выгрузчика сообщает понятно', async () => {
  const { api } = makeApi();
  await assert.rejects(api.exportXlsx('x', [[1]], {}), /пока недоступна/);
});

/* ───────── Auth ───────── */

function fakeClient(over) {
  const calls = [];
  const c = {
    calls,
    auth: {
      signInWithPassword: async a => { calls.push(['signIn', a]); return over.signIn ? over.signIn(a) : { data: { session: { user: 1 } }, error: null }; },
      signUp: async a => { calls.push(['signUp', a]); return over.signUp ? over.signUp(a) : { data: { session: { user: 1 } }, error: null }; },
      signOut: async () => { calls.push(['signOut']); },
      updateUser: async a => { calls.push(['updateUser', a]); return { error: null }; },
      getSession: async () => ({ data: { session: over.session || null } })
    },
    rpc: async (n, a) => { calls.push([n, a]); return over.rpc ? over.rpc(n, a) : { data: 'tok_abcdefghijkl', error: null }; }
  };
  return c;
}

test('Auth.parseJoinHash', () => {
  assert.strictEqual(Auth.parseJoinHash('#/join/abc12345XYZ'), 'abc12345XYZ');
  assert.strictEqual(Auth.parseJoinHash('#/join/ab'), null);
  assert.strictEqual(Auth.parseJoinHash('#/other'), null);
  assert.strictEqual(Auth.parseJoinHash(''), null);
});

test('Auth.signIn: e-mail в нижний регистр и обрезка; пароль от 8 символов', async () => {
  const c = fakeClient({});
  const auth = Auth.create({ client: c });
  await auth.signIn('  Maria@Example.COM ', 'password1');
  assert.strictEqual(c.calls[0][1].email, 'maria@example.com');
  await assert.rejects(auth.signIn('a@b.c', '1234567'), /не короче 8/);
  await assert.rejects(auth.signIn('', 'password1'), /Введите почту/);
});

test('Auth: тексты ошибок по-русски', async () => {
  const bad = fakeClient({ signIn: () => ({ data: {}, error: { message: 'Invalid login credentials' } }) });
  await assert.rejects(Auth.create({ client: bad }).signIn('a@b.c', 'password1'), /^Error: Неверная почта или пароль$/);
  const net = fakeClient({ signIn: () => { throw new Error('Failed to fetch'); } });
  await assert.rejects(Auth.create({ client: net }).signIn('a@b.c', 'password1').catch(e => { throw new Error(Auth.mapError(e)); }), /Нет связи/);
  assert.strictEqual(Auth.mapError({ message: 'JWT expired', status: 401 }), 'Войдите заново');
  assert.match(Auth.mapError({ message: 'Database error saving new user' }, 'signup'), /^Ссылка не подходит/);
});

test('Auth.signUp: токен уходит в метаданные; без сессии — вход; плохая ссылка — понятный текст', async () => {
  const c = fakeClient({ signUp: () => ({ data: { session: null }, error: null }) });
  const auth = Auth.create({ client: c });
  await auth.signUp('A@b.c', 'password1', 'tok12345');
  assert.deepStrictEqual(c.calls[0][1].options.data, { invite: 'tok12345' });
  assert.strictEqual(c.calls[1][0], 'signIn');
  const bad = fakeClient({ signUp: () => ({ data: {}, error: { message: 'Database error saving new user' } }) });
  await assert.rejects(Auth.create({ client: bad }).signUp('a@b.c', 'password1', 'tok12345'), /Ссылка не подходит/);
  await assert.rejects(auth.signUp('a@b.c', 'password1', ''), /Ссылка не подходит/);
});

test('Auth.inviteLink, changePassword, getSession', async () => {
  const c = fakeClient({ session: { user: 7 } });
  const auth = Auth.create({ client: c, origin: 'https://moya-kuhnya.netlify.app' });
  assert.strictEqual(await auth.inviteLink(), 'https://moya-kuhnya.netlify.app/#/join/tok_abcdefghijkl');
  await auth.changePassword('newpassword');
  assert.deepStrictEqual(c.calls[1], ['updateUser', { password: 'newpassword' }]);
  await assert.rejects(auth.changePassword('short'), /не короче 8/);
  assert.deepStrictEqual(await auth.getSession(), { user: 7 });
  const member = fakeClient({ rpc: () => ({ data: null, error: { message: 'Только владелец семьи может приглашать' } }) });
  await assert.rejects(Auth.create({ client: member }).inviteLink(), /Только владелец/);
});
