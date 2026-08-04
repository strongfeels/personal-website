/**
 * Car radio — live internet stations, played only while driving.
 *
 * Every station here was checked to stream real audio frames over HTTPS, which
 * is a hard requirement: the game is served over HTTPS and a browser blocks a
 * plain-HTTP stream outright as mixed content. There is no client-side way
 * round it, and it is the reason most of the pirate and shortwave end of the
 * dial cannot be here — Rense, Republic Broadcasting, Revolution Radio, Ground
 * Zero, Spaced Out, Paranormal UK, WBCQ and WRMI were all tried, and every one
 * of them is still serving plain HTTP.
 *
 * There are then two playback paths, and which one a station takes depends on
 * whether it returns Access-Control-Allow-Origin:
 *
 *   MIXED (the default) — the stream is pulled into the game's own WebAudio
 *   graph with createMediaElementSource, so it sits under the same master gain
 *   as the engine and the birds. One mute covers it and it ducks properly.
 *
 *   DIRECT (`cors: false`) — no ACAO header, so the graph would only ever get
 *   silence from it. The element plays straight out to the speakers instead,
 *   which costs it its own volume handling and its own mute, and makes the
 *   ducking coarser. Worth it: it is the only way to have RTE, and most of the
 *   paranormal talk, on the dial at all.
 *
 * An element can only be captured by createMediaElementSource once and is
 * captured for life, so the two paths need two separate elements rather than
 * one that switches.
 *
 * Nothing is fetched until a car is entered — a live stream is about a megabyte
 * a minute, which is not something to spend while walking around.
 */

/**
 * One array, deliberately: adding or dropping a station is editing this and
 * nothing else. `cors: false` picks the direct path, `lvl` trims the level for
 * a station that runs hot or, for talk, needs to sit further forward.
 */
const DIAL = [
  { name: 'SomaFM Mission Control', url: 'https://ice1.somafm.com/missioncontrol-128-mp3' },
  { name: 'SomaFM SF 10-33',        url: 'https://ice1.somafm.com/sf1033-128-mp3' },
  { name: 'SomaFM Drone Zone',      url: 'https://ice1.somafm.com/dronezone-128-mp3' },
  { name: 'SomaFM Doomed',          url: 'https://ice1.somafm.com/doomed-128-mp3' },
  { name: 'SomaFM DEF CON',         url: 'https://ice1.somafm.com/defcon-128-mp3' },
  { name: 'Nightride FM',           url: 'https://stream.nightride.fm/nightride.mp3' },
  { name: 'FIP Paris',              url: 'https://icecast.radiofrance.fr/fip-midfi.mp3' },
  { name: 'NTS 1 London',           url: 'https://stream-relay-geo.ntslive.net/stream' },
  { name: 'WFMU Freeform',          url: 'https://stream0.wfmu.org/freeform-128k' },
  { name: 'Resonance FM',           url: 'https://stream.resonance.fm/resonance' },

  // The talk end of the dial. Speech needs to sit further forward than music or
  // it disappears under the engine, hence lvl above 1.
  { name: 'KHNC 1360 The Lion',     url: 'https://www.ophanim.net:8444/s/7250/', lvl: 1.35 },
  { name: 'K-Star Talk Radio',      url: 'https://c23.radioboss.fm/stream/204', lvl: 1.35 },
  // AAC rather than the .opus on the same host: Safari only learned Ogg Opus
  // recently and would have gone silent on older iPhones.
  { name: 'Alex Jones Show',        url: 'https://audio.alexjoneslive.com:8443/alexjonesshow.aac', lvl: 1.3 },
  { name: 'KPFA Berkeley',          url: 'https://streams.kpfa.org/kpfa_64.aac', lvl: 1.3 },
  { name: 'Dr. J Radio',            url: 'https://podradio.us/stream/drjradio-live', cors: false, lvl: 1.35 },
  { name: 'Free People of the Cosmos', url: 'https://podradio.us/stream/free-cosmos', cors: false, lvl: 1.35 },
  { name: 'Patriot Radio Classics', url: 'https://stream.radiojar.com/sqxkmtks1d5tv.m4a', cors: false, lvl: 1.3 },
  { name: 'WALM Old Time Radio',    url: 'https://icecast.walmradio.com:8443/walm2', cors: false, lvl: 1.3 },

  // Local, and last, so the dial ends up back at home.
  { name: 'RTE Radio 1',            url: 'https://icecast.rte.ie/radio1', cors: false, lvl: 1.25 },
  { name: 'RTE 2FM',                url: 'https://icecast.rte.ie/2fm', cors: false, lvl: 1.15 },
];

/**
 * The dial is shuffled, and shuffled per player rather than per visit.
 *
 * The seed is kept in localStorage, so your dial is your dial: station 4 stays
 * station 4 next time you come back, which is the whole point of a dial you
 * learn. A fresh shuffle on every page load would just be noise.
 *
 * Math.random cannot be seeded, so the shuffle runs off mulberry32 — small,
 * well distributed, and enough for ordering twenty things. If localStorage is
 * unavailable, which is what private browsing looks like, it falls back to an
 * unseeded shuffle: still random, just not remembered.
 *
 * Note this makes the opening station random too, since entering a car for the
 * first time tunes to position 0.
 */
