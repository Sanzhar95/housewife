# Этап 2: «Домашняя кухня» на Supabase — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести «Домашнюю кухню» с Google Apps Script + Таблицы на Netlify + Supabase: вход по логину и паролю, семья по ссылке-приглашению, оптимистичный отклик, перенос реальных данных без потерь.

**Architecture:** Предметная логика (порт `Code.gs`) живёт в браузере (`logic.js`) и принимает/возвращает состояние. База только хранит: `get_state()` читает, `apply_changes(версия, изменения)` пишет одной транзакцией под RLS. Клиент показывает результат сразу, а `db.js` отправляет разницу в фоне по очереди, при конфликте версий повторяет действие на свежих данных.

**Tech Stack:** Vanilla JS (без фреймворков), Supabase (Postgres, Auth, RLS, plpgsql), `@supabase/supabase-js` (положить в `public/vendor/`, версию зафиксировать), ExcelJS (запись xlsx) и SheetJS (чтение), Node 20+ (`node --test`), `pg` (только тесты), Netlify (статика).

**Spec:** `docs/superpowers/specs/2026-11-03-stage2-supabase-design.md` (читать целиком перед началом; номера «п.» ниже — разделы спеки).

## Global Constraints

- Язык интерфейса — русский, валюта ₸, даты наружу строками `yyyy-MM-dd HH:mm` / `yyyy-MM-dd`, часовой пояс семьи `Asia/Almaty`.
- Без фреймворков и сборщиков: клиент — файлы в `public/`, `build.js` только пишет `public/config.js` из `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- `service_role`-ключ и пароли не попадают ни в клиент, ни в git. `.gitignore`: `.env`, `public/config.js`, `*.xlsx`, `.DS_Store`, `*.zip`.
- Данные не теряем: запись только через `apply_changes` (одна транзакция); перед рискованными шагами — копия таблицы и коммит.
- ID — текст из 8 символов (старые не переименовывать); составные PK `(household_id, id)`; без жёстких внешних ключей между таблицами данных; `seq bigint generated always as identity` у products, dishes, dish_items.
- SQL-функции: `set search_path = ''`, имена со схемой, `revoke execute ... from public, anon`, `grant execute` только `authenticated`. Таблицы данных: прямой записи нет.
- Мобильные правила дизайн-системы: поля ≥16px и высотой от 48px, кнопки ≥42–54px, диалоги — шторка снизу, группы кнопок не внутри `<label>`; токены и классы из `legacy/Index.html` (`--bg #f7f5fc`, `--accent #6a55d8`, `h()`, `field()`, `modal()`).
- Тексты ошибок: «Неверная почта или пароль», «Ссылка не подходит: она уже использована или устарела. Попросите новую», «Нет связи. Попробуйте ещё раз», «Войдите заново».
- Старую логику переносим как есть, включая 6 особенностей из п. 11 спеки; чинить только после зелёных сравнительных тестов.
- Коммиты — маленькие, на русском, с атрибуцией из системного напоминания сессии. Каждое изменение для Санжара сопровождается блоком «файлы / данные / как обновить / что проверить на телефоне» (правило проекта).

## Review Focus

Входы и условия, которые спека не называет, но которые вероятнее всего сломают пользователя (у каждого есть тест в указанной задаче):

1. **Двойной тап «Готовить» до завершения первой записи** — второе действие считается от оптимистичного состояния, очередь не теряет и не дублирует списание (Задача 9).
2. **Два человека регистрируются по одной ссылке одновременно** — проходит ровно один, второй получает «Ссылка не подходит…» (Задача 3).
3. **Сессия истекла или пропала сеть посреди записи** — красный тост, откат к свежему состоянию, ничего не пропадает молча, после входа данные на месте (Задача 9, 10).
4. **Кириллица, эмодзи, кавычки, апострофы в названиях; десятичная запятая «0,5»; пустое название** — доходят до базы и обратно без искажений, ошибки понятны (Задача 6, 9).
5. **Участник (не владелец) вызывает `create_invite`; владелец другой семьи читает/пишет чужое** — отказ (Задача 3).

---

### Задача 1: Каркас репозитория

**Files:**
- Create: `.gitignore`, `package.json`, `tests/.gitkeep`, `apps-script/appsscript.json`
- Move: `Code.gs` → `apps-script/Code.gs`, `Index.html` → `legacy/Index.html`
- Delete: `apps-script/api-patch.gs`, `.DS_Store`
- Modify: `CLAUDE.md` (раздел «Текущая архитектура»: Netlify + Supabase, вход по паролю и приглашению, убрать Cloudflare/e-mail/Telegram как текущие), `КОНТЕКСТ_Домашняя_кухня.md` (пункты хронологии и схема таблиц Supabase), `README.md` (как запускать тесты, как сбросить пароль — заполняется в Задаче 2)

**Interfaces:**
- Produces: `npm test` = `node --test tests/`; `npm run build` = `node build.js`; скрипты `package.json` используются всеми задачами.

