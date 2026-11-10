'use strict';
// Модуль «Уборка» в браузере на 390 и 360 px: онбординг → график → «Готово» / «Завтра» → расходники → комнаты.
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

async function open(browser, base, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
  await ctx.clock.setFixedTime(new Date('2026-11-04T12:00:00+05:00'));   // среда
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|manifest|ERR_NAME_NOT_RESOLVED|fonts|cdnjs|net::/.test(m.text())) errors.push(m.text()); });
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

for (const width of [390, 360]) {
  test('«Уборка» (' + width + 'px): онбординг, график, Готово/Завтра, расходники, комнаты; кухня не затронута', { skip: !playwright }, async () => {
    const server = await serve();
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await playwright.chromium.launch();
    const { ctx, page, errors } = await open(browser, base, width);
    try {
      // кухня как раньше: четыре вкладки, баннера уборки нет, пока график не составлен
      assert.strictEqual(await page.locator('#navKitchen .tab').count(), 4);
      assert.ok(await page.isHidden('#cbanner'));
      const kitchenBefore = await page.evaluate(() => JSON.stringify(S.plan.map(i => i.id + i.done)));

      // переключатель
      await page.click('.mods button[data-m=clean]');
      await page.waitForSelector('.chead h2');
      assert.strictEqual((await page.textContent('.chead h2')).trim(), 'Сколько у вас комнат?');
      assert.ok(await page.isHidden('#navKitchen'));
      assert.strictEqual(await page.locator('#navClean .tab').count(), 4);
      await noHScroll(page, 'онбординг');

      // 3 комнаты по умолчанию → «Составить график»
      assert.strictEqual(await page.locator('.rrow').count(), 3);
      await page.click('.cnt button:nth-child(2)');
      assert.strictEqual(await page.locator('.rrow').count(), 2);
      await page.click('.cnt button:nth-child(3)');
      await page.click('text=Составить график');
      await page.waitForSelector('.chart');
      await noHScroll(page, 'неделя');
      assert.strictEqual(await page.locator('.ccol').count(), 7);
      assert.ok(await page.isVisible('.cquick'));
      (await tapH(page, '.ct-act .btn')).forEach(h => assert.ok(h >= 42, 'кнопка дела ' + h + 'px'));
      (await tapH(page, '.mods button')).forEach(h => assert.ok(h >= 42, 'переключатель ' + h + 'px'));

      // Сегодня — среда, воскресенье отдыхает, ни в один день не больше лимита
      const days = await page.evaluate(() => CS.days.map(d => [d.day, d.min, d.rest]));
      days.forEach(([d, m, rest]) => assert.ok(m <= 60, 'день ' + d + ': ' + m));
      assert.deepStrictEqual(days[6], [7, 0, true]);

      // «Готово» на первом деле сегодня → прогресс растёт, дело зачёркнуто, «Отменить» возвращает
      const first = page.locator('.ctask').first();
      const title = (await first.locator('b').first().textContent()).replace('✓ ', '');
      const before = await page.evaluate(() => CS.doneMin);
      await first.locator('.btn.primary').click();
      await page.waitForFunction(m => CS.doneMin > m, before);
      assert.ok((await page.locator('.ctask.done b').first().textContent()).includes(title));
      await page.locator('.ctask.done .btn.ghost').first().click();
      await page.waitForFunction(m => CS.doneMin === m, before);

      // «Завтра →» переносит одно дело, остальные стоят
      const snap = await page.evaluate(() => CS.tasks.map(t => [t.id, t.day]));
      const id = await page.evaluate(() => CS.tasks.find(t => t.day === CS.today && !t.done).id);
      await page.locator('.ctask', { hasText: '' }).first().locator('.btn.ghost').click();
      await page.waitForFunction(s => CS.tasks.filter((t, i) => s.find(x => x[0] === t.id)[1] !== t.day).length === 1, snap);

      // вкладки: генеральные, расходники, комнаты; ничего не вылезает за экран
      for (const c of ['general', 'supplies', 'rooms']) {
        await page.click('#navClean .tab[data-c=' + c + ']');
        await page.waitForSelector('.chead');
        await noHScroll(page, c);
      }
      await page.click('#navClean .tab[data-c=supplies]');
      assert.strictEqual(await page.locator('.cbox').count(), 5);
      // «＋ Купила» → остаток появился
      await page.locator('.cbox').first().locator('.btn.primary').click();
      await page.fill('#dlg input[type=number]', '500');
      await page.click('#dlg .btn.primary');
      await page.waitForFunction(() => CS.supplies[0].stock === 500);
      await page.waitForSelector('text=Осталось');

      // комнаты: смена времени сохраняется
      await page.click('#navClean .tab[data-c=rooms]');
      await page.click('.fchip:has-text("45 мин")');
      await page.click('text=Сохранить');
      await page.waitForFunction(() => CS.settings.limit === 45);

      // баннер на кухне: если на сегодня есть несделанное
      await page.click('.mods button[data-m=kitchen]');
      await page.waitForSelector('#cbanner:not([hidden])');
      assert.match(await page.textContent('#cbanner'), /🧽 Уборка: \d+ зад\. · \d+ мин/);
      (await tapH(page, '#cbanner .btn')).forEach(h => assert.ok(h >= 34, 'кнопка баннера ' + h + 'px'));
      assert.strictEqual(await page.evaluate(() => JSON.stringify(S.plan.map(i => i.id + i.done))), kitchenBefore, 'меню кухни не изменилось');

      // перезагрузка: данные на месте, открывается на «Уборке»
      await page.click('.mods button[data-m=clean]');
      await page.reload();
      await page.waitForSelector('.chart');
      assert.strictEqual(await page.evaluate(() => CS.settings.limit), 45);

      // помощь в разделе «Уборка» открывает тему
      await page.click('#btnHelp');
      await page.waitForSelector('#help-clean');
      assert.deepStrictEqual(errors, []);
    } finally { await ctx.close(); await browser.close(); server.close(); }
  });
}