function shuffled(list) {
  const KEY = 'clonskeagh.radio.seed';
  let seed;
  try {
    let stored = localStorage.getItem(KEY);
    if (!stored) {
      stored = String((Math.random() * 4294967296) >>> 0);
      localStorage.setItem(KEY, stored);
    }
    seed = Number(stored) >>> 0;
  } catch (err) {
    seed = (Math.random() * 4294967296) >>> 0;
  }
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {     // Fisher-Yates
    const j = Math.floor(rnd() * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
}

export const STATIONS = shuffled(DIAL);

const VOLUME = 0.55;        // sits under the engine rather than over it
const DUCK = 0.45;          // how far it drops at full throttle
const RETRY_LIMIT = 3;      // dead station: step along rather than sit silent

export class Radio {
  /** @param sound the game's Sound, for its context and master gain */
  constructor(sound) {
    this.sound = sound;
    this.station = -1;        // -1 is off
    this.prev = 0;            // what to come back to when switched on again
    this.mixed = null;        // routed through the game's mixer
    this.direct = null;       // straight out to the speakers
    this.el = null;           // whichever of the two is currently in use
    this.gain = null;
    this.routed = false;
    this.muted = false;
    this.throttle = 0;
    this.tuning = false;
    this.failures = 0;
    this.onstate = null;      // set by main.js to drive the HUD chip
  }

  get name() {
    return this.station < 0 ? null : STATIONS[this.station].name;
  }

  get level() {
    return this.station < 0 ? VOLUME : VOLUME * (STATIONS[this.station].lvl || 1);
  }

  /** Shared listeners. A stream that dies looks like an error or a stall, and
   *  either way the useful response is the next station, not a silent radio. */
  _wire(el) {
    el.preload = 'none';
    el.addEventListener('playing', () => {
      this.tuning = false;
      this.failures = 0;
      this._announce();
    });
    el.addEventListener('error', () => this._failed());
    el.addEventListener('stalled', () => this._failed());
    return el;
  }

  /** The mixed-path element, routed into the game's graph on first use. */
  _mixedEl() {
    if (!this.mixed) {
      this.mixed = this._wire(new Audio());
      this.mixed.crossOrigin = 'anonymous';   // must be set before it is captured
      this.mixed.volume = 1;                  // the gain node owns the level
    }
    // The context only exists after a user gesture. Getting into a car is one,
    // so by the time this runs there is normally a context waiting.
    if (!this.routed && this.sound.ctx && this.sound.master) {
      try {
        const src = this.sound.ctx.createMediaElementSource(this.mixed);
        this.gain = this.sound.ctx.createGain();
        this.gain.gain.value = VOLUME;
        src.connect(this.gain);
        this.gain.connect(this.sound.master);
        this.routed = true;
      } catch (err) {
        /* unrouted: it still plays, just outside the mixer */
      }
    }
    return this.mixed;
  }

  /** The direct-path element, for stations that send no CORS header. */
  _directEl() {
    if (!this.direct) this.direct = this._wire(new Audio());
    return this.direct;
  }

  _announce() {
    if (this.onstate) this.onstate(this.tuning ? 'tuning…' : this.name);
  }

  _failed() {
    if (this.station < 0) return;
    if (++this.failures > RETRY_LIMIT) { this.tune(-1); return; }
    this.next(1);
  }

  /** Tune to a station index; -1 turns it off. */
  tune(i) {
    if (i < 0) {
      if (this.station >= 0) this.prev = this.station;
      this.station = -1;
      this.off();
      return;
    }
    this.station = i;
    const s = STATIONS[i];
    const el = this.el = s.cors === false ? this._directEl() : this._mixedEl();
    if (this.mixed && el !== this.mixed) this.mixed.pause();
    if (this.direct && el !== this.direct) this.direct.pause();

    this.tuning = true;
    this._announce();
    this.update(this.throttle);
    el.src = s.url;
    el.load();
    const p = el.play();
    if (p && p.catch) p.catch(() => this._failed());
  }

  /**
   * Step to the next station, wrapping. Off is deliberately not a position in
   * this cycle: it has its own control at both ends — the chip's off half and
   * Shift+G — and with twenty stations, cycling into silence by accident would
   * otherwise mean twenty-one more presses to get back out of it.
   *
   * The cost of giving Shift+G to off is that there is no longer a "previous
   * station", so overshooting means going the long way round.
   */
  next(dir = 1) {
    const n = STATIONS.length;
    if (this.station < 0) { this.power(); return; }
    this.tune((this.station + dir + n) % n);
  }

  /** Switch on, back to whatever was last playing. */
  power() {
    this.tune(this.prev);
  }

  /** Called when a car is entered. Resumes whatever was last playing. */
  on() {
    if (this.station >= 0) this.tune(this.station);
    else this._announce();
  }

  off() {
    if (this.mixed) this.mixed.pause();
    if (this.direct) this.direct.pause();
    this.tuning = false;
    if (this.onstate) this.onstate(null);
  }

  /**
   * The mixed path is already under the master gain, so P covers it. The direct
   * path is outside the graph entirely and has to be muted by hand.
   */
  setMuted(m) {
    this.muted = !!m;
    if (this.direct) this.direct.muted = this.muted;
  }

  /** Duck under the engine, so hard acceleration doesn't fight the station. */
  update(throttle) {
    this.throttle = throttle || 0;
    const want = this.level * (1 - DUCK * Math.min(1, Math.abs(this.throttle)));
    if (this.gain && this.sound.ctx) {
      this.gain.gain.setTargetAtTime(want, this.sound.ctx.currentTime, 0.25);
    }
    if (this.direct) {
      this.direct.volume = Math.max(0, Math.min(1, want));
      this.direct.muted = this.muted;
    }
  }
}