- [ ] **Step 1:** Сделать `git mv` по списку выше (`git rm` для `api-patch.gs` и `.DS_Store`); создать `.gitignore` из Global Constraints. `appsscript.json`: `{"timeZone":"Asia/Almaty","runtimeVersion":"V8","exceptionLogging":"STACKDRIVER"}`.
- [ ] **Step 2:** `package.json` (`"type":"commonjs"`, dev-зависимости `@supabase/supabase-js`, `pg`, `xlsx`, `exceljs` — точные версии, без `^`), `npm install`.
- [ ] **Step 3:** Обновить `CLAUDE.md` и контекст-файл (отдельный коммит «документы»).
- [ ] **Step 4:** Проверка: `git status` чистый, `ls` совпадает со структурой п. 2 спеки, `npm test` выходит с кодом 0 («no tests»).
- [ ] **Step 5:** Commit: `git commit -m "Каркас репозитория этапа 2"`.

**Санжару (вручную):** сделать репозиторий приватным (Settings → Danger zone → Change visibility); xlsx не добавлять в git.

---

### Задача 2: Спайк R1, R2, R3, R6 на пустом проекте

**Files:**
- Create: `supabase/spike/spike.sql`, `tests/spike/spike.js` (черновик, остаётся в репозитории как справка), `docs/superpowers/plans/spike-notes.md`
- Modify: `README.md` (раздел «Забытый пароль»)

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_ANON_KEY` из `.env` (Санжар даёт публичный ключ; `.env` не в git).
- Produces: решение R1 (триггер на `auth.users` или hook «Before User Created» — записать выбор в `spike-notes.md`, Задача 3 использует его), точный текст/код ошибки для `cleanErr`, ответ на R2/R3/R6.

- [ ] **Step 1:** Санжар в панели: Auth → Providers → Email: «Confirm email» OFF, «Allow new users to sign up» ON, минимальная длина пароля 8.
- [ ] **Step 2:** `spike.sql`: временная таблица `spike_invites(token_hash)`, триггер `after insert on auth.users`, бросающий исключение, если `raw_user_meta_data->>'invite'` не в таблице. Выполнить в SQL Editor.
- [ ] **Step 3:** `spike.js`: `signUp` с неверным токеном, с верным токеном, без токена. Записать в `spike-notes.md`: что вернул клиент (`error.status`, `error.message`, `error.code`), создан ли пользователь, пришла ли сессия (R2).
- [ ] **Step 4:** Если сообщение клиенту непонятное или пользователь создаётся при отказе — повторить тот же сценарий через hook «Before User Created» и выбрать вариант; записать выбор.
- [ ] **Step 5 (R6):** От имени `anon` и `authenticated` (через `supabase-js` с их JWT) попытаться прочитать таблицу и вызвать функцию без `grant`; записать, какие `grant usage on schema public` / `revoke` нужны.
- [ ] **Step 6 (R3):** Проверить в Authentication → Users, можно ли задать пароль пользователю; если нет — найти SQL для тестового пользователя. Написать в README шаги «Забытый пароль» (3–5 строк, простыми словами).
- [ ] **Step 7:** Удалить временные объекты (`drop trigger`, `drop table spike_invites`), commit: `git commit -m "Спайк R1-R3, R6: результаты"`.

---

### Задача 3: Схема, RLS и функции базы

**Files:**
- Create: `supabase/migrations/001_init.sql`, `tests/rls.test.js`, `tests/helpers/db.js`
- Test: `tests/rls.test.js` (нужны `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL` — строка подключения Postgres из панели, только в локальном `.env`; без них тесты пропускаются с сообщением)

**Interfaces:**
- Produces (таблицы и функции — точные имена для всех следующих задач):
  - Таблицы по п. 4 спеки: `households, members, invites, products, dishes, dish_items, plan, purchases, log`.
  - `get_state() returns jsonb` → `{products, dishes, ing, plan, settings:{email,weekStart,portions}, log, purchases, version, me:{email,role,household}}`; поля элементов — как сегодня в `state_()` из `apps-script/Code.gs` 313–339 (`ing` = `[{dish,product,qty,unit}]`, `dishes` с `withSide`, `portions`, `times`, `meals` массивом; уточнить по `state_`/`load_`).
  - `apply_changes(expected_version bigint, changes jsonb) returns bigint`. Форма `changes`: `{ products|dishes|ing|plan: {upsert:[строки], delete:[ключи]}, settings:{weekStart?, portions?, email?}, log:[{when,action,obj,details}], purchases:[{when,product,qty,unit,total,unitPrice}] }`; ключ `ing` — `[dish, product]`, остальные — `id`. Ошибка конфликта: исключение с текстом `version_conflict`.
  - `create_invite() returns text` (токен один раз, владельцу), `admin_new_family_invite(name text) returns text` (только SQL Editor; `revoke` у `anon`, `authenticated`).
  - Триггер/hook регистрации — по решению Задачи 2.

- [ ] **Step 1: Failing-тесты** (`tests/rls.test.js`, имена как заголовки): «чужая семья: select возвращает 0 строк», «прямой insert/update/delete в таблицы данных запрещён», «apply_changes участника семьи A не меняет семью B», «неверная expected_version → version_conflict, данные не изменились», «ошибка внутри changes откатывает всё (одна строка валидная, вторая нарушает ограничение)», «регистрация без токена / с просроченным / с использованным токеном → отказ и пользователь не создан», «**два одновременных signUp по одной ссылке: ровно один успех**», «**участник (member) вызывает create_invite → отказ**», «anon не может вызвать get_state/apply_changes/create_invite/admin_new_family_invite». Хелпер `tests/helpers/db.js`: создаёт две тестовые семьи через `admin_new_family_invite` (через `pg`) и пользователей через `signUp`; чистит за собой.
- [ ] **Step 2:** Запустить `node --test tests/rls.test.js`: Expected: FAIL (объектов нет).
- [ ] **Step 3:** Написать `001_init.sql` по п. 4 спеки (идемпотентно: `create ... if not exists`, `create or replace function`). Токен — случайные 32 байта, в таблице только `sha256`; использование приглашения — `update ... where used_at is null returning` в одной транзакции (это даёт ровно один успех при гонке).
- [ ] **Step 4:** Применить в SQL Editor (или `psql`), запустить тесты. Expected: PASS.
- [ ] **Step 5:** Дописать тест «кириллица, эмодзи, кавычки и апострофы в названиях доходят до `get_state` без изменений» и «пустой household: `get_state` возвращает пустые массивы и `version`=0»; убедиться, что проходят.
- [ ] **Step 6:** Commit: `git commit -m "База: схема, RLS, get_state, apply_changes, приглашения"`.

---

### Задача 4: Сравнительный стенд («оракул») и фикстуры

**Files:**
- Create: `tests/oracle/sheets-mock.js`, `tests/oracle/gs-runner.js`, `tests/fixtures/sheets.synthetic.json`, `tools/xlsx-to-sheets.js`, `tests/oracle/oracle.smoke.test.js`
- Test: `tests/oracle/oracle.smoke.test.js`

**Interfaces:**
- Produces:
  - `gs-runner.js`: `createOracle({sheets, seed, now, today}) -> { getState(), call(fn, ...args) }` — запускает `apps-script/Code.gs` в `vm`-контексте с имитациями `SpreadsheetApp, LockService, Utilities (getUuid, formatDate), MailApp, PropertiesService, ScriptApp, HtmlService, Session, CacheService`; `Math.random` — детерминированный генератор по `seed`; `Date` — фиксированные часы.
  - `rng(seed) -> () => number` и `idGen(prefix?) -> () => string` (8 hex-символов из счётчика) в `tests/helpers/det.js` — те же функции используются и для `logic.js` (Задачи 5–8), чтобы последовательности ID совпадали.
  - `xlsx-to-sheets.js`: `readSheets(path) -> {Продукты:[[...]], Блюда, Состав, План, Журнал, Приходы, Настройки}` (значения как у Google: числа, булевы, `Date`), используется миграцией (Задача 15) и необязательным реальным тестом (`DK_XLSX=путь`).
  - `sheets.synthetic.json`: небольшой набор по шапкам `SHEETS` (`Code.gs` 15–23): ~12 продуктов (все единицы: КГ, Г, Л, МЛ, ШТ), 8 блюд (основные с гарниром и без, гарнир, салат; одно с `times=2`, одно с `recipe_portions`), состав, план на неделю с «вчерашним» и приготовленным, продукт на нуле, продукт с минимумом, пара приходов; числовой ID в плане для проверки нормализации.

- [ ] **Step 1: Failing-тест** `oracle.smoke.test.js`: «getState на синтетической фикстуре возвращает 12 продуктов, 8 блюд и совпадает со снимком `tests/fixtures/state.synthetic.snapshot.json`» и «две подряд инициализации с одним seed дают одинаковые `generateWeek`».
- [ ] **Step 2:** Запустить: Expected: FAIL (файлов нет).
- [ ] **Step 3:** Реализовать мок только тех методов, которые вызывает `Code.gs` (найти `grep -oE "\.(get|set|append|clear|insert|delete|flush|create|getRange|getDataRange)\w*" apps-script/Code.gs`); не добавлять лишнего. Снимок создать из вывода и проверить глазами на здравый смысл.
- [ ] **Step 4:** Запустить: Expected: PASS. Если задан `DK_XLSX`, дополнительный тест `getState` на реальной выгрузке: 46 продуктов, 34 блюда, 152 строки состава, 15 строк плана (иначе пропускается).
- [ ] **Step 5:** Commit: `git commit -m "Сравнительный стенд: запуск Code.gs в Node"`.

---

### Задача 5: `logic.js` — основа

**Files:**
- Create: `public/logic.js`, `tests/logic/core.test.js`
- Test: `tests/logic/core.test.js`

**Interfaces:**
- Consumes: `createOracle`, `rng`, `idGen` (Задача 4).
- Produces (один модуль для браузера и Node: `globalThis.Logic` и `module.exports`):
  - `Logic.create(env: {rng: () => number, id: () => string, now: () => string /* 'yyyy-MM-dd HH:mm' в tz семьи */, today: () => string /* 'yyyy-MM-dd' */}) -> {apply(name: string, state: State, args: any[]) -> State}`. `apply` делает глубокую копию, выполняет действие, нормализует (`portions` 0, пустые строки, единицы состава — как `load_`/`save*_`), ставит `next.notice` (строка или `''`), при ошибке бросает `Error` с русским текстом из `Code.gs`, исходное состояние не меняется.
  - Новые записи журнала/приходов добавляются в `state.log` (в начало) и `state.purchases` (в конец) с флагом `_new: true`; `db.js` отправляет только их.
  - Чистые общие функции, экспортируются отдельно: `Logic.util = {timesOf, typeKey, mealsOf, sameFam, conv, fmtQ, r3, r6, str, num, unit}` — порт строк 34–68 и 126–145 `Code.gs`; константы `SHEETS`-независимые (`FAM`, `TYPES`, `MEALS`, `EPS`, `DEF_PORTIONS`) — как в `Code.gs`.
  - Дата/время: `Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Almaty', ...})` вместо `Utilities.formatDate`.

