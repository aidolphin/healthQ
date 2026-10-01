// nutrition.js - goal maths, meal suggestions and the coach rules.
//
// Pure functions only: no DOM, no storage. Everything here is deterministic
// so the same day always produces the same advice.
//
// IMPORTANT HONESTY NOTE
// The "coach" in this file is a rules engine, not a language model. There is
// no server and no API key in this app. It reasons over the nutrient numbers
// already in the USDA / Nepal DFTQC tables using thresholds written by hand.
// It does not invent facts, and it does not diagnose anything.

// Nepal DFTQC micronutrients have no USDA FDC id. The catalogue stores them
// under an "m:" prefix; the app needs the label and unit to render them.
export const MICRO_NUTRIENT_LABELS = Object.freeze({
  calciumMg: 'Calcium',
  phosphorusMg: 'Phosphorus',
  ironMg: 'Iron',
  caroteneUg: 'Carotene',
  vitaminCMg: 'Vitamin C',
  thiamineMg: 'Thiamine',
  riboflavinMg: 'Riboflavin',
  niacinMg: 'Niacin',
});

export const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

export const GOAL_DEFAULTS = {
  calories: 2000,
  protein: 90,
  carbs: 250,
  fat: 65,
  waterL: 2.0,
  fruit: 2,
  veg: 3,
  weightGoal: 'maintain',
  custom: [],
};

export const WEIGHT_GOALS = {
  lose: { label: 'Weight loss', kcalDelta: -400, proteinPerKg: 1.8, note: 'A 400 kcal deficit, higher protein to protect muscle.' },
  maintain: { label: 'Maintenance', kcalDelta: 0, proteinPerKg: 1.4, note: 'Hold your current weight.' },
  gain: { label: 'Weight gain', kcalDelta: 300, proteinPerKg: 1.6, note: 'A 300 kcal surplus for gradual gain.' },
};

export const CONDITIONS = [
  { id: 'diabetes', label: 'Diabetes / high blood sugar' },
  { id: 'hypertension', label: 'High blood pressure' },
  { id: 'hyperlipid', label: 'High cholesterol' },
  { id: 'kidney', label: 'Kidney condition' },
  { id: 'thyroid', label: 'Thyroid condition' },
  { id: 'anemia', label: 'Anaemia (low iron)' },
];

export const ALLERGENS = [
  { id: 'milk', label: 'Milk / dairy' },
  { id: 'egg', label: 'Egg' },
  { id: 'gluten', label: 'Gluten / wheat' },
  { id: 'nuts', label: 'Tree nuts' },
  { id: 'peanut', label: 'Peanut' },
  { id: 'soy', label: 'Soy' },
  { id: 'seafood', label: 'Seafood' },
];

export const DIETS = [
  { id: 'vegetarian', label: 'Vegetarian' },
  { id: 'vegan', label: 'Vegan' },
  { id: 'halal', label: 'Halal' },
  { id: 'glutenfree', label: 'Gluten free' },
  { id: 'lowcarb', label: 'Low carb' },
];

// Rough per-kilogram reference values. Reference figures only, not medical
// prescriptions, and not a substitute for a clinician.
export const WATER_ML_PER_KG = 35;
export const KCAL_PER_KG = { lose: 30, maintain: 33, gain: 37 };

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const round = (v, d = 0) => {
  const m = 10 ** d;
  return Math.round(v * m) / m;
};

// ── Goals ───────────────────────────────────────────────────────────────────

// Suggest a full goal set from the body profile. Returns null until we know
// weight and height, because guessing would be worse than asking.
export function suggestGoals({ weightKg, heightCm, age, sex, activity, weightGoal, conditions = [] }) {
  if (!weightKg || !heightCm || !age) return null;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
  const dir = weightGoal || 'maintain';
  const tdee = Math.round(bmr * (activity || 1.2));
  const delta = WEIGHT_GOALS[dir]?.kcalDelta ?? 0;
  const protein = Math.round(weightKg * (WEIGHT_GOALS[dir]?.proteinPerKg ?? 1.4));

  // Restrictive conditions pull the macro split around.
  let fat = Math.round((tdee + delta) * 0.28 / 9);
  let carbs = Math.round(((tdee + delta) - protein * 4 - fat * 9) / 4);
  if (conditions.includes('diabetes')) carbs = Math.round(carbs * 0.7);
  if (conditions.includes('hyperlipid')) fat = Math.round(fat * 0.8);
  if (conditions.includes('kidney')) protein = Math.round(weightKg * 1.0);
  carbs = Math.max(carbs, 0);
  fat = Math.max(fat, 0);

  return {
    calories: clamp(tdee + delta, 1200, 5000),
    protein: clamp(protein, 20, 300),
    carbs,
    fat,
    waterL: round(clamp((weightKg * WATER_ML_PER_KG) / 1000, 1.5, 5), 1),
    fruit: 2,
    veg: 3,
    weightGoal: dir,
  };
}

