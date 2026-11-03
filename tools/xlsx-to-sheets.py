"""Выгрузка «Домашняя Кухня.xlsx» → JSON {лист: [[шапка], [строка]...]}.
Даты превращаются в строки 'yyyy-MM-dd HH:mm' (местное время, как показывает таблица).
Использование: python3 tools/xlsx-to-sheets.py файл.xlsx выход.json
"""
import json, sys, datetime as dt
import openpyxl

SHEETS = ['Продукты', 'Блюда', 'Состав', 'План', 'Журнал', 'Настройки', 'Приходы']

def cell(v):
    if isinstance(v, dt.datetime):
        return v.strftime('%Y-%m-%d %H:%M')
    if isinstance(v, dt.date):
        return v.strftime('%Y-%m-%d')
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e15:
        return int(v)
    return '' if v is None else v

wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
out = {}
for name in SHEETS:
    rows = [[cell(v) for v in r] for r in wb[name].iter_rows(values_only=True)]
    while rows and all(v == '' for v in rows[-1]):
        rows.pop()
    out[name] = rows
json.dump(out, open(sys.argv[2], 'w', encoding='utf8'), ensure_ascii=False)
print({k: len(v) - 1 for k, v in out.items()})
