// Burggolf – Spielablauf, Eingabe und Menüs
import { COURSES } from './levels.js';
import { buildHole, Sim, BALL_R } from './physics.js';
import { World } from './world.js';
import { Sound } from './audio.js';

const MAX_STROKES = 10;
const PLAYER_COLORS = ['#ffffff', '#ffd23f', '#6ec6ff', '#ff8fb1'];
const HAIR_COLORS = ['#5a3a1c', '#1f1a17', '#c9772c', '#d8c06a'];
const CHARGE_TIME = 2.5; // Sekunden, bis die Kraftleiste einmal voll ist
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const $ = (id) => document.getElementById(id);
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('burggolf.' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('burggolf.' + key, JSON.stringify(value)); } catch { /* privater Modus */ }
  },
  del(key) {
    try { localStorage.removeItem('burggolf.' + key); } catch { /* egal */ }
  },
};

// Alle Parcours vorbereiten; gespielt wird der gewählte
const courses = COURSES.map((c) => {
  const built = c.holes.map(buildHole);
  return { ...c, holes: built, par: built.reduce((s, h) => s + h.par, 0) };
});
let course, holes, coursePar;
function setCourse(id) {
  course = courses.find((c) => c.id === id) || courses[0];
  holes = course.holes;
  coursePar = course.par;
}
setCourse(store.get('course', courses[0].id));
// Rekorde je Parcours (der erste behält den alten Schlüssel, damit nichts verloren geht)
// und je Steuerung: 'overview' nutzt die bisherigen Schlüssel, 'classic' bekommt eigene
const VIEWS = { overview: 'Übersicht', classic: 'Klassisch' };
const viewId = () => (classic ? 'classic' : 'overview');
const bestKey = (view = viewId()) => (view === 'classic'
  ? `best.${course.id}.classic`
  : course === courses[0] ? 'best' : 'best.' + course.id);
const getBest = (view) => store.get(bestKey(view), null) || { total: null, holes: [] };
/** Steuerung einer ganzen Runde: 'overview', 'classic' oder 'mixed' (unterwegs gewechselt). */
function roundView(p) {
  const v = holes.map((_, i) => game.views[p][i] || 'overview');
  return v.every((x) => x === v[0]) ? v[0] : 'mixed';
}

const world = new World($('c'));
const sound = new Sound();
sound.on = store.get('sound', true);
let retro = store.get('retro', false);
// Steuerung: 'overview' (Schleuder in der Draufsicht) oder 'classic' (Kamera hinter dem Ball)
let classic = store.get('view', 'overview') === 'classic';
let aimAngle = 0; // Zielrichtung in der klassischen Ansicht (Bogenmaß)
let tilt = clamp(store.get('tilt', 0.35), 0, 1); // 0 = Weitsicht, 1 = Draufsicht
let charge = null; // { t, p, id } solange der Schlag-Knopf gehalten wird
let swingT = -1, swingFrom = 0; // Ausschwung-Animation
let peek = false; // Übersicht vorübergehend einblenden
let turnHold = null; // gehaltener Dreh-Knopf
const keys = new Set();

let game = null; // { players:[{name,color}], scores:[[…]], hole, player }
let sim = null;
let mode = 'menu'; // menu | aim | roll | wait | card
let paused = false;
let strokes = 0;
let holeView = null; // Steuerung, mit der die laufende Bahn gespielt wird
let lastPos = { x: 0, z: 0 };
let settle = 0;
let epoch = 0;
let drag = null;
let aimNow = null;
let cardAfter = null;

// ---------------------------------------------------------------- Hilfen ---
function after(ms, fn) {
  const e = epoch;
  setTimeout(() => { if (e === epoch) fn(); }, ms);
}

let toastTimer = 0;
function toast(text, ms = 1500) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = true;
  void el.offsetWidth; // Animation neu starten
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

