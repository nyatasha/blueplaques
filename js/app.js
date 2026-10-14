/**
 * London Uncovered — bootstrap and orchestration.
 *
 * Owns the tab shell, wires the feature modules to each other, and runs the
 * collect flow (award XP → update marker → re-evaluate quests and achievements
 * → celebrate). Everything below is event-driven; no module reaches into
 * another module's DOM.
 */

import { CATEGORY_BY_SLUG, VERIFY_RADIUS_M, VERIFY_ANYWHERE_PARAM, VERIFY_ANYWHERE_VALUE, MILESTONES,
         LOCATION_INVITE_DELAY_MS, PLAQUE_PARAM, WALK_PARAM,
         CATEGORY_PARAM } from './config.js';
import { backupUrl, pendingRestore, clearRestoreFromUrl, COMFORTABLE_URL_LENGTH } from './backup.js';
import { loadPlaques } from './data.js';
import * as store from './state.js';
import { state } from './state.js';
import * as mapView from './map.js';
import { Sheet, initScrim, closeAllSheets } from './sheet.js';
import { initSearch, clear as clearSearch } from './search.js';
import { initFilters, openFilters, refreshFilters, activeFilterCount, clearFilters, isFiltered } from './filters.js';
import { initPlaqueSheet, openPlaque, renderPlaqueSheet, currentPlaqueId } from './plaque-sheet.js';
import { initQuestScreen, renderQuest } from './quest-screen.js';
import { initWalkScreen, renderWalks, showWalk } from './walk-screen.js';
import { loadWalks, walkBySlug, allWalks, walksWithPlaque,
         walkProgress } from './walks.js';
import { initMyLondon, renderMyLondon, showSegment } from './mylondon.js';
import { syncUnlocks } from './achievements.js';
import { celebrateIconic, loadIconicNotes, noteFor } from './celebrate.js';
import { drawShareCard, toBlob, canShareImage, epithetFor } from './share-card.js';
import { syncCompletions, hasActionableQuest } from './quests.js';
import { requestLocation, ensureLocation } from './location.js';
import { recommendNext } from './recommend.js';
import { distanceMetres, formatDistance } from './geo.js';
import { qs, qsa, on, esc, delegate, toast, xpBurst, announce, fmtNumber,
         plaqueRow, opensElsewhere } from './ui.js';
import { storageAvailable } from './storage.js';
import { isCollected } from './state.js';
import { icon } from './icons.js';
import { initAnalytics, trackEvent, recordedEvents } from './analytics.js';
import { watchForInstallPrompt, shouldOfferInstall, markOffered, canPromptDirectly,
         promptInstall, isIOS, isInstalled, storageIsFragile } from './install.js';

let sheets = {};
let booted = false;

/* ── Tabs ──────────────────────────────────────────────────────────────── */

function setTab(tab, { track = true } = {}) {
  if (state.tab === tab) return;
  state.tab = tab;
  document.body.dataset.tab = tab;

  qs('#screen-walks').hidden = tab !== 'walks';
  qs('#screen-quest').hidden = tab !== 'quest';
  qs('#screen-mylondon').hidden = tab !== 'mylondon';
  document.querySelectorAll('.tab').forEach(el => {
    const active = el.dataset.tab === tab;
    el.setAttribute('aria-current', active ? 'page' : 'false');
  });

  if (tab === 'walks') { renderWalks(); if (track) trackEvent('walks_opened'); }
  if (tab === 'quest') renderQuest();
  if (tab === 'mylondon') { renderMyLondon(); if (track) trackEvent('my_london_opened'); }
  if (tab === 'map') requestAnimationFrame(() => mapView.invalidateSize());
  if (tab !== 'map') closeAllSheets();
}

/* ── Chips ─────────────────────────────────────────────────────────────── */

/** Built once — the category list does not change while the app is running. */
function renderChips() {
  qs('#chips').innerHTML = [
    '<button type="button" class="chip" data-cat="all" aria-pressed="true">All</button>',
    ...store.categoryTotals().map(c => `<button type="button" class="chip" data-cat="${esc(c.slug)}"
        aria-pressed="false">${esc(c.short)}</button>`),
  ].join('');
  syncChips();
}

/**
 * Selection state is written onto the existing buttons rather than re-rendering
 * the row: rebuilding would drop keyboard focus and reset the horizontal
 * scroll position every time a category is chosen.
 */
function syncChips() {
  const selected = state.filters.categories;
  qsa('#chips .chip').forEach(chip => {
    const on_ = chip.dataset.cat === 'all' ? selected.size === 0 : selected.has(chip.dataset.cat);
    chip.setAttribute('aria-pressed', String(on_));
  });
}

function toggleCategory(slug) {
  const set = state.filters.categories;
  if (slug === 'all') set.clear();
  else if (set.has(slug)) set.delete(slug);
  else { set.clear(); set.add(slug); }     // chips behave as single-select
  trackEvent('category_selected', { category: slug });
  syncChips();
  refresh();
}

/* ── Shared refresh ────────────────────────────────────────────────────── */

