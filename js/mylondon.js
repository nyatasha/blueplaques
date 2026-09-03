/**
 * My London (PRD §42–51) — the reward screen.
 *
 * Three segments: Overview (hero numbers, level, recent finds, next-nearest
 * collection), Collections (one card per category) and Achievements (a badge
 * grid). All three are pure functions of derived progress.
 */

import { progress, state } from './state.js';
import { evaluate as evaluateAchievements } from './achievements.js';
import { qs, esc, delegate, fmtNumber, fmtDate, thumbUrl } from './ui.js';
import { icon, CATEGORY_ICON } from './icons.js';

let segment = 'overview';
let handlers = {};

const pct = value => `${(value * 100).toFixed(value < 0.1 && value > 0 ? 1 : 0)}%`;

/* ── Overview ──────────────────────────────────────────────────────────── */

function overview(p) {
  const achievements = evaluateAchievements();
  const unlocked = achievements.filter(a => a.unlocked);
  const latest = unlocked[unlocked.length - 1];
  const almost = p.categories
    .filter(c => c.found > 0 && c.found < c.total)
    .sort((a, b) => b.found - a.found)[0];

  if (!p.count) {
    return `
      <div class="notice">
        <div class="notice-icon">${icon('bookmark')}</div>
        <div class="notice-title">Nothing uncovered yet</div>
        <p>Open the map, find a plaque you have walked past — or one you have not — and collect your first discovery.</p>
        <button type="button" class="btn btn-primary" data-act="go-map">${icon('map')} Explore the map</button>
      </div>`;
  }

  return `
    <div class="hero-stats">
      <div class="hero-stat">
        <span class="hero-num">${fmtNumber(p.count)}</span>
        <span class="hero-label">discoveries found</span>
      </div>
      <div class="hero-stat gold">
        <span class="hero-num">${pct(p.percent)}</span>
        <span class="hero-label">of London uncovered</span>
      </div>
    </div>

    <div class="level-card">
      <div class="level-top">
        <span class="level-name">Explorer · Level ${p.level}</span>
        <span class="level-xp">${fmtNumber(p.xp)} XP</span>
      </div>
      <div class="bar"><i style="width:${((p.xpIntoLevel / p.xpForNextLevel) * 100).toFixed(1)}%"></i></div>
      <div class="level-next">${fmtNumber(p.xpToNextLevel)} XP to Level ${p.level + 1}</div>
    </div>

    <div class="section-head">
      <span class="eyebrow">Recent discoveries</span>
      ${p.verified ? `<span class="level-xp">${p.verified} verified</span>` : ''}
    </div>
    <div class="card" style="padding:var(--sp-2) var(--sp-5)">
      <div class="recent">
        ${p.recent.slice(0, 5).map(({ plaque, entry }) => `
          <button type="button" class="recent-item" data-act="open-plaque" data-id="${esc(plaque.id)}">
            ${plaque.photo
              ? `<img class="recent-thumb" src="${esc(thumbUrl(plaque.photo, 120))}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
              : `<span class="recent-thumb" aria-hidden="true"></span>`}
            <span class="recent-main">
              <span class="recent-name">${esc(plaque.title)}</span>
              <span class="recent-sub">${esc(plaque.categoryLabel)}<span class="dotsep">·</span>${esc(fmtDate(entry.collectedAt))}</span>
            </span>
            ${entry.verified ? `<span class="badge badge-verified">${icon('shield')}</span>` : ''}
            ${icon('chevronR')}
          </button>`).join('')}
      </div>
    </div>

    ${almost ? `
      <div class="section-head"><span class="eyebrow">Almost there</span></div>
      <button type="button" class="collection" data-act="open-category" data-cat="${esc(almost.slug)}">
        <div class="collection-name">${esc(almost.label)}</div>
        <div class="collection-count"><b>${almost.found}</b> / ${fmtNumber(almost.total)} discovered</div>
        <div class="bar"><i style="width:${(almost.percent * 100).toFixed(1)}%"></i></div>
        <div class="collection-go">Continue exploring ${icon('arrowRight')}</div>
      </button>` : ''}

    ${latest ? `
      <div class="section-head"><span class="eyebrow">Latest achievement</span></div>
      <button type="button" class="quest done" data-act="go-achievements">
        <span class="quest-top">
          <span class="quest-icon">${icon(latest.icon)}</span>
          <span>
            <span class="quest-name">Unlocked${latest.unlockedAt ? ` · ${esc(fmtDate(latest.unlockedAt))}` : ''}</span>
            <span class="quest-goal">${esc(latest.name)}</span>
          </span>
        </span>
        <span class="quest-cta">See all achievements ${icon('arrowRight')}</span>
      </button>` : ''}

    <div class="section-head"><span class="eyebrow">Your collection</span></div>
    <button type="button" class="btn btn-secondary btn-block" data-act="share">
      ${icon('share')} Share your London
    </button>
    <button type="button" class="btn btn-ghost btn-block btn-sm" data-act="backup"
            style="margin-top:var(--sp-2)">
      ${icon('refresh')} Move to another browser
    </button>
    <button type="button" class="btn btn-ghost btn-block btn-sm" data-act="install"
            style="margin-top:var(--sp-2)">
      ${icon('bookmark')} Add to Home Screen
    </button>
    <p class="backup-note" style="text-align:center">
      Saved in this browser only. Adding London Uncovered to your Home Screen —
      or taking a backup link — keeps your collection safe.
    </p>`;
}

/* ── Collections ───────────────────────────────────────────────────────── */

function collections(p) {
  const sorted = [...p.categories].filter(c => c.total > 0)
    .sort((a, b) => b.found - a.found || b.total - a.total);

  const themes = `
    <div class="section-head" style="margin-top:0">
      <span class="eyebrow">Themed collections</span>
      <span class="level-xp">${p.themes.filter(t => t.found > 0).length} / ${p.themes.length} started</span>
    </div>
    <div class="collections" style="margin-bottom:var(--sp-8)">
      ${p.themes.map(t => `
        <button type="button" class="collection${t.found === t.total ? ' complete' : ''}${t.gold ? ' gold' : ''}"
                data-act="open-theme" data-theme="${esc(t.id)}">
          <div style="display:flex;align-items:center;gap:var(--sp-3)">
            <span class="collection-chip${t.gold ? ' gold' : ''}">${icon(t.icon)}</span>
            ${t.found === t.total ? `<span class="badge badge-iconic" style="margin-bottom:var(--sp-3)">${icon('star')} Complete</span>` : ''}
          </div>
          <div class="collection-name">${esc(t.name)}</div>
          <div class="collection-count"><b>${t.found}</b> / ${fmtNumber(t.total)} discovered</div>
          <div class="bar${t.found === t.total ? ' gold' : ''}"><i style="width:${(t.percent * 100).toFixed(1)}%"></i></div>
          <div class="collection-names">${esc(t.tagline)}</div>
          <div class="collection-go">${t.found ? 'Continue' : 'Start'} this set ${icon('arrowRight')}</div>
        </button>`).join('')}
    </div>

    <div class="section-head"><span class="eyebrow">By category</span></div>`;

  return themes + `<div class="collections">${sorted.map(c => {
    const names = (state.byCategory.get(c.slug) || [])
      .filter(pl => pl.fame >= 2).slice(0, 3)
      .map(pl => pl.title.split(' ').pop()).join(' · ');
    return `
      <button type="button" class="collection${c.found === c.total ? ' complete' : ''}"
              data-act="open-category" data-cat="${esc(c.slug)}">
        <div style="display:flex;align-items:center;gap:var(--sp-3)">
          <span class="collection-chip">${icon(CATEGORY_ICON[c.slug])}</span>
          ${c.found === c.total ? `<span class="badge badge-iconic" style="margin-bottom:var(--sp-3)">${icon('star')} Complete</span>` : ''}
        </div>
        <div class="collection-name">${esc(c.label)}</div>
        <div class="collection-count"><b>${c.found}</b> / ${fmtNumber(c.total)} discovered</div>
        <div class="bar${c.found === c.total ? ' gold' : ''}"><i style="width:${(c.percent * 100).toFixed(1)}%"></i></div>
        ${names ? `<div class="collection-names">${esc(names)}</div>` : ''}
        <div class="collection-go">${c.found ? 'Continue exploring' : 'Start exploring'} ${icon('arrowRight')}</div>
      </button>`;
  }).join('')}</div>`;
}

/* ── Achievements ──────────────────────────────────────────────────────── */

function achievements() {
  const all = evaluateAchievements();
  const unlocked = all.filter(a => a.unlocked).length;
  return `
    <div class="section-head" style="margin-top:0">
      <span class="eyebrow">${unlocked} of ${all.length} unlocked</span>
    </div>
    <div class="ach-grid">
      ${all.map(a => `
        <div class="ach ${a.unlocked ? 'unlocked' : 'locked'}${a.gold ? ' gold' : ''}">
          <div class="ach-badge">${icon(a.unlocked ? a.icon : 'lock')}</div>
          <div class="ach-name">${esc(a.name)}</div>
          <div class="ach-desc">${esc(a.desc)}</div>
          ${a.unlocked
            ? `<div class="ach-when">${a.unlockedAt ? esc(fmtDate(a.unlockedAt)) : 'Unlocked'}</div>`
            : `<div class="bar"><i style="width:${(a.percent * 100).toFixed(0)}%"></i></div>
               <div class="ach-when">${a.value} / ${a.goal}</div>`}
        </div>`).join('')}
    </div>`;
}

/* ── Shell ─────────────────────────────────────────────────────────────── */

export function renderMyLondon() {
  const p = progress();
  const body = segment === 'overview' ? overview(p)
             : segment === 'collections' ? collections(p)
             : achievements();

  qs('#mylondon-body').innerHTML = `
    <h1 class="screen-title">My London</h1>
    <p class="screen-sub">Everything you have uncovered so far.</p>
    <div class="segmented" role="tablist" aria-label="My London sections">
      ${['overview', 'collections', 'achievements'].map(key => `
        <button type="button" role="tab" data-seg="${key}"
                aria-selected="${segment === key}">${key[0].toUpperCase()}${key.slice(1)}</button>`).join('')}
    </div>
    <div role="tabpanel">${body}</div>`;
}

export function showSegment(next) {
  segment = next;
  renderMyLondon();
}

export function initMyLondon(handlerMap) {
  handlers = handlerMap;
  const root = qs('#mylondon-body');

  delegate(root, 'click', '[data-seg]', (_e, node) => showSegment(node.dataset.seg));

  delegate(root, 'click', '[data-act]', (_e, node) => {
    switch (node.dataset.act) {
      case 'open-plaque':    handlers.onOpenPlaque(node.dataset.id); break;
      case 'open-category':  handlers.onOpenCategory(node.dataset.cat); break;
      case 'open-theme':     handlers.onOpenTheme(node.dataset.theme); break;
      case 'go-map':         handlers.onGoMap(); break;
      case 'go-achievements':showSegment('achievements'); break;
      case 'share':          handlers.onShare(); break;
      case 'backup':         handlers.onBackup(); break;
      case 'install':        handlers.onInstall(); break;
      default: break;
    }
  });
}

export const currentSegment = () => segment;
