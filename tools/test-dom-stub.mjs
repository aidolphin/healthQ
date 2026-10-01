// Minimal DOM good enough to boot the real HealthQ module graph in Node.
//
// Test-only. Not part of the shipped app.
//
// The tab list is parsed from index.html rather than hard-coded. A hard-coded
// list previously hid a real bug: the stub said data-tab="day" while the
// markup said data-tab="today", so every test "passed" against tab names the
// browser would never send. Deriving them keeps the test honest.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// tools/ lives inside the project, so the project root is one level up.
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readTabNamesFromMarkup() {
  const html = readFileSync(join(PROJECT_ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/data-tab="([^"]+)"/g)].map(match => match[1]);
}

export function makeEnv() {
  const els = new Map();
  const openDialogs = [];
  const store = new Map();

  const tabButtons = readTabNamesFromMarkup().map(name => {
    const button = makeEl('tab-' + name);
    button.dataset = { tab: name };
    button.setAttribute('role', 'tab');
    return button;
  });

  function makeEl(id) {
    const listeners = {};

    const el = {
      id,
      dataset: {},
      style: {},
      children: [],
      files: null,
      returnValue: '',
      checked: false,
      disabled: false,

      get classList() {
        return {
          add: c => el._classes.add(c),
          remove: c => el._classes.delete(c),
          // The second argument is a force flag, exactly as in the real DOM.
          // Ignoring it made every hidden-panel assertion meaningless.
          toggle: (c, force) => {
            const shouldAdd = force === undefined ? !el._classes.has(c) : Boolean(force);
            if (shouldAdd) el._classes.add(c); else el._classes.delete(c);
          },
          contains: c => el._classes.has(c),
        };
      },
      get innerHTML() { return el._html; },
      set innerHTML(value) {
        el._html = String(value);
        el.children = [];
        for (const m of String(value).matchAll(/<input[^>]*id="([^"]+)"[^>]*value="([^"]*)"/g)) {
          mkEl(m[1])._value = m[2];
        }
        for (const m of String(value).matchAll(/<(button|input|select|textarea|div)[^>]*id="([^"]+)"/g)) {
          mkEl(m[2]);
        }
        for (const m of String(value).matchAll(/<button([^>]*)>/g)) {
          const id = /id="([^"]+)"/.exec(m[1]);
          const leave = /data-leave="([^"]+)"/.exec(m[1]);
          if (id) mkEl(id[1]);
          else if (leave) mkEl('leave-' + leave[1]).setAttribute('data-leave', leave[1]);
        }
      },
      get textContent() { return el._text; },
      set textContent(value) { el._text = String(value); el.children = []; },
      get value() { return el._value; },
      set value(value) { el._value = value; },

      setAttribute(k, v) { el._attrs[k] = v; },
      getAttribute(k) { return el._attrs[k]; },

      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
      focus() {},
      select() {},
      scrollIntoView() {},
      click() { el.dispatch('click'); },
      closest(selector) {
        return selector === '[role="tab"]' && el._attrs.role === 'tab' ? el : null;
      },

      dispatch(type) {
        const event = {
          target: el, currentTarget: el,
          preventDefault() {}, stopPropagation() {}, submitter: null,
        };
        for (const fn of listeners[type] || []) fn(event);
        const handler = { click: 'onclick', submit: 'onsubmit', input: 'oninput', change: 'onchange' }[type];
        if (handler && typeof el[handler] === 'function') el[handler](event);
      },

      showModal() { el._hidden = false; openDialogs.push(el); },
      close(returnValue) {
        if (returnValue !== undefined) el.returnValue = returnValue;
        el._hidden = false;
        const index = openDialogs.indexOf(el);
        if (index >= 0) openDialogs.splice(index, 1);
        for (const fn of listeners.close || []) fn({});
        if (typeof el.onclose === 'function') el.onclose({});
      },

      appendChild(child) { el.children.push(child); return child; },

      querySelectorAll(selector) {
        if (selector === 'input[type=checkbox]:checked') {
          return el.children.filter(child => child.tag === 'input' && child.checked);
        }
        if (selector === '[data-leave]') {
          return el.children.filter(child => child._attrs['data-leave']);
        }
        return [];
      },

      getContext() { return { drawImage() {} }; },
      toDataURL() { return 'data:,x' },

      get hidden() { return el._hidden; },
      set hidden(value) { el._hidden = value; },
      get tabIndex() { return Number(el._attrs.tabindex || 0); },
      set tabIndex(value) { el._attrs.tabindex = String(value); },

      _classes: new Set(),
      _listeners: listeners,
      _attrs: {},
      _html: '',
      _text: '',
      _value: '',
      _hidden: false,
    };

    el.onclick = null;
    el.onsubmit = null;
    el.oninput = null;
    el.onchange = null;
    el.onclose = null;
    return el;
  }

  function mkEl(id) {
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  }

  for (const id of BOOT_IDS) mkEl(id);
  mkEl('notice')._hidden = true;
  mkEl('onboarding')._hidden = true;

  return {
    els,
    openDialogs,
    tabButtons,
    projectRoot: PROJECT_ROOT,
    document: {
      getElementById: id => els.get(id) || mkEl(id),
      querySelectorAll: selector => {
        if (selector === '[role="tab"]') return tabButtons;
        if (selector === '.panel') {
          return readTabNamesFromMarkup().map(name => mkEl('panel-' + name));
        }
        if (selector === 'dialog[open]') return openDialogs;
        return [];
      },
      querySelector: selector => {
        if (selector === 'dialog[open]') return openDialogs[0] || null;
        if (selector === '.tabs') return mkEl('tabs');
        return null;
      },
      addEventListener() {},
      createElement: () => makeEl('created-' + Math.random().toString(36).slice(2)),
      body: { classList: { add() {}, remove() {}, toggle() {} } },
    },
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, value),
    },
    window: { addEventListener() {}, scrollTo() {}, scrollY: 0, matchMedia: () => ({ matches: false }) },
    navigator: { serviceWorker: { register: () => Promise.resolve({ addEventListener() {} }) }, userAgent: 'test' },
  };
}

