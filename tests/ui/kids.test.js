'use strict';
// Модуль «Дети» в браузере на 390 / 360 / 320 px: первый запуск → сегодня/завтра → «Собрано» → событие → неделя → дети →
// баннер на кухне вечером → цели Метрики → перезагрузка. Нужен Playwright; иначе тест пропускается.
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

/** Среда 4 ноября 2026, 19:30 по Алматы — вечер: экран «Сегодня» открывается на «Завтра». */
async function open(browser, base, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
  await ctx.clock.setFixedTime(new Date('2026-11-04T19:30:00+05:00'));
  await ctx.route(/mc\.yandex\.ru/, r => r.abort());   // Метрика в тестах не ходит в сеть; вызовы копятся в ym.a
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|manifest|ERR_NAME_NOT_RESOLVED|fonts|cdnjs|net::|mc\.yandex/.test(m.text())) errors.push(m.text()); });
  await page.goto(base + '/');
  await page.waitForSelector('.auth');
  await page.fill('input[type=email]', 'mama@example.com');
  await page.fill('input[type=password]', 'password1');
  await page.click('.auth .btn.primary');
  await page.waitForSelector('#navKitchen .tab');
  return { ctx, page, errors };
}
const noHScroll = async (page, label) => {
  const o = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(o[0] <= o[1], label + ': горизонтальный скролл ' + o[0] + ' > ' + o[1]);
};
const tapH = async (page, sel) => page.$$eval(sel, els => els.filter(e => e.offsetParent).map(e => Math.round(e.getBoundingClientRect().height)));
const goals = page => page.evaluate(() => (window.ym && window.ym.a || []).filter(a => a[1] === 'reachGoal').map(a => a[2]));

