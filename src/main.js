import { Game } from './game.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { Audio } from './audio.js';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) {
    return false;
  }
}

function fail(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.classList.remove('hidden');
  document.getElementById('loading').classList.add('hidden');
}

function boot() {
  if (!webglAvailable()) {
    fail('Sorry, this game needs WebGL, which your browser or device does not support.');
    return;
  }
  const audio = new Audio();
  let game = null;
  const toggleMute = () => {
    audio.unlock();
    audio.setMuted(!audio.muted);
    ui.setMuted(audio.muted);
  };
  const ui = new UI({
    play: () => game.start(),
    resume: () => game.resume(),
    menu: () => game.toMenu(),
    pause: () => game.pause(),
    mute: toggleMute,
  });
  ui.setMuted(audio.muted);
  try {
    game = new Game(document.getElementById('game'), ui, audio);
  } catch (e) {
    console.error(e);
    fail('Sorry, the game could not start on this device (WebGL error).');
    return;
  }
  new Input(document.body, {
    left: () => game.act('left'),
    right: () => game.act('right'),
    up: () => game.act('jump'),
    down: () => game.act('down'),
    pause: () => game.togglePause(),
    mute: toggleMute,
    confirm: () => game.confirm(),
    tap: () => { if (game.state === 'menu') game.start(); },
  });
  document.getElementById('loading').classList.add('hidden');
  window.__game = game; // handy for debugging from the console
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
