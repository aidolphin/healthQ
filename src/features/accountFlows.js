/**
 * @file src/features/accountFlows.js
 * @module features/accountFlows
 *
 * PURPOSE
 * The account lifecycle: signing out of a shared device, pausing, and leaving.
 *
 * DESIGN PHILOSOPHY FOR LEAVING
 * Deleting someone's records is the most destructive thing this app can do, and
 * a careless version of that screen is a trust-ending moment. So leaving is a
 * sequence, not a button:
 *
 *   1. Offer the alternatives first. A pause and a sign-out solve most of the
 *      real reasons someone opens this screen. Only if those are declined does
 *      deletion get offered.
 *   2. Ask why, optionally. People can skip it, but their answer is the single
 *      most useful thing a departing user can give us.
 *   3. Make it reversible up to the last step. A backup can be downloaded at
 *      any point.
 *   4. Confirm by typing. No accidental destructive taps.
 *   5. Close warmly. The user is not a defector, and the screen says so.
 *
 * HONESTY NOTE
 * There is no server account, so "deactivate" means something specific and
 * limited: it clears the name and profile from this device while keeping the
 * records, and it can be reversed. The copy says exactly that rather than
 * implying a server-side pause that does not exist.
 */

import { byId, escapeHtml, formatCount, todayKey } from '../core/dom.js';
import { state, saveState, replaceState, resetState } from '../core/storage.js';
import { showNotice } from '../core/notices.js';
import { GOAL_DEFAULTS } from '../../nutrition.js';

const BACKUP_MIME_TYPE = 'application/json';
const BACKUP_VERSION = 2;
const CONFIRM_PHRASE = 'DELETE';
const LONG_NOTICE_MS = 6000;

/** Reasons offered on the way out. Skippable, never required. */
const LEAVING_REASONS = [
  'I found a better app',
  'I no longer need this service',
  'Privacy concerns',
  'Technical problems',
  'It was difficult to use',
  'A feature I need is missing',
  'Too many notifications',
  'Something else',
];

let onRestoreRequested = () => {};
export function useRestoreRequest(handler) {
  onRestoreRequested = handler;
}

// ── Export ───────────────────────────────────────────────────────────────────

