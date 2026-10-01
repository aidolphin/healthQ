/**
 * @file src/core/tabs.js
 * @module core/tabs
 *
 * PURPOSE
 * Drives the primary navigation: which panel is visible, and the accessibility
 * contract that goes with it.
 *
 * ACCESSIBILITY CONTRACT
 * The navigation is a real WAI-ARIA tablist, not a row of buttons that happens
 * to hide panels:
 *  - each tab exposes aria-selected and aria-controls
 *  - exactly one tab is in the tab order (roving tabindex)
 *  - Left/Right/Home/End move between tabs, matching native behaviour
 *  - the panel is labelled by its tab
 *
 * WHY THIS MATTERED
 * Screen readers previously announced five unlabelled buttons and no selected
 * state, so a user could not tell which section they were in.
 */

/**
 * Tab names are read from the DOM rather than hard-coded.
 *
 * A hard-coded list drifted out of step with the markup once already: the
 * buttons used data-tab="calc" and data-tab="today" while this module looked
 * for "calculator" and "day", so those two panels resolved to an undefined id
 * and silently never opened. Reading the buttons at mount time means adding a
 * tab to index.html is all that is required.
 *
 * The panel id is the data-tab value itself. Every tab in this app uses the
 * same string for both, so no lookup table is needed and none can go stale.
 */
function readTabNames() {
  return [...document.querySelectorAll('[role="tab"]')].map(tab => tab.dataset.tab);
}

/**
 * @param {{
 *   onRevealDay?: () => void,
 *   onRevealHealth?: () => void,
 *   onRevealCalculator?: () => void,
 *   onRevealAccount?: () => void,
 *   onChanged?: () => void,
 * }} handlers
 */
export function createTabController(handlers = {}) {
  // Hook names match the data-tab values used in index.html.
  const revealHooks = {
    today: handlers.onRevealDay,
    health: handlers.onRevealHealth,
    calc: handlers.onRevealCalculator,
    account: handlers.onRevealAccount,
  };

  function tabElements() {
    return [...document.querySelectorAll('[role="tab"]')];
  }

  function showTab(tabName, moveFocus = false) {
    const allTabs = tabElements();

    for (const tab of allTabs) {
      const isActive = tab.dataset.tab === tabName;
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.tabIndex = isActive ? 0 : -1;
    }

    for (const name of readTabNames()) {
      const panel = document.getElementById(name);
      if (panel) panel.classList.toggle('hidden', name !== tabName);
    }

    // Moving to a new section should start the reader at the top, matching
    // the behaviour of native tabs and of a page navigation.
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const activeTab = allTabs.find(tab => tab.dataset.tab === tabName);
    if (moveFocus && activeTab) activeTab.focus();

    const hook = revealHooks[tabName];
    if (hook) hook();

    if (handlers.onChanged) handlers.onChanged();
  }

  function onKeyDown(event) {
    const allTabs = tabElements();
    const focusedIndex = allTabs.indexOf(document.activeElement);
    if (focusedIndex < 0) return;

    const navigation = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity };
    if (!(event.key in navigation)) return;

    event.preventDefault();
    const step = navigation[event.key];
    const nextIndex = step === -Infinity
      ? 0
      : step === Infinity
        ? allTabs.length - 1
        : (focusedIndex + step + allTabs.length) % allTabs.length;

    showTab(allTabs[nextIndex].dataset.tab, true);
  }

  return {
    showTab,
    /** Attach listeners. Call once after the markup exists. */
    mount() {
      const strip = document.querySelector('.tabs');
      if (!strip) return;
      strip.addEventListener('click', event => {
        const tab = event.target.closest('[role="tab"]');
        if (tab) showTab(tab.dataset.tab);
      });
      strip.addEventListener('keydown', onKeyDown);
    },
  };
}