let hintTimer = 0;
function hint(text, ms = 5000) {
  const el = $('hint');
  clearTimeout(hintTimer);
  if (!text) { el.hidden = true; return; }
  el.textContent = text;
  el.hidden = false;
  hintTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function show(id, on) { $(id).hidden = !on; }

function resultName(n, par, gaveUp) {
  if (gaveUp) return 'Maximum erreicht';
  if (n === 1) return 'Ass!';
  const d = n - par;
  if (d <= -3) return 'Albatros!';
  if (d === -2) return 'Eagle!';
  if (d === -1) return 'Birdie!';
  if (d === 0) return 'Par';
  if (d === 1) return 'Bogey';
  if (d === 2) return 'Doppel-Bogey';
  return `${n} Schläge`;
}

// ---------------------------------------------------------- Einstellungen ---
function applySettings() {
  for (const id of ['optSound', 'optSound2']) $(id).textContent = `Ton: ${sound.on ? 'an' : 'aus'}`;
  for (const id of ['optRetro', 'optRetro2']) $(id).textContent = `Retro-Pixel: ${retro ? 'an' : 'aus'}`;
  $('btnSound').textContent = sound.on ? '🔊' : '🔇';
  for (const id of ['optView', 'optView2']) $(id).textContent = `Steuerung: ${classic ? 'Klassisch' : 'Übersicht'}`;
  $('howText').textContent = classic
    ? 'Wischen dreht die Blickrichtung, hoch und runter kippt die Sicht. Schlag-Knopf halten und im richtigen Moment loslassen.'
    : 'Finger auf den Bildschirm, zurückziehen wie bei einer Schleuder, zielen und loslassen.';
}
function toggleView() {
  classic = !classic;
  store.set('view', classic ? 'classic' : 'overview');
  sound.click();
  peek = false;
  charge = null;
  endDrag();
  if (game && sim) resetAim();
  applySettings();
}
function resetAim() {
  // Richtung Loch, aber dem Bahnverlauf folgend (z. B. erst geradeaus durchs Tor)
  aimAngle = sim.hole.aimAngle(sim.ball.x, sim.ball.z);
}
function toggleSound() {
  sound.on = !sound.on;
  store.set('sound', sound.on);
  sound.unlock();
  sound.click();
  applySettings();
}
function toggleRetro() {
  retro = !retro;
  store.set('retro', retro);
  sound.click();
  applySettings();
  onResize();
}
function onResize() {
  world.resize(window.innerWidth, window.innerHeight, retro);
}
function goFullscreen(force = false) {
  const el = document.documentElement;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (!force && !touch) return;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) {
      // Kein Querformat-Zwang: Das Spiel passt sich Hoch- und Querformat an.
      el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
  } catch { /* nicht unterstützt (z. B. iPhone) */ }
}

// ----------------------------------------------------------------- Menü ---
let playerCount = store.get('count', 1);
let names = store.get('names', ['Spieler 1', 'Spieler 2', 'Spieler 3', 'Spieler 4']);

function renderNames() {
  const box = $('names');
  box.innerHTML = '';
  for (let i = 0; i < playerCount; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'name';
    const dot = document.createElement('i');
    dot.className = 'dot';
    dot.style.background = PLAYER_COLORS[i];
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 12;
    input.value = names[i] || `Spieler ${i + 1}`;
    input.setAttribute('aria-label', `Name Spieler ${i + 1}`);
    input.autocomplete = 'off';
    input.addEventListener('input', () => { names[i] = input.value; });
    wrap.append(dot, input);
    box.append(wrap);
  }
  for (const b of $('playerCount').children) b.classList.toggle('on', +b.dataset.n === playerCount);
}

function renderCourses() {
  const box = $('courseSel');
  box.innerHTML = '';
  for (const c of courses) {
    const b = document.createElement('button');
    b.textContent = c.name;
    b.dataset.id = c.id;
    b.classList.toggle('on', c === course);
    box.append(b);
  }
}

