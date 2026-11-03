/**
 * Домашняя кухня — Google Apps Script (привязан к Google Таблице).
 * Листы: Продукты, Блюда, Состав, План, Журнал, Настройки, Приходы (+ Матрица по кнопке в меню).
 * План: каждая строка — блюдо в конкретный день и приём пищи (завтрак/обед/ужин), с гарниром и отметкой «приготовлено».
 * «Вчерашнее» = доедаем приготовленное раньше: такие строки склад не списывают и не возвращают.
 * Порции: рецепт блюда рассчитан на N порций (по умолчанию 4), при готовке можно выбрать другое число — состав и списание пересчитываются.
 * «Хватает на N раз»: после готовки блюда остатки сами встают в меню следующих дней как «вчерашнее».
 *
 * Единицы: КГ и Г (вес), Л и МЛ (объём), ШТ.
 * Остаток и минимум продукта хранятся в его единице (столбец «Ед.» на листе «Продукты»).
 * В «Составе» количество хранится в единице продукта, а «Ед. в рецепте» — как его удобно показывать.
 * В «Приходах» каждая строка хранит свою единицу, поэтому история не ломается при смене единицы продукта.
 */

const SHEETS = {
  products: { name: 'Продукты',  headers: ['ID', 'Название', 'Ед.', 'Остаток', 'Мин. остаток'] },
  dishes:   { name: 'Блюда',     headers: ['ID', 'Название', 'Заметка', 'Тип', 'Приёмы пищи', 'С гарниром', 'Рецепт на, порций', 'Хватает на, раз'] },
  ing:      { name: 'Состав',    headers: ['ID блюда', 'ID продукта', 'Количество (в ед. продукта)', 'Ед. в рецепте'] },
  plan:     { name: 'План',      headers: ['ID', 'День', 'Приём', 'Вид', 'ID блюда', 'ID гарнира', 'Приготовлено', 'Когда', 'Вчерашнее', 'Порций', 'Остатки от'] },
  log:      { name: 'Журнал',    headers: ['Когда', 'Действие', 'Объект', 'Детали'] },
  settings: { name: 'Настройки', headers: ['Ключ', 'Значение'] },
  purchases:{ name: 'Приходы',   headers: ['Когда', 'ID продукта', 'Количество', 'Ед.', 'Сумма, ₸', 'Цена за ед., ₸'] }
};
const UNITS = ['КГ', 'Г', 'Л', 'МЛ', 'ШТ'];
const FACT = { 'КГ': 1000, 'Г': 1, 'Л': 1000, 'МЛ': 1, 'ШТ': 1 };
const FAM = { 'КГ': 'вес', 'Г': 'вес', 'Л': 'объём', 'МЛ': 'объём', 'ШТ': 'штуки' };
const EPS = 1e-9;
const MEALS = ['Завтрак', 'Обед', 'Ужин'];
const TYPES = { main: 'Основное', side: 'Гарнир', extra: 'Салат/доп' };
const DEF_PORTIONS = 4;   // если у блюда не указано, на сколько порций рецепт
const MAX_PORTIONS = 100;
const MAX_TIMES = 7;      // «хватает на» — не больше недели

function timesOf_(v) {
  const n = Math.round(Number(v));
  return n >= 1 ? Math.min(n, MAX_TIMES) : 1;
}

function typeKey_(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s.indexOf('гарн') === 0) return 'side';
  if (s.indexOf('сал') === 0 || s.indexOf('доп') === 0) return 'extra';
  return 'main';
}
function mealsOf_(v) {
  const s = String(v || '').toLowerCase();
  const list = MEALS.filter(x => s.indexOf(x.toLowerCase()) >= 0);
  return list.length ? list : MEALS.slice();
}

/* ───────────── Единицы ───────────── */

function sameFam_(a, b) { return !!FAM[a] && FAM[a] === FAM[b]; }
function conv_(x, from, to) {
  if (!from || !to || from === to || !sameFam_(from, to)) return x;
  return r6_(x * FACT[from] / FACT[to]);
}
/** Красивая запись: 0,25 КГ → «250 Г», 1500 МЛ → «1,5 Л». */
function fmtQ_(x, u) {
  let v = x, unit = u;
  if (u === 'КГ' && x > 0 && x < 1) { v = x * 1000; unit = 'Г'; }
  else if (u === 'Г' && x >= 1000) { v = x / 1000; unit = 'КГ'; }
  else if (u === 'Л' && x > 0 && x < 1) { v = x * 1000; unit = 'МЛ'; }
  else if (u === 'МЛ' && x >= 1000) { v = x / 1000; unit = 'Л'; }
  return String(r3_(v)).replace('.', ',') + ' ' + unit.toLowerCase();
}

/* ───────────── Меню и веб-приложение ───────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Склад и меню')
    .addItem('1. Настроить таблицу', 'setupMenu')
    .addItem('2. Указать e-mail для уведомлений', 'askEmail')
    .addItem('3. Включить ежедневную проверку остатков', 'installDailyTrigger')
    .addSeparator()
    .addItem('Обновить лист «Матрица»', 'renderMatrixSheet')
    .addToUi();
}

function doGet() {
  setup_();
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Домашняя кухня')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function setupMenu() {
  setup_();
  SpreadsheetApp.getUi().alert('Готово: листы созданы и обновлены. Теперь разверните веб-приложение (Развертывание → Новое развертывание → Веб-приложение).');
}

function askEmail() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('E-mail для уведомлений', 'Куда писать, когда продукты заканчиваются:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const email = r.getResponseText().trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) { ui.alert('Похоже, адрес введён неверно.'); return; }
  setup_();
  setSetting_('email', email);
}

function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'checkLowStock') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkLowStock').timeBased().everyDays(1).atHour(9).create();
  SpreadsheetApp.getUi().alert('Каждый день около 9:00 скрипт проверит остатки и пришлёт письмо, если что-то заканчивается.');
}

/* ───────────── Таблица и чтение/запись ───────────── */

function ss_() {
  let s = null;
  try { s = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (!s) {
    const id = PropertiesService.getScriptProperties().getProperty('SS_ID');
    if (!id) throw new Error('Не найдена таблица. Откройте таблицу и выберите меню «Склад и меню → Настроить таблицу».');
    s = SpreadsheetApp.openById(id);
  }
  return s;
}

function tz_() { return ss_().getSpreadsheetTimeZone(); }
function now_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'); }
function id_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 8); }
function r3_(x) { return Math.round(x * 1000) / 1000; }
function r6_(x) { return Math.round(x * 1e6) / 1e6; }

function str_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm');
  return v == null ? '' : String(v);
}

function num_(v) {
  if (v === '' || v == null) return 0;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!isFinite(n) || n < 0) throw new Error('Числа должны быть неотрицательными.');
  return r6_(n);
}

function unit_(u) {
  const s = String(u || '').trim().toUpperCase();
  if (UNITS.indexOf(s) < 0) throw new Error('Единица измерения: КГ, Г, Л, МЛ или ШТ.');
  return s;
}

