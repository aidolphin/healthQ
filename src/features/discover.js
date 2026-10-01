/**
 * @file src/features/discover.js
 * @module features/discover
 *
 * PURPOSE
 * The food library: category filter, search, and the portion panel that shows
 * what a chosen food contains for a given weight.
 *
 * LIST BROWSING DESIGN DECISION
 * Results are sorted alphabetically and paged 60 at a time, rather than
 * returning the first N in catalogue order. Catalogue order is arbitrary, so
 * a user browsing without a search term would only ever see the first 60 foods
 * in a fixed slice and could never reach anything further down. Alphabetical
 * order makes the list browsable and predictable.
 *
 * LAZY NUTRIENT DETAIL
 * The full per-food nutrient tables live in a separate chunk that is only
 * fetched when someone expands "All nutrients". They are roughly 8 MB and are
 * needed by one collapsed panel, so loading them up front would dominate the
 * first paint.
 */

import { byId, escapeHtml, newRecordId } from '../core/dom.js';
import { state, saveState } from '../core/storage.js';
import { showNotice } from '../core/notices.js';
import { foods, displayFoods, foodById, catalogue, searchFoods, loadNutrients, nutrientsLoaded } from '../../data/catalogue.js';
import { nutrients as nutrientDefinitions } from '../../data/nutrients.js';
import { nutrientsForEntry, caloriesForEntry } from '../services/dailyNutrition.js';

const PAGE_SIZE = 60;
const ALL_CATEGORIES = 'All';
const MICRONUTRIENT_PREFIX = 'm:';
const MICRONUTRIENT_UNITS = {
  calciumMg: 'mg', phosphorusMg: 'mg', ironMg: 'mg', caroteneUg: 'µg',
  vitaminCMg: 'mg', thiamineMg: 'mg', riboflavinMg: 'mg', niacinMg: 'mg',
};

let activeCategory = ALL_CATEGORIES;
let resultsShown = PAGE_SIZE;
let selectedFood = null;

// ── Filters ──────────────────────────────────────────────────────────────────

function renderCategoryChips() {
  const categories = [ALL_CATEGORIES, ...catalogue.groups];
  byId('categories').innerHTML = categories
    .map(category => `<button type="button" class="${category === activeCategory ? 'active' : ''}" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`)
    .join('');

  for (const chip of byId('categories').querySelectorAll('[data-category]')) {
    chip.onclick = () => {
      activeCategory = chip.dataset.category;
      renderCategoryChips();
      renderFoodResults();
    };
  }
}

// ── Results ──────────────────────────────────────────────────────────────────

function renderFoodResults() {
  const query = byId('query').value.trim().toLowerCase();
  const matches = searchFoods(query, activeCategory);
  const visible = matches.slice(0, resultsShown);

  byId('count').textContent = matches.length ? `${matches.length.toLocaleString()} found` : 'No match';

  if (!matches.length) {
    byId('results').innerHTML = '<p class="empty">Nothing found. Try a shorter word.</p>';
    return;
  }

  byId('results').innerHTML = visible.map(food => `<div class="food">
      <div>
        <strong>${escapeHtml(food.name)}</strong>
        <small>${food.nepali ? escapeHtml(food.nepali) + ' · ' : ''}${escapeHtml(food.category)} · ${food.energy} kcal / 100 g</small>
      </div>
      <button class="secondary" type="button" data-choose-food="${food.id}" aria-label="Choose ${escapeHtml(food.name)}">Add</button>
    </div>`).join('')
    + (matches.length > resultsShown
      ? `<button id="showMoreFoods" class="more" type="button">Show ${Math.min(PAGE_SIZE, matches.length - resultsShown)} more</button>`
      : '');

  for (const button of byId('results').querySelectorAll('[data-choose-food]')) {
    button.onclick = () => selectFood(Number(button.dataset.chooseFood));
  }

  const showMore = byId('showMoreFoods');
  if (showMore) {
    showMore.onclick = () => {
      resultsShown += PAGE_SIZE;
      renderFoodResults();
    };
  }
}

// ── Portion panel ────────────────────────────────────────────────────────────

function labelForNutrient(nutrientId) {
  if (nutrientDefinitions[nutrientId]) return nutrientDefinitions[nutrientId];
  if (nutrientId.startsWith(MICRONUTRIENT_PREFIX)) {
    const key = nutrientId.slice(MICRONUTRIENT_PREFIX.length);
    return { name: key, unit: MICRONUTRIENT_UNITS[key] || 'mg' };
  }
  return null;
}

