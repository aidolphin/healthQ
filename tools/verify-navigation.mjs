/**
 * Verifies that every tab button actually opens its panel.
 *
 * This exists because a real bug shipped where two tab buttons resolved to an
 * undefined panel id and silently did nothing. The test DOM stub now reads its
 * tab names from index.html, so this check cannot pass against a mismatch.
 */
import { makeEnv } from './test-dom-stub.mjs';

const env = makeEnv();
globalThis.document = env.document;
globalThis.localStorage = env.localStorage;
globalThis.window = env.window;
Object.defineProperty(globalThis, 'navigator', { value: env.navigator, writable: true, configurable: true });
let counter = 0;
Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => `id-${++counter}` }, writable: true, configurable: true });
globalThis.Image = class { set src(v) {} };
globalThis.alert = () => {};
globalThis.URL = { createObjectURL: () => 'x', revokeObjectURL() {} };
globalThis.FileReader = class { readAsText() {} };
globalThis.Blob = class { constructor(parts) { this.size = (parts[0] || '').length; } };
globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options?.detail; } };

await import('../src/main.js');
await new Promise(resolve => setTimeout(resolve, 600));

const el = new Proxy({}, { get: (_, key) => env.els.get(key) || env.document.getElementById(key) });

let passed = 0, failed = 0;
const check = (label, condition) => {
  if (condition) passed++; else failed++;
  console.log((condition ? 'PASS  ' : 'FAIL  ') + label);
};

function showTab(name) {
  const tab = env.tabButtons.find(button => button.dataset.tab === name);
  if (!tab) return false;
  env.document.querySelector('.tabs')._listeners.click[0]({ target: tab, preventDefault() {} });
  return true;
}

console.log('Every tab button opens its own panel:\n');
for (const tab of env.tabButtons) {
  const name = tab.dataset.tab;
  const clicked = showTab(name);

  const panel = env.document.getElementById(name);
  const isVisible = panel && !panel._classes.has('hidden');
  const selected = tab.getAttribute('aria-selected') === 'true';
  const othersHidden = env.tabButtons
    .filter(other => other !== tab)
    .every(other => {
      const otherPanel = env.document.getElementById(other.dataset.tab);
      return !otherPanel || otherPanel._classes.has('hidden');
    });

  check(`"${name}" found in markup`, clicked);
  check(`"${name}" panel is shown`, Boolean(isVisible));
  check(`"${name}" is marked selected`, selected);
  check(`"${name}" hides the other panels`, othersHidden);
}

console.log('\nPanel content renders when revealed:\n');
check('discover: food list', showTab('discover') && el.results._html.includes('data-choose-food'));
check('calc: food list', showTab('calc') && el.calcResults._html.includes('data-calc-food'));
check('today: 4 meal cards', showTab('today') && (el.mealCards._html.match(/meal-card/g) || []).length === 4);
check('today: 4 progress rings', showTab('today') && (el.rings._html.match(/<svg/g) || []).length === 4);
check('today: coach', showTab('today') && el.coach._html.includes('coach-item'));
check('today: suggestions', showTab('today') && el.suggestions._html.includes('sug'));
check('health: weight list', showTab('health') && el.weightList !== undefined);
check('account: identity', showTab('account') && el.identityCard._html.includes('guest'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
