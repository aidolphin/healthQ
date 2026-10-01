/**
 * @file src/services/dailyNutrition.js
 * @module services/dailyNutrition
 *
 * PURPOSE
 * All calculations over a single day's food log. Pure functions: no DOM, no
 * storage. Given a day and the catalogue, this module answers "how much of
 * what did the user eat, and how does that compare with their goals".
 *
 * RESPONSIBILITIES
 *  - Aggregate a day's entries into nutrient totals
 *  - Count fruit and vegetable servings
 *  - Convert glasses of water into litres
 *  - Report progress against a goal, and the band a percentage falls into
 *
 * ENERGY OVERRIDE, AND WHY IT EXISTS
 * A logged entry may carry `kcalOverride` when the user types their own
 * calories, for example a packet label that disagrees with the source table.
 * Overriding calories without also adjusting macros would leave a row reading
 * "250 kcal, 18 g protein, 40 g carbs" which adds up to more than 250. So the
 * macros are scaled by the ratio of override to source energy, keeping every
 * row internally consistent.
 *
 * MISSING VALUES
 * A nutrient the source did not provide is null, not zero. Totals report null
 * as "unknown" rather than quietly counting it as nothing, which matches the
 * promise the app makes in its own footer.
 */

import { countServings, progressPct } from '../../nutrition.js';

const GRAMS_PER_SERVING = 100;
const MILLILITRES_PER_GLASS = 250;
const SODIUM_NUTRIENT_ID = '1093';
const SUGAR_NUTRIENT_ID = '1063';

export const FRUIT_CATEGORY = 'Fruit';
export const VEGETABLE_CATEGORY = 'Vegetables';

/**
 * Calories for one entry, honouring a user override.
 * @param {{grams:number, kcalOverride?:number}} entry
 * @param {{energy:number}} food
 * @returns {number}
 */
export function caloriesForEntry(entry, food) {
  if (!food) return 0;
  if (Number.isFinite(entry.kcalOverride)) return entry.kcalOverride;
  return food.energy * entry.grams / 100;
}

/**
 * Every nutrient for one entry, with macros scaled if calories were overridden.
 * @param {{grams:number, kcalOverride?:number}} entry
 * @param {{energy:number, protein?:number, carbs?:number, fat?:number}} food
 * @returns {{energy:number, protein:number, carbs:number, fat:number}}
 */
export function nutrientsForEntry(entry, food) {
  const fromSource = {
    energy: food.energy * entry.grams / 100,
    protein: food.protein * entry.grams / 100,
    carbs: food.carbs * entry.grams / 100,
    fat: food.fat * entry.grams / 100,
  };

  if (!Number.isFinite(entry.kcalOverride)) return fromSource;

  const sourceEnergy = fromSource.energy;
  if (!sourceEnergy) return fromSource;

  const scale = entry.kcalOverride / sourceEnergy;
  return {
    energy: entry.kcalOverride,
    protein: fromSource.protein * scale,
    carbs: fromSource.carbs * scale,
    fat: fromSource.fat * scale,
  };
}

/**
 * Aggregate everything logged on one day.
 *
 * @param {object} params
 * @param {Array} params.entries      entries belonging to the day
 * @param {object} params.foodsById   id -> food lookup
 * @param {object} params.goals       the user's goal set
 * @param {number} params.waterGlasses
 * @returns {object} daily nutrition summary
 */
export function summariseDay({ entries, foodsById, goals, waterGlasses }) {
  const totals = { energy: 0, protein: 0, carbs: 0, fat: 0 };
  let fiber = 0;
  let fiberComplete = true;
  let sodium = 0;
  let sodiumKnown = false;
  let sugar = 0;

  for (const entry of entries) {
    const food = foodsById(entry.foodId);
    if (!food) continue;

    const nutrients = nutrientsForEntry(entry, food);
    for (const key of Object.keys(totals)) totals[key] += nutrients[key] || 0;

    if (food.fiber != null) fiber += food.fiber * entry.grams / 100;
    else fiberComplete = false;

    if (food.sodium != null) { sodium += food.sodium * entry.grams / 100; sodiumKnown = true; }
    if (food.sugar != null) sugar += food.sugar * entry.grams / 100;

    if (food.nutrients) {
      const sodiumPer100g = food.nutrients[SODIUM_NUTRIENT_ID];
      if (sodiumPer100g != null) { sodium += sodiumPer100g * entry.grams / 100; sodiumKnown = true; }
      const sugarPer100g = food.nutrients[SUGAR_NUTRIENT_ID];
      if (sugarPer100g != null) sugar += sugarPer100g * entry.grams / 100;
    }
  }

  return {
    ...totals,
    fiber: entries.length && fiberComplete ? fiber : null,
    sodium: sodiumKnown ? sodium : null,
    sugar,
    waterLitres: Math.round(waterGlasses * MILLILITRES_PER_GLASS / 1000 * 10) / 10,
    servings: {
      fruit: countServings(entries, foodsById, [FRUIT_CATEGORY]),
      veg: countServings(entries, foodsById, [VEGETABLE_CATEGORY]),
    },
    goals,
    entryCount: entries.length,
  };
}

/**
 * What is left of each goal today.
 * @returns {Array<{label:string, remaining:number, unit:string}>}
 */
export function remainingAgainstGoals(summary) {
  const goals = summary.goals;
  return [
    { label: 'Calories', remaining: Math.max(0, Math.round(goals.calories - summary.energy)), unit: 'kcal' },
    { label: 'Protein', remaining: Math.max(0, Math.round(goals.protein - summary.protein)), unit: 'g' },
    { label: 'Carbs', remaining: Math.max(0, Math.round(goals.carbs - summary.carbs)), unit: 'g' },
    { label: 'Fat', remaining: Math.max(0, Math.round(goals.fat - summary.fat)), unit: 'g' },
    { label: 'Water', remaining: Math.max(0, Math.round((goals.waterL - summary.waterLitres) * 10) / 10), unit: 'L' },
    { label: 'Fruit', remaining: Math.max(0, Math.round((goals.fruit - summary.servings.fruit) * 10) / 10), unit: 'servings' },
    { label: 'Vegetables', remaining: Math.max(0, Math.round((goals.veg - summary.servings.veg) * 10) / 10), unit: 'servings' },
  ];
}

export { progressPct, GRAMS_PER_SERVING, MILLILITRES_PER_GLASS };
