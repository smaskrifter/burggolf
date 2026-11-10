// Automatischer Testspieler: prüft, ob jede Bahn lösbar ist und wie schwer.
// Aufruf: node test/solve.mjs
import { COURSES } from '../js/levels.js';
import { buildHole, Sim } from '../js/physics.js';

const ANGLE_STEP = 2;
const POWERS = [];
for (let p = 0.1; p <= 1.0001; p += 0.05) POWERS.push(p);

function geodesic(hole) {
  const N = 4; // Raster pro Kachel
  const W = hole.cols * N, H = hole.rows * N;
  const dist = new Float64Array(W * H).fill(Infinity);
  const ok = (i, j) => {
    if (i < 0 || j < 0 || i >= W || j >= H) return false;
    const x = (i + 0.5) / N, z = (j + 0.5) / N;
    return hole.onFloor(x, z) && hole.tileAtPos(x, z) !== '~';
  };
  const ci = Math.floor(hole.cup.x * N), cj = Math.floor(hole.cup.z * N);
  const queue = [[ci, cj]];
  dist[cj * W + ci] = 0;
  while (queue.length) {
    const [i, j] = queue.shift();
    const d = dist[j * W + i];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (ok(a, b) && dist[b * W + a] === Infinity) { dist[b * W + a] = d + 1 / N; queue.push([a, b]); }
    }
  }
  return (x, z) => {
    const i = Math.floor(x * N), j = Math.floor(z * N);
    if (i < 0 || j < 0 || i >= W || j >= H) return Infinity;
    return dist[j * W + i];
  };
}

function simulate(hole, from, t0, angleDeg, power) {
  const sim = new Sim(hole);
  sim.t = t0;
  sim.placeBall(from.x, from.z);
  const a = (angleDeg * Math.PI) / 180;
  sim.shoot(Math.cos(a), Math.sin(a), power);
  let guard = 0;
  while (guard++ < 40 * 300) {
    sim.sub();
    if (sim.state === 'rest' || sim.state === 'holed' || sim.state === 'water' || sim.state === 'out') break;
  }
  return { state: sim.state, x: sim.ball.x, z: sim.ball.z, t: sim.t, usedTunnel: sim.tunnel != null };
}

let allOk = true;
for (const course of COURSES) {
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
      for (let ang = 0; ang < 360; ang += ANGLE_STEP) {
        for (const p of POWERS) {
          const r = simulate(hole, pos, t, ang, p);
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
    const status = !holed || outs > 0 || stuck > 0 ? 'FEHLER' : strokes > def.par ? 'SCHWER' : 'ok';
    if (status === 'FEHLER') allOk = false;
    console.log(
      `${String(idx + 1).padStart(2)}. ${def.name.padEnd(12)} Par ${def.par} | Testspieler: ${holed ? strokes : '—'} | ` +
      `Ass-Schläge: ${aces}/${shots} (${acePct}%) | Wasser: ${wet} | Aus: ${outs} | hängt: ${stuck} | ${status}  [${notes.join(', ')}]`
    );
  });
  console.log(`Summe Testspieler: ${total} bei Par ${parTotal}`);
}
process.exit(allOk ? 0 : 1);
