// Everything you hear is synthesised in the browser — no audio files, same as
// the textures. Birds are frequency-swept sine chirps, the music is a slow
// generative pad, footsteps are filtered noise bursts, and the engine is an
// oscillator bank whose pitch follows the wheels.
//
// Browsers won't let audio start without a gesture, so nothing is built until
// the first click or key press.

const A = 440;
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];      // major pentatonic-ish, restful
const CHORDS = [[-12, -5, 0, 4], [-10, -3, 2, 5], [-14, -7, -2, 4], [-9, -2, 3, 7]];

const note = (semi) => A * Math.pow(2, semi / 12);

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.running = false;
    this.engineOn = false;
    this._timers = [];
  }

  /** Build the graph. Safe to call repeatedly; only the first does anything. */
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    const ctx = this.ctx = new Ctor();

    // Safari hands back a context that is already suspended, even when this
    // runs inside the tap that is meant to unlock it, and the branch above only
    // resumes a context that already existed — so on iOS the very first call
    // built the whole graph and left it silent. Chrome starts it running, which
    // is why this only ever showed up on iPhones. Resuming here fixes that, and
    // the empty buffer is the long-standing iOS handshake: the context isn't
    // truly unlocked until something has actually been played through it.
    if (ctx.state === 'suspended') ctx.resume();
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    } catch (err) { /* not fatal — the graph below still gets built */ }

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    // a little room, so the birds and the pad aren't bone dry
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(1.9, 2.6);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.34;
    this.verb.connect(this.verbGain);
    this.verbGain.connect(this.master);

    this.birdBus = ctx.createGain();
    this.birdBus.gain.value = 0.32;                 // gentle, as asked
    this.birdBus.connect(this.master);
    this.birdBus.connect(this.verb);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.16;                // sits well under everything
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.verb);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.7;
    this.sfxBus.connect(this.master);

    this.noise = this._noise(2.0);
    this._buildEngine();

    this.running = true;
    this._bird();
    this._chord();
  }

  toggle() {
    this.muted = !this.muted;
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.08);
    }
    return !this.muted;
  }

  // ------------------------------------------------------------- helpers ---
  /** Exponentially decaying noise — a serviceable room impulse response. */
  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const n = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, n, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
    }
    return buf;
  }

  _noise(seconds) {
    const rate = this.ctx.sampleRate;
    const n = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(1, n, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _later(fn, ms) {
    const id = setTimeout(() => {
      this._timers = this._timers.filter((t) => t !== id);
      fn();
    }, ms);
    this._timers.push(id);
  }

  // --------------------------------------------------------------- birds ---
  /** One chirp: a short swept sine with a fast attack. */
  _chirp(at, base, dur, up = true) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o.type = 'sine';

    const f0 = base * (up ? 0.82 : 1.18);
    const f1 = base * (up ? 1.25 : 0.8);
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + dur * 0.55);
    o.frequency.exponentialRampToValueAtTime(base * 0.95, at + dur);

    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.5, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    o.connect(g);
    if (p) { p.pan.value = (Math.random() * 2 - 1) * 0.7; g.connect(p); p.connect(this.birdBus); }
    else g.connect(this.birdBus);

    o.start(at);
    o.stop(at + dur + 0.05);
  }

  /** A phrase of two to five chirps, then quiet again for a while. */
  _bird() {
    if (!this.running) return;
    const now = this.ctx.currentTime;
    const base = 2100 + Math.random() * 1900;
    const n = 2 + Math.floor(Math.random() * 4);
    const gap = 0.07 + Math.random() * 0.09;
    for (let i = 0; i < n; i++) {
      this._chirp(now + 0.05 + i * gap,
        base * (1 + (Math.random() - 0.5) * 0.12),
        0.045 + Math.random() * 0.05,
        Math.random() > 0.35);
    }
    // occasionally a second bird answers from somewhere else
    if (Math.random() < 0.35) {
      const t = now + 0.6 + Math.random() * 0.8;
      const b2 = 1800 + Math.random() * 1600;
      for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
        this._chirp(t + i * 0.08, b2, 0.05, Math.random() > 0.5);
      }
    }
    this._later(() => this._bird(), 3200 + Math.random() * 7000);
  }

  // --------------------------------------------------------------- music ---
  /** One slow pad chord, faded in and out over several seconds. */
  _chord() {
    if (!this.running) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const chord = CHORDS[Math.floor(Math.random() * CHORDS.length)];
    const dur = 7 + Math.random() * 4;

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.exponentialRampToValueAtTime(0.5, now + dur * 0.35);
    bus.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + Math.random() * 500;
    lp.Q.value = 0.6;
    bus.connect(lp);
    lp.connect(this.musicBus);

    for (const semi of chord) {
      for (const detune of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = Math.random() > 0.5 ? 'triangle' : 'sine';
        o.frequency.value = note(semi);
        o.detune.value = detune;
        const g = ctx.createGain();
        g.gain.value = 0.16;
        o.connect(g); g.connect(bus);
        o.start(now);
        o.stop(now + dur + 0.2);
      }
    }

    // a single soft note on top, to give it some movement
    if (Math.random() < 0.7) {
      const semi = SCALE[Math.floor(Math.random() * SCALE.length)] + 12;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = note(semi);
      const t = now + 1 + Math.random() * 3;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
      o.connect(g); g.connect(this.musicBus); g.connect(this.verb);
      o.start(t); o.stop(t + 3.4);
    }

    this._later(() => this._chord(), (dur - 1.5) * 1000 + Math.random() * 3000);
  }

  // ----------------------------------------------------------- footsteps ---
  /** A filtered noise burst. Surface picks the colour of it. */
  footstep(surface = 'pavement', intensity = 1) {
    if (!this.running || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    const tone = { pavement: 1500, road: 1150, grass: 700 }[surface] || 1300;
    bp.frequency.value = tone * (0.85 + Math.random() * 0.3);
    bp.Q.value = surface === 'grass' ? 0.7 : 1.5;

    const g = ctx.createGain();
    const peak = (surface === 'grass' ? 0.16 : 0.26) * intensity;
    const dur = surface === 'grass' ? 0.13 : 0.085;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(peak, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    const off = Math.random() * 0.4;
    src.start(now, off, dur + 0.05);
  }

  // -------------------------------------------------------------- engine ---
  _buildEngine() {
    const ctx = this.ctx;
    this.eng = { osc: [], gain: ctx.createGain() };
    this.eng.gain.gain.value = 0;
    this.eng.gain.connect(this.master);

    this.eng.lp = ctx.createBiquadFilter();
    this.eng.lp.type = 'lowpass';
    this.eng.lp.frequency.value = 300;
    this.eng.lp.connect(this.eng.gain);

    // Kept deliberately soft: a single quiet saw for edge, triangles under it
    // for body. A square wave in here made it buzz like a hairdryer.
    for (const [mult, level, type] of [[1, 0.22, 'sawtooth'], [2, 0.10, 'triangle'],
                                       [0.5, 0.30, 'triangle']]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 40 * mult;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g); g.connect(this.eng.lp);
      o.start();
      this.eng.osc.push({ o, mult });
    }

    // tyre and wind roar, gated by speed
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 520;
    nf.Q.value = 0.5;
    this.eng.roll = ctx.createGain();
    this.eng.roll.gain.value = 0;
    src.connect(nf); nf.connect(this.eng.roll); this.eng.roll.connect(this.master);
    src.start();
  }

  /** Call every frame while driving. speed m/s, throttle 0..1. */
  engine(speed, throttle) {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    if (!this.engineOn) {
      this.engineOn = true;
      this.eng.gain.gain.setTargetAtTime(0.075, t, 0.5);
    }
    const v = Math.abs(speed);
    // fake gearing: pitch climbs, drops back at each change
    // longer gearing and a narrower rev band, so it burbles rather than screams
    const gear = Math.min(4, Math.floor(v / 7.0));
    const inGear = (v - gear * 7.0) / 7.0;
    const rpm = 30 + inGear * 24 + gear * 3;
    for (const { o, mult } of this.eng.osc) {
      o.frequency.setTargetAtTime(rpm * mult, t, 0.16);
    }
    this.eng.lp.frequency.setTargetAtTime(260 + throttle * 340 + v * 16, t, 0.3);
    this.eng.gain.gain.setTargetAtTime(0.055 + throttle * 0.045, t, 0.3);
    this.eng.roll.gain.setTargetAtTime(Math.min(0.045, v * 0.003), t, 0.35);
  }

  engineOff() {
    if (!this.running || !this.engineOn) return;
    this.engineOn = false;
    const t = this.ctx.currentTime;
    this.eng.gain.gain.setTargetAtTime(0, t, 0.2);
    this.eng.roll.gain.setTargetAtTime(0, t, 0.2);
  }
}
