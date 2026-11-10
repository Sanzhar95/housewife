/**
 * Домашний помощник: модуль «Уборка» (предметная логика в браузере).
 * Порт блока «Уборка» из присланного Code.gs: шаблоны, планировщик (штрафы), генеральные дела,
 * расходники, «Готово / Отменить / Завтра», тексты ошибок — без изменений. Слой хранения свой:
 * все данные модуля — один объект data (на семью), который лежит в таблице clean_data одной строкой JSON.
 *
 *   data = { settings, rooms:[{id,name,type}], rows:[{week,id,day,moved,done,spent,prev}],
 *            generals:[{id,on,months,last}], supplies:[{id,name,unit,stock|null,min,kind,per}] }
 *
 * CleanLogic.create({ id, now, today }):
 *   id()    — новый ID (8 символов); now() — 'yyyy-MM-dd HH:mm'; today() — 'yyyy-MM-dd'.
 *   .emptyData()                  — пустой модуль с типовыми расходниками (остаток не указан).
 *   .normalize(data)              — приводит любые данные к схеме (идемпотентно, ничего не теряет).
 *   .state(data)                  — вычисленный план недели и всё для экрана (план НЕ хранится).
 *   .apply(имя, data, [аргументы]) — { data, notice }. Исходное не меняется. Ошибка = Error по-русски.
 * Кухню модуль не затрагивает: ни её данных, ни её логики.
 */
