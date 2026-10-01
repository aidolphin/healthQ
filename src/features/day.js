/**
 * @file src/features/day.js
 * @module features/day
 *
 * PURPOSE
 * The "My Day" dashboard: goals, four meal cards, progress rings, the coach,
 * water, and the read-only link into My Health.
 *
 * DESIGN RULE THAT SHAPES THIS FILE
 * My Day never stores health data. Weight, height, BMI, blood pressure and
 * activity are read from the single record kept by the health module and
 * displayed here. That is what prevents a second copy of a weight record from
 * appearing the moment onboarding runs.
 *
 * RENDER COST
 * Rendering rebuilds roughly 500 nodes. It runs on user actions only, never on
 * a timer, and the food list it reads is already filtered upstream, so this is
 * not on any hot path. If it ever becomes one, the fix is to diff the meal
 * cards rather than to re-render wholesale.
 */

import { byId, escapeHtml, formatOneDecimal, newRecordId, todayKey } from '../core/dom.js';
import { state, saveState } from '../core/storage.js';
import { showNotice } from '../core/notices.js';
import { foods, displayFoods, foodById } from '../../data/catalogue.js';
import { MEALS, reviewDay, hydrationTip } from '../../nutrition.js';
import { suggestFoodsForMeal, mealsNeedingSuggestions } from '../services/suggestions.js';
import {
  summariseDay, remainingAgainstGoals, caloriesForEntry, progressPct, MILLILITRES_PER_GLASS,
} from '../services/dailyNutrition.js';
import { bodyMassIndex, bodyMassIndexBand, currentGoals } from '../services/healthProfile.js';
import { openGoalsDialog, openEditEntryDialog } from './dialogs.js';
import { openAddFoodDialog, openServingsDialog, openPhotoDialog, setRenderedDay, useDayRefresh } from './entryDialogs.js';

const PROGRESS_RING_RADIUS = 40;
const DIALETS = ['vegetarian', 'vegan', 'halal', 'glutenfree', 'lowcarb'];
const DIALET_LABELS = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  halal: 'Halal',
  glutenfree: 'Gluten free',
  lowcarb: 'Low carb',
};

/** The day currently on screen. Not always today: the user can browse back. */
let displayedDate = todayKey();

export function setDisplayedDate(dateKey) {
  displayedDate = dateKey;
  setRenderedDay(dateKey);
}

function entriesForDisplayedDay() {
  return state.entries.filter(entry => entry.date === displayedDate && Boolean(foodById(entry.foodId)));
}

function waterGlassesForDisplayedDay() {
  return state.water[displayedDate] || 0;
}

// ── Water ────────────────────────────────────────────────────────────────────

function addGlasses(delta) {
  const next = Math.max(0, waterGlassesForDisplayedDay() + delta);
  state.water[displayedDate] = next;
  saveState(message => showNotice(message));
  renderDay();
}

// ── Progress rings ───────────────────────────────────────────────────────────

function progressBandClass(percentage) {
  if (percentage >= 100) return 'done';
  if (percentage >= 75) return 'good';
  if (percentage >= 40) return 'mid';
  return 'low';
}

function renderProgressRing(label, actual, target, actualWithUnit) {
  const percentage = progressPct(actual, target);
  const circumference = 2 * Math.PI * PROGRESS_RING_RADIUS;
  const offset = circumference * (1 - Math.min(percentage, 100) / 100);

  return `<div class="ring ${progressBandClass(percentage)}">
    <svg viewBox="0 0 100 100" role="img" aria-label="${label} ${percentage} percent of goal">
      <circle class="ring-track" cx="50" cy="50" r="${PROGRESS_RING_RADIUS}"></circle>
      <circle class="ring-fill" cx="50" cy="50" r="${PROGRESS_RING_RADIUS}"
              stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"></circle>
      <text class="ring-num" x="50" y="49" text-anchor="middle">${percentage}%</text>
      <text class="ring-lbl" x="50" y="64" text-anchor="middle">${escapeHtml(label)}</text>
    </svg>
    <span class="ring-cap">${escapeHtml(actualWithUnit)}</span>
  </div>`;
}

function renderProgressRings(summary) {
  const goals = summary.goals;
  const rings = [
    ['Calories', summary.energy, goals.calories, `${Math.round(summary.energy)} / ${goals.calories} kcal`],
    ['Protein', summary.protein, goals.protein, `${Math.round(summary.protein)} / ${goals.protein} g`],
    ['Carbs', summary.carbs, goals.carbs, `${Math.round(summary.carbs)} / ${goals.carbs} g`],
    ['Fat', summary.fat, goals.fat, `${Math.round(summary.fat)} / ${goals.fat} g`],
  ];

  byId('rings').innerHTML = rings
    .map(([label, actual, target, caption]) => renderProgressRing(label, actual, target, caption))
    .join('');

  byId('ringNote').textContent = summary.entryCount
    ? `${summary.entryCount} item${summary.entryCount === 1 ? '' : 's'} logged`
    : 'nothing logged yet';
}