function setup_() {
  const ss = ss_();
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
  migrateWeek_(ss);
  Object.keys(SHEETS).forEach(k => {
    const h = SHEETS[k].headers;
    let sh = ss.getSheetByName(SHEETS[k].name);
    if (!sh) {
      sh = ss.insertSheet(SHEETS[k].name);
      sh.setFrozenRows(1);
    } else if (k === 'purchases') {
      migratePurchases_(sh);
    }
    const cur = sh.getRange(1, 1, 1, h.length).getValues()[0];
    if (cur.join('|') !== h.join('|')) {
      sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#ece8fc');
    }
  });
  const st = ss.getSheetByName(SHEETS.settings.name);
  st.getRange('B2:B10').setNumberFormat('@');
  if (st.getLastRow() < 3) st.getRange(2, 1, 2, 2).setValues([['email', ''], ['weekStart', '']]);
}

/**
 * Переход с листа «Неделя» (одно блюдо в день) на «План» (завтрак/обед/ужин).
 * Старые записи переносятся как ужины, а сам лист сохраняется как «Неделя (архив)».
 */
function migrateWeek_(ss) {
  if (ss.getSheetByName(SHEETS.plan.name)) return;
  const old = ss.getSheetByName('Неделя');
  const h = SHEETS.plan.headers;
  const sh = ss.insertSheet(SHEETS.plan.name);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold').setBackground('#ece8fc');
  if (!old) return;
  const n = old.getLastRow();
  const rows = [];
  if (n > 1) {
    old.getRange(2, 1, n - 1, 4).getValues().forEach(r => {
      if (!r[1]) return;
      rows.push([id_(), Number(r[0]) || 1, 'Ужин', 'основное', String(r[1]), '', r[2] === true || r[2] === 'TRUE', str_(r[3]), false]);
    });
  }
  if (rows.length) sh.getRange(2, 1, rows.length, h.length).setValues(rows);
  old.setName('Неделя (архив)');
}

/** Старый лист «Приходы» (без столбца «Ед.») — вставляем столбец и заполняем единицей продукта. */
function migratePurchases_(sh) {
  if (sh.getLastColumn() < 4 || String(sh.getRange(1, 4).getValue()) !== 'Сумма, ₸') return;
  sh.insertColumnAfter(3);
  const n = sh.getLastRow();
  if (n > 1) {
    const units = {};
    read_('products').forEach(r => { units[String(r[0])] = String(r[2]); });
    const ids = sh.getRange(2, 2, n - 1, 1).getValues();
    sh.getRange(2, 4, n - 1, 1).setValues(ids.map(r => [units[String(r[0])] || 'ШТ']));
  }
}

function sheet_(key) { return ss_().getSheetByName(SHEETS[key].name); }

function read_(key) {
  const sh = sheet_(key);
  const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, SHEETS[key].headers.length).getValues();
}

function write_(key, rows) {
  const sh = sheet_(key);
  const w = SHEETS[key].headers.length;
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, w).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, w).setValues(rows);
}

function money_(v) {
  if (v === '' || v == null) return '';
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!isFinite(n) || n < 0) throw new Error('Сумма должна быть неотрицательным числом.');
  return Math.round(n * 100) / 100;
}

/** rows: [[productId, qty, unit, total|'']] — приход в той единице, в которой его ввели. */
function addPurchases_(rows) {
  if (!rows.length) return;
  const when = now_();
  const data = rows.map(r => {
    const qty = r[1], total = r[3];
    const unitPrice = total !== '' && qty > 0 ? Math.round(total / qty * 10000) / 10000 : '';
    return [when, r[0], qty, r[2], total, unitPrice];
  });
  const sh = sheet_('purchases');
  sh.getRange(sh.getLastRow() + 1, 1, data.length, 6).setValues(data);
}

function log_(action, obj, details) {
  sheet_('log').appendRow([now_(), action, obj || '', details || '']);
}

function getSettings_() {
  const o = {};
  read_('settings').forEach(r => { o[str_(r[0])] = str_(r[1]); });
  const portions = Number(String(o.portions || '').replace(',', '.'));
  return { email: o.email || '', weekStart: o.weekStart || '', portions: portions > 0 ? portions : 0 };
}

function setSetting_(key, val) {
  const sh = sheet_('settings');
  const n = sh.getLastRow();
  const keys = n > 1 ? sh.getRange(2, 1, n - 1, 1).getValues().map(r => r[0]) : [];
  const i = keys.indexOf(key);
  if (i >= 0) sh.getRange(i + 2, 2).setNumberFormat('@').setValue(val);
  else sh.appendRow([key, val]);
}

function tx_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ───────────── Модель ───────────── */

function load_() {
  const products = read_('products').map(r => ({
    id: String(r[0]), name: String(r[1]), unit: UNITS.indexOf(String(r[2])) >= 0 ? String(r[2]) : 'ШТ',
    stock: Number(r[3]) || 0, min: Number(r[4]) || 0
  }));
  const pu = {};
  products.forEach(p => { pu[p.id] = p.unit; });
  const dishes = read_('dishes').map(r => {
    const type = typeKey_(r[3]);
    return {
      id: String(r[0]), name: String(r[1]), note: String(r[2] || ''), type,
      meals: mealsOf_(r[4]), withSide: type === 'main' && (r[5] === true || r[5] === 'TRUE'),
      portions: Number(r[6]) > 0 ? Math.min(MAX_PORTIONS, r3_(Number(r[6]))) : 0,   // 0 = не указано (считаем как DEF_PORTIONS)
      times: type === 'main' ? timesOf_(r[7]) : 1
    };
  });
  const ing = read_('ing').map(r => {
    const product = String(r[1]);
    const lu = String(r[3] || '');
    return { dish: String(r[0]), product, qty: Number(r[2]) || 0, unit: sameFam_(lu, pu[product]) ? lu : (pu[product] || 'ШТ') };
  });
  const plan = read_('plan').filter(r => r[0]).map(r => ({
    id: String(r[0]), day: Number(r[1]) || 1, meal: MEALS.indexOf(String(r[2])) >= 0 ? String(r[2]) : 'Ужин',
    kind: String(r[3]).toLowerCase().indexOf('доп') === 0 ? 'extra' : 'main',
    dish: String(r[4] || ''), side: String(r[5] || ''),
    done: r[6] === true || r[6] === 'TRUE', date: str_(r[7]),
    left: r[8] === true || r[8] === 'TRUE',
    portions: Number(r[9]) > 0 ? Number(r[9]) : 0,
    from: String(r[10] || '')
  }));
  return { products, dishes, ing, plan, settings: getSettings_() };
}

function saveProducts_(a) { write_('products', a.map(p => [p.id, p.name, p.unit, p.stock, p.min])); }
function saveDishes_(a)   { write_('dishes', a.map(d => [d.id, d.name, d.note, TYPES[d.type] || TYPES.main, (d.meals || MEALS).join(', '), !!d.withSide, d.portions > 0 ? d.portions : '', d.times > 1 ? d.times : 1])); }
function saveIng_(a)      { write_('ing', a.map(i => [i.dish, i.product, i.qty, i.unit])); }
function savePlan_(a) {
  const sorted = a.slice().sort((x, y) => (x.day - y.day) || (MEALS.indexOf(x.meal) - MEALS.indexOf(y.meal)) || ((x.kind === 'main' ? 0 : 1) - (y.kind === 'main' ? 0 : 1)));
  write_('plan', sorted.map(i => [i.id, i.day, i.meal, i.kind === 'extra' ? 'доп' : 'основное', i.dish || '', i.side || '', !!i.done, i.date || '', !!i.left, i.portions > 0 ? i.portions : '', i.from || '']));
}