function refresh({ rerenderSheet = false } = {}) {
  const visible = mapView.applyFilters();
  const p = store.progress();

  qs('#counter-value').innerHTML =
    `<strong>${fmtNumber(p.count)}</strong> / ${fmtNumber(p.total)}`;

  const countEl = qs('#map-count');
  const activeTheme = state.filters.theme
    ? state.themes.find(t => t.id === state.filters.theme) : null;
  const activeWalk = state.filters.walk ? walkBySlug(state.filters.walk) : null;
  countEl.textContent = activeWalk
    ? `${activeWalk.name} · ${fmtNumber(visible.length)} stops`
    : activeTheme
    ? `${activeTheme.name} · ${fmtNumber(visible.length)} left`
    : visible.length === p.total
      ? `${fmtNumber(p.total)} discoveries`
      : `${fmtNumber(visible.length)} of ${fmtNumber(p.total)}`;

  const filterBtn = qs('#filters-open');
  filterBtn.dataset.active = String(isFiltered());
  const badge = qs('#filter-badge');
  badge.hidden = activeFilterCount() === 0;
  badge.textContent = activeFilterCount();

  qs('#quest-dot').hidden = !hasActionableQuest();
  qs('#nearby').hidden = !state.userPos;
  renderMapPanel(visible);

  renderEmptyState(visible.length);
  if (rerenderSheet && currentPlaqueId()) renderPlaqueSheet();
  if (state.tab === 'walks') renderWalks();
  if (state.tab === 'quest') renderQuest();
  if (state.tab === 'mylondon') renderMyLondon();
  refreshFilters();
}

/**
 * Empty results are shown as a card over the map, never as a sheet: a modal
 * here would steal focus from the search field the user is still typing in.
 */
function renderEmptyState(visibleCount) {
  const el = qs('#map-empty');
  if (visibleCount > 0) { el.hidden = true; return; }
  const hasQuery = state.query.trim().length > 0;
  qs('#map-empty-title').textContent = hasQuery ? 'Nothing found' : 'No discoveries match these filters';
  qs('#map-empty-body').textContent = hasQuery
    ? 'Try another person, place or category.'
    : 'Loosen a filter to bring London back into view.';
  qs('#map-empty-clear').textContent = hasQuery ? 'Clear search' : 'Clear filters';
  el.hidden = false;
}


/* ── Desktop panel list ────────────────────────────────────────────────── */

/**
 * The right-hand panel on desktop would otherwise be empty under the CTA.
 * It shows whatever is most useful for the current context: what is near you
 * once location is on, otherwise the strongest names in the current view.
 */
function discoveryList(rows, { heading, count, emptyText }) {
  return `
    <div class="mp-head">
      <span class="eyebrow">${esc(heading)}</span>
      <span class="level-xp">${fmtNumber(count)}</span>
    </div>
    <div class="mp-list">
      ${rows.length ? rows.map(({ p, d }, i) => {
        const done = isCollected(p.id);
        return plaqueRow({
          href: p.url,
          className: `mp-item${p.fame >= 3 ? ' iconic' : ''}${done ? ' done' : ''}`,
          attrs: `data-panel-id="${esc(p.id)}"`,
          html: `
          <span class="mp-rank">${done ? icon('check') : i + 1}</span>
          <span class="recent-main">
            <span class="recent-name">${esc(p.title)}</span>
            <span class="recent-sub">${esc(p.categoryLabel)}${p.fame >= 3 ? ' · Iconic' : ''}</span>
          </span>
          ${d !== null ? `<span class="mp-dist">${esc(formatDistance(d))}</span>` : icon('chevronR')}`,
        });
      }).join('') : `<p class="recent-sub">${esc(emptyText)}</p>`}
    </div>`;
}

function rankedRows(visible, { byDistance, limit }) {
  return (byDistance
    ? visible.map(p => ({ p, d: distanceMetres(state.userPos, p) })).sort((a, b) => a.d - b.d)
    : visible.map(p => ({ p, d: null })).sort((a, b) => b.p.fame - a.p.fame || b.p.views - a.p.views)
  ).slice(0, limit);
}

function renderMapPanel(visible) {
  const host = qs('#map-panel');
  if (!host) return;
  const located = !!state.userPos;
  const searching = state.query.trim().length > 0 || isFiltered();
  const rows = rankedRows(visible, { byDistance: located, limit: 12 });
  host.innerHTML = discoveryList(rows, {
    // "In this view" is a claim about the whole filtered set, so it counts all
    // of it. The other two headings name the rows themselves, so they count
    // those: the whole-dataset total beside "Iconic Londoners" answered a
    // different question.
    heading: located ? 'Near you' : searching ? 'In this view' : 'Iconic Londoners',
    count: searching && !located ? visible.length : rows.length,
    emptyText: 'Nothing matches the current filters.',
  })
    // The way out to the A–Z directory, for someone who would rather scan names
    // than pan a map. A plain link: the directory is its own static page.
    + `<p class="mp-all"><a href="blue-plaques/">Full list of all ${fmtNumber(state.plaques.length)} plaques, A–Z</a></p>`;
}

/**
 * "Near me" (PRD §22) — the mobile counterpart to the desktop panel list.
 * Uncollected discoveries come first, since those are the ones worth walking to.
 */
function openNearby() {
  if (!state.userPos) return;
  trackEvent('near_me_used', { surface: 'sheet' });
  const visible = mapView.visiblePlaques();
  const uncollected = visible.filter(p => !isCollected(p.id));
  const rows = rankedRows(uncollected.length ? uncollected : visible, { byDistance: true, limit: 25 });
  qs('#nearby-body').innerHTML = discoveryList(rows, {
    heading: uncollected.length ? 'Closest still to find' : 'Closest discoveries',
    count: rows.length,
    emptyText: "You've explored everything nearby. Zoom out or choose another category.",
  });
  sheets.nearby.open('full');
}

/* ── Collecting ────────────────────────────────────────────────────────── */

function verifiedFor(plaque) {
  if (state.verifyAnywhere) return true;          // test override, see config.js
  if (!state.userPos) return false;
  return distanceMetres(state.userPos, plaque) <= VERIFY_RADIUS_M;
}

/** Turn the proximity check off (or back on) and re-render what depends on it. */
function setVerifyAnywhere(on) {
  state.verifyAnywhere = !!on;
  if (state.verifyAnywhere) {
    console.info('[London Uncovered] Test mode: finds collect as verified without a location check. Reload without ?verify=anywhere for normal behaviour.');
  }
  refresh({ rerenderSheet: true });
  return state.verifyAnywhere;
}

