// Shared gameplay constants. All distances are in world units (~metres).
// The track runs along -Z: a track position `s` maps to world z = -s.

export const TITLE = 'Subway Rush 2';

export const LANE_W = 2.5;
export const LANES = 3;
export const laneX = (lane) => (lane - 1) * LANE_W;

export const PLAYER = {
  halfW: 0.35,
  halfD: 0.35,
  height: 1.7,
  rollHeight: 0.85,
};

export const GRAVITY = 55;
export const JUMP_H = 2.3;
export const SUPER_JUMP_H = 4.6;
export const FAST_FALL_V = 32;
export const ROLL_TIME = 0.62;
export const LANE_SPEED = 19; // lateral units per second
export const STEP_UP = 0.5; // max height the player can walk up in one sub-step
export const JUMP_BUFFER = 0.16; // seconds a jump press is remembered
export const COYOTE_TIME = 0.08; // seconds after leaving a ledge a jump still works

export const TRAIN = { carLen: 14, height: 3.6, halfW: 1.15 };
export const RAMP_L = 9;

export const HURDLE = { halfD: 0.15, halfW: 1.1, y0: 0, y1: 1.0 };
export const OVERHEAD = { halfD: 0.15, halfW: 1.1, y0: 1.25, y1: 2.6 };

// Speed depends on distance travelled, which keeps the level generator and
// the simulation in agreement about how fast the player will be going.
export const SPEED = { start: 15, max: 32, accel: 17 / 6000 };
export const speedAt = (s) => Math.min(SPEED.max, SPEED.start + Math.max(0, s) * SPEED.accel);

// Oncoming trains: while the player is within R of the meeting point the train
// moves towards them at k times the player's speed.
export const MOVING = { k: 0.55, R: 75 };

export const POWER_TIME = {
  magnet: 12,
  multiplier: 15,
  sneakers: 12,
  jetpack: 7,
  board: 30,
};
export const POWER_TYPES = ['magnet', 'multiplier', 'sneakers', 'jetpack', 'board'];

export const FLY_Y = 8; // player feet height while on the jetpack
export const MAGNET_RANGE = 9;
export const STUMBLE_TIME = 5; // guard keeps chasing this long after a stumble
export const GRACE_TIME = 2; // invulnerability after a board break / jetpack landing

export const GEN_AHEAD = 280; // how far ahead the level is generated
export const KEEP_BEHIND = 20; // how far behind items are kept before removal
