/**
 * @file src/services/suggestions.js
 * @module services/suggestions
 *
 * PURPOSE
 * Chooses which foods to surface as meal suggestions, honouring the user's
 * diet, allergies and weight goal.
 *
 * HOW IT WORKS
 * For each meal we hold a short list of culturally familiar ideas, resolve each
 * to a concrete food from the live catalogue, then rank what we found. Ranking
 * is a small scoring function, not a model: foods that support the user's
 * direction (protein and fibre when losing weight, energy density when gaining)
 * float to the top.
 *
 * WHY THE RANKING IS NOT A MODEL
 * There is no server in this build. A deterministic, inspectable ranking is
 * preferable to an opaque one: every suggestion can be traced to a category
 * match and a score, and the behaviour is identical on every device.
 *
 * SAFETY NOTE
 * Allergy filtering here is a convenience, not a guarantee. It matches on the
 * food's category, which cannot detect a trace allergen in a packaged product.
 * The UI never presents a filtered list as allergy-safe.
 */

import { FRUIT_CATEGORY } from './dailyNutrition.js';

const MEAL_IDEAS = {
  Breakfast: [
    { name: 'Moong dal with rice', query: 'moong dal', why: 'Protein and fibre to start the day.' },
    { name: 'Egg bhurji and roti', query: 'egg bhurji', why: 'Quick protein with a whole grain.' },
    { name: 'Fruit and curd', query: 'curd', why: 'Probiotic with a piece of fruit.' },
    { name: 'Porridge with milk', query: 'oatmeal', why: 'Slow-release carbohydrate.' },
    { name: 'Aloo paratha with yoghurt', query: 'paratha', why: 'Filling, but watch the oil.' },
  ],
  Lunch: [
    { name: 'Dal bhat (rice and lentil)', query: 'rice cooked', why: 'The everyday Nepali plate. Balanced if the dal carries the protein.' },
    { name: 'Chicken and vegetable curry with rice', query: 'chicken curry', why: 'Higher protein lunch.' },
    { name: 'Aloo with rice and salad', query: 'potato', why: 'Vegetable-forward, add dal for protein.' },
    { name: 'Roti with tarkari and dahi', query: 'tarkari', why: 'Light on meat, good with dahi.' },
    { name: 'Vegetable stir fry with noodles', query: 'vegetable stir', why: 'Fast and vegetable heavy.' },
  ],
  Dinner: [
    { name: 'Light dal and rice', query: 'dal', why: 'Easier to digest in the evening.' },
    { name: 'Grilled fish with vegetables', query: 'fish', why: 'Omega-3 and lean protein.' },
    { name: 'Khichdi with ghee', query: 'khichdi', why: 'Gentle on the stomach.' },
    { name: 'Roti with vegetable sabzi', query: 'sabzi', why: 'Balanced and light.' },
    { name: 'Egg curry with rice', query: 'egg curry', why: 'Protein without much oil.' },
  ],
  Snack: [
    { name: 'Seasonal fruit', query: 'apple raw', why: 'Fibre and water in one.' },
    { name: 'Roasted chana', query: 'chickpeas', why: 'Cheap protein and fibre.' },
    { name: 'Curd or buttermilk', query: 'curd', why: 'Light between meals.' },
    { name: 'Sprouted mung', query: 'mung bean', why: 'Very high protein for the weight.' },
    { name: 'A few almonds', query: 'almonds', why: 'Small portion, useful fats.' },
  ],
};

const DIET_FILTERS = {
  vegetarian: food => !/Meat & Seafood/.test(food.category),
  vegan: food => !/Meat & Seafood|Dairy & Eggs/.test(food.category),
  halal: food => !/Meat & Seafood/.test(food.category)
    || /Poultry|Beef|Fish|Shellfish/.test(food.category),
  glutenfree: food => !/Bakery & Breakfast|Grains & Pasta|Soups, Sauces & Spices/.test(food.category),
  lowcarb: food => !/Grains & Pasta|Sweets|Drinks/.test(food.category),
};

const ALLERGY_FILTERS = {
  milk: food => !/Dairy & Eggs/.test(food.category),
  gluten: food => !/Bakery & Breakfast|Grains & Pasta/.test(food.category),
  nuts: food => !/Nuts & Seeds/.test(food.category),
  peanut: food => !/Nuts & Seeds/.test(food.category),
  soy: food => !/Legumes & Soy/.test(food.category),
  seafood: food => !/Meat & Seafood/.test(food.category)
    || !/fish|shellfish|finfish|seaweed/i.test(food.name),
};

/**
 * @returns {boolean} true when a food passes every diet and allergy filter
 */
export function isFoodAllowed(food, diets = [], allergies = []) {
  for (const diet of diets) {
    const filter = DIET_FILTERS[diet];
    if (filter && !filter(food)) return false;
  }
  for (const allergen of allergies) {
    const filter = ALLERGY_FILTERS[allergen];
    if (filter && !filter(food)) return false;
  }
  return true;
}

function scoreForGoal(food, weightGoal) {
  const proteinPer100g = food.protein || 0;
  const fibrePer100g = food.fiber || 0;

  if (weightGoal === 'lose') {
    return (proteinPer100g >= 5 ? 3 : 0)
      + (fibrePer100g >= 2 ? 2 : 0)
      - (food.energy > 300 ? 1 : 0);
  }
  if (weightGoal === 'gain') {
    return (food.energy >= 150 ? 2 : 0) + (proteinPer100g >= 5 ? 2 : 0);
  }
  return (proteinPer100g >= 5 ? 1 : 0) + (fibrePer100g >= 2 ? 1 : 0);
}

/**
 * Pick concrete foods for one meal.
 * @returns {Array<{title:string, reason:string, food:object}>}
 */
export function suggestFoodsForMeal(catalogue, { meal, diets, allergies, weightGoal, limit = 3 }) {
  const ideas = MEAL_IDEAS[meal] ?? MEAL_IDEAS.Snack;
  const chosen = [];
  const alreadyPicked = new Set();

  for (const idea of ideas) {
    const matches = catalogue
      .filter(food => isFoodAllowed(food, diets, allergies))
      .filter(food => `${food.name} ${(food.aliases || []).join(' ')}`.toLowerCase().includes(idea.query))
      .slice(0, 12)
      .map(food => ({ food, score: scoreForGoal(food, weightGoal) }))
      .sort((a, b) => b.score - a.score);

    const best = matches.find(candidate => !alreadyPicked.has(candidate.food.id));
    if (!best) continue;

    alreadyPicked.add(best.food.id);
    chosen.push({ title: idea.name, reason: idea.why, food: best.food });
    if (chosen.length >= limit) break;
  }

  return chosen;
}

/**
 * Which meals are worth suggesting, given how the day is going.
 * A snack is only worth offering when fruit or vegetables are still short.
 */
export function mealsNeedingSuggestions(summary) {
  const goals = summary.goals;
  const needsProduce = summary.servings.fruit < goals.fruit || summary.servings.veg < goals.veg;

  return {
    Breakfast: true,
    Lunch: true,
    Dinner: summary.energy < goals.calories * 0.7,
    Snack: needsProduce,
  };
}

export { MEAL_IDEAS, FRUIT_CATEGORY };
