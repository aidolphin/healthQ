/**
 * @file src/features/dialogs.js
 * @module features/dialogs
 *
 * PURPOSE
 * Modal dialogs used by My Day: the goals editor and the single-entry editor.
 *
 * WHY THESE LIVE TOGETHER
 * All five dialogs in the app share one contract: fill the markup, read the
 * result back, write to storage, close. Splitting each into its own file would
 * repeat that contract five times for no benefit, so they share a small set of
 * helpers and differ only in their bodies.
 */

import { byId, escapeHtml, formatOneDecimal } from '../core/dom.js';
import { state, saveState } from '../core/storage.js';
import { showNotice } from '../core/notices.js';
import { foodById } from '../../data/catalogue.js';
import { CONDITIONS, ALLERGENS, DIETS, WEIGHT_GOALS, clamp } from '../../nutrition.js';
import { caloriesForEntry, nutrientsForEntry } from '../services/dailyNutrition.js';

const MAX_CALORIES = 6000;
const MIN_CALORIES = 800;

/** Read a numeric input, treating blank as zero. */
function readNumber(elementId) {
  const raw = byId(elementId).value.trim();
  return raw === '' ? 0 : Number(raw);
}

/** Render a group of toggle chips and report the selected ids. */
function renderChipGroup(container, items, selectedIds) {
  container.innerHTML = items
    .map(item => `<button type="button" class="${selectedIds.includes(item.id) ? 'active' : ''}" data-pick="${item.id}">${escapeHtml(item.label)}</button>`)
    .join('');
  return new Set([...container.querySelectorAll('[data-pick].active')].map(button => button.dataset.pick));
}

// ── Goals ────────────────────────────────────────────────────────────────────

export function openGoalsDialog(onChanged) {
  const goals = state.goals;

  byId('gCalories').value = goals.calories;
  byId('gProtein').value = goals.protein;
  byId('gCarbs').value = goals.carbs;
  byId('gFat').value = goals.fat;
  byId('gWater').value = goals.waterL;
  byId('gFruit').value = goals.fruit;
  byId('gVeg').value = goals.veg;
  byId('gWeight').value = goals.weightGoal;
  byId('gCustom').value = goals.custom?.[0]?.label ?? '';

  const conditions = renderChipGroup(byId('condList'), CONDITIONS, state.conditions);
  const allergens = renderChipGroup(byId('allergenList'), ALLERGENS, state.allergies);
  const diets = renderChipGroup(byId('dietList'), DIETS, state.diets);

  const describeCustomGoal = () => {
    const label = byId('gCustom').value.trim();
    byId('customHint').textContent = label
      ? `Custom goal "${label}" will appear under Today's goals.`
      : 'Leave blank for no custom goal.';
  };
  byId('gCustom').oninput = describeCustomGoal;
  describeCustomGoal();

  byId('goalsForm').onsubmit = event => {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();

    const calories = readNumber('gCalories');
    if (calories < MIN_CALORIES || calories > MAX_CALORIES) {
      showNotice(`Calories must be between ${MIN_CALORIES} and ${MAX_CALORIES}.`);
      return;
    }

    const customLabel = byId('gCustom').value.trim();
    state.goals = {
      calories,
      protein: readNumber('gProtein'),
      carbs: readNumber('gCarbs'),
      fat: readNumber('gFat'),
      waterL: clamp(readNumber('gWater'), 0, 10),
      fruit: readNumber('gFruit'),
      veg: readNumber('gVeg'),
      weightGoal: byId('gWeight').value,
      custom: customLabel
        ? [{ key: `c${customLabel.toLowerCase().replace(/[^a-z0-9]+/g, '')}`, label: customLabel }]
        : [],
    };
    state.conditions = [...conditions];
    state.allergies = [...allergens];
    state.diets = [...diets];

    saveState(message => showNotice(message));
    byId('goalsDialog').close();
    if (onChanged) onChanged();
  };
}

// ── Single entry ─────────────────────────────────────────────────────────────

export function openEditEntryDialog(entryId, onChanged) {
  const entry = state.entries.find(candidate => candidate.id === entryId);
  const food = entry ? foodById(entry.foodId) : null;
  if (!entry || !food) return;

  byId('editTitle').textContent = food.name;
  byId('editSource').textContent = `${food.category} · ${food.energy} kcal per 100 g · USDA FDC ${food.fdcId ?? '—'}`;
  byId('editGrams').value = String(entry.grams);
  byId('editMeal').value = entry.meal || 'Breakfast';
  byId('editKcal').value = Number.isFinite(entry.kcalOverride) ? String(entry.kcalOverride) : '';

  const describe = () => updateEditHint(entry, food);
  byId('editGrams').oninput = describe;
  byId('editKcal').oninput = describe;
  describe();

  byId('editForm').onsubmit = event => {
    if (event.submitter?.value === 'cancel') return;
    event.preventDefault();

    const grams = Number(byId('editGrams').value);
    if (!Number.isFinite(grams) || grams < 1 || grams > 5000) {
      showNotice('Enter an amount between 1 and 5,000 g.');
      return;
    }

    const overrideRaw = byId('editKcal').value.trim();
    if (overrideRaw !== '') {
      const override = Number(overrideRaw);
      if (!Number.isFinite(override) || override < 0 || override > 20000) {
        showNotice('Enter calories between 0 and 20,000.');
        return;
      }
      entry.kcalOverride = override;
    } else {
      delete entry.kcalOverride;
    }

    entry.grams = grams;
    entry.meal = byId('editMeal').value;

    saveState(message => showNotice(message));
    byId('editDialog').close();
    onChanged();
  };

  byId('editGrams').focus();
  byId('editGrams').select();
  byId('editDialog').showModal();
}

function updateEditHint(entry, food) {
  const grams = Number(byId('editGrams').value);
  if (!Number.isFinite(grams) || grams < 1 || grams > 5000) {
    byId('editHint').textContent = 'Enter an amount between 1 and 5,000 g.';
    return;
  }

  const sourceCalories = Math.round(food.energy * grams / 100);
  const overrideRaw = byId('editKcal').value.trim();

  if (overrideRaw === '') {
    byId('editHint').textContent =
      `Source value for ${grams} g: ${sourceCalories} kcal. Leave calories blank to use it.`;
    return;
  }

  const override = Number(overrideRaw);
  if (!Number.isFinite(override) || override < 0 || override > 20000) {
    byId('editHint').textContent = 'Enter calories between 0 and 20,000.';
    return;
  }

  byId('editHint').textContent =
    `Using your custom ${Math.round(override)} kcal instead of ${sourceCalories} kcal. Nutrients scale proportionally.`;
}

export { caloriesForEntry, nutrientsForEntry, formatOneDecimal, WEIGHT_GOALS };
