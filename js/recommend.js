/**
 * "Find my next discovery" (PRD §23–24).
 *
 * Deterministic scoring, no randomness: distance 60%, fame 25%, context 15%.
 * Context rewards a plaque that matches the active category filter, or — when
 * no filter is set — one from a category the player has been finding less of,
 * so repeated taps do not march through the same theme.
 */

import { RECOMMEND } from './config.js';
import { state, isCollected, progress } from './state.js';
import { distanceMetres } from './geo.js';

function contextScore(plaque, activeCategories, categoryShare) {
  if (activeCategories.size) return activeCategories.has(plaque.category) ? 1 : 0;
  // Favour under-explored categories: share of 0 scores 1, the most-collected
  // category scores 0.
  return 1 - (categoryShare.get(plaque.category) ?? 0);
}

/**
 * @returns {{plaque, distance, score}|null} the next target, or null when
 * nothing sensible is nearby.
 */
export function recommendNext({ excludeIds = [] } = {}) {
  const origin = state.userPos;
  if (!origin) return null;

  const p = progress();
  const maxInAnyCategory = Math.max(1, ...p.categories.map(c => c.found));
  const categoryShare = new Map(p.categories.map(c => [c.slug, c.found / maxInAnyCategory]));

  const activeCategories = state.filters.categories;
  const skip = new Set(excludeIds);

  const consider = (radius) => {
    let best = null;
    for (const plaque of state.plaques) {
      if (isCollected(plaque.id) || skip.has(plaque.id)) continue;
      if (activeCategories.size && !activeCategories.has(plaque.category)) continue;

      const distance = distanceMetres(origin, plaque);
      if (distance > radius) continue;

      const dScore = 1 - Math.min(distance, RECOMMEND.idealRadiusM) / RECOMMEND.idealRadiusM;
      const fScore = plaque.fame / 3;
      const cScore = contextScore(plaque, activeCategories, categoryShare);
      const score = dScore * RECOMMEND.distanceWeight
                  + fScore * RECOMMEND.fameWeight
                  + cScore * RECOMMEND.contextWeight;

      // Ties broken by id so the same input always yields the same output.
      if (!best || score > best.score ||
          (score === best.score && plaque.id < best.plaque.id)) {
        best = { plaque, distance, score };
      }
    }
    return best;
  };

  // Prefer something within a comfortable walk; widen only if nothing is close.
  return consider(RECOMMEND.idealRadiusM) || consider(RECOMMEND.fallbackRadiusM);
}

/** Uncollected plaques ordered by distance — used by "Near me" listings. */
export function nearest(limit = 20) {
  const origin = state.userPos;
  if (!origin) return [];
  return state.plaques
    .filter(pl => !isCollected(pl.id))
    .map(plaque => ({ plaque, distance: distanceMetres(origin, plaque) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}
