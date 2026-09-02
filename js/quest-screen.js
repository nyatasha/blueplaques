/**
 * Quest tab (PRD §39) — answers "what should I do next?"
 *
 * Active quests first, finished ones below, so the screen always opens on
 * something to act on rather than on a scoreboard.
 */

import { evaluate as evaluateQuests } from './quests.js';
import { progress } from './state.js';
import { qs, esc, delegate } from './ui.js';
import { icon } from './icons.js';
import { trackEvent } from './analytics.js';

let handleAction = () => {};

function questCard(q) {
  return `
    <button type="button" class="quest${q.done ? ' done' : ''}" data-quest="${esc(q.id)}"
            data-action="${esc(q.action)}">
      <span class="quest-top">
        <span class="quest-icon">${icon(q.done ? 'check' : q.icon)}</span>
        <span>
          <span class="quest-name">${esc(q.name)}</span>
          <span class="quest-goal">${esc(q.goal)}</span>
        </span>
        <span class="quest-count">${q.value} / ${q.target}</span>
      </span>
      <span class="bar${q.done ? ' gold' : ''}"><i style="width:${(q.percent * 100).toFixed(0)}%"></i></span>
      <span class="quest-cta">
        ${q.done ? `${icon('check')} Complete` : `${esc(q.cta)} ${icon('arrowRight')}`}
      </span>
    </button>`;
}

export function renderQuest() {
  const quests = evaluateQuests();
  const active = quests.filter(q => !q.done);
  const done = quests.filter(q => q.done);
  const p = progress();

  qs('#quest-body').innerHTML = `
    <h1 class="screen-title">Quest</h1>
    <p class="screen-sub">${
      active.length
        ? `${active.length} ${active.length === 1 ? 'goal' : 'goals'} in progress · ${p.count} ${p.count === 1 ? 'discovery' : 'discoveries'} so far`
        : 'Every v0 quest complete. London is still full of stories.'
    }</p>

    ${active.length ? `
      <div class="section-head"><span class="eyebrow">Continue exploring</span></div>
      ${active.map(questCard).join('')}` : ''}

    ${done.length ? `
      <div class="section-head"><span class="eyebrow">Completed</span>
        <span class="level-xp">${done.length} / ${quests.length}</span></div>
      ${done.map(questCard).join('')}` : ''}`;
}

export function initQuestScreen(onAction) {
  handleAction = onAction;
  delegate(qs('#quest-body'), 'click', '.quest', (_e, node) => {
    trackEvent('quest_opened', { quest: node.dataset.quest });
    handleAction(node.dataset.action, node.dataset.quest);
  });
}
