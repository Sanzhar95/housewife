#!/usr/bin/env node
// Перенос данных из выгрузки Google Таблицы: node tools/migrate.js "Домашняя Кухня.xlsx"
// Логин и пароль спрашиваются при запуске и нигде не сохраняются. Ключи service_role не нужны.
const { buildMigration } = require('./migration');
const { reconcile } = require('./reconcile');
const cli = require('./cli');

const EMPTY = ['products', 'dishes', 'plan', 'log', 'purchases'];

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('Использование: node tools/migrate.js файл.xlsx'); process.exit(2); }
  const sheets = cli.loadSheets(file);
  const m = buildMigration(sheets);
  console.log('В выгрузке:', JSON.stringify(m.report.counts));
  if (Object.keys(m.report.remapped).length) console.log('ID заменены (нецелые числа):', JSON.stringify(m.report.remapped));
  if (m.report.orphanPurchases.length) console.log('Приходы по удалённым продуктам (сохранены как история):', m.report.orphanPurchases.join(', '));

  const api = await cli.connect();
  const st = await api.rpc('get_state', {});
  const filled = EMPTY.filter(k => (st[k] || []).length > 0);
  if (filled.length) {
    console.error('В семье уже есть данные (' + filled.join(', ') + '). Повторный перенос запрещён, чтобы не задвоить приходы и журнал. Как очистить для повтора — в README.');
    process.exit(1);
  }
  if ((await cli.ask('Отправить данные в семью ' + (st.me && st.me.email) + '? (да/нет): ')).toLowerCase() !== 'да') { console.log('Отменено.'); return; }
  const version = await api.rpc('apply_changes', { expected_version: st.version, changes: m.changes });
  console.log('Данные отправлены, версия ' + version + '. Сверяю…');
  const checks = await reconcile(api, sheets);
  checks.forEach(c => console.log((c.ok ? '✅ ' : '❌ ') + c.name + (c.details ? ' — ' + c.details : '')));
  if (!checks.every(c => c.ok)) { console.error('\nЕсть расхождения. Не переключайте жену на новое приложение.'); process.exit(1); }
  console.log('\nВсе проверки совпали.');
}
main().catch(e => { console.error(e.message); process.exit(1); });
