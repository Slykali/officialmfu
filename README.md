# Subway Rush 2

A 3D endless runner for the browser: dodge trains, jump barriers, roll under signs, run up ramps onto train roofs, grab coins and power-up orbs, and keep away from the guard and the guard's dog.

## Play

Open `index.html` in any modern browser. Double-clicking the file works, and so does any static web host such as GitHub Pages. There is nothing to install and no internet connection is needed: everything, including the 3D engine, is bundled into `game.js`.

| Action | Keyboard | Touch / mouse |
| --- | --- | --- |
| Change lane | `←` `→` or `A` `D` | swipe left / right |
| Jump | `↑`, `W` or `Space` | swipe up |
| Roll (and drop fast when in the air) | `↓` or `S` | swipe down |
| Pause / resume | `P` or `Esc` | pause button |
| Mute | `M` | speaker button |
| Start / restart | `Enter` or `Space` | PLAY button, or tap the menu |
| Pick a character (Characters screen) | `←` `→`, `Enter` to select or unlock, `Esc` to go back | arrows and buttons |

### Obstacles

- **Red and white barriers**: jump over them.
- **Yellow and black signs**: roll under them.
- **Trains**: change lane, or run up a chevron ramp onto the roof. Dark trains with glowing headlights, a flashing beacon and a horn are coming towards you.
- Clipping the side of a train makes you **stumble** and the guard and dog start chasing you. A second stumble while they're still close means you're caught.

### Levels

Every 500 m you go up a level, to a maximum of 10, and your score multiplier (shown next to your score) goes up with it. The 2x orb doubles it again.

### Maps

Pick a map from the **Map** button on the menu. The track plays the same everywhere; the world around it changes.

| Map | Look |
| --- | --- |
| Downtown | sunny city blocks and graffiti walls |
| Sunset Beach | beach houses, palm trees, the sea and an orange evening sky |
| Frozen Peaks | snow-capped roofs, snowy pines and falling snow |
| Neon Night | dark towers with glowing windows and neon signs |
| Desert Canyon | red rock mesas and cacti |

### Daily missions

Every day brings three new missions, the same for everyone on that date, such as "Collect 70 coins in one run", "Roll 40 times" or "Collect 2 Jetpack orbs". Progress carries over between runs that day. Each finished mission pays coins straight away, finishing all three pays a 500-coin bonus, and new missions arrive at midnight. Check them from the **Missions** button on the menu.

### Power-up orbs

Glowing orbs float along the track. Run through one to claim its boost:

| Orb | Boost |
| --- | --- |
| Coin Magnet | pulls in nearby coins |
| 2x | doubles your score |
| Super Sneakers | much higher jumps, high enough to reach train roofs |
| Jetpack | fly above everything and collect a trail of sky coins |
| Hoverboard | absorbs one crash |

### Characters

Six runners, each with their own look: Dash (free), Nova, Bolt, Pixel, Blaze and Frost. Unlock them on the **Characters** screen with the coins you collect across runs.

Your best score, coins, unlocked characters and chosen character are saved in the browser.

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
- `characters.js`: the playable characters, their looks and prices
- `maps.js`: map themes (sky, light, ground, buildings, props)
- `missions.js`: daily mission picking, progress and rewards (tests: `node test/missions.mjs`)
- `ui.js`, `input.js`, `audio.js`: HUD and menus, controls, synthesised sound

Commit the rebuilt `game.js` along with any changes to `src/` so the game stays playable straight from the repository.
