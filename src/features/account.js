/**
 * @file src/features/account.js
 * @module features/account
 *
 * PURPOSE
 * The Profile and Data Center. Answers the three questions a user should never
 * have to guess at: who am I, what is stored about me, and where is it.
 *
 * WHY THIS SCREEN EXISTS
 * The recurring complaint about this app was that its account story was
 * unclear. There was no account to find, no obvious place to see what was
 * stored, and no way to hand the device to someone else. This screen makes all
 * three explicit and measurable rather than descriptive.
 *
 * THE DATA INVENTORY IS MEASURED, NOT ESTIMATED
 * Every count and byte total is computed from the live state object at render
 * time. A hand-written summary would drift the moment a user logged a meal,
 * which is the exact failure this screen is meant to prevent.
 *
 * GUEST FIRST
 * With no account, everyone is a guest. Rather than hide that, the identity
 * card says so plainly and offers a one-tap path to add a name. A guest can do
 * everything a named user can; the name is for their benefit, not ours.
 */

import { byId, byIdOrNull, escapeHtml, formatCount, formatOneDecimal, todayKey } from '../core/dom.js';
import { state, saveState } from '../core/storage.js';
import { showNotice } from '../core/notices.js';
import { catalogue } from '../../data/catalogue.js';
import { deriveGoalsFromProfile, bodyMassIndex } from '../services/healthProfile.js';
import { openSignOutDialog, openDeleteFlow, openWelcomeBack, exportBackup, pauseAccount } from './accountFlows.js';

// ── Data inventory ───────────────────────────────────────────────────────────

/**
 * Describe one category of stored data, why it exists, and how much there is.
 * `measure` returns the record count so the number always reflects reality.
 */
function buildInventory() {
  return [
    {
      key: 'entries',
      label: 'Food tracking history',
      reason: 'The meals you logged, so your day totals and progress rings can be rebuilt.',
      measure: () => state.entries.length,
    },
    {
      key: 'weights',
      label: 'Health records — weight',
      reason: 'Used to derive BMI, energy needs and your daily calorie goal.',
      measure: () => state.weights.length,
    },
    {
      key: 'pressures',
      label: 'Health records — blood pressure',
      reason: 'Readings you entered by hand. HealthQ does not interpret them.',
      measure: () => state.pressures.length,
    },
    {
      key: 'vitals',
      label: 'Health records — vitals',
      reason: 'Heart rate, blood oxygen, glucose, body fat and waist readings you entered.',
      measure: () => state.vitals.length,
    },
    {
      key: 'exercise',
      label: 'Exercise',
      reason: 'Steps and active minutes you logged, used in the weekly view.',
      measure: () => state.exercise.length,
    },
    {
      key: 'sleep',
      label: 'Sleep',
      reason: 'Hours and quality you logged, shown alongside your daily targets.',
      measure: () => state.sleep.length,
    },
    {
      key: 'water',
      label: 'Water',
      reason: 'One count per day, so your intake is never recorded twice.',
      measure: () => Object.keys(state.water).length,
    },
    {
      key: 'goals',
      label: 'Goals',
      reason: 'Your daily calorie, macro, water and produce targets.',
      measure: () => (state.goals ? 1 : 0),
    },
    {
      key: 'preferences',
      label: 'Saved preferences',
      reason: 'Conditions, allergies and diet choices that filter your suggestions.',
      measure: () => state.conditions.length + state.allergies.length + state.diets.length,
    },
    {
      key: 'photos',
      label: 'Meal photos',
      reason: 'Small thumbnails you attached. Optional, and removable one at a time.',
      measure: () => Object.values(state.photos).reduce(
        (total, byMeal) => total + Object.keys(byMeal || {}).length, 0),
    },
  ];
}

function totalStoredBytes() {
  try {
    return new Blob([JSON.stringify(state)]).size;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

function renderDataInventory() {
  const items = buildInventory();
  const total = totalStoredBytes();

  byId('dataSize').textContent = formatBytes(total);
  byId('dataInventory').innerHTML = items.map(item => {
    const count = item.measure();
    return `<div class="inv-row">
      <div class="inv-top">
        <span class="inv-label">${item.label}</span>
        <span class="inv-count">${count ? formatCount(count) : '—'}</span>
      </div>
      <p class="inv-reason">${item.reason}</p>
    </div>`;
  }).join('');
}

// ── Identity ─────────────────────────────────────────────────────────────────

function initialsFor(name) {
  if (!name) return '·';
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0].toUpperCase()).join('');
}

function firstRecordDate() {
  const stamps = [
    ...state.weights.map(record => record.at),
    ...state.pressures.map(record => record.at),
    ...state.entries.map(() => ''),
  ].filter(Boolean);

  if (!stamps.length) return null;
  const earliest = stamps.map(stamp => new Date(stamp)).filter(date => !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b)[0];
  return earliest ? earliest.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null;
}

