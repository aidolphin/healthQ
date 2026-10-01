/**
 * @file src/services/healthProfile.js
 * @module services/healthProfile
 *
 * PURPOSE
 * Derives health metrics from the body profile, and the daily nutrition goals
 * that follow from them.
 *
 * RESPONSIBILITIES
 *  - BMI and its descriptive band
 *  - Basal metabolic rate (Mifflin-St Jeor)
 *  - Total daily energy expenditure
 *  - A full goal set, adjusted for declared health conditions
 *
 * A NOTE ON WHAT THIS IS NOT
 * These are population reference equations. They are not a diagnosis, not a
 * prescription, and not a substitute for a clinician. The UI labels them as
 * reference values for exactly that reason, and the module refuses to guess:
 * every function returns null when the inputs are incomplete rather than
 * inventing a plausible-looking number.
 */

const MILLILITRES_PER_KILO_PER_DAY = 35;
const MINIMUM_CALORIES = 1200;
const MAXIMUM_CALORIES = 5000;

const BMI_BANDS = [
  { limit: 18.5, label: 'Underweight' },
  { limit: 25, label: 'Normal range' },
  { limit: 30, label: 'Overweight' },
  { limit: Infinity, label: 'Obese range' },
];

const ACTIVITY_LEVELS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  veryActive: 1.9,
};

const weightTargetAdjustments = {
  lose: { calories: -400, proteinPerKg: 1.8 },
  maintain: { calories: 0, proteinPerKg: 1.4 },
  gain: { calories: 300, proteinPerKg: 1.6 },
};

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * @param {number} weightKg
 * @param {number} heightCm
 * @returns {number|null}
 */
export function bodyMassIndex(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  return weightKg / Math.pow(heightCm / 100, 2);
}

/**
 * @param {number} bodyMassIndexValue
 * @returns {string}
 */
export function bodyMassIndexBand(bodyMassIndexValue) {
  if (bodyMassIndexValue == null) return '—';
  const band = BMI_BANDS.find(candidate => bodyMassIndexValue < candidate.limit);
  return band.label;
}

/**
 * Mifflin-St Jeor. The most widely used equation for adults without direct
 * measurement of resting energy expenditure.
 */
export function basalMetabolicRate({ weightKg, heightCm, age, sex }) {
  if (!weightKg || !heightCm || !age) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

export function activityMultiplier(level) {
  return ACTIVITY_LEVELS[level] ?? 1.2;
}

/**
 * Build a complete goal set from the profile.
 *
 * Health conditions shift the macro split, which is the part most likely to be
 * wrong for a given person: diabetes reduces the carbohydrate allowance, high
 * cholesterol reduces fat, and kidney disease lowers the protein target to a
 * level a clinician should confirm.
 *
 * @returns {object|null} goals, or null when the profile is incomplete
 */
export function deriveGoalsFromProfile({ weightKg, heightCm, age, sex, activityLevel, weightGoal, conditions = [] }) {
  if (!weightKg || !heightCm || !age) return null;

  const basalRate = basalMetabolicRate({ weightKg, heightCm, age, sex });
  const direction = weightGoal || 'maintain';
  const adjustment = weightTargetAdjustments[direction] ?? weightTargetAdjustments.maintain;

  const maintenance = basalRate * activityMultiplier(activityLevel);
  const targetCalories = Math.round(maintenance + adjustment.calories);

  let protein = Math.round(weightKg * adjustment.proteinPerKg);
  let fat = Math.round(targetCalories * 0.28 / 9);
  let carbs = Math.round((targetCalories - protein * 4 - fat * 9) / 4);

  if (conditions.includes('diabetes')) carbs = Math.round(carbs * 0.7);
  if (conditions.includes('hyperlipid')) fat = Math.round(fat * 0.8);
  if (conditions.includes('kidney')) protein = Math.round(weightKg);

  return {
    calories: clamp(targetCalories, MINIMUM_CALORIES, MAXIMUM_CALORIES),
    protein: clamp(protein, 20, 300),
    carbs: Math.max(carbs, 0),
    fat: Math.max(fat, 0),
    waterL: Math.round(clamp(weightKg * MILLILITRES_PER_KILO_PER_DAY / 1000, 1.5, 5) * 10) / 10,
    fruit: 2,
    veg: 3,
    weightGoal: direction,
  };
}

/**
 * Combine the stored profile with the latest weight, which is how the goals
 * follow a weight change without the user re-entering their height or age.
 * @returns {object|null}
 */
export function currentGoals(state) {
  const profile = state.profile;
  const latestWeight = state.weights[state.weights.length - 1];
  if (!profile || !latestWeight || !profile.height || !profile.age) return null;

  return deriveGoalsFromProfile({
    weightKg: latestWeight.value,
    heightCm: profile.height,
    age: profile.age,
    sex: profile.sex,
    activityLevel: profile.activity,
    weightGoal: state.goals?.weightGoal,
    conditions: state.conditions ?? [],
  });
}

export { ACTIVITY_LEVELS, weightTargetAdjustments, MILLILITRES_PER_KILO_PER_DAY };
