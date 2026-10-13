// Pure collision helpers shared by the simulation and the level generator.
import { laneX, TRAIN, RAMP_L, HURDLE, OVERHEAD } from './config.js';

// Front (near end) of a train for a given player position. Oncoming trains are
// parked until the player is within R of the meeting point, then move towards
// the player at k times the player's speed. Using the player's position instead
// of time keeps this deterministic regardless of frame rate.
export function trainFront(t, sp) {
  if (!t.moving) return t.s;
  return t.s + t.k * Math.min(t.R, t.s - sp);
}

// Highest walkable surface under a box centred on (x, s) with the given half
// extents. Trains count as solid blocks; ramps rise linearly to roof height.
export function surfaceHeight(trains, x, s, halfW, halfD, sp) {
  let h = 0;
  for (let i = 0; i < trains.length; i++) {
    const t = trains[i];
    if (Math.abs(x - laneX(t.lane)) >= TRAIN.halfW + halfW) continue;
    const f = trainFront(t, sp);
    const near = s - halfD;
    const far = s + halfD;
    if (far > f && near < f + t.len) {
      if (TRAIN.height > h) h = TRAIN.height;
    } else if (t.ramp && far > f - RAMP_L && near < f) {
      const q = Math.min(far, f);
      const rh = ((q - (f - RAMP_L)) / RAMP_L) * TRAIN.height;
      if (rh > h) h = rh;
    }
  }
  return h;
}

export function barrierBox(b) {
  const spec = b.kind === 'hurdle' ? HURDLE : OVERHEAD;
  return spec;
}

// Returns the first barrier overlapping the player's box, or null.
export function hitBarrier(barriers, x, s, y, height, halfW, halfD) {
  for (let i = 0; i < barriers.length; i++) {
    const b = barriers[i];
    const spec = b.kind === 'hurdle' ? HURDLE : OVERHEAD;
    if (Math.abs(x - laneX(b.lane)) >= spec.halfW + halfW) continue;
    if (Math.abs(s - b.s) >= spec.halfD + halfD) continue;
    if (y < spec.y1 && y + height > spec.y0) return b;
  }
  return null;
}
