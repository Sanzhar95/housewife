/**
 * Домашний помощник: модуль «Уборка» (предметная логика в браузере).
 *
 * Схема (по просьбе заказчицы, 2026-11-10): приложение даёт готовый СПИСОК ДЕЛ по зонам, хозяйка только
 * отмечает свои. У дней недели — темы (Пн стирка, Вт комнаты, Ср кухня, Чт ванная и туалет, Пт мелочи,
 * Сб выходной, Вс глажка). Дела без своего дня раскладываются СЛУЧАЙНО (поровну по времени) по свободным
 * дням; «🎲 Перемешать» даёт другой вариант. Режим «Всё вперемешку» раскладывает случайно все дела.
 * Из Code.gs без изменений: генеральные дела, расходники, «Готово / Отменить / Завтра», закрепление дел
 * после действия, «Быстрая уборка», тексты ошибок.
 *
 *   data = { settings{mode,rest,remind,ready}, picks:[{id,on,min,times,day}], seeds:{неделя:n},
 *            rows:[{week,id,day,moved,done,spent,prev}], generals:[{id,on,months,last}],
 *            supplies:[{id,name,unit,stock|null,min,kind,per}], rooms:[…] (от прежней версии, хранится как есть) }
 *
 * CleanLogic.create({ id, now, today }):
 *   id() — новый ID (8 символов); now() — 'yyyy-MM-dd HH:mm'; today() — 'yyyy-MM-dd'.
 *   .emptyData() · .normalize(data) · .state(data) · .apply(имя, data, [аргументы]) → { data, notice }
 * План недели НЕ хранится: он считается заново из выбранных дел, настроек и «зерна» недели.
 * Кухню модуль не затрагивает: ни её данных, ни её логики.
 */