/** The same backup used by Settings. Shared so both paths behave identically. */
export function exportBackup() {
  const payload = {
    app: 'HealthQ',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    ...state,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: BACKUP_MIME_TYPE });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `healthq-backup-${todayKey()}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

  showNotice('Backup downloaded. Keep it somewhere safe.', { kind: 'ok', durationMs: LONG_NOTICE_MS });
}

// ── Sign out ─────────────────────────────────────────────────────────────────

/**
 * Signing out of a device with no server means removing the identity, not the
 * records. The dialog says so before the user commits, because "sign out" in
 * most apps implies losing nothing but here it is worth being explicit.
 */
export function openSignOutDialog(onSignedOut) {
  const hasRecords = state.entries.length + state.weights.length + state.pressures.length > 0;
  const recordCount = state.entries.length + state.weights.length + state.pressures.length
    + state.vitals.length + state.exercise.length + state.sleep.length;

  byId('signOutExplain').textContent = hasRecords
    ? `This removes your name and profile from this device. Your ${formatCount(recordCount)} records stay on this browser, so nothing is lost. You can sign back in by completing your profile again.`
    : 'This removes your name and profile from this device. You have no records to lose.';

  const dialog = byId('signOutDialog');
  dialog.returnValue = '';
  dialog.onclose = () => {
    if (dialog.returnValue !== 'yes') return;

    // Clear identity, keep the data. This is what makes it safe to hand the
    // device to someone else without destroying anything.
    state.profile = null;
    state.onboarded = false;
    state.conditions = [];
    state.allergies = [];
    state.diets = [];
    state.goals = { ...GOAL_DEFAULTS };
    state.customLog = {};
    saveState(message => showNotice(message));

    showNotice('Signed out of this device. Your records are still here.');
    onSignedOut();
  };
  dialog.showModal();
}

// ── Pause ────────────────────────────────────────────────────────────────────

/**
 * A pause keeps the records but stops identifying the user, and is fully
 * reversible. Offered as the first alternative on the way out.
 */
export function pauseAccount(onPaused) {
  state.profile = null;
  state.onboarded = false;
  state.conditions = [];
  state.allergies = [];
  state.diets = [];
  state.goals = { ...GOAL_DEFAULTS };
  saveState(message => showNotice(message));
  showNotice('Paused. Everything is still here whenever you want it.', { kind: 'ok' });
  onPaused();
}

// ── Delete sequence ──────────────────────────────────────────────────────────

let deleteStep = 'regret';
let selectedReasons = new Set();

function totalRecordCount() {
  return state.entries.length + state.weights.length + state.pressures.length
    + state.vitals.length + state.exercise.length + state.sleep.length
    + Object.keys(state.water).length;
}

function renderDeleteStep() {
  const host = byId('deleteSteps');

  if (deleteStep === 'regret') {
    host.innerHTML = `
      <h3>We are sorry to see you go.</h3>
      <p class="fine">Before anything is removed, there are a few options that keep your ${formatCount(totalRecordCount())} records.</p>

      <div class="leave-option">
        <button class="secondary wide" data-leave="pause">Take a break</button>
        <p>Sign out and pause. Your records stay on this device and nothing is deleted. You can return whenever you like.</p>
      </div>
      <div class="leave-option">
        <button class="secondary wide" data-leave="signout">Sign out instead</button>
        <p>Remove your name from this device and keep everything. Useful on a shared computer.</p>
      </div>
      <div class="leave-option">
        <button class="secondary wide" data-leave="export">Download my data first</button>
        <p>Save a backup you can restore later on any device, including this one.</p>
      </div>
      <div class="leave-option">
        <button class="secondary wide" data-leave="support">Contact support</button>
        <p>If something went wrong, tell us before you go. It is the fastest way to get it fixed.</p>
      </div>

      <div class="dialog-actions dialog-actions-split">
        <button class="link-btn" data-leave="continue">Continue to delete</button>
        <button class="secondary" data-leave="cancel" type="submit" formnovalidate>Keep my account</button>
      </div>`;
    return;
  }

  if (deleteStep === 'reasons') {
    host.innerHTML = `
      <h3>Would you tell us why?</h3>
      <p class="fine">Completely optional. It is the most useful thing you could give us, and it directly shapes what we build next.</p>
      <div class="reason-list">
        ${LEAVING_REASONS.map(reason => `
          <label class="reason">
            <input type="checkbox" value="${escapeHtml(reason)}" ${selectedReasons.has(reason) ? 'checked' : ''}>
            <span>${escapeHtml(reason)}</span>
          </label>`).join('')}
      </div>
      <label class="field-label" for="leaveNote">Anything else? (optional)</label>
      <textarea id="leaveNote" rows="3" placeholder="Tell us in your own words"></textarea>
      <div class="dialog-actions dialog-actions-split">
        <button class="link-btn" data-leave="regret">Back</button>
        <button class="primary" data-leave="confirm" type="submit">Continue</button>
      </div>`;
    return;
  }

  host.innerHTML = `
    <h3>Delete everything on this device?</h3>
    <p class="fine">This permanently removes ${formatCount(totalRecordCount())} records from this browser. There is no server copy and no way to undo this without a backup.</p>
    <ul class="acct-list">
      <li>All logged meals and food history</li>
      <li>Weight, blood pressure, vitals, exercise and sleep</li>
      <li>Your profile, goals and preferences</li>
      <li>Any meal photos</li>
    </ul>
    <label class="field-label" for="confirmPhrase">Type ${CONFIRM_PHRASE} to confirm</label>
    <input id="confirmPhrase" type="text" autocomplete="off" placeholder="${CONFIRM_PHRASE}">
    <p class="fine" id="confirmHint">Type the word above to enable the button.</p>
    <div class="dialog-actions dialog-actions-split">
      <button class="secondary" data-leave="export">Download a backup first</button>
      <button class="primary danger-solid" id="confirmDelete" data-leave="confirm-delete" disabled>Delete permanently</button>
    </div>`;

  const phraseInput = byId('confirmPhrase');
  const confirmButton = byId('confirmDelete');
  phraseInput.oninput = () => {
    const matches = phraseInput.value.trim().toUpperCase() === CONFIRM_PHRASE;
    confirmButton.disabled = !matches;
    byId('confirmHint').textContent = matches
      ? 'This will erase everything on this device.'
      : 'Type the word above to enable the button.';
  };
}

function performDelete(onDeleted) {
  resetState();
  saveState(message => showNotice(message));
  onDeleted();
}

/**
 * @param {{onDelete: () => void, onSignOut?: () => void, onPause?: () => void}} callbacks
 */
export function openDeleteFlow(callbacks = {}) {
  deleteStep = 'regret';
  selectedReasons = new Set();

  const dialog = byId('deleteDialog');
  const host = byId('deleteSteps');

  renderDeleteStep();
  dialog.returnValue = '';
  dialog.showModal();

  const handle = event => {
    const action = event.target.closest('[data-leave]')?.dataset.leave;
    if (!action) return;
    event.preventDefault();

    if (action === 'cancel') { dialog.close('cancel'); return; }
    if (action === 'back') { dialog.close('back'); return; }

    if (action === 'export') { exportBackup(); return; }

    if (action === 'support') {
      showNotice('Email support@healthq.app with what went wrong. We read every message.', { durationMs: LONG_NOTICE_MS });
      return;
    }

    if (action === 'signout') {
      dialog.close('signout');
      callbacks.onSignOut?.();
      return;
    }

    if (action === 'pause') {
      dialog.close('pause');
      callbacks.onPause?.();
      return;
    }

    if (action === 'regret') { deleteStep = 'regret'; renderDeleteStep(); return; }

    if (action === 'continue') {
      selectedReasons = new Set(
        [...host.querySelectorAll('input[type=checkbox]:checked')].map(input => input.value),
      );
      deleteStep = 'reasons';
      renderDeleteStep();
      return;
    }

    if (action === 'confirm') {
      deleteStep = 'confirm';
      renderDeleteStep();
      return;
    }

    if (action === 'confirm-delete') {
      const phrase = byId('confirmPhrase')?.value.trim().toUpperCase();
      if (phrase !== CONFIRM_PHRASE) return;
      const reasons = [...host.querySelectorAll('input[type=checkbox]:checked')].map(input => input.value);
      dialog.close('deleted');
      // Reasons are logged locally only. There is no server to send them to,
      // so nothing is transmitted and no feedback is silently discarded.
      console.info('Leaving reasons (not transmitted; no server exists):', reasons);
      performDelete(callbacks.onDelete);
    }
  };

  dialog.onclick = handle;
  host.addEventListener('submit', handle);
}

export function openWelcomeBack() {
  const dialog = byId('welcomeBackDialog');
  byId('welcomeExport').onclick = () => exportBackup();
  dialog.returnValue = '';
  dialog.showModal();
}

// ── Restore ──────────────────────────────────────────────────────────────────

/** Restore a backup previously produced by exportBackup(). */
export function restoreBackup(file, onRestored) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch {
      parsed = null;
    }
    if (!parsed || !Array.isArray(parsed.entries)) {
      showNotice('That file is not a HealthQ backup.', { durationMs: LONG_NOTICE_MS });
      return;
    }
    replaceState(parsed);
    saveState(message => showNotice(message));
    showNotice('Your records are back.', { kind: 'ok' });
    onRestored();
  };
  reader.readAsText(file);
}

export { LEAVING_REASONS, onRestoreRequested };
