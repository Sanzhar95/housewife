'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { buildMigration, compare, fixIds } = require('../tools/migration');
const sheets = require('./fixtures/sheets.synthetic.json');
const clone = x => JSON.parse(JSON.stringify(x));

test('синтетика: числовой ID плана остаётся строкой, «хвост» прихода сохранён и попал в отчёт', () => {
  const m = buildMigration(sheets);
  assert.ok(m.changes.plan.upsert.some(i => i.id === '35409132'));
  assert.strictEqual(m.changes.purchases.length, 3);
  assert.deepStrictEqual(m.report.orphanPurchases, ['zzzzzzzz']);
  assert.strictEqual(m.changes.log.length, 2);
  assert.strictEqual(m.changes.settings.weekStart, '2026-11-02');
  assert.strictEqual(m.expected.counts.dish_items, 18);
});

test('нецелый ID-число заменяется новым, ссылки обновляются', () => {
  const s = clone(sheets);
  s['План'][1][0] = 1.2345e+30;                       // pl000001 стал «научной записью»
  s['План'][2][10] = 1.2345e+30;                      // «Остатки от» ссылается на него
  const r = fixIds(s, () => 'mfix0001');
  assert.strictEqual(r.sheets['План'][1][0], 'mfix0001');
  assert.strictEqual(r.sheets['План'][2][10], 'mfix0001');
  assert.deepStrictEqual(r.remapped, { '1.2345e+30': 'mfix0001' });
  const m = buildMigration(s);
  assert.ok(m.changes.plan.upsert.some(i => i.from === m.changes.plan.upsert.find(x => x.day === 1).id));
});

test('пустые «Рецепт на, порций» / «Хватает на, раз» → значения по умолчанию', () => {
  const m = buildMigration(sheets);
  const plov = m.changes.dishes.upsert.find(d => d.id === 'ds000001');
  assert.strictEqual(plov.portions, 0);               // 0 = по умолчанию 4
  assert.strictEqual(m.changes.dishes.upsert.find(d => d.id === 'ds000002').times, 1);
});

test('compare: совпадение и расхождения', () => {
  const m = buildMigration(sheets);
  const actual = { counts: m.expected.counts, products: m.state.products, plan: m.state.plan, weekStart: m.expected.weekStart };
  assert.ok(compare(m.expected, actual).every(c => c.ok));
  const broken = clone(actual); broken.products[0].stock += 1; broken.counts.log = 5; broken.plan.forEach(i => { i.left = false; });
  const bad = compare(m.expected, broken).filter(c => !c.ok).map(c => c.name);
  assert.ok(bad.includes('остатки продуктов') && bad.includes('строк: log') && bad.includes('«вчерашних» в меню'));
});

const file = process.env.DK_SHEETS_JSON;
test('реальная выгрузка: 46/34/152/15/251/55, 6 ≤ минимума (5 на нуле), 2 «вчерашних», weekStart', { skip: !file }, () => {
  const m = buildMigration(JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.deepStrictEqual(m.expected.counts, { products: 46, dishes: 34, dish_items: 152, plan: 15, log: 251, purchases: 55 });
  assert.strictEqual(m.expected.low, 6);
  assert.strictEqual(m.expected.zero, 5);
  assert.strictEqual(m.expected.left, 2);
  assert.strictEqual(m.expected.weekStart, '2026-11-02');
  assert.deepStrictEqual(m.report.orphanPurchases, ['1447c4ad']);
  assert.ok(m.changes.plan.upsert.some(i => i.id === '35409132'));
  assert.ok(m.changes.dishes.upsert.every(d => d.portions === 0 && d.times === 1 || d.type !== 'main' || d.times >= 1));
});

test('клиент fetch: вход по паролю, rpc, подсчёт строк по Content-Range', async () => {
  const http = require('node:http');
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push({ m: req.method, u: req.url, h: req.headers, b: body });
      if (req.url.startsWith('/auth/v1/token')) return res.end(JSON.stringify({ access_token: 'T0K' }));
      if (req.url.startsWith('/rest/v1/rpc/apply_changes')) return res.end('7');
      if (req.method === 'HEAD') { res.setHeader('content-range', '0-0/251'); return res.end(); }
      res.statusCode = 400; res.end(JSON.stringify({ message: 'version_conflict' }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const api = require('../tools/supabase-http').create('http://127.0.0.1:' + srv.address().port, 'ANON');
  await api.login('a@b.c', 'pw');
  assert.strictEqual(await api.rpc('apply_changes', { expected_version: 0, changes: {} }), 7);
  assert.strictEqual(await api.count('log'), 251);
  await assert.rejects(api.rpc('get_state', {}), /version_conflict/);
  srv.close();
  assert.strictEqual(seen[0].h.apikey, 'ANON');
  assert.strictEqual(seen[1].h.authorization, 'Bearer T0K');
  assert.strictEqual(seen[2].h.prefer, 'count=exact');
});
