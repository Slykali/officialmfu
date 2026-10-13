// DOM overlay: menus, HUD, toasts.
import { POWER_TYPES } from './config.js';
import { powerTexture } from './textures.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(handlers) {
    this.el = {
      hud: $('hud'), score: $('score'), coins: $('coinCount'), mult: $('mult'), powers: $('powers'),
      menu: $('menu'), pause: $('pauseScreen'), over: $('over'), countdown: $('countdown'),
      bestMenu: $('bestMenu'), bankMenu: $('bankMenu'), toast: $('toast'), flash: $('flash'),
      overScore: $('overScore'), overCoins: $('overCoins'), overBest: $('overBest'),
      overDist: $('overDist'), overCause: $('overCause'), newBest: $('newBest'), mute: $('muteBtn'),
    };
    const bind = (id, fn) => {
      $(id).addEventListener('click', (e) => {
        e.stopPropagation();
        e.currentTarget.blur(); // keep keyboard focus off buttons
        fn();
      });
    };
    bind('playBtn', handlers.play);
    bind('againBtn', handlers.play);
    bind('resumeBtn', handlers.resume);
    bind('quitBtn', handlers.menu);
    bind('menuBtn', handlers.menu);
    bind('pauseBtn', handlers.pause);
    bind('muteBtn', handlers.mute);

    // power-up icons for the HUD
    this.icons = {};
    for (const p of POWER_TYPES) {
      try {
        this.icons[p] = powerTexture(p).image.toDataURL();
      } catch (e) {
        this.icons[p] = '';
      }
    }
    this.powerRows = {};
    this.last = { score: -1, coins: -1, mult: -1 };
    this.toastTimer = null;
  }

  _only(screen) {
    for (const k of ['menu', 'pause', 'over']) this.el[k].classList.toggle('hidden', k !== screen);
    this.el.countdown.classList.add('hidden');
  }

  showMenu(best, bank) {
    this._only('menu');
    this.el.hud.classList.add('hidden');
    this.el.bestMenu.textContent = best.toLocaleString();
    this.el.bankMenu.textContent = bank.toLocaleString();
  }

  showHud() {
    this._only(null);
    this.el.hud.classList.remove('hidden');
  }

  showPause() {
    this._only('pause');
  }

  showCountdown(n) {
    this._only(null);
    this.el.countdown.classList.remove('hidden');
    if (this.el.countdown.textContent !== String(n)) this.el.countdown.textContent = String(n);
  }

  showOver(r) {
    this._only('over');
    this.el.hud.classList.add('hidden');
    this.el.overScore.textContent = r.score.toLocaleString();
    this.el.overCoins.textContent = r.coins.toLocaleString();
    this.el.overBest.textContent = r.best.toLocaleString();
    this.el.overDist.textContent = `${r.distance.toLocaleString()} m`;
    this.el.overCause.textContent = r.cause;
    this.el.newBest.classList.toggle('hidden', !r.newBest);
  }

  setMuted(m) {
    this.el.mute.classList.toggle('off', m);
    this.el.mute.setAttribute('aria-label', m ? 'Unmute' : 'Mute');
    this.el.mute.title = m ? 'Unmute (M)' : 'Mute (M)';
  }

  updateHud(score, coins, mult, powers) {
    if (score !== this.last.score) {
      this.el.score.textContent = score.toLocaleString();
      this.last.score = score;
    }
    if (coins !== this.last.coins) {
      this.el.coins.textContent = coins.toLocaleString();
      this.last.coins = coins;
      this.el.coins.parentElement.classList.remove('pop');
      void this.el.coins.parentElement.offsetWidth; // restart the CSS animation
      this.el.coins.parentElement.classList.add('pop');
    }
    if (mult !== this.last.mult) {
      this.el.mult.textContent = `x${mult}`;
      this.el.mult.classList.toggle('hot', mult > 1);
      this.last.mult = mult;
    }
    const active = new Set();
    for (const p of powers) {
      active.add(p.type);
      let row = this.powerRows[p.type];
      if (!row) {
        row = document.createElement('div');
        row.className = 'power';
        row.innerHTML = `<img alt="" src="${this.icons[p.type]}"><div class="bar"><div></div></div>`;
        this.el.powers.appendChild(row);
        this.powerRows[p.type] = row;
      }
      row.lastChild.firstChild.style.width = `${Math.round(p.frac * 100)}%`;
    }
    for (const k of Object.keys(this.powerRows)) {
      if (!active.has(k)) {
        this.powerRows[k].remove();
        delete this.powerRows[k];
      }
    }
  }

  toast(text) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
  }

  flash() {
    const f = this.el.flash;
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }
}
