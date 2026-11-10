// Burggolf – Spielablauf, Eingabe und Menüs
import { COURSES } from './levels.js';
import { buildHole, Sim, BALL_R } from './physics.js';
import { World } from './world.js';
import { Sound } from './audio.js';

const MAX_STROKES = 10;
const PLAYER_COLORS = ['#ffffff', '#ffd23f', '#6ec6ff', '#ff8fb1'];

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

const course = COURSES[0];
const holes = course.holes.map(buildHole);
const coursePar = holes.reduce((s, h) => s + h.par, 0);

const world = new World($('c'));
const sound = new Sound();
sound.on = store.get('sound', true);
let retro = store.get('retro', false);

let game = null; // { players:[{name,color}], scores:[[…]], hole, player }
let sim = null;
let mode = 'menu'; // menu | aim | roll | wait | card
let paused = false;
let strokes = 0;
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
      el.requestFullscreen({ navigationUI: 'hide' })
        .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
        .catch(() => {});
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
  world.build(holes[idx], idx + 1);
  sim = new Sim(holes[idx]);
  renderNames();
  const save = store.get('save', null);
  $('btnResume').hidden = !save;
  if (save) {
    const done = save.scores.every((s) => s[save.hole] != null);
    $('btnResume').textContent = `Runde fortsetzen (Bahn ${Math.min(save.hole + (done ? 2 : 1), holes.length)})`;
  }
  const best = store.get('best', null);
  if (best?.total) {
    $('menuRecord').hidden = false;
    $('menuRecord').textContent = `Rekord: ${best.total} Schläge (Par ${coursePar})`;
  } else $('menuRecord').hidden = true;
  $('optFull').hidden = !document.documentElement.requestFullscreen;
  applySettings();
  show('menu', true);
}

function startGame(resume = null) {
  sound.unlock();
  sound.click();
  goFullscreen();
  if (resume) {
    game = {
      players: resume.players.map((name, i) => ({ name, color: PLAYER_COLORS[i] })),
      scores: resume.scores,
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
      hole: 0,
      player: 0,
    };
    store.del('save');
  }
  show('menu', false);
  world.setOrbit(false);
  loadHole(game.hole);
}

function saveGame() {
  if (!game) return;
  store.set('save', { players: game.players.map((p) => p.name), scores: game.scores, hole: game.hole });
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
  hint(hole.def.hint, 5500);
  nextPlayer(true);
}

function nextPlayer(first = false) {
  const p = game.players.findIndex((_, idx) => game.scores[idx][game.hole] == null);
  if (p < 0) { showCard(); return; }
  game.player = p;
  strokes = 0;
  const hole = holes[game.hole];
  sim.placeBall(hole.tee.x, hole.tee.z);
  lastPos = { ...hole.tee };
  world.setBallColor(game.players[p].color);
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
  mode = 'aim';
  settle = 0;
  updateHud();
}

function finishHole(n, gaveUp = false) {
  mode = 'wait';
  const hole = holes[game.hole];
  game.scores[game.player][game.hole] = n;
  saveGame();
  const best = store.get('best', { total: null, holes: [] });
  if (!gaveUp && (best.holes[game.hole] == null || n < best.holes[game.hole])) {
    best.holes[game.hole] = n;
    store.set('best', best);
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
  const best = store.get('best', { total: null, holes: [] });
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
  if (best.holes.some((v) => v != null)) {
    html += '<tr class="best"><td>Bestwert</td>' + holes.map((_, i) => `<td>${best.holes[i] ?? '–'}</td>`).join('') + `<td>${best.total ?? '–'}</td></tr>`;
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
    const best = store.get('best', { total: null, holes: [] });
    const record = best.total == null || min < best.total;
    if (record) { best.total = min; store.set('best', best); }
    store.del('save');
    const winners = game.players.filter((_, p) => totals[p] === min).map((p) => p.name);
    $('cardTitle').textContent = 'Runde beendet';
    let sub;
    if (game.players.length === 1) sub = `${min} Schläge bei Par ${coursePar}`;
    else if (winners.length === 1) sub = `${winners[0]} gewinnt mit ${min} Schlägen!`;
    else sub = `Unentschieden: ${winners.join(' und ')} mit ${min} Schlägen`;
    if (record) sub += ' · Neuer Rekord!';
    $('cardSub').textContent = sub;
    $('btnCardNext').textContent = 'Neue Runde';
    $('btnCardMenu').hidden = false;
    const again = game.players.map((p) => p.name);
    cardAfter = () => {
      show('card', false);
      game = { players: again.map((name, i) => ({ name, color: PLAYER_COLORS[i] })), scores: again.map(() => []), hole: 0, player: 0 };
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
  if (mode !== 'aim' || paused || drag) return;
  drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0 };
  try { canvas.setPointerCapture(e.pointerId); } catch { /* egal */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag.dx = e.clientX - drag.sx;
  drag.dy = e.clientY - drag.sy;
});
canvas.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const a = computeAim();
  endDrag();
  if (a && a.power >= 0.06 && mode === 'aim' && !paused) shoot(a.dx, a.dz, a.power);
});
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function updateAim() {
  if (!drag) return;
  if (mode !== 'aim' || paused) { endDrag(); return; }
  aimNow = computeAim();
  if (aimNow && aimNow.power >= 0.06) {
    world.setAim(true, aimNow.dx, aimNow.dz, aimNow.power);
    show('power', true);
    $('powerFill').style.clipPath = `inset(0 ${100 - Math.round(aimNow.power * 100)}% 0 0)`;
    $('powerText').textContent = `${Math.round(aimNow.power * 100)} %`;
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
      updateAim();
    }
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
};
