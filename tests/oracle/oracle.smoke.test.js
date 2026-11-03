'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createOracle } = require('./gs-runner');

const sheets = require('../fixtures/sheets.synthetic.json');
const snapPath = path.join(__dirname, '..', 'fixtures', 'state.synthetic.snapshot.json');

test('getState на синтетической фикстуре: 12 продуктов, 8 блюд, снимок совпадает', () => {
  const st = createOracle(sheets).getState();
  assert.strictEqual(st.products.length, 12);
  assert.strictEqual(st.dishes.length, 8);
  assert.strictEqual(st.plan[2].id, '35409132');          // число из таблицы стало строкой
  if (!fs.existsSync(snapPath)) fs.writeFileSync(snapPath, JSON.stringify(st, null, 1) + '\n');
  assert.deepStrictEqual(st, JSON.parse(fs.readFileSync(snapPath, 'utf8')));
});

test('одинаковый seed даёт одинаковый generateWeek, другой seed — другой', () => {
  const run = seed => createOracle(sheets, { seed }).call('generateWeek', {}).state.plan.map(i => i.dish + '/' + i.side).join();
  assert.strictEqual(run(7), run(7));
  assert.notStrictEqual(run(7), run(8));
});

test('ошибка Code.gs возвращается как { error }', () => {
  assert.deepStrictEqual(createOracle(sheets).call('deleteProduct', 'нет-такого'), { error: 'Продукт не найден.' });
});

test('DK_XLSX: реальная выгрузка (если задана)', { skip: !process.env.DK_SHEETS_JSON }, () => {
  const st = createOracle(JSON.parse(fs.readFileSync(process.env.DK_SHEETS_JSON, 'utf8'))).getState();
  assert.strictEqual(st.products.length, 46);
  assert.strictEqual(st.dishes.length, 34);
  assert.strictEqual(st.ing.length, 152);
  assert.strictEqual(st.plan.length, 15);
});
