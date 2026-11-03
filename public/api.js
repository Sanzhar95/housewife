/* Слой связи с сервером.
   Приложение (index.html) по-прежнему вызывает google.script.run.имяФункции(...),
   а этот файл подменяет его обычным fetch к Apps Script (этап 1).
   На этапе 2 (Supabase) меняется только функция rpc() ниже. */
(function () {
  var cfg = window.APP_CONFIG || {};
  if (!cfg.API_URL) console.warn('Нет config.js: выполните «node build.js» (см. README).');

  // Функции, которые выполняются в браузере, а не на сервере.
  var LOCAL = {
    // Было: сервер создавал Google Таблицу. Стало: файл .xlsx скачивается сразу.
    exportXlsx: function (name, rows) {
      if (!window.XLSX) throw new Error('Библиотека Excel не загружена');
      var ws = Array.isArray(rows && rows[0])
        ? XLSX.utils.aoa_to_sheet(rows)
        : XLSX.utils.json_to_sheet(rows || []);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Лист1');
      XLSX.writeFile(wb, (name || 'Список') + '.xlsx');
      return '';
    }
  };

  async function rpc(fn, args) {
    if (LOCAL[fn]) return LOCAL[fn].apply(null, args);
    var res;
    try {
      res = await fetch(cfg.API_URL, {
        method: 'POST',
        // text/plain — чтобы браузер не делал preflight-запрос (Apps Script его не умеет)
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: cfg.API_TOKEN, fn: fn, args: args }),
        redirect: 'follow'
      });
    } catch (e) {
      throw new Error('Нет связи с интернетом. Попробуйте ещё раз.');
    }
    if (!res.ok) throw new Error('Сервер ответил ошибкой ' + res.status);
    var text = await res.text();
    var j;
    try { j = JSON.parse(text); }
    catch (e) {
      throw new Error('Сервер вернул не то, что ожидалось. Проверьте API_URL и доступ «Все» в развёртывании.');
    }
    if (j.error) throw new Error(j.error);
    return j.ok;
  }

  // Имитация google.script.run: .withSuccessHandler(f).withFailureHandler(g).любаяФункция(...)
  function runner(h) {
    return new Proxy({}, {
      get: function (_, name) {
        if (typeof name !== 'string' || name === 'then') return undefined;
        if (name === 'withSuccessHandler') return function (f) { return runner(Object.assign({}, h, { ok: f })); };
        if (name === 'withFailureHandler') return function (f) { return runner(Object.assign({}, h, { fail: f })); };
        if (name === 'withUserObject') return function (o) { return runner(Object.assign({}, h, { user: o })); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          rpc(name, args).then(
            function (v) { if (h.ok) h.ok(v, h.user); },
            function (e) { if (h.fail) h.fail(e, h.user); else console.error(e); }
          );
        };
      }
    });
  }

  window.rpc = function (fn) { return rpc(fn, Array.prototype.slice.call(arguments, 1)); };
  window.google = window.google || {};
  window.google.script = { run: runner({}), host: { close: function () {}, setHeight: function () {}, setWidth: function () {} } };
})();
