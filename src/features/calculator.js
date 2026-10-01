/**
 * @file src/features/calculator.js
 * @module features/calculator
 *
 * PURPOSE
 * The stand-alone food calculator: search a food, set a weight, read the
 * calories and macros. It deliberately does not write to the day log, because
 * the common use is "how much is in this?" rather than "log this".
 */

import { byId, escapeHtml } from '../core/dom.js';
import { catalogue, searchFoods, foodById } from '../../data/catalogue.js';
import { nutrientsForEntry } from '../services/dailyNutrition.js';

const PAGE_SIZE = 60;
const ALL_CATEGORIES = 'All';

let activeCategory = ALL_CATEGORIES;
let resultsShown = PAGE_SIZE;
let selectedFood = null;

function renderCategoryChips() {
  const categories = [ALL_CATEGORIES, ...catalogue.groups];
  byId('calcCategories').innerHTML = categories
    .map(category => `<button type="button" class="${category === activeCategory ? 'active' : ''}" data-calc-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`)
    .join('');

  for (const chip of byId('calcCategories').querySelectorAll('[data-calc-category]')) {
    chip.onclick = () => {
      activeCategory = chip.dataset.calcCategory;
      renderCategoryChips();
      renderResults();
    };
  }
}

function renderResults() {
  const query = byId('calcQuery').value.trim().toLowerCase();
  const matches = searchFoods(query, activeCategory);
  const visible = matches.slice(0, resultsShown);

  if (!matches.length) {
    byId('calcResults').innerHTML = '<p class="empty">Nothing found. Try a shorter word.</p>';
    return;
  }

  byId('calcResults').innerHTML = visible.map(food => `<div class="food">
      <div>
        <strong>${escapeHtml(food.name)}</strong>
        <small>${food.nepali ? escapeHtml(food.nepali) + ' · ' : ''}${escapeHtml(food.category)} · ${food.energy} kcal / 100 g</small>
      </div>
      <button class="secondary" type="button" data-calc-food="${food.id}" aria-label="Calculate ${escapeHtml(food.name)}">Use</button>
    </div>`).join('')
    + (matches.length > resultsShown
      ? `<button id="showMoreCalc" class="more" type="button">Show ${Math.min(PAGE_SIZE, matches.length - resultsShown)} more</button>`
      : '');

  for (const button of byId('calcResults').querySelectorAll('[data-calc-food]')) {
    button.onclick = () => selectFood(Number(button.dataset.calcFood));
  }

  const showMore = byId('showMoreCalc');
  if (showMore) {
    showMore.onclick = () => { resultsShown += PAGE_SIZE; renderResults(); };
  }
}

function selectFood(foodId) {
  selectedFood = foodById(foodId);
  if (!selectedFood) return;

  byId('calcSelection').className = 'selected';
  byId('calcSelection').innerHTML = `
    <button class="back-btn" id="backFromCalculator" aria-label="Back to search">← Back to search</button>
    <strong>${escapeHtml(selectedFood.name)}</strong>
    <p>${selectedFood.nepali ? escapeHtml(selectedFood.nepali) + ' · ' : ''}${escapeHtml(selectedFood.source)} · FDC ${selectedFood.fdcId ?? '—'}</p>
    <label class="field-label" for="calcGrams">How many grams?</label>
    <input id="calcGrams" type="number" min="1" max="5000" step="1" value="100" inputmode="decimal">
    <button id="calculatePortion" class="primary" type="button">Calculate</button>
    <div id="calcOut" class="preview" aria-live="polite"></div>
    <p class="fine">Source values are per 100 g. Missing values are unknown, not zero.</p>`;

  byId('calcGrams').oninput = calculate;
  byId('calculatePortion').onclick = calculate;
  byId('backFromCalculator').onclick = () => {
    byId('calcQuery').value = '';
    resultsShown = PAGE_SIZE;
    renderResults();
    byId('calcQuery').focus();
  };

  calculate();
}

function calculate() {
  const grams = Number(byId('calcGrams').value);
  if (!selectedFood || !Number.isFinite(grams) || grams < 1 || grams > 5000) {
    byId('calcOut').innerHTML = '<p class="fine">Enter a portion from 1 to 5,000 g.</p>';
    return;
  }

  const nutrients = nutrientsForEntry({ grams }, selectedFood);
  const fibre = selectedFood.fiber == null
    ? 'Unknown'
    : `${(selectedFood.fiber * grams / 100).toFixed(1)} g`;

  byId('calcOut').innerHTML = `
    <div class="calc-big"><span>Calories</span><strong>${Math.round(nutrients.energy)} kcal</strong></div>
    <div class="nutrient-grid">
      <div><span>Protein</span><strong>${nutrients.protein.toFixed(1)} g</strong></div>
      <div><span>Carbs</span><strong>${nutrients.carbs.toFixed(1)} g</strong></div>
      <div><span>Fat</span><strong>${nutrients.fat.toFixed(1)} g</strong></div>
      <div><span>Fibre</span><strong>${fibre}</strong></div>
    </div>`;
}

export function mountCalculatorFeature() {
  byId('calcQuery').oninput = () => { resultsShown = PAGE_SIZE; renderResults(); };
  renderCategoryChips();
  renderResults();
}