function handleCollect(plaque, wantsVerified) {
  trackEvent('collect_clicked', { fame: plaque.fame, category: plaque.category });
  const verified = wantsVerified && verifiedFor(plaque);
  const result = store.collect(plaque.id, verified);
  if (!result) return;

  trackEvent('discovery_collected', {
    verified: result.verified, fame: plaque.fame, category: plaque.category,
  });

  mapView.refreshMarker(plaque.id, { pop: true });
  if (state.targetId === plaque.id) mapView.setTarget(null);

  qs('#counter').classList.add('bump');
  setTimeout(() => qs('#counter').classList.remove('bump'), 500);

  const p = store.progress();
  announce(`${plaque.title} collected. ${result.xp} XP. ${p.count} of ${p.total} discovered.`);

  if (plaque.fame >= 3) {
    // The 49 Iconic plaques get a moment rather than a toast. Everything that
    // would have piled up behind it waits until the card is dismissed.
    trackEvent('iconic_collected', { category: plaque.category });
    // Bookkeeping happens now; only the toasts wait behind the card.
    const earned = recordUnlocks();
    recordMilestones();
    recordWalkCompletions(plaque);
    celebrateIconic(plaque, result.xp).then(() => {
      showUnlockToasts(earned);
      warnIfNotPersisted();
      maybeOfferInstall();
    });
  } else {
    xpBurst(result.xp);
    toast({
      eyebrow: 'Discovery added',
      title: plaque.title,
      desc: `${plaque.categoryLabel} · +${result.xp} XP · ${p.count} / ${p.total}`,
      iconName: 'check',
      gold: false,
    });
    celebrateUnlocks();
    recordMilestones();
    recordWalkCompletions(plaque);
    warnIfNotPersisted();
    maybeOfferInstall();
  }

  refresh({ rerenderSheet: true });
}

/**
 * Private browsing and locked-down browsers reject localStorage. The game still
 * works for the session, but the player deserves to know it will not be kept.
 */
let storageWarningShown = false;
function warnIfNotPersisted() {
  if (storageWarningShown || storageAvailable()) return;
  storageWarningShown = true;
  toast({
    eyebrow: 'Heads up',
    title: "Progress won't be saved",
    desc: 'This browser is blocking site storage, so your collection will not survive a refresh.',
    iconName: 'info',
    gold: false,
  });
}

/**
 * Announces collection milestones as they are crossed, so a storage-less
 * analytics service can report activation and strong activation without ever
 * aggregating per visitor. Each threshold fires once and is recorded, so a
 * reload or a restored backup cannot double-count it.
 */
function recordMilestones() {
  const { count } = store.progress();
  const fired = store.getSetting('firedMilestones') || [];
  const newly = MILESTONES.filter(m => count >= m && !fired.includes(m));
  if (!newly.length) return;
  newly.forEach(m => trackEvent('milestone', { count: m }));
  store.setSetting('firedMilestones', [...fired, ...newly]);
}

/**
 * Announces a walk finished by the discovery just collected.
 *
 * A walk has no state of its own — completing one is simply having collected
 * all of its stops — so there is nothing to watch. This looks only at the
 * walks the collected plaque is on, which is at most one or two, and records
 * each announcement in settings so a reload or a restored backup cannot
 * report the same walk twice. The same shape as recordMilestones(), for the
 * same reason: GoatCounter cannot aggregate per visitor, so the app has to
 * say when a threshold is crossed.
 */
function recordWalkCompletions(plaque) {
  const done = store.getSetting('finishedWalks') || [];
  const newly = walksWithPlaque(plaque.id)
    .filter(w => !done.includes(w.slug) && walkProgress(w).complete)
    .map(w => w.slug);
  if (!newly.length) return;
  newly.forEach(slug => trackEvent('walk_completed', { walk: slug }));
  store.setSetting('finishedWalks', [...done, ...newly]);
}

/**
 * Writes unlock dates and fires the analytics, then hands back what was newly
 * earned. Deliberately separate from the toasts: an iconic celebration card
 * holds its toasts back until it is dismissed, and a card the user never taps
 * must not also cost them their unlock dates.
 */
function recordUnlocks() {
  const quests = syncCompletions();
  const achievements = syncUnlocks();
  quests.forEach(q => trackEvent('quest_completed', { quest: q.id }));
  achievements.forEach(a => trackEvent('achievement_unlocked', { achievement: a.id }));
  return { quests, achievements };
}

/** Staggered so they do not stack all at once. */
function showUnlockToasts({ quests, achievements }) {
  quests.forEach((quest, i) => {
    setTimeout(() => toast({
      eyebrow: 'Quest complete', title: quest.name, desc: quest.goal,
      iconName: 'check', gold: false, onClick: () => setTab('quest'),
    }), 700 + i * 400);
  });

  achievements.forEach((achievement, i) => {
    setTimeout(() => toast({
      eyebrow: 'Achievement unlocked',
      title: achievement.name,
      desc: achievement.desc,
      iconName: achievement.icon,
      onClick: () => { setTab('mylondon'); showSegment('achievements'); },
    }), 1100 + i * 450);
  });
}

/** Achievement and quest toasts, for callers with nothing to wait behind. */
function celebrateUnlocks() {
  showUnlockToasts(recordUnlocks());
}

/* ── Location ──────────────────────────────────────────────────────────── */

function locationDeniedMessage() {
  showMessage({
    icon: 'locate',
    title: 'Location is off',
    body: 'Use location to find discoveries near you. You can turn it back on in your browser settings for this site.',
    primary: { label: 'Try again', onClick: () => { state.locationStatus = 'idle'; useLocation(); } },
  });
}

