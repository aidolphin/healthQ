// data/index.js - single food catalogue for HealthQ.
//
// Sources, newest first:
//   data/newFoods.js      11,884  USDA SR Legacy 2018 + FNDDS 2021-2023
//                                + USDA Foundation 2026 + Nepal DFTQC 2012
//   data/newFruits.js        551  fruit records (supersets data/fruits.js)
//   data/newVegetables.js  1,501  vegetable records (supersets data/vegetables.js)
//   data/foods.js         10,333  older USDA set, kept to backfill
//   data/fruits.js           491  older fruit set, kept to backfill
//   data/vegetables.js     1,340  older vegetable set, kept to backfill
//
// TWO INVARIANTS THIS FILE MUST NOT BREAK:
//
// 1. foods[i].id === i. The app stores a log entry as {foodId}, reads it back
//    with foods[e.foodId], and re-numbers nothing. If rows are reordered or
//    removed, a saved entry silently points at a different food. So the
//    original data/foods.js rows are copied over byte-for-byte at indices
//    0..10332 and everything else is appended after them.
//
// 2. The 195 raw source categories are collapsed into 16 display groups.
//    One chip per raw category would be unusable.

import { foods as baseFoods } from './foods.js';
import { fruits as baseFruits } from './fruits.js';
import { vegetables as baseVeg } from './vegetables.js';
import { foods as newFoods } from './newFoods.js';
import { fruits as newFruits } from './newFruits.js';
import { vegetables as newVeg } from './newVegetables.js';

// USDA FDC nutrient ids, so the "all nutrients" list keeps working.
const FDC = {
  energy: '1008',
  protein: '1003',
  fat: '1004',
  carbs: '1005',
  fiber: '1079',
  sugar: '1063',
  water: '1051',
};

// Nepal DFTQC micronutrients have no FDC id. They are namespaced with "m:"
// and resolved by the app against its own table.
const MICRO = {
  calciumMg: 'Calcium',
  phosphorusMg: 'Phosphorus',
  ironMg: 'Iron',
  caroteneUg: 'Carotene',
  vitaminCMg: 'Vitamin C',
  thiamineMg: 'Thiamine',
  riboflavinMg: 'Riboflavin',
  niacinMg: 'Niacin',
};
const MICRONUTRIENT_IDS = Object.keys(MICRO);

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Ordered: the first pattern that matches wins, so specific names such as
// "Eggs and omelets" are tested before the broad "Meat" catch-all.
const CATEGORY_RULES = [
  [/egg|formula|infant|weaning|baby/i, 'Baby & Infant'],
  [/milk|cheese|yogurt|cream|butter|margarine|gelatin|custard|casein|whey|cottage|mozzarella|egg|^dairy/i, 'Dairy & Eggs'],
  [/beef|pork|lamb|veal|game|poultry|chicken|turkey|meat|fish|shellfish|seafood|frankfurter|sausage|bacon|liver|deli|cold cuts|hot dog|ham\b|prosciutto|duck|rabbit|venison|anchov|surimi|tuna|salmon|crab|lobster|shrimp|clam|mussel|oyster|scallop/i, 'Meat & Seafood'],
  [/fruit|apple|banana|mango|melon|berr|grape|peach|pear|pineapple|cherry|fig\b|date|citrus|orange|grapefruit|lemon|lime|avocado|papaya|guava|raisin|currant|apricot|plum|raspber|strawber|blueber|kiwi|persimmon|pomegranate|mulber|lychee|durian|jackfruit|tamarind|quince/i, 'Fruit'],
  [/vegetable|carrot|spinach|broccoli|cabbage|onion|tomato|bean, green|string bean|lettuce|wild food|potato|sweet potato|green|pea|squash|mushroom|seaweed|leek|beet|celery|cauliflower|eggplant|pepper|salad|herb|sea vegetable|okra|radish|turnip|parsnip|asparagus|artichoke|zucchini|pumpkin|kale|brussels|collard|bitter melon|chayote|water spinach|amaranth|agathi|palak|spinach/i, 'Vegetables'],
  [/soup|sauce|condiment|seasoning|spice|gravy|dressing|mayonnaise|mustard|ketchup|honey|syrup|jam|pickl|soy-based|marinade|dip/i, 'Soups, Sauces & Spices'],
  [/baked|yeast|bread|roll|bagel|muffin|cake|cookie|biscuit|cracker|pretzel|pita|tortilla|doughnut|bun|scone|grain-based|pancake|waffle|toast|breakfast cereal|cereal|oatmeal|grits|saltine|biscotti|cruller|english muffin|bagel\b|zwieback|wafer\b|matzo|crepe|turnover|popover|strudel|filo|tortilla chip/i, 'Bakery & Breakfast'],
  [/pasta|rice|cereal grain|grain|flour|starch|noodle|macaroni|semolina|couscous|bulgur|quinoa|corn\b|millet|barley|breadcrumb|tortilla, corn|wild rice|polenta|farina|spaghetti|lasagna|noodle dish/i, 'Grains & Pasta'],
  [/legume|bean, pea|beans, peas|lentil|chickpea|tofu|tempeh|soy\b|plant-based|edamame|pulse/i, 'Legumes & Soy'],
  [/nut|seed|peanut|almond|cashew|walnut|pistachio|pecan|hazelnut|macadamia|chia|flax|pumpkin seed|sunflower seed|sesame|nut or seed/i, 'Nuts & Seeds'],
  [/sweets|candy|chocolate|pudding|dessert|sweetener|sugar substitut|ice cream|frozen dairy|marshmallow|brownie|fudge|gelat|caramel|nougat|sorbet|hard candy|sugar and honey/i, 'Sweets'],
  [/beverage|coffee|tea\b|beer|wine|liquor|cocktail|soft drink|diet soft|energy drink|sport drink|enhanced water|tap water|bottled water|water|flavored|carbonated|drink|shake|milk substitute|plant-based milk|lemonade|punch|infusion|cider|mead/i, 'Drinks'],
  [/fats|oil|margarine|shortening|lard|mayonnaise|salad dressing|butter/i, 'Fats & Oils'],
  [/snack|cracker|pretzel|potato chip|corn chip|popcorn|nacho|trailer/i, 'Snacks'],
  [/restaurant|fast food|pizza|burger|sandwich|taco|burrito|wrap\b|meal|entree|side dish|mixed dish|stir-fry|fried rice|lo\/chow|egg roll|dumpling|sushi|chinese|thai|mexican|indian|ethiopian|middle eastern|breakfast sandwich|roast beef|gyro|donair|quesadilla|pot pie|macaroni and cheese|lasagna|handi|khichdi|dal\b|thukpa|momo\b|chhurpi|sel\b|chatamari|dah|packaged food|prepared food/i, 'Restaurant & Prepared'],
];

