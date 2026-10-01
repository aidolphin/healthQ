/**
 * @file src/core/notices.js
 * @module core/notices
 *
 * PURPOSE
 * One transient message surface for the whole application.
 *
 * HISTORY WORTH KNOWING
 * This replaces an earlier persistent error bar. That bar shipped a real bug:
 * the markup carried the `hidden` attribute, but an author rule declaring
 * `display: flex` overrode the browser's user-agent `display: none`, so the bar
 * was permanently on screen. Because it was `position: fixed`, it also
 * appeared underneath an open <dialog> and read as a popup inside a popup.
 *
 * DESIGN RULES THAT COME FROM THAT
 *  1. A global `[hidden] { display: none !important }` rule now guarantees the
 *     hidden attribute always wins.
 *  2. Notices never stack over a modal. If a <dialog> is open the message is
 *     held and shown once the dialog closes.
 *  3. Notices are non-blocking and auto-dismiss. They never demand an action.
 *  4. Repeat failures inside a short window are debounced so a burst of
 *     background rejections cannot flood the screen.
 */

import { byIdOrNull } from './dom.js';

const DEFAULT_DURATION_MS = 4200;
const REPEAT_SUPPRESSION_MS = 4000;
const EXIT_ANIMATION_MS = 200;

/** @type {ReturnType<typeof setTimeout>|null} */
let dismissTimer = null;
let heldMessage = null;
let lastShownAt = 0;

function isModalOpen() {
  return Boolean(document.querySelector('dialog[open]'));
}

/**
 * Show a transient message.
 * @param {string} message
 * @param {{kind?: 'ok'|'error', durationMs?: number, actionLabel?: string, onAction?: () => void}} [options]
 */
export function showNotice(message, options = {}) {
  const surface = byIdOrNull('notice');
  if (!surface || !message) return;

  if (isModalOpen()) {
    heldMessage = { message, options };
    return;
  }

  clearTimeout(dismissTimer);
  surface.textContent = String(message);
  surface.className = 'notice' + (options.kind ? ` ${options.kind}` : '');
  surface.hidden = false;

  if (options.actionLabel) {
    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.textContent = options.actionLabel;
    actionButton.addEventListener('click', () => {
      hideNotice();
      if (options.onAction) options.onAction();
    });
    surface.appendChild(actionButton);
  }

  dismissTimer = setTimeout(hideNotice, options.durationMs ?? DEFAULT_DURATION_MS);
}

export function hideNotice() {
  const surface = byIdOrNull('notice');
  if (!surface || surface.hidden) return;

  surface.classList.add('is-leaving');
  setTimeout(() => {
    surface.hidden = true;
    surface.className = 'notice';
    surface.textContent = '';
    flushHeldMessage();
  }, EXIT_ANIMATION_MS);
}

function flushHeldMessage() {
  if (!heldMessage) return;
  const { message, options } = heldMessage;
  heldMessage = null;
  showNotice(message, options);
}

/**
 * Report a background failure without demanding anything from the user.
 * Used for window-level error events, which are usually unrelated to what the
 * user was doing at that instant.
 * @param {string} message
 */
export function showQuietNotice(message) {
  const now = Date.now();
  if (now - lastShownAt < REPEAT_SUPPRESSION_MS) return;
  lastShownAt = now;
  showNotice(message);
}

/** Wire the global handlers. Called once, at startup. */
export function registerGlobalFailureHandlers() {
  window.addEventListener('error', () => {
    showQuietNotice('Something did not work. Your data is safe.');
  });
  window.addEventListener('unhandledrejection', () => {
    showQuietNotice('That did not work. Your data is safe.');
  });
  document.addEventListener('close', () => {
    if (heldMessage) setTimeout(flushHeldMessage, 250);
  }, true);
}
