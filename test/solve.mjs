// Automatischer Testspieler: prüft, ob jede Bahn lösbar ist und wie schwer.
// Aufruf: node test/solve.mjs [Parcours-Nummer]
import { buildHole } from '../js/physics.js';
import { pickCourses, geodesic, simulate, hasMovers } from './common.mjs';

const ANGLE_STEP = 2;
const POWERS = [];
for (let p = 0.1; p <= 1.0001; p += 0.05) POWERS.push(p);

let allOk = true;
for (const course of pickCourses(process.argv[2])) {
  console.log(`\nKurs: ${course.name}`);
  let total = 0, parTotal = 0;
  course.holes.forEach((def, idx) => {
    const hole = buildHole(def);
    const geo = geodesic(hole);
    let pos = { ...hole.tee };
    let t = 0;
    let strokes = 0;
    let aces = 0, wet = 0, outs = 0, shots = 0, stuck = 0;
    let holed = false;
    const notes = [];
    while (!holed && strokes < 8) {
      let best = null;
      const waits = hasMovers(hole) ? [0, 0.6, 1.2, 1.8, 2.4, 3.0, 3.6] : [0];
      for (const wait of waits) for (let ang = 0; ang < 360; ang += ANGLE_STEP) {
        for (const p of POWERS) {
          const r = simulate(hole, pos, t + wait, ang, p);
          if (strokes === 0) {
            shots++;
            if (r.state === 'holed') aces++;
            if (r.state === 'water') wet++;
            if (r.state === 'out') outs++;
            if (r.state === 'moving') stuck++;
          }
          const score = r.state === 'holed' ? -1 : r.state === 'rest' ? geo(r.x, r.z) : Infinity;
          if (!best || score < best.score) best = { ...r, score, ang, p };
        }
      }
      strokes++;
      if (best.score === Infinity) { notes.push('kein gültiger Schlag gefunden'); break; }
      notes.push(`${best.ang}°/${best.p.toFixed(2)}${best.usedTunnel ? ' (Tunnel)' : ''}`);
      if (best.state === 'holed') holed = true;
      else { pos = { x: best.x, z: best.z }; t = best.t; }
    }
    total += strokes; parTotal += def.par;
    const acePct = ((aces / shots) * 100).toFixed(2);
    const wetPct = ((wet / shots) * 100).toFixed(0);
    const status = !holed || outs > 0 || stuck > 0 ? 'FEHLER' : strokes > def.par ? 'SCHWER' : 'ok';
    if (status === 'FEHLER') allOk = false;
    console.log(
      `${String(idx + 1).padStart(2)}. ${def.name.padEnd(12)} Par ${def.par} | Testspieler: ${holed ? strokes : '—'} | ` +
      `Ass-Schläge: ${aces}/${shots} (${acePct}%) | Wasser: ${wetPct}% | Aus: ${outs} | hängt: ${stuck} | ${status}  [${notes.join(', ')}]`
    );
  });
  console.log(`Summe Testspieler: ${total} bei Par ${parTotal}`);
}
process.exit(allOk ? 0 : 1);
