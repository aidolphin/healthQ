/**
 * @file src/features/entryDialogs.js
 * @module features/entryDialogs
 *
 * PURPOSE
 * The three dialogs that add or adjust a logged food: quick add, serving
 * shortcuts, and the meal photo.
 *
 * PHOTO STORAGE, AND WHY IT IS THUMBNAILED
 * Photos go into localStorage, which has roughly a 5 MB budget for the whole
 * origin. An original phone photo is commonly 3 to 5 MB, so storing one raw
 * would consume the entire quota and silently break every future save. Each
 * photo is therefore cropped square and re-encoded to JPEG at a 220 px edge and
 * 70% quality, which lands around 8 to 15 KB.
 */

import { byId, escapeHtml, newRecordId } from '../core/dom.js';
import { state, saveState } from '../core/storage.js';
import { showNotice } from '../core/notices.js';
import { searchFoods, foodById } from '../../data/catalogue.js';
import { nutrientsForEntry } from '../services/dailyNutrition.js';
import { isFoodAllowed } from '../services/suggestions.js';
import { MEALS } from '../../nutrition.js';

const MAX_RESULTS = 40;
const MIN_GRAMS = 1;
const MAX_GRAMS = 5000;
const PHOTO_EDGE_PIXELS = 220;
const PHOTO_JPEG_QUALITY = 0.7;

let targetMeal = 'Breakfast';
let photoTargetMeal = null;
let lastRenderedDay = null;
let onDayChanged = () => {};

/** The day feature registers its re-render callback here, so this module never
 *  reaches into another feature's internals. */
export function useDayRefresh(callback) {
  onDayChanged = callback;
}

/** Called by the day feature whenever the displayed date changes. */
export function setRenderedDay(dateKey) {
  lastRenderedDay = dateKey;
}

// ── Quick add ────────────────────────────────────────────────────────────────

function renderSearchResults() {
  const query = byId('afQuery').value.trim().toLowerCase();
  const matches = searchFoods(query, 'All')
    .filter(food => isFoodAllowed(food, state.diets, state.allergies))
    .slice(0, MAX_RESULTS);

  byId('afResults').innerHTML = matches.length
    ? matches.map(food => `<div class="af-row">
        <div>
          <span class="nm">${escapeHtml(food.name)}</span>
          <span class="mt">${escapeHtml(food.category)} · ${food.energy} kcal / 100 g</span>
        </div>
        <button class="secondary" data-pick-food="${food.id}">Pick</button>
      </div>`).join('')
    : '<p class="meal-empty">Nothing found.</p>';

  for (const button of byId('afResults').querySelectorAll('[data-pick-food]')) {
    button.onclick = () => showPortionEditor(Number(button.dataset.pickFood));
  }
}

function showPortionEditor(foodId) {
  const food = foodById(foodId);
  if (!food) return;

  byId('afPicked').innerHTML = `<div class="selected">
    <strong>${escapeHtml(food.name)}</strong>
    <p>${escapeHtml(food.category)} · ${food.energy} kcal / 100 g</p>
    <label class="field-label" for="afGrams">Amount (grams)</label>
    <input id="afGrams" type="number" min="1" max="5000" step="1" value="100" inputmode="decimal">
    <label class="field-label" for="afMeal">Meal</label>
    <select id="afMeal">${MEALS.map(meal =>
    `<option ${meal === targetMeal ? 'selected' : ''}>${meal}</option>`).join('')}</select>
    <div id="afPreview" class="preview"></div>
    <button id="afSave" class="primary" type="button">Add to ${targetMeal}</button>
  </div>`;

  const refreshPreview = () => {
    const grams = Number(byId('afGrams').value);
    if (!(grams > 0 && grams <= MAX_GRAMS)) {
      byId('afPreview').innerHTML = '<p class="fine">Enter 1 to 5,000 g.</p>';
      return;
    }
    const nutrients = nutrientsForEntry({ grams }, food);
    byId('afPreview').innerHTML = Object.entries(nutrients)
      .map(([name, value]) => `<div>
        <span>${name.charAt(0).toUpperCase() + name.slice(1)}</span>
        <strong>${name === 'energy' ? Math.round(value) : value.toFixed(1)} ${name === 'energy' ? 'kcal' : 'g'}</strong>
      </div>`).join('');
  };

  byId('afGrams').oninput = refreshPreview;
  refreshPreview();

  byId('afSave').onclick = () => {
    const grams = Number(byId('afGrams').value);
    if (!Number.isFinite(grams) || grams < MIN_GRAMS || grams > MAX_GRAMS) {
      showNotice('Enter an amount between 1 and 5,000 g.');
      return;
    }
    state.entries.push({
      id: newRecordId(),
      foodId: food.id,
      grams,
      meal: byId('afMeal').value,
      date: lastRenderedDay,
    });
    saveState(message => showNotice(message));
    byId('addFoodDialog').close();
    onDayChanged();
  };
}

