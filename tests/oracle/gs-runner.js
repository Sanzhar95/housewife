'use strict';
// Запускает настоящий apps-script/Code.gs в Node на имитации таблицы. Это «эталон» для сравнения с logic.js.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const det = require('../helpers/det');
const { createEnv } = require('./sheets-mock');

const CODE = fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script', 'Code.gs'), 'utf8');

/**
 * sheets: { 'Продукты': [[шапка], [строка]...], ... } (как в tests/fixtures/sheets.synthetic.json)
 * opts: { seed, clock (det.clock), startId }
 */
function createOracle(sheets, opts) {
  opts = opts || {};
  const clock = opts.clock || det.clock();
  const env = createEnv(det.fmtDate);
  Object.keys(sheets).forEach(name => {
    const sh = env.ss.insertSheet(name);
    sheets[name].forEach((row, i) => row.forEach((v, j) => { if (v !== '' && v != null) sh._set(i + 1, j + 1, v); }));
  });
  const nextId = det.idGen(opts.startId);
  const random = det.rng(opts.seed || 1);
  const ctx = vm.createContext(Object.assign({}, env.globals, {
    console,
    __random: random,
    __uuid: () => nextId() + '-0000-4000-8000-000000000000',
    __clock: clock
  }));
  vm.runInContext(`
    Math.random = __random;
    Utilities.getUuid = __uuid;
    (function () {
      const Real = Date;
      globalThis.Date = class extends Real {
        constructor(...a) { if (a.length) super(...a); else super(__clock.t.getTime()); }
        static now() { return __clock.t.getTime(); }
      };
    })();
  `, ctx);
  vm.runInContext(CODE, ctx, { filename: 'Code.gs' });

  function call(fn, ...args) {
    ctx.__args = args;
    const r = vm.runInContext(
      `(() => { try { const v = ${fn}(...__args); return { ok: v === undefined ? null : JSON.stringify(v) }; } catch (e) { return { err: String(e && e.message) }; } })()`, ctx);
    ctx.__args = null;
    if (r.err !== undefined) return { error: r.err };
    return { state: r.ok === null ? null : JSON.parse(r.ok) };
  }
  return { call, getState: () => call('getState').state, ss: env.ss, mail: env.sent, clock };
}

module.exports = { createOracle };