function showMenu() {
  epoch++;
  mode = 'menu';
  paused = false;
  game = null;
  drag = null;
  world.setAim(false);
  show('hud', false); show('power', false); show('card', false); show('pause', false);
  $('toast').hidden = true;
  hint(null);
  const idx = Math.floor(Math.random() * holes.length);
  world.setOrbit(true);
  world.setTheme(course.theme);
  world.build(holes[idx], idx + 1);
  sim = new Sim(holes[idx]);
  renderNames();
  renderCourses();
  $('menuSub').textContent = `${course.level} · ${holes.length} Bahnen · Par ${coursePar}`;
  const save = store.get('save', null);
  $('btnResume').hidden = !save;
  if (save) {
    const sc = courses.find((c) => c.id === save.course) || courses[0];
    const done = save.scores.every((s) => s[save.hole] != null);
    $('btnResume').textContent = `Fortsetzen: ${sc.name}, Bahn ${Math.min(save.hole + (done ? 2 : 1), sc.holes.length)}`;
  }
  const totals = Object.keys(VIEWS).map((v) => [VIEWS[v], getBest(v).total]);
  $('menuRecord').hidden = !totals.some(([, t]) => t);
  $('menuRecord').textContent = `Rekord ${course.name}: ` + totals.map(([n, t]) => `${n} ${t || '–'}`).join(' · ');
  $('optFull').hidden = !document.documentElement.requestFullscreen;
  applySettings();
  show('menu', true);
}

function startGame(resume = null) {
  sound.unlock();
  sound.click();
  goFullscreen();
  if (resume) {
    setCourse(resume.course);
    store.set('course', course.id);
    game = {
      players: resume.players.map((name, i) => ({ name, color: PLAYER_COLORS[i] })),
      scores: resume.scores,
      views: resume.views || resume.scores.map(() => []),
      hole: resume.hole,
      player: 0,
    };
  } else {
    const list = [];
    for (let i = 0; i < playerCount; i++) list.push((names[i] || '').trim() || `Spieler ${i + 1}`);
    store.set('names', names);
    store.set('count', playerCount);
    game = {
      players: list.map((name, i) => ({ name, color: PLAYER_COLORS[i] })),
      scores: list.map(() => []),
      views: list.map(() => []),
      hole: 0,
      player: 0,
    };
    store.del('save');
  }
  show('menu', false);
  world.setOrbit(false);
  world.setTheme(course.theme);
  loadHole(game.hole);
}

function saveGame() {
  if (!game) return;
  store.set('save', { course: course.id, players: game.players.map((p) => p.name), scores: game.scores, views: game.views, hole: game.hole });
}

// --------------------------------------------------------------- Ablauf ---
function loadHole(i) {
  epoch++;
  game.hole = i;
  const hole = holes[i];
  world.build(hole, i + 1);
  sim = new Sim(hole);
  show('hud', true);
  $('hudHole').textContent = `Bahn ${i + 1}/${holes.length}`;
  $('hudName').textContent = hole.name;
  $('hudPar').textContent = `Par ${hole.par}`;
  peek = false;
  charge = null;
  swingT = -1;
  hint(classic && i === 0 && course === courses[0] ? 'Wischen zum Zielen – Schlag-Knopf halten und loslassen.' : hole.def.hint, 5500);
  nextPlayer(true);
}

function nextPlayer(first = false) {
  const p = game.players.findIndex((_, idx) => game.scores[idx][game.hole] == null);
  if (p < 0) { showCard(); return; }
  game.player = p;
  strokes = 0;
  holeView = null;
  const hole = holes[game.hole];
  sim.placeBall(hole.tee.x, hole.tee.z);
  lastPos = { ...hole.tee };
  world.setBallColor(game.players[p].color);
  world.setGolferLook(game.players[p].color, HAIR_COLORS[p % HAIR_COLORS.length]);
  resetAim();
  mode = 'aim';
  settle = 0;
  updateHud();
  if (game.players.length > 1) toast(`${game.players[p].name} ist dran`, first ? 1800 : 1400);
}

