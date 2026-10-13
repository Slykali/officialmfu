import { Sim } from '../src/sim.js';
const sim = new Sim(42);
for (let i = 0; i < 600 && sim.alive; i++) sim.step(1 / 60);
console.log('alive', sim.alive, 'cause', sim.deathCause, 's', sim.s.toFixed(1), 'coins', sim.coins,
  'trains', sim.trains.length, 'barriers', sim.barriers.length, 'coinItems', sim.coinItems.length);
