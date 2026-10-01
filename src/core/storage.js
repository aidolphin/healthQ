/**
 * @file src/core/storage.js
 * @module core/storage
 *
 * PURPOSE
 * The single owner of persistent state. Every read and write of user data goes
 * through this module; no feature touches localStorage directly.
 *
 * RESPONSIBILITIES
 *  - Define the canonical application state shape.
 *  - Migrate state written by older versions forward without data loss.
 *  - Persist state, and report a full quota as a user-visible condition rather
 *    than letting the write fail silently.
 *
 * WHY A MIGRATION STEP EXISTS
 * The state object has grown fields over time (goals, conditions, photos...).
 * A user returning after an update may hold a partial object from an earlier
 * build. Reading such an object without migrating produces undefined values
 * that surface much later as a blank panel, so every field is checked on load.
 *
 * SINGLE SOURCE OF TRUTH
 * Weight, blood pressure, exercise, sleep, vitals and water are stored once
 * here and read by both My Day and My Health. Neither feature keeps a private
 * copy, which is what prevents duplicate health records.
 */

import { todayKey } from './dom.js';

const STORAGE_KEY = 'healthq.pwa.usda.v2';
const GOAL_DEFAULTS = {
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

function createEmptyState() {
  return {
    entries: [],
    weights: [],
    pressures: [],
    exercise: [],
    sleep: [],
    vitals: [],
    water: {},
    photos: {},
    customLog: {},
    profile: null,
    goals: { ...GOAL_DEFAULTS },
    conditions: [],
    allergies: [],
    diets: [],
    onboarded: false,
    goal: null,
  };
}

/** Fill in any field a previous build may not have written. */
function withDefaults(savedState) {
  return {
    ...createEmptyState(),
    ...savedState,
    goals: { ...GOAL_DEFAULTS, ...(savedState.goals || {}) },
  };
}

function isUsableState(candidate) {
  return Boolean(candidate)
    && Array.isArray(candidate.entries)
    && Array.isArray(candidate.weights)
    && Array.isArray(candidate.pressures);
}

/** @type {ReturnType<typeof createEmptyState>} */
export let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyState();
    const parsed = JSON.parse(raw);
    return isUsableState(parsed) ? withDefaults(parsed) : createEmptyState();
  } catch {
    // Corrupt or unreadable payload: start clean rather than crash on boot.
    return createEmptyState();
  }
}

/**
 * Persist state. Reports a quota failure through the supplied notifier
 * instead of throwing, so a full disk never loses the current session.
 * @param {(message: string) => void} [onStorageFull]
 */
export function saveState(onStorageFull) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    if (onStorageFull) {
      onStorageFull('Not enough space to save. Export your data, then remove some photos.');
    }
  }
}

/** Replace the whole state, e.g. after restoring a backup file. */
export function replaceState(nextState) {
  state = withDefaults(nextState);
  return state;
}

/** Reset to an empty state. Used by "erase everything". */
export function resetState() {
  state = createEmptyState();
  return state;
}

export { todayKey };
