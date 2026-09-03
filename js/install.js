/**
 * "Add to Home Screen" (PRD §69).
 *
 * This is not a growth prompt — it is data protection. WebKit clears all
 * script-writable storage after seven days without a visit, so an iPhone user
 * who takes a fortnight off loses their whole collection. A home-screen
 * install is exempt from that cap, which makes it the only real fix available
 * to a site with no accounts.
 *
 * §69 forbids an aggressive install prompt, so it is offered once, only after
 * someone has collected enough to have something worth keeping, and never
 * again once dismissed. It is also reachable on demand from My London.
 */

import { HOME_SCREEN_PROMPT_AFTER } from './config.js';
import { state, progress, getSetting, setSetting } from './state.js';

/** Chrome fires this before showing its own banner; we save it for later. */
let deferredPrompt = null;

export function watchForInstallPrompt() {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    setSetting('homeScreenInstalled', true);
  });
}

export const isInstalled = () =>
  window.matchMedia?.('(display-mode: standalone)').matches === true ||
  window.navigator.standalone === true ||
  getSetting('homeScreenInstalled') === true;

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  // iPadOS reports as a Mac; the touch points give it away.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isMobile = () => window.matchMedia?.('(max-width: 899px)').matches === true || isIOS();

/** Can the browser install it directly, without written instructions? */
export const canPromptDirectly = () => deferredPrompt !== null;

/** @returns {Promise<'accepted'|'dismissed'|'unavailable'>} */
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  const event = deferredPrompt;
  deferredPrompt = null;
  event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === 'accepted') setSetting('homeScreenInstalled', true);
  return outcome;
}

/**
 * Whether to offer it unprompted right now. Everything here is a reason not to
 * interrupt: already installed, on a desktop, too early to care, or asked once
 * already.
 */
export function shouldOfferInstall() {
  if (isInstalled()) return false;
  if (!isMobile()) return false;
  if (getSetting('homeScreenPromptSeen')) return false;
  return progress().count >= HOME_SCREEN_PROMPT_AFTER;
}

export function markOffered() { setSetting('homeScreenPromptSeen', true); }

/** True when this browser will silently bin the collection if left alone. */
export const storageIsFragile = () => isIOS() && !isInstalled();

export const collectedCount = () => Object.keys(state.saved.collected).length;
