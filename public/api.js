/**
 * API клиента: те же имена, что раньше вызывал google.script.run (call('имя', …) / act('имя', …)).
 * Каждое действие возвращает Promise<состояние>; ошибки — с русским текстом.
 *
 *   const API = ApiFactory.create({ db, logic, exportXlsx });
 */
(function (root, factory) {
  const F = factory();
  if (typeof module === 'object' && module.exports) module.exports = F;
  else root.ApiFactory = F;
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

function create(deps) {
  const db = deps.db;
  const isOptimistic = deps.optimistic || (() => true);
  const api = {};

  deps.logic.actions.forEach(function (name) {
    if (name === 'getState') return;
    api[name] = async function () {
      const r = db.run(name, Array.prototype.slice.call(arguments));
      return isOptimistic() ? r.optimistic : r.done;
    };
  });

  api.getState = async function () { return db.getView() || db.load(); };
  api.exportXlsx = async function () {
    if (!deps.exportXlsx) throw new Error('Выгрузка в Excel пока недоступна.');
    return deps.exportXlsx.apply(null, arguments);
  };
  return api;
}

return { create };
});