function renderIdentity() {
  const name = state.profile?.name?.trim();
  const memberSince = firstRecordDate();

  const rows = name
    ? [['Name', state.profile.name], ['Member since', memberSince || 'Today']]
    : [];

  byId('identityCard').innerHTML = `
    <div class="ident">
      <div class="avatar" aria-hidden="true">${escapeHtml(initialsFor(name))}</div>
      <div class="ident-body">
        <h3>${name ? escapeHtml(name) : 'You are using HealthQ as a guest'}</h3>
        <p class="ident-sub">${name
          ? 'Your records live in this browser.'
          : 'Everything works without a name. Add one if you would like it on screen.'}</p>
        ${rows.map(([key, value]) => `<div class="hl"><span class="k">${key}</span><span class="v">${escapeHtml(String(value))}</span></div>`).join('')}
        <p class="badge badge-guest">Guest · no account</p>
      </div>
    </div>
    <p class="fine">There is no server account in this build, so there is no password to forget and no session to expire. Signing out clears your name from this device but keeps your records.</p>`;
}

// ── Storage transparency ─────────────────────────────────────────────────────

function renderStorageExplainer() {
  byId('storageExplainer').innerHTML = `
    <div class="store-row"><b>This browser</b>
      <p>Your records live in this browser's local storage on this device. They do not leave it.</p></div>
    <div class="store-row"><b>Not sent anywhere</b>
      <p>HealthQ has no server. Nothing is uploaded, sold or shared. There is no company copy to request or delete.</p></div>
    <div class="store-row"><b>Clearing browser data removes it</b>
      <p>Using your browser's "clear site data", or private browsing, will erase these records. Download a backup first.</p></div>
    <div class="store-row"><b>On a shared device</b>
      <p>Sign out of this device to remove your name and profile. Your records stay until you delete them.</p></div>`;
}

// ── Health profile status ────────────────────────────────────────────────────

/**
 * Completion checklist. Each item maps to something the app can actually do
 * better once it is provided, so the panel is motivation rather than nagging.
 */
function profileChecklist() {
  const profile = state.profile ?? {};
  return [
    { label: 'Name', done: Boolean(profile.name), screen: 'anywhere' },
    { label: 'Height', done: Boolean(profile.height), screen: 'My Health' },
    { label: 'Age', done: Boolean(profile.age), screen: 'My Health' },
    { label: 'Weight', done: state.weights.length > 0, screen: 'My Health' },
    { label: 'Activity level', done: Boolean(profile.activity), screen: 'My Health' },
    { label: 'Goal', done: Boolean(state.goals?.weightGoal), screen: 'My Day' },
    { label: 'Diet or allergies', done: state.diets.length + state.allergies.length > 0, screen: 'optional' },
  ];
}

function renderHealthStatus() {
  const checklist = profileChecklist();
  const completed = checklist.filter(item => item.done).length;
  const percentage = Math.round(completed / checklist.length * 100);

  byId('profileBadge').textContent = `${completed} of ${checklist.length}`;
  byId('healthStatus').innerHTML = `
    <div class="bar-row">
      <div class="bar-top"><span>Profile complete</span><strong>${percentage}%</strong></div>
      <div class="bar"><i style="width:${percentage}%;background:var(--p-good)"></i></div>
    </div>
    ${checklist.map(item => `<div class="check-row ${item.done ? 'done' : ''}">
      <span class="tick">${item.done ? '✓' : '○'}</span>
      <span class="lbl">${item.label}</span>
      ${item.done ? '' : `<span class="where">in ${item.screen}</span>`}
    </div>`).join('')}
    ${completed < checklist.length
      ? '<p class="fine">Filling this in makes your calorie and macro targets accurate, and lets suggestions respect your diet.</p>'
      : '<p class="fine">Your targets are calculated from this profile.</p>'}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function renderAccount() {
  renderIdentity();
  renderDataInventory();
  renderStorageExplainer();
  renderHealthStatus();
}

export function mountAccountFeature({ onResumeOnboarding, onDataChanged, onOpenHealth, onOpenDay }) {
  byId('acctExport').onclick = () => exportBackup();
  byId('acctSignOut').onclick = () => openSignOutDialog(() => {
    renderAccount();
    onDataChanged();
  });
  byId('acctDelete').onclick = () => openDeleteFlow({
    // Pause and sign-out are offered on the way out because they solve most of
    // the real reasons someone opens this screen. They must actually do
    // something, so both are wired here rather than left as dead buttons.
    onPause: () => {
      pauseAccount(() => {
        renderAccount();
        onDataChanged();
        showNotice('Paused. Everything is still here whenever you want it.', { kind: 'ok' });
      });
    },
    onSignOut: () => {
      openSignOutDialog(() => {
        renderAccount();
        onDataChanged();
      });
    },
    onDelete: () => {
      renderAccount();
      onDataChanged();
      openWelcomeBack();
    },
  });

  const importInput = byId('acctImportFile');
  byId('acctImport').onclick = () => importInput.click();
  importInput.onchange = event => {
    const file = event.target.files?.[0];
    if (file) window.dispatchEvent(new CustomEvent('healthq:restore-request', { detail: file }));
    event.target.value = '';
  };

  byId('acctFinishSetup').onclick = () => {
    onOpenHealth?.();
    onResumeOnboarding?.();
  };

  renderAccount();
}

export { buildInventory, totalStoredBytes, formatBytes, profileChecklist, catalogue, deriveGoalsFromProfile, bodyMassIndex, todayKey, byIdOrNull, saveState, showNotice };
