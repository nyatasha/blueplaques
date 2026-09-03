/**
 * Analytics — provider-agnostic `trackEvent()` over GoatCounter.
 *
 * ── WHY GOATCOUNTER ──────────────────────────────────────────────────────
 * It stores nothing on the visitor's device: no cookies, no localStorage, no
 * fingerprint. Under UK PECR that means no consent banner, which matters here
 * because the headline metric is *what share of arrivals collect a plaque* —
 * a consent dialog in front of the map would depress the very number this is
 * measuring, and would only ever report on the subset who accepted.
 *
 * ── CONFIGURATION POINT ──────────────────────────────────────────────────
 * ENDPOINT is the only line tying this project to a provider. Set it to '' to
 * switch analytics off entirely; swap `send()` to move to another provider.
 * No other module knows which service is in use.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * GoatCounter has no structured event properties — an event is a path. So the
 * dimensions that matter are folded into the path (`collect/verified`,
 * `category/music`), and everything else is deliberately dropped rather than
 * fragmenting the dashboard. See docs/analytics-plan.md for the taxonomy and
 * how each success metric is derived.
 *
 * Nothing sent from here can locate anyone: no coordinates, no addresses, no
 * plaque ids, no identifiers of any kind (PRD §62, §64).
 */

const ENDPOINT = 'https://nyatasha.goatcounter.com/count';
const SCRIPT_SRC = 'https://gc.zgo.at/count.js';

/** Event name → GoatCounter path + human-readable title. */
function describe(name, props = {}) {
  switch (name) {
    // Return signal: derived from the game progress already in localStorage,
    // so it needs no identifier and no additional storage.
    case 'page_view':
      return props.returning
        ? ['visit/returning', 'Visit · returning with progress']
        : ['visit/new', 'Visit · new'];

    // Activation and strong activation. Announced by the app as thresholds are
    // crossed, so the provider never has to aggregate per visitor.
    case 'milestone':
      return [`milestone/${props.count}`, `Milestone · ${props.count} discoveries`];

    case 'discovery_collected':
      return props.verified
        ? ['collect/verified', 'Discovery collected · verified on location']
        : ['collect/seen', 'Discovery collected · marked as seen'];

    case 'find_next_clicked':
      return props.another
        ? ['find-next/another', 'Find next · choose another']
        : ['find-next', 'Find my next discovery'];

    case 'location_invite_shown':    return ['location/invited',  'Location invitation shown'];
    case 'location_invite_accepted': return ['location/accepted',  'Location invitation accepted'];
    case 'location_invite_declined': return ['location/declined',  'Location invitation declined'];
    case 'location_requested': return ['location/requested', 'Location requested'];
    case 'location_granted':   return ['location/granted',   'Location granted'];
    case 'location_denied':    return ['location/denied',    'Location denied'];
    case 'near_me_used':       return ['near-me',            'Near me opened'];

    case 'category_selected':  return [`category/${props.category}`, `Category · ${props.category}`];
    case 'search_used':        return [`search/${props.kind}`, `Search · ${props.kind}`];
    case 'filter_applied':     return [`filter/${props.group}`, `Filter · ${props.group}`];

    case 'plaque_opened':      return ['plaque-open',  'Discovery opened'];
    case 'collect_clicked':    return ['collect-tap',  'Collect tapped'];
    case 'directions_clicked': return ['directions',   'Directions opened'];
    case 'wikipedia_clicked':  return ['wikipedia',    'Wikipedia opened'];

    case 'quest_opened':       return ['quest/open', 'Quest opened'];
    case 'quest_completed':    return [`quest/done/${props.quest}`, `Quest complete · ${props.quest}`];
    case 'achievement_unlocked': return [`achievement/${props.achievement}`, `Achievement · ${props.achievement}`];
    case 'my_london_opened':   return ['my-london', 'My London opened'];
    case 'share_clicked':      return ['share',     'Share tapped'];

    case 'install_prompt_shown': return [props.manual ? 'install/opened' : 'install/offered',
                                        props.manual ? 'Home Screen opened from My London' : 'Home Screen offered'];
    case 'install_outcome':      return [`install/${props.outcome}`, `Home Screen ${props.outcome}`];
    case 'install_dismissed':    return ['install/dismissed', 'Home Screen dismissed'];

    case 'backup_created':     return ['backup/created',  'Backup link created'];
    case 'backup_restored':    return ['backup/restored', 'Backup restored'];

    default:                   return [name.replace(/_/g, '-'), name];
  }
}

/* ── Transport ──────────────────────────────────────────────────────────── */

const buffer = [];
const MAX_BUFFER = 300;
const queue = [];
let ready = false;

function flush() {
  while (queue.length) {
    const [path, title] = queue.shift();
    try {
      window.goatcounter.count({ path, title, event: true });
    } catch { /* a blocked or failed beacon must never break the app */ }
  }
}

function send(path, title) {
  if (!ENDPOINT) return;
  queue.push([path, title]);
  if (ready && window.goatcounter?.count) flush();
}

function loadScript(allowLocal) {
  window.goatcounter = { ...(window.goatcounter || {}), allow_local: allowLocal };
  const script = document.createElement('script');
  script.async = true;
  script.src = SCRIPT_SRC;
  script.dataset.goatcounter = ENDPOINT;
  script.addEventListener('load', () => { ready = true; flush(); });
  script.addEventListener('error', () => {
    console.info('[London Uncovered] Analytics blocked or unavailable — the app is unaffected.');
  });
  document.head.appendChild(script);
}

/**
 * @param {{returning: boolean}} visit  computed from saved progress, so the
 * return-visit metric works without any tracking identifier.
 */
export function initAnalytics(visit = {}) {
  if (ENDPOINT) {
    // GoatCounter ignores localhost by default. `?gc=local` opts in so the
    // integration can be verified before deploying.
    const allowLocal = new URLSearchParams(location.search).get('gc') === 'local';
    loadScript(allowLocal);
  }
  trackEvent('page_view', visit);
}

/**
 * Record a product event.
 *
 * Callers pass categorical properties only — fame tier, category slug,
 * verified true/false, counts. Never coordinates, never free text.
 */
export function trackEvent(name, properties = {}) {
  const [path, title] = describe(name, properties);
  buffer.push({ name, properties, path, at: Date.now() });
  if (buffer.length > MAX_BUFFER) buffer.shift();
  send(path, title);
}

/** Development helper — surfaced on window.__lu in app.js. */
export function recordedEvents() { return buffer.slice(); }