- [ ] **Step 1: Failing-тесты:** по каждой функции `util` — табличный тест значений, снятых с оракула (`Code.gs` экспортирует функции в контексте — вызвать их там и сравнить с `Logic.util`) для: единиц и регистров («кг», «Кг »), перевода Г↔КГ и МЛ↔Л, `fmtQ` для 0, 0.333, 1500 Г, дробей; `num` с запятой «0,5» и пустой строкой; `timesOf` (0, 1, 2, строка). Тест «apply не мутирует исходное состояние при ошибке».
- [ ] **Step 2:** Запустить: Expected: FAIL.
- [ ] **Step 3:** Портировать без изменения поведения; сохранить имена и порядок из `Code.gs`.
- [ ] **Step 4:** Запустить: Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "logic.js: общие функции и обёртка apply"`.

---

### Задача 6: `logic.js` — склад, продукты, блюда, состав, настройки, импорт

**Files:**
- Modify: `public/logic.js`
- Create: `tests/logic/oracle-stock.test.js`

**Interfaces:**
- Consumes: `Logic.create(env)`, `createOracle`.
- Produces действия (имена как в `apps-script/Code.gs`; аргументы те же, кроме `saveSettings`): `saveProduct(p)`, `adjustStock(productId, delta, total, unit)`, `deleteProduct(id)`, `saveDish(d)`, `deleteDish(id)`, `setIngredient(dishId, productId, qty, unit)`, `importProducts(rows)`, `saveSettings(portions)`.

- [ ] **Step 1: Failing-тесты** (`oracle-stock.test.js`): общий помощник `same(fn, args)` — выполняет действие в оракуле и в `Logic` на одинаковом начальном состоянии и проверяет глубокое равенство `state` (без `_new`, с нормализацией журнала по `when`) и `notice`. Сценарии: создание продукта (новая единица), редактирование, дубль названия, удаление продукта, который есть в составе блюд; `adjustStock` приход с `total` (проверить запись в приходы и цену за единицу), с `delta` отрицательной, перевод Г→КГ; `saveDish` новое/изменение, смена `type`, `withSide`, `times=2`, `recipe_portions`; удаление блюда, стоящего в плане; `setIngredient` с qty=0 (удаляет строку), с единицей другого семейства; `importProducts` (дубли, пустые строки, запятая-десятичная, неизвестная единица); `saveSettings(portions)` 0/4/пусто; названия с кириллицей, эмодзи, кавычками, пустым названием (поведение — как у оракула).
- [ ] **Step 2:** Запустить: Expected: FAIL (действий нет).
- [ ] **Step 3:** Портировать функции `Code.gs` 349–517, 1043–1082, 1114–1128 (без e-mail и `MailApp`). `log_` → запись в `state.log` с `_new`.
- [ ] **Step 4:** Запустить: Expected: PASS. Расхождения — только в п. 11 спеки; иначе чинить порт, не тест.
- [ ] **Step 5:** Commit: `git commit -m "logic.js: склад, справочники, импорт (с оракулом)"`.

---

### Задача 7: `logic.js` — меню (генератор, замены, гарниры)

**Files:**
- Modify: `public/logic.js`
- Create: `tests/logic/oracle-menu.test.js`

**Interfaces:**
- Produces действия: `generateWeek(opts)`, `addItem(day, meal, kind, dishId, onlyAvail)`, `rerollItem(id, onlyAvail)`, `setItem(id, dishId)`, `removeItem(id)`, `setSide(id, sideId)`, `rerollSide(id, onlyAvail)`; внутренние: `shuffle`, `freshFirst`, `usedCounts`, `simExcept`, `pickSide`, `pickMain`, `chooseFor`, `planItem`, `setSide_` (порт `Code.gs` 519–801). `rng` берётся только из `env.rng`; `mondayStr_` — из `env.today()`.

- [ ] **Step 1: Failing-тесты** (`same(...)` из Задачи 6, несколько seed 1..5): `generateWeek` с `onlyAvail` и без; в воскресенье и в понедельник (`today`); при нехватке продуктов (пустой склад); с пустым списком блюд; с блюдом `times=2`; `addItem` во все приёмы и виды; `rerollItem` (включая особенность 6 п. 11); `setItem` на блюдо без гарнира; `removeItem` несуществующего id; `setSide`/`rerollSide`; `setSide` с `undefined` (особенность 5); `generateWeek` при невыполненных «вчерашних» (особенность 3). Сравниваются состояние, `notice` и журнал.
- [ ] **Step 2:** Запустить: Expected: FAIL.
- [ ] **Step 3:** Портировать как есть, все 6 особенностей оставить.
- [ ] **Step 4:** Запустить: Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "logic.js: меню и гарниры (с оракулом)"`.

