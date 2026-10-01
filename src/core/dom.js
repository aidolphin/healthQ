/**
 * @file src/core/dom.js
 * @module core/dom
 *
 * PURPOSE
 * DOM primitives shared by every feature: element lookup, HTML escaping and
 * number formatting. Nothing in this file knows about nutrition or health.
 *
 * RESPONSIBILITIES
 *  - Resolve an element by id, throwing a clear error when markup and code disagree.
 *  - Escape untrusted text before it is interpolated into innerHTML.
 *  - Format numbers the way the UI presents them.
 *
 * WHY ESCAPING MATTERS
 * Food names come from USDA and Nepal DFTQC source data. A name containing
 * `<` or an apostrophe would otherwise be parsed as markup when interpolated.
 * Every dynamic string that reaches innerHTML must pass through escapeHtml.
 */

/**
 * Escape the five characters that can break out of an HTML text node.
 * @param {unknown} value
 * @returns {string}
 */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
}

/**
 * Resolve an element by id.
 *
 * Throws instead of returning null so a rename that breaks a feature fails
 * loudly at first use, rather than silently throwing "cannot set property of
 * undefined" somewhere further down the call stack.
 *
 * @param {string} elementId
 * @returns {HTMLElement}
 */
export function byId(elementId) {
  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error(`Element #${elementId} is missing from index.html`);
  }
  return element;
}

/**
 * Resolve an element by id, or null when it does not exist.
 * Use for elements that belong to a feature which may not be mounted yet.
 * @param {string} elementId
 * @returns {HTMLElement|null}
 */
export function byIdOrNull(elementId) {
  return document.getElementById(elementId);
}

/**
 * One decimal place. Used for weights, grams and most nutrient values.
 * @param {number} value
 * @returns {string}
 */
export function formatOneDecimal(value) {
  return Number(value).toFixed(1);
}

/**
 * Locale-grouped integer, e.g. 13,911. Used for food counts and calories.
 * @param {number} value
 * @returns {string}
 */
export function formatCount(value) {
  return Number(value).toLocaleString();
}

/**
 * Today's date as YYYY-MM-DD, the format used as a key in every per-day store.
 * @returns {string}
 */
export function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Build an id for a new record without depending on crypto.randomUUID, which
 * is unavailable on insecure origins.
 * @returns {string}
 */
export function newRecordId() {
  const hasCrypto = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function';
  return hasCrypto ? crypto.randomUUID() : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
