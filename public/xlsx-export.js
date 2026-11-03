/**
 * Выгрузка в Excel прямо в браузере: минимальный генератор .xlsx (zip без сжатия + XML), без библиотек.
 * Повторяет прежнюю выгрузку из Code.gs (exportXlsx): жирная шапка с фоном #ece8fc, заполняемые столбцы
 * (opts.fill) с жёлтым заголовком #ffd970 и ячейками #fff6d1, выпадающий список единиц в столбце opts.unitCol,
 * строка «Итого» жирная без заливки и без списка, закреплены первая строка и первый столбец.
 *
 *   XlsxExport.build(rows, opts) → Uint8Array          exportXlsxLocal(имя, rows, opts) → blob-ссылка
 */
(function (root, factory) {
  const X = factory();
  if (typeof module === 'object' && module.exports) module.exports = X;
  else { root.XlsxExport = X; root.exportXlsxLocal = X.exportXlsxLocal; }
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

const UNITS = ['КГ', 'Г', 'Л', 'МЛ', 'ШТ'];
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFECE8FC"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFD970"/><bgColor indexed="64"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF6D1"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                         // 0 обычная
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +   // 1 шапка
  '<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +   // 2 шапка заполняемого столбца
  '<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1"/>' +                                            // 3 заполняемая ячейка
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                            // 4 «Итого»
  '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function sheetXml(rows, opts) {
  const data = rows.map(r => r.map(v => (v == null ? '' : v)));
  const w = Math.max.apply(null, data.map(r => r.length));
  data.forEach(r => { while (r.length < w) r.push(''); });
  const n = data.length - 1;
  const fill = (opts && opts.fill) || [];
  const hasTotal = n > 0 && String(data[n][0]).toLowerCase().indexOf('итого') === 0;

  const widths = [];
  for (let c = 0; c < w; c++) {
    let m = 0;
    data.forEach((r, i) => { const len = String(r[c]).length * (i === 0 ? 0.8 : 1); if (len > m) m = len; });
    widths.push(Math.max(8, Math.min(50, Math.ceil(m * 1.15) + 2)));
  }
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  x += '<sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>';
  x += '<sheetFormatPr defaultRowHeight="15"/>';
  x += '<cols>' + widths.map((wd, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + wd + '" customWidth="1"/>').join('') + '</cols>';
  x += '<sheetData>';
  data.forEach((row, ri) => {
    const isHead = ri === 0, isTotal = hasTotal && ri === n;
    x += '<row r="' + (ri + 1) + '">';
    row.forEach((v, ci) => {
      const ref = colName(ci + 1) + (ri + 1);
      const s = isHead ? (fill.indexOf(ci + 1) >= 0 ? 2 : 1) : isTotal ? 4 : (fill.indexOf(ci + 1) >= 0 && n > 0 ? 3 : 0);
      const st = s ? ' s="' + s + '"' : '';
      if (v === '') x += s ? '<c r="' + ref + '"' + st + '/>' : '';
      else if (typeof v === 'number' && isFinite(v)) x += '<c r="' + ref + '"' + st + '><v>' + v + '</v></c>';
      else x += '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
    });
    x += '</row>';
  });
  x += '</sheetData>';
  const last = hasTotal ? n : n + 1;                       // последняя строка данных (без «Итого»)
  if (opts && opts.unitCol && n > 0 && last >= 2) {
    const col = colName(opts.unitCol);
    x += '<dataValidations count="1"><dataValidation type="list" allowBlank="0" showErrorMessage="1" sqref="' + col + '2:' + col + last + '"><formula1>"' + UNITS.join(',') + '"</formula1></dataValidation></dataValidations>';
  }
  return x + '</worksheet>';
}

/* ───── zip без сжатия ───── */
const CRC = (function () { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
const utf8 = s => new TextEncoder().encode(s);

function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  files.forEach(f => {
    const name = utf8(f.name), data = typeof f.data === 'string' ? utf8(f.data) : f.data, crc = crc32(data);
    const head = [0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0x21, 0, 0].concat(u32(crc), u32(data.length), u32(data.length), u16(name.length), [0, 0]);   // флаг 0x0800 — имена в UTF-8; дата 1980-01-01
    parts.push(Uint8Array.from(head), name, data);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0x21, 0].concat(u32(crc), u32(data.length), u32(data.length), u16(name.length), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], u32(offset))), name);
    offset += head.length + name.length + data.length;
  });
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, 0, 0, 0, 0].concat(u16(files.length), u16(files.length), u32(cdSize), u32(offset), [0, 0]));
  const all = parts.concat(central, [end]);
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0; all.forEach(p => { out.set(p, o); o += p.length; });
  return out;
}

function build(rows, opts) {
  if (!rows || !rows.length) throw new Error('Нет данных для выгрузки.');
  const NS = 'http://schemas.openxmlformats.org/';
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="' + NS + 'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS + 'package/2006/relationships"><Relationship Id="rId1" Type="' + NS + 'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + NS + 'spreadsheetml/2006/main" xmlns:r="' + NS + 'officeDocument/2006/relationships"><sheets><sheet name="Лист1" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + NS + 'package/2006/relationships"><Relationship Id="rId1" Type="' + NS + 'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="' + NS + 'officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml(rows, opts) }
  ]);
}

/** Для кнопок «Скачать список покупок / бланк»: имя файла задаёт ссылка (download), здесь только содержимое. */
async function exportXlsxLocal(name, rows, opts) {
  return URL.createObjectURL(new Blob([build(rows, opts)], { type: MIME }));
}

return { build, exportXlsxLocal, crc32, MIME };
});
