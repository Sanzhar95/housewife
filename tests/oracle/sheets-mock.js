'use strict';
// Имитация Google Таблицы: только то, что вызывает apps-script/Code.gs.
function a1(ref) {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref);
  const col = s => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const c1 = col(m[1]), r1 = +m[2], c2 = m[3] ? col(m[3]) : c1, r2 = m[4] ? +m[4] : r1;
  return [r1, c1, r2 - r1 + 1, c2 - c1 + 1];
}
const empty = v => v === '' || v == null;

class Sheet {
  constructor(name) { this.name = name; this.rows = []; }
  _get(r, c) { const row = this.rows[r - 1]; return row && c - 1 < row.length && row[c - 1] != null ? row[c - 1] : ''; }
  _set(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }
  getLastRow() { for (let i = this.rows.length; i > 0; i--) if (this.rows[i - 1].some(v => !empty(v))) return i; return 0; }
  getLastColumn() { let m = 0; this.rows.forEach(r => r.forEach((v, i) => { if (!empty(v)) m = Math.max(m, i + 1); })); return m; }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') [r, c, nr, nc] = a1(r);
    nr = nr || 1; nc = nc || 1;
    const sh = this;
    const rng = {
      getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(sh._get(r + i, c + j)); o.push(row); } return o; },
      getValue() { return sh._get(r, c); },
      setValues(vs) { vs.forEach((row, i) => row.forEach((v, j) => sh._set(r + i, c + j, v))); return rng; },
      setValue(v) { sh._set(r, c, v); return rng; },
      clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (sh.rows[r - 1 + i]) sh._set(r + i, c + j, ''); return rng; }
    };
    return new Proxy(rng, { get: (t, k) => (k in t ? t[k] : () => rng) });   // setFontWeight, setBackground… — пустышки
  }
  appendRow(row) { const n = this.getLastRow(); row.forEach((v, j) => this._set(n + 1, j + 1, v)); }
  insertColumnAfter(n) { this.rows.forEach(r => { if (r.length >= n) r.splice(n, 0, ''); }); }
  setName(n) { this.name = n; }
  setFrozenRows() {} setFrozenColumns() {} clear() { this.rows = []; } autoResizeColumns() {} setColumnWidth() {}
}

class Spreadsheet {
  constructor() { this.sheets = []; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
  getId() { return 'mock-ss'; }
  getSpreadsheetTimeZone() { return 'Asia/Almaty'; }
}

function chain() { const p = new Proxy({}, { get: (t, k) => (k === 'build' ? () => ({}) : () => p) }); return p; }

function createEnv(fmtDate) {
  const ss = new Spreadsheet();
  const props = {};
  const sent = [];
  return {
    ss, sent,
    globals: {
      SpreadsheetApp: {
        getActiveSpreadsheet: () => ss, openById: () => ss, create: () => new Spreadsheet(),
        getUi: () => chain(), flush() {}, newDataValidation: () => chain()
      },
      PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      MailApp: { sendEmail: (...a) => { sent.push(a); } },
      ScriptApp: chain(), HtmlService: chain(),
      Utilities: { formatDate: (d, tz, f) => fmtDate(d, f, tz) }
    }
  };
}

module.exports = { createEnv };
