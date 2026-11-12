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

for (const width of [390, 360, 320]) {
  test('«Уборка» (' + width + 'px): выбор дел, дни-темы, Готово/Перемешать/Завтра, шторка дела, расходники; кухня не затронута', { skip: !playwright }, async () => {
    const server = await serve();
    const base = 'http://127.0.0.1:' + server.address().port;
    const browser = await playwright.chromium.launch();
    const { ctx, page, errors } = await open(browser, base, width);
    try {
      // кухня как раньше: четыре вкладки, баннера уборки нет, пока график не составлен
      assert.strictEqual(await page.locator('#navKitchen .tab').count(), 4);
      assert.strictEqual(await page.locator('#rClean').count(), 0);
      const kitchenBefore = await page.evaluate(() => JSON.stringify(S.plan.map(i => i.id + i.done)));

      // переключатель
      await page.click('.mods button[data-m=clean]');
      await page.waitForSelector('.chead h2');
      assert.strictEqual((await page.textContent('.chead h2')).trim(), 'Что вы убираете?');
      assert.ok(await page.isHidden('#navKitchen'));
      assert.deepStrictEqual(await page.$$eval('#navClean .tab', a => a.map(b => b.textContent.trim())), ['🗓️Неделя', '✅Мои дела', '⭐Генеральные', '🧴Расходники']);
      await noHScroll(page, 'выбор дел');
      assert.strictEqual(await page.locator('.pick').count(), 18);
      assert.strictEqual(await page.locator('.pick.on').count(), 14);
      (await tapH(page, '.pick .box')).forEach(h => assert.ok(h >= 44, 'галочка ' + h + 'px'));
      // снять «Полить цветы», отметить «Сменить постельное»
      await page.locator('.pick', { hasText: 'Полить цветы' }).locator('.pmain').click();
      await page.locator('.pick', { hasText: 'Сменить постельное' }).locator('.box').click();
      assert.strictEqual(await page.locator('.pick.on').count(), 14);
      await page.click('button:has-text("Составить график")');
      await page.waitForSelector('.cdays');
      await noHScroll(page, 'неделя');
      assert.strictEqual(await page.locator('.cd').count(), 7);
      (await tapH(page, '.ct-act .btn')).forEach(h => assert.ok(h >= 42, 'кнопка дела ' + h + 'px'));
      (await tapH(page, '.mods button')).forEach(h => assert.ok(h >= 42, 'переключатель ' + h + 'px'));
      (await tapH(page, '.ctools .btn')).forEach(h => assert.ok(h >= 42, 'перемешать ' + h + 'px'));

      // дни-темы: Пн стирка, Вт пылесос/пыль/полы, Ср плита/шкафы, Чт душевая/туалет, Сб выходной, Вс глажка
      const by = await page.evaluate(() => Object.fromEntries(CS.tasks.map(t => [t.id, t.day])));
      assert.deepStrictEqual([by['wash.1'], by['vac.1'], by['dust.1'], by['floor.1'], by['stove.1'], by['cab.1'], by['shower.1'], by['wc.1'], by['iron.1']], [1, 2, 2, 2, 3, 3, 4, 4, 7]);
      assert.strictEqual(by['plants.1'], undefined);
      assert.ok(by['bed.1'] && by['bed.1'] !== 6);
      assert.deepStrictEqual(await page.evaluate(() => [CS.days[5].rest, CS.days[5].min]), [true, 0]);
      // сегодня среда — тема «Кухня»
      assert.match(await page.textContent('.ctheme'), /Сегодня, среда.*Кухня/);

      // «Готово» и «Отменить»
      const first = page.locator('.ctask').first();
      const before = await page.evaluate(() => CS.doneMin);
      await first.locator('.btn.primary').click();
      await page.waitForFunction(m => CS.doneMin > m, before);
      await page.locator('.ctask.done .btn.ghost').first().click();
      await page.waitForFunction(m => CS.doneMin === m, before);

      // «🎲 Перемешать»: дела со своим днём на месте
      await page.click('.ctools .btn');
      await page.waitForFunction(() => CS.tasks.length && true);
      const by2 = await page.evaluate(() => Object.fromEntries(CS.tasks.map(t => [t.id, t.day])));
      ['wash.1', 'vac.1', 'stove.1', 'shower.1', 'iron.1'].forEach(id => assert.strictEqual(by2[id], by[id], id));

      // «Завтра →» переносит одно дело, остальные стоят
      const snap = await page.evaluate(() => CS.tasks.map(t => [t.id, t.day]));
      await page.locator('.ctask .btn.ghost', { hasText: 'Завтра' }).first().click();
      await page.waitForFunction(s => CS.tasks.filter(t => s.find(x => x[0] === t.id)[1] !== t.day).length === 1, snap);

      // «Мои дела»: шторка дела — глажка 30 мин в пятницу
      await page.click('#navClean .tab[data-c=picks]');
      await page.waitForSelector('.presets');
      await noHScroll(page, 'мои дела');
      await page.locator('.pick', { hasText: 'Глажка' }).locator('.pmain').click();
      await page.waitForSelector('#dlg .cseg');
      await page.click('#dlg .cseg button:has-text("30")');
      // 2 раза в неделю → можно отметить 2 дня: Вс уже выбран, добавляем Ср; третий день (Пт) вытесняет самый ранний (Вс)
      await page.click('#dlg .cseg button:text-is("2 раза")');
      await page.click('#dlg .cseg button:text-is("Ср")');
      assert.match(await page.textContent('#dlg'), /выбрано 2 из 2/);
      await page.click('#dlg .cseg button:text-is("Пт")');
      assert.deepStrictEqual(await page.$$eval('#dlg .cseg button.on', a => a.map(b => b.textContent)).then(x => x.filter(t => /^(Пн|Вт|Ср|Чт|Пт|Сб|Вс)$/.test(t))), ['Ср', 'Пт']);
      assert.ok(await page.isDisabled('#dlg .cseg button:text-is("Сб")'), 'выходной не выбрать');
      await noHScroll(page, 'шторка');
      await page.click('#dlg .btn.primary');
      await page.waitForFunction(() => { const a = CS.tasks.filter(t => t.group === 'iron').map(t => t.day).sort().join(); return a === '3,5' && CS.tasks.find(t => t.id === 'iron.1').min === 30; });
      assert.match(await page.textContent('.pick:has-text("Глажка")'), /30 мин · 2 р\/нед · Ср, Пт/);
      // режим «Всё вперемешку»
      await page.click('.preset:has-text("Всё вперемешку")');
      await page.waitForFunction(() => CS.settings.mode === 'mix' && CS.tasks.every(t => t.rnd));

      for (const c of ['general', 'supplies']) {
        await page.click('#navClean .tab[data-c=' + c + ']');
        await page.waitForSelector('.chead');
        await noHScroll(page, c);
      }
      assert.strictEqual(await page.locator('.cbox').count(), 5);
      await page.locator('.cbox').first().locator('.btn.primary').click();
      await page.fill('#dlg input[type=number]', '500');
      await page.click('#dlg .btn.primary');
      await page.waitForFunction(() => CS.supplies[0].stock === 500);

      // баннер на кухне: если на сегодня есть несделанное
      await page.click('.mods button[data-m=kitchen]');
      await page.waitForSelector('#rClean');
      assert.match(await page.textContent('#rClean'), /🧽 Уборка: \d+ · \d+ мин/);
      assert.strictEqual(await page.evaluate(() => JSON.stringify(S.plan.map(i => i.id + i.done))), kitchenBefore, 'меню кухни не изменилось');

      // перезагрузка: данные на месте, открывается на «Уборке»
      await page.click('.mods button[data-m=clean]');
      // перезагрузка: данные на месте, открывается на «Уборке»
      await page.click('.mods button[data-m=clean]');
      await page.reload();
      await page.waitForSelector('.cdays');
      assert.strictEqual(await page.evaluate(() => CS.settings.mode), 'mix');

      // помощь в разделе «Уборка» открывает тему
      await page.click('#btnHelp');
      await page.waitForSelector('#help-clean');
      assert.deepStrictEqual(errors, []);
    } finally { await ctx.close(); await browser.close(); server.close(); }
  });
}