// ── Remaining ────────────────────────────────────────────────────────────────

function renderRemaining(summary) {
  byId('remaining').innerHTML = remainingAgainstGoals(summary)
    .map(row => `<div class="rem-row"><span>${row.label}</span><b>${row.remaining} ${row.unit}</b></div>`)
    .join('');

  const overshoot = summary.energy - summary.goals.calories;
  byId('remCal').textContent = overshoot > 0 ? `${Math.round(overshoot)} kcal over` : 'on track';
}

// ── Goal bars ────────────────────────────────────────────────────────────────

function renderGoalBars(summary) {
  const goals = summary.goals;
  const rows = [
    ['Calories', summary.energy, goals.calories, 'kcal'],
    ['Protein', summary.protein, goals.protein, 'g'],
    ['Carbs', summary.carbs, goals.carbs, 'g'],
    ['Fat', summary.fat, goals.fat, 'g'],
    ['Water', summary.waterLitres, goals.waterL, 'L'],
    ['Fruit', summary.servings.fruit, goals.fruit, ''],
    ['Vegetables', summary.servings.veg, goals.veg, ''],
  ];

  const bars = rows.map(([label, actual, target, unit]) => {
    const percentage = progressPct(actual, target);
    const colour = {
      done: 'var(--p-done)', good: 'var(--p-good)', mid: 'var(--p-mid)', low: 'var(--p-low)',
    }[progressBandClass(percentage)];

    return `<div class="goal-bar">
      <div class="bar-top"><span>${label}</span><strong>${formatOneDecimal(actual)} / ${target} ${unit}</strong></div>
      <div class="bar"><i style="width:${Math.min(100, percentage)}%;background:${colour}"></i></div>
    </div>`;
  });

  // Custom goals are checkboxes rather than numeric bars.
  const customGoals = (goals.custom ?? []).map(custom => {
    const isDone = Boolean(state.customLog[displayedDate]?.[custom.key]);
    return `<label class="hl"><span class="k">${escapeHtml(custom.label)}</span>
      <input type="checkbox" data-custom-goal="${escapeHtml(custom.key)}" ${isDone ? 'checked' : ''}></label>`;
  });

  byId('goalBars').innerHTML = bars.join('') + customGoals.join('');

  for (const checkbox of byId('goalBars').querySelectorAll('[data-custom-goal]')) {
    checkbox.onchange = () => {
      state.customLog[displayedDate] = state.customLog[displayedDate] || {};
      state.customLog[displayedDate][checkbox.dataset.customGoal] = checkbox.checked;
      saveState(message => showNotice(message));
      renderDay();
    };
  }
}

// ── Meal cards ───────────────────────────────────────────────────────────────

function mealEntriesByType(entries) {
  const grouped = {};
  for (const meal of MEALS) grouped[meal] = [];
  for (const entry of entries) {
    const bucket = grouped[entry.meal] ?? grouped.Breakfast;
    bucket.push(entry);
  }
  return grouped;
}

function renderMealCards(entries) {
  const grouped = mealEntriesByType(entries);

  byId('mealTotal').textContent = entries.length
    ? `${entries.length} item${entries.length === 1 ? '' : 's'}`
    : '';

  byId('mealCards').innerHTML = MEALS.map(meal => {
    const mealEntries = grouped[meal] ?? [];
    const mealCalories = mealEntries.reduce((sum, entry) => sum + caloriesForEntry(entry, foodById(entry.foodId)), 0);
    const hasPhoto = Boolean(state.photos[displayedDate]?.[meal]);

    const rows = mealEntries.length
      ? mealEntries.map(entry => {
        const food = foodById(entry.foodId);
        const isCustom = Number.isFinite(entry.kcalOverride);
        const hasEntryPhoto = Boolean(state.photos[displayedDate]?.[entry.id]);

        return `<div class="meal-row">
          <div>
            <span class="nm">${escapeHtml(food.name)}</span>
            <span class="mt">${entry.grams} g · ${Math.round(caloriesForEntry(entry, food))} kcal${isCustom ? ' · custom' : ''}${hasEntryPhoto ? ' · photo' : ''}</span>
          </div>
          <div>
            <button class="secondary" data-edit-entry="${entry.id}" aria-label="Edit ${escapeHtml(food.name)}">Edit</button>
            <button class="link-btn" data-remove-entry="${entry.id}" aria-label="Remove ${escapeHtml(food.name)}">Remove</button>
          </div>
        </div>`;
      }).join('')
      : '<p class="meal-empty">Nothing yet.</p>';

    return `<div class="meal-card">
      <div class="meal-head">
        <strong>${meal}</strong>
        <span class="kcal">${Math.round(mealCalories)} kcal${mealEntries.length ? ` · ${mealEntries.length}` : ''}</span>
      </div>
      <div class="meal-body">${rows}</div>
      <div class="meal-foot">
        <button class="secondary" data-add-to-meal="${meal}">+ Add food</button>
        <button class="secondary" data-open-servings="${meal}">Servings</button>
        <button class="secondary" data-add-photo="${meal}">${hasPhoto ? 'Replace photo' : 'Photo'}</button>
      </div>
    </div>`;
  }).join('');

  wireMealCardControls();
}