function updateHud() {
  const pl = game.players[game.player];
  $('hudDot').style.background = pl.color;
  $('hudPlayer').textContent = pl.name;
  $('hudStrokes').textContent = mode === 'aim' ? `Schlag ${strokes + 1}` : `Schlag ${Math.max(1, strokes)}`;
}

function shoot(dx, dz, power) {
  if (mode !== 'aim') return;
  strokes++;
  // Merken, mit welcher Steuerung die Bahn gespielt wird (Wechsel mitten in der Bahn = gemischt)
  holeView = holeView == null || holeView === viewId() ? viewId() : 'mixed';
  lastPos = { x: sim.ball.x, z: sim.ball.z };
  sim.shoot(dx, dz, power);
  sound.putt(power);
  mode = 'roll';
  settle = 0;
  hint(null);
  updateHud();
}

function afterStroke() {
  if (strokes >= MAX_STROKES) { finishHole(MAX_STROKES, true); return; }
  resetAim();
  mode = 'aim';
  settle = 0;
  updateHud();
}

function finishHole(n, gaveUp = false) {
  mode = 'wait';
  const hole = holes[game.hole];
  game.scores[game.player][game.hole] = n;
  const view = holeView || viewId();
  game.views[game.player][game.hole] = view;
  saveGame();
  if (!gaveUp && view !== 'mixed') {
    const best = getBest(view);
    if (best.holes[game.hole] == null || n < best.holes[game.hole]) {
      best.holes[game.hole] = n;
      store.set(bestKey(view), best);
    }
  }
  toast(resultName(n, hole.par, gaveUp), 1700);
  if (gaveUp) sound.sad();
  else if (n === 1) sound.ace();
  updateHud();
  after(1900, () => nextPlayer());
}

function checkState(dt) {
  const st = sim.state;
  if (st === 'holed') {
    finishHole(Math.max(1, strokes));
  } else if (st === 'water' || st === 'out') {
    const penalty = st === 'water' && mode === 'roll';
    mode = 'wait';
    after(950, () => {
      if (penalty) { strokes++; toast('Platsch! +1 Strafschlag', 1300); }
      sim.placeBall(lastPos.x, lastPos.z);
      afterStroke();
    });
  } else if (mode === 'roll') {
    if (st === 'rest') { settle += dt; if (settle > 0.25) afterStroke(); } else settle = 0;
  }
}

function handleEvents() {
  const events = sim.events.splice(0);
  if (mode === 'menu') return;
  const hole = sim.hole;
  for (const e of events) {
    switch (e.type) {
      case 'holed':
        sound.cup();
        world.burst(hole.cup.x, hole.height(hole.cup.x, hole.cup.z), hole.cup.z, 'confetti');
        break;
      case 'water':
        sound.splash();
        world.burst(sim.ball.x, 0, sim.ball.z, 'water');
        break;
      case 'boost': sound.boost(); break;
      case 'tunnelIn': sound.tunnelIn(); break;
      case 'tunnelOut': sound.tunnelOut(); break;
      case 'out': break;
      default: sound.hit(e.type, e.strength || 1);
    }
  }
}

// ---------------------------------------------------------- Punktekarte ---
function sum(arr) { return arr.reduce((s, v) => s + (v || 0), 0); }