// ── Progress ────────────────────────────────────────────────────────────────

export function progressPct(value, target) {
  if (!target || target <= 0) return 0;
  return clamp(Math.round((value / target) * 100), 0, 999);
}

export function band(pct) {
  if (pct >= 100) return 'done';
  if (pct >= 75) return 'good';
  if (pct >= 40) return 'mid';
  return 'low';
}

// Count fruit/vegetable servings. One serving is 100 g, the same basis the
// source tables use.
//
// Takes a resolver rather than an array, because the catalogue exposes foods
// by id through a lookup that also follows the id remap applied when two
// records shared a name. Indexing an array here would silently miss those.
export function countServings(entries, resolveFood, categories) {
  let grams = 0;
  for (const entry of entries) {
    const food = resolveFood(entry.foodId);
    if (!food) continue;
    if (categories.includes(food.category)) grams += entry.grams;
  }
  return Math.round((grams / 100) * 10) / 10;
}

// ── Coach ───────────────────────────────────────────────────────────────────
// Each rule returns { level, title, text } or null. level is one of
// 'good' | 'info' | 'warn'. Nothing here claims a diagnosis.

const RULES = [
  {
    id: 'calories-over',
    when: (m) => m.goals.calories && m.intake.calories > m.goals.calories * 1.1,
    level: 'warn',
    title: 'Over your calorie target',
    text: (m) => `You are ${Math.round(m.intake.calories - m.goals.calories)} kcal above today's target. A short walk or a lighter dinner will close the gap.`,
  },
  {
    id: 'calories-under',
    when: (m) => m.goals.calories && m.intake.calories < m.goals.calories * 0.6 && m.entryCount >= 1,
    level: 'info',
    title: 'Plenty left today',
    text: (m) => `${Math.round(m.goals.calories - m.intake.calories)} kcal still available. Do not skip meals just to hit a number.`,
  },
  {
    id: 'protein-low',
    when: (m) => m.goals.protein && m.intake.protein < m.goals.protein * 0.6,
    level: 'warn',
    title: 'Protein is behind',
    text: (m) => `${Math.round(m.intake.protein)} g of ${m.goals.protein} g. Eggs, dal, paneer, chicken or curd are the quickest ways to close it.`,
  },
  {
    id: 'fiber-low',
    when: (m) => m.entryCount >= 2 && m.intake.fiber != null && m.intake.fiber < 18,
    level: 'info',
    title: 'Fibre is low',
    text: () => 'Below roughly 25 g a day. Whole grains, dal and vegetables with skin are the simplest fix.',
  },
  {
    id: 'sodium',
    when: (m) => m.intake.sodium != null && m.intake.sodium > 2300,
    level: 'warn',
    title: 'Sodium looks high',
    text: (m) => `About ${Math.round(m.intake.sodium)} mg today. Over 2,300 mg a day is generally advised against; pickles, papad and packaged sauces are the usual source.`,
  },
  {
    id: 'sugar',
    when: (m) => m.intake.sugar != null && m.intake.sugar > 50,
    level: 'warn',
    title: 'Added sugars are high',
    text: (m) => `${Math.round(m.intake.sugar)} g of sugars today. Cold drinks and sweets are usually the biggest chunk.`,
  },
  {
    id: 'water-low',
    when: (m) => m.goals.waterL && m.intake.waterL < m.goals.waterL * 0.5,
    level: 'info',
    title: 'Drink more water',
    text: (m) => `${round(m.intake.waterL, 1)} L of ${m.goals.waterL} L so far. Sip steadily rather than all at once.`,
  },
  {
    id: 'water-done',
    when: (m) => m.goals.waterL && m.intake.waterL >= m.goals.waterL,
    level: 'good',
    title: 'Hydration done',
    text: (m) => `${round(m.intake.waterL, 1)} L logged. That is your target for today.`,
  },
  {
    id: 'veg-low',
    when: (m) => m.goals.veg && m.servings.veg < m.goals.veg * 0.5,
    level: 'info',
    title: 'Add a vegetable',
    text: (m) => `${m.servings.veg} of ${m.goals.veg} vegetable servings (1 serving = 100 g).`,
  },
  {
    id: 'fruit-low',
    when: (m) => m.goals.fruit && m.servings.fruit < m.goals.fruit * 0.5,
    level: 'info',
    title: 'Add a fruit',
    text: (m) => `${m.servings.fruit} of ${m.goals.fruit} fruit servings. A seasonal fruit is the easiest daily habit here.`,
  },
  {
    id: 'sodium-good',
    when: (m) => m.entryCount >= 3 && m.intake.sodium != null && m.intake.sodium <= 1500,
    level: 'good',
    title: 'Light on sodium today',
    text: () => 'Well under the usual 2,300 mg ceiling. Keep it up.',
  },
];