function selectFood(foodId) {
  selectedFood = foodById(foodId);
  if (!selectedFood) return;

  byId('selection').className = 'selected';
  byId('selection').innerHTML = `
    <button class="back-btn" id="backToSearch" aria-label="Back to search">← Back to search</button>
    <strong>${escapeHtml(selectedFood.name)}</strong>
    <p>${selectedFood.nepali ? escapeHtml(selectedFood.nepali) + ' · ' : ''}${escapeHtml(selectedFood.source)}
       · <a href="https://fdc.nal.usda.gov/food-details/${selectedFood.fdcId}/nutrients" target="_blank" rel="noopener noreferrer">FDC ${selectedFood.fdcId ?? '—'}</a></p>
    <label class="field-label" for="grams">Amount eaten (grams)</label>
    <input id="grams" type="number" min="1" max="5000" step="1" value="100" inputmode="decimal">
    <label class="field-label" for="meal">Meal</label>
    <select id="meal">
      <option>Breakfast</option><option>Lunch</option><option>Snack</option><option>Dinner</option>
    </select>
    <div id="portionPreview" class="preview" aria-live="polite"></div>
    <button id="logFood" class="primary" type="button">Add to my day</button>
    <p class="fine">Values refer to this exact food and preparation. Missing nutrients are unknown, not zero.</p>
    <details id="nutrientDetails">
      <summary>All available nutrients</summary>
      <div id="allNutrients"><p class="fine">Loading…</p></div>
    </details>`;

  byId('grams').oninput = renderPortionPreview;
  byId('logFood').onclick = logSelectedFood;
  byId('backToSearch').onclick = () => {
    byId('query').value = '';
    resultsShown = PAGE_SIZE;
    renderFoodResults();
    byId('query').focus();
    byId('query').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const details = byId('nutrientDetails');
  details.ontoggle = async () => {
    if (!details.open || nutrientsLoaded()) return;
    await loadNutrients();
    renderFullNutrientTable();
  };

  renderPortionPreview();
  byId('selection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderPortionPreview() {
  const grams = Number(byId('grams').value);
  if (!(grams > 0 && grams <= 5000)) {
    byId('portionPreview').innerHTML = '<p class="fine">Enter between 1 and 5,000 g.</p>';
    return;
  }

  const nutrients = nutrientsForEntry({ grams }, selectedFood);
  byId('portionPreview').innerHTML = Object.entries(nutrients)
    .map(([name, value]) => `<div>
      <span>${name.charAt(0).toUpperCase() + name.slice(1)}</span>
      <strong>${name === 'energy' ? Math.round(value) : value.toFixed(1)} ${name === 'energy' ? 'kcal' : 'g'}</strong>
    </div>`)
    .join('');

  if (nutrientsLoaded()) renderFullNutrientTable();
}

function renderFullNutrientTable() {
  const grams = Number(byId('grams').value);
  if (!(grams > 0 && grams <= 5000) || !selectedFood) return;

  const rows = Object.entries(selectedFood.nutrients || {})
    .map(([nutrientId, amountPer100g]) => {
      const definition = labelForNutrient(nutrientId);
      if (!definition) return '';
      const scaled = Number((amountPer100g * grams / 100).toPrecision(5));
      return `<div><span>${escapeHtml(definition.name)}</span><strong>${scaled} ${escapeHtml(definition.unit)}</strong></div>`;
    })
    .join('');

  byId('allNutrients').innerHTML = `<p class="fine">Values for ${grams} g.</p><div class="nutrient-list">${rows}</div>`;
}

function logSelectedFood() {
  const grams = Number(byId('grams').value);
  if (!Number.isFinite(grams) || grams < 1 || grams > 5000) {
    showNotice('Enter an amount between 1 and 5,000 g.');
    return;
  }

  state.entries.push({
    id: newRecordId(),
    foodId: selectedFood.id,
    grams,
    meal: byId('meal').value,
    date: new Date().toISOString().slice(0, 10),
  });
  saveState(message => showNotice(message));
  byId('entries').innerHTML = '';
  document.getElementById('tab-day')?.click();
}

// ── Public API ───────────────────────────────────────────────────────────────

export function mountDiscoverFeature() {
  byId('query').oninput = () => { resultsShown = PAGE_SIZE; renderFoodResults(); };
  byId('start').onclick = () => {
    document.getElementById('tab-discover')?.click();
    byId('query').focus();
    byId('query').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  renderCategoryChips();
  renderFoodResults();
}

export { displayFoods, foods, caloriesForEntry, newRecordId, state };
