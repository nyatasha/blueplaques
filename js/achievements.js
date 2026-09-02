/**
 * Achievement definitions and evaluation (PRD §49).
 *
 * Unlocked-ness is *derived* from collection progress every time it is read.
 * `saved.unlockedAchievements` only stores the date an achievement was first
 * seen unlocked, for display — so if collection state and stored state ever
 * disagree, collection state wins (PRD §75).
 */

import { CULTURE_CATEGORIES } from './config.js';
import { state, progress, markUnlocked } from './state.js';

const found = (p, slug) => p.categories.find(c => c.slug === slug)?.found || 0;

export const ACHIEVEMENTS = [
  { id: 'first_find',    group: 'Discovery',  name: 'First Find',      desc: 'Collect your first discovery.',          icon: 'bookmark', goal: 1,  value: p => p.count },
  { id: 'getting_started',group:'Discovery',  name: 'Getting Started', desc: 'Collect 5 discoveries.',                 icon: 'footsteps',goal: 5,  value: p => p.count },
  { id: 'city_explorer', group: 'Discovery',  name: 'City Explorer',   desc: 'Collect 10 discoveries.',                icon: 'compass',  goal: 10, value: p => p.count },
  { id: 'london_curious',group: 'Discovery',  name: 'London Curious',  desc: 'Collect 25 discoveries.',                icon: 'map',      goal: 25, value: p => p.count },

  { id: 'icon_spotter',  group: 'Fame',       name: 'Icon Spotter',    desc: 'Collect your first Iconic discovery.',   icon: 'star',   goal: 1, gold: true, value: p => p.iconic },
  { id: 'icon_hunter',   group: 'Fame',       name: 'Icon Hunter',     desc: 'Collect 5 Iconic discoveries.',          icon: 'trophy', goal: 5, gold: true, value: p => p.iconic },

  { id: 'bookworm',      group: 'Categories', name: 'Bookworm',        desc: 'Collect 5 Writers & Literature discoveries.', icon: 'book',   goal: 5, value: p => found(p, 'writers') },
  { id: 'art_lover',     group: 'Categories', name: 'Art Lover',       desc: 'Collect 5 Art & Design discoveries.',         icon: 'palette',goal: 5, value: p => found(p, 'art') },
  { id: 'curious_mind',  group: 'Categories', name: 'Curious Mind',    desc: 'Collect 5 Science & Technology discoveries.', icon: 'atom',   goal: 5, value: p => found(p, 'science') },
  { id: 'stage_door',    group: 'Categories', name: 'Stage Door',      desc: 'Collect 5 Film & Theatre discoveries.',       icon: 'masks',  goal: 5, value: p => found(p, 'film-theatre') },

  { id: 'renaissance',   group: 'Variety',    name: 'Renaissance Londoner', desc: 'Collect from 5 different categories.',   icon: 'layers', goal: 5, gold: true, value: p => p.categoriesWithAny },
  { id: 'culture_club',  group: 'Variety',    name: 'Culture Club',    desc: 'Collect 10 discoveries across the arts.',     icon: 'sparkle',goal: 10,
    value: p => CULTURE_CATEGORIES.reduce((sum, slug) => sum + found(p, slug), 0) },
];

/** Current state of every achievement, newest-unlocked information included. */
export function evaluate() {
  const p = progress();
  return ACHIEVEMENTS.map(a => {
    const value = Math.min(a.value(p), a.goal);
    const unlocked = value >= a.goal;
    return {
      ...a,
      value,
      unlocked,
      percent: a.goal ? value / a.goal : 0,
      unlockedAt: unlocked ? state.saved.unlockedAchievements[a.id] || null : null,
    };
  });
}

/**
 * Records unlock dates for anything newly satisfied and returns just those,
 * so the caller can raise a toast. Safe to call on every collect and on boot.
 */
export function syncUnlocks() {
  const newly = [];
  for (const a of evaluate()) {
    if (a.unlocked && markUnlocked('achievement', a.id)) newly.push(a);
  }
  return newly;
}

export const unlockedCount = () => evaluate().filter(a => a.unlocked).length;