// Conditions that change which rules are worth surfacing.
const CONDITION_NOTES = {
  diabetes: 'You have marked diabetes. Keep an eye on the carbohydrate line above and aim for the fibre you are getting.',
  hypertension: 'You have marked high blood pressure, so the sodium reading matters most today.',
  hyperlipid: 'You have marked high cholesterol, so saturated fat and fried foods are worth watching.',
  kidney: 'You have marked a kidney condition. Protein is shown against a lower target, and your clinician should set the final number.',
  thyroid: 'You have marked a thyroid condition. Calorie target follows the weight-goal direction you chose.',
  anemia: 'You have marked anaemia. Pair iron-rich foods with vitamin C, and ask your clinician before using supplements.',
};

const ALLERGY_NOTES = {
  milk: 'Milk is marked as an allergy. Dairy rows below are flagged.',
  egg: 'Egg is marked as an allergy.',
  gluten: 'Gluten is marked as an allergy. Look for the gluten-free grains.',
  nuts: 'Tree nuts are marked as an allergy.',
  peanut: 'Peanut is marked as an allergy.',
  soy: 'Soy is marked as an allergy.',
  seafood: 'Seafood is marked as an allergy.',
};

export function reviewDay(m) {
  const out = [];
  for (const r of RULES) {
    let hit = false;
    try { hit = r.when(m); } catch { hit = false; }
    if (hit) out.push({ id: r.id, level: r.level, title: r.title, text: r.text(m) });
  }
  for (const c of m.conditions || []) {
    if (CONDITION_NOTES[c]) out.push({ level: 'info', title: 'Because of your health profile', text: CONDITION_NOTES[c] });
  }
  for (const a of m.allergies || []) {
    if (ALLERGY_NOTES[a]) out.push({ level: 'info', title: 'Allergy on file', text: ALLERGY_NOTES[a] });
  }
  for (const g of m.goals.custom || []) {
    if (!g.label) continue;
    const v = m.custom?.[g.key];
    if (v == null) continue;
    const ok = String(v).trim().toLowerCase() === 'yes' || Number(v) > 0;
    out.push({
      level: ok ? 'good' : 'info',
      title: g.label,
      text: ok ? 'Marked as done today.' : 'Not marked yet today.',
    });
  }
  if (!out.length) {
    out.push({ level: 'info', title: 'Nothing flagged yet', text: 'Log a few foods and the coach will start commenting on your day.' });
  }
  return out;
}

// ── Meal suggestions ────────────────────────────────────────────────────────

const MEAL_IDEAS = {
  Breakfast: [
    { name: 'Moong dal with rice', q: 'moong dal', veg: true, why: 'Protein and fibre to start the day.' },
    { name: 'Egg bhurji and roti', q: 'egg bhurji', why: 'Quick protein with a whole grain.' },
    { name: 'Fruit and curd', q: 'curd', veg: true, dairy: true, why: 'Probiotic with a piece of fruit.' },
    { name: 'Porridge with milk', q: 'oatmeal', veg: true, dairy: true, why: 'Slow-release carbohydrate.' },
    { name: 'Aloo paratha with yoghurt', q: 'paratha', veg: true, dairy: true, why: 'Filling, but watch the oil.' },
  ],
  Lunch: [
    { name: 'Dal bhat (rice and lentil)', q: 'rice cooked', veg: true, why: 'The everyday Nepali plate. Balanced if the dal carries the protein.' },
    { name: 'Chicken and vegetable curry with rice', q: 'chicken curry', why: 'Higher protein lunch.' },
    { name: 'Aloo with rice and salad', q: 'potato', veg: true, why: 'Vegetable-forward, add dal for protein.' },
    { name: 'Roti with tarkari and dahi', q: 'tarkari', veg: true, dairy: true, why: 'Light on meat, good with dahi.' },
    { name: 'Vegetable stir fry with noodles', q: 'vegetable stir', veg: true, why: 'Fast and vegetable heavy.' },
  ],
  Dinner: [
    { name: 'Light dal and rice', q: 'dal', veg: true, why: 'Easier to digest in the evening.' },
    { name: 'Grilled fish with vegetables', q: 'fish', why: 'Omega-3 and lean protein.' },
    { name: 'Khichdi with ghee', q: 'khichdi', veg: true, dairy: true, why: 'Gentle on the stomach.' },
    { name: 'Roti with vegetable sabzi', q: 'sabzi', veg: true, why: 'Balanced and light.' },
    { name: 'Egg curry with rice', q: 'egg curry', why: 'Protein without much oil.' },
  ],
  Snack: [
    { name: 'Seasonal fruit', q: 'apple raw', veg: true, why: 'Fibre and water in one.' },
    { name: 'Roasted chana', q: 'chickpeas', veg: true, why: 'Cheap protein and fibre.' },
    { name: 'Curd or buttermilk', q: 'curd', veg: true, dairy: true, why: 'Light between meals.' },
    { name: 'Sprouted mung', q: 'mung bean', veg: true, why: 'Very high protein for the weight.' },
    { name: 'A few almonds', q: 'almonds', why: 'Small portion, useful fats.' },
  ],
};

