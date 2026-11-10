// Burggolf – Spielphysik (ohne Grafik, läuft auch in Node für die Tests)
//
// Koordinaten: Jede Kachel der Bahnkarte ist 1×1 groß. x läuft nach rechts,
// z nach unten (zur Kamera hin). Die Höhe (y) kommt aus hole.height(x, z).

export const BALL_R = 0.13;
export const CUP_R = 0.25;
export const MAX_SPEED = 15;
export const INNER_WALL_HALF = 0.07;

const DT = 1 / 300;
const FRICTION = 2.2;
const DRAG = 0.35;
const SAND_FRICTION = 9;
const SAND_DRAG = 1.2;
const GRAV = 10;
const CUP_CAPTURE_SPEED = 4.5;

// Welche Kachelkanten sind vollständig begehbar? (N, E, S, W)
const OPEN_EDGES = {
  '#': 'NESW', '~': 'NESW', ':': 'NESW',
  a: 'ES', // Ecke oben links abgeschnitten
  b: 'SW', // Ecke oben rechts abgeschnitten
  c: 'NW', // Ecke unten rechts abgeschnitten
  d: 'NE', // Ecke unten links abgeschnitten
};
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Baut aus einer Bahn-Definition (levels.js) die fertige Bahn mit Wänden. */
export function buildHole(def) {
  const rows = def.map.length;
  const cols = Math.max(...def.map.map((r) => r.length));
  const tiles = [];
  let tee = null;
  let cup = null;
  for (let r = 0; r < rows; r++) {
    const line = def.map[r].padEnd(cols, ' ');
    const row = [];
    for (let c = 0; c < cols; c++) {
      let ch = line[c];
      if (ch === 'T') { tee = { x: c + 0.5, z: r + 0.5 }; ch = '#'; }
      else if (ch === 'H') { cup = { x: c + 0.5, z: r + 0.5 }; ch = '#'; }
      else if (ch === '.') ch = ' ';
      row.push(ch);
    }
    tiles.push(row);
  }
  if (def.tee) tee = { x: def.tee[0], z: def.tee[1] };
  if (def.cup) cup = { x: def.cup[0], z: def.cup[1] };
  if (!tee || !cup) throw new Error(`Bahn "${def.name}": Abschlag oder Loch fehlt`);

  const tileAt = (c, r) => (r < 0 || r >= rows || c < 0 || c >= cols ? ' ' : tiles[r][c]);
  const isOpen = (c, r, edge) => (OPEN_EDGES[tileAt(c, r)] || '').includes(edge);

  // --- Randwände aus der Karte ableiten -----------------------------------
  let segs = [];
  const add = (x1, z1, x2, z2, nx, nz) => segs.push({ x1, z1, x2, z2, nx, nz, half: 0, kind: 'edge' });
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = tiles[r][c];
      if (ch === ' ') continue;
      if (isOpen(c, r, 'N') && !isOpen(c, r - 1, 'S')) add(c, r, c + 1, r, 0, 1);
      if (isOpen(c, r, 'S') && !isOpen(c, r + 1, 'N')) add(c, r + 1, c + 1, r + 1, 0, -1);
      if (isOpen(c, r, 'W') && !isOpen(c - 1, r, 'E')) add(c, r, c, r + 1, 1, 0);
      if (isOpen(c, r, 'E') && !isOpen(c + 1, r, 'W')) add(c + 1, r, c + 1, r + 1, -1, 0);
      const q = Math.SQRT1_2;
      if (ch === 'a') add(c, r + 1, c + 1, r, q, q);
      if (ch === 'b') add(c, r, c + 1, r + 1, -q, q);
      if (ch === 'c') add(c, r + 1, c + 1, r, -q, -q);
      if (ch === 'd') add(c, r, c + 1, r + 1, q, -q);
    }
  }
  segs = mergeSegments(segs);

  for (const w of def.walls || []) {
    const [x1, z1, x2, z2] = w;
    const len = Math.hypot(x2 - x1, z2 - z1);
    segs.push({ x1, z1, x2, z2, nx: -(z2 - z1) / len, nz: (x2 - x1) / len, half: INNER_WALL_HALF, kind: 'inner' });
  }

  // --- Höhenprofil ---------------------------------------------------------
  const relief = def.relief || [];
  const height = (x, z) => {
    let h = 0;
    for (const f of relief) {
      if (f.type === 'ramp') {
        const v = f.axis === 'z' ? z : x;
        h += f.h * clamp((v - f.from) / (f.to - f.from), 0, 1);
      } else if (f.type === 'mound') {
        const d = Math.hypot(x - f.x, z - f.z);
        if (d < f.r) h += f.h * 0.5 * (1 + Math.cos((Math.PI * d) / f.r));
      }
    }
    return h;
  };
  let maxHeight = 0;
  for (let r = 0; r <= rows * 2; r++) for (let c = 0; c <= cols * 2; c++) maxHeight = Math.max(maxHeight, height(c / 2, r / 2));

  return {
    def,
    name: def.name,
    par: def.par,
    cols, rows, tiles, tee, cup,
    segments: segs,
    height,
    flat: relief.length === 0,
    maxHeight,
    towers: (def.towers || []).map(([x, z, r]) => ({ x, z, r })),
    gates: (def.gates || []).map((g) => ({
      x1: g.seg[0], z1: g.seg[1], x2: g.seg[2], z2: g.seg[3],
      period: g.period ?? 3.2, open: g.open ?? 1.7, phase: g.phase ?? 0,
      half: INNER_WALL_HALF, kind: 'inner',
    })),
    spinners: (def.spinners || []).map((s) => ({ arms: 4, speed: 1.4, phase: 0, ...s })),
    guards: (def.guards || []).map((g) => ({
      x1: g.from[0], z1: g.from[1], x2: g.to[0], z2: g.to[1], period: g.period ?? 6, r: g.r ?? 0.32, phase: g.phase ?? 0,
    })),
    tunnels: (def.tunnels || []).map((t) => {
      const len = Math.hypot(t.dir[0], t.dir[1]);
      return { x: t.in[0], z: t.in[1], ox: t.out[0], oz: t.out[1], dx: t.dir[0] / len, dz: t.dir[1] / len, speed: t.speed ?? 5, r: 0.27 };
    }),
    tileAt,
    tileAtPos: (x, z) => tileAt(Math.floor(x), Math.floor(z)),
    onFloor: (x, z) => {
      const c = Math.floor(x), r = Math.floor(z);
      const ch = tileAt(c, r);
      const fx = x - c, fz = z - r;
      switch (ch) {
        case ' ': return false;
        case 'a': return fx + fz >= 1;
        case 'b': return fx <= fz;
        case 'c': return fx + fz <= 1;
        case 'd': return fx >= fz;
        default: return true;
      }
    },
  };
}