for (const width of [390, 360, 320]) {
  test('«Дети» (' + width + 'px): первый запуск, завтра, «Собрано», событие, неделя, дети, баннер, Метрика', { skip: !playwright }, async () => {
    const server = await serve();
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await playwright.chromium.launch();
    const { ctx, page, errors } = await open(browser, base, width);
    try {
      assert.ok(await page.isHidden('#kbanner'), 'до настройки баннера нет');
      const kitchenBefore = await page.evaluate(() => JSON.stringify(S.plan.map(i => i.id + i.done)));
      (await tapH(page, '.mods button')).forEach(h => assert.ok(h >= 42, 'переключатель ' + h + 'px'));

      // первый запуск
      await page.click('.mods button[data-m=kids]');
      await page.waitForSelector('.chead h2');
      assert.strictEqual((await page.textContent('.chead h2')).trim(), 'Кто у вас?');
      assert.ok(await page.isHidden('#navKitchen'));
      assert.deepStrictEqual(await page.$$eval('#navKids .tab', a => a.map(b => b.textContent.trim())), ['🎒Сегодня', '🗓️Неделя', '📅События', '👧Дети']);
      await noHScroll(page, 'первый запуск');
      await page.fill('.cbox input[type=text]', 'Алия');
      await page.click('.cbox .fchip:has-text("Бассейн")');
      await page.click('button:has-text("Ещё ребёнок")');
      await page.locator('.cbox').nth(1).locator('input[type=text]').fill('Тимур');
      await page.locator('.cbox').nth(1).locator('.seg button:has-text("Садик")').click();
      assert.strictEqual(await page.locator('.cbox').nth(0).locator('input[type=text]').inputValue(), 'Алия', 'имя не теряется при перерисовке');
      await page.click('button:has-text("Готово · 3 зан.")');
      await page.waitForFunction(() => KS && KS.ready);

      // вечер среды → открылось «Завтра» (четверг): школа, садик, бассейн
      assert.match(await page.textContent('.chead h2'), /^Завтра, 5 ноя/);
      assert.deepStrictEqual(await page.$$eval('.kitem .ct-main b', a => a.map(x => x.textContent)), ['Школа · Алия', 'Садик · Тимур', 'Бассейн · Алия']);
      await noHScroll(page, 'завтра');
      (await tapH(page, '.kitem .ct-act .btn')).forEach(h => assert.ok(h >= 42, 'кнопка ' + h + 'px'));
      (await tapH(page, '.kthing')).forEach(h => assert.ok(h >= 40, 'вещь ' + h + 'px'));

      // вещи отмечаются на телефоне; «✓ Собрано» пишет в базу
      const pool = page.locator('.kitem', { hasText: 'Бассейн' });
      await pool.locator('.kthing:has-text("Шапочка")').click();
      assert.strictEqual(await pool.locator('.kthing.on').count(), 1);
      await pool.locator('.btn.primary').click();
      await page.waitForFunction(() => KS.tomorrowItems.find(i => i.name === 'Бассейн').packed);
      assert.strictEqual(await page.locator('.kitem.done').count(), 1);
      assert.match(await page.textContent('.chead .muted'), /Осталось собрать: 2 из 3/);

      // событие: ДР друга в субботу, напомнить за 7 дней
      await page.click('.kadd button:has-text("Событие")');
      await page.waitForSelector('#dlg .cseg');
      await noHScroll(page, 'шторка события');
      await page.click('#dlg .cseg button:has-text("День рождения")');
      await page.fill('#dlg input[type=text]', 'ДР Димы — подарок');
      await page.fill('#dlg input[type=date]', '2026-11-07');
      await page.click('#dlg .btn.primary');
      await page.waitForFunction(() => KS.events.length === 1 && KS.events[0].remind === 7);
      assert.match(await page.textContent('#view'), /Скоро[\s\S]*ДР Димы — подарок[\s\S]*через 3 дн\./);

      // неделя: в субботу — день рождения
      await page.click('#navKids .tab[data-k=week]');
      await page.waitForSelector('.cdays');
      await noHScroll(page, 'неделя');
      await page.click('.cd:has-text("Сб")');
      assert.match(await page.textContent('#view'), /Суббота, 7 ноя[\s\S]*ДР Димы/);

      // дети: правка занятия — бассейн отвозит Муж, Пн и Ср
      await page.click('#navKids .tab[data-k=kids]');
      await page.waitForSelector('.cbox');
      await noHScroll(page, 'дети');
      await page.click('.pick-row:has-text("Бассейн")');
      await page.waitForSelector('#dlg .cseg.days');
      for (const d of ['Вт', 'Чт', 'Пн', 'Ср']) await page.click('#dlg .cseg.days button:text-is("' + d + '")');
      await page.click('#dlg .cseg button:text-is("Муж")');
      await page.click('#dlg .btn.primary');
      await page.waitForFunction(() => { const a = KS.acts.find(x => x.name === 'Бассейн'); return a.days.join() === '1,3' && a.driver === 'Муж'; });
      // «Кто отвозит»: добавить Бабушку
      await page.fill('.cbox:has-text("Кто отвозит") input', 'Бабушка');
      await page.click('.cbox:has-text("Кто отвозит") button:has-text("Добавить")');
      await page.waitForFunction(() => KS.people.join() === 'Я,Муж,Бабушка');

      // кухня: вечером полоска «🎒 Собрать. Завтра: …»; меню кухни не тронуто
      await page.click('.mods button[data-m=kitchen]');
      await page.waitForSelector('#kbanner:not([hidden])');
      assert.match(await page.textContent('#kbanner'), /Собрать\. Завтра: 🏫 Школа \(Алия\), 🧸 Садик \(Тимур\)/);
      assert.strictEqual(await page.evaluate(() => JSON.stringify(S.plan.map(i => i.id + i.done))), kitchenBefore);
      await page.click('#kbanner .btn');
      await page.waitForSelector('#navKids:not([hidden])');

      // Метрика: цели и просмотры
      const g = await goals(page);
      ['kids_setup', 'kids_packed', 'kids_event_save', 'kids_activity_save'].forEach(x => assert.ok(g.includes(x), 'цель ' + x + ' в ' + g));
      const hits = await page.evaluate(() => window.ym.a.filter(a => a[1] === 'hit').map(a => a[2]));
      assert.ok(hits.some(u => /#kids\/week$/.test(u)), 'просмотр недели: ' + hits);

      // перезагрузка: всё на месте, открываются «Дети»
      await page.reload();
      await page.waitForSelector('.kitem');
      assert.strictEqual(await page.evaluate(() => [KS.kids.length, KS.acts.length, KS.events.length].join()), '2,3,1');
      await page.click('#btnHelp');
      await page.waitForSelector('#help-kids');
      assert.deepStrictEqual(errors, []);
    } finally { await ctx.close(); await browser.close(); server.close(); }
  });
}
