// Prüft, ob bewegliche Hindernisse (Wachen, Drehflügel) durch Türme oder Mauern laufen
// oder die Bahn verlassen. Aufruf: node test/clash.mjs [Parcours-Nummer]
import { buildHole, guardState } from '../js/physics.js';
import { pickCourses } from './common.mjs';

const segDist = (x, z, s) => {
  const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
  const t = Math.min(1, Math.max(0, ((x - s.x1) * dx + (z - s.z1) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - (s.x1 + dx * t), z - (s.z1 + dz * t));
};

let bad = 0;
for (const course of pickCourses(process.argv[2])) {
  course.holes.forEach((def, idx) => {
    const hole = buildHole(def);
    const where = `${course.name} ${idx + 1} ${def.name}`;
    const report = (text) => { bad++; console.log(`${where}: ${text}`); };
    const solid = [...hole.segments, ...hole.gates];
    hole.guards.forEach((g, n) => {
      const seen = new Set();
      for (let k = 0; k <= 200; k++) {
        const st = guardState(g, (g.period * k) / 200);
        const hit = (key, text) => { if (!seen.has(key)) { seen.add(key); report(`Wache ${n + 1} ${text}`); } };
        hole.towers.forEach((t, i) => { if (Math.hypot(st.x - t.x, st.z - t.z) < t.r + g.r) hit('t' + i, `läuft durch Turm ${i + 1}`); });
        solid.forEach((s, i) => { if (segDist(st.x, st.z, s) < g.r + (s.half || 0) - 0.02) hit('s' + i, 'läuft durch eine Mauer'); });
        if (!hole.onFloor(st.x, st.z) || hole.tileAtPos(st.x, st.z) === '~') hit('f', 'verlässt die Bahn');
        hole.spinners.forEach((sp, i) => { if (Math.hypot(st.x - sp.x, st.z - sp.z) < sp.len + g.r) hit('p' + i, `kreuzt Drehkreuz ${i + 1}`); });
      }
    });
    // Wachen untereinander (über einen langen Zeitraum, weil die Takte verschieden sind)
    for (let i = 0; i < hole.guards.length; i++) for (let j = i + 1; j < hole.guards.length; j++) {
      const a = hole.guards[i], b = hole.guards[j];
      let min = Infinity;
      for (let t = 0; t < 300; t += 0.01) {
        const p = guardState(a, t), q = guardState(b, t);
        min = Math.min(min, Math.hypot(p.x - q.x, p.z - q.z));
      }
      if (min < a.r + b.r) report(`Wache ${i + 1} und Wache ${j + 1} laufen ineinander (Abstand ${min.toFixed(2)})`);
    }
    hole.spinners.forEach((sp, n) => {
      hole.towers.forEach((t, i) => { if (Math.hypot(sp.x - t.x, sp.z - t.z) < sp.len + t.r) report(`Drehkreuz ${n + 1} streift Turm ${i + 1}`); });
      if (solid.some((s) => segDist(sp.x, sp.z, s) < sp.len + (s.half || 0) - 0.02)) report(`Drehkreuz ${n + 1} streift eine Mauer`);
    });
  });
}
console.log(bad ? `${bad} Überschneidung(en) gefunden` : 'Keine Überschneidungen');
process.exit(bad ? 1 : 0);
