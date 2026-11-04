'use strict';
// Интерфейс на ширине 390px: вход → меню → готовка → перезагрузка. Нужен Playwright (есть в среде); иначе тест пропускается.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { stubSource } = require('./stub');

let playwright = null;
try { playwright = require('playwright'); } catch (e) { /* нет Playwright */ }
const seed = require('../fixtures/state.synthetic.snapshot.json');
const PUB = path.join(__dirname, '..', '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };

function serve() {
  const srv = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/config.js') { res.setHeader('content-type', TYPES['.js']); return res.end('window.APP_CONFIG={SUPABASE_URL:"https://stub.invalid",SUPABASE_ANON_KEY:"stub"};'); }
    if (url === '/vendor/supabase.js') { res.setHeader('content-type', TYPES['.js']); return res.end(stubSource(seed)); }
    const f = path.join(PUB, url === '/' ? 'index.html' : url);
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('нет'); }
    res.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream');
    res.end(fs.readFileSync(f));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

test('вход, меню, готовка, перезагрузка (390px)', { skip: !playwright }, async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await playwright.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|manifest|ERR_NAME_NOT_RESOLVED|fonts|cdnjs|net::/.test(m.text())) errors.push(m.text()); });
  const shot = n => page.screenshot({ path: path.join(process.env.UI_SHOTS || '/tmp', n + '.png') });
  try {
    await page.goto(base + '/');
    await page.waitForSelector('.auth');
    assert.ok(await page.isHidden('nav'), 'на экране входа навигации нет');
    assert.ok(await page.isHidden('#btnNotify'));
    await shot('01-login');

    await page.fill('input[type=email]', 'mama@example.com');
    await page.fill('input[type=password]', 'wrongpass1');
    await page.click('.auth .btn.primary');
    await page.waitForSelector('.warnline:not([hidden])');
    assert.strictEqual((await page.textContent('.warnline')).trim(), 'Неверная почта или пароль');
    await shot('02-login-error');

    await page.fill('input[type=password]', 'password1');
    await page.click('.auth .btn.primary');
    await page.waitForSelector('nav .tab');
    assert.ok(await page.isVisible('nav'));
    assert.ok(!(await page.evaluate(() => document.body.classList.contains('anon'))));
    await shot('03-menu');

    // «Готовить» на Омлете (завтрак, 3-й день): экран меняется сразу, база пишется следом
    await page.evaluate(() => { window.__stub.delay = 400; });
    const t0 = Date.now();
    await page.evaluate(async () => { await act('cookItem', 'pl000005', { portions: '2' }); });
    const dt = Date.now() - t0;
    assert.ok(dt < 300, 'экран должен обновиться сразу, а было ' + dt + ' мс (запись идёт 400 мс)');
    assert.ok(await page.evaluate(() => S.plan.find(i => i.id === 'pl000005').done));
    await page.waitForFunction(() => window.__stub.srv.version >= 1);
    assert.ok(await page.evaluate(() => window.__stub.srv.state().plan.find(i => i.id === 'pl000005').done));
    await shot('04-after-cook');

    await page.reload();
    await page.waitForSelector('nav .tab');
    assert.ok(await page.evaluate(() => S.plan.find(i => i.id === 'pl000005').done), 'после перезагрузки сессия и данные на месте');

    // настройки: «Вы вошли как», приглашение, выход
    await page.click('#btnNotify');
    await page.waitForSelector('.set-links');
    assert.match(await page.textContent('#dlgBox'), /Вы вошли как test@example.com/);
    assert.ok(await page.isVisible('text=Сменить пароль'));
    assert.ok(await page.isVisible('text=Скачать копию'));
    await shot('05-settings');
    await page.click('text=Пригласить в семью');
    await page.waitForSelector('.link-box');
    assert.match(await page.inputValue('.link-box input'), /\/#\/join\/newtoken456789$/);
    await page.keyboard.press('Escape');
    // обычному пользователю «Новая семья для друга» не показывается
    assert.strictEqual(await page.locator('text=Новая семья для друга').count(), 0);
    // администратору показывается, создаёт ссылку на новую семью
    await page.evaluate(() => localStorage.setItem('stub-admin', '1'));
    await page.reload();
    await page.waitForSelector('nav .tab');
    await page.waitForFunction(() => isAdmin === true);
    await page.click('#btnNotify');
    await page.click('text=Новая семья для друга');
    await page.fill('#dlgBox input[type=text]', 'Семья Ивановых');
    await shot('06-friend-form');
    await page.click('text=Создать ссылку');
    await page.waitForSelector('.link-box');
    assert.match(await page.inputValue('.link-box input'), /\/#\/join\/family14token$/);
    await shot('07-friend-link');
    await page.keyboard.press('Escape');
  } finally {
    await browser.close(); server.close();
  }
  assert.deepStrictEqual(errors, []);
});

