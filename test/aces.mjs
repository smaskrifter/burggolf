// Zeigt, mit welchen Winkeln/Stärken auf einer Bahn ein Ass gelingt:
// node test/aces.mjs <Bahnnummer> [Parcours-Nummer]
import { COURSES } from '../js/levels.js';
import { buildHole, Sim } from '../js/physics.js';
const course = COURSES[(+process.argv[3] || 1) - 1];
const hole = buildHole(course.holes[+process.argv[2] - 1]);
const waits = hole.gates.length || hole.spinners.length || hole.guards.length ? [0, 0.6, 1.2, 1.8, 2.4, 3.0, 3.6] : [0];
const byAngle = new Map();
let total = 0, aces = 0;
for (const wait of waits) for (let ang = 0; ang < 360; ang += 1) for (let p = 0.1; p <= 1.0001; p += 0.05) {
  const sim = new Sim(hole); sim.t = wait; sim.placeBall(hole.tee.x, hole.tee.z);
  const a = ang * Math.PI / 180; sim.shoot(Math.cos(a), Math.sin(a), p);
  let n = 0; while (n++ < 12000) { sim.sub(); if (sim.state !== 'moving' && sim.state !== 'tunnel') break; }
  total++;
  if (sim.state === 'holed') { aces++; byAngle.set(ang, (byAngle.get(ang) || 0) + 1); }
}
console.log(`${course.name} – ${hole.name}: ${aces}/${total} (${(aces / total * 100).toFixed(2)}%)`);
console.log([...byAngle.entries()].sort((a, b) => a[0] - b[0]).map(([a, c]) => `${a}°:${c}`).join('  '));
