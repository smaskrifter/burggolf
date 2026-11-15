// "Zittriger" Testspieler: sucht wie ein Mensch den besten Schlag, trifft ihn aber nie genau
// (Richtung, Stärke und Zeitpunkt streuen). Der Durchschnitt über mehrere Runden zeigt,
// wie schwer eine Bahn im Vergleich zu den anderen ist.
// Aufruf: node test/play.mjs [Parcours-Nummer] [Runden] [Bahnen, z. B. 2,5,7]
import { buildHole } from '../js/physics.js';
import { pickCourses, geodesic, simulate, hasMovers } from './common.mjs';

const ROUNDS = +process.argv[3] || 10;
const MAX = 10;
const ONLY = process.argv[4] ? process.argv[4].split(',').map(Number) : null;
const ANGLE_STEP = 3;
const POWERS = [0.12, 0.2, 0.28, 0.36, 0.45, 0.55, 0.65, 0.75, 0.87, 1];
const NOISE = { angle: 2.5, power: 0.08, time: 0.25 };

// fester Zufall, damit die Zahlen von Lauf zu Lauf vergleichbar bleiben
let seed = 12345;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());

// Vorsichtiger Spieler: Die besten Kandidaten werden zusätzlich mit kleinen Abweichungen
// durchgespielt. Ein Schlag, der knapp daneben im Wasser landet, ist dann weniger attraktiv.
function bestShot(hole, geo, pos, t) {
  const waits = hasMovers(hole) ? [0, 0.9, 1.8, 2.7] : [0];
  const here = geo(pos.x, pos.z);
  const value = (r) => (r.state === 'holed' ? -1 : r.state === 'rest' ? geo(r.x, r.z) : r.state === 'water' ? here + 8 : Infinity);
  const list = [];
  for (const wait of waits) for (let ang = 0; ang < 360; ang += ANGLE_STEP) for (const p of POWERS) {
    list.push({ score: value(simulate(hole, pos, t + wait, ang, p)), ang, p, wait });
  }
  list.sort((a, b) => a.score - b.score);
  // die 30 besten und dazu jeden sechsten der übrigen (auch vorsichtige Schläge kommen in die Auswahl)
  const pick = list.filter((c, i) => c.score !== Infinity && (i < 30 || i % 6 === 0));
  let best = null;
  for (const c of pick) {
    let sum = c.score * 2;
    for (const [da, dp] of [[NOISE.angle, 0], [-NOISE.angle, 0], [0, NOISE.power], [0, -NOISE.power]]) {
      const v = value(simulate(hole, pos, t + c.wait + 0.15, c.ang + da, Math.min(1, c.p * (1 + dp))));
      sum += Math.min(v, here + 8);
    }
    const robust = sum / 6;
    if (!best || robust < best.robust) best = { ...c, robust };
  }
  return best;
}

for (const course of pickCourses(process.argv[2])) {
  console.log(`\nKurs: ${course.name} (${ROUNDS} Runden)`);
  let sumMean = 0, sumPar = 0;
  course.holes.forEach((def, idx) => {
    if (ONLY && !ONLY.includes(idx + 1)) return;
    const hole = buildHole(def);
    const geo = geodesic(hole);
    const first = bestShot(hole, geo, hole.tee, 0);
    const results = [];
    let wet = 0;
    for (let round = 0; round < ROUNDS; round++) {
      let pos = { ...hole.tee }, t = 0, strokes = 0, holed = false;
      while (!holed && strokes < MAX) {
        const plan = strokes === 0 && t === 0 ? first : bestShot(hole, geo, pos, t);
        if (!plan || plan.score === Infinity) { strokes = MAX; break; }
        const ang = plan.ang + gauss() * NOISE.angle;
        const p = Math.min(1, Math.max(0.05, plan.p * (1 + gauss() * NOISE.power)));
        const r = simulate(hole, pos, t + plan.wait + Math.abs(gauss()) * NOISE.time, ang, p);
        strokes++;
        t = r.t;
        if (r.state === 'holed') holed = true;
        else if (r.state === 'water') { strokes++; wet++; } // Strafschlag, Ball zurück
        else if (r.state === 'rest') pos = { x: r.x, z: r.z };
      }
      results.push(Math.min(strokes, MAX));
    }
    const mean = results.reduce((s, v) => s + v, 0) / ROUNDS;
    sumMean += mean; sumPar += def.par;
    console.log(
      `${String(idx + 1).padStart(2)}. ${def.name.padEnd(12)} Par ${def.par} | Schnitt ${mean.toFixed(1)} | ` +
      `beste ${Math.min(...results)}, schlechteste ${Math.max(...results)} | Wasser je Runde ${(wet / ROUNDS).toFixed(1)} | [${results.join(' ')}]`
    );
  });
  console.log(`Schnitt gesamt: ${sumMean.toFixed(1)} bei Par ${sumPar}`);
}