function state_() {
  const m = load_();
  const sh = sheet_('log');
  const n = sh.getLastRow();
  let log = [];
  if (n > 1) {
    const from = Math.max(2, n - 99);
    log = sh.getRange(from, 1, n - from + 1, 4).getValues()
      .map(r => ({ when: str_(r[0]), action: str_(r[1]), obj: str_(r[2]), details: str_(r[3]) }))
      .reverse();
  }
  m.log = log;
  const pu = {};
  m.products.forEach(p => { pu[p.id] = p.unit; });
  const ps = sheet_('purchases');
  const pn = ps.getLastRow();
  m.purchases = [];
  if (pn > 1) {
    const from = Math.max(2, pn - 2999);
    m.purchases = ps.getRange(from, 1, pn - from + 1, 6).getValues().map(r => ({
      when: str_(r[0]), product: String(r[1]), qty: Number(r[2]) || 0,
      unit: UNITS.indexOf(String(r[3])) >= 0 ? String(r[3]) : (pu[String(r[1])] || 'ШТ'),
      total: r[4] === '' ? null : Number(r[4]), price: r[5] === '' ? null : Number(r[5])
    }));
  }
  return m;
}

function getState() {
  setup_();
  return state_();
}

/* ───────────── Продукты ───────────── */

/** p: {id?, name, unit, stock, min, total?}. stock и min — в выбранной единице. */
function saveProduct(p) {
  return tx_(() => {
    const name = String(p.name || '').trim();
    if (!name) throw new Error('Введите название продукта.');
    const unit = unit_(p.unit);
    const stock = num_(p.stock), min = num_(p.min);
    const m = load_();
    if (m.products.some(x => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('Продукт с таким названием уже есть.');
    }
    if (p.id) {
      const x = m.products.find(y => y.id === p.id);
      if (!x) throw new Error('Продукт не найден.');
      const oldUnit = x.unit, oldStock = x.stock;
      if (oldUnit !== unit) {
        m.ing.forEach(i => {
          if (i.product !== x.id) return;
          if (sameFam_(oldUnit, unit)) i.qty = conv_(i.qty, oldUnit, unit);
          else i.unit = unit;
        });
        saveIng_(m.ing);
      }
      x.name = name; x.unit = unit; x.stock = stock; x.min = min;
      log_('Продукт изменён', name,
        (oldUnit !== unit ? 'единица ' + oldUnit + ' → ' + unit + '; ' : '') +
        (conv_(oldStock, oldUnit, unit) !== stock ? 'остаток → ' + fmtQ_(stock, unit) : ''));
    } else {
      const total = money_(p.total);
      const np = { id: id_(), name, unit, stock, min };
      m.products.push(np);
      if (stock > 0) addPurchases_([[np.id, stock, unit, total]]);
      log_('Продукт добавлен', name, fmtQ_(stock, unit) + (total !== '' ? ', ' + total + ' ₸' : ''));
    }
    saveProducts_(m.products);
    return state_();
  });
}

/** Приход (delta > 0) или списание (delta < 0) в единице unit (КГ/Г, Л/МЛ, ШТ). */
function adjustStock(productId, delta, total, unit) {
  return tx_(() => {
    const d = Number(String(delta).replace(',', '.'));
    if (!isFinite(d) || d === 0) throw new Error('Введите количество.');
    const m = load_();
    const p = m.products.find(x => x.id === productId);
    if (!p) throw new Error('Продукт не найден.');
    const u = unit ? unit_(unit) : p.unit;
    if (!sameFam_(u, p.unit)) throw new Error('Продукт «' + p.name + '» считается в ' + p.unit + ' — выберите подходящую единицу.');
    const next = r6_(p.stock + conv_(d, u, p.unit));
    if (next < -EPS) throw new Error('Остаток не может быть отрицательным.');
    const sum = d > 0 ? money_(total) : '';
    p.stock = Math.max(0, next);
    saveProducts_(m.products);
    if (d > 0) addPurchases_([[p.id, r6_(d), u, sum]]);
    log_(d > 0 ? 'Приход' : 'Списание', p.name,
      (d > 0 ? '+' : '−') + fmtQ_(Math.abs(d), u) + ' → ' + fmtQ_(p.stock, p.unit) + (sum !== '' ? ', ' + sum + ' ₸' : ''));
    return state_();
  });
}

function deleteProduct(id) {
  return tx_(() => {
    const m = load_();
    const p = m.products.find(x => x.id === id);
    if (!p) throw new Error('Продукт не найден.');
    saveProducts_(m.products.filter(x => x.id !== id));
    saveIng_(m.ing.filter(i => i.product !== id));
    log_('Продукт удалён', p.name, '');
    return state_();
  });
}

/* ───────────── Блюда и состав ───────────── */

/** d.ingredients: [{product, qty, unit}] или [{newName, unit, qty}] — qty в единице строки. */
function saveDish(d) {
  return tx_(() => {
    const name = String(d.name || '').trim();
    if (!name) throw new Error('Введите название блюда.');
    const m = load_();
    if (m.dishes.some(x => x.id !== d.id && x.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('Блюдо с таким названием уже есть.');
    }
    const items = [];
    (d.ingredients || []).forEach(i => {
      let p = null;
      if (i.product) {
        p = m.products.find(x => x.id === i.product);
        if (!p) throw new Error('Продукт из состава не найден.');
      } else {
        const nm = String(i.newName || '').trim();
        if (!nm) return;
        p = m.products.find(x => x.name.toLowerCase() === nm.toLowerCase());
        if (!p) {
          p = { id: id_(), name: nm, unit: unit_(i.unit || i.newUnit), stock: 0, min: 0 };
          m.products.push(p);
          log_('Продукт добавлен', nm, 'создан из блюда «' + name + '», остаток 0');
        }
      }
      const lu = i.unit ? unit_(i.unit) : p.unit;
      if (!sameFam_(lu, p.unit)) throw new Error('«' + p.name + '» считается в ' + p.unit + ', а в составе указано ' + lu + '.');
      const qty = conv_(num_(i.qty), lu, p.unit);
      if (qty <= 0) return;
      const ex = items.find(x => x.product === p.id);
      if (ex) ex.qty = r6_(ex.qty + qty); else items.push({ product: p.id, qty, unit: lu });
    });

    const type = TYPES[d.type] ? d.type : 'main';
    const meals = MEALS.filter(x => (d.meals || []).indexOf(x) >= 0);
    let dish;
    if (d.id) {
      dish = m.dishes.find(x => x.id === d.id);
      if (!dish) throw new Error('Блюдо не найдено.');
      dish.name = name; dish.note = String(d.note || '').trim();
      log_('Блюдо изменено', name, TYPES[type] + ', ' + items.length + ' продуктов в составе');
    } else {
      dish = { id: id_(), name, note: String(d.note || '').trim() };
      m.dishes.push(dish);
      log_('Блюдо добавлено', name, TYPES[type] + ', ' + items.length + ' продуктов в составе');
    }
    dish.type = type;
    dish.meals = meals.length ? meals : MEALS.slice();
    dish.withSide = type === 'main' && !!d.withSide;
    const pr = Number(String(d.portions == null ? '' : d.portions).replace(',', '.'));
    if (pr > MAX_PORTIONS) throw new Error('Порций в рецепте — не больше ' + MAX_PORTIONS + '.');
    dish.portions = pr > 0 ? r3_(pr) : 0;
    dish.times = type === 'main' ? timesOf_(d.times) : 1;
    m.ing = m.ing.filter(x => x.dish !== dish.id)
      .concat(items.map(i => ({ dish: dish.id, product: i.product, qty: i.qty, unit: i.unit })));
    saveProducts_(m.products);
    saveDishes_(m.dishes);
    saveIng_(m.ing);
    return state_();
  });
}

function deleteDish(id) {
  return tx_(() => {
    const m = load_();
    const d = m.dishes.find(x => x.id === id);
    if (!d) throw new Error('Блюдо не найдено.');
    saveDishes_(m.dishes.filter(x => x.id !== id));
    saveIng_(m.ing.filter(i => i.dish !== id));
    m.plan = m.plan.filter(it => it.dish !== id);
    m.plan.forEach(it => { if (it.side === id) it.side = ''; });
    savePlan_(m.plan);
    log_('Блюдо удалено', d.name, '');
    return state_();
  });
}

/** Правка ячейки матрицы: qty в единице unit (пусто или 0 — убрать продукт из блюда). */
function setIngredient(dishId, productId, qty, unit) {
  return tx_(() => {
    const m = load_();
    const p = m.products.find(x => x.id === productId);
    if (!m.dishes.some(d => d.id === dishId) || !p) throw new Error('Блюдо или продукт не найдены.');
    const old = m.ing.find(i => i.dish === dishId && i.product === productId);
    const lu = unit ? unit_(unit) : (old ? old.unit : p.unit);
    if (!sameFam_(lu, p.unit)) throw new Error('«' + p.name + '» считается в ' + p.unit + '.');
    const q = conv_(num_(qty), lu, p.unit);
    m.ing = m.ing.filter(i => !(i.dish === dishId && i.product === productId));
    if (q > 0) m.ing.push({ dish: dishId, product: productId, qty: q, unit: lu });
    saveIng_(m.ing);
    return state_();
  });
}

/* ───────────── План: дни × завтрак / обед / ужин ───────────── */

function needOf_(m, dishId) { return dishId ? m.ing.filter(x => x.dish === dishId) : []; }
/** На сколько порций рассчитан рецепт (не указано — DEF_PORTIONS). */
function dishPortions_(m, dishId) { const d = dishOf_(m, dishId); return d && d.portions > 0 ? d.portions : DEF_PORTIONS; }
/** Во сколько раз увеличить рецепт, чтобы получилось P порций. P пустое/0 — готовим по рецепту как есть. */
function scaleOf_(m, dishId, P) { return P > 0 ? P / dishPortions_(m, dishId) : 1; }
/** Порций по умолчанию (настройка «обычно готовим на…»); 0 — по рецепту. */
function defP_(m) { return (m.settings && m.settings.portions) || 0; }
/** Сколько порций готовим в этой строке плана. */
function itemP_(m, it) { return it.portions > 0 ? it.portions : defP_(m); }
/**
 * Сколько каждого продукта нужно на блюдо вместе с гарниром: {productId: qty в единице продукта}.
 * P — число порций (undefined = порции по умолчанию из настроек; 0 = по рецепту). Каждое блюдо масштабируется от своего рецепта.
 */
function needMap_(m, dishId, sideId, P) {
  const p = P === undefined ? defP_(m) : P;
  const n = {};
  [dishId, sideId].forEach(id => {
    if (!id) return;
    const k = scaleOf_(m, id, p);
    needOf_(m, id).forEach(i => { n[i.product] = r6_((n[i.product] || 0) + i.qty * k); });
  });
  return n;
}
/** Вчерашнее блюдо склад не трогает. */
function itemNeed_(m, it) { return it.left ? {} : needMap_(m, it.dish, it.kind === 'main' ? it.side : '', itemP_(m, it)); }
function addNeed_(a, b) { Object.keys(b).forEach(k => { a[k] = r6_((a[k] || 0) + b[k]); }); return a; }
function stockMap_(m) { const s = {}; m.products.forEach(p => { s[p.id] = p.stock; }); return s; }
function fitsNeed_(need, sim) { return Object.keys(need).every(k => (sim[k] || 0) + EPS >= need[k]); }
function takeNeed_(need, sim) { Object.keys(need).forEach(k => { sim[k] = (sim[k] || 0) - need[k]; }); return sim; }
function cloneSim_(sim) { return JSON.parse(JSON.stringify(sim)); }
function dishOf_(m, id) { return m.dishes.find(d => d.id === id) || null; }
function nameOf_(m, id) { const d = dishOf_(m, id); return d ? d.name : ''; }
function mondayStr_() { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }

function shuffle_(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = b[i]; b[i] = b[j]; b[j] = t;
  }
  return b;
}
/** Перемешать и поставить вперёд то, что реже встречается в меню. */
function freshFirst_(list, used, prev) {
  return shuffle_(list).sort((a, b) => ((used[a.id] || 0) - (used[b.id] || 0)) || ((prev[a.id] ? 1 : 0) - (prev[b.id] ? 1 : 0)));
}
function usedCounts_(plan) {
  const u = {};
  plan.forEach(it => { if (it.dish) u[it.dish] = (u[it.dish] || 0) + 1; if (it.side) u[it.side] = (u[it.side] || 0) + 1; });
  return u;
}
/** Запас за вычетом всего, что запланировано и ещё не приготовлено (кроме exceptId). */
function simExcept_(m, exceptId) {
  const sim = stockMap_(m);
  m.plan.forEach(x => { if (x.id !== exceptId && !x.done && x.dish) takeNeed_(itemNeed_(m, x), sim); });
  return sim;
}

function pickSide_(m, sim, only, used, exclude, P) {
  const sides = freshFirst_(m.dishes.filter(d => d.type === 'side' && d.id !== exclude), used, {});
  const s = sides.find(d => !only || fitsNeed_(needMap_(m, d.id, '', P), sim));
  return s ? s.id : '';
}

function pickMain_(m, meal, sim, only, used, prev, withSides, exclude) {
  const mains = m.dishes.filter(d => d.type === 'main' && d.id !== exclude);
  let cands = mains.filter(d => d.meals.indexOf(meal) >= 0);
  if (!cands.length) cands = mains;
  const ordered = freshFirst_(cands, used, prev);
  for (let i = 0; i < ordered.length; i++) {
    const d = ordered[i];
    const mainNeed = needMap_(m, d.id, '');
    if (only && !fitsNeed_(mainNeed, sim)) continue;
    const side = withSides && d.withSide ? pickSide_(m, takeNeed_(cloneSim_(sim), mainNeed), only, used, '') : '';
    return { dish: d.id, side };
  }
  return null;
}

function chooseFor_(m, it, only) {
  const sim = simExcept_(m, it.id);
  const used = usedCounts_(m.plan);
  if (it.kind === 'main') {
    const pick = pickMain_(m, it.meal, sim, only, used, {}, true, it.dish);
    if (!pick) throw new Error(only ? 'Из того, что есть на складе, замену подобрать не удалось.' : 'Нет других основных блюд.');
    return pick;
  }
  const extras = m.dishes.filter(d => d.type === 'extra' && d.id !== it.dish);
  if (!extras.length) throw new Error('Добавьте блюда с типом «Салат/доп».');
  const e = freshFirst_(extras, used, {}).find(d => !only || fitsNeed_(needMap_(m, d.id, ''), sim));
  if (!e) throw new Error('Из того, что есть на складе, салат подобрать не удалось.');
  return { dish: e.id, side: '' };
}

function planItem_(m, id) {
  const it = m.plan.find(x => x.id === id);
  if (!it) throw new Error('Запись в меню не найдена — обновите страницу.');
  return it;
}

/**
 * opts: {onlyAvail, meals: ['Завтрак','Обед','Ужин'], sides: true, leftovers: true}.
 * Приготовленное на этой неделе сохраняется. Если у блюда «хватает на N раз», то на следующие N−1 дней
 * в то же время (завтрак → обед) ставится «вчерашнее»: оно склад не списывает.
 */
function generateWeek(opts) {
  opts = opts || {};
  const only = !!opts.onlyAvail;
  const meals = MEALS.filter(x => !opts.meals || opts.meals.indexOf(x) >= 0);
  const withSides = opts.sides !== false;
  const withLeft = opts.leftovers !== false;
  return tx_(() => {
    const m = load_();
    if (!m.dishes.some(d => d.type === 'main')) throw new Error('Добавьте хотя бы одно основное блюдо.');
    if (!meals.length) throw new Error('Выберите хотя бы один приём пищи.');
    const monday = mondayStr_();
    const prev = {};
    m.plan.forEach(it => { if (it.dish) prev[it.dish] = true; });
    const plan = m.settings.weekStart === monday ? m.plan.filter(it => it.done) : [];
    const sim = stockMap_(m);
    const used = usedCounts_(plan);
    const hasMain = (day, meal) => plan.some(it => it.day === day && it.meal === meal && it.kind === 'main');
    const reserved = {};   // 'день|приём' → остатки, которые сюда поставит приготовленное раньше блюдо
    let empty = 0, filled = 0, leftN = 0;
    for (let day = 1; day <= 7; day++) {
      meals.forEach(meal => {
        if (hasMain(day, meal)) return;
        const rs = reserved[day + '|' + meal];
        if (rs) {
          plan.push({ id: id_(), day, meal, kind: 'main', dish: rs.dish, side: rs.side, done: false, date: '', left: true, from: rs.from });
          leftN++;
          return;
        }
        const pick = pickMain_(m, meal, sim, only, used, prev, withSides, '');
        if (!pick) { empty++; return; }
        const item = { id: id_(), day, meal, kind: 'main', dish: pick.dish, side: pick.side, done: false, date: '' };
        plan.push(item);
        takeNeed_(needMap_(m, pick.dish, pick.side), sim);
        used[pick.dish] = (used[pick.dish] || 0) + 1;
        if (pick.side) used[pick.side] = (used[pick.side] || 0) + 1;
        filled++;
        const times = withLeft ? (dishOf_(m, pick.dish).times || 1) : 1;
        const lm = meal === 'Ужин' ? 'Ужин' : 'Обед';
        for (let i = 1; i < times && day + i <= 7 && meals.indexOf(lm) >= 0; i++) {
          const key = (day + i) + '|' + lm;
          if (reserved[key] || hasMain(day + i, lm)) break;
          reserved[key] = { dish: pick.dish, side: pick.side, from: item.id };
        }
      });
    }
    savePlan_(plan);
    setSetting_('weekStart', monday);
    log_('Меню составлено', '', meals.join(', ') + (only ? ', из имеющихся продуктов' : ', без учёта склада') + ': ' + filled + ' блюд' + (leftN ? ', вчерашнего: ' + leftN : ''));
    const st = state_();
    if (empty) st.notice = 'Не хватило продуктов на ' + empty + ' приёмов пищи — они остались пустыми. Пополните склад или снимите галочку «Только из того, что есть».';
    return st;
  });
}

/** Добавить блюдо в приём пищи. kind: 'main' или 'extra' (салат/доп). dishId пустой — выбрать случайно. */
function addItem(day, meal, kind, dishId, onlyAvail) {
  return tx_(() => {
    const m = load_();
    day = Number(day);
    if (!(day >= 1 && day <= 7) || MEALS.indexOf(meal) < 0) throw new Error('Неверный день или приём пищи.');
    kind = kind === 'extra' ? 'extra' : 'main';
    if (kind === 'main' && m.plan.some(x => x.day === day && x.meal === meal && x.kind === 'main')) {
      throw new Error('Основное блюдо уже выбрано — замените его.');
    }
    const it = { id: id_(), day, meal, kind, dish: '', side: '', done: false, date: '' };
    if (dishId) {
      const d = dishOf_(m, dishId);
      if (!d) throw new Error('Блюдо не найдено.');
      it.dish = d.id;
      if (kind === 'main' && d.withSide) it.side = pickSide_(m, takeNeed_(simExcept_(m, it.id), needMap_(m, d.id, '')), !!onlyAvail, usedCounts_(m.plan), '');
    } else {
      const pick = chooseFor_(m, it, !!onlyAvail);
      it.dish = pick.dish; it.side = pick.side;
    }
    m.plan.push(it);
    if (!m.settings.weekStart) setSetting_('weekStart', mondayStr_());
    savePlan_(m.plan);
    return state_();
  });
}

function rerollItem(id, onlyAvail) {
  return tx_(() => {
    const m = load_();
    const it = planItem_(m, id);
    if (it.done) throw new Error('Это блюдо уже приготовлено.');
    const pick = chooseFor_(m, it, !!onlyAvail);
    it.dish = pick.dish;
    it.left = false;
    if (it.kind === 'main') it.side = pick.side;
    savePlan_(m.plan);
    return state_();
  });
}

/** Выбрать блюдо вручную. Пустое значение убирает запись. */
function setItem(id, dishId) {
  return tx_(() => {
    const m = load_();
    const it = planItem_(m, id);
    if (it.done) throw new Error('Это блюдо уже приготовлено. Сначала отмените приготовление.');
    if (!dishId) {
      m.plan = m.plan.filter(x => x.id !== id);
    } else {
      const d = dishOf_(m, dishId);
      if (!d) throw new Error('Блюдо не найдено.');
      it.dish = d.id;
      it.left = false;
      if (it.kind === 'main') {
        if (!d.withSide) it.side = '';
        else if (!it.side) it.side = pickSide_(m, takeNeed_(simExcept_(m, it.id), needMap_(m, d.id, '')), false, usedCounts_(m.plan), '');
      }
    }
    savePlan_(m.plan);
    return state_();
  });
}

function removeItem(id) {
  return tx_(() => {
    const m = load_();
    const it = planItem_(m, id);
    if (it.done) throw new Error('Блюдо уже приготовлено — сначала отмените приготовление.');
    m.plan = m.plan.filter(x => x.id !== id);
    savePlan_(m.plan);
    return state_();
  });
}

/** Смена гарнира. Если блюдо уже приготовлено — старый гарнир возвращается на склад, новый списывается. */
function setSide_(m, it, sideId) {
  if (it.kind !== 'main') throw new Error('Гарнир добавляется только к основному блюду.');
  if (sideId && !dishOf_(m, sideId)) throw new Error('Гарнир не найден.');
  if (sideId === it.side) return [];
  let crossed = [];
  if (it.done && !it.left) {
    const P = itemP_(m, it);
    const oldNeed = needMap_(m, '', it.side, P), newNeed = needMap_(m, '', sideId, P);
    giveBack_(m, oldNeed);
    const lacks = lacksText_(m, newNeed);
    if (lacks.length) throw new Error('Для нового гарнира не хватает:\n' + lacks.join('\n'));
    crossed = deduct_(m, newNeed);
    saveProducts_(m.products);
    log_('Гарнир заменён', nameOf_(m, it.dish),
      (nameOf_(m, it.side) || 'без гарнира') + ' → ' + (nameOf_(m, sideId) || 'без гарнира') + '; склад пересчитан');
  }
  it.side = sideId || '';
  return crossed;
}

function setSide(id, sideId) {
  return tx_(() => {
    const m = load_();
    const it = planItem_(m, id);
    const crossed = setSide_(m, it, sideId);
    savePlan_(m.plan);
    return withLow_(state_(), crossed, 'после замены гарнира');
  });
}

function rerollSide(id, onlyAvail) {
  return tx_(() => {
    const m = load_();
    const it = planItem_(m, id);
    let sim;
    if (it.left) sim = stockMap_(m);
    else if (it.done) sim = addNeed_(stockMap_(m), needMap_(m, '', it.side, itemP_(m, it)));
    else sim = takeNeed_(simExcept_(m, it.id), needMap_(m, it.dish, '', itemP_(m, it)));
    const side = pickSide_(m, sim, !it.left && (it.done || !!onlyAvail), usedCounts_(m.plan), it.side, itemP_(m, it));
    if (!side) throw new Error('Другой гарнир подобрать не удалось.');
    const crossed = setSide_(m, it, side);
    savePlan_(m.plan);
    return withLow_(state_(), crossed, 'после замены гарнира');
  });
}

/* ───────────── Готовка и списание ───────────── */

function lacksText_(m, need) {
  return m.products.filter(p => need[p.id] && p.stock + EPS < need[p.id])
    .map(p => p.name + ': нужно ' + fmtQ_(need[p.id], p.unit) + ', есть ' + fmtQ_(p.stock, p.unit));
}
/** Списывает со склада; возвращает продукты, опустившиеся до минимума. */
function deduct_(m, need) {
  const crossed = [];
  m.products.forEach(p => {
    const q = need[p.id];
    if (!q) return;
    const before = p.stock;
    p.stock = r6_(Math.max(0, p.stock - q));
    if (before > p.min && p.stock <= p.min) crossed.push(p);
  });
  return crossed;
}
function giveBack_(m, need) { m.products.forEach(p => { if (need[p.id]) p.stock = r6_(p.stock + need[p.id]); }); }
function needText_(m, need) {
  return m.products.filter(p => need[p.id]).map(p => p.name + ' −' + fmtQ_(need[p.id], p.unit)).join(', ') || 'без списания';
}
function itemTitle_(m, it) { return nameOf_(m, it.dish) + (it.kind === 'main' && it.side ? ' + ' + nameOf_(m, it.side) : '') + (it.left ? ' (вчерашнее)' : ''); }
function withLow_(st, crossed, reason) {
  if (crossed.length) {
    notifyLow_(crossed, reason);
    st.notice = 'Заканчиваются: ' + crossed.map(p => p.name + ' (' + fmtQ_(p.stock, p.unit) + ')').join(', ');
  }
  return st;
}

function cookItems_(m, items, label) {
  const need = {};
  items.forEach(it => addNeed_(need, itemNeed_(m, it)));
  const lacks = lacksText_(m, need);
  if (lacks.length) throw new Error('Не хватает продуктов:\n' + lacks.join('\n'));
  const crossed = deduct_(m, need);
  const when = now_();
  items.forEach(it => { it.done = true; it.date = when; });
  saveProducts_(m.products);
  const real = items.some(it => !it.left);
  log_(real ? 'Приготовлено' : 'Доели вчерашнее', label, real ? needText_(m, need) : 'склад не менялся');
  return crossed;
}

/** День недели в винительном падеже («на среду»). */
function dayAcc_(m, day) {
  const ws = String(m.settings.weekStart || mondayStr_()).slice(0, 10).split('-').map(Number);
  return ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'][new Date(ws[0], ws[1] - 1, ws[2] + day - 1).getDay()];
}

/**
 * Поставить блюдо в приём пищи как «вчерашнее» (склад не трогает).
 * Если там запланировано неприготовленное основное блюдо — оно заменяется; если уже приготовленное — добавляется как доп.
 * fromId — строка плана, из которой остались эти остатки (чтобы убрать их при отмене приготовления).
 */
function placeSlot_(m, slot, dishId, sideId, fromId) {
  const main = m.plan.find(x => x.day === slot.day && x.meal === slot.meal && x.kind === 'main');
  if (main && !main.done) {
    if (!(main.left && main.dish === dishId && (main.side || '') === (sideId || ''))) {
      main.dish = dishId; main.side = sideId || ''; main.left = true; main.portions = 0;
    }
    main.from = fromId || main.from || '';
  } else {
    m.plan.push({ id: id_(), day: slot.day, meal: slot.meal, kind: main ? 'extra' : 'main', dish: dishId, side: main ? '' : (sideId || ''), done: false, date: '', left: true, portions: 0, from: fromId || '' });
  }
}

function checkSlot_(slot) {
  if (!(slot.day >= 1 && slot.day <= 7) || MEALS.indexOf(slot.meal) < 0) throw new Error('Неверный день или приём пищи для остатков.');
}

/** Один приём пищи (кнопка «Вчерашнее» и ручной выбор): target = {day, meal}. */
function placeLeftover_(m, target, dishId, sideId) {
  if (!target || !dishId) return '';
  const slot = { day: Number(target.day), meal: target.meal };
  checkSlot_(slot);
  if (!dishOf_(m, dishId)) throw new Error('Блюдо не найдено.');
  placeSlot_(m, slot, dishId, sideId, '');
  if (!m.settings.weekStart) setSetting_('weekStart', mondayStr_());
  log_('Остатки на потом', nameOf_(m, dishId) + (sideId ? ' + ' + nameOf_(m, sideId) : ''), 'на ' + dayAcc_(m, slot.day) + ', ' + slot.meal.toLowerCase());
  return '♻️ Остатки поставлены на ' + dayAcc_(m, slot.day) + ', ' + slot.meal.toLowerCase() + ' — второй раз со склада не спишется.';
}

/** Куда лягут count порций остатков: с target подряд по дням в тот же приём, иначе со следующего дня после src. */
function leftoverSlots_(src, target, count) {
  let day, meal;
  if (target && target.day) { day = Number(target.day); meal = target.meal; }
  else if (src) { day = Number(src.day) + 1; meal = src.meal === 'Ужин' ? 'Ужин' : 'Обед'; }   // завтрак → обед
  else return [];
  const out = [];
  for (let i = 0; i < count && day + i <= 7; i++) out.push({ day: day + i, meal });
  return out;
}

/**
 * Остатки после готовки. opts: {times: «хватит на N раз» (по умолчанию из блюда), target: {day, meal} — с какого приёма | 'none' — не ставить,
 * src: {day, meal} — откуда считать «следующий день», если готовим вне меню}.
 * N раз — это вместе с тем, что съедят сейчас, поэтому в «вчерашнее» уходит N−1 приёмов.
 */
function placeLeftovers_(m, opts, dishId, sideId, src, fromId) {
  const dish = dishOf_(m, dishId);
  if (!dish || opts.target === 'none') return '';
  const t = opts.target && opts.target.day ? { day: Number(opts.target.day), meal: opts.target.meal } : null;
  const times = Number(opts.times) > 0 ? timesOf_(opts.times) : (dish.times || 1);
  let count = times - 1;
  if (t) { checkSlot_(t); count = Math.max(count, 1); }
  if (count < 1) return '';
  const slots = leftoverSlots_(src || opts.src, t, count);
  if (!slots.length) return count ? '♻️ Остатки не поставлены: на следующую неделю они не переносятся.' : '';
  slots.forEach(s => { checkSlot_(s); placeSlot_(m, s, dishId, sideId, fromId || ''); });
  if (!m.settings.weekStart) setSetting_('weekStart', mondayStr_());
  const where = slots.map(s => dayAcc_(m, s.day) + ', ' + s.meal.toLowerCase());
  log_('Остатки на потом', nameOf_(m, dishId) + (sideId ? ' + ' + nameOf_(m, sideId) : ''), 'на ' + where.join('; '));
  return '♻️ Остатки поставлены на ' + where.join('; ') + ' — второй раз со склада не спишется.' +
    (slots.length < count ? '\nДальше конец недели: на следующую неделю остатки не переносятся.' : '');
}

/** Старый вызов клиента передавал просто {day, meal}; новый — объект с порциями, «хватит на» и т.д. */
function cookOpts_(x) {
  if (x && x.day != null && x.meal) return { target: { day: x.day, meal: x.meal } };
  return x && typeof x === 'object' ? x : {};
}

/** Число порций, на которое готовим сейчас (пусто — как в настройках или по рецепту). */
function applyPortions_(items, opts) {
  const P = Number(String(opts.portions == null ? '' : opts.portions).replace(',', '.'));
  if (!(P > 0)) return 0;
  if (P > MAX_PORTIONS) throw new Error('Порций — не больше ' + MAX_PORTIONS + '.');
  items.forEach(it => { if (!it.left) it.portions = P; });
  return P;
}
const portionsNote_ = P => (P > 0 ? ' · ' + String(r3_(P)).replace('.', ',') + ' порц.' : '');

function finish_(m, crossed, leftNote) {
  savePlan_(m.plan);
  const st = withLow_(state_(), crossed, 'после приготовления');
  if (leftNote) st.notice = (st.notice ? st.notice + '\n' : '') + leftNote;
  return st;
}

/**
 * opts (необязательно): {portions — на сколько порций готовим, times — хватит на N раз, target — {day, meal} | 'none'}.
 * Остатки блюда (если «хватает» больше чем на раз) сами встанут в меню следующих дней как «вчерашнее».
 */
function cookItem(id, opts) {
  opts = cookOpts_(opts);
  return tx_(() => {
    const m = load_();
    const it = planItem_(m, id);
    if (it.done) throw new Error('Это блюдо уже отмечено как приготовленное.');
    if (!it.dish) throw new Error('Блюдо не выбрано.');
    const P = applyPortions_([it], opts);
    const crossed = cookItems_(m, [it], it.meal + ': ' + itemTitle_(m, it) + portionsNote_(P));
    const note = it.kind === 'main' && !it.left ? placeLeftovers_(m, opts, it.dish, it.side, { day: it.day, meal: it.meal }, it.id) : '';
    return finish_(m, crossed, note);
  });
}

/** Приготовить весь приём пищи (основное, гарнир и салаты) одним действием. */
function cookMeal(day, meal, opts) {
  opts = cookOpts_(opts);
  return tx_(() => {
    const m = load_();
    const items = m.plan.filter(x => x.day === Number(day) && x.meal === meal && !x.done && x.dish);
    if (!items.length) throw new Error('Здесь нечего готовить.');
    const P = applyPortions_(items, opts);
    const crossed = cookItems_(m, items, meal + ': ' + items.map(it => itemTitle_(m, it)).join(', ') + portionsNote_(P));
    const main = items.find(it => it.kind === 'main' && !it.left);
    const note = main ? placeLeftovers_(m, opts, main.dish, main.side, { day: Number(day), meal }, main.id) : '';
    return finish_(m, crossed, note);
  });
}

/** Отметить, что блюдо в меню — вчерашнее (on=true) или его будем готовить (on=false). */
function setLeftover(id, on) {
  return tx_(() => {
    const m = load_();
    const it = planItem_(m, id);
    if (it.done) throw new Error('Блюдо уже отмечено — сначала отмените.');
    it.left = !!on;
    savePlan_(m.plan);
    return state_();
  });
}

/** Поставить в приём пищи вчерашнее блюдо (склад не списывается). */
function addLeftover(day, meal, dishId, sideId) {
  return tx_(() => {
    const m = load_();
    placeLeftover_(m, { day, meal }, dishId, sideId);
    savePlan_(m.plan);
    return state_();
  });
}

function undoItem(id) {
  return tx_(() => {
    const m = load_();
    const it = planItem_(m, id);
    if (!it.done) throw new Error('Это блюдо ещё не приготовлено.');
    giveBack_(m, itemNeed_(m, it));
    it.done = false; it.date = '';
    // остатки, которые встали в меню после этой готовки и ещё не съедены, убираем
    const before = m.plan.length;
    m.plan = m.plan.filter(x => !(x.from === it.id && x.left && !x.done));
    const removed = before - m.plan.length;
    saveProducts_(m.products);
    savePlan_(m.plan);
    log_('Приготовление отменено', itemTitle_(m, it), (it.left ? 'склад не менялся' : 'продукты возвращены на склад') + (removed ? '; убраны остатки в меню: ' + removed : ''));
    const st = state_();
    if (removed) st.notice = '↩️ Убрала и «вчерашнее», которое стояло в меню после этой готовки (' + removed + ').';
    return st;
  });
}

/** Приготовить блюдо вне меню (с вкладки «Блюда»), можно с гарниром. */
function cookDish(dishId, sideId, opts) {
  opts = cookOpts_(opts);
  return tx_(() => {
    const m = load_();
    const dish = dishOf_(m, dishId);
    if (!dish) throw new Error('Блюдо не найдено.');
    const side = dish.type === 'main' && sideId && dishOf_(m, sideId) ? sideId : '';
    const tmp = { portions: 0 };
    const P = applyPortions_([tmp], opts);
    const need = needMap_(m, dish.id, side, P > 0 ? P : undefined);
    const lacks = lacksText_(m, need);
    if (lacks.length) throw new Error('Не хватает продуктов:\n' + lacks.join('\n'));
    const crossed = deduct_(m, need);
    saveProducts_(m.products);
    log_('Приготовлено', dish.name + (side ? ' + ' + nameOf_(m, side) : '') + portionsNote_(P), needText_(m, need));
    const note = dish.type === 'side' ? '' : placeLeftovers_(m, opts, dish.id, side, null, '');
    return finish_(m, crossed, note);
  });
}

/* ───────────── Excel: загрузка и выгрузка ───────────── */

/**
 * rows: [{name, unit, qty, min, total}] — qty и min в единице unit из файла.
 * Существующий продукт пополняется (с пересчётом КГ↔Г, Л↔МЛ), новый создаётся.
 */
function importProducts(rows) {
  return tx_(() => {
    const m = load_();
    const purchases = [];
    let created = 0, updated = 0;
    const skipped = [];
    (rows || []).forEach(r => {
      const name = String(r.name || '').trim();
      if (!name) return;
      const qty = num_(r.qty);
      const total = money_(r.total);
      const u = r.unit ? String(r.unit).toUpperCase() : '';
      let p = m.products.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (p) {
        const fu = u || p.unit;
        if (!sameFam_(fu, p.unit)) { skipped.push(name + ' (на складе в ' + p.unit + ')'); return; }
        if (qty > 0) { p.stock = r6_(p.stock + conv_(qty, fu, p.unit)); purchases.push([p.id, qty, fu, total]); }
        if (r.min !== '' && r.min != null) p.min = conv_(num_(r.min), fu, p.unit);
        updated++;
      } else {
        if (UNITS.indexOf(u) < 0) { skipped.push(name + ' (нет единицы)'); return; }
        p = { id: id_(), name, unit: u, stock: qty, min: num_(r.min) };
        m.products.push(p);
        if (qty > 0) purchases.push([p.id, qty, u, total]);
        created++;
      }
    });
    saveProducts_(m.products);
    addPurchases_(purchases);
    log_('Загрузка из Excel', '', 'новых: ' + created + ', пополнено: ' + updated + (skipped.length ? ', пропущено: ' + skipped.length : ''));
    const st = state_();
    st.notice = 'Загружено: новых ' + created + ', пополнено ' + updated + '.' + (skipped.length ? '\nПропущено: ' + skipped.join(', ') : '');
    return st;
  });
}

/**
 * Создаёт Google Таблицу с данными и возвращает ссылку на скачивание в .xlsx.
 * opts.fill — номера столбцов для заполнения (подсвечиваются), opts.unitCol — столбец единиц (выпадающий список).
 */
function exportXlsx(name, rows, opts) {
  if (!rows || !rows.length) throw new Error('Нет данных для выгрузки.');
  const w = Math.max.apply(null, rows.map(r => r.length));
  const data = rows.map(r => { const a = r.slice(); while (a.length < w) a.push(''); return a.map(v => v == null ? '' : v); });
  const ss = SpreadsheetApp.create(String(name || 'Выгрузка'));
  const sh = ss.getSheets()[0];
  sh.getRange(1, 1, data.length, w).setValues(data);
  sh.getRange(1, 1, 1, w).setFontWeight('bold').setBackground('#ece8fc').setWrap(true);
  const n = data.length - 1;
  if (opts && n > 0) {
    (opts.fill || []).forEach(c => {
      sh.getRange(1, c).setBackground('#ffd970');
      sh.getRange(2, c, n, 1).setBackground('#fff6d1');
    });
    if (opts.unitCol) {
      sh.getRange(2, opts.unitCol, n, 1).setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(UNITS, true).setAllowInvalid(false).build());
    }
    const last = data[data.length - 1];
    if (String(last[0]).toLowerCase().indexOf('итого') === 0) sh.getRange(data.length, 1, 1, w).setFontWeight('bold').setBackground(null).clearDataValidations();
  }
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  sh.autoResizeColumns(1, w);
  SpreadsheetApp.flush();
  return 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx';
}

