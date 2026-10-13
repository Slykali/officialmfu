import { Game } from './game.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { Audio } from './audio.js';

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
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
    fail('Sorry, this game needs WebGL 2, which your browser or device does not support. Try an up-to-date Chrome, Firefox, Safari or Edge.');
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
    chars: () => game.openChars(),
    charStep: (dir) => game.charsStep(dir),
    charAction: () => game.charsAction(),
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
    left: () => (game.state === 'chars' ? game.charsStep(-1) : game.act('left')),
    right: () => (game.state === 'chars' ? game.charsStep(1) : game.act('right')),
    up: () => {
      if (game.state === 'menu' || game.state === 'over') game.confirm();
      else game.act('jump');
    },
    down: () => game.act('down'),
    pause: () => game.togglePause(),
    mute: toggleMute,
    confirm: () => game.confirm(),
  });
  // Tapping anywhere on the menu starts a run. This listens for the click (not the
  // pointer release) so the same tap can't also land on the pause button that appears.
  document.getElementById('menu').addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('button')) return;
    if (game.state === 'menu') game.start();
  });
  document.getElementById('loading').classList.add('hidden');
  window.__game = game; // handy for debugging from the console
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
