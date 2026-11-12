/**
 * Модуль «Уборка»: хранение. Читает и пишет один объект данных семьи через clean_get / clean_save (003_clean.sql).
 * Логика действий — CleanLogic.apply (чистая функция), поэтому при конфликте версий (две правки с разных
 * телефонов) действие просто применяется заново к свежим данным: ничего не теряется.
 *
 * CleanStore.create({ rpc, logic, get?, save?, format?, label? }):  rpc(имя, параметры) → Promise<данные> (бросает Error с .message).
 *   get/save — имена функций базы (по умолчанию clean_get / clean_save), format и label — для файла копии.
 *   Тот же механизм хранит модуль «Дети»: kids_get / kids_save (004_kids.sql).
 *   .load()                → Promise<state>   прочитать данные семьи (если пусто — пустой модуль, в базу не пишем)
 *   .act(имя, ...аргументы) → Promise<{state, notice}>  применить действие и записать
 *   .state()               → текущее вычисленное состояние (после load)
 *   .exportJson()          → строка JSON копии     .importJson(текст) → Promise<state>  заменить данные копией
 */
(function (root, factory) {
  const S = factory();
  if (typeof module === 'object' && module.exports) module.exports = S;
  else root.CleanStore = S;
})(typeof self !== 'undefined' ? self : globalThis, function () {
'use strict';

const MAX_RETRIES = 3;
const FORMAT = 'dk-clean';

function create(deps) {
  const rpc = deps.rpc, logic = deps.logic;
  const GET = deps.get || 'clean_get', SAVE = deps.save || 'clean_save', FMT = deps.format || FORMAT, LABEL = deps.label || '«Уборки»';
  let data = null, version = 0, queue = Promise.resolve();

  async function reload() {
    const r = await rpc(GET, {});
    version = Number(r && r.version) || 0;
    data = logic.normalize(r && r.data ? r.data : logic.emptyData());
  }
  const isConflict = e => /version_conflict/.test(String(e && e.message));
  const toState = () => logic.state(data);

  /** Очередь: действия идут строго друг за другом, чтобы версии не спорили между собой. */
  function serial(fn) {
    const p = queue.then(fn, fn);
    queue = p.catch(() => {});
    return p;
  }

  async function writeWith(make) {
    for (let attempt = 0; ; attempt++) {
      const res = make(data);
      try {
        version = Number(await rpc(SAVE, { expected_version: version, new_data: res.data }));
        data = res.data;
        return res;
      } catch (e) {
        if (isConflict(e) && attempt < MAX_RETRIES) { await reload(); continue; }
        if (isConflict(e)) throw new Error('Данные изменились на другом телефоне. Попробуйте ещё раз');
        throw e;
      }
    }
  }

  return {
    load: () => serial(async () => { await reload(); return toState(); }),
    state: () => (data ? toState() : null),
    act: (name, ...args) => serial(async () => {
      if (!data) await reload();
      const res = await writeWith(d => logic.apply(name, d, args));
      return { state: toState(), notice: res.notice || '' };
    }),
    exportJson: () => JSON.stringify({ format: FMT, version: 1, data: data || logic.emptyData() }, null, 1),
    importJson: text => serial(async () => {
      let o;
      try { o = JSON.parse(String(text)); } catch (e) { throw new Error('Не получилось прочитать файл. Нужна копия, скачанная из приложения.'); }
      if (!o || o.format !== FMT || !o.data || typeof o.data !== 'object') throw new Error('Это не копия ' + LABEL + '. Нужен файл, скачанный из приложения.');
      if (!data) await reload();
      await writeWith(() => ({ data: logic.normalize(o.data), notice: '' }));
      return toState();
    })
  };
}

return { create, FORMAT };
});