test('ссылка-приглашение: плохой токен — понятное сообщение; хороший — вход', { skip: !playwright }, async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await playwright.chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  try {
    await page.goto(base + '/#/join/badtoken1234');
    await page.waitForSelector('.auth');
    assert.match(await page.textContent('.auth .hand'), /Вас пригласили/);
    await page.fill('input[type=email]', 'papa@example.com');
    await page.fill('input[type=password]', 'password1');
    await page.click('.auth .btn.primary');
    await page.waitForSelector('.warnline:not([hidden])');
    assert.match(await page.textContent('.warnline'), /^Ссылка не подходит: она уже использована или устарела/);
    await page.goto(base + '/#/join/goodtoken123');
    await page.reload();
    await page.fill('input[type=email]', 'papa@example.com');
    await page.fill('input[type=password]', 'password1');
    await page.click('.auth .btn.primary');
    await page.waitForSelector('nav .tab');
  } finally { await browser.close(); server.close(); }
});

// Загрузка блюд из Excel (390px). SheetJS берётся с CDN и в тестовой среде может быть недоступен,
// поэтому window.XLSX подменён заглушкой: «файл» — это JSON с массивом строк листа, XLSX.read его разбирает.
// Настоящее чтение xlsx проверяется в tests/import-dishes (чистый разбор) и вручную на телефоне.
test('блюда: загрузка из Excel — бланк, проверка, подтверждение, повтор (390px)', { skip: !playwright }, async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await playwright.chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|manifest|ERR_NAME_NOT_RESOLVED|fonts|cdnjs|net::/.test(m.text())) errors.push(m.text()); });
  const shot = n => page.screenshot({ path: path.join(process.env.UI_SHOTS || '/tmp', n + '.png') });
  await page.route(/cdnjs\.cloudflare\.com/, r => r.abort());
  await page.addInitScript(() => {
    window.XLSX = {
      read: buf => ({ SheetNames: ['s'], Sheets: { s: JSON.parse(new TextDecoder().decode(buf)) } }),
      utils: { sheet_to_json: ws => ws }
    };
  });
  const upload = (aoa) => page.setInputFiles('#fileIn', { name: 'dishes.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from(JSON.stringify(aoa)) });
  try {
    await page.goto(base + '/');
    await page.fill('input[type=email]', 'mama@example.com');
    await page.fill('input[type=password]', 'password1');
    await page.click('.auth .btn.primary');
    await page.waitForSelector('nav .tab');
    await page.click('nav .tab[data-t=dishes]');
    assert.ok(await page.isVisible('text=📥 Из Excel'));
    assert.ok(await page.isVisible('text=📄 Бланк'));

    // свои блюда с уникальными названиями: пример из бланка пересекается с продуктами тестовой семьи
    const H = await page.evaluate(() => ImportDishes.HEAD);
    const template = [H,
      ['Тест-плов', 'основное', 'обед, ужин', 'да', 6, 2, '', 'Тест-рис', 0.5, 'кг'],
      ['', '', '', '', '', '', '', 'Тест-курица', 800, 'г'],
      ['Тест-салат', 'салат', '', 'нет', '', '', '', 'Тест-огурцы', 300, 'г'],
      ['Тест-гречка', 'гарнир', 'обед', '', 4, 1, '', 'Тест-крупа', 250, 'г']];
    const before = await page.evaluate(() => S.dishes.length);

    await page.click('text=📥 Из Excel');
    await upload(template);
    await page.waitForSelector('#dlgBox .imp-row');
    assert.strictEqual(await page.locator('#dlgBox .imp-row').filter({ hasText: '🆕' }).count(), 3);
    assert.match(await page.textContent('#dlgBox'), /новых: 3/);
    await page.waitForTimeout(500);   // шторка выезжает снизу
    await shot('10-dishes-import');
    await page.click('#dlgBox .btn.primary:has-text("Загрузить (3)")');
    await page.waitForFunction(n => S.dishes.length === n + 3, before);
    await page.waitForFunction(() => !document.getElementById('dlg').open);

    // двойной тап по «Загрузить (N)»: блюда создаются один раз
    const tpl2 = [H,
      ['Тест-дубль-1', 'основное', '', '', '', '', '', 'Тест-дубль-продукт', 100, 'г'],
      ['Тест-дубль-2', 'салат', '', '', '', '', '', 'Тест-дубль-продукт', 50, 'г']];
    const before2 = await page.evaluate(() => S.dishes.length);
    await page.click('text=📥 Из Excel');
    await upload(tpl2);
    await page.waitForSelector('#dlgBox .imp-row');
    await page.waitForTimeout(500);
    await page.evaluate(() => { const b = document.querySelector('#dlgBox .dlg-actions .btn.primary'); b.click(); b.click(); });
    await page.waitForFunction(n => S.dishes.length >= n + 2, before2);
    await page.waitForFunction(() => !document.getElementById('dlg').open);
    await page.waitForTimeout(500);
    assert.strictEqual(await page.evaluate(() => S.dishes.length), before2 + 2);
    assert.strictEqual(await page.evaluate(() => S.dishes.filter(d => d.name.startsWith('Тест-дубль')).length), 2);

    // повтор того же файла: всё «уже есть», кнопка «Закрыть»
    await page.click('text=📥 Из Excel');
    await upload(template);
    await page.waitForSelector('#dlgBox .imp-row');
    assert.strictEqual(await page.locator('#dlgBox .imp-row').filter({ hasText: '✔️' }).count(), 3);
    assert.match(await page.textContent('#dlgBox'), /уже есть: 3/);
    assert.ok(await page.isVisible('#dlgBox .btn.primary:has-text("Закрыть")'));
    await shot('11-dishes-import-again');
    await page.click('#dlgBox .btn.primary:has-text("Закрыть")');
    assert.strictEqual(await page.evaluate(() => S.dishes.length), before + 5);

    // только заголовок
    await page.click('text=📥 Из Excel');
    await upload([template[0]]);
    await page.waitForSelector('#dlgBox >> text=В файле нет блюд');
    await page.keyboard.press('Escape');

    // чужой бланк (склада)
    await page.click('text=📥 Из Excel');
    await upload([['Название', 'Ед.', 'Купить (подсказка)', 'Куплено'], ['Картофель', 'КГ', '', 3]]);
    await page.waitForSelector('text=Это не наш бланк');
  } finally { await browser.close(); server.close(); }
  assert.deepStrictEqual(errors, []);
});

