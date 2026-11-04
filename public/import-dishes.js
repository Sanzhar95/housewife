/**
 * Загрузка блюд из Excel: разбор листа (массив строк, как SheetJS sheet_to_json({header:1, raw:true, defval:''}))
 * в блюда и бланк-образец. Чистые функции, без DOM.
 *
 *   ImportDishes.HEAD                 10 заголовков бланка
 *   ImportDishes.parse(aoa, state)    → { ok, error?, dishes[], newProducts }
 *   ImportDishes.toRows(parsed)       → строки для Logic.actions.importDishes (только status 'new')
 *   ImportDishes.templateRows()       → заголовок + 3 примера
 *   ImportDishes.normUnit(u)          → 'КГ' | 'Г' | 'Л' | 'МЛ' | 'ШТ' | '?' | ''
 */
(function (root, factory) {
  const X = factory();
  if (typeof module === 'object' && module.exports) module.exports = X;
  else root.ImportDishes = X;
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

const HEAD = ['Блюдо', 'Тип', 'Приёмы пищи', 'С гарниром', 'Порций в рецепте', 'Хватает на, раз', 'Заметка', 'Продукт', 'Количество', 'Ед.'];
const NOT_OURS = 'Это не наш бланк. Скачайте бланк блюд и заполните его';
const MAX_DISHES = 500;
const MAX_LINES = 5000;
const MAX_PORTIONS = 100;   // как в logic.js
const MAX_TIMES = 7;        // как в logic.js
const MEALS = ['Завтрак', 'Обед', 'Ужин'];
const FAM = { КГ: 'w', Г: 'w', Л: 'v', МЛ: 'v', ШТ: 'c' };
const FACT = { КГ: 1000, Г: 1, Л: 1000, МЛ: 1, ШТ: 1 };

/** Единая нормализация названий: нижний регистр, ё=е, пробелы (в т.ч. неразрывные) схлопнуты, края обрезаны. */
function norm(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase().replace(/ё/g, 'е'); }
function clean(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); }
const r6 = x => Math.round(x * 1e6) / 1e6;

/**
 * Сознательная копия normUnit из public/index.html (там она глобальная и не меняется):
 * модуль должен работать и в Node-тестах. Синонимы держать одинаковыми в обоих местах.
 */
function normUnit(u) {
  const s = String(u == null ? '' : u).replace(/\s+/g, ' ').trim().toLowerCase().replace(/\.$/, '');
  if (!s) return '';
  if (['кг', 'kg', 'килограмм', 'килограммы', 'килограммов'].includes(s)) return 'КГ';
  if (['г', 'гр', 'g', 'грамм', 'граммы', 'граммов'].includes(s)) return 'Г';
  if (['л', 'l', 'литр', 'литры', 'литров'].includes(s)) return 'Л';
  if (['мл', 'ml', 'миллилитр', 'миллилитров'].includes(s)) return 'МЛ';
  if (['шт', 'pcs', 'штук', 'штуки', 'штука'].includes(s)) return 'ШТ';
  return '?';
}

/** Число из ячейки: 0,5 / 1 500 / 1 500. Пусто → null, не число → NaN. */
function parseNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN;   // даты (Excel хранит «1.5» как дату), логические и прочее — не число
  const s = String(v == null ? '' : v).replace(/\s+/g, '').replace(',', '.');
  if (s === '') return null;
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
}

function typeOf(raw) {
  const s = norm(raw);
  if (!s) return 'main';
  if (s.indexOf('основн') === 0) return 'main';
  if (s.indexOf('гарн') === 0) return 'side';
  if (s.indexOf('сал') === 0 || s.indexOf('доп') === 0) return 'extra';
  return null;
}
function mealsOf(raw) {
  const s = norm(raw);
  if (!s) return MEALS.slice();
  const found = {};
  const parts = s.split(/[,;]/).map(x => x.trim()).filter(Boolean);
  for (const p of parts) {
    const m = MEALS.find(x => x.toLowerCase() === p);
    if (!m) return null;
    found[m] = true;
  }
  const list = MEALS.filter(x => found[x]);
  return list.length ? list : MEALS.slice();
}
function boolOf(raw) {
  if (raw === true) return true;
  if (raw === false) return false;
  const s = norm(raw);
  if (s === '' || s === 'нет') return false;
  if (s === 'да') return true;
  return null;
}

