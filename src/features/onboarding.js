/**
 * @file src/features/onboarding.js
 * @module features/onboarding
 *
 * PURPOSE
 * A five-step introduction that collects enough to calculate real nutrition
 * goals, while never blocking the user.
 *
 * GUEST FIRST, DELIBERATELY
 * There is no account system in this build, so "guest" simply means: the app is
 * fully usable before, during and after this tour. The tour appears once, after
 * boot, and "Skip for now" is present on every single step. Skipping loses
 * nothing and the tour can be resumed later.
 *
 * NO DUPLICATE RECORDS, BY CONSTRUCTION
 * Completion writes into the same `profile`, `weights` and `goals` fields the
 * health and day features already read. The weight step updates today's
 * existing record rather than appending a second one, so completing the tour
 * can never create a duplicate weight entry for the same day.
 */

import { byId, byIdOrNull, escapeHtml, todayKey } from '../core/dom.js';
import { state, saveState } from '../core/storage.js';
import { showNotice } from '../core/notices.js';
import { CONDITIONS, ALLERGENS, DIETS, WEIGHT_GOALS } from '../../nutrition.js';
import { deriveGoalsFromProfile } from '../services/healthProfile.js';

const STEPS = [
  { key: 'welcome', title: 'Welcome to HealthQ', subtitle: 'Look around first. Everything works without an account.' },
  { key: 'basics', title: 'A little about you', subtitle: 'Used to estimate energy needs and macro targets.' },
  { key: 'body', title: 'Your body', subtitle: 'Two numbers that make the targets accurate.' },
  { key: 'goals', title: 'What are you aiming for?', subtitle: 'We will set daily goals from these.' },
  { key: 'filters', title: 'Anything to avoid?', subtitle: 'Optional. We will filter suggestions around these.' },
];

const ACTIVITY_OPTIONS = [
  [1.2, 'Sedentary — little exercise'],
  [1.375, 'Light — 1 to 3 days a week'],
  [1.55, 'Moderate — 3 to 5 days a week'],
  [1.725, 'Active — 6 to 7 days a week'],
  [1.9, 'Very active — physical job'],
];

const MIN_HEIGHT = 50, MAX_HEIGHT = 260;
const MIN_AGE = 10, MAX_AGE = 120;
const MIN_WEIGHT = 1, MAX_WEIGHT = 500;

let currentStep = 0;
let draft = null;

function seedDraftFromState() {
  const latestWeight = state.weights[state.weights.length - 1];
  return {
    name: state.profile?.name ?? '',
    age: state.profile?.age ?? '',
    sex: state.profile?.sex ?? 'female',
    height: state.profile?.height ?? '',
    weight: latestWeight?.value ?? '',
    activity: state.profile?.activity ?? 1.2,
    weightGoal: state.goals?.weightGoal ?? 'maintain',
    conditions: [...(state.conditions ?? [])],
    allergies: [...(state.allergies ?? [])],
    diets: [...(state.diets ?? [])],
  };
}

/**
 * Read the live DOM into the draft.
 *
 * Relying on `input` events alone would lose anything set by autofill, a
 * password manager, or a paste-and-continue gesture, so the values are read
 * directly before each advance.
 */
function syncDraftFromForm() {
  const read = (elementId, key, asNumber) => {
    const element = byIdOrNull(elementId);
    if (!element) return;
    draft[key] = element.value === '' ? '' : (asNumber ? Number(element.value) : element.value);
  };
  read('onbName', 'name', false);
  read('onbAge', 'age', true);
  read('onbHeight', 'height', true);
  read('onbWeight', 'weight', true);

  const sex = byIdOrNull('onbSex');
  if (sex) draft.sex = sex.value;
  const activity = byIdOrNull('onbAct');
  if (activity) draft.activity = Number(activity.value);
}

