'use strict';
// Минимальный клиент Supabase поверх fetch (без пакетов): вход по паролю, вызов функций, подсчёт строк.
function create(url, anonKey, fetchImpl) {
  const f = fetchImpl || fetch;
  const base = String(url).replace(/\/+$/, '');
  let token = null;
  const headers = extra => Object.assign({ apikey: anonKey, 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}, extra || {});
  async function fail(r, what) {
    let msg = '';
    try { const j = await r.json(); msg = j.message || j.msg || j.error_description || JSON.stringify(j); } catch (e) { msg = r.statusText; }
    throw new Error(what + ': ' + msg);
  }
  return {
    async login(email, password) {
      const r = await f(base + '/auth/v1/token?grant_type=password', { method: 'POST', headers: headers(), body: JSON.stringify({ email, password }) });
      if (!r.ok) await fail(r, 'Не удалось войти');
      token = (await r.json()).access_token;
    },
    async rpc(name, args) {
      const r = await f(base + '/rest/v1/rpc/' + name, { method: 'POST', headers: headers(), body: JSON.stringify(args || {}) });
      if (!r.ok) await fail(r, 'Ошибка ' + name);
      return r.json();
    },
    /** Сколько строк в таблице (заголовок Content-Range при Prefer: count=exact). */
    async count(table) {
      const r = await f(base + '/rest/v1/' + table + '?select=*&limit=1', { method: 'HEAD', headers: headers({ prefer: 'count=exact' }) });
      if (!r.ok) await fail(r, 'Не удалось посчитать ' + table);
      const m = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
      if (!m) throw new Error('Нет числа строк в ответе для ' + table);
      return Number(m[1]);
    }
  };
}
module.exports = { create };