/* ───────────── Уведомления ───────────── */

/** email — адрес для писем; portions — «обычно готовим на N порций» (пусто — по рецепту; undefined — не менять). */
function saveSettings(email, portions) {
  return tx_(() => {
    const e = String(email || '').trim();
    if (e && !/^\S+@\S+\.\S+$/.test(e)) throw new Error('Похоже, e-mail введён неверно.');
    setSetting_('email', e);
    if (portions !== undefined) {
      const s = String(portions == null ? '' : portions).trim().replace(',', '.');
      const n = Number(s);
      if (s !== '' && (!(n > 0) || n > MAX_PORTIONS)) throw new Error('Порций должно быть от 1 до ' + MAX_PORTIONS + ' (или пусто — готовим по рецепту).');
      setSetting_('portions', s === '' ? '' : String(r3_(n)));
    }
    return state_();
  });
}

function notifyLow_(products, reason) {
  try {
    const email = getSettings_().email;
    if (!email || !products.length) return;
    const body = 'Заканчиваются продукты (' + reason + '):\n\n' +
      products.map(p => '• ' + p.name + ' — осталось ' + fmtQ_(p.stock, p.unit) + ' (минимум ' + fmtQ_(p.min, p.unit) + ')').join('\n');
    MailApp.sendEmail(email, 'Заканчиваются продукты', body);
  } catch (e) { /* письмо не должно ломать готовку */ }
}

