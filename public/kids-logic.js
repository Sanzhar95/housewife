/**
 * Домашний помощник: модуль «Дети» (предметная логика в браузере, чистые функции).
 *
 * Задача: вечером за 10 секунд увидеть, что у детей завтра, кто отвозит и что собрать.
 * Только организация и напоминания — никаких медицинских советов.
 *
 *   data = { ready, kids:[{id,name,emo,kind:'school'|'kg'|''}],
 *            acts:[{id,kid,name,emo,days:[1–7],time:'HH:MM'|'',place,driver,bring:[строки]}],   — регулярные занятия
 *            events:[{id,kid,date:'yyyy-MM-dd',time,name,type,bring:[],driver,remind:дней}],      — разовые события
 *            packed:{ 'yyyy-MM-dd': ['a:<id>'|'e:<id>'] },                                          — «✓ Собрано» (факты)
 *            people:['Я','Муж', …] }                                                                — «Кто отвозит»
 *   День рождения (type 'bday') повторяется каждый год. Отметки «Собрано» старше 30 дней удаляются сами.
 *
 * KidsLogic.create({ id, now, today }):
 *   id() — новый ID; now() — 'yyyy-MM-dd HH:mm' (Алматы); today() — 'yyyy-MM-dd'.
 *   .emptyData() · .normalize(data) · .state(data) · .apply(имя, data, [аргументы]) → { data, notice }
 * Кухню и уборку модуль не затрагивает.
 */