---

### Задача 8: `logic.js` — готовка, остатки, отмена

**Files:**
- Modify: `public/logic.js`
- Create: `tests/logic/oracle-cook.test.js`

**Interfaces:**
- Produces действия: `cookItem(id, opts)`, `cookMeal(day, meal, opts)`, `cookDish(dishId, sideId, opts)`, `undoItem(id)`, `setLeftover(id, on)`, `addLeftover(day, meal, dishId, sideId)`; внутренние: `withLow`, `cookItems`, `dayAcc`, `placeSlot`, `checkSlot`, `placeLeftover(s)`, `leftoverSlots`, `cookOpts`, `applyPortions`, `finish` (порт `Code.gs` 802–1042). Без `MailApp`: `notifyLow_` не переносится (уведомления вне этапа 2).

- [ ] **Step 1: Failing-тесты:** готовка с порциями ≠ рецепту; «хватает на N раз» (`times`=2) с `target`/без (особенность 2); остатки на следующий день и на следующую неделю (особенность 4); смена гарнира у приготовленного; готовка при нехватке (ошибка и текст); `cookMeal` на весь приём; `undoItem` после смены рецепта (особенность 1), `undoItem` не готовленного; `setLeftover` вкл/выкл; `addLeftover` в занятый слот; `cookDish` вне меню; пересечение минимума (продукт стал «ниже минимума» → текст в `notice`); порции дробные; двойной вызов `cookItem` на одну строку.
- [ ] **Step 2:** Запустить: Expected: FAIL.
- [ ] **Step 3:** Портировать как есть.
- [ ] **Step 4:** Запустить весь набор `npm test`. Expected: PASS. Если задан `DK_XLSX`, повторить ключевые сценарии на реальной выгрузке.
- [ ] **Step 5:** Commit: `git commit -m "logic.js: готовка и остатки (с оракулом)"`.

