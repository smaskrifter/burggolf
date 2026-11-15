// Burggolf – 3D-Darstellung (three.js)
import * as THREE from '../vendor/three.module.min.js';
import { BALL_R, CUP_R, gateLift, spinnerAngle, guardState } from './physics.js';

const WALL_T = 0.16; // Dicke der Randmauer
const WALL_H = 0.2; // Mauerhöhe über dem Boden
const BASE_Y = -0.45; // Wiese rund um die Bahn
const SUB = 4; // Unterteilung pro Kachel (für Hügel und Rampen)
const TILT = (58 * Math.PI) / 180;

const col = (hex) => new THREE.Color(hex);
const C = {
  grassA: col(0x58c05c), grassB: col(0x4bb04f), high: col(0xb9f5a6),
  sandA: col(0xe9c46a), sandB: col(0xdcb458),
  stone: col(0x9a9da3), stoneDark: col(0x74777d), stoneLight: col(0xc3c6cc),
  meadow: 0x7fae52, water: 0x2f8fe0,
  roof: 0xb5402f, wood: 0x8a5a2b, iron: 0x2e3238,
};

/** Sammelt Dreiecke mit Farben und baut daraus ein einziges Netz. */
class Geo {
  constructor() { this.p = []; this.c = []; }
  tri(a, b, c, color) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.c.push(color.r, color.g, color.b);
  }
  quad(a, b, c, d, color) { this.tri(a, b, c, color); this.tri(a, c, d, color); }
  /** Säule über dem Viereck pts (xz), Oberkante je Punkt in tops, Unterkante yb. */
  prism(pts, tops, yb, side, top) {
    const T = pts.map((p, i) => [p[0], tops[i], p[1]]);
    const B = pts.map((p) => [p[0], yb, p[1]]);
    this.quad(T[0], T[1], T[2], T[3], top);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; this.quad(B[i], B[j], T[j], T[i], side); }
  }
  box(x0, x1, y0, y1, z0, z1, side, top) {
    this.prism([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [y1, y1, y1, y1], y0, side, top);
  }
  mesh(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, material);
  }
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.2, 400);
    this.fitCam = new THREE.PerspectiveCamera(38, 1, 0.5, 400); // nur zum Ausrechnen der Übersicht
    // Klassische Ansicht (Kamera hinter dem Ball); wird von main.js gesteuert
    this.chase = { on: false, yaw: 0, tilt: 0.35, peek: false, golferShow: false, golferFollow: false, swing: 0 };
    this.chaseCur = { x: 0, y: 0, z: 0, yaw: 0, tilt: 0.35 };
    this.blend = 0; // 0 = Übersicht, 1 = hinter dem Ball
    this.introHold = 0;
    this.snapPending = true;
    this.ovAz = 0;
    this.gAnchor = null;
    this._pos = new THREE.Vector3(); this._tgt = new THREE.Vector3();
    this._cpos = new THREE.Vector3(); this._ctgt = new THREE.Vector3();
    this.retro = false;
    this.w = 1; this.h = 1;
    this.azimuth = 0;
    this.orbit = false;
    this.zoomIntro = 1;
    this.hole = null;
    this.time = 0;

    this.scene.fog = new THREE.Fog(0xd6ecff, 45, 160);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7a4a, 1.5));
    const sun = new THREE.DirectionalLight(0xfff4dd, 2.2);
    sun.position.set(-4, 9, 6);
    this.scene.add(sun);
    this.sun = sun;

    const decal = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    this.mat = {
      static: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      water: new THREE.MeshLambertMaterial({ color: C.water, transparent: true, opacity: 0.92 }),
      stone: new THREE.MeshLambertMaterial({ color: 0x9a9da3, flatShading: true }),
      stoneLight: new THREE.MeshLambertMaterial({ color: 0xc3c6cc, flatShading: true }),
      roof: new THREE.MeshLambertMaterial({ color: C.roof, flatShading: true }),
      wood: new THREE.MeshLambertMaterial({ color: C.wood, flatShading: true }),
      iron: new THREE.MeshLambertMaterial({ color: C.iron, flatShading: true }),
      tunic: new THREE.MeshLambertMaterial({ color: 0x2f5fb3, flatShading: true }),
      silver: new THREE.MeshLambertMaterial({ color: 0xd8dde3, flatShading: true }),
      tree: new THREE.MeshLambertMaterial({ color: 0x2f7d3a, flatShading: true }),
      black: new THREE.MeshBasicMaterial({ color: 0x0b0b0b, ...decal }),
      white: new THREE.MeshBasicMaterial({ color: 0xf5f5f5, ...decal }),
      tee: new THREE.MeshBasicMaterial({ color: 0xcfeebf, transparent: true, opacity: 0.55, ...decal }),
      magic: new THREE.MeshBasicMaterial({ color: 0x7b4bc4, ...decal }),
      gold: new THREE.MeshBasicMaterial({ color: 0xe0b23a, ...decal }),
      flag: new THREE.MeshBasicMaterial({ color: 0xd62f2f, side: THREE.DoubleSide }),
      shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false, ...decal }),
    };

    const ground = new THREE.Mesh(new THREE.CircleGeometry(220, 40), new THREE.MeshLambertMaterial({ color: C.meadow }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = BASE_Y;
    this.scene.add(ground);
    this.ground = ground;

    this.holeGroup = new THREE.Group();
    this.scene.add(this.holeGroup);

    // Ball + Schatten
    this.ballMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R, 1), this.ballMat);
    this.scene.add(this.ball);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.05, 16), this.mat.shadow);
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);
    this.sink = 0;

    this.buildAim();
    this.buildParticles();
    this.buildGolfer();
    this.setTheme();
  }

  /** Stimmung eines Parcours: Himmel, Dunst, Sonnenlicht und Wiese. */
  setTheme(theme = {}) {
    const t = { sky: ['#5aa9e6', '#bfe0fb', '#eaf6ff'], fog: 0xd6ecff, sun: 0xfff4dd, meadow: C.meadow, ...theme };
    const key = JSON.stringify(t);
    if (key === this.themeKey) return;
    this.themeKey = key;
    this.scene.background?.dispose?.();
    this.scene.background = this.skyTexture(t.sky);
    this.scene.fog.color.set(t.fog);
    this.sun.color.set(t.sun);
    this.ground.material.color.set(t.meadow);
  }

  // --- Spielfigur (nur in der klassischen Ansicht) -----------------------------
  buildGolfer() {
    const L = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
    const M = this.golferMat = { shirt: L(0xffffff), hair: L(0x5a3a1c), skin: L(0xf0c39a), shorts: L(0x30343c), shoe: L(0xf2f2f2), club: L(0x8d949c) };
    const g = new THREE.Group();
    const box = (w, h, d, mat, x, y, z, parent = g) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    const limb = (a, b, r, mat) => {
      const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, va.distanceTo(vb), 6), mat);
      m.position.copy(va).add(vb).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
      g.add(m);
    };
    // Die Figur steht seitlich zum Ball: lokale x-Achse = Schlagrichtung, z-Achse = zum Ball hin.
    for (const sx of [-1, 1]) {
      box(0.15, 0.72, 0.17, M.skin, sx * 0.15, 0.45, 0);
      box(0.2, 0.09, 0.3, M.shoe, sx * 0.15, 0.045, 0.05);
      limb([sx * 0.27, 1.52, 0.05], [sx * 0.04, 1.03, 0.44], 0.055, M.skin);
    }
    box(0.5, 0.32, 0.27, M.shorts, 0, 0.93, 0);
    box(0.52, 0.56, 0.27, M.shirt, 0, 1.36, 0.03);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), M.skin);
    head.position.set(0, 1.82, 0.08);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.185, 10, 8), M.hair);
    hair.position.set(0, 1.86, 0.03);
    g.add(head, hair);
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.03, 0.45);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.0, 5), M.club);
    shaft.position.y = -0.5;
    pivot.add(shaft);
    box(0.17, 0.07, 0.07, M.club, 0.05, -0.99, 0, pivot);
    g.add(pivot);
    g.visible = false;
    this.golfer = g;
    this.clubPivot = pivot;
    this.scene.add(g);
  }

  setGolferLook(shirtHex, hairHex) {
    this.golferMat.shirt.color.set(shirtHex);
    this.golferMat.hair.color.set(hairHex);
  }

  skyTexture(colors) {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(0.55, colors[1]);
    grad.addColorStop(1, colors[2]);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  chevronTexture() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#e8452c';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(12, 8); g.lineTo(36, 32); g.lineTo(12, 56); g.lineTo(28, 56); g.lineTo(52, 32); g.lineTo(28, 8);
    g.closePath();
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    return t;
  }

  // --- Zielpfeil -------------------------------------------------------------
  buildAim() {
    const basic = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.aim = new THREE.Group();
    this.aim.visible = false;
    this.aimMat = basic(0x7cfc00, 0.95);
    const shaftGeo = new THREE.PlaneGeometry(1, 0.1);
    shaftGeo.rotateX(-Math.PI / 2);
    shaftGeo.translate(0.5, 0, 0);
    this.aimShaft = new THREE.Mesh(shaftGeo, this.aimMat);
    const headGeo = new THREE.BufferGeometry();
    headGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.17, 0, 0, 0.17, 0.34, 0, 0], 3));
    this.aimHead = new THREE.Mesh(headGeo, this.aimMat);
    this.aim.add(this.aimShaft, this.aimHead);
    this.aimDots = [];
    const dotGeo = new THREE.CircleGeometry(0.045, 10);
    dotGeo.rotateX(-Math.PI / 2);
    const dotMat = basic(0xffffff, 0.75);
    for (let i = 0; i < 8; i++) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      this.aimDots.push(d);
      this.aim.add(d);
    }
    this.aim.traverse((o) => { o.renderOrder = 20; });
    this.scene.add(this.aim);
  }

  setAim(visible, dx = 1, dz = 0, power = 0) {
    this.aim.visible = visible;
    if (!visible) return;
    this.aim.rotation.y = Math.atan2(-dz, dx);
    const len = 0.5 + power * 2.3;
    const start = BALL_R + 0.06;
    this.aimShaft.position.x = start;
    this.aimShaft.scale.x = len;
    this.aimHead.position.x = start + len;
    this.aimDots.forEach((d, i) => { d.position.x = start + len + 0.6 + i * 0.4; });
    // grün → gelb → rot
    const c = new THREE.Color();
    if (power < 0.5) c.setRGB(power * 2, 1, 0.1); else c.setRGB(1, 1 - (power - 0.5) * 1.8, 0.1);
    this.aimMat.color.copy(c);
  }

  // --- Partikel (Konfetti, Spritzer) ------------------------------------------
  buildParticles() {
    const N = 70;
    this.parts = { n: N, pos: new Float32Array(N * 3), vel: new Float32Array(N * 3), col: new Float32Array(N * 3), life: new Float32Array(N) };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.parts.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.parts.col, 3));
    this.partPoints = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.13, vertexColors: true, sizeAttenuation: true, depthWrite: false }));
    this.partPoints.frustumCulled = false;
    this.partPoints.renderOrder = 15;
    this.scene.add(this.partPoints);
    for (let i = 0; i < N; i++) this.parts.pos[i * 3 + 1] = -99;
  }

  burst(x, y, z, kind) {
    const P = this.parts;
    const palette = kind === 'water'
      ? [0xffffff, 0x9fd3ff, 0x4aa8f0]
      : [0xffd23f, 0xff5e5b, 0x3ddc97, 0x5aa9ff, 0xffffff, 0xf78fff];
    const c = new THREE.Color();
    const count = kind === 'water' ? 36 : P.n;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = kind === 'water' ? 0.6 + Math.random() * 1.2 : 0.8 + Math.random() * 2.2;
      P.pos[i * 3] = x; P.pos[i * 3 + 1] = y + 0.05; P.pos[i * 3 + 2] = z;
      P.vel[i * 3] = Math.cos(a) * sp;
      P.vel[i * 3 + 1] = (kind === 'water' ? 2 : 3.2) + Math.random() * 2.5;
      P.vel[i * 3 + 2] = Math.sin(a) * sp;
      c.set(palette[i % palette.length]);
      P.col[i * 3] = c.r; P.col[i * 3 + 1] = c.g; P.col[i * 3 + 2] = c.b;
      P.life[i] = 1.2 + Math.random() * 0.8;
    }
    this.partPoints.geometry.attributes.color.needsUpdate = true;
  }

  updateParticles(dt) {
    const P = this.parts;
    let any = false;
    for (let i = 0; i < P.n; i++) {
      if (P.life[i] <= 0) continue;
      any = true;
      P.life[i] -= dt;
      P.vel[i * 3 + 1] -= 9 * dt;
      P.pos[i * 3] += P.vel[i * 3] * dt;
      P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt;
      P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
      if (P.life[i] <= 0) P.pos[i * 3 + 1] = -99;
    }
    if (any) this.partPoints.geometry.attributes.position.needsUpdate = true;
  }

  // --- Bahn aufbauen ----------------------------------------------------------
  clearHole() {
    this.holeGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const tex of this.boostTextures || []) tex.dispose();
    this.boostTextures = [];
    this.holeGroup.clear();
    this.movers = { gates: [], spinners: [], guards: [] };
  }

  build(hole, seed = 1) {
    this.clearHole();
    this.hole = hole;
    const H = hole.height;
    const g = new Geo();
    const water = new Geo();
    let hasWater = false;

    // Boden
    const flips = { a: [0, 0], b: [1, 0], c: [1, 1], d: [0, 1] };
    for (let r = 0; r < hole.rows; r++) {
      for (let c = 0; c < hole.cols; c++) {
        const ch = hole.tiles[r][c];
        if (ch === ' ') continue;
        if (ch === '~') {
          hasWater = true;
          const y = -0.09;
          water.quad([c, y, r], [c, y, r + 1], [c + 1, y, r + 1], [c + 1, y, r], C.stone);
          continue;
        }
        const alt = (c + r) % 2 === 0;
        const base = ch === ':' ? (alt ? C.sandA : C.sandB) : (alt ? C.grassA : C.grassB);
        const flip = flips[ch];
        // Höher gelegene Flächen werden heller, damit man Hügel und Rampen erkennt.
        const shade = (x, z) => (hole.flat ? base : base.clone().lerp(C.high, Math.min(1, Math.max(0, H(x, z)) / 0.7) * 0.5));
        const P = (u, v) => {
          const fx = flip && flip[0] ? 1 - u : u;
          const fz = flip && flip[1] ? 1 - v : v;
          const x = c + fx, z = r + fz;
          return [x, H(x, z), z];
        };
        for (let j = 0; j < SUB; j++) {
          for (let i = 0; i < SUB; i++) {
            const u0 = i / SUB, u1 = (i + 1) / SUB, v0 = j / SUB, v1 = (j + 1) / SUB;
            const mid = P((u0 + u1) / 2, (v0 + v1) / 2);
            const color = shade(mid[0], mid[2]);
            if (!flip || i + j >= SUB) g.quad(P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1), color);
            else if (i + j === SUB - 1) g.tri(P(u1, v0), P(u1, v1), P(u0, v1), color);
          }
        }
        // Ufer zum Wasser
        const bank = (x1, z1, x2, z2) => g.quad([x1, H(x1, z1), z1], [x2, H(x2, z2), z2], [x2, -0.12, z2], [x1, -0.12, z1], C.stoneDark);
        if (hole.tileAt(c, r - 1) === '~') bank(c, r, c + 1, r);
        if (hole.tileAt(c, r + 1) === '~') bank(c, r + 1, c + 1, r + 1);
        if (hole.tileAt(c - 1, r) === '~') bank(c, r, c, r + 1);
        if (hole.tileAt(c + 1, r) === '~') bank(c + 1, r, c + 1, r + 1);
      }
    }

    // Mauern
    const corners = new Map();
    const noteCorner = (x, z, ox, oz) => {
      const key = `${x.toFixed(3)},${z.toFixed(3)}`;
      const e = corners.get(key) || { x, z, ox: 0, oz: 0, n: 0 };
      e.ox += ox; e.oz += oz; e.n++;
      corners.set(key, e);
    };
    for (const s of hole.segments) {
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
      const len = Math.hypot(dx, dz);
      const n = Math.max(1, Math.round(len / 0.5));
      const edge = s.kind === 'edge';
      const ox = -s.nx, oz = -s.nz;
      for (let k = 0; k < n; k++) {
        const ax = s.x1 + (dx * k) / n, az = s.z1 + (dz * k) / n;
        const bx = s.x1 + (dx * (k + 1)) / n, bz = s.z1 + (dz * (k + 1)) / n;
        const ha = H(ax, az) + WALL_H, hb = H(bx, bz) + WALL_H;
        let pts;
        if (edge) pts = [[ax, az], [bx, bz], [bx + ox * WALL_T, bz + oz * WALL_T], [ax + ox * WALL_T, az + oz * WALL_T]];
        else pts = [[ax - ox * s.half, az - oz * s.half], [bx - ox * s.half, bz - oz * s.half], [bx + ox * s.half, bz + oz * s.half], [ax + ox * s.half, az + oz * s.half]];
        g.prism(pts, [ha, hb, hb, ha], edge ? BASE_Y : Math.min(ha, hb) - WALL_H - 0.02, C.stone, C.stoneLight);
        if (edge && k % 2 === 0) {
          // Zinne
          const m = (t) => [ax + (bx - ax) * t, az + (bz - az) * t];
          const [m1x, m1z] = m(0.2), [m2x, m2z] = m(0.8);
          const top = Math.max(ha, hb) + 0.09;
          g.prism(
            [[m1x, m1z], [m2x, m2z], [m2x + ox * WALL_T, m2z + oz * WALL_T], [m1x + ox * WALL_T, m1z + oz * WALL_T]],
            [top, top, top, top], Math.min(ha, hb) - 0.01, C.stone, C.stoneLight,
          );
        }
      }
      if (edge) { noteCorner(s.x1, s.z1, ox, oz); noteCorner(s.x2, s.z2, ox, oz); }
      else {
        for (const [px, pz] of [[s.x1, s.z1], [s.x2, s.z2]]) {
          const y = H(px, pz);
          g.box(px - 0.1, px + 0.1, y - 0.02, y + WALL_H + 0.13, pz - 0.1, pz + 0.1, C.stoneDark, C.stoneLight);
        }
      }
    }
    // Eckpfeiler
    for (const e of corners.values()) {
      if (e.n < 2) continue;
      const cx = e.x + (e.ox * WALL_T) / 2, cz = e.z + (e.oz * WALL_T) / 2;
      const hs = WALL_T / 2 + 0.035;
      const y = H(e.x, e.z) + WALL_H + 0.2;
      g.box(cx - hs, cx + hs, BASE_Y, y, cz - hs, cz + hs, C.stoneDark, C.stoneLight);
    }

    this.buildScenery(hole, g, seed);

    this.holeGroup.add(g.mesh(this.mat.static));
    if (hasWater) {
      this.waterMesh = water.mesh(this.mat.water);
      this.holeGroup.add(this.waterMesh);
    } else this.waterMesh = null;

    const flat = (geo, mat, x, z, lift = 0.004) => {
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, H(x, z) + lift, z);
      this.holeGroup.add(m);
      return m;
    };

    // Abschlag, Loch, Fahne
    flat(new THREE.CircleGeometry(0.3, 20), this.mat.tee, hole.tee.x, hole.tee.z);
    flat(new THREE.RingGeometry(CUP_R, CUP_R + 0.035, 24), this.mat.white, hole.cup.x, hole.cup.z);
    flat(new THREE.CircleGeometry(CUP_R, 24), this.mat.black, hole.cup.x, hole.cup.z, 0.006);
    this.flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2, 6), this.mat.stoneLight);
    pole.position.y = 0.6;
    const shape = new THREE.Shape();
    shape.moveTo(0, 1.2); shape.lineTo(0.6, 0.98); shape.lineTo(0, 0.76); shape.closePath();
    const pennant = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.mat.flag);
    this.flag.add(pole, pennant);
    this.flag.position.set(hole.cup.x, H(hole.cup.x, hole.cup.z), hole.cup.z);
    this.flagLift = 0;
    this.holeGroup.add(this.flag);

    // Türme
    for (const t of hole.towers) {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(t.r * 0.94, t.r, 0.75, 12), this.mat.stone);
      body.position.y = 0.375;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(t.r * 1.08, t.r * 1.08, 0.14, 12), this.mat.stoneLight);
      ring.position.y = 0.8;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(t.r * 1.0, 0.5, 12), this.mat.roof);
      roof.position.y = 1.12;
      grp.add(body, ring, roof);
      grp.position.set(t.x, H(t.x, t.z), t.z);
      this.holeGroup.add(grp);
    }

    // Fallgitter
    for (const gt of hole.gates) {
      const dx = gt.x2 - gt.x1, dz = gt.z2 - gt.z1;
      const len = Math.hypot(dx, dz);
      const grp = new THREE.Group();
      grp.position.set((gt.x1 + gt.x2) / 2, H((gt.x1 + gt.x2) / 2, (gt.z1 + gt.z2) / 2), (gt.z1 + gt.z2) / 2);
      grp.rotation.y = Math.atan2(-dz, dx);
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.25, 0.22), this.mat.stone);
        post.position.set((sx * (len + 0.18)) / 2, 0.625, 0);
        grp.add(post);
      }
      for (const sx of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.24, 4), this.mat.roof);
        cap.rotation.y = Math.PI / 4;
        cap.position.set((sx * (len + 0.18)) / 2, 1.37, 0);
        grp.add(cap);
      }
      const grid = new THREE.Group();
      const bars = Math.max(3, Math.round(len / 0.2));
      for (let i = 0; i <= bars; i++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.56, 0.06), this.mat.iron);
        bar.position.set(-len / 2 + (len * i) / bars, 0.28, 0);
        grid.add(bar);
      }
      for (const y of [0.16, 0.5]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.07), this.mat.iron);
        bar.position.y = y;
        grid.add(bar);
      }
      grp.add(grid);
      // Leuchtstreifen am Boden: rot = zu, grün = offen
      const stripMat = new THREE.MeshBasicMaterial({ color: 0xe53935, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.36), stripMat);
      strip.rotation.x = -Math.PI / 2;
      strip.position.y = 0.005;
      grp.add(strip);
      this.holeGroup.add(grp);
      this.movers.gates.push({ def: gt, grid, stripMat });
    }

    // Drehkreuze
    for (const sp of hole.spinners) {
      const grp = new THREE.Group();
      grp.position.set(sp.x, H(sp.x, sp.z), sp.z);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.42, 10), this.mat.stone);
      hub.position.y = 0.21;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 10), this.mat.roof);
      cap.position.y = 0.52;
      const rotor = new THREE.Group();
      for (let i = 0; i < sp.arms; i++) {
        const holder = new THREE.Group();
        holder.rotation.y = (-i * 2 * Math.PI) / sp.arms;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(sp.len, 0.17, 0.16), this.mat.wood);
        arm.position.set(sp.len / 2, 0.13, 0);
        holder.add(arm);
        rotor.add(holder);
      }
      grp.add(hub, cap, rotor);
      this.holeGroup.add(grp);
      this.movers.spinners.push({ def: sp, rotor });
    }

    // Wachen
    for (const gd of hole.guards) {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(gd.r * 0.72, gd.r, 0.5, 10), this.mat.tunic);
      body.position.y = 0.25;
      const head = new THREE.Mesh(new THREE.SphereGeometry(gd.r * 0.55, 10, 8), this.mat.silver);
      head.position.y = 0.62;
      const helm = new THREE.Mesh(new THREE.ConeGeometry(gd.r * 0.5, 0.26, 10), this.mat.silver);
      helm.position.y = 0.86;
      const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.15, 5), this.mat.wood);
      spear.position.set(gd.r * 0.85, 0.575, 0);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.16, 5), this.mat.silver);
      tip.position.set(gd.r * 0.85, 1.22, 0);
      grp.add(body, head, helm, spear, tip);
      this.holeGroup.add(grp);
      this.movers.guards.push({ def: gd, grp });
    }

    // Turbofelder: Streifen mit laufenden Pfeilen
    this.boostTextures = [];
    for (const bo of hole.boosts) {
      const alongX = Math.abs(bo.dx) > Math.abs(bo.dz);
      const len = alongX ? bo.x1 - bo.x0 : bo.z1 - bo.z0;
      const wid = alongX ? bo.z1 - bo.z0 : bo.x1 - bo.x0;
      const tex = this.chevronTexture();
      // Pfeile etwa quadratisch kacheln, auch bei breiten Feldern
      const cell = Math.min(wid, 1);
      tex.repeat.set(Math.max(1, Math.round(len / cell)), Math.max(1, Math.round(wid / cell)));
      const geo = new THREE.PlaneGeometry(len, wid);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      const cx = (bo.x0 + bo.x1) / 2, cz = (bo.z0 + bo.z1) / 2;
      m.position.set(cx, H(cx, cz) + 0.004, cz);
      m.rotation.y = Math.atan2(-bo.dz, bo.dx);
      this.holeGroup.add(m);
      this.boostTextures.push(tex);
    }

    // Geheimgänge
    for (const tn of hole.tunnels) {
      flat(new THREE.RingGeometry(tn.r, tn.r + 0.1, 24), this.mat.magic, tn.x, tn.z);
      flat(new THREE.CircleGeometry(tn.r, 24), this.mat.black, tn.x, tn.z, 0.006);
      flat(new THREE.RingGeometry(0.2, 0.3, 24), this.mat.gold, tn.ox, tn.oz);
      flat(new THREE.CircleGeometry(0.2, 24), this.mat.black, tn.ox, tn.oz, 0.006);
    }

    this.zoomIntro = 1.3;
    this.sink = 0;
    this.blend = 0;
    this.introHold = 1.3;
    this.snapPending = true;
    this.gAnchor = null;
    this.fitCamera();
  }

  /** Kulisse: Burg im Hintergrund und ein paar Bäume. */
  buildScenery(hole, g, seed) {
    const rand = rng(seed * 7919 + 13);
    const W = hole.cols;
    const zc = -6.8;
    const x0 = W * 0.12, x1 = W * 0.88;
    // Ringmauer
    g.box(x0, x1, BASE_Y, 1.5, zc - 0.5, zc + 0.5, C.stone, C.stoneLight);
    for (let x = x0 + 0.2; x < x1 - 0.5; x += 1.0) g.box(x, x + 0.55, 1.5, 1.85, zc + 0.15, zc + 0.5, C.stone, C.stoneLight);
    // Tor
    const mid = (x0 + x1) / 2;
    g.box(mid - 0.6, mid + 0.6, BASE_Y, 0.9, zc + 0.5, zc + 0.52, C.stoneDark, C.stoneDark);
    // Bergfried
    g.box(mid - 1.2, mid + 1.2, BASE_Y, 3.3, zc - 2.6, zc - 0.6, C.stone, C.stoneLight);
    const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.5, 4), this.mat.roof);
    keepRoof.rotation.y = Math.PI / 4;
    keepRoof.position.set(mid, 4.05, zc - 1.6);
    this.holeGroup.add(keepRoof);
    // Ecktürme
    for (const x of [x0, x1]) {
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 3.2, 10), this.mat.stone);
      tw.position.set(x, BASE_Y + 1.6, zc);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.3, 10), this.mat.stoneLight);
      ring.position.set(x, BASE_Y + 3.3, zc);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.5, 10), this.mat.roof);
      roof.position.set(x, BASE_Y + 4.2, zc);
      this.holeGroup.add(tw, ring, roof);
    }
    // Bäume ringsum in einigem Abstand (in der klassischen Ansicht bilden sie den Horizont)
    const tree = (x, z, sc) => {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * sc, 0.14 * sc, 0.6 * sc, 6), this.mat.wood);
      trunk.position.set(x, BASE_Y + 0.3 * sc, z);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.7 * sc, 1.7 * sc, 7), this.mat.tree);
      crown.position.set(x, BASE_Y + 1.4 * sc, z);
      this.holeGroup.add(trunk, crown);
    };
    const cx = W / 2, cz = hole.rows / 2;
    const reach = Math.hypot(cx, cz);
    for (let i = 0; i < 34; i++) {
      const ang = (i / 34) * Math.PI * 2 + rand() * 0.15;
      const dist = reach + 7.5 + rand() * 11;
      const x = cx + Math.cos(ang) * dist, z = cz + Math.sin(ang) * dist;
      const sc = 1.0 + rand() * 1.2;
      if (x > x0 - 2 && x < x1 + 2 && z > zc - 4 && z < zc + 2) continue; // nicht in der Burg
      tree(x, z, sc);
    }
  }

  // --- Kamera ---------------------------------------------------------------
  resize(w, h, retro = this.retro) {
    this.w = w; this.h = h; this.retro = retro;
    if (retro) {
      const s = 240 / Math.min(w, h);
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)), false);
    } else {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(w, h, false);
    }
    this.canvas.classList.toggle('retro', retro);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.hole) this.fitCamera();
  }

  fitCamera() {
    const hole = this.hole;
    if (!hole) return;
    const cam = this.fitCam;
    cam.aspect = this.w / this.h;
    cam.updateProjectionMatrix();
    const az = this.orbit ? this.azimuth : (this.w >= this.h ? 0 : -Math.PI / 2);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(TILT), Math.sin(TILT), Math.cos(az) * Math.cos(TILT));
    const top = hole.maxHeight + 0.5;
    const pts = [];
    for (const x of [-0.2, hole.cols + 0.2]) for (const z of [-0.2, hole.rows + 0.2]) for (const y of [0, top]) pts.push(new THREE.Vector3(x, y, z));
    // sichtbarer Bereich in Bildschirmkoordinaten (-1…1), Platz für die Anzeige oben
    const narrow = this.w <= 600;
    const padX = this.orbit ? 0 : 20, padTop = this.orbit ? 0 : (narrow ? 100 : 58), padBottom = this.orbit ? 0 : 14;
    const xMax = 1 - (2 * padX) / this.w;
    const yMax = 1 - (2 * padTop) / this.h;
    const yMin = -1 + (2 * padBottom) / this.h;
    const target = new THREE.Vector3(hole.cols / 2, 0, hole.rows / 2);
    const v = new THREE.Vector3();
    const place = (dist) => {
      cam.position.copy(target).addScaledVector(dir, dist);
      cam.lookAt(target);
      cam.updateMatrixWorld();
    };
    let dist = 20;
    const tanHalf = Math.tan((cam.fov * Math.PI) / 360);
    for (let iter = 0; iter < 4; iter++) {
      let lo = 2, hi = 150;
      for (let i = 0; i < 22; i++) {
        const mid = (lo + hi) / 2;
        place(mid);
        let ok = true;
        for (const p of pts) {
          v.copy(p).project(cam);
          if (v.x < -xMax || v.x > xMax || v.y < yMin || v.y > yMax) { ok = false; break; }
        }
        if (ok) hi = mid; else lo = mid;
      }
      dist = hi;
      place(dist);
      // Mitte des Bildes auf die Mitte des freien Bereichs schieben
      let minX = 9, maxX = -9, minY = 9, maxY = -9;
      for (const p of pts) {
        v.copy(p).project(cam);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
      const offX = (minX + maxX) / 2;
      const offY = (minY + maxY) / 2 - (yMin + yMax) / 2;
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      target.addScaledVector(right, offX * dist * tanHalf * cam.aspect);
      target.addScaledVector(up, offY * dist * tanHalf);
    }
    this.ovAz = az;
    this.camTarget = target;
    this.camDir = dir;
    this.camDist = dist;
    this.applyCamera();
  }

  /** Bildwinkel der klassischen Ansicht: im Hochformat weiter, damit man seitlich genug sieht. */
  chaseFov() {
    const deg = (2 * Math.atan(Math.tan((24 * Math.PI) / 180) / (this.w / this.h)) * 180) / Math.PI;
    return Math.min(78, Math.max(46, deg));
  }

  /** Setzt die Kamera: Übersicht, hinter dem Ball oder eine weiche Mischung aus beidem. */
  applyCamera() {
    if (!this.camTarget) return;
    const cam = this.camera;
    const d = this.camDist * (this.orbit ? 1.12 : this.zoomIntro);
    const pos = this._pos.copy(this.camTarget).addScaledVector(this.camDir, d);
    const tgt = this._tgt.copy(this.camTarget);
    let fov = 38;
    const k = this.orbit ? 0 : this.blend * this.blend * (3 - 2 * this.blend);
    if (k > 0) {
      const c = this.chaseCur, t = c.tilt;
      const dx = Math.cos(c.yaw), dz = Math.sin(c.yaw);
      // t = 0: Weitsicht (flach, weit nach vorn) ... t = 1: Draufsicht (steil von oben)
      const back = 3.6 - 1.4 * t, height = 2.6 + 6.9 * t, ahead = 2.6 - 1.8 * t;
      this._cpos.set(c.x - dx * back, c.y + height, c.z - dz * back);
      this._ctgt.set(c.x + dx * ahead, c.y + 0.2, c.z + dz * ahead);
      pos.lerp(this._cpos, k);
      tgt.lerp(this._ctgt, k);
      fov += (this.chaseFov() - 38) * k;
    }
    cam.position.copy(pos);
    cam.lookAt(tgt);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }

  setBallColor(hex) {
    this.ballMat.color.set(hex);
  }

  /** Rechnet eine Bildschirmposition auf die Ebene y um. */
  screenToGround(sx, sy, y) {
    const ndc = new THREE.Vector3((sx / this.w) * 2 - 1, -(sy / this.h) * 2 + 1, 0.5).unproject(this.camera);
    const o = this.camera.position;
    const d = ndc.sub(o);
    if (Math.abs(d.y) < 1e-6) return null;
    const t = (y - o.y) / d.y;
    if (t <= 0) return null;
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }

  worldToScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h };
  }

  // --- pro Bild -------------------------------------------------------------
  update(sim, dt) {
    this.time += dt;
    const hole = this.hole;
    if (!hole) return;
    const H = hole.height;

    for (const m of this.movers.gates) {
      const lift = gateLift(m.def, sim.t);
      m.grid.position.y = lift * 0.72;
      m.stripMat.color.set(lift < 0.45 ? 0xe53935 : 0x43d15a);
    }
    for (const m of this.movers.spinners) m.rotor.rotation.y = -spinnerAngle(m.def, sim.t);
    for (const m of this.movers.guards) {
      const st = guardState(m.def, sim.t);
      m.grp.position.set(st.x, H(st.x, st.z), st.z);
      m.grp.rotation.y = st.vz >= 0 ? 0 : Math.PI;
    }
    if (this.waterMesh) this.waterMesh.position.y = Math.sin(this.time * 1.6) * 0.012;
    for (const tex of this.boostTextures || []) tex.offset.x = -(this.time * 1.8) % 1;

    // Ball
    const b = sim.ball;
    const y = H(b.x, b.z);
    const sinking = sim.state === 'holed' || sim.state === 'water' || sim.state === 'out';
    this.sink = sinking ? Math.min(1, this.sink + dt * 3.5) : 0;
    const showBall = !this.orbit && sim.state !== 'tunnel' && !(sinking && this.sink >= 1);
    this.ball.visible = showBall;
    this.shadow.visible = showBall && !sinking;
    if (showBall) {
      let bx = b.x, bz = b.z;
      if (sim.state === 'holed') { bx += (hole.cup.x - bx) * this.sink; bz += (hole.cup.z - bz) * this.sink; }
      this.ball.position.set(bx, y + BALL_R - this.sink * 0.3, bz);
      this.ball.scale.setScalar(1 - this.sink * 0.35);
      this.shadow.position.set(bx, y + 0.008, bz);
      const sp = Math.hypot(b.vx, b.vz);
      if (sp > 0.01) {
        this._axis = this._axis || new THREE.Vector3();
        this._axis.set(b.vz, 0, -b.vx).normalize();
        this.ball.rotateOnWorldAxis(this._axis, (sp * dt) / BALL_R);
      }
    }
    if (this.aim.visible) this.aim.position.set(b.x, y + 0.02, b.z);

    // Fahne hebt sich, wenn der Ball in der Nähe ist
    if (this.flag) {
      const near = !this.orbit && Math.hypot(b.x - hole.cup.x, b.z - hole.cup.z) < 1.6;
      this.flagLift += ((near ? 1 : 0) - this.flagLift) * Math.min(1, dt * 6);
      this.flag.position.y = H(hole.cup.x, hole.cup.z) + this.flagLift * 0.9;
      this.flag.children[1].rotation.y = Math.sin(this.time * 2.2) * 0.25;
      // Wimpel immer quer zur Blickrichtung
      const cy = this.chaseCur.yaw;
      this.flag.rotation.y = this.blend > 0.5 && !this.orbit ? Math.atan2(-Math.cos(cy), -Math.sin(cy)) : this.ovAz;
    }

    // Klassische Ansicht: Kamera folgt dem Ball weich, Figur steht am Ball
    const c = this.chase, cur = this.chaseCur;
    if (this.snapPending) {
      Object.assign(cur, { x: b.x, y, z: b.z, yaw: c.yaw, tilt: c.tilt });
      this.snapPending = false;
    }
    if (this.introHold > 0) this.introHold -= dt;
    const wantChase = c.on && !c.peek && this.introHold <= 0 && !this.orbit;
    this.blend += ((wantChase ? 1 : 0) - this.blend) * (1 - Math.exp(-dt * 5));
    if (Math.abs((wantChase ? 1 : 0) - this.blend) < 0.002) this.blend = wantChase ? 1 : 0;
    const kf = 1 - Math.exp(-dt * 9);
    cur.x += (b.x - cur.x) * kf; cur.y += (y - cur.y) * kf; cur.z += (b.z - cur.z) * kf;
    cur.tilt += (c.tilt - cur.tilt) * kf;
    const dyaw = Math.atan2(Math.sin(c.yaw - cur.yaw), Math.cos(c.yaw - cur.yaw));
    cur.yaw += dyaw * (1 - Math.exp(-dt * 12));

    const gf = this.golfer;
    gf.visible = c.on && c.golferShow && !this.orbit;
    if (gf.visible) {
      if (c.golferFollow || !this.gAnchor) this.gAnchor = { x: b.x, z: b.z, yaw: c.yaw };
      const a = this.gAnchor;
      const dx = Math.cos(a.yaw), dz = Math.sin(a.yaw);
      gf.position.set(a.x + dz * 0.45 - dx * 0.17, H(a.x, a.z), a.z - dx * 0.45 - dz * 0.17);
      gf.rotation.y = Math.atan2(-dz, dx);
      this.clubPivot.rotation.z = c.swing;
    }

    this.updateParticles(dt);

    if (this.orbit) {
      this.azimuth += dt * 0.12;
      this.fitCamera();
    } else {
      if (this.zoomIntro > 1) this.zoomIntro = Math.max(1, 1 + (this.zoomIntro - 1) * Math.exp(-dt * 3.2) - dt * 0.02);
      this.applyCamera();
    }
  }

  setOrbit(on) {
    this.orbit = on;
    if (this.hole) this.fitCamera();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
