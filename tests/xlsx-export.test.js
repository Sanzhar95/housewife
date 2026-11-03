'use strict';
// Файл из собственного генератора должен читаться настоящими программами (openpyxl и LibreOffice, если они есть).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const X = require('../public/xlsx-export.js');

const py = spawnSync('python3', ['-c', 'import openpyxl']);
const havePy = py.status === 0;

const ROWS = [
  ['Название', 'Ед.', 'Куплено', 'Сумма, ₸'],
  ['Рис', 'КГ', '', ''],
  ['Молоко «3,2%» & <ко> 🥛', 'Л', 2, 500],
  ['Итого', '', '', 500]
];

test('build: стили, список единиц, закрепление, «Итого» — читается openpyxl', { skip: !havePy }, () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xl-')), 'a.xlsx');
  fs.writeFileSync(file, X.build(ROWS, { fill: [3, 4], unitCol: 2 }));
  const script = `
import json, sys, openpyxl
ws = openpyxl.load_workbook(sys.argv[1]).active
dv = ws.data_validations.dataValidation[0]
print(json.dumps({
  'values': [[c.value for c in r] for r in ws.iter_rows()],
  'head': [ws['A1'].font.b, ws['A1'].fill.fgColor.rgb, ws['C1'].fill.fgColor.rgb, ws['C2'].fill.fgColor.rgb],
  'total': [ws['A4'].font.b, ws['C4'].fill.fgColor.rgb, ws['D4'].fill.fgColor.rgb],
  'freeze': ws.freeze_panes, 'dv': [str(dv.sqref), dv.formula1, dv.type]}, ensure_ascii=False))`;
  const r = spawnSync('python3', ['-I', '-c', script, file], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.deepStrictEqual(o.values, [['Название', 'Ед.', 'Куплено', 'Сумма, ₸'], ['Рис', 'КГ', null, null], ['Молоко «3,2%» & <ко> 🥛', 'Л', 2, 500], ['Итого', null, null, 500]]);
  assert.deepStrictEqual(o.head, [true, 'FFECE8FC', 'FFFFD970', 'FFFFF6D1']);
  assert.deepStrictEqual(o.total, [true, '00000000', '00000000']);         // «Итого»: жирная, без заливки
  assert.strictEqual(o.freeze, 'B2');
  assert.deepStrictEqual(o.dv, ['B2:B3', '"КГ,Г,Л,МЛ,ШТ"', 'list']);        // список не доходит до «Итого»
});

test('build: без «Итого» список единиц на все строки; без opts — просто таблица', { skip: !havePy }, () => {
  const rows = ROWS.slice(0, 3);
  const a = X.build(rows, { unitCol: 2 });
  assert.ok(Buffer.from(a).toString('latin1').includes('sqref="B2:B3"'));
  assert.ok(X.build(rows).length > 100);
});

test('build: пустые данные — понятная ошибка; zip начинается с PK и содержит CRC', () => {
  assert.throws(() => X.build([]), /Нет данных для выгрузки/);
  const b = X.build(ROWS, null);
  assert.strictEqual(String.fromCharCode(b[0], b[1]), 'PK');
  assert.strictEqual(X.crc32(Buffer.from('123456789')), 0xCBF43926);
});

test('LibreOffice открывает файл (если установлен)', { skip: spawnSync('which', ['soffice']).status !== 0 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-'));
  fs.writeFileSync(path.join(dir, 'a.xlsx'), X.build(ROWS, { fill: [3, 4], unitCol: 2 }));
  const r = spawnSync('soffice', ['--headless', '--convert-to', 'csv', '--outdir', dir, path.join(dir, 'a.xlsx')], { encoding: 'utf8', timeout: 120000 });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'a.csv'), 'utf8'), /"Молоко «3,2%» & <ко> 🥛",Л,2,500/);
});
