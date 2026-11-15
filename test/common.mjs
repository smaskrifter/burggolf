// Gemeinsame Helfer für die Testskripte
import { COURSES } from '../js/levels.js';
import { Sim } from '../js/physics.js';

/** Wählt Parcours aus: ohne Angabe alle, sonst Nummer (1, 2, …) oder Kennung. */
export function pickCourses(arg) {
  if (!arg) return COURSES;
  const c = COURSES[+arg - 1] || COURSES.find((k) => k.id === arg);
  if (!c) throw new Error(`Parcours "${arg}" gibt es nicht`);
  return [c];
}

export const hasMovers = (hole) => hole.gates.length + hole.spinners.length + hole.guards.length > 0;

/** Weglänge zum Loch (über begehbare Kacheln; Schächte zählen als Abkürzung in sonst abgeschnittene Bereiche). */
export function geodesic(hole) {
  const N = 4; // Raster pro Kachel
  const W = hole.cols * N, H = hole.rows * N;
  const dist = new Float64Array(W * H).fill(Infinity);
  const segDist = (x, z, s) => {
    const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
    const t = Math.min(1, Math.max(0, ((x - s.x1) * dx + (z - s.z1) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - (s.x1 + dx * t), z - (s.z1 + dz * t));
  };
  const inner = hole.segments.filter((s) => s.kind === 'inner');
  const ok = (i, j) => {
    if (i < 0 || j < 0 || i >= W || j >= H) return false;
    const x = (i + 0.5) / N, z = (j + 0.5) / N;
    if (!hole.onFloor(x, z) || hole.tileAtPos(x, z) === '~') return false;
    // Innenmauern und Türme versperren den Weg (sonst läuft der Testspieler in Sackgassen)
    for (const s of inner) if (segDist(x, z, s) < 0.13) return false;
    for (const t of hole.towers) if (Math.hypot(x - t.x, z - t.z) < t.r) return false;
    return true;
  };
  const flood = (ci, cj, d0) => {
    const queue = [[ci, cj]];
    dist[cj * W + ci] = d0;
    while (queue.length) {
      const [i, j] = queue.shift();
      const d = dist[j * W + i];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (ok(a, b) && dist[b * W + a] === Infinity) { dist[b * W + a] = d + 1 / N; queue.push([a, b]); }
      }
    }
  };
  flood(Math.floor(hole.cup.x * N), Math.floor(hole.cup.z * N), 0);
  for (let again = true; again;) {
    again = false;
    for (const tn of hole.tunnels) {
      const ai = Math.floor(tn.x * N), aj = Math.floor(tn.z * N);
      const b = Math.floor(tn.oz * N) * W + Math.floor(tn.ox * N);
      if (dist[aj * W + ai] !== Infinity || dist[b] === Infinity) continue;
      flood(ai, aj, dist[b] + 1);
      again = true;
    }
  }
  return (x, z) => {
    const i = Math.floor(x * N), j = Math.floor(z * N);
    if (i < 0 || j < 0 || i >= W || j >= H) return Infinity;
    return dist[j * W + i];
  };
}

/** Spielt einen Schlag bis zum Stillstand durch. */
export function simulate(hole, from, t0, angleDeg, power) {
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
