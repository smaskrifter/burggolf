// Zeigt die automatische Startrichtung im klassischen Modus: node test/aim.mjs
// 0° = nach rechts, 90° = nach unten (zur Kamera), -90° = nach oben.
import { COURSES } from '../js/levels.js';
import { buildHole } from '../js/physics.js';

const extra = {
  Wehrgang: [[9.5, 1.5], [9.5, 4]],
  Fallgitter: [[7, 1.5], [9.5, 2.5], [9.5, 5.5], [7, 6.5], [0.3, 0.3]],
  Geheimgang: [[4.5, 4.5], [7.5, 5.5]],
  Thronsaal: [[6, 5.5], [9, 4.5], [12, 5.5]],
  'Zugbrücke': [[3, 4], [9, 2.5]],
};
COURSES[0].holes.forEach((def, i) => {
  const hole = buildHole(def);
  const deg = (x, z) => ((hole.aimAngle(x, z) * 180) / Math.PI).toFixed(1).padStart(6);
  const cupDeg = (x, z) => ((Math.atan2(hole.cup.z - z, hole.cup.x - x) * 180) / Math.PI).toFixed(1).padStart(6);
  const t0 = performance.now();
  let line = `${i + 1}. ${def.name.padEnd(11)} Abschlag: ${deg(hole.tee.x, hole.tee.z)}° (Loch direkt: ${cupDeg(hole.tee.x, hole.tee.z)}°)`;
  for (const [x, z] of extra[def.name] || []) line += ` | (${x},${z}): ${deg(x, z)}°`;
  console.log(line, `[${(performance.now() - t0).toFixed(0)} ms]`);
});