---

### Задача 9: `db.js` — разница, запись, очередь, конфликты

**Files:**
- Create: `public/db.js`, `tests/db/diff.test.js`, `tests/db/queue.test.js`
- Test: оба файла (с подменой RPC в памяти, без сети)

**Interfaces:**
- Consumes: форма `changes` и `version_conflict` (Задача 3), `Logic.create(env).apply` (Задачи 5–8).
- Produces (`globalThis.DB`):
  - `DB.init(client /* supabase-js */)`; `DB.load() -> Promise<State>` (вызывает `get_state`, сохраняет `version` и базовое состояние).
  - `DB.diff(prev: State, next: State) -> changes` — чистая функция (по ключам, как в п. 4); неизменные таблицы в `changes` не попадают.
  - `DB.run(name: string, args: any[]) -> {optimistic: State, done: Promise<State>}` — применяет `Logic.apply` к последнему оптимистичному состоянию, возвращает его сразу, ставит запись в очередь; `done` разрешается итоговым состоянием.
  - Очередь последовательная; при `version_conflict`: `DB.load()`, повтор `Logic.apply` с теми же аргументами, запись; ошибка повтора, ошибка сети или `JWT expired`/401 → отклонить `done` с русским текстом, откатить оптимистичное состояние к свежему `get_state()` (если сеть есть).
  - `DB.onSaving(cb: (count: number) => void)` — счётчик задач в очереди для индикатора; флаг `DB.OPTIMISTIC` (по умолчанию `true`): при `false` `run` возвращает состояние только после записи.
  - `DB.cleanError(e) -> string` — перевод сетевых/токенных ошибок в тексты из Global Constraints.

- [ ] **Step 1: Failing-тесты** `diff.test.js`: новая/изменённая/удалённая строка в каждой из таблиц; пара `[dish, product]` у `ing`; `_new` записи журнала и приходов попадают в `log`/`purchases` один раз; неизменное состояние → `{}`; названия с эмодзи, кавычками и кириллицей не искажаются при `JSON.stringify`/`parse`. `queue.test.js`: «**два `run('cookItem')` подряд до ответа сервера: в базу уходят две записи по порядку, списание не задваивается**», «конфликт версии: действие повторено на свежем состоянии, итог = ожидаемый», «повтор невозможен (нехватка) → `done` отклонён, состояние откатилось», «сеть оборвалась → понятный текст, `onSaving` вернулся в 0», «JWT expired → „Войдите заново“», «`OPTIMISTIC=false` ждёт запись».
- [ ] **Step 2:** Запустить: Expected: FAIL.
- [ ] **Step 3:** Реализовать `DB`; RPC вызывается как `client.rpc('apply_changes', {expected_version, changes})`.
- [ ] **Step 4:** Запустить: Expected: PASS.
- [ ] **Step 5:** Интеграционный тест с реальной базой (если есть `.env`): `DB.run('saveProduct', …)` → новый `DB.load()` содержит продукт; `version` вырос на 1. Expected: PASS.
- [ ] **Step 6:** Commit: `git commit -m "db.js: разница, очередь записи, конфликты версий"`.

---

### Задача 10: `auth.js` и `api.js`

**Files:**
- Create: `public/auth.js`, `public/api.js` (заменить файл этапа 1), `public/vendor/supabase.js` (из `node_modules/@supabase/supabase-js/dist/umd/supabase.js`, версия в имени комментария), `tests/api/api.test.js`
- Test: `tests/api/api.test.js`

