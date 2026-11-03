const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('структура репозитория этапа 2', () => {
  ['apps-script/Code.gs', 'apps-script/appsscript.json', 'legacy/Index.html', '.gitignore'].forEach(f =>
    assert.ok(fs.existsSync(path.join(root, f)), f));
  assert.ok(!fs.existsSync(path.join(root, 'apps-script/api-patch.gs')));
  const ig = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  ['.env', 'public/config.js', '*.xlsx', '.DS_Store', '*.zip'].forEach(l => assert.ok(ig.includes(l), l));
});