function wireMealCardControls() {
  const container = byId('mealCards');

  for (const button of container.querySelectorAll('[data-add-to-meal]')) {
    button.onclick = () => openAddFoodDialog(button.dataset.addToMeal, renderDay);
  }
  for (const button of container.querySelectorAll('[data-open-servings]')) {
    button.onclick = () => openServingsDialog(button.dataset.openServings, renderDay);
  }
  for (const button of container.querySelectorAll('[data-add-photo]')) {
    button.onclick = () => openPhotoDialog(button.dataset.addPhoto, renderDay);
  }
  for (const button of container.querySelectorAll('[data-edit-entry]')) {
    button.onclick = () => openEditEntryDialog(button.dataset.editEntry, renderDay);
  }
  for (const button of container.querySelectorAll('[data-remove-entry]')) {
    button.onclick = () => removeEntry(button.dataset.removeEntry);
  }
}

function removeEntry(entryId) {
  const entry = state.entries.find(candidate => candidate.id === entryId);
  const food = entry ? foodById(entry.foodId) : null;

  requestRemoval({
    title: 'Remove this entry?',
    message: `${food ? food.name : 'This food'} will be removed from ${entry ? entry.meal : 'this day'}.`,
    onConfirm: () => {
      state.entries = state.entries.filter(candidate => candidate.id !== entryId);
      if (state.photos[displayedDate]) delete state.photos[displayedDate][entryId];
      saveState(message => showNotice(message));
      renderDay();
    },
  });
}

/** Injected by main.js so features do not depend on each other directly. */
let requestRemoval = () => {};
export function useConfirmRemoval(implementation) {
  requestRemoval = implementation;
}

// ── Coach ────────────────────────────────────────────────────────────────────

function renderCoach(summary) {
  const notes = reviewDay({
    goals: summary.goals,
    intake: summary,
    entryCount: summary.entryCount,
    servings: summary.servings,
    conditions: state.conditions,
    allergies: state.allergies,
    custom: state.customLog[displayedDate] ?? {},
  });

  byId('coach').innerHTML = notes
    .map(note => `<div class="coach-item ${note.level}">
      <b>${escapeHtml(note.title)}</b><span>${escapeHtml(note.text)}</span>
    </div>`)
    .join('');
}

// ── Water ────────────────────────────────────────────────────────────────────

function renderWater(summary) {
  byId('waterCount').textContent = waterGlassesForDisplayedDay();
  byId('waterGoal').textContent = `${summary.goals.waterL} L goal`;
  byId('waterTip').textContent = hydrationTip(summary.waterLitres, summary.goals.waterL);

  for (const button of document.querySelectorAll('[data-water]')) {
    button.onclick = () => addGlasses(Number(button.dataset.water));
  }
}

// ── Health link (read only) ──────────────────────────────────────────────────

function renderHealthLink() {
  const latestWeight = state.weights[state.weights.length - 1];
  const profile = state.profile;
  const bodyMass = profile && latestWeight ? bodyMassIndex(latestWeight.value, profile.height) : null;
  const latestPressure = state.pressures[state.pressures.length - 1];

  const rows = [];
  if (latestWeight) rows.push(['Weight', `${latestWeight.value} kg`]);
  if (profile?.height) rows.push(['Height', `${profile.height} cm`]);
  if (bodyMass) rows.push(['BMI', `${formatOneDecimal(bodyMass)} (${bodyMassIndexBand(bodyMass)})`]);
  if (profile?.age) rows.push(['Age', profile.age]);
  if (profile?.activity) rows.push(['Activity', `${Math.round((profile.activity - 1) * 100)}% above sedentary`]);
  if (latestPressure) rows.push(['Blood pressure', `${latestPressure.systolic}/${latestPressure.diastolic}`]);
  if (state.conditions.length) rows.push(['Conditions', `${state.conditions.length} on file`]);
  if (state.allergies.length) rows.push(['Allergies', `${state.allergies.length} on file`]);
  if (state.diets.length) rows.push(['Diet', `${state.diets.length} selected`]);

  byId('healthLink').innerHTML = rows.length
    ? rows.map(([key, value]) => `<div class="hl"><span class="k">${key}</span><span class="v">${escapeHtml(value)}</span></div>`).join('')
    : '<p class="empty">No health data yet. Add it once in My Health and it appears here automatically.</p>';
}