const DIET_RULES = {
  vegetarian: f => /Meat & Seafood/.test(f.category) ? false : true,
  vegan: f => /Meat & Seafood|Dairy & Eggs/.test(f.category) ? false : true,
  halal: f => /Meat & Seafood/.test(f.category) ? /Poultry|Beef|Fish|Shellfish|Rice|Pasta|Sweets|Vegetable|Fruit|Dairy|Bakery|Legumes|Nuts|Grains/.test(f.category) : true,
  glutenfree: f => /Bakery & Breakfast|Grains & Pasta|Soups, Sauces & Spices/.test(f.category) ? false : true,
  lowcarb: f => /Grains & Pasta|Sweets|Drinks/.test(f.category) ? false : true,
};

const ALLERGY_RULES = {
  milk: f => /Dairy & Eggs/.test(f.category) ? false : true,
  egg: f => /Dairy & Eggs/.test(f.category) ? /milk|dairy/i.test(f.category) ? false : true : true,
  gluten: f => /Bakery & Breakfast|Grains & Pasta/.test(f.category) ? false : true,
  nuts: f => /Nuts & Seeds/.test(f.category) ? false : true,
  peanut: f => /Nuts & Seeds/.test(f.category) ? false : true,
  soy: f => /Legumes & Soy/.test(f.category) ? false : true,
  seafood: f => /Meat & Seafood/.test(f.category) ? /fish|shellfish|finfish|seaweed/i.test(f.name) ? false : true : true,
};

function allowed(f, diets, allergies) {
  for (const d of diets) {
    const r = DIET_RULES[d];
    if (r && !r(f)) return false;
  }
  for (const a of allergies) {
    const r = ALLERGY_RULES[a];
    if (r && !r(f)) return false;
  }
  return true;
}

// Build a ranked list of concrete foods for one meal, from the live catalogue.
export function suggestFoods(foods, { meal, diets = [], allergies = [], goal, limit = 6, search }) {
  const ideas = MEAL_IDEAS[meal] || MEAL_IDEAS.Snack;
  const picks = [];
  const seen = new Set();

  for (const idea of ideas) {
    const q = (search || idea.q).toLowerCase();
    const found = foods
      .filter(f => allowed(f, diets, allergies))
      .filter(f => `${f.name} ${(f.aliases || []).join(' ')}`.toLowerCase().includes(q))
      .slice(0, 12);

    // Prefer something that supports the direction of the goal.
    const scored = found.map(f => {
      let score = 0;
      const p = f.protein || 0;
      if (goal === 'lose') { if (p >= 5) score += 3; if ((f.fiber || 0) >= 2) score += 2; if (f.energy > 300) score -= 1; }
      if (goal === 'gain') { if (f.energy >= 150) score += 2; if (p >= 5) score += 2; }
      if (goal === 'maintain') { if (p >= 5) score += 1; if ((f.fiber || 0) >= 2) score += 1; }
      return { f, score };
    }).sort((a, b) => b.score - a.score);

    const best = scored.find(x => !seen.has(x.f.id));
    if (!best) continue;
    seen.add(best.f.id);
    picks.push({ idea: idea.name, why: idea.why, food: best.f });
    if (picks.length >= limit) break;
  }
  return picks;
}

export function hydrationTip(intakeL, goalL) {
  if (!goalL) return 'Set a water goal to get reminders.';
  const left = round(goalL - intakeL, 1);
  if (left <= 0) return 'Hydration target reached for today.';
  if (intakeL === 0) return 'You have not logged any water yet. Start with a glass now.';
  return `${round(left, 1)} L to go. Roughly ${Math.max(1, Math.ceil((left * 1000) / 250))} more glasses of 250 ml.`;
}