// Геометрия экрана «Меню» на 390×844 (iPhone): «Сегодня» на первом экране, компактные баннер, плашка «Новое», счётчики.
test('меню: геометрия шапки, плашки «Новое», счётчиков и блока «Сегодня» (390×844)', { skip: !playwright }, async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await playwright.chromium.launch();
  const NAV = 72;
  const login = async (page) => {
    await page.goto(base + '/');
    await page.fill('input[type=email]', 'mama@example.com');
    await page.fill('input[type=password]', 'password1');
    await page.click('.auth .btn.primary');
    await page.waitForSelector('nav .tab');
    await page.waitForSelector('.day-title');
  };
  const box = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, w: r.width }; }, sel);
  try {
    // 1) плашка «Новое» показана (чистое хранилище)
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await login(page);
    const news = await box(page, '.news');
    assert.ok(news, 'плашка «Новое» показана при чистом хранилище');
    const tx = await box(page, '.news .tx');
    assert.ok(tx.w >= news.w * 0.6, `текст плашки ${Math.round(tx.w)}px из ${Math.round(news.w)}px — меньше 60%`);
    assert.ok(await page.isVisible('#banner'), 'в тестовых данных есть продукты на исходе — строка видна');
    assert.ok(tx.h <= 3 * 19.5 + 1, `текст плашки «Новое» ${tx.h}px — больше 3 строк`);
    const newsBtn = await box(page, '.news .btn');
    assert.ok(newsBtn.h >= 42, `кнопка «Как это работает» ${newsBtn.h}px, нужно ≥ 42`);
    const clip = await page.evaluate(() => { const e = document.querySelector('#banner .txt'); return [e.scrollWidth, e.clientWidth]; });
    assert.ok(clip[0] <= clip[1], `текст «Пора докупить» обрезан: ${clip[0]} > ${clip[1]}`);
    const banner = await box(page, '#banner');
    assert.ok(banner && banner.h <= 44, `строка «Пора докупить» ${banner && banner.h}px, нужно ≤ 44`);
    for (const t of ['stock', 'dishes']) {
      await page.click(`nav .tab[data-t=${t}]`);
      const b = await box(page, '#banner');
      assert.ok(b.h <= 44, `«Пора докупить» на вкладке ${t}: ${b.h}px`);
    }
    await page.click('nav .tab[data-t=week]');
    const chk = await box(page, '.toolbar .check');
    assert.ok(chk.h >= 42, `строка «Только из того, что есть» ${chk.h}px, нужно ≥ 42`);
    const stats = await page.evaluate(() => [...document.querySelectorAll('.stats .stat')].map(e => e.getBoundingClientRect().height));
    assert.strictEqual(stats.length, 3);
    stats.forEach(h => assert.ok(h <= 110, `карточка-счётчик ${h}px, нужно ≤ 110`));
    const dtNews = await box(page, '.day-title');
    assert.ok(dtNews.bottom <= 740, `«Сегодня» с плашкой «Новое» заканчивается на ${dtNews.bottom}px, нужно ≤ 740`);
    await ctx.close();

    // 2) без плашки «Новое»: заголовок «Сегодня» целиком на первом экране
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const p2 = await ctx2.newPage();
    await p2.addInitScript(() => { try { localStorage.setItem('dk_news_portions_v1', '1'); } catch (e) { /* нет хранилища */ } });
    await login(p2);
    assert.strictEqual(await p2.locator('.news').count(), 0);
    const dt = await box(p2, '.day-title');
    assert.ok(dt.bottom < 844 - NAV, `«Сегодня» заканчивается на ${dt.bottom}px, нужно < ${844 - NAV}`);
    await ctx2.close();
  } finally { await browser.close(); server.close(); }
});

