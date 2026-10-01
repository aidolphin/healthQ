/**
 * @file src/services/attribution.js
 * @module services/attribution
 *
 * PURPOSE
 * Builds the two places the app states its data facts: the footer source note
 * and the food count in the Discover heading.
 *
 * WHY THESE ARE COMPUTED, NOT WRITTEN
 * Both numbers used to be literal text in the markup. When the data files were
 * replaced the footer still said "7,793 foods" while the live counter said
 * 13,911, and the heading said "8,500" while the list said "13,911" — three
 * different numbers on one screen. Deriving them from the loaded catalogue
 * makes that class of drift impossible.
 */

import { byId, byIdOrNull, formatCount } from '../core/dom.js';
import { catalogue } from '../../data/catalogue.js';

const NEPAL_SOURCE_LABEL = 'Government of Nepal DFTQC Food Composition Table 2012';

export function renderSourceNote() {
  const surface = byIdOrNull('sourceNote');
  if (!surface) return;

  const nepalRecords = catalogue.sources?.[NEPAL_SOURCE_LABEL] ?? 0;
  const years = catalogue.years ?? [];
  const yearRange = years.length
    ? ` Records ${years[0]} to ${years[years.length - 1]}.`
    : '';

  const nepalClause = nepalRecords
    ? `${formatCount(nepalRecords)} are Nepal-specific records with नेपाली names.`
    : ` Includes ${formatCount(nepalRecords)} Nepal DFTQC records.`;

  surface.textContent =
    `${formatCount(catalogue.unique)} foods from USDA FoodData Central and the Government of Nepal DFTQC Food Composition Table.`
    + ` ${nepalClause}`
    + yearRange
    + ' Values are per 100 g of the exact named food. Missing values are unknown, not zero. Not medical advice.';
}

export function renderCounts() {
  const counter = byIdOrNull('discoverCount');
  if (counter) counter.textContent = `${formatCount(catalogue.unique)} foods`;
}