function renderCard(final) {
  const cur = game.hole;
  const played = (p) => game.scores[p].filter((v) => v != null).length;
  let html = '<thead><tr><th>Bahn</th>';
  holes.forEach((_, i) => { html += `<th class="${i === cur && !final ? 'cur' : ''}">${i + 1}</th>`; });
  html += '<th>Summe</th></tr></thead><tbody>';
  html += '<tr class="par"><td>Par</td>' + holes.map((h, i) => `<td class="${i === cur && !final ? 'cur' : ''}">${h.par}</td>`).join('') + `<td>${coursePar}</td></tr>`;
  game.players.forEach((pl, p) => {
    html += `<tr><td><i class="dot" style="background:${pl.color}"></i> ${escapeHtml(pl.name)}</td>`;
    holes.forEach((h, i) => {
      const v = game.scores[p][i];
      const cls = [i === cur && !final ? 'cur' : '', v == null ? '' : v < h.par ? 'under' : v > h.par ? 'over' : ''].join(' ').trim();
      html += `<td class="${cls}">${v == null ? '–' : v}</td>`;
    });
    const total = sum(game.scores[p]);
    const parSoFar = holes.slice(0, played(p)).reduce((s, h) => s + h.par, 0);
    const diff = total - parSoFar;
    html += `<td class="total">${total} <small>(${diff > 0 ? '+' : ''}${diff === 0 ? '±0' : diff})</small></td></tr>`;
  });
  for (const v of Object.keys(VIEWS)) {
    const best = getBest(v);
    if (best.total == null && !best.holes.some((x) => x != null)) continue;
    html += `<tr class="best"><td>Best<br>${VIEWS[v]}</td>` + holes.map((_, i) => `<td>${best.holes[i] ?? '–'}</td>`).join('') + `<td>${best.total ?? '–'}</td></tr>`;
  }
  html += '</tbody>';
  $('cardTable').innerHTML = html;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function showCard() {
  epoch++;
  mode = 'card';
  world.setAim(false);
  hint(null);
  const last = game.hole >= holes.length - 1;
  $('btnCardMenu').hidden = true;
  if (!last) {
    $('cardTitle').textContent = `Bahn ${game.hole + 1} geschafft`;
    $('cardSub').textContent = holes[game.hole].name;
    $('btnCardNext').textContent = 'Nächste Bahn';
    cardAfter = () => { show('card', false); loadHole(game.hole + 1); };
    renderCard(false);
  } else {
    // Runde beendet
    const totals = game.scores.map(sum);
    const min = Math.min(...totals);
    // Rekorde je Steuerung; eine Runde zählt nur, wenn sie durchgehend mit einer gespielt wurde
    const rv = game.players.map((_, p) => roundView(p));
    const records = [];
    for (const v of Object.keys(VIEWS)) {
      const mine = totals.filter((_, p) => rv[p] === v);
      if (!mine.length) continue;
      const best = getBest(v);
      const top = Math.min(...mine);
      if (best.total == null || top < best.total) {
        best.total = top;
        store.set(bestKey(v), best);
        records.push(VIEWS[v]);
      }
    }
    store.del('save');
    const winners = game.players.filter((_, p) => totals[p] === min).map((p) => p.name);
    $('cardTitle').textContent = `${course.name} geschafft`;
    let sub;
    if (game.players.length === 1) sub = `${min} Schläge bei Par ${coursePar}`;
    else if (winners.length === 1) sub = `${winners[0]} gewinnt mit ${min} Schlägen!`;
    else sub = `Unentschieden: ${winners.join(' und ')} mit ${min} Schlägen`;
    if (records.length) sub += ` · Neuer Rekord (${records.join(', ')})!`;
    else if (rv.every((v) => v === 'mixed')) sub += ' · Steuerung gewechselt – zählt nicht als Rekord';
    $('cardSub').textContent = sub;
    $('btnCardNext').textContent = 'Neue Runde';
    $('btnCardMenu').hidden = false;
    const again = game.players.map((p) => p.name);
    cardAfter = () => {
      show('card', false);
      game = { players: again.map((name, i) => ({ name, color: PLAYER_COLORS[i] })), scores: again.map(() => []), views: again.map(() => []), hole: 0, player: 0 };
      loadHole(0);
    };
    renderCard(true);
    sound.fanfare();
    const hole = holes[game.hole];
    world.burst(hole.cup.x, 0.2, hole.cup.z, 'confetti');
  }
  show('card', true);
}

// --------------------------------------------------------------- Eingabe ---
const canvas = $('c');

function computeAim() {
  if (!drag) return null;
  const b = sim.ball;
  const y = sim.hole.height(b.x, b.z) + BALL_R;
  const s = world.worldToScreen(b.x, y, b.z);
  const len = Math.hypot(drag.dx, drag.dy);
  if (len < 4) return null;
  const p = world.screenToGround(s.x + drag.dx, s.y + drag.dy, y);
  if (!p) return null;
  const dx = b.x - p.x, dz = b.z - p.z;
  const dl = Math.hypot(dx, dz);
  if (dl < 1e-4) return null;
  const maxDrag = Math.max(110, Math.min(240, 0.42 * Math.min(window.innerWidth, window.innerHeight)));
  return { dx: dx / dl, dz: dz / dl, power: Math.min(1, len / maxDrag) };
}

function endDrag() {
  drag = null;
  aimNow = null;
  world.setAim(false);
  show('power', false);
}

canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (paused || drag) return;
  if (classic) {
    // Klassisch: Wischen dreht (links/rechts) und kippt (hoch/runter) die Sicht
    if (mode === 'menu' || mode === 'card') return;
    drag = { id: e.pointerId, look: true, x: e.clientX, y: e.clientY };
  } else {
    if (mode !== 'aim') return;
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0 };
  }
  try { canvas.setPointerCapture(e.pointerId); } catch { /* egal */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.look) {
    aimAngle += (e.clientX - drag.x) * 0.0045;
    tilt = clamp(tilt + (e.clientY - drag.y) * 0.004, 0, 1);
    drag.x = e.clientX; drag.y = e.clientY;
    return;
  }
  drag.dx = e.clientX - drag.sx;
  drag.dy = e.clientY - drag.sy;
});
canvas.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.look) { drag = null; store.set('tilt', tilt); return; }
  const a = computeAim();
  endDrag();
  if (a && a.power >= 0.06 && mode === 'aim' && !paused) shoot(a.dx, a.dz, a.power);
});
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function setPowerBar(p) {
  show('power', true);
  $('powerFill').style.clipPath = `inset(0 ${100 - Math.round(p * 100)}% 0 0)`;
  $('powerText').textContent = `${Math.round(p * 100)} %`;
}