function commitDraft() {
  if (Number.isFinite(draft.height) && draft.height >= MIN_HEIGHT && draft.height <= MAX_HEIGHT
    && Number.isFinite(draft.age) && draft.age >= MIN_AGE && draft.age <= MAX_AGE) {
    state.profile = {
      ...(state.profile || {}),
      name: String(draft.name || '').trim(),
      height: draft.height,
      age: draft.age,
      sex: draft.sex,
      activity: Number(draft.activity),
    };
  }

  if (Number.isFinite(draft.weight) && draft.weight >= MIN_WEIGHT && draft.weight <= MAX_WEIGHT) {
    const latest = state.weights[state.weights.length - 1];
    const recordedToday = latest
      && new Date(latest.at).toDateString() === new Date(todayKey()).toDateString();

    if (recordedToday) {
      // Update in place. Appending here would create a second weight record
      // for the same day, which is exactly the duplication we must avoid.
      latest.value = draft.weight;
      latest.at = new Date().toLocaleString();
    } else {
      state.weights.push({ value: draft.weight, at: new Date().toLocaleString() });
    }
  }

  state.conditions = [...draft.conditions];
  state.allergies = [...draft.allergies];
  state.diets = [...draft.diets];
  state.goals = { ...(state.goals || {}), weightGoal: draft.weightGoal };

  const latestWeight = state.weights[state.weights.length - 1];
  if (state.profile?.height && state.profile?.age && latestWeight) {
    const derived = deriveGoalsFromProfile({
      weightKg: latestWeight.value,
      heightCm: state.profile.height,
      age: state.profile.age,
      sex: state.profile.sex,
      activityLevel: state.profile.activity,
      weightGoal: state.goals.weightGoal,
      conditions: state.conditions,
    });
    if (derived) state.goals = { ...derived, custom: state.goals.custom ?? [] };
  }

  state.onboarded = true;
  saveState(message => showNotice(message));
}

function close(completed) {
  byId('onboarding').hidden = true;
  if (completed) {
    commitDraft();
    showNotice('Goals are set. Everything stays editable.', { kind: 'ok' });
  } else {
    showNotice('You can finish setup any time from Settings.', { durationMs: 3500 });
  }
}

function chipMarkup(items, selectedIds) {
  return items.map(item =>
    `<button type="button" class="${selectedIds.includes(item.id) ? 'active' : ''}" data-pick="${item.id}">${escapeHtml(item.label)}</button>`).join('');
}