(function (root, factory) {
  const L = factory();
  if (typeof module === 'object' && module.exports) module.exports = L;
  else root.KidsLogic = L;
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

const KINDS = ['school', 'kg', ''];
const KIND_LBL = { school: 'Школа', kg: 'Садик', '': '' };
const KID_EMO = ['👧', '👦', '🧒', '👶', '🧑'];
const DEF_PEOPLE = ['Я', 'Муж'];
const KEEP_PACKED_DAYS = 30;
const EVENING_HOUR = 18;
const MAX_KIDS = 8;

/** Шаблоны занятий: [id, эмодзи, название, дни, время, что взять, для кого (school/kg/'' — всем)]. */
const TEMPLATES = [
  ['school', '🏫', 'Школа', [1, 2, 3, 4, 5], '08:00', ['Рюкзак', 'Сменка', 'Перекус', 'Вода'], 'school'],
  ['kg', '🧸', 'Садик', [1, 2, 3, 4, 5], '08:00', ['Сменная одежда', 'Сменная обувь'], 'kg'],
  ['pool', '🏊', 'Бассейн', [2, 4], '17:00', ['Шапочка', 'Очки', 'Полотенце', 'Сланцы', 'Купальник / плавки', 'Шампунь'], ''],
  ['dance', '💃', 'Танцы', [1, 3], '17:00', ['Форма', 'Чешки', 'Вода'], ''],
  ['football', '⚽', 'Футбол', [2, 4], '18:00', ['Форма', 'Бутсы', 'Щитки', 'Вода'], ''],
  ['english', '🔤', 'Английский', [2, 5], '16:00', ['Тетрадь', 'Учебник', 'Ручка'], ''],
  ['art', '🎨', 'Рисование', [3], '16:00', ['Альбом', 'Краски', 'Фартук'], '']
].map(a => ({ id: a[0], emo: a[1], name: a[2], days: a[3], time: a[4], bring: a[5], for: a[6] }));

/** Виды событий: id → [эмодзи, название, напомнить за N дней]. */
const EVENT_TYPES = {
  doctor: ['🩺', 'Врач', 1],
  meeting: ['🏫', 'Собрание', 1],
  party: ['🎉', 'Утренник / праздник', 2],
  bday: ['🎂', 'День рождения', 7],
  other: ['📌', 'Другое', 1]
};

const DAYN = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const str = v => (v == null ? '' : String(v));
const trim = (v, n) => str(v).trim().slice(0, n || 80);
const clone = o => JSON.parse(JSON.stringify(o));
const pad2 = n => (n < 10 ? '0' : '') + n;
const utc = s => { const x = s.split('-').map(Number); return Date.UTC(x[0], x[1] - 1, x[2]); };
const fmtDate = ms => { const d = new Date(ms); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); };
const addDays = (s, n) => fmtDate(utc(s) + n * 86400000);
const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
const dayIdxOf = s => ((new Date(utc(s)).getUTCDay() + 6) % 7) + 1;
const mondayOf = s => addDays(s, 1 - dayIdxOf(s));
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(str(s)) && fmtDate(utc(str(s))) === str(s);

/** '8:5' / '08:05' / '' → 'HH:MM' или ''. Неверное — ''. */
function normTime(v) {
  const m = str(v).trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return '';
  const hh = Number(m[1]), mm = Number(m[2]);
  return hh < 24 && mm < 60 ? pad2(hh) + ':' + pad2(mm) : '';
}
function normDays(v) {
  const out = [];
  (Array.isArray(v) ? v : []).forEach(d => { d = Number(d); if (d >= 1 && d <= 7 && out.indexOf(d) < 0) out.push(d); });
  return out.sort((a, b) => a - b);
}
function normBring(v) {
  const list = Array.isArray(v) ? v : str(v).split(/[\n,;]/);
  const out = [];
  list.forEach(x => { x = trim(x, 60); if (x && out.indexOf(x) < 0 && out.length < 30) out.push(x); });
  return out;
}
/** Ближайшая дата дня рождения, начиная с from (29 февраля в невисокосный год — 28-го). */
function nextBday(date, from) {
  const md = date.slice(5);
  for (let y = Number(from.slice(0, 4)); ; y++) {
    let d = y + '-' + md;
    if (md === '02-29' && !isDate(d)) d = y + '-02-28';
    if (!isDate(d)) d = y + '-02-28';
    if (d >= from) return d;
  }
}

function create(env) {
  const newId = () => str(env.id());
  const today = () => str(env.today()).slice(0, 10);

  function emptyData() {
    return { ready: false, kids: [], acts: [], events: [], packed: {}, people: DEF_PEOPLE.slice() };
  }

  function normalize(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const kids = (Array.isArray(r.kids) ? r.kids : []).filter(k => k && k.id && trim(k.name)).map((k, i) => ({
      id: str(k.id), name: trim(k.name, 40), emo: trim(k.emo, 8) || KID_EMO[i % KID_EMO.length],
      kind: KINDS.indexOf(str(k.kind)) >= 0 ? str(k.kind) : ''
    }));
    const kidIds = kids.map(k => k.id);
    const acts = (Array.isArray(r.acts) ? r.acts : []).filter(a => a && a.id && trim(a.name)).map(a => ({
      id: str(a.id), kid: kidIds.indexOf(str(a.kid)) >= 0 ? str(a.kid) : '', name: trim(a.name, 60), emo: trim(a.emo, 8) || '📌',
      days: normDays(a.days), time: normTime(a.time), place: trim(a.place, 80), driver: trim(a.driver, 30), bring: normBring(a.bring)
    }));
    const events = (Array.isArray(r.events) ? r.events : []).filter(e => e && e.id && trim(e.name) && isDate(e.date)).map(e => {
      const type = EVENT_TYPES[str(e.type)] ? str(e.type) : 'other';
      const rem = Number(e.remind);
      return {
        id: str(e.id), kid: kidIds.indexOf(str(e.kid)) >= 0 ? str(e.kid) : '', date: str(e.date), time: normTime(e.time),
        name: trim(e.name, 80), type, bring: normBring(e.bring), driver: trim(e.driver, 30),
        remind: rem >= 0 && rem <= 30 ? Math.round(rem) : EVENT_TYPES[type][2]
      };
    });
    const people = [];
    (Array.isArray(r.people) ? r.people : DEF_PEOPLE).forEach(p => { p = trim(p, 30); if (p && people.indexOf(p) < 0 && people.length < 10) people.push(p); });
    const min = addDays(today(), -KEEP_PACKED_DAYS);
    const packed = {};
    const rp = r.packed && typeof r.packed === 'object' ? r.packed : {};
    Object.keys(rp).sort().forEach(d => {
      if (!isDate(d) || d < min || !Array.isArray(rp[d])) return;
      const keys = [];
      rp[d].forEach(k => { k = str(k); if (/^[ae]:/.test(k) && keys.indexOf(k) < 0) keys.push(k); });
      if (keys.length) packed[d] = keys;
    });
    return { ready: !!r.ready, kids, acts, events, packed, people: people.length ? people : DEF_PEOPLE.slice() };
  }

  /** Дела на дату: занятия этого дня недели + события на эту дату, по времени. */
  function itemsOn(c, date) {
    const kidOf = id => c.kids.find(k => k.id === id) || null;
    const di = dayIdxOf(date);
    const done = c.packed[date] || [];
    const out = [];
    c.acts.forEach(a => {
      if (a.days.indexOf(di) < 0) return;
      const k = kidOf(a.kid), key = 'a:' + a.id;
      out.push({ key, kind: 'act', id: a.id, date, kid: a.kid, kidName: k ? k.name : '', kidEmo: k ? k.emo : '', name: a.name, emo: a.emo,
        time: a.time, place: a.place, driver: a.driver, bring: a.bring, packed: done.indexOf(key) >= 0 });
    });
    c.events.forEach(e => {
      const on = e.type === 'bday' ? nextBday(e.date, date) === date : e.date === date;
      if (!on) return;
      const k = kidOf(e.kid), key = 'e:' + e.id;
      out.push({ key, kind: 'event', id: e.id, date, kid: e.kid, kidName: k ? k.name : '', kidEmo: k ? k.emo : '', name: e.name,
        emo: EVENT_TYPES[e.type][0], type: e.type, time: e.time, place: '', driver: e.driver, bring: e.bring, packed: done.indexOf(key) >= 0 });
    });
    return out.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.kidName.localeCompare(b.kidName) || a.name.localeCompare(b.name));
  }

  /** События от сегодня и дальше (дни рождения — ближайшая дата), с «через N дней». */
  function upcoming(c, t) {
    return c.events.map(e => {
      const date = e.type === 'bday' ? nextBday(e.date, t) : e.date;
      const k = c.kids.find(x => x.id === e.kid);
      return Object.assign({}, e, { when: date, in: daysBetween(t, date), emo: EVENT_TYPES[e.type][0], typeName: EVENT_TYPES[e.type][1],
        kidName: k ? k.name : '', kidEmo: k ? k.emo : '' });
    }).filter(e => e.in >= 0).sort((a, b) => a.when.localeCompare(b.when) || (a.time || '99').localeCompare(b.time || '99'));
  }

  /**
   * Баннер: после 18:00 — что собрать на завтра; днём — несобранное на сегодня (ещё не начавшееся).
   * Плюс события, о которых пора напомнить (кроме тех, что уже в списке дня). null — напоминать не о чем.
   */
  function banner(c, t, hhmm, soon) {
    const evening = Number(hhmm.slice(0, 2)) >= EVENING_HOUR;
    const date = evening ? addDays(t, 1) : t;
    const items = itemsOn(c, date).filter(i => !i.packed && (evening || !i.time || i.time >= hhmm));
    const shown = items.map(i => i.key);
    const remind = soon.filter(e => e.in <= e.remind && e.in > (evening ? 1 : 0) && shown.indexOf('e:' + e.id) < 0);
    if (!items.length && !remind.length) return null;
    return { evening, date, items, remind };
  }

  function state(raw) {
    const c = normalize(raw);
    const t = today();
    const hhmm = str(env.now()).slice(11, 16) || '00:00';
    const mon = mondayOf(t);
    const week = [1, 2, 3, 4, 5, 6, 7].map(d => { const date = addDays(mon, d - 1); return { day: d, date, items: itemsOn(c, date) }; });
    const soon = upcoming(c, t);
    const kids = c.kids.map(k => Object.assign({}, k, { kindName: KIND_LBL[k.kind], acts: c.acts.filter(a => a.kid === k.id).length }));
    return {
      ready: c.ready, kids, acts: c.acts, events: c.events, people: c.people,
      today: t, tomorrow: addDays(t, 1), todayIdx: dayIdxOf(t), time: hhmm, monday: mon,
      todayItems: itemsOn(c, t), tomorrowItems: itemsOn(c, addDays(t, 1)), week,
      upcoming: soon, banner: banner(c, t, hhmm, soon),
      templates: TEMPLATES, eventTypes: EVENT_TYPES
    };
  }

  const kidOk = (c, id) => { if (str(id) && !c.kids.some(k => k.id === str(id))) throw new Error('Такого ребёнка нет.'); };
  const keyOk = (c, key) => {
    const m = str(key).match(/^([ae]):(.+)$/);
    if (!m || !(m[1] === 'a' ? c.acts : c.events).some(x => x.id === m[2])) throw new Error('Такого занятия нет. Обновите страницу.');
  };
  const addPerson = (c, p) => { if (p && c.people.indexOf(p) < 0 && c.people.length < 10) c.people.push(p); };

  const A = {
    /**
     * Первый запуск: kids [{name, emo, kind}], picks [{kid: номер ребёнка в списке, tpl: id шаблона}].
     * Можно вызвать повторно (добавит детей и занятия), ready станет true.
     */
    setup(c, kids, picks) {
      const list = (Array.isArray(kids) ? kids : []).map(k => ({ name: trim(k && k.name, 40), emo: trim(k && k.emo, 8), kind: KINDS.indexOf(str(k && k.kind)) >= 0 ? str(k.kind) : '' })).filter(k => k.name);
      if (!list.length) throw new Error('Напишите имя хотя бы одного ребёнка.');
      if (c.kids.length + list.length > MAX_KIDS) throw new Error('Не больше ' + MAX_KIDS + ' детей.');
      const ids = list.map((k, i) => {
        const id = newId();
        c.kids.push({ id, name: k.name, emo: k.emo || KID_EMO[(c.kids.length) % KID_EMO.length], kind: k.kind });
        return id;
      });
      let n = 0;
      (Array.isArray(picks) ? picks : []).forEach(p => {
        const kid = ids[Number(p && p.kid)], tpl = TEMPLATES.find(x => x.id === str(p && p.tpl));
        if (!kid || !tpl) return;
        c.acts.push({ id: newId(), kid, name: tpl.name, emo: tpl.emo, days: tpl.days.slice(), time: tpl.time, place: '', driver: c.people[0] || '', bring: tpl.bring.slice() });
        n++;
      });
      c.ready = true;
      return n ? 'Готово! Расписание: ' + n + ' зан. Время и дни поправьте во вкладке «Дети».' : 'Готово! Добавьте занятия во вкладке «Дети».';
    },

    /** k: {id?, name, emo, kind}. */
    saveKid(c, k) {
      const name = trim(k && k.name, 40);
      if (!name) throw new Error('Напишите имя.');
      const row = { id: str(k.id), name, emo: trim(k.emo, 8) || '🧒', kind: KINDS.indexOf(str(k.kind)) >= 0 ? str(k.kind) : '' };
      const i = c.kids.findIndex(x => x.id === row.id);
      if (i >= 0) c.kids[i] = row;
      else {
        if (c.kids.length >= MAX_KIDS) throw new Error('Не больше ' + MAX_KIDS + ' детей.');
        row.id = newId(); c.kids.push(row); c.ready = true;
      }
    },

    /** Удаляет ребёнка вместе с его занятиями; события остаются «для всей семьи». */
    deleteKid(c, id) {
      if (!c.kids.some(k => k.id === id)) return;
      c.kids = c.kids.filter(k => k.id !== id);
      c.acts = c.acts.filter(a => a.kid !== id);
      c.events.forEach(e => { if (e.kid === id) e.kid = ''; });
    },

    /** a: {id?, kid, name, emo, days, time, place, driver, bring}. */
    saveAct(c, a) {
      const name = trim(a && a.name, 60);
      if (!name) throw new Error('Напишите, что за занятие.');
      const days = normDays(a.days);
      if (!days.length) throw new Error('Выберите хотя бы один день.');
      kidOk(c, a.kid);
      const row = { id: str(a.id), kid: str(a.kid), name, emo: trim(a.emo, 8) || '📌', days, time: normTime(a.time), place: trim(a.place, 80), driver: trim(a.driver, 30), bring: normBring(a.bring) };
      addPerson(c, row.driver);
      const i = c.acts.findIndex(x => x.id === row.id);
      if (i >= 0) c.acts[i] = row; else { row.id = newId(); c.acts.push(row); }
      c.ready = true;
    },

    deleteAct(c, id) {
      c.acts = c.acts.filter(a => a.id !== id);
      Object.keys(c.packed).forEach(d => { c.packed[d] = c.packed[d].filter(k => k !== 'a:' + id); });
    },

    /** e: {id?, kid, date, time, name, type, bring, driver, remind}. */
    saveEvent(c, e) {
      const name = trim(e && e.name, 80);
      if (!name) throw new Error('Напишите, что за событие.');
      if (!isDate(e.date)) throw new Error('Выберите дату.');
      kidOk(c, e.kid);
      const type = EVENT_TYPES[str(e.type)] ? str(e.type) : 'other';
      const rem = e.remind === '' || e.remind == null ? EVENT_TYPES[type][2] : Number(e.remind);
      const row = { id: str(e.id), kid: str(e.kid), date: str(e.date), time: normTime(e.time), name, type, bring: normBring(e.bring), driver: trim(e.driver, 30),
        remind: rem >= 0 && rem <= 30 ? Math.round(rem) : EVENT_TYPES[type][2] };
      if (type !== 'bday' && row.date < today()) throw new Error('Эта дата уже прошла.');
      addPerson(c, row.driver);
      const i = c.events.findIndex(x => x.id === row.id);
      if (i >= 0) c.events[i] = row; else { row.id = newId(); c.events.push(row); }
      c.ready = true;
    },

    deleteEvent(c, id) {
      c.events = c.events.filter(e => e.id !== id);
      Object.keys(c.packed).forEach(d => { c.packed[d] = c.packed[d].filter(k => k !== 'e:' + id); });
    },

    /** «✓ Собрано» / снять отметку. key: 'a:<id>' | 'e:<id>'; date — день занятия. */
    pack(c, key, date, on) {
      keyOk(c, key);
      if (!isDate(date)) throw new Error('Неверная дата.');
      const list = (c.packed[date] || []).filter(k => k !== key);
      if (on) list.push(key);
      if (list.length) c.packed[date] = list; else delete c.packed[date];
    },

    /** Список «Кто отвозит». */
    savePeople(c, list) {
      const out = [];
      (Array.isArray(list) ? list : []).forEach(p => { p = trim(p, 30); if (p && out.indexOf(p) < 0 && out.length < 10) out.push(p); });
      if (!out.length) throw new Error('Оставьте хотя бы одного человека.');
      c.people = out;
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

return { create, TEMPLATES, EVENT_TYPES, KIND_LBL, KID_EMO, DAYN, EVENING_HOUR, nextBday, normTime, mondayOf, dayIdxOf, addDays };
});
