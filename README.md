# Домашняя кухня — сайт (этап 1)

Сайт на Cloudflare Pages, который работает поверх вашего Apps Script и Google Таблицы. Данные в таблице не меняются.

## Что в папке

```
├── CLAUDE.md                     ← инструкции для Claude Code
├── КОНТЕКСТ_Домашняя_кухня.md    ← схема, правила, история проекта
├── build.js                      ← создаёт public/config.js из .env
├── .env.example                  ← образец настроек (копия → .env)
├── apps-script/
│   ├── api-patch.gs              ← дописать в конец Code.gs
│   ├── Code.gs                   ← ПОЛОЖИТЕ СЮДА ваш файл
│   └── appsscript.json           ← ПОЛОЖИТЕ СЮДА ваш файл
└── public/                       ← это и есть сайт
    ├── index.html                ← ЗАМЕНИТЕ вашим Index.html
    ├── api.js                    ← google.script.run → fetch
    ├── manifest.json, sw.js      ← установка на телефон
    └── icons/
```

Три файла кода (`Code.gs`, `appsscript.json`, `Index.html`) в эту сборку не входят, потому что у меня их не было. Скопируйте их из Apps Script на свои места.

## Шаги

**1. Apps Script**
1. Допишите содержимое `apps-script/api-patch.gs` в конец `Code.gs`.
2. ⚙️ Настройки проекта → Свойства скрипта → добавьте `API_TOKEN` = длинная случайная строка.
3. В `appsscript.json` поставьте `"access": "ANYONE_ANONYMOUS"` (`executeAs` остаётся `USER_DEPLOYING`).
4. Развертывание → **Новое развертывание** → Веб-приложение → скопируйте ссылку `/exec`.

**2. Страница `public/index.html`**
Замените заглушку вашим `Index.html` и добавьте в `<head>`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#6A55D8">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Кухня">
<link rel="manifest" href="/manifest.json">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<script src="/config.js"></script>
<script src="/api.js"></script>   <!-- обязательно ДО основного скрипта -->
```

и перед `</body>`:

```html
<script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');</script>
```

Вызовы `google.script.run` в приложении менять не нужно: `api.js` подменяет их сам.

**3. Проверка у себя на компьютере**
```
cp .env.example .env        # впишите API_URL и API_TOKEN
node build.js
python3 -m http.server --directory public 8080
```
Откройте http://localhost:8080.

**4. GitHub**
```
git init
git add .
git commit -m "Первая версия сайта"
git branch -M main
git remote add origin https://github.com/ВАШ_ЛОГИН/domashnyaya-kuhnya.git
git push -u origin main
```
Репозиторий создайте **приватным**. Перед коммитом проверьте `git status`: в списке не должно быть `.env` и `public/config.js`.

**5. Cloudflare Pages**
Workers & Pages → Create → Pages → Connect to Git → выберите репозиторий. Названия пунктов могут отличаться.
- Build command: `node build.js`
- Build output directory: `public`
- Variables (Settings → Variables and Secrets): `API_URL`, `API_TOKEN`

После деплоя откройте `https://имя.pages.dev` на iPhone в Safari → «Поделиться» → «На экран Домой». Каждый `git push` обновляет сайт сам.

## Безопасность

- Токен не лежит в git, но **виден в браузере**: любой, кто откроет сайт, найдёт его в `config.js`. Поэтому адрес сайта не публикуйте. Надёжнее закрыть сайт через Cloudflare Access (Zero Trust → Access → Applications): вход по коду из письма только для ваших адресов. По моим сведениям, для небольшого числа пользователей это бесплатно, условия проверьте на странице цен.
- При доступе «Все» старая страница Apps Script (`doGet`) тоже становится публичной. Как её закрыть, написано в комментарии в начале `api-patch.gs`.

## Проверить после запуска

- Все вкладки открываются, данные те же, что в таблице.
- «Готовить» списывает продукты в таблице.
- Кнопка «⬇️ В Excel» теперь скачивает файл сразу. Что именно делает клиентский код с ответом после скачивания, я не видел: проверьте, что не открывается пустая вкладка (если открывается, это правка пары строк, её сделает Claude Code).
- На iPhone: добавление на экран «Домой», вход, готовка, формы блюд.
- Первое открытие на новом адресе покажет карточку «Новое» ещё раз: localStorage у нового сайта пустой.

## Дальше

Этап 2 (Supabase, несколько семей, вход по почте) описан в `CLAUDE.md`. Запускайте его отдельной сессией Claude Code после недели использования этапа 1.