function bodyForStep() {
  if (currentStep === 0) {
    return [
      ['Search 13,911 foods', 'USDA and Nepal DFTQC values, per 100 g.'],
      ['Calculate any portion', 'Type a food, set the grams, read the numbers.'],
      ['Log a whole day', 'Meals, water, goals and progress rings.'],
      ['No account required', 'Your data stays on this device until you export it.'],
    ].map(([title, detail]) =>
      `<div class="onb-perk"><span class="tick">✓</span><div><b>${title}</b>${detail}</div></div>`).join('');
  }

  if (currentStep === 1) {
    return `
      <label class="field-label" for="onbName">First name</label>
      <input id="onbName" type="text" maxlength="40" value="${escapeHtml(String(draft.name))}" placeholder="Optional" autocomplete="given-name">
      <label class="field-label" for="onbAge">Age</label>
      <input id="onbAge" type="number" min="10" max="120" step="1" inputmode="numeric" value="${escapeHtml(String(draft.age))}" placeholder="e.g. 30">
      <label class="field-label" for="onbSex">Sex</label>
      <select id="onbSex">
        <option value="female" ${draft.sex === 'female' ? 'selected' : ''}>Female</option>
        <option value="male" ${draft.sex === 'male' ? 'selected' : ''}>Male</option>
      </select>`;
  }

  if (currentStep === 2) {
    return `
      <label class="field-label" for="onbHeight">Height (cm)</label>
      <input id="onbHeight" type="number" min="50" max="260" step="0.5" inputmode="decimal" value="${escapeHtml(String(draft.height))}" placeholder="e.g. 170">
      <label class="field-label" for="onbWeight">Weight (kg)</label>
      <input id="onbWeight" type="number" min="1" max="500" step="0.1" inputmode="decimal" value="${escapeHtml(String(draft.weight))}" placeholder="e.g. 65">
      <label class="field-label" for="onbAct">Activity level</label>
      <select id="onbAct">
        ${ACTIVITY_OPTIONS.map(([value, label]) =>
      `<option value="${value}" ${Number(draft.activity) === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select>`;
  }

  if (currentStep === 3) {
    return `<label class="field-label">Goal</label>
      <div class="chips">${Object.entries(WEIGHT_GOALS).map(([key, goal]) =>
      `<button type="button" class="${draft.weightGoal === key ? 'active' : ''}" data-goal="${key}">${escapeHtml(goal.label)}</button>`).join('')}</div>
      <p class="fine">${escapeHtml(WEIGHT_GOALS[draft.weightGoal]?.note ?? '')}</p>`;
  }

  return `
    <label class="field-label">Health conditions</label>
    <div class="chips">${chipMarkup(CONDITIONS, draft.conditions)}</div>
    <label class="field-label">Allergies</label>
    <div class="chips">${chipMarkup(ALLERGENS, draft.allergies)}</div>
    <label class="field-label">Diet</label>
    <div class="chips">${chipMarkup(DIETS, draft.diets)}</div>`;
}

function wireStep() {
  for (const button of byId('onbBody').querySelectorAll('[data-goal]')) {
    button.onclick = () => {
      draft.weightGoal = button.dataset.goal;
      for (const other of byId('onbBody').querySelectorAll('[data-goal]')) {
        other.classList.toggle('active', other === button);
      }
      const note = byId('onbBody').querySelector('.fine');
      if (note) note.textContent = WEIGHT_GOALS[draft.weightGoal]?.note ?? '';
    };
  }

  for (const button of byId('onbBody').querySelectorAll('[data-pick]')) {
    button.onclick = () => {
      const key = button.dataset.pick;
      const choice = button.dataset.pick;
      draft[key] = draft[key].includes(choice)
        ? draft[key].filter(existing => existing !== choice)
        : [...draft[key], choice];
      button.classList.toggle('active');
    };
  }
}

function renderStep() {
  const step = STEPS[currentStep];
  byId('onbStep').textContent = `Step ${currentStep + 1} of ${STEPS.length}`;
  byId('onbProgress').style.width = `${(currentStep + 1) / STEPS.length * 100}%`;
  byId('onbTitle').textContent = step.title;
  byId('onbSub').textContent = step.subtitle;
  byId('onbBack').hidden = currentStep === 0;
  byId('onbNext').textContent = currentStep === STEPS.length - 1 ? 'Finish setup' : 'Continue';
  byId('onbBody').innerHTML = bodyForStep();
  wireStep();
  byId('onbNext').focus();
}

/**
 * Open the tour.
 *
 * @param {boolean} [force] Open even if it has already been completed. The
 *   first-run path passes nothing so the tour appears exactly once; the
 *   "Finish setup" button in Settings passes true so a user can revisit and
 *   correct what they entered.
 */
export function startOnboarding(force = false) {
  if (state.onboarded && !force) return;
  currentStep = 0;
  draft = seedDraftFromState();
  byId('onboarding').hidden = false;
  renderStep();
}

export function mountOnboardingFeature() {
  byId('onbNext').onclick = () => {
    syncDraftFromForm();
    if (currentStep < STEPS.length - 1) {
      currentStep += 1;
      renderStep();
    } else {
      close(true);
    }
  };

  byId('onbBack').onclick = () => {
    syncDraftFromForm();
    if (currentStep > 0) {
      currentStep -= 1;
      renderStep();
    }
  };

  byId('onbSkip').onclick = () => close(false);

  document.addEventListener('keydown', event => {
    if (byId('onboarding').hidden) return;
    if (event.key === 'Escape') close(false);
  });
}