async function useLocation({ centre = true, silent = false } = {}) {
  const btn = qs('#locate');
  btn.classList.add('locating');
  try {
    const pos = await (silent ? ensureLocation() : requestLocation());
    mapView.setUserPosition(pos);
    if (centre) mapView.centreOnUser(pos);
    btn.dataset.active = 'true';
    refresh({ rerenderSheet: true });
    return pos;
  } catch (reason) {
    btn.dataset.active = 'false';
    if (reason === 'denied') locationDeniedMessage();
    else if (reason !== 'timeout') {
      showMessage({ icon: 'locate', title: "Couldn't find you",
        body: 'Your device could not provide a location just now.',
        primary: { label: 'Try again', onClick: () => useLocation() } });
    }
    return null;
  } finally {
    btn.classList.remove('locating');
  }
}

/* ── Add to Home Screen (PRD §69) ──────────────────────────────────────── */

/**
 * Offered as protection, not promotion: Safari clears site storage after seven
 * days away, and a home-screen install is exempt. Chrome can install directly;
 * iOS has no such API, so it gets the two-step Share → Add to Home Screen path.
 */
function openInstallSheet({ manual = false } = {}) {
  markOffered();
  trackEvent('install_prompt_shown', { manual, ios: isIOS() });

  const why = `
    <div class="install-why">
      ${icon('shield')}
      <span>${storageIsFragile()
        ? 'Your collection is saved in this browser, and Safari clears it after about a week away. On your Home Screen it is kept safely.'
        : 'Your collection is saved in this browser. On your Home Screen it opens full-screen and stays put.'}</span>
    </div>`;

  const body = canPromptDirectly()
    ? `${why}
       <div class="pq-actions" style="margin-top:var(--sp-5)">
         <button type="button" class="btn btn-primary btn-block" data-install="go" data-autofocus>
           ${icon('bookmark')} Add to Home Screen
         </button>
       </div>`
    : `${why}
       <div class="install-steps">
         <div class="install-step"><span class="install-num">1</span>
           ${icon('share')}<span>Tap the Share button in the browser bar</span></div>
         <div class="install-step"><span class="install-num">2</span>
           ${icon('bookmark')}<span>Choose <strong>Add to Home Screen</strong></span></div>
         <div class="install-step"><span class="install-num">3</span>
           ${icon('check')}<span>Open London Uncovered from there from now on</span></div>
       </div>`;

  qs('#install-body').innerHTML = `
    <p style="font-size:var(--fs-sm);color:var(--ink-600);line-height:1.6;text-align:left">
      Keep your ${fmtNumber(store.progress().count)} discoveries safe and open the map in one tap.
    </p>
    ${body}
    <button type="button" class="btn btn-ghost btn-block btn-sm" data-install="later"
            style="margin-top:var(--sp-3)">Not now</button>`;
  sheets.install.open('full');
}

async function runInstall() {
  const outcome = await promptInstall();
  trackEvent('install_outcome', { outcome });
  sheets.install.close();
  if (outcome === 'accepted') {
    toast({ eyebrow: 'Added', title: 'London Uncovered is on your Home Screen',
            desc: 'Your collection is safe there.', iconName: 'check', gold: false });
  }
}

/** Called after a collect; stays silent unless the moment is right. */
function maybeOfferInstall() {
  if (!shouldOfferInstall()) return;
  // Let the collect celebration finish first.
  setTimeout(() => {
    if (sheets.message.isOpen || sheets.install.isOpen) return;
    openInstallSheet();
  }, 2400);
}

/**
 * A first-visit invitation to switch location on (PRD §19–21).
 *
 * This is not a permission request — the browser is only asked when the button
 * here is pressed, which is the explicit user action §19 requires. Asking in
 * our own words first means the real prompt arrives with a reason attached,
 * and a decline costs the browser permission nothing.
 *
 * Shown once, ever. Declining is remembered, so it never nags (§21).
 */
function maybeInviteLocation() {
  if (store.getSetting('locationInviteSeen')) return;
  if (state.userPos || state.locationStatus !== 'idle') return;
  if (!('geolocation' in navigator)) return;

  setTimeout(() => {
    // Say nothing if they have got on with it in the meantime.
    if (state.userPos || state.locationStatus !== 'idle') return;
    if (state.tab !== 'map' || sheets.message.isOpen || sheets.plaque.isOpen) return;
    if (store.getSetting('locationInviteSeen')) return;

    store.setSetting('locationInviteSeen', true);
    trackEvent('location_invite_shown');
    showMessage({
      icon: 'locate',
      title: 'See what is around you',
      body: 'Turn on location to find discoveries near you, get walking directions, '
          + 'and collect plaques where you stand. Your position stays on this device.',
      primary: {
        label: 'Use my location',
        onClick: () => { trackEvent('location_invite_accepted'); useLocation({ centre: true }); },
      },
      secondary: { label: 'Not now', onClick: () => trackEvent('location_invite_declined') },
    });
  }, LOCATION_INVITE_DELAY_MS);
}

/* ── Find my next discovery ────────────────────────────────────────────── */

