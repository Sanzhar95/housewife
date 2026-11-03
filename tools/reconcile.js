#!/usr/bin/env node
// Сверка базы с выгрузкой: node tools/reconcile.js файл.xlsx|файл.json
const { buildMigration, compare } = require('./migration');
const cli = require('./cli');

const TABLES = ['products', 'dishes', 'dish_items', 'plan', 'log', 'purchases'];

async function reconcile(api, sheets) {
  const m = buildMigration(sheets);
  const counts = {};
  for (const t of TABLES) counts[t] = await api.count(t);
  const st = await api.rpc('get_state', {});
  const checks = compare(m.expected, { counts, products: st.products, plan: st.plan, weekStart: (st.settings || {}).weekStart });
  return checks;
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('Использование: node tools/reconcile.js файл.xlsx'); process.exit(2); }
  const api = await cli.connect();
  const checks = await reconcile(api, cli.loadSheets(file));
  checks.forEach(c => console.log((c.ok ? '✅ ' : '❌ ') + c.name + (c.details ? ' — ' + c.details : '')));
  if (checks.every(c => c.ok)) console.log('\nВсе проверки совпали.');
  else { console.log('\nЕсть расхождения — переключать жену на новое приложение нельзя.'); process.exit(1); }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { reconcile };