// «Склад», «Блюда», «Матрица» на 390×844: панель действий в один ряд, плавающая кнопка не перекрывает конец списка,
// названия с заглавной буквы только на экране, нет «мин. 0», эмодзи и название блюда в матрице в одной строке.
test('склад, блюда, матрица: геометрия и отображение названий (390×844)', { skip: !playwright }, async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await playwright.chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  try {
    await page.goto(base + '/');
    await page.fill('input[type=email]', 'mama@example.com');
    await page.fill('input[type=password]', 'password1');
    await page.click('.auth .btn.primary');
    await page.waitForSelector('nav .tab');
    // подготовка отображения: продукт с маленькой буквы и нулевым минимумом, блюдо с длинным названием
    await page.evaluate(() => {
      S.products[0].name = 'болгарский перец'; S.products[0].min = 0;
      S.dishes[0].name = 'бефстроганов с картофельным пюре и грибами';
      window.__rawP = S.products[0].name; window.__rawD = S.dishes[0].name; render();
    });
    const box = (sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, w: r.width }; }, sel);
    const fabClear = async (tab, cardSel) => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(100);
      const last = await page.evaluate(s => { const l = [...document.querySelectorAll(s)].pop().getBoundingClientRect(); return l.bottom; }, cardSel);
      const fab = await box('.fab');
      assert.ok(last <= fab.top, `${tab}: последняя карточка заканчивается на ${last}px, плавающая кнопка начинается на ${fab.top}px`);
    };

    for (const [t, sel] of [['stock', '.tile'], ['dishes', '.dishes .card']]) {
      await page.click(`nav .tab[data-t=${t}]`);
      const row = await box('.actions-row');
      assert.ok(row.h <= 56, `${t}: панель действий ${row.h}px, нужно ≤ 56 (один ряд)`);
      const bh = await page.evaluate(() => [...document.querySelectorAll('.actions-row .btn')].map(b => b.getBoundingClientRect().height));
      bh.forEach(x => assert.ok(x >= 42, `${t}: кнопка действий ${x}px, нужно ≥ 42`));
      await fabClear(t, sel);
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    // склад: заглавная буква только на экране; поиск по исходному названию; без «мин. 0»
    await page.click('nav .tab[data-t=stock]');
    await page.fill('input[type=search]', 'болг');
    const names = await page.$$eval('.tile h3', es => es.map(e => e.textContent));
    assert.ok(names.includes('Болгарский перец'), 'на экране: ' + names.join(' | '));
    assert.strictEqual(await page.evaluate(() => S.products[0].name), 'болгарский перец', 'данные не менялись');
    assert.strictEqual(await page.evaluate(() => window.__rawP), 'болгарский перец');
    const foot = await page.$$eval('.tile', es => es.map(e => ({ n: e.querySelector('h3').textContent, f: (e.querySelector('.tile-foot') || { textContent: '' }).textContent })));
    assert.ok(!/мин\. 0/.test(foot.find(x => x.n === 'Болгарский перец').f), 'у минимума 0 нет подписи «мин. 0»');
    // форма редактирования — по исходному значению
    await page.click('.tile .icon-act');
    assert.strictEqual(await page.inputValue('#dlgBox input[type=text]'), 'болгарский перец');
    await page.keyboard.press('Escape');
    await page.fill('input[type=search]', '');

    // матрица: эмодзи и название блюда на одной строке
    await page.click('nav .tab[data-t=matrix]');
    const pos = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.matrix tbody .rowbtn')].find(x => /бефстроганов/i.test(x.textContent));
      const em = b.querySelector('.em'), nm = b.querySelector('.nm');
      return em && nm ? [em.getBoundingClientRect().top, nm.getBoundingClientRect().top] : null;
    });
    assert.ok(pos, 'в ячейке блюда есть отдельные .em и .nm');
    assert.ok(Math.abs(pos[0] - pos[1]) <= 4, `эмодзи (${pos[0]}) и название (${pos[1]}) на разных строках`);
    const unit = await page.evaluate(() => { const th = document.querySelector('.matrix thead th:not(.rowh)'); return th.getBoundingClientRect().height; });
    assert.ok(unit <= 96, `заголовок столбца ${unit}px — слишком высокий`);
  } finally { await browser.close(); server.close(); }
  assert.deepStrictEqual(errors, []);
});