(function (root, factory) {
  const L = factory();
  if (typeof module === 'object' && module.exports) module.exports = L;
  else root.CleanLogic = L;
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

const UNITS = ['КГ', 'Г', 'Л', 'МЛ', 'ШТ'];
const ROOM_TYPES = { bedroom: 'Спальня', living: 'Гостиная', kids: 'Детская', office: 'Кабинет' };
const DEF_CLEAN = { limit: 60, rest: [7], kitchen: true, hall: true, split: true, remind: true, ready: false };
const MAX_ROOMS = 8;
/** Типовые расходники: [название, ед., вид уборки, расход за раз]. */
const CLEAN_SUPPLIES = [
  ['Средство для полов', 'МЛ', 'floor', 40],
  ['Средство для кухни (антижир)', 'МЛ', 'kitchen', 30],
  ['Средство для ванной', 'МЛ', 'bath', 60],
  ['Средство для туалета', 'МЛ', 'wc', 50],
  ['Спрей от пыли', 'МЛ', 'dust', 15]
];
/** Задачи по типам помещений. times — сколько раз в неделю, heavy — тяжёлая (не ставим две в один день). */
const CLEAN_TPL = {
  bedroom: [{ k: 'floor', sub: 'Пылесос, затем влажные полы, протереть пыль', min: 15 }],
  living:  [{ k: 'floor', sub: 'Пылесос, затем влажные полы', min: 15 }, { k: 'dust', sub: 'Поверхности, техника, подоконник', min: 10 }],
  kids:    [{ k: 'floor', sub: 'Игрушки на места, пылесос, полы', min: 15, times: 2 }],
  office:  [{ k: 'floor', sub: 'Пылесос, полы, протереть стол', min: 10 }],
  kitchen: [{ k: 'kitchen', sub: 'Плита, столешницы, раковина', min: 15, times: 2 }, { k: 'floor', sub: 'Подмести и протереть пол', min: 10 }],
  hall:    [{ k: 'floor', sub: 'Пылесос, влажный пол, обувь', min: 10 }],
  bath:    [{ k: 'bath', part: 'Основная', sub: 'Ванна, раковина, плитка, пол', min: 30, heavy: true }, { k: 'bath', part: 'Лёгкая', sub: 'Раковина, зеркало, пол', min: 15 }],
  wc:      [{ k: 'wc', part: 'Основная', sub: 'Унитаз, пол, стены, дезинфекция', min: 20, heavy: true }, { k: 'wc', part: 'Лёгкая', sub: 'Унитаз, раковина, пол', min: 10 }],
  bathwc:  [{ k: 'bath', part: 'Основная', sub: 'Ванна, раковина, унитаз, пол', min: 40, heavy: true }, { k: 'bath', part: 'Лёгкая', sub: 'Раковина, унитаз, зеркало', min: 20 }]
};
/** Генеральные: [id, название, описание, минут, раз в N месяцев]. */
const CLEAN_GEN = [
  ['g_win', 'Окна', 'Помыть стёкла и рамы, подоконники', 40, 3],
  ['g_fridge', 'Холодильник', 'Разморозить/протереть полки, выбросить лишнее', 30, 2],
  ['g_oven', 'Духовка и плита', 'Отмыть духовку, решётки, вытяжку', 30, 2],
  ['g_cab', 'Кухонные шкафы', 'Протереть фасады и полки внутри', 30, 3],
  ['g_lamp', 'Люстры и светильники', 'Снять пыль, протереть плафоны', 20, 3],
  ['g_mat', 'Матрасы и диваны', 'Пропылесосить, проветрить', 25, 3],
  ['g_bal', 'Балкон / кладовка', 'Разобрать, вымыть пол', 30, 3],
  ['g_tile', 'Швы плитки и сантехника', 'Отмыть швы, налёт, смесители', 30, 1]
];
const DAYN = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const KINDS = ['floor', 'kitchen', 'bath', 'wc', 'dust', ''];

const r6 = x => Math.round(x * 1e6) / 1e6;
const str = v => (v == null ? '' : String(v));
const dateOnly = v => str(v).slice(0, 10);
const num = v => {
  const n = Number(String(v == null ? '' : v).replace(',', '.').replace(/\s/g, ''));
  return isFinite(n) ? n : 0;
};
const utc = s => { const x = s.split('-').map(Number); return Date.UTC(x[0], x[1] - 1, x[2]); };
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
const pad2 = n => (n < 10 ? '0' : '') + n;
const fmtDate = ms => { const d = new Date(ms); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); };
/** 1 = Пн … 7 = Вс */
const dayIdxOf = s => ((new Date(utc(s)).getUTCDay() + 6) % 7) + 1;
const mondayOf = s => fmtDate(utc(s) - (dayIdxOf(s) - 1) * 86400000);
const fmtQ = (x, u) => {
  const n = Math.round(x * 100) / 100;
  return String(n).replace('.', ',') + ' ' + String(u || '').toLowerCase();
};
const clone = o => JSON.parse(JSON.stringify(o));

function cleanSettings(o) {
  o = o && typeof o === 'object' ? o : {};
  const s = Object.assign({}, DEF_CLEAN, o);
  s.limit = Math.min(180, Math.max(20, Math.round(Number(s.limit)) || 60));
  s.rest = (Array.isArray(s.rest) ? s.rest : []).map(Number).filter((d, i, a) => d >= 1 && d <= 7 && a.indexOf(d) === i).sort();
  if (s.rest.length >= 7) s.rest = [7];
  ['kitchen', 'hall', 'split', 'remind', 'ready'].forEach(k => { s[k] = !!s[k]; });
  return s;
}

function settingsPatch(p) {
  const o = {};
  if (!p) return o;
  if (p.limit !== undefined) o.limit = p.limit;
  if (p.rest !== undefined) o.rest = p.rest;
  ['kitchen', 'hall', 'split', 'remind'].forEach(k => { if (p[k] !== undefined) o[k] = !!p[k]; });
  return o;
}

/** Список недельных задач (без дней). */
function cleanTasks(c) {
  const s = c.settings, list = [];
  const rooms = c.rooms.map(r => ({ id: r.id, name: r.name, tpl: r.type }));
  if (s.kitchen) rooms.push({ id: 'kitchen', name: 'Кухня', tpl: 'kitchen' });
  if (s.hall) rooms.push({ id: 'hall', name: 'Коридор', tpl: 'hall' });
  if (s.split) { rooms.push({ id: 'bath', name: 'Ванная', tpl: 'bath' }); rooms.push({ id: 'wc', name: 'Туалет', tpl: 'wc' }); }
  else rooms.push({ id: 'bathwc', name: 'Санузел', tpl: 'bathwc' });
  rooms.forEach(r => {
    CLEAN_TPL[r.tpl].forEach((t, ti) => {
      const n = t.times || 1;
      for (let i = 0; i < n; i++) {
        list.push({
          id: r.id + '.' + ti + '.' + (i + 1), group: r.id + '.' + ti, room: r.name,
          title: r.name + (t.part ? ' · ' + t.part : (t.k === 'dust' ? ' · пыль' : '')), sub: t.sub,
          k: t.k, min: t.min, heavy: !!t.heavy, gen: false
        });
      }
    });
  });
  return list;
}

/** Раскладка по дням. pins: {taskId: day} — сделанные и перенесённые остаются где стоят. */
function cleanSchedule(tasks, days, limit, pins) {
  const load = {}, heavyOn = {}, placed = {}, byGroup = {};
  days.forEach(d => { load[d] = 0; });
  const order = tasks.slice().sort((a, b) => (b.heavy - a.heavy) || (b.min - a.min) || (a.id < b.id ? -1 : 1));
  order.forEach(t => {
    let best = null, bestCost = Infinity;
    const pin = pins[t.id];
    const cand = pin ? [pin] : days;
    cand.forEach(d => {
      let cost = (load[d] || 0);
      (byGroup[t.group] || []).forEach(o => { if (placed[o] === d) cost += 40; });
      if (t.room) tasks.forEach(o => { if (o !== t && o.room === t.room && placed[o.id] === d) cost += 40; });
      if (t.heavy) {
        if (heavyOn[d]) cost += 1000;
        if (heavyOn[d - 1] || heavyOn[d + 1]) cost += 60;
      }
      const over = (load[d] || 0) + t.min - limit;
      if (over > 0) cost += 500 + 10 * over;
      (byGroup[t.group] || []).forEach(o => { if (Math.abs(placed[o] - d) < 3) cost += 300; });
      if (cost < bestCost) { bestCost = cost; best = d; }
    });
    placed[t.id] = best;
    load[best] = (load[best] || 0) + t.min;
    if (t.heavy) heavyOn[best] = true;
    (byGroup[t.group] = byGroup[t.group] || []).push(t.id);
  });
  return placed;
}

function create(env) {
  const newId = env.id, nowStr = env.now, todayFn = env.today;

  function emptyData() {
    return normalize({
      settings: DEF_CLEAN, rooms: [], rows: [], generals: [],
      supplies: CLEAN_SUPPLIES.map(x => ({ id: newId(), name: x[0], unit: x[1], stock: null, min: x[3] * 5, kind: x[2], per: x[3] }))
    });
  }

  /** Приведение к схеме. Идемпотентно; неизвестные поля отбрасываются, известные не теряются. */
  function normalize(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const settings = cleanSettings(raw.settings);
    const rooms = (Array.isArray(raw.rooms) ? raw.rooms : []).filter(r => r && r.id).slice(0, MAX_ROOMS).map(r => ({
      id: String(r.id), name: str(r.name).trim() || 'Комната', type: ROOM_TYPES[String(r.type)] ? String(r.type) : 'bedroom'
    }));
    const rows = (Array.isArray(raw.rows) ? raw.rows : []).filter(r => r && r.week && r.id).map(r => ({
      week: dateOnly(r.week), id: String(r.id), day: Number(r.day) || 0,
      moved: r.moved === true || r.moved === 'TRUE', done: str(r.done), spent: str(r.spent), prev: dateOnly(r.prev)
    }));
    const gen = {};
    (Array.isArray(raw.generals) ? raw.generals : []).forEach(g => {
      if (g && g.id) gen[String(g.id)] = { on: !(g.on === false || g.on === 'FALSE'), months: Number(g.months) || 0, last: dateOnly(g.last) };
    });
    const generals = CLEAN_GEN.map(g => {
      const x = gen[g[0]] || {};
      return { id: g[0], on: x.on !== false, months: [1, 2, 3].indexOf(x.months) >= 0 ? x.months : g[4], last: x.last || '' };
    });
    const supplies = (Array.isArray(raw.supplies) ? raw.supplies : []).filter(r => r && r.id).map(r => ({
      id: String(r.id), name: str(r.name), unit: UNITS.indexOf(String(r.unit)) >= 0 ? String(r.unit) : 'МЛ',
      stock: r.stock === '' || r.stock == null ? null : (Number(r.stock) || 0), min: Number(r.min) || 0,
      kind: KINDS.indexOf(String(r.kind || '')) >= 0 ? String(r.kind || '') : '', per: Number(r.per) || 0
    }));
    return { settings, rooms, rows, generals, supplies };
  }

  function state(raw) {
    const c = normalize(raw);
    const s = c.settings, todayS = todayFn(), week = mondayOf(todayS), today = dayIdxOf(todayS);
    const out = { ready: s.ready, settings: s, rooms: c.rooms, week, today, todayDate: todayS, days: [], tasks: [], general: [], supplies: [], low: [], quick: [], totalMin: 0, doneMin: 0, roomTypes: ROOM_TYPES };
    const rowOf = {};
    c.rows.filter(r => r.week === week).forEach(r => { rowOf[r.id] = r; });
    let days = [1, 2, 3, 4, 5, 6, 7].filter(d => s.rest.indexOf(d) < 0);
    if (!days.length) days = [1, 2, 3, 4, 5, 6, 7];
    const tasks = cleanTasks(c);

    // Генеральная недели: сделанная на этой неделе остаётся; иначе — самая просроченная из «пора».
    // Она участвует в раскладке наравне с остальными, чтобы в её день осталось место.
    const gens = c.generals.map(g => {
      const meta = CLEAN_GEN.find(x => x[0] === g.id);
      const since = g.last ? daysBetween(g.last, todayS) : null;
      const period = g.months * 30;
      const over = since == null ? 9999 : since - (period - 3);
      return Object.assign({ name: meta[1], sub: meta[2], min: meta[3] }, g, { since, due: g.on && over >= 0, over, doneNow: !!(rowOf['g:' + g.id] && rowOf['g:' + g.id].done), inPlan: false });
    });
    let pick = gens.find(g => g.doneNow);
    if (!pick) pick = gens.filter(g => g.due).sort((a, b) => b.over - a.over)[0] || null;
    if (pick) {
      pick.inPlan = true;
      tasks.push({ id: 'g:' + pick.id, group: 'g:' + pick.id, room: 'Генеральная', title: pick.name, sub: pick.sub, k: 'general', min: pick.min, heavy: false, gen: true });
    }

    const pins = {};
    tasks.forEach(t => { const r = rowOf[t.id]; if (r && r.day) pins[t.id] = r.day; });
    const placed = cleanSchedule(tasks, days, s.limit, pins);
    tasks.forEach(t => { t.day = placed[t.id]; });

    tasks.forEach(t => {
      const r = rowOf[t.id];
      t.done = !!(r && r.done);
      t.moved = !!(r && r.moved);
      t.late = !t.done && t.day < today;
      out.totalMin += t.min;
      if (t.done) out.doneMin += t.min;
    });
    tasks.sort((a, b) => (a.day - b.day) || (b.heavy - a.heavy) || (b.min - a.min) || (a.id < b.id ? -1 : 1));
    out.tasks = tasks;
    [1, 2, 3, 4, 5, 6, 7].forEach(d => {
      const list = tasks.filter(t => t.day === d);
      out.days.push({ day: d, name: DAYN[d], rest: days.indexOf(d) < 0, min: list.reduce((a, t) => a + t.min, 0), ids: list.map(t => t.id) });
    });
    out.general = gens.map(g => ({ id: g.id, name: g.name, sub: g.sub, min: g.min, months: g.months, on: g.on, last: g.last, since: g.since, due: g.due, inPlan: g.inPlan, done: g.doneNow }));
    out.supplies = c.supplies;
    out.low = c.supplies.filter(x => x.stock != null && x.stock <= x.min);
    // «Быстрая уборка на 15 минут»: самые лёгкие невыполненные задачи (сначала сегодняшние и просроченные)
    let left = 15;
    tasks.filter(t => !t.done && !t.gen && !t.heavy && t.day <= today).concat(tasks.filter(t => !t.done && !t.gen && !t.heavy && t.day > today))
      .sort((a, b) => (a.day > today) - (b.day > today) || a.min - b.min).forEach(t => {
        if (t.min <= left) { out.quick.push(t.id); left -= t.min; }
      });
    return out;
  }

  /* — действия — */

  function rowOf(c, week, id) {
    let r = c.rows.find(x => x.week === week && x.id === id);
    if (!r) { r = { week, id, day: 0, moved: false, done: '', spent: '', prev: '' }; c.rows.push(r); }
    return r;
  }
  /** Запоминаем, где сейчас стоит каждое дело недели: после «Готово» или «Завтра» остальные не прыгают по дням. */
  function pinAll(c, st) {
    st.tasks.forEach(t => { const r = rowOf(c, st.week, t.id); if (!r.day) r.day = t.day; });
  }
  function find(st, id) {
    const t = st.tasks.find(x => x.id === id);
    if (!t) throw new Error('Этой задачи уже нет в плане. Обновите страницу.');
    return t;
  }
  function resetMoves(c, week) {
    c.rows = c.rows.filter(r => !(r.week === week && !r.done));
  }
  const low = c => c.supplies.filter(x => x.stock != null && x.stock <= x.min);

  const A = {
    /** Отметить сделанным (id или список id). Расходники списываются сами; сколько — запоминаем для отмены. */
    cleanDone(c, ids) {
      const list = Array.isArray(ids) ? ids : [ids];
      const st = state(c), week = st.week;
      pinAll(c, st);
      list.forEach(id => {
        const t = find(st, id);
        const r = rowOf(c, week, id);
        if (r.done) return;
        r.day = t.day; r.done = nowStr();
        if (t.gen) {
          const g = c.generals.find(x => 'g:' + x.id === id);
          r.prev = g.last || '';
          g.last = todayFn();
        } else {
          const spent = [];
          c.supplies.forEach(sp => {
            if (sp.kind === t.k && sp.per > 0 && sp.stock != null) {
              const q = Math.min(sp.stock, sp.per);
              sp.stock = r6(sp.stock - q);
              if (q > 0) spent.push(sp.id + ':' + q);
            }
          });
          r.spent = spent.join(';');
        }
      });
      const l = low(c);
      return l.length ? 'Заканчивается: ' + l.map(x => x.name).join(', ') : '';
    },

    cleanUndo(c, id) {
      const week = mondayOf(todayFn());
      const r = c.rows.find(x => x.week === week && x.id === id);
      if (!r || !r.done) throw new Error('Эта задача и так не отмечена.');
      if (id.indexOf('g:') === 0) {
        const g = c.generals.find(x => 'g:' + x.id === id);
        if (g) g.last = r.prev || '';
      } else if (r.spent) {
        r.spent.split(';').forEach(p => {
          const a = p.split(':'), sp = c.supplies.find(x => x.id === a[0]);
          if (sp && sp.stock != null) sp.stock = r6(sp.stock + Number(a[1]));
        });
      }
      r.done = ''; r.spent = ''; r.prev = '';
    },

    /** «Завтра →»: перенести на следующий рабочий день недели. */
    cleanLater(c, id) {
      const st = state(c), t = find(st, id);
      if (t.done) throw new Error('Эта задача уже сделана.');
      const days = st.days.filter(d => !d.rest && d.day > t.day).map(d => d.day);
      if (!days.length) throw new Error('На этой неделе больше нет свободных дней. Оставьте на сегодня или отметьте сделанной.');
      pinAll(c, st);
      const r = rowOf(c, st.week, id);
      r.day = days[0]; r.moved = true;
    },

    /** Комнаты и наборы: rooms [{id?, name, type}]; settings — необязательно. Переносы текущей недели сбрасываются. */
    saveCleanRooms(c, rooms, settings) {
      const a = Array.isArray(rooms) ? rooms : [];
      if (a.length > MAX_ROOMS) throw new Error('Комнат может быть не больше ' + MAX_ROOMS + '.');
      const used = {};
      c.rooms = a.map((r, i) => {
        let id = String(r.id || '').trim();
        if (!id || used[id]) id = newId();
        used[id] = 1;
        const name = String(r.name || '').trim().slice(0, 40) || ('Комната ' + (i + 1));
        return { id, name, type: ROOM_TYPES[r.type] ? r.type : 'bedroom' };
      });
      c.settings = cleanSettings(Object.assign({}, c.settings, settingsPatch(settings), { ready: true }));
      resetMoves(c, mondayOf(todayFn()));
    },

    saveCleanSettings(c, p) {
      c.settings = cleanSettings(Object.assign({}, c.settings, settingsPatch(p)));
      resetMoves(c, mondayOf(todayFn()));
    },

    /** g: {id, on?, months?, last?}. */
    saveGeneral(c, g) {
      const x = c.generals.find(y => y.id === g.id);
      if (!x) throw new Error('Такой генеральной задачи нет.');
      if (g.on !== undefined) x.on = !!g.on;
      if (g.months !== undefined) {
        const m = Number(g.months);
        if ([1, 2, 3].indexOf(m) < 0) throw new Error('Раз в 1, 2 или 3 месяца.');
        x.months = m;
      }
      if (g.last !== undefined) {
        const d = String(g.last || '').slice(0, 10);
        if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('Дата: год-месяц-день.');
        x.last = d;
      }
    },

    /** s: {id?, name, unit, stock ('' — не следить), min, kind, per}. */
    saveSupply(c, s) {
      const name = String(s.name || '').trim();
      if (!name) throw new Error('Напишите название.');
      const kind = KINDS.indexOf(String(s.kind || '')) >= 0 ? String(s.kind || '') : '';
      const stock = s.stock === '' || s.stock == null ? null : num(s.stock);
      const unit = UNITS.indexOf(String(s.unit)) >= 0 ? String(s.unit) : 'МЛ';
      const row = { id: String(s.id || ''), name, unit, stock, min: num(s.min), kind, per: num(s.per) };
      const i = c.supplies.findIndex(x => x.id === row.id);
      if (i >= 0) c.supplies[i] = row; else { row.id = newId(); c.supplies.push(row); }
    },

    deleteSupply(c, id) {
      c.supplies = c.supplies.filter(x => x.id !== id);
    },

    /** Купили: прибавить к остатку (если не следили — начинаем следить с этого количества). */
    restockSupply(c, id, qty) {
      const sp = c.supplies.find(x => x.id === id);
      if (!sp) throw new Error('Такого расходника нет.');
      const q = num(qty);
      if (!(q > 0)) throw new Error('Сколько купили?');
      sp.stock = r6((sp.stock || 0) + q);
    }
  };

  /** → { data, notice } (исходное data не меняется). При ошибке бросает Error по-русски. */
  function apply(name, data, args) {
    if (!A[name]) throw new Error('Неизвестное действие: ' + name);
    const c = normalize(clone(data == null ? emptyData() : data));
    const notice = A[name].apply(null, [c].concat(args || []));
    return { data: normalize(c), notice: notice || '' };
  }

  return { emptyData, normalize, state, apply, actions: Object.keys(A), fmtQ };
}

return { create, ROOM_TYPES, DEF_CLEAN, MAX_ROOMS, CLEAN_SUPPLIES, CLEAN_TPL, CLEAN_GEN, mondayOf, dayIdxOf, daysBetween };
});
