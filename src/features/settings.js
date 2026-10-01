/**
 * @file src/features/settings.js
 * @module features/settings
 *
 * PURPOSE
 * Data ownership and destructive actions: export, import, erase, and the
 * shared confirmation dialog.
 *
 * WHY EXPORT/IMPORT IS THE ANSWER TO "SIGN IN"
 * This build has no server and no account system, so there is nothing to sign
 * in to. Rather than present sign-in buttons that cannot work, the user is
 * given a real alternative that works today: a file they own. A backup restores
 * the entire state on any device, and nothing is transmitted anywhere.
 */

import { byId, todayKey } from '../core/dom.js';
import { state, saveState, replaceState, resetState } from '../core/storage.js';
import { showNotice } from '../core/notices.js';
import { GOAL_DEFAULTS } from '../../nutrition.js';

const BACKUP_MIME_TYPE = 'application/json';
const BACKUP_VERSION = 2;
const RESTORE_NOTICE_MS = 5000;

/** Listeners the shell registers so settings never re-render features itself. */
const changeListeners = new Set();

/** Features subscribe to "my data changed" instead of importing each other. */
export function onDataChanged(listener) {
  changeListeners.add(listener);
}

function announceChange() {
  for (const listener of changeListeners) listener();
}

// ── Confirmation ─────────────────────────────────────────────────────────────

/**
 * Show the shared confirm dialog.
 * @param {{title:string, message:string, confirmLabel?:string, onConfirm:()=>void}} options
 */
export function confirmAction({ title, message, confirmLabel = 'Confirm', onConfirm }) {
  const dialog = byId('confirm');
  byId('confirmTitle').textContent = title;
  byId('confirmText').textContent = message;

  for (const button of dialog.querySelectorAll('button[value]')) {
    if (button.value === 'yes') button.textContent = confirmLabel;
  }

  dialog.onclose = () => {
    if (dialog.returnValue === 'yes') onConfirm();
  };
  dialog.showModal();
}

// ── Export ───────────────────────────────────────────────────────────────────

function downloadBackup() {
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

  showNotice('Backup downloaded. Keep it somewhere safe.', { kind: 'ok', durationMs: RESTORE_NOTICE_MS });
}

// ── Import ───────────────────────────────────────────────────────────────────

function applyBackup(parsed) {
  replaceState({
    entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    weights: Array.isArray(parsed.weights) ? parsed.weights : [],
    pressures: Array.isArray(parsed.pressures) ? parsed.pressures : [],
    exercise: Array.isArray(parsed.exercise) ? parsed.exercise : [],
    sleep: Array.isArray(parsed.sleep) ? parsed.sleep : [],
    vitals: Array.isArray(parsed.vitals) ? parsed.vitals : [],
    water: isPlainObject(parsed.water) ? parsed.water : {},
    photos: isPlainObject(parsed.photos) ? parsed.photos : {},
    customLog: isPlainObject(parsed.customLog) ? parsed.customLog : {},
    profile: isPlainObject(parsed.profile) ? parsed.profile : null,
    goals: isPlainObject(parsed.goals) ? { ...GOAL_DEFAULTS, ...parsed.goals } : { ...GOAL_DEFAULTS },
    conditions: Array.isArray(parsed.conditions) ? parsed.conditions : [],
    allergies: Array.isArray(parsed.allergies) ? parsed.allergies : [],
    diets: Array.isArray(parsed.diets) ? parsed.diets : [],
    onboarded: parsed.onboarded === true,
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function handleBackupFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch {
      parsed = null;
    }

    if (!parsed || !Array.isArray(parsed.entries)) {
      showNotice('That file is not a HealthQ backup.', { durationMs: RESTORE_NOTICE_MS });
      return;
    }

    const entryCount = parsed.entries.length;
    confirmAction({
      title: 'Replace your data?',
      message: `This backup holds ${entryCount} food entr${entryCount === 1 ? 'y' : 'ies'}. It will replace what is on this device.`,
      confirmLabel: 'Replace',
      onConfirm: () => {
        applyBackup(parsed);
        saveState(message => showNotice(message));
        announceChange();
        showNotice('Backup restored.', { kind: 'ok' });
      },
    });
  };
  reader.readAsText(file);
}

// ── Erase ────────────────────────────────────────────────────────────────────

function eraseEverything() {
  confirmAction({
    title: 'Erase all records?',
    message: 'This removes every meal, weight, reading, photo and goal stored in this browser. It cannot be undone.',
    confirmLabel: 'Erase everything',
    onConfirm: () => {
      resetState();
      saveState(message => showNotice(message));
      announceChange();
      showNotice('Everything erased.');
    },
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

export function mountSettingsFeature({ onResumeOnboarding, onRestore }) {
  byId('export').onclick = downloadBackup;

  byId('importBtn').onclick = () => byId('importFile').click();
  byId('importFile').onchange = event => {
    const file = event.target.files?.[0];
    if (file) (onRestore ? onRestore(file) : handleBackupFile(file));
    event.target.value = '';
  };

  byId('openOnboarding').onclick = onResumeOnboarding;
  byId('erase').onclick = eraseEverything;
  byId('clearDay').onclick = () => confirmAction({
    title: 'Clear this day?',
    message: 'This removes the food entries for the day you are viewing.',
    confirmLabel: 'Clear day',
    onConfirm: announceChange,
  });
}
