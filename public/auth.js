/**
 * Вход, регистрация по ссылке-приглашению, пароль, приглашение в семью.
 * Экраны рисует index.html (там живут h(), field() и стили); здесь только работа с Supabase Auth.
 *
 *   const auth = Auth.create({ client });   // client = supabase.createClient(...)
 */
(function (root, factory) {
  const A = factory();
  if (typeof module === 'object' && module.exports) module.exports = A;
  else root.Auth = A;
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

const MIN_PASSWORD = 8;
const BAD_LINK = 'Ссылка не подходит: она уже использована или устарела. Попросите новую';

/** Понятный человеку текст вместо технической ошибки Supabase. */
function mapError(e, ctx) {
  const m = String((e && (e.message || e.error_description)) || e || '');
  if (/Invalid login credentials/i.test(m)) return 'Неверная почта или пароль';
  if (/already registered|already been registered/i.test(m)) return 'Эта почта уже зарегистрирована. Нажмите «Войти»';
  if (/Password should be at least|weak_password/i.test(m)) return 'Пароль — не короче ' + MIN_PASSWORD + ' символов';
  if (/valid email|invalid.*email|email.*invalid/i.test(m)) return 'Проверьте адрес почты';
  if (/invite|Ссылка|Database error saving new user/i.test(m) && ctx === 'signup') return BAD_LINK;
  if (/JWT|refresh_token|Auth session missing|not authenticated/i.test(m) || (e && (e.status === 401))) return 'Войдите заново';
  if (/Failed to fetch|NetworkError|Load failed|network|fetch|timeout/i.test(m)) return 'Нет связи. Попробуйте ещё раз';
  if (/[А-Яа-яЁё]/.test(m)) return m;
  return 'Что-то пошло не так. Попробуйте ещё раз';
}

/** '#/join/токен' → 'токен' (иначе null). */
function parseJoinHash(hash) {
  const m = /^#\/join\/([A-Za-z0-9_-]{8,})$/.exec(String(hash || ''));
  return m ? m[1] : null;
}

const normEmail = e => String(e || '').trim().toLowerCase();

function create(deps) {
  const client = deps.client;
  const origin = deps.origin || (typeof location !== 'undefined' ? location.origin : '');

  function checkPassword(p) {
    if (String(p || '').length < MIN_PASSWORD) throw new Error('Пароль — не короче ' + MIN_PASSWORD + ' символов');
  }
  function fail(e, ctx) { throw new Error(mapError(e, ctx)); }

  const api = {
    MIN_PASSWORD,
    async getSession() {
      const r = await client.auth.getSession();
      return (r.data && r.data.session) || null;
    },
    async signIn(email, password) {
      const em = normEmail(email);
      if (!em) throw new Error('Введите почту');
      checkPassword(password);
      const r = await client.auth.signInWithPassword({ email: em, password });
      if (r.error) fail(r.error, 'signin');
      return r.data.session;
    },
    async signUp(email, password, token) {
      const em = normEmail(email);
      if (!em) throw new Error('Введите почту');
      if (!token) throw new Error(BAD_LINK);
      checkPassword(password);
      const r = await client.auth.signUp({ email: em, password, options: { data: { invite: token } } });
      if (r.error) fail(r.error, 'signup');
      if (r.data && r.data.session) return r.data.session;
      return api.signIn(em, password);                               // подтверждение почты выключено, но на всякий случай
    },
    async signOut() { await client.auth.signOut(); },
    async changePassword(newPassword) {
      checkPassword(newPassword);
      const r = await client.auth.updateUser({ password: newPassword });
      if (r.error) fail(r.error, 'password');
    },
    /** Ссылка-приглашение (только владелец семьи); токен показывается один раз. */
    async inviteLink() {
      const r = await client.rpc('create_invite', {});
      if (r.error) fail(r.error, 'invite');
      return origin + '/#/join/' + r.data;
    },
    /** Администратор проекта (только он видит «Новая семья для друга»). Ошибка сети — считаем «нет». */
    async isAdmin() {
      try { const r = await client.rpc('is_admin', {}); return !r.error && r.data === true; } catch (e) { return false; }
    },
    /** Ссылка на новую отдельную семью (только администратор); токен показывается один раз. */
    async familyInviteLink(familyName) {
      const r = await client.rpc('admin_create_family_invite', { family_name: String(familyName || '').trim() });
      if (r.error) fail(r.error, 'invite');
      return origin + '/#/join/' + r.data;
    },
    parseJoinHash,
    mapError
  };
  return api;
}

const Auth = { create, mapError, parseJoinHash, MIN_PASSWORD };
Auth.init = function (client) { Object.assign(Auth, create({ client })); return Auth; };
return Auth;
});