// ---- Klassische Steuerung ----------------------------------------------------
function startCharge(id) {
  if (!classic || mode !== 'aim' || paused || charge) return;
  sound.unlock();
  charge = { t: 0, p: 0, id };
}
function releaseCharge(id) {
  if (!charge || charge.id !== id) return;
  const p = charge.p;
  charge = null;
  show('power', false);
  if (p >= 0.04 && mode === 'aim' && !paused) {
    swingFrom = -0.2 - p * 0.9;
    swingT = 0;
    shoot(Math.cos(aimAngle), Math.sin(aimAngle), p);
  }
}

function updateClassic(dt) {
  const ch = world.chase;
  const inGame = mode !== 'menu';
  ch.on = classic && inGame;
  ch.peek = peek;
  ch.yaw = aimAngle;
  ch.tilt = tilt;
  ch.golferShow = classic && inGame && mode !== 'card';
  ch.golferFollow = mode === 'aim';
  if (!ch.on) { ch.swing = 0; return; }

  // Drehen und Kippen per Tasten oder Dreh-Knöpfen
  let turn = 0;
  if (keys.has('ArrowLeft')) turn -= 1;
  if (keys.has('ArrowRight')) turn += 1;
  if (turnHold) { turnHold.t += dt; if (turnHold.t > 0.28) turn += turnHold.dir * 0.55; }
  aimAngle += turn * dt * (keys.has('Shift') ? 0.25 : 1.1);
  if (keys.has('ArrowUp')) tilt = clamp(tilt - dt * 0.8, 0, 1);
  if (keys.has('ArrowDown')) tilt = clamp(tilt + dt * 0.8, 0, 1);

  // Kraftleiste pendelt, solange der Knopf gehalten wird
  if (charge && mode !== 'aim') { charge = null; show('power', false); }
  if (charge) {
    charge.t += dt;
    const ph = (charge.t / CHARGE_TIME) % 2;
    charge.p = ph < 1 ? ph : 2 - ph;
    setPowerBar(charge.p);
  }

  // Schläger: ausholen beim Aufladen, danach durchschwingen
  if (charge) ch.swing = -0.2 - charge.p * 0.9;
  else if (swingT >= 0) {
    swingT += dt;
    if (swingT < 0.12) ch.swing = swingFrom + (0.75 - swingFrom) * (swingT / 0.12);
    else if (swingT < 0.7) ch.swing = 0.75 * (1 - (swingT - 0.12) / 0.58);
    else { swingT = -1; ch.swing = 0; }
  } else ch.swing = 0;

  if (mode === 'aim') world.setAim(true, Math.cos(aimAngle), Math.sin(aimAngle), charge ? charge.p : 0.28);
  else world.setAim(false);
}