**Interfaces:**
- Consumes: `DB` (Задача 9), `window.SUPABASE_URL/SUPABASE_ANON_KEY` из `config.js`.
- Produces:
  - `Auth.init() -> Promise<Session|null>`; `Auth.signIn(email, password)` (e-mail → нижний регистр, обрезка; пароль ≥ 8, иначе понятная ошибка); `Auth.signUp(email, password, token)` (`options.data.invite`; если сессии нет — сразу `signIn`); `Auth.signOut()`; `Auth.changePassword(newPassword)`; `Auth.inviteLink() -> Promise<string>` (`create_invite` → `<origin>/#/join/<токен>`); `Auth.parseJoinHash(hash) -> string|null`; `Auth.mapError(e) -> string`. Рендер экранов входа/регистрации — в Задаче 11 (там живёт `h()`).
  - `API`: объект с теми же именами, что вызывает клиент, — каждое действие возвращает `Promise<State>` через `DB.run`; `getState()`; `setIngredient`; `saveSettings(portions)`; `exportXlsx` (Задача 13). Состояние содержит `notice`.

- [ ] **Step 1: Failing-тесты:** «каждое имя из `call('…')`/`act('…')` в `legacy/Index.html` есть в `API`» (парсинг регулярным выражением), «`Auth.parseJoinHash('#/join/abc')` = 'abc', иначе null», «`Auth.mapError` для: invalid login credentials, trigger-отказа (текст из спайка), `Failed to fetch`, `JWT expired`», «`signIn` приводит e-mail к нижнему регистру», «`getState` пустой семьи возвращает пустые массивы без ошибок» (на фейковом клиенте).
- [ ] **Step 2:** Запустить: Expected: FAIL.
- [ ] **Step 3:** Реализовать; клиент supabase-js: `createClient(url, key, {auth:{persistSession:true, autoRefreshToken:true}})`.
- [ ] **Step 4:** Запустить: Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "auth.js и api.js: вход, приглашения, API клиента"`.

---

### Задача 11: `public/index.html` — перенос клиента, вход и настройки

**Files:**
- Create: `public/index.html` (копия `legacy/Index.html` с правками ниже; заменить placeholder этапа 1)
- Test: ручная проверка в браузере (шаг 6) + `tests/ui/smoke.test.js` на Playwright (установлен в среде), если окружение позволяет

**Interfaces:**
- Consumes: `Auth`, `API`, `DB` (Задачи 9–10).
- Produces: экраны `renderAuth(mode: 'login'|'join', info?)`, блок настроек; индикатор сохранения рядом с названием.

- [ ] **Step 1:** Скопировать `legacy/Index.html` → `public/index.html`; подключить `config.js`, `vendor/supabase.js`, `logic.js`, `db.js`, `auth.js`, `api.js` (порядок важен), SheetJS оставить.
- [ ] **Step 2:** Правки по п. 5 спеки: `call()` (стр. ~618–622) → `API[fn](...args)`; убрать `<base target="_top">` (стр. 7); `viewport-fit=cover`; `cleanErr` → `DB.cleanError`; `setCell` (~1693–1707) подключить к индикатору; `visibilitychange` → `DB.load()` + перерисовка, если нет открытого диалога и очередь пуста; `init()` (~2098) сначала `Auth.init()`, без сессии — экран входа, с `#/join/…` — экран регистрации.
- [ ] **Step 3:** CSS по п. 6 спеки (селектор полей ~83–84 + `password`; `.auth`, `.auth-note`, `.auth .btn.primary`, `.set-links`, `body.anon …`); сверить реальные имена классов `.hero`/`.hand` в файле.
- [ ] **Step 4:** Настройки (~894–911): убрать поле e-mail (896, 903–904, 908); добавить «Вы вошли как …», «👨‍👩‍👧 Пригласить в семью» (только `me.role==='owner'`; показать ссылку и «Скопировать»), «🔑 Сменить пароль» (шторка, минимум 8), «💾 Скачать копию» (Задача 13), «🚪 Выйти»; поля с `autocomplete="username|current-password|new-password"`, кнопка «показать» у пароля.
- [ ] **Step 5:** Переписать тексты справки про почту и Таблицу (~1999–2003, 2014) простым языком; в справку добавить «Как добавить мужа/жену».
- [ ] **Step 6: Проверка в браузере (390px, Playwright):** без сессии виден только экран входа без навигации; неверный пароль → красная плашка «Неверная почта или пароль»; вход → меню; «Готовить» меняет экран без ожидания; перезагрузка — сессия сохранилась; ссылка `#/join/плохой` → сообщение «Ссылка не подходит…» и кнопка «Войти». Отметить «проверить на iPhone»: автозаполнение, «На экран Домой».
- [ ] **Step 7:** Commit: `git commit -m "Клиент: вход, регистрация по ссылке, настройки"`.

---

### Задача 12: Общие расчёты клиента — тест совпадения, затем замена; исправление «30 дней»

**Files:**
- Modify: `public/logic.js` (экспорт `Logic.calc = {needMap, itemNeed, weekNeed, shoppingList, dishP, isLow, r3}`), `public/index.html` (стр. ~489–502, 508, 576, 834–868, 1832)
- Create: `tests/logic/client-parity.test.js`

**Interfaces:**
- Consumes: клиентские функции из `public/index.html` (выделить блоки в тест через `vm`, не копируя).
- Produces: `Logic.calc.*` с теми же сигнатурами, что у клиентских копий.

