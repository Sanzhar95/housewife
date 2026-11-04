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
