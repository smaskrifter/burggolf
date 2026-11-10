// Burggolf – Töne (werden im Browser erzeugt, keine Audiodateien nötig)

export class Sound {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.lastHit = 0;
  }

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    } catch { /* kein Ton verfügbar */ }
  }

  tone(freq, dur, { type = 'sine', vol = 0.2, at = 0, to = null } = {}) {
    if (!this.on || !this.ctx) return;
    const t0 = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise(dur, { vol = 0.2, from = 2000, to = 400, at = 0 } = {}) {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + at;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t0);
  }

  click() { this.tone(660, 0.05, { type: 'triangle', vol: 0.12 }); }

  putt(power) {
    this.tone(210 + power * 120, 0.09, { type: 'triangle', vol: 0.18 + power * 0.2, to: 90 });
    this.noise(0.04, { vol: 0.12 + power * 0.15, from: 3000, to: 800 });
  }

  hit(kind, strength) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastHit < 0.035) return;
    this.lastHit = now;
    const vol = Math.min(0.3, 0.04 + strength * 0.03);
    if (kind === 'wood' || kind === 'guard') this.tone(190, 0.09, { type: 'square', vol: vol * 0.7, to: 120 });
    else if (kind === 'gate') this.tone(520, 0.12, { type: 'sawtooth', vol: vol * 0.5, to: 300 });
    else this.tone(kind === 'tower' ? 300 : 380, 0.06, { type: 'triangle', vol, to: 200 });
  }

  cup() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.22, at: 0.1 + i * 0.09 }));
    this.tone(140, 0.12, { type: 'sine', vol: 0.3, to: 70 });
  }

  ace() {
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.3, { type: 'square', vol: 0.12, at: 0.1 + i * 0.08 }));
  }

  splash() {
    this.noise(0.5, { vol: 0.35, from: 2600, to: 300 });
    this.tone(300, 0.3, { vol: 0.12, to: 80 });
  }

  tunnelIn() { this.tone(700, 0.5, { type: 'sine', vol: 0.2, to: 120 }); }
  tunnelOut() { this.tone(160, 0.3, { type: 'sine', vol: 0.2, to: 800 }); }

  fanfare() {
    const notes = [523, 523, 523, 659, 784, 659, 784, 1047];
    const times = [0, 0.15, 0.3, 0.45, 0.75, 0.95, 1.1, 1.3];
    notes.forEach((f, i) => this.tone(f, i === notes.length - 1 ? 0.7 : 0.18, { type: 'square', vol: 0.13, at: times[i] }));
  }

  sad() {
    this.tone(330, 0.25, { type: 'triangle', vol: 0.18, to: 260 });
    this.tone(247, 0.4, { type: 'triangle', vol: 0.18, at: 0.25, to: 180 });
  }
}
