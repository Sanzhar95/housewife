'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makePair } = require('../helpers/pair');
const sheets = require('../fixtures/sheets.synthetic.json');

const P = (extra) => Object.assign({ name: 'Сахар', unit: 'КГ', stock: 1, min: 0.2 }, extra);

test('saveProduct: новый (с приходом и ценой), изменение, смена единицы', () => {
  const p = makePair(sheets);
  p.step('saveProduct', P({ total: '1 200,5' }));
  p.step('saveProduct', P({ name: 'Сахар', stock: 0 }));                       // новый без остатка → приходов нет, но дубль названия
  const sugar = p.state.products.find(x => x.name === 'Сахар');
  p.step('saveProduct', P({ id: sugar.id, unit: 'Г', stock: 500, min: 100 }));  // КГ → Г
  p.step('saveProduct', P({ id: 'pr000001', name: 'Рис', unit: 'ШТ', stock: 3, min: 1 })); // другая семья единиц: состав переписывается
  p.step('saveProduct', P({ id: 'нет-такого' }));
  p.step('saveProduct', P({ name: '  ' }));
  p.step('saveProduct', P({ unit: 'банка' }));
  p.step('saveProduct', P({ name: 'рис' }));                                    // дубль без учёта регистра
  p.check();
});

test('saveProduct: кириллица, эмодзи, кавычки, апострофы, запятая в числах', () => {
  const p = makePair(sheets);
  p.step('saveProduct', { name: 'Мёд "липовый" 🍯', unit: 'Г', stock: '250,5', min: '50' });
  p.step('saveProduct', { name: "Сметана 20% д'Артаньян", unit: 'Г', stock: 0, min: '0,5' });
  p.step('saveProduct', { name: 'Минус', unit: 'Г', stock: '-1', min: 0 });
  assert.ok(p.state.products.some(x => x.name === 'Мёд "липовый" 🍯' && x.stock === 250.5));
  p.check();
});

test('adjustStock: приход с суммой, списание, перевод единиц, ошибки', () => {
  const p = makePair(sheets);
  p.step('adjustStock', 'pr000001', 1, 700);
  p.step('adjustStock', 'pr000001', '500', '', 'Г');
  p.step('adjustStock', 'pr000001', -0.5);
  p.step('adjustStock', 'pr000001', -100);          // больше остатка
  p.step('adjustStock', 'pr000001', 0);
  p.step('adjustStock', 'pr000001', 'abc');
  p.step('adjustStock', 'pr000001', 1, '', 'Л');    // другая семья единиц
  p.step('adjustStock', 'нет', 1);
  p.step('adjustStock', 'pr000004', '0,25', 100, 'Л');
  p.check();
});

test('deleteProduct / deleteDish / setIngredient', () => {
  const p = makePair(sheets);
  p.step('deleteProduct', 'pr000002');              // продукт есть в составе блюд
  p.step('deleteProduct', 'pr000002');
  p.step('setIngredient', 'ds000003', 'pr000007', '5', 'Г');
  p.step('setIngredient', 'ds000003', 'pr000007', 0);              // убрать
  p.step('setIngredient', 'ds000003', 'pr000005', '2,5', 'КГ');    // другая семья единиц
  p.step('setIngredient', 'ds000003', 'pr0000a0', 2, 'КГ');
  p.step('setIngredient', 'нет', 'pr000001', 1);
  p.step('deleteDish', 'ds000002');                  // стоит в плане, гарнир в плане
  p.step('deleteDish', 'ds000005');                  // гарнир, стоит как side
  p.step('deleteDish', 'нет');
  p.check();
});

test('saveDish: новое с новыми продуктами, изменение, типы, порции, ошибки', () => {
  const p = makePair(sheets);
  const ing = [{ product: 'pr000001', qty: '0,2', unit: 'КГ' }, { newName: 'Тмин', unit: 'Г', qty: 5 }, { newName: '', qty: 1 }, { product: 'pr000001', qty: 100, unit: 'Г' }];
  p.step('saveDish', { name: 'Пилав "новый"', note: 'с изюмом 🍇', type: 'main', meals: ['Ужин'], withSide: true, portions: '6', times: 3, ingredients: ing });
  const d = p.state.dishes.find(x => x.name.startsWith('Пилав'));
  p.step('saveDish', { id: d.id, name: 'Пилав', type: 'side', meals: [], withSide: true, portions: '', times: 5, ingredients: [] });
  p.step('saveDish', { name: 'Омлет' });                                  // дубль
  p.step('saveDish', { name: '' });
  p.step('saveDish', { name: 'Х', portions: 500 });
  p.step('saveDish', { name: 'Х', ingredients: [{ product: 'нет', qty: 1 }] });
  p.step('saveDish', { name: 'Х', ingredients: [{ product: 'pr000001', qty: 1, unit: 'Л' }] });
  p.step('saveDish', { id: 'нет', name: 'Привидение' });
  p.step('saveDish', { name: 'Салат', type: 'extra', ingredients: [{ newName: 'Укроп', qty: 1 }] });   // нет единицы
  p.check();
});

test('importProducts и saveSettings', () => {
  const p = makePair(sheets);
  p.step('importProducts', [
    { name: 'Рис', unit: 'Г', qty: 500, min: '', total: 300 }, { name: 'Мука', unit: 'КГ', qty: '2,5', min: 0.5, total: '' },
    { name: 'Молоко', unit: 'КГ', qty: 1 }, { name: 'Без единицы', qty: 1 }, { name: '', qty: 1 }, { name: 'Соль', unit: 'ГР', qty: 1 }]);
  p.step('importProducts', []);
  p.step('importProducts', [{ name: 'Плохая', unit: 'ШТ', qty: -1 }]);
  const email = p.state.settings.email;
  assert.strictEqual(email, '');
  // эталон принимает (e-mail, порции); клиентский вызов — только порции
  const o = p.oracle.call('saveSettings', '', '6');
  const l = p.logic.apply('saveSettings', p.state, ['6']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(l, (k, x) => (k === '_new' ? undefined : x))).settings, o.state.settings);
  assert.strictEqual(l.settings.portions, 6);
  assert.throws(() => p.logic.apply('saveSettings', p.state, ['0']), /от 1 до 100/);
  assert.throws(() => p.logic.apply('saveSettings', p.state, ['101']), /от 1 до 100/);
  assert.strictEqual(p.logic.apply('saveSettings', l, ['']).settings.portions, 0);
  assert.strictEqual(p.logic.apply('saveSettings', l, ['4,5']).settings.portions, 4.5);
});
