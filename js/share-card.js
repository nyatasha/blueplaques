/**
 * The shareable progress card.
 *
 * A URL is a weak thing to post. This renders a 1080×1350 image — Instagram's
 * portrait ratio — carrying the numbers someone has actually earned: how much
 * of London they have uncovered, their level, the set they are strongest in,
 * their latest achievements, and a dot for every plaque on the map with theirs
 * filled in. The dot field is the point: it is visibly *their* London, and no
 * two are alike.
 *
 * Drawn on a canvas in the browser. Nothing is uploaded and no server renders
 * anything, which keeps it inside PRD §52's "no server-generated share images".
 */

import { CATEGORIES } from './config.js';
import { state, progress } from './state.js';
import { evaluate as evaluateAchievements } from './achievements.js';

const W = 1080, H = 1350;

const IVORY = '#F7F5F0';
const INK = '#14202B';
const INK_SOFT = '#67717B';
const BLUE = '#1456A0';
const BLUE_PALE = '#D8E3F1';
const GOLD = '#B99652';
const GOLD_DEEP = '#8A6C2B';

const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/**
 * A true, flattering epithet drawn from where someone actually spends their
 * time. Falls back to something honest rather than something grand.
 */
const EPITHETS = {
  writers: 'Literary Londoner',
  art: 'An Eye for Art',
  science: 'A Curious Mind',
  'film-theatre': 'Stage Door Regular',
  music: 'Collector of Sound',
  politics: 'Student of the City',
  architecture: 'Reader of Buildings',
  sport: 'A Sporting Sort',
  other: 'London Wanderer',
};

export function epithetFor(p) {
  const best = [...p.categories].filter(c => c.found > 0)
    .sort((a, b) => b.found - a.found || b.percent - a.percent)[0];
  if (!best) return { title: 'Just Beginning', sub: 'London is still ahead of you' };
  return {
    title: EPITHETS[best.slug] || 'London Explorer',
    sub: `${best.label} · ${best.found} of ${best.total}`,
  };
}

/* ── Drawing helpers ────────────────────────────────────────────────────── */

function text(ctx, str, x, y, { font, fill, align = 'center' }) {
  ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, x, y);
}

function disc(ctx, cx, cy, r, fill, ring, ringWidth) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (ring) {
    ctx.beginPath();
    ctx.arc(cx, cy, r - ringWidth, 0, Math.PI * 2);
    ctx.strokeStyle = ring;
    ctx.lineWidth = ringWidth;
    ctx.stroke();
  }
}

/**
 * One dot per plaque on the map, filled where it has been collected.
 * The column count is solved for the space available rather than fixed, so the
 * field always fits its box whatever the dataset size.
 */
function dotField(ctx, x, y, width, maxHeight, collectedIds) {
  const plaques = state.plaques;
  // rows * (width / cols) <= maxHeight, with rows ≈ n / cols
  const cols = Math.ceil(Math.sqrt((plaques.length * width) / maxHeight));
  const rows = Math.ceil(plaques.length / cols);
  const pitch = width / cols;
  const r = pitch * 0.3;

  plaques.forEach((plaque, i) => {
    const cx = x + (i % cols) * pitch + pitch / 2;
    const cy = y + Math.floor(i / cols) * pitch + pitch / 2;
    const got = collectedIds.has(plaque.id);
    ctx.beginPath();
    ctx.arc(cx, cy, got ? r * 1.35 : r, 0, Math.PI * 2);
    ctx.fillStyle = got ? (plaque.fame >= 3 ? GOLD : BLUE) : BLUE_PALE;
    ctx.fill();
  });
  return rows * pitch;
}

/* ── The card ───────────────────────────────────────────────────────────── */

export function drawShareCard() {
  const p = progress();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = IVORY;
  ctx.fillRect(0, 0, W, H);

  // Masthead
  disc(ctx, 92, 96, 26, BLUE, 'rgba(255,255,255,.9)', 5);
  text(ctx, 'LONDON UNCOVERED', 132, 106,
       { font: `600 26px ${SANS}`, fill: INK_SOFT, align: 'left' });

  // The number they came for
  text(ctx, String(p.count), W / 2, 360, { font: `600 208px ${SERIF}`, fill: INK });
  text(ctx, p.count === 1 ? 'discovery found' : 'discoveries found', W / 2, 412,
       { font: `400 34px ${SANS}`, fill: INK_SOFT });

  // Supporting figures
  const stats = [
    [`${(p.percent * 100).toFixed(p.percent < 0.1 ? 1 : 0)}%`, 'of London'],
    [`${p.level}`, 'Explorer level'],
    [`${p.iconic}`, p.iconic === 1 ? 'icon found' : 'icons found'],
  ];
  stats.forEach(([value, label], i) => {
    const x = W / 2 + (i - 1) * 300;
    text(ctx, value, x, 520, { font: `600 66px ${SERIF}`, fill: i === 2 ? GOLD_DEEP : INK });
    text(ctx, label, x, 562, { font: `400 25px ${SANS}`, fill: INK_SOFT });
  });

  // Rule
  ctx.fillStyle = GOLD;
  ctx.fillRect(W / 2 - 40, 622, 80, 4);

  // The epithet — what their collection says about them
  const { title, sub } = epithetFor(p);
  text(ctx, title.toUpperCase(), W / 2, 700, { font: `600 46px ${SERIF}`, fill: BLUE });
  text(ctx, sub, W / 2, 744, { font: `400 27px ${SANS}`, fill: INK_SOFT });

  // Latest achievements
  const unlocked = evaluateAchievements().filter(a => a.unlocked).slice(-3);
  if (unlocked.length) {
    text(ctx, 'UNLOCKED', W / 2, 828, { font: `600 22px ${SANS}`, fill: INK_SOFT });
    unlocked.forEach((a, i) => {
      const y = 884 + i * 52;
      disc(ctx, W / 2 - 210, y - 12, 13, a.gold ? GOLD : BLUE);
      text(ctx, a.name, W / 2 - 180, y, { font: `500 34px ${SANS}`, fill: INK, align: 'left' });
    });
  }

  // Every plaque on the map, theirs filled in
  const collectedIds = new Set(Object.keys(state.saved.collected));
  const fieldTop = unlocked.length ? 1032 : 912;
  const fieldBottom = H - 96;
  dotField(ctx, 80, fieldTop, W - 160, fieldBottom - fieldTop, collectedIds);

  text(ctx, 'nyatasha.github.io/blueplaques', W / 2, H - 44,
       { font: `400 26px ${SANS}`, fill: INK_SOFT });

  return canvas;
}

export const toBlob = canvas =>
  new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.92));

/** True when the browser can put an actual image into the share sheet. */
export function canShareImage(file) {
  return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
}