/** Вызывается триггером раз в день. */
function checkLowStock() {
  const m = load_();
  notifyLow_(m.products.filter(p => p.stock <= p.min), 'ежедневная проверка');
}

/* ───────────── Лист «Матрица» (для просмотра прямо в таблице) ───────────── */

function renderMatrixSheet() {
  const m = load_();
  const ss = ss_();
  const sh = ss.getSheetByName('Матрица') || ss.insertSheet('Матрица');
  sh.clear();
  const head = ['Блюдо'].concat(m.products.map(p => p.name + ' (' + p.unit + ')')).concat(['Можно приготовить?']);
  const rows = m.dishes.map(d => {
    const row = [d.name];
    let ok = true;
    m.products.forEach(p => {
      const i = m.ing.find(x => x.dish === d.id && x.product === p.id);
      row.push(i ? i.qty : '');
      if (i && p.stock + EPS < i.qty) ok = false;
    });
    row.push(ok ? 'да' : 'нет');
    return row;
  });
  const stockRow = ['Остаток на складе'].concat(m.products.map(p => p.stock)).concat(['']);
  const data = [head].concat(rows, [stockRow]);
  sh.getRange(1, 1, data.length, head.length).setValues(data);
  sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#ece8fc').setWrap(true);
  sh.getRange(data.length, 1, 1, head.length).setFontWeight('bold').setBackground('#f2eff9');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  sh.setColumnWidth(1, 200);
}