const isBlank = r => !r || r.every(c => clean(c) === '');
const sameFam = (a, b) => !!FAM[a] && FAM[a] === FAM[b];
const conv = (x, from, to) => (from === to || !sameFam(from, to)) ? x : r6(x * FACT[from] / FACT[to]);

function fail(error) { return { ok: false, error, dishes: [], newProducts: 0 }; }

function parse(aoa, state) {
  const rows = Array.isArray(aoa) ? aoa : [];
  if (!rows.length || isBlank(rows[0])) return fail(rows.some(r => !isBlank(r)) ? NOT_OURS : 'Файл пустой. Скачайте бланк блюд и заполните его');
  // заголовок: ровно 10 столбцов (пустые ячейки справа не считаются)
  const h = rows[0].map(norm);
  while (h.length && h[h.length - 1] === '') h.pop();
  if (h.length !== HEAD.length || HEAD.some((x, i) => norm(x) !== h[i])) return fail(NOT_OURS);

  const body = [];   // [номер строки Excel, ячейки]
  for (let i = 1; i < rows.length; i++) if (!isBlank(rows[i])) body.push([i + 1, rows[i]]);
  if (body.length > MAX_LINES) return fail('Слишком много строк: за один раз можно загрузить не больше ' + MAX_LINES + '.');

  // группировка по блюдам (одинаковые названия объединяются, пустое название продолжает предыдущее)
  const groups = [];
  const byKey = Object.create(null);
  let cur = null;
  for (const [n, r] of body) {
    const name = clean(r[0]);
    if (name) {
      const k = norm(name);
      if (!byKey[k]) { byKey[k] = { name, first: [n, r], lines: [], orphan: false }; groups.push(byKey[k]); }
      cur = byKey[k];
    } else if (!cur) {
      // строка состава до первого блюда
      cur = { name: '(без названия)', first: [n, r], lines: [], orphan: true };
      groups.push(cur);
    }
    cur.lines.push([n, r]);
  }
  if (groups.filter(g => !g.orphan).length > MAX_DISHES) return fail('Слишком много блюд: за один раз можно загрузить не больше ' + MAX_DISHES + '.');

  const st = state || {};
  const prodByKey = Object.create(null);
  (st.products || []).forEach(p => { const k = norm(p.name); if (!prodByKey[k]) prodByKey[k] = p; });
  const dishKeys = Object.create(null);
  (st.dishes || []).forEach(d => { dishKeys[norm(d.name)] = true; });

  const fileProducts = Object.create(null);   // продукты, которые создадут уже принятые блюда файла: ключ → { name, unit }
  const newKeys = Object.create(null);
  const dishes = [];

  for (const g of groups) {
    const [n0, r0] = g.first;
    const dish = { name: g.name, type: 'main', meals: MEALS.slice(), withSide: false, portions: 0, times: 1, note: '', ing: [], status: 'new' };
    const errs = [];
    const e = (n, msg) => errs.push('строка ' + n + ': ' + msg);

    if (g.orphan) {
      e(n0, 'не указано название блюда');
    } else if (dishKeys[norm(g.name)]) {
      dish.status = 'exists';
      dishes.push(dish);
      continue;
    } else {
      const t = typeOf(r0[1]);
      if (t == null) e(n0, 'не понятен тип «' + clean(r0[1]) + '» (основное, гарнир или салат)'); else dish.type = t;
      const m = mealsOf(r0[2]);
      if (m == null) e(n0, 'не понятны приёмы пищи «' + clean(r0[2]) + '» (завтрак, обед, ужин)'); else dish.meals = m;
      const w = boolOf(r0[3]);
      if (w == null) e(n0, '«С гарниром»: напишите да или нет'); else dish.withSide = w;
      const p = parseNum(r0[4]);
      if (p !== null && (isNaN(p) || p < 0 || p > MAX_PORTIONS)) e(n0, 'порций в рецепте — число от 0 до ' + MAX_PORTIONS);
      else dish.portions = p || 0;
      const tm = parseNum(r0[5]);
      if (tm !== null && (isNaN(tm) || tm < 1 || Math.floor(tm) !== tm)) e(n0, '«Хватает на, раз» — целое число от 1');
      else dish.times = tm === null ? 1 : Math.min(tm, MAX_TIMES);
      dish.note = clean(r0[6]);
    }

    // состав
    const local = Object.create(null);   // новые продукты этого блюда: ключ → { name, unit }
    const items = [];   // { key, name, unit, qty, isNew }
    for (const [n, r] of g.lines) {
      const pn = clean(r[7]);
      const qRaw = r[8];
      const uRaw = clean(r[9]);
      const q = parseNum(qRaw);
      if (!pn) {
        if (q !== null || uRaw) e(n, 'указано количество, а продукта нет');
        continue;
      }
      if (q === null) { e(n, 'у «' + pn + '» не указано количество'); continue; }
      if (isNaN(q)) { e(n, 'у «' + pn + '» количество — не число'); continue; }
      if (!(q > 0)) { e(n, 'у «' + pn + '» количество должно быть больше 0'); continue; }
      let lu = '';
      if (uRaw) {
        lu = normUnit(uRaw);
        if (lu === '?') { e(n, 'не понятна единица «' + uRaw + '» (кг, г, л, мл, шт)'); continue; }
      }
      const key = norm(pn);
      const ex = prodByKey[key];
      let name, unit, isNew;
      if (ex) {
        name = ex.name; unit = String(ex.unit || '').toUpperCase(); isNew = false;
      } else if (local[key] || fileProducts[key]) {
        const f = local[key] || fileProducts[key];
        name = f.name; unit = f.unit; isNew = true;
      } else {
        if (!lu) { e(n, 'у нового продукта «' + pn + '» не указана единица'); continue; }
        name = pn; unit = lu; isNew = true;
        local[key] = { name, unit };
      }
      if (lu && !sameFam(lu, unit)) { e(n, '«' + name + '» считается в ' + unit + ', а в файле указано ' + lu); continue; }
      const lineUnit = lu || unit;
      if (!(conv(q, lineUnit, unit) > 0)) { e(n, 'у «' + name + '» количество слишком мало'); continue; }
      const same = items.find(x => x.key === key);
      if (same) same.qty = r6(same.qty + conv(q, lineUnit, same.unit));   // суммируем в единице первой строки
      else items.push({ key, name, unit: lineUnit, pu: unit, qty: q, isNew });
    }

    if (errs.length) {
      dish.status = 'err';
      dish.err = errs.join('; ');
    } else {
      dish.ing = items.map(x => ({ product: x.name, qty: x.qty, unit: x.unit, isNew: x.isNew }));
      Object.keys(local).forEach(k => { fileProducts[k] = local[k]; });
      items.forEach(x => { if (x.isNew) newKeys[x.key] = true; });
    }
    dishes.push(dish);
  }

  return { ok: true, dishes, newProducts: Object.keys(newKeys).length };
}

