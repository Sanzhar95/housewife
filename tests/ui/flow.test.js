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
    assert.ok(await page.isVisible('text=📥 Загрузить блюда из Excel'));
    assert.ok(await page.isVisible('text=📄 Бланк блюд'));

    // свои блюда с уникальными названиями: пример из бланка пересекается с продуктами тестовой семьи
    const H = await page.evaluate(() => ImportDishes.HEAD);
    const template = [H,
      ['Тест-плов', 'основное', 'обед, ужин', 'да', 6, 2, '', 'Тест-рис', 0.5, 'кг'],
      ['', '', '', '', '', '', '', 'Тест-курица', 800, 'г'],
      ['Тест-салат', 'салат', '', 'нет', '', '', '', 'Тест-огурцы', 300, 'г'],
      ['Тест-гречка', 'гарнир', 'обед', '', 4, 1, '', 'Тест-крупа', 250, 'г']];
    const before = await page.evaluate(() => S.dishes.length);

    await page.click('text=📥 Загрузить блюда из Excel');
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
    await page.click('text=📥 Загрузить блюда из Excel');
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
    await page.click('text=📥 Загрузить блюда из Excel');
    await upload(template);
    await page.waitForSelector('#dlgBox .imp-row');
    assert.strictEqual(await page.locator('#dlgBox .imp-row').filter({ hasText: '✔️' }).count(), 3);
    assert.match(await page.textContent('#dlgBox'), /уже есть: 3/);
    assert.ok(await page.isVisible('#dlgBox .btn.primary:has-text("Закрыть")'));
    await shot('11-dishes-import-again');
    await page.click('#dlgBox .btn.primary:has-text("Закрыть")');
    assert.strictEqual(await page.evaluate(() => S.dishes.length), before + 5);

    // только заголовок
    await page.click('text=📥 Загрузить блюда из Excel');
    await upload([template[0]]);
    await page.waitForSelector('#dlgBox >> text=В файле нет блюд');
    await page.keyboard.press('Escape');

    // чужой бланк (склада)
    await page.click('text=📥 Загрузить блюда из Excel');
    await upload([['Название', 'Ед.', 'Купить (подсказка)', 'Куплено'], ['Картофель', 'КГ', '', 3]]);
    await page.waitForSelector('text=Это не наш бланк');
  } finally { await browser.close(); server.close(); }
  assert.deepStrictEqual(errors, []);
});