export const MICRO_NUTRIENT_LABELS = Object.freeze({ ...MICRO });

export function groupCategory(raw) {
  const s = String(raw || '');
  for (const [re, group] of CATEGORY_RULES) if (re.test(s)) return group;
  return 'Other';
}

function buildNutrients(r) {
  const out = {};
  const pairs = [
    [FDC.energy, r.caloriesPer100g ?? r.energy],
    [FDC.protein, r.protein],
    [FDC.fat, r.fat],
    [FDC.carbs, r.carbs ?? r.carbohydrates],
    [FDC.fiber, r.fiber],
    [FDC.sugar, r.sugar],
    [FDC.water, r.water],
  ];
  for (const [id, v] of pairs) {
    const n = num(v);
    if (n !== null) out[id] = n;
  }
  if (r.micronutrients) {
    for (const key of MICRONUTRIENT_IDS) {
      const n = num(r.micronutrients[key]);
      if (n !== null) out['m:' + key] = n;
    }
  }
  return out;
}

function portionText(r) {
  const bits = [];
  if (r.scientificName) bits.push(r.scientificName);
  if (r.ediblePortionPercent != null) bits.push(`${r.ediblePortionPercent}% edible`);
  const list = r.servingSizes || r.servingWeights;
  if (Array.isArray(list)) {
    for (const s of list) {
      if (!s || s.weight == null) continue;
      if (s.weight === 100) continue;
      if (num(s.weight) !== null) bits.push(`1 ${s.label} ~ ${s.weight} g`);
    }
  }
  return bits.join(' · ');
}

const YEAR = /(\d{4})/;
function recordDate(r) {
  if (r.sourceDate) return r.sourceDate;
  const m = YEAR.exec(String(r.source || ''));
  return m ? m[1] : null;
}

