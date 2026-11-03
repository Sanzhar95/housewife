'use strict';
const test = require('node:test');
const assert = require('node:assert');
const DB = require('../../public/db.js');
const Logic = require('../../public/logic.js');
const det = require('../helpers/det');
const { createOracle } = require('../oracle/gs-runner');
const { createFakeServer, canon } = require('../helpers/fake-server');
const sheets = require('../fixtures/sheets.synthetic.json');

const clone = x => JSON.parse(JSON.stringify(x));
function setup(opts) {
  opts = opts || {};
  const s = createOracle(opts.sheets || sheets).getState();
  const server = createFakeServer(s);
  const clock = det.clock();
  const logic = Logic.create({ rng: det.rng(opts.seed || 1), id: det.idGen(opts.startId || 100), now: clock.now, today: clock.today });
  const db = DB.create({ client: server, logic, optimistic: () => opts.optimistic !== false });
  const saving = []; db.onSaving(n => saving.push(n));
  const errors = []; db.onError(m => errors.push(m));
  const views = []; db.onView(v => views.push(v));
  return { server, db, logic, saving, errors, views };
}
const applies = srv => srv.calls.filter(c => c.name === 'apply_changes');
const rich = () => { const s = clone(sheets); s['Продукты'].slice(1).forEach(r => { r[3] = (r[2] === 'Г' || r[2] === 'МЛ') ? 5000 : 50; }); return s; };

test('оптимистично: экран обновляется сразу, запись идёт позже; итог совпадает с базой', async () => {
  const t = setup(); await t.db.load();
  const r = t.db.run('cookItem', ['pl000005', {}]);
  assert.strictEqual(r.optimistic.plan.find(i => i.id === 'pl000005').done, true);   // сразу
  assert.strictEqual(t.server.state().version, 0);                                    // база ещё не изменилась
  const after = await r.done;
  assert.strictEqual(applies(t.server).length, 1);
  assert.deepStrictEqual(canon(after), canon(t.server.state()));
  assert.deepStrictEqual(t.saving, [1, 0]);
});

test('двойной тап «Готовить» до ответа сервера: две записи по порядку, списание не задваивается', async () => {
  const t = setup({ sheets: rich() }); await t.db.load();
  const before = t.server.state().products.find(p => p.id === 'pr000005').stock;
  const a = t.db.run('cookItem', ['pl000005', {}]);
  assert.throws(() => t.db.run('cookItem', ['pl000005', {}]), /уже отмечено/);          // тот же тап повторно — отказ сразу
  const b = t.db.run('cookItem', ['35409132', {}]);                                       // другое блюдо в очереди следом
  await Promise.all([a.done, b.done]);
  assert.strictEqual(applies(t.server).length, 2);
  const st = t.server.state();
  assert.strictEqual(st.products.find(p => p.id === 'pr000005').stock, before - 4);       // яйца списаны один раз
  assert.deepStrictEqual(canon(t.db.getView()), canon(st));
  assert.strictEqual(st.version, 2);
  assert.deepStrictEqual(t.saving, [1, 2, 1, 0]);
});

test('журнал и приходы записываются один раз каждое действие', async () => {
  const t = setup(); await t.db.load();
  const n0 = t.server.log.length, p0 = t.server.purchases.length;
  const a = t.db.run('adjustStock', ['pr000001', 1, 700]);
  const b = t.db.run('adjustStock', ['pr000001', 2, 900]);
  await Promise.all([a.done, b.done]);
  assert.strictEqual(t.server.log.length, n0 + 2);
  assert.strictEqual(t.server.purchases.length, p0 + 2);
  assert.deepStrictEqual(t.server.purchases.slice(-2).map(p => p.qty), [1, 2]);
});

test('конфликт версий: действие повторяется на свежих данных', async () => {
  const t = setup({ sheets: rich() }); await t.db.load();
  t.server.external({ products: { upsert: [Object.assign({}, t.server.state().products[0], { stock: 77 })], delete: [] } });   // «второй телефон»
  const r = t.db.run('cookItem', ['pl000005', {}]);
  await r.done;
  const st = t.server.state();
  assert.strictEqual(st.version, 2);
  assert.strictEqual(st.products[0].stock, 77);                                           // чужое изменение не потеряно
  assert.strictEqual(st.plan.find(i => i.id === 'pl000005').done, true);
  assert.strictEqual(applies(t.server).length, 2);                                        // первая попытка отклонена, вторая принята
  assert.deepStrictEqual(canon(t.db.getView()), canon(st));
});