// ── Suggestions ──────────────────────────────────────────────────────────────

function renderDietFilter() {
  byId('dietFilter').innerHTML = DIALETS
    .map(diet => `<button type="button" class="${state.diets.includes(diet) ? 'on' : ''}" data-diet="${diet}">${DIALET_LABELS[diet]}</button>`)
    .join('');

  for (const button of byId('dietFilter').querySelectorAll('[data-diet]')) {
    button.onclick = () => {
      const diet = button.dataset.diet;
      state.diets = state.diets.includes(diet)
        ? state.diets.filter(active => active !== diet)
        : [...state.diets, diet];
      saveState(message => showNotice(message));
      renderDay();
    };
  }
}

function renderSuggestions(summary) {
  const needs = mealsNeedingSuggestions(summary);
  const mealsToSuggest = MEALS.filter(meal => needs[meal]);
  const chosenMeals = mealsToSuggest.length ? mealsToSuggest : ['Lunch'];

  byId('suggestions').innerHTML = chosenMeals.map(meal => {
    const picks = suggestFoodsForMeal(displayFoods, {
      meal,
      diets: state.diets,
      allergies: state.allergies,
      weightGoal: summary.goals.weightGoal,
      limit: 3,
    });
    if (!picks.length) return '';

    const cards = picks.map(pick => `<div class="sug">
      <b>${escapeHtml(pick.title)}</b>
      <span class="why">${escapeHtml(pick.reason)}</span>
      <span class="mac">${pick.food.energy} kcal · P ${pick.food.protein ?? '—'} · C ${pick.food.carbs ?? '—'} · F ${pick.food.fat ?? '—'} / 100 g</span>
      <span class="src">${escapeHtml(String(pick.food.source).slice(0, 42))}</span>
      <button class="secondary" data-add-suggestion="${pick.food.id}" data-suggestion-meal="${meal}">Add 100 g</button>
    </div>`).join('');

    return `<div style="margin-bottom:14px">
      <div class="surface-head"><h3 style="font-size:15px">${meal}</h3></div>
      <div class="sug-grid">${cards}</div>
    </div>`;
  }).join('');

  for (const button of byId('suggestions').querySelectorAll('[data-add-suggestion]')) {
    button.onclick = () => {
      const food = foodById(Number(button.dataset.addSuggestion));
      if (!food) return;
      state.entries.push({
        id: newRecordId(),
        foodId: food.id,
        grams: 100,
        meal: button.dataset.suggestionMeal,
        date: displayedDate,
      });
      saveState(message => showNotice(message));
      renderDay();
    };
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Recalculate goals from the profile stored in My Health. */
export function recalculateGoalsFromProfile() {
  const derived = currentGoals(state);
  if (!derived) return false;
  state.goals = { ...derived, custom: state.goals.custom ?? [] };
  saveState(message => showNotice(message));
  renderDay();
  return true;
}

export function renderDay() {
  const entries = entriesForDisplayedDay();
  const summary = summariseDay({
    entries,
    foodsById: foodById,
    goals: state.goals,
    waterGlasses: waterGlassesForDisplayedDay(),
  });

  byId('dayPicker').value = displayedDate;
  renderProgressRings(summary);
  renderRemaining(summary);
  renderGoalBars(summary);
  renderMealCards(entries);
  renderCoach(summary);
  renderWater(summary);
  renderHealthLink();
  renderDietFilter();
  renderSuggestions(summary);
}

export function mountDayFeature() {
  useDayRefresh(renderDay);
  setRenderedDay(displayedDate);

  byId('dayPicker').onchange = event => {
    setDisplayedDate(event.target.value);
    renderDay();
  };
  byId('editGoals').onclick = () => openGoalsDialog(renderDay);
  byId('syncGoals').onclick = () => {
    if (!recalculateGoalsFromProfile()) {
      showNotice('Add your height and a weight in My Health first.');
    }
  };
  byId('toHealth').onclick = () => document.getElementById('tab-health').click();
  byId('toHealth2').onclick = () => document.getElementById('tab-health').click();
}

export { foods, MILLILITRES_PER_GLASS, DIALETS };