async function findNext({ another = false } = {}) {
  trackEvent('find_next_clicked', { another });

  if (!store.getSetting('seenIntro')) {
    store.setSetting('seenIntro', true);
    showIntro(() => findNext({ another }));
    return;
  }

  if (!state.userPos) {
    const pos = await useLocation({ centre: false });
    if (!pos) return;
  }

  if (another && state.targetId) state.suggestedIds.push(state.targetId);
  const pick = recommendNext({ excludeIds: state.suggestedIds });

  if (!pick) {
    // Nothing left under the current constraints — say which constraint.
    showMessage({
      icon: 'compass',
      title: isFiltered() ? 'Nothing nearby in this filter' : "You've explored everything nearby",
      body: isFiltered()
        ? 'Clear the filters, or zoom out and choose another part of London.'
        : 'Zoom out or choose another category to keep going.',
      primary: isFiltered()
        ? { label: 'Clear filters', onClick: () => { clearFilters(); syncChips(); refresh(); state.suggestedIds = []; findNext(); } }
        : { label: 'Start again', onClick: () => { state.suggestedIds = []; findNext(); } },
    });
    return;
  }

  state.suggestedIds.push(pick.plaque.id);
  mapView.setTarget(pick.plaque.id);
  mapView.focusPlaque(pick.plaque.id, { zoom: 16 });
  openPlaque(pick.plaque.id);
  announce(`Next discovery: ${pick.plaque.title}, ${formatDistance(pick.distance)} away.`);
}

/* ── Generic message sheet ─────────────────────────────────────────────── */

function showMessage({ icon: iconName = 'info', title, body, primary, secondary }) {
  qs('#message-body').innerHTML = `
    <div class="notice">
      <div class="notice-icon">${icon(iconName)}</div>
      <div class="notice-title">${esc(title)}</div>
      <p>${esc(body)}</p>
      ${primary ? `<button type="button" class="btn btn-primary" data-msg="primary" data-autofocus>${esc(primary.label)}</button>` : ''}
      ${secondary ? `<button type="button" class="btn btn-ghost btn-block btn-sm" data-msg="secondary" style="margin-top:var(--sp-2)">${esc(secondary.label)}</button>` : ''}
    </div>`;
  sheets.message._primary = primary?.onClick;
  sheets.message._secondary = secondary?.onClick;
  sheets.message.open('peek');
}

/** First-run explainer, shown once (PRD §54). */
function showIntro(after) {
  qs('#message-body').innerHTML = `
    <div class="intro-art" aria-hidden="true"></div>
    <div class="notice" style="padding-top:0">
      <div class="notice-title" style="font-size:var(--fs-lg)">Uncover London as you explore</div>
      <p>Find historical discoveries around you, collect the ones you have seen, and unlock achievements as your London fills in.</p>
      <button type="button" class="btn btn-primary" data-msg="primary" data-autofocus>Start exploring</button>
    </div>`;
  sheets.message._primary = after;
  sheets.message._secondary = null;
  sheets.message.open('peek');
}

/* ── Sharing ───────────────────────────────────────────────────────────── */

let shareBlob = null;

/**
 * Offers the postable image first and the plain link second. The card is drawn
 * on the spot from current progress, so it is always the real number.
 */
async function share() {
  const p = store.progress();
  trackEvent('share_clicked', { count: p.count });

  if (!p.count) {
    showMessage({
      icon: 'share', title: 'Nothing to show yet',
      body: 'Collect a discovery or two and your London becomes something worth posting.',
      primary: { label: 'Explore the map', onClick: () => setTab('map') },
    });
    return;
  }

  const canvas = drawShareCard();
  shareBlob = await toBlob(canvas);
  const { title, sub } = epithetFor(p);

  qs('#share-body').innerHTML = `
    <img class="share-preview" src="${canvas.toDataURL('image/png')}"
         alt="Your London: ${esc(String(p.count))} discoveries found, ${(p.percent * 100).toFixed(1)}% of London uncovered, Explorer level ${p.level}. ${esc(title)}.">
    <p style="text-align:center;font-size:var(--fs-sm);color:var(--ink-500);margin-bottom:var(--sp-4)">
      <strong style="color:var(--ink)">${esc(title)}</strong><br>${esc(sub)}
    </p>
    <div class="share-actions">
      <button type="button" class="btn btn-primary btn-block" data-share="image" data-autofocus>
        ${icon('share')} Share this image
      </button>
      <button type="button" class="btn btn-secondary btn-block" data-share="save">Save image</button>
      <button type="button" class="btn btn-ghost btn-block btn-sm" data-share="link">Share a link instead</button>
    </div>`;
  sheets.share.open('full');
}