function updateClassicUi() {
  const playing = mode === 'aim' || mode === 'roll' || mode === 'wait';
  const want = classic && playing;
  if ($('classicBar').hidden === want) {
    show('classicBar', want);
    show('btnPeek', want);
    document.body.classList.toggle('classic', want);
  }
  $('btnShot').classList.toggle('off', mode !== 'aim');
  $('btnPeek').classList.toggle('on', peek);
}

function updateAim() {
  if (!drag) return;
  if (mode !== 'aim' || paused) { endDrag(); return; }
  aimNow = computeAim();
  if (aimNow && aimNow.power >= 0.06) {
    world.setAim(true, aimNow.dx, aimNow.dz, aimNow.power);
    setPowerBar(aimNow.power);
  } else {
    world.setAim(false);
    show('power', false);
  }
}

// -------------------------------------------------------------- Knöpfe ---
$('playerCount').addEventListener('click', (e) => {
  const n = +e.target.dataset?.n;
  if (!n) return;
  playerCount = n;
  sound.unlock(); sound.click();
  renderNames();
});
$('courseSel').addEventListener('click', (e) => {
  const id = e.target.dataset?.id;
  if (!id || id === course.id) return;
  setCourse(id);
  store.set('course', course.id);
  sound.unlock(); sound.click();
  showMenu();
});
$('btnStart').addEventListener('click', () => startGame());
$('btnResume').addEventListener('click', () => {
  const save = store.get('save', null);
  if (save) startGame(save); else startGame();
});
$('optSound').addEventListener('click', toggleSound);
$('optSound2').addEventListener('click', toggleSound);
$('btnSound').addEventListener('click', toggleSound);
$('optRetro').addEventListener('click', toggleRetro);
$('optRetro2').addEventListener('click', toggleRetro);
$('optView').addEventListener('click', toggleView);
$('optView2').addEventListener('click', toggleView);

// Schlag-Knopf: halten lädt auf, loslassen schlägt
const shotBtn = $('btnShot');
shotBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  startCharge(e.pointerId);
  try { shotBtn.setPointerCapture(e.pointerId); } catch { /* egal */ }
});
shotBtn.addEventListener('pointerup', (e) => releaseCharge(e.pointerId));
shotBtn.addEventListener('pointercancel', () => { charge = null; show('power', false); });
shotBtn.addEventListener('contextmenu', (e) => e.preventDefault());

// Dreh-Knöpfe: antippen = kleiner Schritt, halten = weiterdrehen
for (const [id, dir] of [['btnLeft', -1], ['btnRight', 1]]) {
  const el = $(id);
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (paused) return;
    aimAngle += dir * 0.01;
    turnHold = { dir, t: 0 };
    try { el.setPointerCapture(e.pointerId); } catch { /* egal */ }
  });
  for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, () => { turnHold = null; });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