const BOOT_IDS = [
  'notice', 'onboarding', 'bootStatus', 'sourceNote', 'discoverCount', 'count', 'results',
  'categories', 'query', 'calcCategories', 'calcResults', 'calcQuery', 'rings', 'ringNote',
  'remaining', 'remCal', 'goalBars', 'mealCards', 'mealTotal', 'coach', 'waterCount',
  'waterGoal', 'waterTip', 'healthLink', 'dietFilter', 'suggestions', 'dayPicker',
  'editGoals', 'syncGoals', 'toHealth', 'toHealth2', 'offline', 'install', 'confirm',
  'confirmTitle', 'confirmText', 'profileOut', 'targets', 'vitalsList', 'progress', 'weekly',
  'weightList', 'pressureList', 'exerciseList', 'sleepList', 'weightForm', 'pressureForm',
  'exerciseForm', 'sleepForm', 'profileForm', 'vitalsForm', 'weight', 'systolic',
  'diastolic', 'steps', 'activeMinutes', 'workout', 'sleepHours', 'sleepQuality', 'height',
  'age', 'sex', 'activity', 'restHr', 'spo2', 'glucose', 'bodyFat', 'waist', 'weightChart',
  'pressureChart', 'goalsDialog', 'goalsForm', 'gCalories', 'gProtein', 'gCarbs', 'gFat',
  'gWater', 'gFruit', 'gVeg', 'gWeight', 'gCustom', 'customHint', 'condList', 'allergenList',
  'dietList', 'addFoodDialog', 'afTitle', 'afQuery', 'afResults', 'afPicked', 'editDialog',
  'editForm', 'editTitle', 'editSource', 'editGrams', 'editMeal', 'editKcal', 'editHint',
  'photoDialog', 'photoForm', 'photoInput', 'photoPreview', 'export', 'importBtn',
  'importFile', 'openOnboarding', 'erase', 'clearDay', 'onbStep', 'onbProgress', 'onbTitle',
  'onbSub', 'onbBody', 'onbBack', 'onbNext', 'onbSkip', 'onbFoot', 'start', 'onbName',
  'onbAge', 'onbSex', 'onbHeight', 'onbWeight', 'onbAct',
  'identityCard', 'dataSize', 'dataInventory', 'storageExplainer', 'healthStatus',
  'profileBadge', 'acctFinishSetup', 'acctExport', 'acctImport', 'acctSignOut', 'acctDelete',
  'acctImportFile', 'signOutDialog', 'signOutExplain', 'signOutConfirm', 'deleteDialog',
  'deleteSteps', 'deleteForm', 'welcomeBackDialog', 'welcomeExport', 'welcomeDone',
  'confirmPhrase', 'confirmHint', 'confirmDelete', 'leaveNote',
];
