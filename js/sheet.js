/**
 * Bottom sheet (PRD §28–30).
 *
 * Two content states — `peek` (a card over a still-usable map) and `full`.
 * Drag the grip to move between them or to dismiss. On desktop the same
 * element becomes the right-hand panel and dragging is switched off.
 */

import { qs, on } from './ui.js';

const DESKTOP = () => window.matchMedia('(min-width: 900px)').matches;
const DISMISS_PX = 76;
const EXPAND_PX = 44;

const scrim = () => qs('#scrim');
let openSheets = [];

function updateScrim() {
  const needsScrim = openSheets.some(s => s.el.dataset.state === 'full' || s.alwaysScrim);
  scrim()?.classList.toggle('on', needsScrim && !DESKTOP());
}

export class Sheet {
  /**
   * @param {string} selector
   * @param {{alwaysScrim?: boolean, onClose?: Function, onState?: Function}} options
   */
  constructor(selector, options = {}) {
    this.el = qs(selector);
    this.alwaysScrim = !!options.alwaysScrim;
    this.onClose = options.onClose;
    this.onState = options.onState;
    this.isOpen = false;
    this.lastFocus = null;
    this.el.dataset.state = 'peek';
    this.el.setAttribute('aria-hidden', 'true');
    this._bindDrag();
    on(this.el, 'keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
  }

  open(sheetState = 'peek') {
    this.lastFocus = document.activeElement;
    this.setState(sheetState);
    this.el.classList.add('open');
    this.el.removeAttribute('aria-hidden');
    this.el.removeAttribute('inert');
    if (!this.isOpen) { this.isOpen = true; openSheets.push(this); }
    updateScrim();
    // Let the transition start before pulling focus, or iOS jumps the page.
    requestAnimationFrame(() => {
      const target = this.el.querySelector('[data-autofocus]') || this.el;
      target.focus?.({ preventScroll: true });
    });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    openSheets = openSheets.filter(s => s !== this);
    this.el.classList.remove('open');
    this.el.style.transform = '';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.setAttribute('inert', '');
    updateScrim();
    this.lastFocus?.focus?.({ preventScroll: true });
    this.onClose?.();
  }

  setState(next) {
    if (this.el.dataset.state === next) return;
    this.el.dataset.state = next;
    updateScrim();
    this.onState?.(next);
    this.el.querySelector('.sheet-body')?.scrollTo({ top: 0 });
  }

  toggleState() { this.setState(this.el.dataset.state === 'full' ? 'peek' : 'full'); }
  get state() { return this.el.dataset.state; }

  _bindDrag() {
    const grip = this.el.querySelector('.sheet-grip');
    if (!grip) return;
    let startY = 0, dy = 0, dragging = false, pointerId = null;

    const start = e => {
      if (DESKTOP() || !this.isOpen) return;
      dragging = true; startY = e.clientY; dy = 0; pointerId = e.pointerId;
      grip.setPointerCapture?.(pointerId);
      this.el.classList.add('dragging');
    };
    const move = e => {
      if (!dragging) return;
      dy = e.clientY - startY;
      // Resist upward drag when already expanded.
      const shift = dy < 0 && this.el.dataset.state === 'full' ? dy / 4 : dy;
      this.el.style.transform = `translate3d(0, ${Math.max(shift, -60)}px, 0)`;
    };
    const end = () => {
      if (!dragging) return;
      dragging = false;
      this.el.classList.remove('dragging');
      this.el.style.transform = '';
      if (pointerId !== null) grip.releasePointerCapture?.(pointerId);
      pointerId = null;

      if (dy > DISMISS_PX) {
        if (this.el.dataset.state === 'full') this.setState('peek');
        else this.close();
      } else if (dy < -EXPAND_PX) {
        this.setState('full');
      }
    };

    on(grip, 'pointerdown', start);
    on(grip, 'pointermove', move);
    on(grip, 'pointerup', end);
    on(grip, 'pointercancel', end);
    on(grip, 'click', () => { if (!DESKTOP()) this.toggleState(); });
    on(grip, 'keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggleState(); }
    });
  }
}

export function closeAllSheets() {
  [...openSheets].forEach(s => s.close());
}

export function initScrim() {
  on(scrim(), 'click', () => {
    const top = openSheets[openSheets.length - 1];
    if (!top) return;
    if (top.el.dataset.state === 'full' && !top.alwaysScrim) top.setState('peek');
    else top.close();
  });
}