- [ ] **Step 1: Failing-тест:** «клиентские `needMap/itemNeed/weekNeed/shoppingList/dishP/isLow/r3` и `Logic.calc.*` дают одинаковый результат на синтетической фикстуре и на 20 случайных наборах (seed)» + «граница „30 дней“ на экране Цены собирается локальной датой: для времени 2026-11-03 22:00 Алматы граница = 2026-10-04».
- [ ] **Step 2:** Запустить: Expected: FAIL.
- [ ] **Step 3:** Экспортировать `calc` из `logic.js`, заменить клиентские копии вызовами, исправить стр. ~1832 (`todayStr`-подход вместо `toISOString`).
- [ ] **Step 4:** Запустить `npm test`. Expected: PASS; в браузере экраны «Склад», «Покупки», «Цены» показывают прежние числа.
- [ ] **Step 5:** Commit: `git commit -m "Единые расчёты клиента; исправление границы 30 дней"`.

---

### Задача 13: Excel и «Скачать копию»

**Files:**
- Create: `public/xlsx-export.js`, `public/vendor/exceljs.min.js`, `tests/ui/xlsx-export.test.js`
- Modify: `public/api.js` (`exportXlsx`), `public/index.html` (`offerXlsx` ~690–706: к ссылке `download`, окно сохраняется; кнопка «Скачать копию»)

**Interfaces:**
- Produces: `exportXlsx(name: string, rows: any[][], opts) -> Promise<string /* blob URL */>` с `opts` как в `apps-script/Code.gs` 1083–1108 (`fill`, `unitCol`, `total`, закрепления); `Backup.download()` → JSON-файл со всем состоянием (`get_state()`), имя `kuhnya-копия-YYYY-MM-DD.json`. ExcelJS подгружается скриптом только при выгрузке.

- [ ] **Step 1: Failing-тест:** сгенерировать файл с `opts`, прочитать ExcelJS: «жирная шапка с фоном `ECE8FC`, у столбцов `fill` заголовок `FFD970` и ячейки `FFF6D1`, в `unitCol` проверка данных-список единиц, строка „Итого“ жирная, закреплены строка и столбец».
- [ ] **Step 2:** Запустить: Expected: FAIL. **Step 3:** Реализовать. **Step 4:** Expected: PASS.
- [ ] **Step 5:** Round-trip: выгруженный файл читается существующим импортом (`importProducts`) без изменений.
- [ ] **Step 6:** Commit: `git commit -m "Excel через ExcelJS и копия данных"`. Отметить: **проверить на iPhone** (скачивание Blob, R5).

---

### Задача 14: Service worker, сборка, Netlify

**Files:**
- Modify: `public/sw.js` (новый номер кэша; оболочка: `index.html, logic.js, db.js, auth.js, api.js, xlsx-export.js, vendor/*, manifest.json, icons`; запросы к `*.supabase.co` не кэшировать), `build.js` (читает `SUPABASE_URL`, `SUPABASE_ANON_KEY` из `.env`/окружения, падает с понятной ошибкой, если нет), `public/manifest.json` (проверить `start_url`, `display: standalone`)
- Create: `netlify.toml` (`build.command = "node build.js"`, `publish = "public"`), `tests/build.test.js`

- [ ] **Step 1: Failing-тест:** «`build.js` без переменных завершается с ненулевым кодом и русским сообщением», «с переменными пишет `public/config.js` с обоими значениями и без `service_role`», «все файлы из списка оболочки `sw.js` существуют».
- [ ] **Step 2:** Запустить: Expected: FAIL. **Step 3:** Реализовать. **Step 4:** Expected: PASS.
- [ ] **Step 5 (Санжар):** Netlify → Add new site → Import from GitHub (репозиторий приватный), переменные окружения, деплой. При падении сборки из-за secrets scanning — добавить `SECRETS_SCAN_OMIT_KEYS=SUPABASE_ANON_KEY` (R7); записать итог в `spike-notes.md`.
- [ ] **Step 6:** Commit: `git commit -m "Сборка и Netlify"`.

---

### Задача 15: `tools/migrate.js` и сверка

**Files:**
- Create: `tools/migrate.js`, `tools/reconcile.js`, `tests/migrate.test.js`
- Modify: `README.md` (раздел «Перенос данных» и «Как очистить семью для повтора»)

**Interfaces:**
- Consumes: `readSheets` (Задача 4), `Logic.create`/`DB.diff` для построения состояния, `apply_changes`.
- Produces: `node tools/migrate.js путь.xlsx` — спрашивает e-mail и пароль (не хранит), входит, отказывается работать, если в семье уже есть данные, отправляет одним `apply_changes`, печатает отчёт; `node tools/reconcile.js путь.xlsx` — сравнивает базу с файлом: число строк по листам, остаток каждого продукта, число продуктов «≤ минимума» и «на нуле», число «вчерашних», `weekStart`; код выхода ≠ 0 при любом расхождении.