test('конфликт, повтор невозможен (чужой телефон потратил продукты): отказ, откат, без записи', async () => {
  const t = setup(); await t.db.load();
  const eggs = t.server.state().products.find(p => p.id === 'pr000005');
  t.server.external({ products: { upsert: [Object.assign({}, eggs, { stock: 0 })], delete: [] } });
  const r = t.db.run('cookItem', ['pl000005', {}]);
  await assert.rejects(r.done, /Не хватает продуктов/);
  const st = t.server.state();
  assert.strictEqual(st.plan.find(i => i.id === 'pl000005').done, false);
  assert.deepStrictEqual(canon(t.db.getView()), canon(st));
  assert.ok(t.errors[0].startsWith('Не хватает продуктов'));
  assert.ok(t.views.length >= 1);
  assert.strictEqual(t.saving[t.saving.length - 1], 0);
});

test('сеть оборвалась: понятный текст, очередь пуста, показаны свежие данные', async () => {
  const t = setup(); await t.db.load();
  t.server.failNext({ message: 'Failed to fetch' });                                      // сорвётся apply_changes
  const r = t.db.run('cookItem', ['pl000005', {}]);
  await assert.rejects(r.done, /Нет связи/);
  assert.strictEqual(t.db.getView().plan.find(i => i.id === 'pl000005').done, false);
  assert.strictEqual(t.db.isIdle(), true);
  assert.strictEqual(t.saving[t.saving.length - 1], 0);
});

test('сеть пропала совсем (и повторная загрузка тоже): остаётся последнее подтверждённое', async () => {
  const t = setup(); await t.db.load();
  t.server.failNext({ message: 'Failed to fetch' }); t.server.failNext({ message: 'Failed to fetch' });
  const r = t.db.run('cookItem', ['pl000005', {}]);
  await assert.rejects(r.done, /Нет связи/);
  assert.strictEqual(t.db.getView().plan.find(i => i.id === 'pl000005').done, false);
});

test('сессия истекла: «Войдите заново»; два действия в очереди отклоняются оба', async () => {
  const t = setup(); await t.db.load();
  t.server.failNext({ message: 'JWT expired', status: 401 });
  const a = t.db.run('cookItem', ['pl000005', {}]);
  const b = t.db.run('adjustStock', ['pr000001', 1]);
  await assert.rejects(a.done, /Войдите заново/);
  await assert.rejects(b.done, /Войдите заново/);
  assert.strictEqual(t.server.state().version, 0);                                        // ничего не записалось
  assert.strictEqual(t.db.isIdle(), true);
});

test('OPTIMISTIC=false: optimistic = null, done разрешается после записи', async () => {
  const t = setup({ optimistic: false }); await t.db.load();
  const r = t.db.run('cookItem', ['pl000005', {}]);
  assert.strictEqual(r.optimistic, null);
  const st = await r.done;
  assert.strictEqual(st.plan.find(i => i.id === 'pl000005').done, true);
  assert.strictEqual(t.server.state().version, 1);
});

test('действие без изменений в базе не вызывает запись', async () => {
  const t = setup(); await t.db.load();
  await t.db.run('getState', []).done;
  assert.strictEqual(applies(t.server).length, 0);
});

test('кириллица, эмодзи, кавычки: туда и обратно через запись и загрузку', async () => {
  const t = setup(); await t.db.load();
  const name = 'Мёд "липовый" 🍯 д\'Артаньян';
  await t.db.run('saveProduct', [{ name, unit: 'Г', stock: '250,5', min: 0 }]).done;
  const fresh = await t.db.load();
  assert.ok(fresh.products.some(p => p.name === name && p.stock === 250.5));
});

test('ошибка логики приходит сразу, очередь не затронута', async () => {
  const t = setup(); await t.db.load();
  assert.throws(() => t.db.run('deleteProduct', ['нет']), /Продукт не найден/);
  assert.strictEqual(t.saving.length, 0);
});

test('refresh: пока идёт запись данные не перезаписываются', async () => {
  const t = setup(); await t.db.load();
  const r = t.db.run('cookItem', ['pl000005', {}]);
  assert.strictEqual(await t.db.refresh(), null);
  await r.done;
  assert.ok(await t.db.refresh());
});

test('длинная серия действий: сервер и экран совпадают', async () => {
  const t = setup({ sheets: rich(), seed: 3 }); await t.db.load();
  const runs = [
    t.db.run('generateWeek', [{ onlyAvail: true }]),
    t.db.run('saveSettings', ['3']),
    t.db.run('saveProduct', [{ name: 'Сахар', unit: 'КГ', stock: 1, min: 0, total: 500 }]),
  ];
  const plan = t.db.getView().plan.find(i => i.kind === 'main' && !i.done);
  runs.push(t.db.run('cookItem', [plan.id, { portions: '2' }]));
  runs.push(t.db.run('undoItem', [plan.id]));
  runs.push(t.db.run('deleteDish', ['ds000008']));
  await Promise.all(runs.map(r => r.done));
  const st = t.server.state();
  assert.deepStrictEqual(canon(t.db.getView()), canon(st));
  assert.strictEqual(st.version, runs.length);
  const fresh = await t.db.load();
  assert.deepStrictEqual(canon(fresh), canon(st));
});