async function doShare(mode) {
  const p = store.progress();
  const text = `I have uncovered ${p.count} of London's hidden stories with London Uncovered.`;
  const url = location.href.split('#')[0].split('?')[0];

  if (mode === 'link') {
    trackEvent('share_mode', { mode: 'link' });
    try {
      if (navigator.share) await navigator.share({ title: 'London Uncovered', text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        toast({ eyebrow: 'Copied', title: 'Link copied', iconName: 'check', gold: false });
      }
    } catch { /* dismissed */ }
    return;
  }

  if (!shareBlob) return;
  const file = new File([shareBlob], 'my-london.png', { type: 'image/png' });

  if (mode === 'image' && canShareImage(file)) {
    trackEvent('share_mode', { mode: 'image' });
    try { await navigator.share({ files: [file], text, title: 'My London' }); } catch { /* dismissed */ }
    return;
  }

  // No image sharing here — hand them the file instead.
  trackEvent('share_mode', { mode: 'save' });
  const href = URL.createObjectURL(shareBlob);
  const a = document.createElement('a');
  a.href = href;
  a.download = 'my-london.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 4000);
  toast({ eyebrow: 'Saved', title: 'Image saved', desc: 'Post it wherever you like.',
          iconName: 'check', gold: false });
}

/* ── Backup links ──────────────────────────────────────────────────────── */

/**
 * Builds a link that carries the collection in the URL fragment, so it never
 * reaches a server. Opening it in another browser offers to merge it in.
 */
let backupLinkCopied = false;

function openBackup() {
  backupLinkCopied = false;
  const p = store.progress();
  const url = backupUrl(state.saved);
  const body = qs('#backup-body');

  if (!url) {
    body.innerHTML = `
      <div class="notice">
        <div class="notice-icon">${icon('bookmark')}</div>
        <div class="notice-title">Nothing to move yet</div>
        <p>Collect a discovery first, then come back for a link that carries your London to another browser.</p>
      </div>`;
    sheets.backup.open('full');
    return;
  }

  trackEvent('backup_created');
  const long = url.length > COMFORTABLE_URL_LENGTH;
  body.innerHTML = `
    <p style="font-size:var(--fs-sm);color:var(--ink-600);line-height:1.6">
      This link carries your ${fmtNumber(p.count)} ${p.count === 1 ? 'discovery' : 'discoveries'}.
      Open it in another browser — or on another device — and your collection continues from here.
    </p>
    <label class="sr-only" for="backup-url">Your backup link</label>
    <textarea class="backup-link" id="backup-url" rows="3" readonly>${esc(url)}</textarea>
    <div class="pq-actions">
      <button type="button" class="btn btn-primary" data-backup="copy" data-autofocus>${icon('check')} Copy link</button>
      ${navigator.share ? `<button type="button" class="btn btn-secondary" data-backup="share">${icon('share')} Share</button>` : ''}
    </div>
    <p class="backup-note">
      <strong>Keep it to yourself</strong> — anyone with this link can load your collection.
      Nothing is uploaded: the whole thing travels inside the link.
      ${long ? '<br><br>It is a long link, so send it somewhere that will not shorten it — email or notes rather than a chat app.' : ''}
    </p>`;
  sheets.backup.open('full');
}

async function copyBackupLink(mode) {
  const url = qs('#backup-url')?.value;
  if (!url) return;
  try {
    if (mode === 'share' && navigator.share) {
      await navigator.share({ title: 'My London Uncovered collection', url });
      backupLinkCopied = true;
      return;
    }
    await navigator.clipboard.writeText(url);
    backupLinkCopied = true;
    qs('#backup-warn')?.remove();
    toast({ eyebrow: 'Copied', title: 'Backup link copied', iconName: 'check', gold: false });
  } catch {
    // Clipboard refused (or the share sheet was dismissed) — the field is
    // selectable, so fall back to letting the user copy it by hand.
    qs('#backup-url')?.select();
  }
}

/**
 * Closing the sheet without taking the link means walking away with nothing —
 * the link is not stored anywhere and a fresh one is only reachable from here.
 * The first close attempt says so; the second lets them go.
 */
function guardBackupClose() {
  if (backupLinkCopied || !qs('#backup-url')) return true;
  if (qs('#backup-warn')) return true;                 // already warned once
  const warn = document.createElement('div');
  warn.className = 'backup-warn';
  warn.id = 'backup-warn';
  warn.innerHTML = `
    ${icon('info')}
    <div>
      <p><strong>Copy the link before you close this.</strong> It is not saved anywhere —
      without it you cannot pick this collection up in another browser.</p>
      <div class="pq-actions">
        <button type="button" class="btn btn-primary btn-sm" data-backup="copy">${icon('check')} Copy link</button>
        <button type="button" class="btn btn-secondary btn-sm" data-backup="dismiss">Close anyway</button>
      </div>
    </div>`;
  qs('#backup-body').appendChild(warn);
  warn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  return false;
}

/** A link opened on this device is offered, never applied silently. */
function offerRestore(restore) {
  const count = restore.entries.length;
  showMessage({
    icon: 'bookmark',
    title: 'Continue your collection',
    body: `This link carries ${count} ${count === 1 ? 'discovery' : 'discoveries'}. `
        + `They will be added to whatever is already saved in this browser — nothing is replaced.`,
    primary: {
      label: `Restore my ${count} ${count === 1 ? 'discovery' : 'discoveries'}`,
      onClick: () => applyRestore(restore),
    },
    secondary: { label: 'Not now', onClick: clearRestoreFromUrl },
  });
}

function applyRestore(restore) {
  const result = store.applyBackup(restore.entries);
  clearRestoreFromUrl();
  state.plaques.forEach(p => mapView.refreshMarker(p.id));
  syncUnlocks();
  syncCompletions();
  trackEvent('backup_restored');
  refresh({ rerenderSheet: true });
  announce(`Collection restored. ${result.total} discoveries.`);
  toast({
    eyebrow: 'Collection restored',
    title: result.added
      ? `${result.added} ${result.added === 1 ? 'discovery' : 'discoveries'} added`
      : 'Already up to date',
    desc: `${result.total} discoveries in this browser`,
    iconName: 'check',
    gold: false,
  });
}

/* ── Navigation helpers used by several screens ────────────────────────── */

function openCategoryOnMap(slug, { from = 'collection' } = {}) {
  if (!CATEGORY_BY_SLUG.has(slug)) return;
  state.filters.categories.clear();
  state.filters.categories.add(slug);
  state.filters.status = 'uncollected';   // show what is left to find
  clearSearch({ silent: true });
  syncChips();
  setTab('map');
  closeAllSheets();
  refresh();
  trackEvent('category_selected', { category: slug, from });
  announce(`${CATEGORY_BY_SLUG.get(slug).label} — showing uncollected discoveries.`);
}

/** Sends the map to a themed set, showing what is still to find in it. */
function openThemeOnMap(themeId) {
  const theme = state.themes.find(t => t.id === themeId);
  if (!theme) return;
  state.filters.categories.clear();
  state.filters.theme = themeId;
  state.filters.status = 'uncollected';
  state.filters.fame = 'all';
  clearSearch({ silent: true });
  syncChips();
  setTab('map');
  closeAllSheets();
  refresh();
  mapView.fitToIds([...theme.ids]);
  trackEvent('theme_selected', { theme: themeId });
  announce(`${theme.name} — showing what is left to find.`);
}

/**
 * "Start walk" — puts the whole route on the map.
 *
 * Unlike a themed collection this shows every stop, collected or not: a walk is
 * a route to follow, and hiding the ones already found would break it in half.
 */
function openWalkOnMap(walk) {
  if (!walk) return;
  clearFilters();
  state.filters.walk = walk.slug;
  clearSearch({ silent: true });
  syncChips();
  setTab('map');
  closeAllSheets();
  refresh();
  mapView.fitToIds(walk.ids);
  trackEvent('walk_started', { walk: walk.slug });
  announce(`${walk.name} — ${walk.stops.length} stops on the map.`);
}

function selectPlaque(id, { from } = {}) {
  const plaque = state.byId.get(id);
  if (!plaque) return;
  setTab('map');
  // A search selection clears the query, so re-apply filters before moving the
  // camera — otherwise the marker may still be sitting outside the layer.
  refresh();
  trackEvent('plaque_opened', { fame: plaque.fame, category: plaque.category, from: from || 'unknown' });
  mapView.focusPlaque(id, { zoom: Math.max(mapView.getMap().getZoom(), 16) });
  openPlaque(id);
}

/**
 * `?plaque=<id>` — the deep link the generated static pages point back at.
 * Runs once the dataset and markers exist, and reuses the ordinary selection
 * path so the camera move and the detail sheet behave exactly as a tap does.
 * An unknown or missing id leaves the app in its normal starting state.
 */
function openDeepLinkedPlaque() {
  const id = new URLSearchParams(location.search).get(PLAQUE_PARAM);
  if (!id || !state.byId.has(id)) return false;
  selectPlaque(id, { from: 'deep-link' });
  return true;
}

/**
 * `?walk=<slug>` — the deep link the generated static walk pages point back at.
 * Opens the walk's own screen and puts its stops on the map, so arriving from a
 * search result lands on the route rather than on the whole of London.
 */
function openDeepLinkedWalk() {
  const slug = new URLSearchParams(location.search).get(WALK_PARAM);
  const walk = slug ? walkBySlug(slug) : null;
  if (!walk) return false;
  openWalkOnMap(walk);
  setTab('walks');
  showWalk(walk.slug);
  return true;
}

/**
 * `?category=<slug>` — the deep link the generated static category pages point
 * back at. Someone arriving from a search result for "London music blue
 * plaques" lands on the music plaques rather than on all 1,001 of them.
 */
function openDeepLinkedCategory() {
  const slug = new URLSearchParams(location.search).get(CATEGORY_PARAM);
  if (!slug || !CATEGORY_BY_SLUG.has(slug)) return false;
  openCategoryOnMap(slug, { from: 'deep-link' });
  return true;
}

function questAction(action) {
  switch (action) {
    case 'find-next':        setTab('map'); findNext(); break;
    case 'filter-iconic':    state.filters.fame = 'iconic'; state.filters.status = 'uncollected';
                             setTab('map'); refresh(); break;
    case 'filter-culture':   state.filters.categories.clear();
                             ['writers', 'art', 'music', 'film-theatre'].forEach(s => state.filters.categories.add(s));
                             state.filters.status = 'uncollected';
                             syncChips(); setTab('map'); refresh(); break;
    case 'open-collections': setTab('mylondon'); showSegment('collections'); break;
    default:                 setTab('map'); break;
  }
}

/* ── Boot ──────────────────────────────────────────────────────────────── */

function bootError(err) {
  qs('#boot').innerHTML = `
    <div class="boot-card">
      <div class="notice-icon">${icon('info')}</div>
      <h2>Couldn't load London's discoveries</h2>
      <p>${esc(String(err?.message || err))}</p>
      <p style="margin-top:var(--sp-3)">If you are running this locally, serve the folder first:
        <code>python3 -m http.server 8000</code></p>
      <button type="button" class="btn btn-primary" onclick="location.reload()">Try again</button>
    </div>`;
  qs('#boot').hidden = false;
}

function wire() {
  sheets.plaque = new Sheet('#sheet-plaque', {
    onClose: () => { state.openPlaqueId = null; },
  });
  sheets.filters = new Sheet('#sheet-filters', { alwaysScrim: true });
  sheets.about = new Sheet('#sheet-about', { alwaysScrim: true });
  sheets.nearby = new Sheet('#sheet-nearby', { alwaysScrim: true });
  sheets.backup = new Sheet('#sheet-backup', { alwaysScrim: true, beforeClose: guardBackupClose });
  sheets.install = new Sheet('#sheet-install', { alwaysScrim: true });
  sheets.share = new Sheet('#sheet-share', { alwaysScrim: true });
  sheets.message = new Sheet('#sheet-message');
  initScrim();

  delegate(qs('#sheet-message'), 'click', '[data-msg]', (_e, node) => {
    const fn = node.dataset.msg === 'primary' ? sheets.message._primary : sheets.message._secondary;
    sheets.message.close();
    fn?.();
  });

  initPlaqueSheet(sheets.plaque, {
    onCollect: handleCollect,
    onUseLocation: () => useLocation({ centre: false }),
    onChooseAnother: () => findNext({ another: true }),
    onOpenCategory: openCategoryOnMap,
    onOpenWalk: slug => { setTab('walks'); showWalk(slug); },
  });

  initFilters(sheets.filters, {
    onChange: () => { syncChips(); refresh({ rerenderSheet: true }); },
    countVisible: () => mapView.visiblePlaques().length,
  });

  initSearch({
    onQuery: () => refresh(),
    onPlaque: id => selectPlaque(id, { from: 'search' }),
    onCategory: slug => { toggleCategory(slug); },
    onPlace: ids => { setTab('map'); mapView.fitToIds(ids); },
  });

  initQuestScreen(questAction);

  initWalkScreen({
    onOpenPlaque: id => selectPlaque(id, { from: 'walk' }),
    onStartWalk: openWalkOnMap,
  });

  initMyLondon({
    onOpenPlaque: id => selectPlaque(id, { from: 'my-london' }),
    onOpenCategory: openCategoryOnMap,
    onOpenTheme: openThemeOnMap,
    onGoMap: () => setTab('map'),
    onShare: share,
    onBackup: openBackup,
    onInstall: () => openInstallSheet({ manual: true }),
  });

  delegate(document, 'click', '.tab', (_e, node) => setTab(node.dataset.tab));
  delegate(qs('#chips'), 'click', '.chip', (_e, node) => toggleCategory(node.dataset.cat));
  // Every row below is an anchor to the plaque's static page. A plain click is
  // the in-app navigation it has always been; a modifier-click is left alone so
  // the browser can open the page in a new tab.
  delegate(qs('#map-panel'), 'click', '[data-panel-id]', (e, node) => {
    if (opensElsewhere(e)) return;
    e.preventDefault();
    selectPlaque(node.dataset.panelId, { from: 'panel' });
  });

  on(qs('#counter'), 'click', () => setTab('mylondon'));
  on(qs('#filters-open'), 'click', openFilters);
  on(qs('#locate'), 'click', () => useLocation());
  on(qs('#find-next'), 'click', () => findNext());
  on(qs('#map-empty-clear'), 'click', () => {
    if (state.query.trim()) clearSearch({ silent: true });
    clearFilters();
    syncChips();
    refresh();
  });
  on(qs('#about-open'), 'click', () => sheets.about.open('full'));
  on(qs('#about-close'), 'click', () => sheets.about.close());
  on(qs('#filters-close'), 'click', () => sheets.filters.close());
  on(qs('#nearby-close'), 'click', () => sheets.nearby.close());
  on(qs('#backup-close'), 'click', () => sheets.backup.close());
  on(qs('#install-close'), 'click', () => sheets.install.close());
  on(qs('#share-close'), 'click', () => sheets.share.close());
  delegate(qs('#sheet-share'), 'click', '[data-share]', (_e, node) => doShare(node.dataset.share));
  delegate(qs('#sheet-install'), 'click', '[data-install]', (_e, node) => {
    if (node.dataset.install === 'go') runInstall();
    else { trackEvent('install_dismissed'); sheets.install.close(); }
  });
  delegate(qs('#sheet-backup'), 'click', '[data-backup]', (_e, node) => {
    if (node.dataset.backup === 'dismiss') { backupLinkCopied = true; sheets.backup.close(); return; }
    copyBackupLink(node.dataset.backup);
  });
  on(qs('#nearby'), 'click', openNearby);
  delegate(qs('#sheet-nearby'), 'click', '[data-panel-id]', (e, node) => {
    if (opensElsewhere(e)) return;
    e.preventDefault();
    sheets.nearby.close();
    selectPlaque(node.dataset.panelId, { from: 'near-me' });
  });

  on(qs('#reset-progress'), 'click', () => {
    if (!window.confirm('Reset all progress? This cannot be undone.')) return;
    store.resetProgress();
    state.plaques.forEach(p => mapView.refreshMarker(p.id));
    sheets.about.close();
    refresh({ rerenderSheet: true });
    announce('Progress reset.');
  });

  on(window, 'resize', () => mapView.invalidateSize());
  on(document, 'keydown', e => {
    if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
      e.preventDefault(); qs('#search').focus();
    }
  });
}

