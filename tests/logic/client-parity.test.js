'use strict';
// Клиентские расчёты (public/index.html) и общий модуль Logic.calc должны давать одинаковые числа.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const det = require('../helpers/det');
const Logic = require('../../public/logic.js');
const { makePair } = require('../helpers/pair');
const { createOracle } = require('../oracle/gs-runner');
const sheets = require('../fixtures/sheets.synthetic.json');

const read = f => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
const html = read('public/index.html');            // новый клиент (границы дат)
const legacy = read('legacy/Index.html');          // прежний клиент: эталон расчётов
const betweenIn = (src, from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i); assert.ok(i >= 0 && j > i, from); return src.slice(i, j); };
const between = (from, to) => betweenIn(html, from, to);
const betweenLegacy = (from, to) => betweenIn(legacy, from, to);

/** Клиентские функции в песочнице: S подставляется снаружи. */
function clientSandbox() {
  const code = [
    "const UNITS = ['КГ','Г','Л','МЛ','ШТ']; const FACT = { 'КГ': 1000, 'Г': 1, 'Л': 1000, 'МЛ': 1, 'ШТ': 1 }; const EPS = 1e-9; const DEF_PORTIONS = 4;",
    'const r3 = x => Math.round(x * 1000) / 1000;',
    betweenLegacy('const byName =', 'const toNum'),
    betweenLegacy('function pricesOf(pid)', 'function dishCost'),
    betweenLegacy('const dishP =', 'function exportShopping'),
    'globalThis.__api = { dishP, defP, itemP, needMap, itemNeed, weekNeed, shoppingList, lastPrice, isLow };'
  ].join('\n');
  const ctx = vm.createContext({ S: null });
  vm.runInContext(code.replace(/^const D = /m, 'var D = ').replace(/\blet S\b/, 'let S_'), ctx);
  return { api: ctx.__api, setS: s => { ctx.S = s; vm.runInContext('globalThis.S = S', ctx); } };
}

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, msg + ': ' + a + ' ≠ ' + b);
function sameMaps(a, b, msg) {
  assert.deepStrictEqual(Object.keys(a).sort(), Object.keys(b).sort(), msg + ': набор ключей');
  Object.keys(a).forEach(k => near(a[k], b[k], msg + ' ' + k));
}

function states() {
  const base = createOracle(sheets).getState();
  const out = [];
  [0, 3, 6.5].forEach(portions => {
    for (const seed of [1, 2, 3]) {
      const clock = det.clock();
      const L = Logic.create({ rng: det.rng(seed), id: det.idGen(100), now: clock.now, today: clock.today });
      let st = L.apply('saveSettings', base, [String(portions || '')]);
      st = L.apply('generateWeek', st, [{ onlyAvail: false }]);
      const it = st.plan.find(i => i.kind === 'main' && !i.done && !i.left);
      if (it) { try { st = L.apply('cookItem', st, [it.id, { portions: '5' }]); } catch (e) { /* не хватило продуктов — тоже годится */ } }
      out.push(JSON.parse(JSON.stringify(st)));
    }
  });
  out.push(base);
  return out;
}

test('Logic.calc совпадает с клиентскими функциями', () => {
  const sb = clientSandbox();
  assert.ok(Logic.calc, 'Logic.calc должен существовать');
  const lastPrice = id => sb.api.lastPrice(id);
  states().forEach((S, n) => {
    sb.setS(S);
    S.dishes.forEach(d => assert.strictEqual(Logic.calc.dishP(S, d.id), sb.api.dishP(d.id), 'dishP #' + n));
    sameMaps(Logic.calc.weekNeed(S), sb.api.weekNeed(), 'weekNeed #' + n);
    S.plan.forEach(it => sameMaps(Logic.calc.itemNeed(S, it), sb.api.itemNeed(it), 'itemNeed #' + n));
    S.dishes.forEach(d => [undefined, 0, 2, 8].forEach(P => sameMaps(Logic.calc.needMap(S, d.id, '', P), sb.api.needMap(d.id, '', P), 'needMap #' + n)));
    S.products.forEach(p => assert.strictEqual(Logic.calc.isLow(p), sb.api.isLow(p)));
    const a = Logic.calc.shoppingList(S, lastPrice), b = sb.api.shoppingList();
    assert.deepStrictEqual(a.map(r => r.p.id), b.map(r => r.p.id), 'порядок списка покупок #' + n);
    a.forEach((r, i) => {
      near(r.need, b[i].need, 'need'); near(r.buy, b[i].buy, 'buy'); assert.strictEqual(r.short, b[i].short);
      if (r.cost == null) assert.strictEqual(b[i].cost, null); else near(r.cost, b[i].cost, 'cost');
    });
  });
});

test('ингредиент с несуществующим продуктом клиент не учитывает — общий модуль тоже', () => {
  const S = JSON.parse(JSON.stringify(makePair(sheets).state));
  S.ing.push({ dish: 'ds000003', product: 'призрак', qty: 5, unit: 'КГ' });
  const sb = clientSandbox(); sb.setS(S);
  sameMaps(Logic.calc.needMap(S, 'ds000003', '', undefined), sb.api.needMap('ds000003', '', undefined), 'призрак');
});

test('граница «30 дней» на экране «Цены» считается по местному времени, не по UTC', () => {
  const ctx = vm.createContext({});
  vm.runInContext(between('function dateStr(', 'function xlRow'), ctx);   // dateStr, todayStr, daysAgoStr
  // 02:00 в Алматы = 21:00 UTC предыдущих суток: через toISOString граница уехала бы на сутки
  assert.strictEqual(ctx.daysAgoStr(30, new Date('2026-11-03T02:00:00+05:00').getTime()), '2026-10-04');
  assert.strictEqual(ctx.daysAgoStr(30, new Date('2026-11-03T22:00:00+05:00').getTime()), '2026-10-04');
  assert.strictEqual(ctx.daysAgoStr(0, new Date('2026-11-03T00:30:00+05:00').getTime()), '2026-11-03');
  assert.ok(!/since\.toISOString\(\)/.test(html), 'toISOString для границы не используется');
});
