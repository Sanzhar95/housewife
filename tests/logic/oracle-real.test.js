'use strict';
// Те же сценарии на реальной выгрузке (если задан DK_SHEETS_JSON, см. tools/xlsx-to-sheets.py).
const test = require('node:test');
const fs = require('node:fs');
const { makePair } = require('../helpers/pair');

const file = process.env.DK_SHEETS_JSON;
const sheets = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;

test('реальные данные: меню, замены, готовка, отмена, гарниры совпадают с эталоном', { skip: !file }, () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    for (const onlyAvail of [true, false]) {
      const p = makePair(sheets, { seed });
      p.step('generateWeek', { onlyAvail });
      const plan = p.state.plan.filter(i => i.kind === 'main' && !i.done);
      for (const it of plan.slice(0, 4)) {
        p.step('rerollItem', it.id, onlyAvail);
        p.step('rerollSide', it.id, onlyAvail);
        const cur = p.state.plan.find(x => x.id === it.id);
        if (cur) { p.step('cookItem', cur.id, { portions: '3' }); p.step('setSide', cur.id, ''); p.step('undoItem', cur.id); }
      }
      p.step('addItem', 7, 'Ужин', 'extra', '', onlyAvail);
      p.step('cookMeal', 1, 'Ужин', {});
      p.check();
    }
  }
});
