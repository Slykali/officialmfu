// Keyboard, touch-swipe and mouse-drag controls mapped to game actions.
const SWIPE_MIN = 28; // px

export class Input {
  constructor(target, handlers) {
    this.h = handlers;
    this.start = null;
    this.fired = false;

    window.addEventListener('keydown', (e) => this._key(e));

    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // buttons handle their own clicks
      if (e.target instanceof Element && e.target.closest('button')) {
        this.start = null;
        return;
      }
      this.start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      this.fired = false;
    });
    target.addEventListener('pointermove', (e) => {
      if (!this.start || e.pointerId !== this.start.id || this.fired) return;
      // fire as soon as the swipe is long enough, which feels more responsive
      if (this._swipe(e.clientX - this.start.x, e.clientY - this.start.y)) this.fired = true;
    });
    const end = (e) => {
      if (!this.start || e.pointerId !== this.start.id) return;
      if (!this.fired) {
        const dx = e.clientX - this.start.x;
        const dy = e.clientY - this.start.y;
        if (!this._swipe(dx, dy) && Math.hypot(dx, dy) < SWIPE_MIN) this.h.tap?.();
      }
      this.start = null;
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', () => { this.start = null; });
    // stop the page from scrolling or zooming while playing
    target.addEventListener('touchmove', (e) => {
      // menus may need to scroll on short screens
      if (e.target instanceof Element && e.target.closest('.panel')) return;
      e.preventDefault();
    }, { passive: false });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _swipe(dx, dy) {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < SWIPE_MIN) return false;
    if (ax > ay) {
      if (dx < 0) this.h.left(); else this.h.right();
    } else if (dy < 0) this.h.up();
    else this.h.down();
    return true;
  }

  _key(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    // let a keyboard-focused button handle its own Enter/Space
    if ((k === 'Enter' || k === ' ') && e.target instanceof HTMLButtonElement) return;
    // ignore auto-repeat so holding a key doesn't fire a stream of moves
    if (e.repeat) {
      if (k.startsWith('Arrow') || k === ' ') e.preventDefault();
      return;
    }
    let handled = true;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') this.h.left();
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') this.h.right();
    else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') this.h.up();
    else if (k === 'ArrowDown' || k === 's' || k === 'S') this.h.down();
    else if (k === 'p' || k === 'P' || k === 'Escape') this.h.pause();
    else if (k === 'm' || k === 'M') this.h.mute();
    else if (k === 'Enter') this.h.confirm();
    else handled = false;
    if (handled) e.preventDefault();
  }
}
