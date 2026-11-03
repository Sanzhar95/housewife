'use strict';
// Чистая часть переноса из Google Таблицы (xlsx → JSON листов) в формат apply_changes и сверка с базой.
const path = require('node:path');
const det = require('../tests/helpers/det');
const { createOracle } = require('../tests/oracle/gs-runner');

const UNITS = ['КГ', 'Г', 'Л', 'МЛ', 'ШТ'];
const sid = v => (typeof v === 'number' && Number.isInteger(v) ? String(v) : String(v));
const isBadNumId = v => typeof v === 'number' && !Number.isSafeInteger(v);

/** ID, которые Google превратил в число: целые → строка; нецелые («1.2e+30») → новый ID с заменой ссылок. */
function fixIds(sheets, newId) {
  const out = JSON.parse(JSON.stringify(sheets));
  const map = {};
  const idCols = { 'Продукты': [0], 'Блюда': [0], 'План': [0] };
  Object.keys(idCols).forEach(name => (out[name] || []).slice(1).forEach(r => {
    idCols[name].forEach(c => { if (isBadNumId(r[c])) { const n = newId(); map[sid(r[c])] = n; r[c] = n; } });
  }));
  const refCols = { 'Состав': [0, 1], 'План': [4, 5, 10], 'Приходы': [1] };
  Object.keys(refCols).forEach(name => (out[name] || []).slice(1).forEach(r => {
    refCols[name].forEach(c => { if (typeof r[c] === 'number' && map[sid(r[c])]) r[c] = map[sid(r[c])]; });
  }));
  return { sheets: out, remapped: map };
}

const when = v => (v == null ? '' : String(v));

/**
 * sheets — JSON из tools/xlsx-to-sheets.py. Возвращает { changes, expected, report }.
 * Состояние продуктов/блюд/состава/плана строим тем же кодом Code.gs, что читал таблицу (load_), поэтому нормализация идентична;
 * журнал и приходы берём целиком (в state_ их только последние 100 / 3000).
 */
function buildMigration(sheets) {
  const gen = det.idGen(1);
  const newId = () => { const x = gen(); return 'm' + x.slice(1); };         // m + 7 символов: не пересекается с обычными ID
  const fixed = fixIds(sheets, newId);
  const st = createOracle(fixed.sheets).getState();

  const rows = n => (fixed.sheets[n] || []).slice(1).filter(r => r.some(v => v !== '' && v != null));
  const productIds = new Set(st.products.map(p => p.id));
  const pu = {}; st.products.forEach(p => { pu[p.id] = p.unit; });

  const log = rows('Журнал').map(r => ({ when: when(r[0]), action: when(r[1]), obj: when(r[2]), details: when(r[3]) }));
  const purchases = rows('Приходы').map(r => ({
    when: when(r[0]), product: String(r[1]), qty: Number(r[2]) || 0,
    unit: UNITS.indexOf(String(r[3])) >= 0 ? String(r[3]) : (pu[String(r[1])] || 'ШТ'),
    total: r[4] === '' || r[4] == null ? null : Number(r[4]),
    price: r[5] === '' || r[5] == null ? null : Number(r[5])
  }));
  const orphans = purchases.filter(p => !productIds.has(p.product));

  const settings = {};
  if (st.settings.weekStart) settings.weekStart = st.settings.weekStart;
  if (st.settings.portions > 0) settings.portions = st.settings.portions;
  if (st.settings.email) settings.email = st.settings.email;

  const changes = {
    products: { upsert: st.products, delete: [] }, dishes: { upsert: st.dishes, delete: [] },
    ing: { upsert: st.ing, delete: [] }, plan: { upsert: st.plan, delete: [] },
    settings, log, purchases
  };
  const expected = {
    counts: { products: st.products.length, dishes: st.dishes.length, dish_items: st.ing.length, plan: st.plan.length, log: log.length, purchases: purchases.length },
    stock: Object.fromEntries(st.products.map(p => [p.id, p.stock])),
    low: st.products.filter(p => p.stock <= p.min).length,
    zero: st.products.filter(p => p.stock === 0).length,
    left: st.plan.filter(i => i.left).length,
    weekStart: st.settings.weekStart
  };
  const report = { remapped: fixed.remapped, orphanPurchases: orphans.map(o => o.product).filter((v, i, a) => a.indexOf(v) === i), counts: expected.counts };
  return { changes, expected, report, state: st };
}

/** actual = { counts:{...}, products:[{id,stock,min}], plan:[{left}], weekStart } → список проверок. */
function compare(expected, actual) {
  const out = [];
  const check = (name, ok, details) => out.push({ name, ok: !!ok, details: details || '' });
  Object.keys(expected.counts).forEach(k => check('строк: ' + k, actual.counts[k] === expected.counts[k], actual.counts[k] + ' из ' + expected.counts[k]));
  const am = Object.fromEntries((actual.products || []).map(p => [p.id, p.stock]));
  const bad = Object.keys(expected.stock).filter(id => am[id] === undefined || Math.abs(am[id] - expected.stock[id]) > 1e-9);
  check('остатки продуктов', bad.length === 0, bad.length ? 'расходятся: ' + bad.join(', ') : Object.keys(expected.stock).length + ' продуктов');
  const low = (actual.products || []).filter(p => p.stock <= p.min).length, zero = (actual.products || []).filter(p => p.stock === 0).length;
  check('продуктов «ниже или равно минимуму»', low === expected.low, low + ' из ' + expected.low);
  check('из них на нуле', zero === expected.zero, zero + ' из ' + expected.zero);
  const left = (actual.plan || []).filter(i => i.left).length;
  check('«вчерашних» в меню', left === expected.left, left + ' из ' + expected.left);
  check('начало недели', actual.weekStart === expected.weekStart, actual.weekStart + ' из ' + expected.weekStart);
  return out;
}

module.exports = { buildMigration, compare, fixIds };
