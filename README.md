# Subway Rush 2

A 3D endless runner for the browser: dodge trains, jump barriers, roll under signs, run up ramps onto train roofs, grab coins and power-ups, and keep away from the guard.

## Play

Open `index.html` in any modern browser. Double-clicking the file works, and so does any static web host such as GitHub Pages. There is nothing to install and no internet connection is needed: everything, including the 3D engine, is bundled into `game.js`.

| Action | Keyboard | Touch / mouse |
| --- | --- | --- |
| Change lane | `←` `→` or `A` `D` | swipe left / right |
| Jump | `↑`, `W` or `Space` | swipe up |
| Roll (and drop fast when in the air) | `↓` or `S` | swipe down |
| Pause / resume | `P` or `Esc` | pause button |
| Mute | `M` | speaker button |
| Start / restart | `Enter` | PLAY button |

### Obstacles

- **Red and white barriers**: jump over them.
- **Yellow and black signs**: roll under them.
- **Trains**: change lane, or run up a yellow ramp onto the roof. Trains with bright headlights are coming towards you.
- Clipping the side of a train makes you **stumble** and the guard starts chasing you. A second stumble while the guard is still close means you're caught.

### Power-ups

| Power-up | Effect |
| --- | --- |
| Coin Magnet | pulls in nearby coins |
| 2x | doubles your score |
| Super Sneakers | much higher jumps, high enough to reach train roofs |
| Jetpack | fly above everything and collect a trail of sky coins |
| Hoverboard | absorbs one crash |

Your best score and total coins are saved in the browser.

## Development

```sh
npm install
npm run build   # bundles src/ into game.js
npm run dev     # rebuilds on change, with source maps
```

The code lives in `src/`:

- `sim.js`: headless gameplay simulation (physics, collisions, pickups, scoring)
- `generator.js`: procedural level generator. It keeps a "safe lane" so every level can be beaten.
- `physics.js`, `config.js`: shared collision helpers and tuning constants
- `game.js`: rendering, animation, camera and game states
- `models.js`, `world.js`, `textures.js`: procedurally built 3D models, scenery and textures
- `ui.js`, `input.js`, `audio.js`: HUD and menus, controls, synthesised sound

Commit the rebuilt `game.js` along with any changes to `src/` so the game stays playable straight from the repository.
