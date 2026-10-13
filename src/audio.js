// Tiny synthesised sound engine (Web Audio). No audio files needed.
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.muted = false;
    this.musicOn = false;
    this.nextNote = 0;
    this.step = 0;
    this.timer = null;
    try {
      this.muted = localStorage.getItem('sr2-muted') === '1';
    } catch (e) { /* storage unavailable */ }
  }

  // Must be called from a user gesture (browsers block audio until then).
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch (e) {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.32;
      this.musicGain.connect(this.master);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('sr2-muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.02);
  }

  _ok() { return this.ctx && this.ctx.state === 'running'; }

  _tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0, dest = null } = {}) {
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noise(dur, { vol = 0.3, freq = 1200, q = 1, type = 'bandpass', delay = 0, dest = null } = {}) {
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest || this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  play(name) {
    if (!this._ok()) return;
    switch (name) {
      case 'coin':
        this._tone(1318, 0.08, { type: 'square', vol: 0.07 });
        this._tone(1760, 0.14, { type: 'square', vol: 0.07, delay: 0.05 });
        break;
      case 'jump':
        this._tone(300, 0.18, { type: 'triangle', vol: 0.25, slide: 2.4 });
        break;
      case 'superjump':
        this._tone(250, 0.3, { type: 'triangle', vol: 0.25, slide: 4 });
        this._noise(0.25, { vol: 0.08, freq: 3000 });
        break;
      case 'roll':
        this._noise(0.3, { vol: 0.25, freq: 600, q: 0.8 });
        break;
      case 'lane':
        this._noise(0.12, { vol: 0.08, freq: 2500, q: 0.7 });
        break;
      case 'land':
        this._noise(0.08, { vol: 0.12, freq: 400, type: 'lowpass' });
        break;
      case 'stumble':
        this._tone(140, 0.25, { type: 'sawtooth', vol: 0.25, slide: 0.5 });
        this._noise(0.2, { vol: 0.3, freq: 300, type: 'lowpass' });
        break;
      case 'crash':
        this._noise(0.7, { vol: 0.6, freq: 500, type: 'lowpass' });
        this._tone(180, 0.6, { type: 'sawtooth', vol: 0.3, slide: 0.25 });
        break;
      case 'power':
        [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.16, { type: 'square', vol: 0.08, delay: i * 0.07 }));
        break;
      case 'powerEnd':
        [784, 523].forEach((f, i) => this._tone(f, 0.15, { type: 'triangle', vol: 0.12, delay: i * 0.09 }));
        break;
      case 'boardBreak':
        this._noise(0.4, { vol: 0.4, freq: 1800, q: 0.6 });
        this._tone(600, 0.3, { type: 'square', vol: 0.1, slide: 0.3 });
        break;
      case 'bark':
        for (const d of [0, 0.18]) {
          this._tone(520, 0.09, { type: 'sawtooth', vol: 0.14, slide: 0.55, delay: d });
          this._noise(0.08, { vol: 0.18, freq: 900, q: 1.5, delay: d });
        }
        break;
      case 'horn':
        for (const f of [311, 370]) this._tone(f, 0.75, { type: 'sawtooth', vol: 0.06, slide: 0.97 });
        break;
      case 'level':
        [659, 784, 988, 1318].forEach((f, i) => this._tone(f, 0.18, { type: 'triangle', vol: 0.14, delay: i * 0.08 }));
        break;
      case 'click':
        this._tone(880, 0.06, { type: 'square', vol: 0.08 });
        break;
      case 'record':
        [523, 659, 784, 1046, 1318].forEach((f, i) => this._tone(f, 0.22, { type: 'square', vol: 0.09, delay: i * 0.09 }));
        break;
      default:
        break;
    }
  }

  // ---- background beat --------------------------------------------------
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.nextNote = this.ctx.currentTime + 0.05;
    this.step = 0;
    this.timer = setInterval(() => this._schedule(), 25);
  }

  stopMusic() {
    this.musicOn = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  _schedule() {
    if (!this._ok()) {
      if (this.ctx) this.nextNote = this.ctx.currentTime + 0.05;
      return;
    }
    const spb = 60 / 128 / 4; // sixteenth notes at 128 bpm
    const bass = [45, 45, 57, 45, 48, 48, 60, 48, 43, 43, 55, 43, 40, 40, 52, 47];
    // never schedule a backlog (e.g. after the tab was hidden)
    if (this.nextNote < this.ctx.currentTime - 0.2) this.nextNote = this.ctx.currentTime + 0.05;
    while (this.nextNote < this.ctx.currentTime + 0.12) {
      const st = this.step % 16;
      const delay = Math.max(0, this.nextNote - this.ctx.currentTime);
      const bar = Math.floor(this.step / 16) % 4;
      if (st % 4 === 0) this._tone(110, 0.16, { type: 'sine', vol: 0.5, slide: 0.35, delay, dest: this.musicGain });
      if (st % 4 === 2) this._noise(0.05, { vol: 0.12, freq: 8000, type: 'highpass', delay, dest: this.musicGain });
      if (st === 4 || st === 12) this._noise(0.14, { vol: 0.2, freq: 1800, q: 0.6, delay, dest: this.musicGain });
      if (st % 2 === 0) {
        const n = bass[(bar * 8 + st / 2) % 16];
        this._tone(440 * 2 ** ((n - 69) / 12), 0.14, { type: 'sawtooth', vol: 0.12, delay, dest: this.musicGain });
      }
      this.nextNote += spb;
      this.step++;
    }
  }
}