export function openAddFoodDialog(meal) {
  targetMeal = meal;
  byId('afTitle').textContent = `Add to ${meal}`;
  byId('afQuery').value = '';
  byId('afPicked').innerHTML = '';
  renderSearchResults();
  byId('addFoodDialog').showModal();
  byId('afQuery').focus();
}

// ── Servings ─────────────────────────────────────────────────────────────────

export function openServingsDialog(meal, onChanged) {
  const entries = state.entries.filter(entry => entry.meal === meal);
  if (!entries.length) {
    showNotice('Nothing in this meal yet.');
    return;
  }

  byId('afTitle').textContent = 'Servings';
  byId('afPicked').innerHTML = entries.map(entry => {
    const food = foodById(entry.foodId);
    const nutrients = nutrientsForEntry(entry, food);
    return `<div class="meal-row">
      <div>
        <span class="nm">${escapeHtml(food.name)}</span>
        <span class="mt">${entry.grams} g · ${Math.round(nutrients.energy)} kcal</span>
      </div>
      <div>
        <button class="secondary" data-halve="${entry.id}">½</button>
        <button class="secondary" data-double="${entry.id}">×2</button>
      </div>
    </div>`;
  }).join('');

  const applyPortion = (entryId, transform) => {
    const entry = state.entries.find(candidate => candidate.id === entryId);
    if (!entry) return;
    entry.grams = Math.min(MAX_GRAMS, Math.max(MIN_GRAMS, transform(entry.grams)));
    // A custom calorie value described the old portion, so it no longer applies.
    delete entry.kcalOverride;
    saveState(message => showNotice(message));
    byId('addFoodDialog').close();
    onChanged();
  };

  for (const button of byId('afPicked').querySelectorAll('[data-halve]')) {
    button.onclick = () => applyPortion(button.dataset.halve, grams => Math.round(grams / 2));
  }
  for (const button of byId('afPicked').querySelectorAll('[data-double]')) {
    button.onclick = () => applyPortion(button.dataset.double, grams => Math.round(grams * 2));
  }

  byId('addFoodDialog').showModal();
}

// ── Photo ────────────────────────────────────────────────────────────────────

function shrinkPhoto(file, onReady) {
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_EDGE_PIXELS;
    canvas.height = PHOTO_EDGE_PIXELS;
    const context = canvas.getContext('2d');
    const side = Math.min(image.width, image.height);
    context.drawImage(
      image,
      (image.width - side) / 2, (image.height - side) / 2, side, side,
      0, 0, PHOTO_EDGE_PIXELS, PHOTO_EDGE_PIXELS,
    );
    URL.revokeObjectURL(objectUrl);
    onReady(canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY));
  };
  image.onerror = () => {
    URL.revokeObjectURL(objectUrl);
    showNotice('That image could not be read.');
  };
  image.src = objectUrl;
}

export function openPhotoDialog(meal, onChanged) {
  photoTargetMeal = meal;
  byId('photoInput').value = '';

  const existing = state.photos[lastRenderedDay]?.[meal];
  byId('photoPreview').innerHTML = existing
    ? `<img class="photo-thumb" src="${existing}" alt="Meal photo"><p class="fine">A photo is already saved for this meal.</p>`
    : '<p class="fine">No photo yet.</p>';

  byId('photoDialog').showModal();

  byId('photoInput').onchange = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    shrinkPhoto(file, thumbnail => {
      byId('photoPreview').innerHTML = `<img class="photo-thumb" src="${thumbnail}" alt="Meal photo preview">`;
    });
  };

  byId('photoForm').onsubmit = event => {
    if (event.submitter?.value === 'cancel') {
      if (state.photos[lastRenderedDay]) delete state.photos[lastRenderedDay][photoTargetMeal];
      saveState(message => showNotice(message));
      byId('photoDialog').close();
      onChanged();
      return;
    }
    event.preventDefault();
    const preview = byId('photoPreview').querySelector('img');
    if (!preview) return;
    state.photos[lastRenderedDay] = state.photos[lastRenderedDay] || {};
    state.photos[lastRenderedDay][photoTargetMeal] = preview.src;
    saveState(message => showNotice(message));
    byId('photoDialog').close();
    onChanged();
  };
}
