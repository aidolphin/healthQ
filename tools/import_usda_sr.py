#!/usr/bin/env python3
"""Rebuild the HealthQ USDA SR Legacy 2018 dataset from the USDA CSV archive.
Usage: python3 tools/import_usda_sr.py path/to/FoodData_Central_sr_legacy_food_csv_2018-04.zip
"""
import csv, hashlib, io, json, sys, zipfile
from collections import defaultdict
from pathlib import Path

HERE=Path(__file__).resolve().parents[1]
ARCHIVE_URL='https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip'
if len(sys.argv)!=2: raise SystemExit(__doc__)
archive=Path(sys.argv[1]); digest=hashlib.sha256(archive.read_bytes()).hexdigest()
with zipfile.ZipFile(archive) as z:
 def read(name):
  match=next(p for p in z.namelist() if p.endswith('/'+name+'.csv'))
  return list(csv.DictReader(io.TextIOWrapper(z.open(match),encoding='utf-8-sig',newline='')))
 food=read('food'); categories={int(x['id']):x['description'] for x in read('food_category')}
 nutrient={int(x['id']):{'name':x['name'],'unit':x['unit_name']} for x in read('nutrient')}
 values=defaultdict(dict)
 for x in read('food_nutrient'):
  if x['amount']:
   fid=int(x['fdc_id']); nid=int(x['nutrient_id']); amount=float(x['amount'])
   # A repeated nutrient ID would be ambiguous; fail rather than silently overwrite.
   if nid in values[fid]:raise ValueError(f'Duplicate nutrient {fid}/{nid}')
   values[fid][nid]=amount
 aliases={
  "Apples, raw, with skin (Includes foods for USDA's Food Distribution Program)":'स्याउ',
  'Bananas, raw':'केरा',
  'Oranges, raw, all commercial varieties':'सुन्तला',
  'Potatoes, boiled, cooked without skin, flesh, without salt':'उसिनेको आलु',
  'Spinach, raw':'पालुङ्गो',
  'Tomatoes, red, ripe, raw, year round average':'गोलभेँडा',
  'Milk, whole, 3.25% milkfat, with added vitamin D':'दूध',
  'Lentils, mature seeds, cooked, boiled, without salt':'पकाएको दाल',
  'Rice, white, long-grain, regular, enriched, cooked':'पकाएको भात',
  'Peanuts, all types, raw':'बदाम',
  'Egg, whole, raw, fresh':'अण्डा',
 }
 # Compact tuple retains the user's original first seven columns.
 # [name, Nepali or null, category, kcal, protein g, carb g, fat g,
 #  fiber g or null, FDC ID, USDA publication date, nutrient-ID:value map]
 rows=[]
 for f in sorted(food,key=lambda x:int(x['fdc_id'])):
  fid=int(f['fdc_id']); n=values[fid]
  assert all(k in n for k in (1008,1003,1004,1005)),fid
  row=[f['description'],aliases.get(f['description']),categories.get(int(f['food_category_id']),'Other'),n[1008],n[1003],n[1005],n[1004],n.get(1079),fid,f['publication_date'],{str(k):v for k,v in sorted(n.items())}]
  rows.append(row)
 assert len(rows)>=5001 and len({r[8] for r in rows})==len(rows)
 meta={str(k):v for k,v in sorted(nutrient.items())}
 (HERE/'data'/'nutrients.js').write_text('export const nutrients='+json.dumps(meta,ensure_ascii=False,separators=(',',':'))+';\n')
 out='''// USDA FoodData Central SR Legacy, April 2018 bulk CSV release. CC0 public domain.\n// Values per 100 g of the specified food. No missing nutrient has been set to zero.\n// Each row retains the requested seven leading fields plus fiber, FDC ID, date, nutrient map.\n// source: https://fdc.nal.usda.gov/download-datasets/\nexport const foods='''+json.dumps(rows,ensure_ascii=False,separators=(',',':'))+''' .map((f,id)=>({id,name:f[0],nepali:f[1],category:f[2],energy:f[3],protein:f[4],carbs:f[5],fat:f[6],fiber:f[7],fdcId:f[8],updated:f[9],nutrients:f[10],source:'USDA FoodData Central · SR Legacy (2018)'}));\n'''
 (HERE/'data'/'foods.js').write_text(out)
 (HERE/'data'/'provenance.json').write_text(json.dumps({'source':'USDA FoodData Central SR Legacy, April 2018 CSV','sourceUrl':ARCHIVE_URL,'archiveSha256':digest,'records':len(rows),'uniqueFdcIds':len({r[8] for r in rows}),'foodsWithFiber':sum(r[7] is not None for r in rows),'nutrientDefinitions':len(meta),'license':'CC0 1.0','note':'Values are source data for named food forms; use by food name and FDC ID, with missing fields kept null.'},indent=2)+'\n')
 print(f'Wrote {len(rows)} foods; {len(meta)} nutrient definitions; {sum(r[7] is not None for r in rows)} fiber values')
