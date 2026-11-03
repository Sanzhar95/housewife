/**
 * Хранилище в базе: чтение состояния, разница «было/стало», запись очередью, повтор при конфликте версий.
 *
 *   const db = DB.create({ client, logic, optimistic: () => true });
 *   await db.load();                       // get_state
 *   const { optimistic, done } = db.run('cookItem', [id, {}]);   // экран обновляем сразу, запись идёт в фоне
 *
 * client.rpc(имя, параметры) → Promise<{ data, error }> (supabase-js).
 * Форма изменений (apply_changes): { products|dishes|ing|plan: {upsert:[объекты состояния], delete:[ключи]},
 *   settings:{weekStart?, portions?, email?}, log:[{when,action,obj,details}], purchases:[{when,product,qty,unit,total,price}] }.
 * Ключ удаления: id; у состава (ing) — { dish, product }.
 */
(function (root, factory) {
  const D = factory();
  if (typeof module === 'object' && module.exports) module.exports = D;
  else root.DB = D;
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

const TABLES = ['products', 'dishes', 'ing', 'plan'];
const keyOf = (t, r) => (t === 'ing' ? r.dish + '|' + r.product : r.id);
const delKey = (t, r) => (t === 'ing' ? { dish: r.dish, product: r.product } : r.id);
const MAX_RETRIES = 5;

function clone(x) { return JSON.parse(JSON.stringify(x)); }
/** Только то, что сравнивается построчно (журнал и приходы передаются отдельно). */
function light(s) { return clone({ products: s.products, dishes: s.dishes, ing: s.ing, plan: s.plan, settings: s.settings || {} }); }

/** Разница между двумя «лёгкими» состояниями. Пусто — null. */
function diff(prev, next) {
  const out = {};
  TABLES.forEach(t => {
    const old = new Map((prev[t] || []).map(r => [keyOf(t, r), JSON.stringify(r)]));
    const upsert = [];
    const seen = new Set();
    (next[t] || []).forEach(r => {
      const k = keyOf(t, r);
      seen.add(k);
      if (old.get(k) !== JSON.stringify(r)) upsert.push(r);
    });
    const del = (prev[t] || []).filter(r => !seen.has(keyOf(t, r))).map(r => delKey(t, r));
    if (upsert.length || del.length) out[t] = { upsert, delete: del };
  });
  const a = prev.settings || {}, b = next.settings || {}, st = {};
  ['weekStart', 'portions', 'email'].forEach(k => { if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) st[k] = b[k]; });
  if (Object.keys(st).length) out.settings = st;
  return Object.keys(out).length ? out : null;
}

const countNew = list => (list || []).filter(e => e._new).length;
const unflag = e => { const o = Object.assign({}, e); delete o._new; return o; };
/** Записи, добавленные именно этим действием (по разнице числа пометок). Журнал: новые спереди; приходы: сзади. */
function newEntries(prev, next) {
  const dl = countNew(next.log) - countNew(prev.log);
  const dp = countNew(next.purchases) - countNew(prev.purchases);
  return {
    log: dl > 0 ? next.log.filter(e => e._new).slice(0, dl).reverse().map(unflag) : [],
    purchases: dp > 0 ? next.purchases.filter(e => e._new).slice(-dp).map(unflag) : []
  };
}

function cleanError(e) {
  const m = String((e && (e.message || e.error_description)) || e || '');
  const status = e && (e.status || e.code);
  if (/version_conflict/.test(m)) return 'Данные изменились на другом телефоне. Попробуйте ещё раз';
  if (/JWT|jwt|refresh_token|not authenticated|Auth session missing/i.test(m) || status === 401 || status === '401') return 'Войдите заново';
  if (/Invalid login credentials/i.test(m)) return 'Неверная почта или пароль';
  if (/Failed to fetch|NetworkError|Load failed|network|fetch|timeout|ECONN|ENOTFOUND/i.test(m)) return 'Нет связи. Попробуйте ещё раз';
  if (/[А-Яа-яЁё]/.test(m)) return m;                       // уже по-русски (ошибки логики и базы)
  return 'Не получилось сохранить. Попробуйте ещё раз';
}

function create(deps) {
  const client = deps.client, logic = deps.logic;
  const isOptimistic = deps.optimistic || (() => true);
  let base = null;           // последнее подтверждённое сервером (лёгкое состояние)
  let view = null;           // то, что показываем (с учётом очереди)
  let version = 0;
  let queue = [];
  let working = false;
  let saving = 0;
  const on = { saving: [], view: [], error: [] };
  const emit = (k, v) => on[k].forEach(cb => { try { cb(v); } catch (e) { /* слушатель не должен ломать запись */ } });
  const setSaving = d => { saving += d; emit('saving', saving); };

  async function rpc(name, args) {
    const r = await client.rpc(name, args);
    if (r.error) throw r.error;
    return r.data;
  }
  function normalize(s) {
    ['products', 'dishes', 'ing', 'plan', 'log', 'purchases'].forEach(k => { if (!Array.isArray(s[k])) s[k] = []; });
    s.settings = Object.assign({ email: '', weekStart: '', portions: 0 }, s.settings || {});
    return s;
  }
  async function loadRaw() {
    const s = normalize(await rpc('get_state', {}));
    version = Number(s.version) || 0;
    base = light(s);
    return s;
  }

  const api = {
    /** Загрузить состояние с сервера (сбрасывает показанное). */
    async load() { const s = await loadRaw(); view = clone(s); return clone(view); },
    /** Обновить при возвращении в приложение; пока идёт запись — не трогаем. */
    async refresh() { if (saving > 0 || queue.length) return null; return api.load(); },
    getView() { return view ? clone(view) : null; },
    isIdle() { return saving === 0 && !queue.length; },
    onSaving(cb) { on.saving.push(cb); },
    onView(cb) { on.view.push(cb); },
    onError(cb) { on.error.push(cb); },
    diff, cleanError,

    /** Применить действие: { optimistic: состояние сразу (null, если ждём запись), done: Promise<состояние после записи> }. */
    run(name, args) {
      if (!view) throw new Error('Данные ещё не загружены. Обновите страницу.');
      const prev = view;
      const next = logic.apply(name, prev, args || []);          // ошибка логики — сразу наружу
      const job = { name, args: args || [], before: light(prev), after: light(next), added: newEntries(prev, next), retries: 0 };
      job.done = new Promise((res, rej) => { job.resolve = res; job.reject = rej; });
      job.done.catch(() => {});                                   // чтобы отказ без слушателя не ронял программу
      view = next;
      queue.push(job);
      setSaving(1);
      pump();
      return { optimistic: isOptimistic() ? clone(next) : null, done: job.done.then(() => clone(next)) };
    }
  };

  function settle(job, err) {
    setSaving(-1);
    if (err) { emit('error', err.message); job.reject(err); } else job.resolve();
  }

  async function pump() {
    if (working) return;
    working = true;
    try {
      while (queue.length) await handle(queue[0]);
    } finally { working = false; }
  }

  async function handle(job) {
    const changes = buildChanges(job);
    if (!changes) { queue.shift(); base = job.after; settle(job); return; }
    try {
      const v = await rpc('apply_changes', { expected_version: version, changes });
      version = Number(v);
      base = job.after;
      queue.shift();
      settle(job);
    } catch (e) {
      if (/version_conflict/.test(String(e && e.message)) && ++job.retries <= MAX_RETRIES) await recover();
      else await failAll(e);
    }
  }

  function buildChanges(job) {
    const c = diff(job.before, job.after) || {};
    if (job.added.log.length) c.log = job.added.log;
    if (job.added.purchases.length) c.purchases = job.added.purchases;
    return Object.keys(c).length ? c : null;
  }

  /** Конфликт версий: берём свежие данные и повторяем те же действия по очереди. */
  async function recover() {
    let fresh;
    try { fresh = await loadRaw(); } catch (e) { return failAll(e); }
    let cur = fresh;
    const jobs = queue.slice();
    let rejected = null;
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      try {
        const n = logic.apply(j.name, cur, j.args);
        j.before = light(cur); j.after = light(n); j.added = newEntries(cur, n);
        cur = n;
      } catch (err) {                                              // повтор невозможен: это и остальные отклоняем
        rejected = { from: i, error: new Error(cleanError(err)) };
        queue = jobs.slice(0, i);
        break;
      }
    }
    view = clone(cur);
    emit('view', clone(view));                                      // сначала экран, потом сообщение об ошибке
    if (rejected) jobs.slice(rejected.from).forEach(x => settle(x, rejected.error));
  }

  /** Запись не удалась: все ожидающие отклоняются, показываем свежие (или последние подтверждённые) данные. */
  async function failAll(e) {
    const msg = new Error(cleanError(e));
    const jobs = queue;
    queue = [];
    try { view = clone(await loadRaw()); }
    catch (e2) { view = Object.assign({}, view, clone(base)); }
    emit('view', clone(view));                                      // сначала экран, потом сообщение об ошибке
    jobs.forEach(j => settle(j, msg));
  }

  return api;
}

const DB = { create, diff, cleanError };
/** Для страницы: DB.init(supabaseClient, Logic.create(env)); потом DB.run / DB.load … */
DB.OPTIMISTIC = true;
DB.init = function (client, logic) {
  const inst = create({ client, logic, optimistic: () => DB.OPTIMISTIC });
  ['load', 'refresh', 'getView', 'isIdle', 'onSaving', 'onView', 'onError', 'run'].forEach(k => { DB[k] = inst[k]; });
  return DB;
};
return DB;
});