$('btnPeek').addEventListener('click', () => { peek = !peek; sound.click(); });

// Tastatur (am PC): Pfeiltasten drehen und kippen, Leertaste schlägt
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === ' ' || e.key.startsWith('Arrow')) {
    if (mode !== 'menu' && mode !== 'card') e.preventDefault();
    if (e.key === ' ') { if (!e.repeat) startCharge('key'); } else keys.add(e.key);
  }
  if (e.key === 'Shift') keys.add('Shift');
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') releaseCharge('key');
  keys.delete(e.key);
});
window.addEventListener('blur', () => { keys.clear(); turnHold = null; });
$('optFull').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen?.(); else goFullscreen(true);
});
$('btnPause').addEventListener('click', () => {
  if (mode === 'menu' || mode === 'card') return;
  paused = true;
  endDrag();
  sound.click();
  show('pause', true);
});
$('btnContinue').addEventListener('click', () => { paused = false; sound.click(); show('pause', false); });
$('btnShowCard').addEventListener('click', () => {
  // Zwischenstand ansehen, danach zurück in die Pause
  sound.click();
  $('cardTitle').textContent = 'Zwischenstand';
  $('cardSub').textContent = `Bahn ${game.hole + 1}: ${holes[game.hole].name}`;
  $('btnCardNext').textContent = 'Zurück';
  $('btnCardMenu').hidden = true;
  const prev = cardAfter;
  cardAfter = () => { show('card', false); show('pause', true); cardAfter = prev; };
  renderCard(false);
  show('pause', false);
  show('card', true);
});
$('btnQuit').addEventListener('click', () => { sound.click(); showMenu(); });
$('btnCardNext').addEventListener('click', () => { sound.unlock(); sound.click(); cardAfter?.(); });
$('btnCardMenu').addEventListener('click', () => { sound.click(); showMenu(); });

window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
document.addEventListener('visibilitychange', () => { last = performance.now(); });

// ------------------------------------------------------------- Schleife ---
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  tick(dt);
  world.render();
  requestAnimationFrame(frame);
}

function tick(dt) {
  if (sim) {
    if (!paused) {
      sim.step(dt);
      handleEvents();
      if (mode === 'aim' || mode === 'roll') checkState(dt);
      updateClassic(dt);
      if (!classic) updateAim();
    }
    updateClassicUi();
    world.update(sim, paused ? 0 : dt);
  }
}

onResize();
showMenu();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Kleine Schnittstelle für Tests in der Browser-Konsole
window.burggolf = {
  get sim() { return sim; },
  get game() { return game; },
  get mode() { return mode; },
  world,
  /** Spult das Spiel um die angegebenen Sekunden vor (für Tests). */
  advance: (seconds) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) tick(1 / 60);
    world.render();
  },
  shoot: (angleDeg, power) => shoot(Math.cos((angleDeg * Math.PI) / 180), Math.sin((angleDeg * Math.PI) / 180), power),
  get classic() { return { on: classic, aimDeg: (aimAngle * 180) / Math.PI, tilt, charge: charge ? charge.p : null, peek }; },
  setTilt: (t) => { tilt = clamp(t, 0, 1); },
  /** Springt direkt auf eine Bahn (für Tests): Parcours-Kennung, Bahnnummer ab 1. */
  jump: (id, n) => {
    setCourse(id);
    game = { players: [{ name: 'Test', color: PLAYER_COLORS[0] }], scores: [[]], views: [[]], hole: n - 1, player: 0 };
    for (let i = 0; i < n - 1; i++) { game.scores[0][i] = holes[i].par; game.views[0][i] = viewId(); }
    show('menu', false); show('card', false);
    world.setOrbit(false);
    world.setTheme(course.theme);
    loadHole(n - 1);
  },
  setAim: (deg) => { aimAngle = (deg * Math.PI) / 180; },
};