function normalise(r, nextId, kind) {
  const aliases = Array.isArray(r.aliases) ? r.aliases.slice() : [];
  for (const extra of [r.englishName, r.nepaliName, r.scientificName]) {
    if (extra && !aliases.includes(extra)) aliases.push(extra);
  }
  return {
    id: nextId,
    name: r.name,
    nepali: r.nepaliName || null,
    category: groupCategory(r.category),
    rawCategory: r.category || null,
    kind: kind || 'food',
    energy: num(r.caloriesPer100g ?? r.energy) ?? 0,
    protein: num(r.protein),
    carbs: num(r.carbs ?? r.carbohydrates),
    fat: num(r.fat),
    fiber: num(r.fiber),
    sugar: num(r.sugar),
    fdcId: r.sourceId ?? r.fdcId ?? null,
    updated: recordDate(r),
    nutrients: buildNutrients(r),
    source: r.source || 'USDA FoodData Central',
    extra: portionText(r),
    aliases,
  };
}

// ── Build the index-addressed array ────────────────────────────────────────
// The original data/foods.js rows keep their exact indices so every day-log
// entry already saved in a browser still resolves to the same food.
// Category is a display label only. Rewriting it cannot change which food a
// saved entry resolves to, so the base rows are grouped too. Everything else
// about them (name, energy, nutrients, fdcId) is left exactly as it was.
const foods = baseFoods.map(f => ({
  ...f,
  category: groupCategory(f.category),
  aliases: Array.isArray(f.aliases) ? f.aliases : [],
  kind: 'food',
  extra: f.extra || '',
}));

for (const r of newFoods) foods.push(normalise(r, foods.length, 'food'));
for (const r of newFruits) foods.push(normalise(r, foods.length, 'fruit'));
for (const r of newVeg) foods.push(normalise(r, foods.length, 'vegetable'));
// Backfill: older records whose names are absent from the newer files.
const haveNames = new Set(foods.map(f => f.name.toLowerCase().trim()));
for (const r of [...baseFruits, ...baseVeg]) {
  const k = r.name.toLowerCase().trim();
  if (haveNames.has(k)) continue;
  haveNames.add(k);
  foods.push(normalise(r, foods.length, r.foodGroup === 'fruits' ? 'fruit' : 'vegetable'));
}

// ── Build the display list: duplicates merged, not dropped ─────────────────
// Newer records win, because they carry serving weights, micronutrients and
// Nepali names the older ones lack. Any Nepali name, alias or micronutrient
// held only by the older twin is folded into the survivor.
const byName = new Map();
for (const f of foods) {
  const k = f.name.toLowerCase().trim();
  const prior = byName.get(k);
  if (!prior) { byName.set(k, f); continue; }
  let keep = f.updated && prior.updated && f.updated >= prior.updated ? f : prior;
  if (f.category !== prior.category) {
    const want = k => (k === 'fruit' ? 'Fruit' : k === 'vegetable' ? 'Vegetables' : null);
    if (want(f.kind) === f.category) keep = f;
    else if (want(prior.kind) === prior.category) keep = prior;
  }
  const drop = keep === f ? prior : f;
  if (!keep.nepali && drop.nepali) keep.nepali = drop.nepali;
  keep.aliases = keep.aliases || [];
  for (const a of drop.aliases || []) if (!keep.aliases.includes(a)) keep.aliases.push(a);
  if (!keep.extra && drop.extra) keep.extra = drop.extra;
  for (const k2 of Object.keys(drop.nutrients)) {
    if (keep.nutrients[k2] == null) keep.nutrients[k2] = drop.nutrients[k2];
  }
  if (keep.protein == null) keep.protein = drop.protein;
  if (keep.carbs == null) keep.carbs = drop.carbs;
  if (keep.fat == null) keep.fat = drop.fat;
  if (keep.fiber == null) keep.fiber = drop.fiber;
  byName.set(k, keep);
}

const displayFoods = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

const sources = {};
for (const f of foods) sources[f.source] = (sources[f.source] || 0) + 1;

export const catalogue = {
  total: foods.length,
  unique: displayFoods.length,
  base: baseFoods.length,
  newFoods: newFoods.length,
  newFruits: newFruits.length,
  newVeg: newVeg.length,
  groups: [...new Set(displayFoods.map(f => f.category))].sort(),
  sources,
};

export { foods, displayFoods };
