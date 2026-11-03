'use strict';
// Детерминированные источники для сравнительных тестов: один и тот же код даёт oracle (Code.gs) и logic.js.
process.env.TZ = process.env.TZ || 'Asia/Almaty';

function rng(seed) {                       // mulberry32
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 8 символов, всегда начинается с буквы (чисто цифровые ID таблица превращает в числа)
function idGen(start) {
  let n = start || 1;
  return function () { return 'a' + (0x1000000 + n++).toString(16); };
}

const TZ = 'Asia/Almaty';
function parts(date, tz) {
  const f = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz || TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const o = {};
  f.formatToParts(date).forEach(p => { o[p.type] = p.value; });
  return o;
}
function fmtDate(date, fmt, tz) {
  const p = parts(date, tz);
  const d = p.year + '-' + p.month + '-' + p.day;
  return fmt === 'yyyy-MM-dd' ? d : d + ' ' + p.hour + ':' + p.minute;
}

// Общие «часы» теста: оба мира читают одно и то же время.
function clock(iso) {
  const c = { t: new Date(iso || '2026-11-03T12:00:00+05:00') };
  c.set = function (s) { c.t = new Date(s); };
  c.now = function () { return fmtDate(c.t, 'yyyy-MM-dd HH:mm'); };
  c.today = function () { return fmtDate(c.t, 'yyyy-MM-dd'); };
  return c;
}

module.exports = { rng, idGen, fmtDate, clock };