async function boot() {
  if (booted) return;
  booted = true;
  // Derived from the progress already in localStorage, so the return-visit
  // metric needs no tracking identifier and no extra storage.
  initAnalytics({ returning: Object.keys(state.saved.collected).length > 0 });
  watchForInstallPrompt();

  try {
    const dataset = await loadPlaques();
    store.setDataset(dataset);
  } catch (err) {
    bootError(err);
    return;
  }

  state.verifyAnywhere =
    new URLSearchParams(location.search).get(VERIFY_ANYWHERE_PARAM) === VERIFY_ANYWHERE_VALUE;

  // Both best-effort: a failure costs the walks or the curated lines, nothing else.
  await loadWalks(state.byId);
  loadIconicNotes();
  mapView.initMap(selectPlaque);
  mapView.buildMarkers();
  wire();
  renderChips();
  refresh();

  // Backfill unlock dates for anyone returning with saved progress.
  syncUnlocks();
  syncCompletions();

  if (state.verifyAnywhere) setVerifyAnywhere(true);
  qs('#boot').hidden = true;

  // A restore prompt is modal and takes precedence over anything a deep link
  // would open underneath it.
  const restore = pendingRestore();
  if (restore) offerRestore(restore);
  else if (!openDeepLinkedPlaque() && !openDeepLinkedWalk()
           && !openDeepLinkedCategory()) maybeInviteLocation();
  qs('#total-count').textContent = fmtNumber(state.plaques.length);
  // Whatever the boot path settled on — a `?walk=` deep link opens the Walks
  // tab, everything else stays on the map.
  document.body.dataset.tab = state.tab;

  window.__lu = {
    state, progress: store.progress, events: recordedEvents,
    walks: allWalks,
    reset: () => { store.resetProgress(); state.plaques.forEach(p => mapView.refreshMarker(p.id)); refresh(); },
    collect: (id, verified = false) => { handleCollect(state.byId.get(id), verified); },
    open: id => selectPlaque(id, { from: 'console' }),
    verifyAnywhere: setVerifyAnywhere,
    backupUrl: () => backupUrl(state.saved),
  };
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', boot)
  : boot();
