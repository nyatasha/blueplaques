/**
 * The fixed v0 quest set (PRD §40). Deliberately not a quest-authoring engine:
 * five hand-written goals, each derived from collection progress.
 *
 * `action` names what tapping the quest should do; app.js maps those names to
 * behaviour so this module stays free of DOM and map concerns.
 */

import { CULTURE_CATEGORIES } from './config.js';
import { state, progress, markUnlocked } from './state.js';

const found = (p, slug) => p.categories.find(c => c.slug === slug)?.found || 0;

export const QUESTS = [
  {
    id: 'first_steps', name: 'First Steps', icon: 'footsteps',
    goal: 'Collect 3 discoveries', target: 3,
    value: p => p.count,
    cta: 'Continue', action: 'open-map',
  },
  {
    id: 'local_explorer', name: 'Local Explorer', icon: 'locate',
    goal: 'Make a verified discovery where you stand', target: 1,
    value: p => p.verified,
    cta: 'Find one near me', action: 'find-next',
  },
  {
    id: 'icon_hunter', name: 'Icon Hunter', icon: 'star',
    goal: 'Find an Iconic Londoner', target: 1,
    value: p => p.iconic,
    cta: 'Show iconic plaques', action: 'filter-iconic',
  },
  {
    id: 'curious_london', name: 'Curious London', icon: 'layers',
    goal: 'Collect from 3 different categories', target: 3,
    value: p => p.categoriesWithAny,
    cta: 'Explore categories', action: 'open-collections',
  },
  {
    id: 'culture_collector', name: 'Culture Collector', icon: 'masks',
    goal: 'Collect 5 discoveries from the arts', target: 5,
    value: p => CULTURE_CATEGORIES.reduce((sum, slug) => sum + found(p, slug), 0),
    cta: 'Explore the arts', action: 'filter-culture',
  },
];

export function evaluate() {
  const p = progress();
  return QUESTS.map(q => {
    const value = Math.min(q.value(p), q.target);
    const done = value >= q.target;
    return {
      ...q, value, done,
      percent: q.target ? value / q.target : 0,
      completedAt: done ? state.saved.completedQuests[q.id] || null : null,
    };
  });
}

export function syncCompletions() {
  const newly = [];
  for (const q of evaluate()) {
    if (q.done && markUnlocked('quest', q.id)) newly.push(q);
  }
  return newly;
}

/** True when at least one quest is finishable-looking — drives the tab dot. */
export function hasActionableQuest() {
  return evaluate().some(q => !q.done);
}
