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
      charMenu: $('charMenu'), chars: $('chars'), charName: $('charName'), charTag: $('charTag'),
      charDots: $('charDots'), charAction: $('charAction'), charsBank: $('charsBank'),
      mapMenu: $('mapMenu'), missionsMenu: $('missionsMenu'), maps: $('maps'), mapName: $('mapName'),
      mapTag: $('mapTag'), mapDots: $('mapDots'), mapAction: $('mapAction'), missions: $('missionsScreen'),
      missionList: $('missionList'), missionReset: $('missionReset'), missionBonus: $('missionBonus'),
      overMissions: $('overMissions'),
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
    bind('charsBtn', handlers.chars);
    bind('charPrev', () => handlers.charStep(-1));
    bind('charNext', () => handlers.charStep(1));
    bind('charAction', handlers.charAction);
    bind('charBack', handlers.menu);
    bind('mapsBtn', handlers.maps);
    bind('mapPrev', () => handlers.mapStep(-1));
    bind('mapNext', () => handlers.mapStep(1));
    bind('mapAction', handlers.mapAction);
    bind('mapBack', handlers.menu);
    bind('missionsBtn', handlers.missions);
    bind('missionsBack', handlers.menu);

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
    this.toasts = [];
    this.toastTimer = null;
  }

  _only(screen) {
    for (const k of ['menu', 'pause', 'over', 'chars', 'maps', 'missions']) this.el[k].classList.toggle('hidden', k !== screen);
    this.el.countdown.classList.add('hidden');
  }

  showMenu({ best, bank, character, map, missions }) {
    this._only('menu');
    this.el.hud.classList.add('hidden');
    this.el.bestMenu.textContent = best.toLocaleString();
    this.el.bankMenu.textContent = bank.toLocaleString();
    this.el.charMenu.textContent = character;
    this.el.mapMenu.textContent = map;
    this.el.missionsMenu.textContent = missions;
  }

  showMaps(m) {
    this._only('maps');
    this.el.hud.classList.add('hidden');
    this.el.mapName.textContent = m.name;
    this.el.mapTag.textContent = m.tagline;
    const btn = this.el.mapAction;
    btn.textContent = m.selected ? 'SELECTED' : 'SELECT';
    btn.classList.toggle('selected', m.selected);
    btn.setAttribute('aria-label', m.selected ? `${m.name} is selected` : `Select ${m.name}`);
    let dots = '';
    for (let i = 0; i < m.total; i++) dots += `<i class="${i === m.index ? 'on' : ''}"></i>`;
    this.el.mapDots.innerHTML = dots;
  }

  showMissions(v) {
    this._only('missions');
    this.el.hud.classList.add('hidden');
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    this.el.missionList.innerHTML = v.missions.map((m) => {
      const pct = Math.round((m.progress / m.target) * 100);
      const note = m.scope === 'run' && !m.done ? 'best run' : '';
      return `<li class="mission${m.done ? ' done' : ''}">
        <div class="m-check" aria-hidden="true">${m.done ? '&#10003;' : ''}</div>
        <div class="m-body">
          <div class="m-text">${esc(m.text)}</div>
          <div class="m-bar"><div style="width:${pct}%"></div></div>
          <div class="m-meta">${m.done ? 'Complete' : `${m.progress.toLocaleString()} / ${m.target.toLocaleString()}${note ? ` · ${note}` : ''}`}</div>
        </div>
        <div class="m-reward"><span class="coin-icon small"></span>${m.reward}</div>
      </li>`;
    }).join('');
    this.el.missionBonus.classList.toggle('done', v.bonusDone);
    this.el.missionBonus.innerHTML = `${v.bonusDone ? '&#10003; ' : ''}Finish all three for a bonus <span class="coin-icon small"></span> <b>${v.bonus}</b>`;
    const mins = Math.max(1, Math.ceil(v.resetIn / 60000));
    const h = Math.floor(mins / 60);
    this.el.missionReset.textContent = `New missions in ${h ? `${h} h ` : ''}${mins % 60} min`;
  }

  showChars(c) {
    this._only('chars');
    this.el.hud.classList.add('hidden');
    this.el.charName.textContent = c.name;
    this.el.charTag.textContent = c.tagline;
    this.el.charsBank.textContent = c.bank.toLocaleString();
    const btn = this.el.charAction;
    btn.classList.remove('locked', 'selected', 'nudge');
    if (c.selected) {
      btn.textContent = 'SELECTED';
      btn.classList.add('selected');
    } else if (c.owned) {
      btn.textContent = 'SELECT';
    } else {
      btn.innerHTML = `UNLOCK <span class="coin-icon"></span> ${c.price.toLocaleString()}`;
      btn.classList.toggle('locked', c.bank < c.price);
    }
    btn.setAttribute('aria-label', c.selected ? `${c.name} is selected` : c.owned ? `Select ${c.name}` : `Unlock ${c.name} for ${c.price} coins`);
    let dots = '';
    for (let i = 0; i < c.total; i++) dots += `<i class="${i === c.index ? 'on' : ''}"></i>`;
    this.el.charDots.innerHTML = dots;
  }

  // shake the unlock button when the player can't afford it
  nudge() {
    const b = this.el.charAction;
    b.classList.remove('nudge');
    void b.offsetWidth;
    b.classList.add('nudge');
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
    this.el.overMissions.textContent = `Daily missions: ${r.missions} of 3 done`;
  }

  setMuted(m) {
    this.el.mute.classList.toggle('off', m);
    this.el.mute.setAttribute('aria-label', m ? 'Unmute' : 'Mute');
    this.el.mute.title = m ? 'Unmute (M)' : 'Mute (M)';
  }

  updateHud(score, coins, mult, powers, boosted) {
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
      this.el.mult.classList.remove('pop');
      void this.el.mult.offsetWidth;
      this.el.mult.classList.add('pop');
      this.last.mult = mult;
    }
    this.el.mult.classList.toggle('hot', !!boosted);
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

  // Toasts queue up so a mission and a power-up never cover each other.
  toast(text) {
    if (this.toasts.length >= 4) this.toasts.shift();
    this.toasts.push(text);
    if (!this.toastTimer) this._nextToast();
  }

  _nextToast() {
    const t = this.el.toast;
    const text = this.toasts.shift();
    if (text === undefined) {
      this.toastTimer = null;
      return;
    }
    t.textContent = text;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    this.toastTimer = setTimeout(() => {
      t.classList.remove('show');
      this.toastTimer = setTimeout(() => this._nextToast(), 80);
    }, 1400);
  }

  flash() {
    const f = this.el.flash;
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }
}
