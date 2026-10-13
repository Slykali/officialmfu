// Quick sanity run of the headless simulation: node test/smoke.mjs
import { Sim } from '../src/sim.js';
const sim = new Sim(42);
for (let i = 0; i < 600 && sim.alive; i++) {
  sim.step(1 / 60);
  sim.takeEvents();
  sim.added.length = 0;
  sim.removed.length = 0;
}
console.log('alive', sim.alive, 'cause', sim.deathCause, 's', sim.s.toFixed(1), 'coins', sim.coins,
  'trains', sim.trains.length, 'barriers', sim.barriers.length, 'coinItems', sim.coinItems.length);