(function (root, factory) {
  const L = factory();
  if (typeof module === 'object' && module.exports) module.exports = L;
  else root.CleanLogic = L;
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

const UNITS = ['КГ', 'Г', 'Л', 'МЛ', 'ШТ'];
const MODES = ['themes', 'mix'];
const DEF_CLEAN = { mode: 'themes', rest: [6], remind: true, ready: false };
const MINUTES = [10, 15, 20, 25, 30, 45, 60];
/** Типовые расходники: [название, ед., вид уборки, расход за раз]. */
const CLEAN_SUPPLIES = [
  ['Средство для полов', 'МЛ', 'floor', 40],
  ['Средство для кухни (антижир)', 'МЛ', 'kitchen', 30],
  ['Средство для ванной', 'МЛ', 'bath', 60],
  ['Средство для туалета', 'МЛ', 'wc', 50],
  ['Спрей от пыли', 'МЛ', 'dust', 15]
];
/** Зоны списка дел: [id, эмодзи, название]. */
const ZONES = [['rooms', '🛋️', 'Комнаты'], ['kitchen', '🍳', 'Кухня'], ['bath', '🛁', 'Ванная и туалет'], ['laundry', '👕', 'Стирка и вещи'], ['other', '🏠', 'Прочее']];
/** Список дел: [id, зона, эмодзи, название, что входит, минут, раз в неделю, день-тема (0 — любой), выбрано сразу, расходник]. */
const CATALOG = [
  ['vac', 'rooms', '🧹', 'Пылесос', 'Все комнаты и ковры', 30, 1, 2, 1, ''],
  ['dust', 'rooms', '🪶', 'Протереть пыль', 'Полки, техника, подоконники', 20, 1, 2, 1, 'dust'],
  ['floor', 'rooms', '🧽', 'Помыть полы', 'Влажная уборка во всех комнатах', 30, 1, 2, 1, 'floor'],
  ['bed', 'rooms', '🛏️', 'Сменить постельное', 'Снять, застелить свежее', 15, 1, 0, 0, ''],
  ['tidy', 'rooms', '🧺', 'Разобрать вещи', 'Всё по местам', 15, 1, 0, 1, ''],
  ['stove', 'kitchen', '🔥', 'Плита (газ)', 'Решётки, конфорки, ручки', 30, 1, 3, 1, 'kitchen'],
  ['cab', 'kitchen', '🗄️', 'Шкафы и полки', 'Фасады, полки, ручки', 30, 1, 3, 1, 'kitchen'],
  ['counter', 'kitchen', '🧴', 'Столешницы и раковина', 'Протереть, отмыть раковину', 15, 1, 0, 1, ''],
  ['fridge', 'kitchen', '🧊', 'Холодильник', 'Полки внутри, выбросить лишнее', 30, 1, 0, 0, ''],
  ['shower', 'bath', '🚿', 'Душевая / ванна', 'Стенки, кран, слив, пол', 30, 1, 4, 1, 'bath'],
  ['wc', 'bath', '🚽', 'Туалет', 'Унитаз, пол, дезинфекция', 15, 1, 4, 1, 'wc'],
  ['mirror', 'bath', '🪞', 'Раковина и зеркало', 'Отмыть налёт, протереть', 10, 1, 0, 1, ''],
  ['wash', 'laundry', '🫧', 'Стирка', 'Загрузить, развесить', 30, 1, 1, 1, ''],
  ['iron', 'laundry', '👔', 'Глажка', 'Погладить и разложить', 25, 1, 7, 1, ''],
  ['hall', 'other', '👟', 'Коридор и обувь', 'Пол, обувь, зеркало', 15, 1, 0, 1, ''],
  ['glass', 'other', '🪟', 'Стёкла и зеркала', 'Двери, зеркала, стекло', 20, 1, 0, 0, ''],
  ['plants', 'other', '🪴', 'Полить цветы', 'Все цветы в доме', 10, 1, 0, 1, ''],
  ['trash', 'other', '🗑️', 'Мусор и ведро', 'Вынести, помыть ведро', 10, 1, 0, 0, '']
].map(a => ({ id: a[0], zone: a[1], emo: a[2], name: a[3], sub: a[4], min: a[5], times: a[6], day: a[7], on: !!a[8], k: a[9] }));
/** Темы дней (режим «По дням-темам»). */
const THEMES = { 1: ['👕', 'Стирка'], 2: ['🛋️', 'Комнаты: сухая и влажная уборка'], 3: ['🍳', 'Кухня'], 4: ['🚿', 'Ванная и туалет'], 5: ['✨', 'Мелочи по дому'], 6: ['🌿', 'Выходной'], 7: ['👔', 'Глажка'] };
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
const clone = o => JSON.parse(JSON.stringify(o));

/** Случайные числа с «зерном»: одна и та же неделя и то же зерно — одна и та же раскладка. */
function rng(text) {
  let a = 2166136261;
  for (let i = 0; i < text.length; i++) { a ^= text.charCodeAt(i); a = Math.imul(a, 16777619); }
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cleanSettings(o) {
  o = o && typeof o === 'object' ? o : {};
  const s = { mode: MODES.indexOf(o.mode) >= 0 ? o.mode : DEF_CLEAN.mode, rest: o.rest, remind: o.remind === undefined ? true : !!o.remind, ready: !!o.ready };
  s.rest = (Array.isArray(s.rest) ? s.rest : DEF_CLEAN.rest).map(Number).filter((d, i, a) => d >= 1 && d <= 7 && a.indexOf(d) === i).sort();
  if (s.rest.length >= 7) s.rest = [6];
  return s;
}

function settingsPatch(p) {
  const o = {};
  if (!p) return o;
  if (p.mode !== undefined) o.mode = p.mode;
  if (p.rest !== undefined) o.rest = p.rest;
  if (p.remind !== undefined) o.remind = !!p.remind;
  return o;
}

function pickNorm(p, base) {
  const min = Math.round(Number(p.min));
  const times = Math.round(Number(p.times));
  const day = Math.round(Number(p.day));
  return {
    id: base.id,
    on: p.on === undefined ? base.on : !!p.on,
    min: min >= 5 && min <= 180 ? min : base.min,
    times: times >= 1 && times <= 3 ? times : base.times,
    day: day >= 0 && day <= 7 && p.day !== undefined && p.day !== null && p.day !== '' ? day : base.day
  };
}

/** Недельные дела из выбранных (без дней). fixed — день-тема (только в режиме «По дням-темам»). */
function cleanTasks(c) {
  const s = c.settings, list = [];
  c.picks.filter(p => p.on).forEach(p => {
    const t = CATALOG.find(x => x.id === p.id);
    for (let i = 1; i <= p.times; i++) {
      list.push({ id: p.id + '.' + i, group: p.id, zone: t.zone, emo: t.emo, title: t.name, sub: t.sub, k: t.k, min: p.min,
        fixed: s.mode === 'themes' && i === 1 && p.day && s.rest.indexOf(p.day) < 0 ? p.day : 0, gen: false });
    }
  });
  return list;
}

/**
 * Раскладка: закреплённые (сделанные/перенесённые) стоят где стоят; дела со своим днём — в свой день;
 * остальные — случайно по рабочим дням, поровну по времени. Повтор того же дела в соседний день — штраф.
 */
function cleanSchedule(tasks, days, pins, rand) {
  const load = {}, placed = {}, byGroup = {};
  days.forEach(d => { load[d] = 0; });
  const put = (t, d) => { placed[t.id] = d; load[d] = (load[d] || 0) + t.min; (byGroup[t.group] = byGroup[t.group] || []).push(d); };
  tasks.filter(t => pins[t.id]).forEach(t => put(t, pins[t.id]));
  tasks.filter(t => !pins[t.id] && t.fixed).forEach(t => put(t, t.fixed));
  const free = tasks.filter(t => !pins[t.id] && !t.fixed);
  for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const x = free[i]; free[i] = free[j]; free[j] = x; }
  free.sort((a, b) => b.min - a.min);   // крупные первыми — так дни выходят ровнее; равные — в случайном порядке
  free.forEach(t => {
    let best = days[0], bestCost = Infinity;
    days.forEach(d => {
      let cost = load[d] || 0;
      (byGroup[t.group] || []).forEach(o => { if (o === d) cost += 1000; else if (Math.abs(o - d) < 2) cost += 300; });
      cost += rand() * 10;
      if (cost < bestCost) { bestCost = cost; best = d; }
    });
    put(t, best);
  });
  return placed;
}

function create(env) {
  const newId = env.id, nowStr = env.now, todayFn = env.today;

  function emptyData() {
    return normalize({
      settings: DEF_CLEAN, picks: null, rows: [], generals: [], seeds: {},
      supplies: CLEAN_SUPPLIES.map(x => ({ id: newId(), name: x[0], unit: x[1], stock: null, min: x[3] * 5, kind: x[2], per: x[3] }))
    });
  }

  /** Приведение к схеме. Идемпотентно; неизвестные поля отбрасываются, известные не теряются. */
  function normalize(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const hasPicks = Array.isArray(raw.picks);
    const settings = cleanSettings(raw.settings);
    // прежняя версия (комнаты) считалась «готовой» без списка дел — покажем выбор дел один раз
    if (!hasPicks) settings.ready = false;
    const given = {};
    (hasPicks ? raw.picks : []).forEach(p => { if (p && p.id) given[String(p.id)] = p; });
    const picks = CATALOG.map(t => pickNorm(given[t.id] || {}, t));
    const rooms = (Array.isArray(raw.rooms) ? raw.rooms : []).filter(r => r && r.id).map(r => ({ id: String(r.id), name: str(r.name), type: str(r.type) }));
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
    const seeds = {};
    const rs = raw.seeds && typeof raw.seeds === 'object' ? raw.seeds : {};
    Object.keys(rs).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-8).forEach(k => { seeds[k] = Math.max(0, Math.round(Number(rs[k])) || 0); });
    const out = { settings, picks, seeds, rows, generals, supplies };
    if (rooms.length) out.rooms = rooms;
    return out;
  }

  function state(raw) {
    const c = normalize(raw);
    const s = c.settings, todayS = todayFn(), week = mondayOf(todayS), today = dayIdxOf(todayS);
    const out = { ready: s.ready, settings: s, picks: c.picks, catalog: CATALOG, zones: ZONES, themes: THEMES, week, today, todayDate: todayS,
      days: [], tasks: [], general: [], supplies: [], low: [], quick: [], totalMin: 0, doneMin: 0 };
    const rowOf = {};
    c.rows.filter(r => r.week === week).forEach(r => { rowOf[r.id] = r; });
    let days = [1, 2, 3, 4, 5, 6, 7].filter(d => s.rest.indexOf(d) < 0);
    if (!days.length) days = [1, 2, 3, 4, 5, 6, 7];
    const tasks = cleanTasks(c);

    // Генеральная недели: сделанная на этой неделе остаётся; иначе — самая просроченная из «пора».
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
      tasks.push({ id: 'g:' + pick.id, group: 'g:' + pick.id, zone: 'general', emo: '⭐', title: pick.name, sub: pick.sub, k: 'general', min: pick.min, fixed: 0, gen: true });
    }

    const pins = {};
    tasks.forEach(t => { const r = rowOf[t.id]; if (r && r.day) pins[t.id] = r.day; });
    const placed = cleanSchedule(tasks, days, pins, rng(week + ':' + (c.seeds[week] || 0)));
    tasks.forEach(t => { t.day = placed[t.id]; t.rnd = !t.fixed; });

    tasks.forEach(t => {
      const r = rowOf[t.id];
      t.done = !!(r && r.done);
      t.moved = !!(r && r.moved);
      t.late = !t.done && t.day < today;
      out.totalMin += t.min;
      if (t.done) out.doneMin += t.min;
    });
    tasks.sort((a, b) => (a.day - b.day) || (!!a.rnd - !!b.rnd) || (b.min - a.min) || (a.id < b.id ? -1 : 1));
    out.tasks = tasks;
    [1, 2, 3, 4, 5, 6, 7].forEach(d => {
      const list = tasks.filter(t => t.day === d);
      out.days.push({ day: d, name: DAYN[d], rest: days.indexOf(d) < 0, min: list.reduce((a, t) => a + t.min, 0), ids: list.map(t => t.id) });
    });
    out.general = gens.map(g => ({ id: g.id, name: g.name, sub: g.sub, min: g.min, months: g.months, on: g.on, last: g.last, since: g.since, due: g.due, inPlan: g.inPlan, done: g.doneNow }));
    out.supplies = c.supplies;
    out.low = c.supplies.filter(x => x.stock != null && x.stock <= x.min);
    // «Быстрая уборка на 15 минут»: самые лёгкие невыполненные дела (сначала сегодняшние и просроченные)
    let left = 15;
    tasks.filter(t => !t.done && !t.gen)
      .sort((a, b) => (a.day > today) - (b.day > today) || a.min - b.min || (a.id < b.id ? -1 : 1)).forEach(t => {
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
            if (t.k && sp.kind === t.k && sp.per > 0 && sp.stock != null) {
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

    /** «🎲 Перемешать»: другая случайная раскладка этой недели. Сделанное остаётся на месте. */
    cleanShuffle(c) {
      const week = mondayOf(todayFn());
      c.seeds[week] = (c.seeds[week] || 0) + 1;
      resetMoves(c, week);
    },

    /** Первый выбор дел и сохранение списка: picks [{id, on, min?, times?, day?}], settings {mode, rest, remind}. */
    saveCleanPicks(c, picks, settings) {
      const given = {};
      (Array.isArray(picks) ? picks : []).forEach(p => { if (p && p.id) given[String(p.id)] = p; });
      const next = CATALOG.map(t => pickNorm(Object.assign({}, c.picks.find(p => p.id === t.id) || {}, given[t.id] || {}), t));
      if (!next.some(p => p.on)) throw new Error('Отметьте хотя бы одно дело.');
      c.picks = next;
      c.settings = cleanSettings(Object.assign({}, c.settings, settingsPatch(settings), { ready: true }));
      resetMoves(c, mondayOf(todayFn()));
    },

    /** Одно дело из шторки: {id, on?, min?, times?, day?}. */
    savePick(c, p) {
      const base = CATALOG.find(t => t.id === (p && p.id));
      if (!base) throw new Error('Такого дела нет в списке.');
      const i = c.picks.findIndex(x => x.id === base.id);
      const next = pickNorm(Object.assign({}, c.picks[i], p), base);
      if (!next.on && !c.picks.some(x => x.on && x.id !== base.id)) throw new Error('Отметьте хотя бы одно дело.');
      c.picks[i] = next;
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

  return { emptyData, normalize, state, apply, actions: Object.keys(A) };
}

return { create, DEF_CLEAN, CLEAN_SUPPLIES, CATALOG, ZONES, THEMES, MINUTES, CLEAN_GEN, mondayOf, dayIdxOf, daysBetween };
});