- [ ] **Step 1: Failing-тесты** (`migrate.test.js`, без сети — функция `buildChanges(sheets) -> changes`): ID-число `35409132` → строка `'35409132'`; нецелое число-ID заменяется новым ID и обновляются ссылки `from`; Excel-даты → `yyyy-MM-dd HH:mm` (местное время Алматы); приход по несуществующему продукту сохранён и попал в отчёт; пустые `Рецепт на, порций`/`Хватает на, раз` → значения по умолчанию; настройки: `email`, `weekStart` перенесены; на реальном файле (`DK_XLSX`): 46/34/152/15/251/55, 6 продуктов ≤ минимума, из них 5 на нуле, 2 «вчерашних», `weekStart` 2026-11-02.
- [ ] **Step 2:** Запустить: Expected: FAIL. **Step 3:** Реализовать `buildChanges`, затем вход и отправку. **Step 4:** Expected: PASS.
- [ ] **Step 5:** Прогон на тестовой семье из Задачи 3 с реальным файлом: `reconcile.js` Expected: «Все проверки совпали»; повторный запуск `migrate.js` Expected: отказ «в семье уже есть данные».
- [ ] **Step 6:** Commit: `git commit -m "Перенос данных из xlsx и сверка"`.

---

### Задача 16: Замеры, UI-проверка и журнал для метрик

**Files:**
- Create: `tests/ui/flow.test.js` (Playwright, 390px: вход → меню → «Готовить» → перезагрузка), `docs/superpowers/plans/perf-notes.md`
- Modify: `public/logic.js`, `tests/logic/oracle-*.test.js` (расхождения с оракулом для новых записей журнала разрешены только для указанных действий)

**Interfaces:**
- Produces: записи журнала «Блюдо заменено» (в `rerollItem`, `setItem`, `addItem`, `removeItem`) и «Меню открыто» (не чаще раза в час, пишется клиентом при открытии вкладки «Меню» через `API.touchMenu()` → `Logic` действие `touchMenu`).

- [ ] **Step 1: Failing-тесты:** «замена блюда пишет запись „Блюдо заменено“», «`touchMenu` дважды за час пишет одну запись, через 61 минуту — вторую». UI-тест: сценарий потока на ширине 390 без ошибок в консоли.
- [ ] **Step 2:** Запустить: Expected: FAIL. **Step 3:** Реализовать. **Step 4:** Expected: PASS (оракульные тесты помечают эти записи как допустимое отличие).
- [ ] **Step 5:** Замерить время от тапа «Готовить» до обновления экрана (`performance.now()`, 20 тапов на тестовой семье): записать медиану и максимум в `perf-notes.md`. Критерий: ≤ 300 мс на телефоне Санжара.
- [ ] **Step 6:** Commit: `git commit -m "Метрики журнала и замеры отклика"`.

---

### Задача 17: Репетиция, iPhone, переключение

**Files:**
- Create: `docs/superpowers/plans/iphone-checklist.md`
- Modify: `КОНТЕКСТ_Домашняя_кухня.md`, `README.md`, `CLAUDE.md`

- [ ] **Step 1 (Санжар, вечер репетиции):** копия таблицы → выгрузка xlsx → `migrate.js` в тестовую семью → `reconcile.js`. Expected: «Все проверки совпали».
- [ ] **Step 2 (iPhone, `iphone-checklist.md`):** регистрация по ссылке в Safari → «На экран Домой» → повторный вход в приложении (R4); предложение сохранить пароль; сессия после закрытия и на следующий день; «Готовить», смена гарнира; Excel скачать/загрузить (R5); два телефона одновременно (конфликт версий); режим самолёта (понятное сообщение, ничего не пропало); индикатор «сохраняется…».
- [ ] **Step 3:** Два дня жизни на тестовой семье без ошибок; критерии готовности из п. 9 спеки выполнены.
- [ ] **Step 4 (переключение):** вечером, когда жена не пользуется старым приложением: новая выгрузка → `migrate.js` в основную семью → `reconcile.js` → `create_invite` → жене ссылка. Старая таблица и приложение остаются архивом минимум 30 дней.
- [ ] **Step 5:** Обновить контекст-файл (хронология, схема Supabase, правила), `README.md` и `CLAUDE.md`; commit: `git commit -m "Документы после переключения"`.

---

## Самопроверка плана по спеке

- Цель, решения (п. 1): Задачи 3, 9, 10, 11, 14.
- Архитектура и структура (п. 2): Задача 1, 14.
- Вход, сессия, приглашения, ошибки (п. 3): Задачи 2, 3, 10, 11.
- База и защита (п. 4): Задача 3.
- Клиент (п. 5): `logic.js` — 5–8; `db.js` — 9; `auth.js`/`api.js` — 10; правки `index.html` — 11; индикатор — 9, 11; Excel — 13; общие расчёты и исправление «30 дней» — 12; service worker — 14.
- Дизайн новых экранов (п. 6): Задача 11.
- Перенос данных (п. 7): Задача 15, 17.
- Хостинг (п. 8): Задача 14.
- Тестирование (п. 9) и критерии готовности: Задачи 3, 4–8, 11, 15–17.
- Риски R1–R9: R1–R3, R6 — Задача 2; R4, R5 — Задача 17; R7 — Задача 14; R8 — Задача 9; R9 — README (Задача 17).
- Особенности п. 11: сохраняются в Задачах 7–8; исправление — отдельными задачами после этапа.
- Метрики п. 12: Задача 16.

**Не входит (по спеке):** уведомления, автокопии, realtime, «создать свою семью», восстановление пароля по почте, офлайн-запись.
