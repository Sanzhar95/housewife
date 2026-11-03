/**
 * ДОБАВИТЬ В КОНЕЦ Code.gs (ничего существующего не заменять).
 * Превращает приложение в JSON-API для сайта. Прежний интерфейс (doGet) продолжает работать.
 *
 * Перед развёртыванием:
 * 1) Apps Script → ⚙️ Настройки проекта → Свойства скрипта → Добавить свойство:
 *      API_TOKEN = длинная случайная строка (от 32 символов). Эту же строку — в .env сайта.
 *    В коде токена нет, поэтому в git он не попадает.
 * 2) appsscript.json: "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
 * 3) Развертывание → Новое развертывание → Веб-приложение → ссылку /exec положить в API_URL.
 *
 * БЕЗОПАСНОСТЬ: при доступе «Все» страница doGet() тоже становится публичной.
 * Когда перейдёте на сайт, первой строкой doGet() добавьте:
 *   if (PropertiesService.getScriptProperties().getProperty('LEGACY_UI') !== 'on')
 *     return ContentService.createTextOutput('API');
 * (пока пользуетесь старой страницей — поставьте свойство LEGACY_UI = on).
 *
 * Если Apps Script ругается на повтор имён API_FUNCS_, doPost или apiOut_ — переименуйте их здесь.
 */

// Белый список: сайт может вызывать только эти функции.
// Стрелки вычисляются лениво: если какой-то функции нет, сломается только её вызов, а не всё приложение.
const API_FUNCS_ = {
  getState: (...a) => getState(...a),
  saveProduct: (...a) => saveProduct(...a),
  adjustStock: (...a) => adjustStock(...a),
  deleteProduct: (...a) => deleteProduct(...a),
  saveDish: (...a) => saveDish(...a),
  deleteDish: (...a) => deleteDish(...a),
  setIngredient: (...a) => setIngredient(...a),
  generateWeek: (...a) => generateWeek(...a),
  addItem: (...a) => addItem(...a),
  rerollItem: (...a) => rerollItem(...a),
  setItem: (...a) => setItem(...a),
  removeItem: (...a) => removeItem(...a),
  setSide: (...a) => setSide(...a),
  rerollSide: (...a) => rerollSide(...a),
  cookItem: (...a) => cookItem(...a),
  cookMeal: (...a) => cookMeal(...a),
  setLeftover: (...a) => setLeftover(...a),
  addLeftover: (...a) => addLeftover(...a),
  undoItem: (...a) => undoItem(...a),
  cookDish: (...a) => cookDish(...a),
  importProducts: (...a) => importProducts(...a),
  saveSettings: (...a) => saveSettings(...a)
  // exportXlsx здесь нет: на сайте Excel собирается в браузере (public/api.js).
};

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);          // { token, fn, args: [...] }
    const token = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (!token || req.token !== token) return apiOut_({ error: 'forbidden' });
    const f = API_FUNCS_[req.fn];
    if (!f) return apiOut_({ error: 'unknown fn: ' + req.fn });
    return apiOut_({ ok: f.apply(null, req.args || []) });
  } catch (err) {
    return apiOut_({ error: String((err && err.message) || err) });
  }
}

function apiOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
