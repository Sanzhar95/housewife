'use strict';
// Пара «эталон (Code.gs) + logic.js» на одном начальном состоянии, с общими seed, ID и часами.
const assert = require('node:assert');
const det = require('./det');
const { createOracle } = require('../oracle/gs-runner');
const Logic = require('../../public/logic.js');

const strip = v => JSON.parse(JSON.stringify(v, (k, x) => (k === '_new' ? undefined : x)));

function makePair(sheets, opts) {
  opts = opts || {};
  const seed = opts.seed || 1, startId = opts.startId || 1;
  const clock = det.clock(opts.now);
  const oracle = createOracle(sheets, { seed, startId, clock });
  const logic = Logic.create({ rng: det.rng(seed), id: det.idGen(startId), now: clock.now, today: clock.today });
  let S = oracle.getState();
  const pair = {
    oracle, logic, clock,
    get state() { return S; },
    /** Выполнить действие в обоих мирах и сравнить. Возвращает { error } или { state }. */
    step(name, ...args) {
      const o = oracle.call(name, ...args);
      let l;
      try { l = { state: logic.apply(name, S, args) }; } catch (e) { l = { error: e.message }; }
      const label = name + '(' + JSON.stringify(args) + ')';
      if (o.error !== undefined || l.error !== undefined) {
        assert.strictEqual(l.error, o.error, label + ': ошибка должна совпасть');
        const after = oracle.getState();
        pair.partial = JSON.stringify(strip(after)) !== JSON.stringify(strip(S));   // Apps Script мог сохранить часть до сбоя
        S = after;
        return { error: o.error };
      }
      assert.deepStrictEqual(strip(l.state), o.state, label + ': состояние должно совпасть');
      S = l.state;
      return { state: l.state };
    },
    check() { assert.deepStrictEqual(strip(S), oracle.getState(), 'итоговое состояние'); }
  };
  return pair;
}

module.exports = { makePair, strip };
