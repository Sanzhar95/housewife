'use strict';
// Имитация функций базы get_state / apply_changes (в памяти): версия, конфликт, upsert/delete по ключам.
const MEALS = ['Завтрак', 'Обед', 'Ужин'];
const clone = x => JSON.parse(JSON.stringify(x));
const keyOf = (t, r) => (t === 'ing' ? r.dish + '|' + r.product : r.id);

function createFakeServer(initial) {
  const s = clone(initial);
  const srv = {
    version: 0, calls: [], failures: [], delay: 0,
    t: { products: s.products, dishes: s.dishes, ing: s.ing, plan: s.plan },
    settings: s.settings,
    log: s.log.slice().reverse(),                 // хронологически
    purchases: s.purchases.slice(),
    failNext(err) { srv.failures.push(err); },
    /** Изменение «с другого телефона»: применить changes без проверки версии, версия растёт. */
    external(changes) { applyChanges(srv.version, changes); },
    state() {
      const plan = srv.t.plan.slice().sort((x, y) => (x.day - y.day) || (MEALS.indexOf(x.meal) - MEALS.indexOf(y.meal)) || ((x.kind === 'main' ? 0 : 1) - (y.kind === 'main' ? 0 : 1)));
      return clone({
        products: srv.t.products, dishes: srv.t.dishes, ing: srv.t.ing, plan, settings: srv.settings,
        log: srv.log.slice(-100).reverse(), purchases: srv.purchases.slice(-3000), version: srv.version,
        me: { email: 'test@example.com', role: 'owner', household: 'h1' }
      });
    },
    async rpc(name, args) {
      srv.calls.push({ name, args: clone(args) });
      if (srv.delay) await new Promise(r => setTimeout(r, srv.delay)); else await Promise.resolve();
      if (srv.failures.length) return { data: null, error: srv.failures.shift() };
      if (name === 'get_state') return { data: srv.state(), error: null };
      if (name === 'apply_changes') {
        try { return { data: applyChanges(args.expected_version, args.changes), error: null }; }
        catch (e) { return { data: null, error: { message: e.message } }; }
      }
      return { data: null, error: { message: 'нет такой функции ' + name } };
    }
  };
  function applyChanges(expected, ch) {
    if (Number(expected) !== srv.version) throw new Error('version_conflict');
    ['products', 'dishes', 'ing', 'plan'].forEach(t => {
      const c = ch[t]; if (!c) return;
      (c.delete || []).forEach(k => {
        const kk = t === 'ing' ? k.dish + '|' + k.product : k;
        srv.t[t] = srv.t[t].filter(r => keyOf(t, r) !== kk);
      });
      (c.upsert || []).forEach(r => {
        const i = srv.t[t].findIndex(x => keyOf(t, x) === keyOf(t, r));
        if (i >= 0) srv.t[t][i] = clone(r); else srv.t[t].push(clone(r));
      });
    });
    if (ch.settings) Object.assign(srv.settings, ch.settings);
    (ch.log || []).forEach(e => srv.log.push(clone(e)));
    (ch.purchases || []).forEach(e => srv.purchases.push(clone(e)));
    srv.version += 1;
    return srv.version;
  }
  // t.* ссылаются на одни и те же массивы, поэтому после замены фильтром обновляем ссылки:
  return srv;
}

/** Каноническая форма для сравнения клиента и сервера: без пометок, версии, notice; списки отсортированы по ключу. */
function canon(st) {
  const o = JSON.parse(JSON.stringify(st, (k, v) => (k === '_new' ? undefined : v)));
  delete o.version; delete o.me; delete o.notice;
  ['products', 'dishes', 'plan'].forEach(t => o[t].sort((a, b) => (a.id < b.id ? -1 : 1)));
  o.ing.sort((a, b) => ((a.dish + a.product) < (b.dish + b.product) ? -1 : 1));
  return o;
}

module.exports = { createFakeServer, canon };
