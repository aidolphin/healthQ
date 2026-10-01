/**
 * @file src/main.js
 * @module main
 *
 * PURPOSE
 * The composition root. This is the only module that knows about every
 * feature, and the only place wiring happens.
 *
 * WHY A COMPOSITION ROOT EXISTS
 * Features must not import one another. If the day feature imported the health
 * feature directly, neither could be tested, replaced or removed in isolation,
 * and the dependency graph would grow into a mesh. Instead, features expose
 * small public functions and this file connects them.
 *
 * STARTUP ORDER
 *  1. Read persisted state          (core/storage)
 *  2. Mount each feature             (binds handlers, first render)
 *  3. Register global failure paths (core/notices)
 *  4. Build the tab controller       (core/tabs)
 *  5. Reveal the page               (removes the loading skeleton)
 *  6. Offer onboarding, once        (features/onboarding)
 *
 * The skeleton comes off before onboarding appears, so the app is usable behind
 * the tour from the first frame.
 */

import { byId } from './core/dom.js';
import { registerGlobalFailureHandlers, showNotice } from './core/notices.js';
import { createTabController } from './core/tabs.js';
import { renderCounts, renderSourceNote } from './services/attribution.js';

import { mountDiscoverFeature } from './features/discover.js';
import { mountCalculatorFeature } from './features/calculator.js';
import { mountDayFeature, renderDay, useConfirmRemoval, setDisplayedDate } from './features/day.js';
import { mountHealthFeature, renderHealth } from './features/health.js';
import { mountOnboardingFeature, startOnboarding } from './features/onboarding.js';
import { mountSettingsFeature, confirmAction, onDataChanged } from './features/settings.js';
import { mountAccountFeature, renderAccount } from './features/account.js';
import { openSignOutDialog, openDeleteFlow, useRestoreRequest, restoreBackup } from './features/accountFlows.js';
import { todayKey } from './core/dom.js';
import { state } from './core/storage.js';

function revealPage() {
  document.body.classList.remove('is-loading');
  const bootStatus = document.getElementById('bootStatus');
  if (bootStatus) bootStatus.textContent = '';
}

function start() {
  registerGlobalFailureHandlers();

  // The day feature needs a way to ask for confirmation without importing
  // settings. The direction of the dependency matters: day -> injected, never
  // day -> settings.
  useConfirmRemoval(({ title, message, onConfirm }) => {
    confirmAction({ title, message, confirmLabel: 'Remove', onConfirm });
  });

  mountDiscoverFeature();
  mountCalculatorFeature();
  mountDayFeature();
  mountHealthFeature();
  mountOnboardingFeature();
  mountSettingsFeature({
    onResumeOnboarding: () => startOnboarding(true),
    onRestore: file => restoreBackup(file, () => { renderAccount(); renderDay(); renderHealth(); }),
  });

  mountAccountFeature({
    onResumeOnboarding: () => startOnboarding(true),
    onDataChanged: () => { setDisplayedDate(todayKey()); renderDay(); renderHealth(); },
    onOpenHealth: () => showTabByName('health'),
    onOpenDay: () => showTabByName('day'),
  });

  // The restore action is raised as a window event by the file input so that
  // both the Settings and Account entry points share one implementation.
  useRestoreRequest(() => {});
  window.addEventListener('healthq:restore-request', event => {
    restoreBackup(event.detail, () => { renderAccount(); renderDay(); renderHealth(); });
  });

  const tabs = createTabController({
    onRevealDay: () => {
      setDisplayedDate(todayKey());
      renderDay();
    },
    onRevealHealth: renderHealth,
    onRevealAccount: renderAccount,
  });
  tabs.mount();

  function showTabByName(name) {
    const target = document.getElementById(`tab-${name}`);
    if (target) target.click();
  }

  // Every feature re-renders when the data underneath it changes, so restoring
  // a backup or erasing everything stays consistent everywhere at once.
  onDataChanged(() => {
    setDisplayedDate(todayKey());
    renderDay();
    renderHealth();
  });

  renderSourceNote();
  renderCounts();
  revealPage();

  if (!state.onboarded) {
    setTimeout(startOnboarding, 450);
  }
}

// A failure during startup must still leave a usable page rather than a blank
// screen, so the skeleton comes off either way.
try {
  start();
} catch (error) {
  revealPage();
  showNotice('HealthQ could not start properly. Reload the page to try again.', { durationMs: 12000 });
  console.error('Startup failed', error);
}

export { byId };