function toRows(parsed) {
  return ((parsed && parsed.dishes) || []).filter(d => d.status === 'new').map(d => ({
    name: d.name, type: d.type, meals: d.meals.slice(), withSide: !!d.withSide, portions: d.portions, times: d.times, note: d.note,
    ing: d.ing.map(i => ({ product: i.product, qty: i.qty, unit: i.unit }))
  }));
}

function templateRows() {
  return [
    HEAD.slice(),
    ['Плов с курицей', 'основное', 'обед, ужин', 'да', 6, 2, 'Пример: блюдо в несколько строк, дальше первое поле не повторяйте', 'Рис', 0.5, 'кг'],
    ['', '', '', '', '', '', '', 'Курица', 800, 'г'],
    ['', '', '', '', '', '', '', 'Морковь', 3, 'шт'],
    ['Салат из огурцов', 'салат', '', 'нет', '', '', 'Пустые ячейки — это «как обычно»: все приёмы, 1 раз', 'Огурцы', 300, 'г'],
    ['', '', '', '', '', '', '', 'Сметана', 0.1, 'кг'],
    ['Гречка отварная', 'гарнир', 'обед, ужин', '', 4, 1, '', 'Гречка', 250, 'г']
  ];
}

return { HEAD, parse, toRows, templateRows, normUnit };
});