function mergeSegments(segs) {
  const eq = (a, b) => Math.abs(a - b) < 1e-9;
  let merged = true;
  while (merged) {
    merged = false;
    outer:
    for (let i = 0; i < segs.length; i++) {
      for (let j = 0; j < segs.length; j++) {
        if (i === j) continue;
        const a = segs[i], b = segs[j];
        if (!eq(a.nx, b.nx) || !eq(a.nz, b.nz)) continue;
        if (!eq(a.x2, b.x1) || !eq(a.z2, b.z1)) continue;
        // gleiche Richtung?
        const cross = (a.x2 - a.x1) * (b.z2 - b.z1) - (a.z2 - a.z1) * (b.x2 - b.x1);
        if (Math.abs(cross) > 1e-9) continue;
        a.x2 = b.x2; a.z2 = b.z2;
        segs.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return segs;
}

// --- Bewegliche Hindernisse (abhängig von der Zeit t) -----------------------

/** 0 = Fallgitter unten (zu), 1 = ganz oben (offen). */
export function gateLift(g, t) {
  const RAMP = 0.25;
  const u = (((t + g.phase) % g.period) + g.period) % g.period;
  if (u < RAMP) return u / RAMP;
  if (u < g.open) return 1;
  if (u < g.open + RAMP) return 1 - (u - g.open) / RAMP;
  return 0;
}

export function spinnerAngle(s, t) {
  return s.phase + s.speed * t;
}

export function guardState(g, t) {
  const w = (2 * Math.PI) / g.period;
  const s = 0.5 - 0.5 * Math.cos(w * (t + g.phase));
  const ds = 0.5 * w * Math.sin(w * (t + g.phase));
  return {
    x: g.x1 + (g.x2 - g.x1) * s,
    z: g.z1 + (g.z2 - g.z1) * s,
    vx: (g.x2 - g.x1) * ds,
    vz: (g.z2 - g.z1) * ds,
  };
}

// --- Simulation -------------------------------------------------------------

export class Sim {
  constructor(hole) {
    this.hole = hole;
    this.t = 0;
    this.acc = 0;
    this.ball = { x: hole.tee.x, z: hole.tee.z, vx: 0, vz: 0 };
    this.state = 'rest'; // rest | moving | holed | water | out | tunnel
    this.events = [];
    this.slowTime = 0;
    this.moveTime = 0;
    this.frozen = true;
    this.tunnel = null;
    this.tunnelTimer = 0;
    this._arm = { x1: 0, z1: 0, x2: 0, z2: 0, half: 0.08, kind: 'inner' };
  }

  placeBall(x, z) {
    Object.assign(this.ball, { x, z, vx: 0, vz: 0 });
    this.state = 'rest';
    this.frozen = true;
    this.slowTime = 0;
    this.moveTime = 0;
  }

  shoot(dx, dz, power) {
    const len = Math.hypot(dx, dz) || 1;
    const v = MAX_SPEED * clamp(power, 0, 1);
    this.ball.vx = (dx / len) * v;
    this.ball.vz = (dz / len) * v;
    this.state = 'moving';
    this.frozen = false;
    this.slowTime = 0;
    this.moveTime = 0;
  }

  get speed() {
    return Math.hypot(this.ball.vx, this.ball.vz);
  }

  step(dt) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= DT) {
      this.acc -= DT;
      this.sub();
    }
  }

  slope(x, z) {
    if (this.hole.flat) return [0, 0];
    const e = 0.02;
    const h = this.hole.height;
    return [(-GRAV * (h(x + e, z) - h(x - e, z))) / (2 * e), (-GRAV * (h(x, z + e) - h(x, z - e))) / (2 * e)];
  }

  bounce(nx, nz, wvx, wvz, type) {
    const b = this.ball;
    const rvx = b.vx - wvx, rvz = b.vz - wvz;
    const vn = rvx * nx + rvz * nz;
    if (vn >= 0) return;
    const sp = Math.hypot(rvx, rvz) || 1e-9;
    // Spiegelnde Reflexion wie beim Billard; frontale Treffer kosten mehr Tempo.
    const loss = 1 - 0.3 * (-vn / sp);
    b.vx = (rvx - 2 * vn * nx) * loss + wvx;
    b.vz = (rvz - 2 * vn * nz) * loss + wvz;
    if (-vn > 0.4) this.events.push({ type, strength: -vn });
    if (this.frozen && Math.hypot(b.vx, b.vz) > 0.05) { this.frozen = false; this.slowTime = 0; this.moveTime = 0; }
  }

  collideSeg(s, wvx = 0, wvz = 0, type = 'wall', spin = null) {
    const b = this.ball;
    const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
    const len2 = dx * dx + dz * dz;
    const tRaw = ((b.x - s.x1) * dx + (b.z - s.z1) * dz) / len2;
    const t = clamp(tRaw, 0, 1);
    const px = s.x1 + dx * t, pz = s.z1 + dz * t;
    const R = BALL_R + s.half;
    let nx, nz;
    if (s.kind === 'edge' && tRaw > 0 && tRaw < 1) {
      const sd = (b.x - px) * s.nx + (b.z - pz) * s.nz;
      // Nur nah an der Wand eingreifen (auch knapp dahinter, falls der Ball durchgerutscht ist).
      if (sd >= R || sd < -0.25) return;
      nx = s.nx; nz = s.nz;
    } else {
      nx = b.x - px; nz = b.z - pz;
      const d = Math.hypot(nx, nz);
      if (d >= R) return;
      if (d < 1e-7) { nx = s.nx ?? 0; nz = s.nz ?? 1; } else { nx /= d; nz /= d; }
    }
    b.x = px + nx * R;
    b.z = pz + nz * R;
    if (spin) { wvx = -spin.w * (pz - spin.z); wvz = spin.w * (px - spin.x); }
    this.bounce(nx, nz, wvx, wvz, type);
  }

  collideCircle(cx, cz, r, wvx = 0, wvz = 0, type = 'tower') {
    const b = this.ball;
    let nx = b.x - cx, nz = b.z - cz;
    const d = Math.hypot(nx, nz);
    const R = BALL_R + r;
    if (d >= R) return;
    if (d < 1e-7) { nx = 1; nz = 0; } else { nx /= d; nz /= d; }
    b.x = cx + nx * R;
    b.z = cz + nz * R;
    this.bounce(nx, nz, wvx, wvz, type);
  }

  sub() {
    const hole = this.hole;
    const b = this.ball;
    this.t += DT;

    if (this.state === 'tunnel') {
      this.tunnelTimer -= DT;
      if (this.tunnelTimer <= 0) {
        const tn = this.tunnel;
        b.x = tn.ox; b.z = tn.oz;
        b.vx = tn.dx * tn.speed; b.vz = tn.dz * tn.speed;
        this.state = 'moving';
        this.frozen = false;
        this.slowTime = 0;
        this.events.push({ type: 'tunnelOut' });
      }
      return;
    }
    if (this.state === 'holed' || this.state === 'water' || this.state === 'out') return;

    // --- Kräfte ---
    if (!this.frozen) {
      const sp = Math.hypot(b.vx, b.vz);
      const [gx, gz] = this.slope(b.x, b.z);
      const gm = Math.hypot(gx, gz);
      const sand = hole.tileAtPos(b.x, b.z) === ':';
      const fr = sand ? SAND_FRICTION : FRICTION;
      const dr = sand ? SAND_DRAG : DRAG;
      if (sp < 0.02) {
        if (gm <= fr) { b.vx = 0; b.vz = 0; }
        else { const k = (gm - fr) / gm; b.vx += gx * k * DT; b.vz += gz * k * DT; }
      } else {
        const nvx = b.vx + (gx - (fr * b.vx) / sp - dr * b.vx) * DT;
        const nvz = b.vz + (gz - (fr * b.vz) / sp - dr * b.vz) * DT;
        if (nvx * b.vx + nvz * b.vz <= 0 && gm <= fr) { b.vx = 0; b.vz = 0; }
        else { b.vx = nvx; b.vz = nvz; }
      }
      b.x += b.vx * DT;
      b.z += b.vz * DT;
    }

    // --- Kollisionen ---
    for (const s of hole.segments) this.collideSeg(s);
    for (const tw of hole.towers) this.collideCircle(tw.x, tw.z, tw.r);
    for (const g of hole.gates) if (gateLift(g, this.t) < 0.45) this.collideSeg(g, 0, 0, 'gate');
    for (const sp of hole.spinners) {
      const a0 = spinnerAngle(sp, this.t);
      const arm = this._arm;
      for (let i = 0; i < sp.arms; i++) {
        const a = a0 + (i * 2 * Math.PI) / sp.arms;
        arm.x1 = sp.x; arm.z1 = sp.z;
        arm.x2 = sp.x + Math.cos(a) * sp.len; arm.z2 = sp.z + Math.sin(a) * sp.len;
        this.collideSeg(arm, 0, 0, 'wood', { x: sp.x, z: sp.z, w: sp.speed });
      }
      this.collideCircle(sp.x, sp.z, 0.2, 0, 0, 'wood');
    }
    for (const g of hole.guards) {
      const st = guardState(g, this.t);
      this.collideCircle(st.x, st.z, g.r, st.vx, st.vz, 'guard');
    }

    // --- Loch ---
    const dcx = hole.cup.x - b.x, dcz = hole.cup.z - b.z;
    const dc = Math.hypot(dcx, dcz);
    const sp = Math.hypot(b.vx, b.vz);
    if (dc < CUP_R) {
      if ((dc < CUP_R * 0.8 && sp < CUP_CAPTURE_SPEED) || sp < 1.2) {
        b.vx = 0; b.vz = 0;
        this.state = 'holed';
        this.events.push({ type: 'holed' });
        return;
      }
      if (dc > 1e-6) { b.vx += (dcx / dc) * 25 * DT; b.vz += (dcz / dc) * 25 * DT; }
    }

    // --- Geheimgang ---
    for (const tn of hole.tunnels) {
      if (Math.hypot(tn.x - b.x, tn.z - b.z) < tn.r) {
        this.state = 'tunnel';
        this.tunnel = tn;
        this.tunnelTimer = 0.8;
        b.vx = 0; b.vz = 0;
        this.events.push({ type: 'tunnelIn' });
        return;
      }
    }

    // --- Wasser / Aus ---
    if (!hole.onFloor(b.x, b.z)) {
      b.vx = 0; b.vz = 0;
      this.state = 'out';
      this.events.push({ type: 'out' });
      return;
    }
    if (hole.tileAtPos(b.x, b.z) === '~') {
      b.vx = 0; b.vz = 0;
      this.state = 'water';
      this.events.push({ type: 'water' });
      return;
    }

    // --- Ruhe erkennen ---
    if (this.frozen) { this.state = 'rest'; return; }
    if (sp === 0) {
      this.state = 'rest';
      this.frozen = true;
      return;
    }
    this.state = 'moving';
    this.moveTime += DT;
    this.slowTime = sp < 0.12 ? this.slowTime + DT : 0;
    if (this.slowTime > 1.2 || this.moveTime > 25) {
      b.vx = 0; b.vz = 0;
      this.state = 'rest';
      this.frozen = true;
    }
  }
}
