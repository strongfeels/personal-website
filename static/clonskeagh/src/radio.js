/**
 * Car radio — live internet stations, played only while driving.
 *
 * Every station here was checked to stream real MPEG frames over HTTPS and to
 * answer with Access-Control-Allow-Origin, and both of those are hard
 * requirements rather than preferences:
 *
 *   HTTPS, because the game is served over HTTPS and a browser hard-blocks a
 *   plain-HTTP stream as mixed content. This is the reason the list skews
 *   American and ambient rather than pirate — the obscure stations worth having
 *   are exactly the ones still running a bare icecast box on port 8000, and
 *   there is no client-side way around that.
 *
 *   CORS, because it lets the stream be pulled into the game's own WebAudio
 *   graph through createMediaElementSource. That is what keeps the radio under
 *   the same master gain as the engine and the birdsong, so one mute key covers
 *   everything and the radio ducks when the engine is working hard. Without it
 *   the audio element can still play, but only straight out to the speakers as
 *   a separate, unmixable voice.
 *
 * RTE streams fine and would be the obvious choice for a Dublin map, but it
 * sends no ACAO header, so including it would mean a second playback path with
 * its own volume and its own mute. It is left out on purpose.
 *
 * Nothing is buffered until you actually get into a car — a live stream is
 * about 1 MB a minute, which is not something to spend while walking around.
 */

/** One array, deliberately. Adding or dropping a station is editing this. */
export const STATIONS = [
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
];

const VOLUME = 0.55;        // sits under the engine rather than over it
const DUCK = 0.45;          // how far it drops at full throttle
const RETRY_LIMIT = 3;      // dead station: step along rather than sit silent

export class Radio {
  /** @param sound the game's Sound, for its context and master gain */
  constructor(sound) {
    this.sound = sound;
    this.station = -1;        // -1 is off, and off is a real position in the cycle
    this.el = null;
    this.gain = null;
    this.routed = false;
    this.tuning = false;
    this.failures = 0;
    this.onstate = null;      // set by main.js to drive the HUD chip
  }

  get name() {
    return this.station < 0 ? null : STATIONS[this.station].name;
  }

  /** The <audio> element, built on first use so nothing is fetched before then. */
  _element() {
    if (this.el) return this.el;
    const el = this.el = new Audio();
    el.crossOrigin = 'anonymous';   // required before the element is ever routed
    el.preload = 'none';
    el.volume = VOLUME;             // only used if the WebAudio route isn't available

    el.addEventListener('playing', () => {
      this.tuning = false;
      this.failures = 0;
      this._announce();
    });
    // A live stream that dies looks like an error or a stall, and either way the
    // useful response is the next station along, not a silent radio.
    el.addEventListener('error', () => this._failed());
    el.addEventListener('stalled', () => this._failed());
    return el;
  }

  /**
   * Route the element through the game's mixer. Only possible once the audio
   * context exists, which needs a user gesture — getting into a car is one, so
   * by the time this runs there is normally a context waiting.
   */
  _route() {
    if (this.routed || !this.sound.ctx || !this.sound.master) return;
    try {
      const src = this.sound.ctx.createMediaElementSource(this.el);
      this.gain = this.sound.ctx.createGain();
      this.gain.gain.value = VOLUME;
      src.connect(this.gain);
      this.gain.connect(this.sound.master);
      this.el.volume = 1;           // the gain node owns the level from here
      this.routed = true;
    } catch (err) {
      /* left unrouted: the element still plays, just outside the mixer */
    }
  }

  _announce() {
    if (this.onstate) this.onstate(this.tuning ? 'tuning…' : this.name);
  }

  _failed() {
    if (this.station < 0) return;
    if (++this.failures > RETRY_LIMIT) { this.off(); return; }
    this.next(1);
  }

  /** Tune to a station index; -1 turns it off. */
  tune(i) {
    this.station = i;
    if (i < 0) {
      if (this.el) this.el.pause();
      this.tuning = false;
      this._announce();
      return;
    }
    const el = this._element();
    this._route();
    this.tuning = true;
    this._announce();
    el.src = STATIONS[i].url;
    el.load();
    const p = el.play();
    if (p && p.catch) p.catch(() => this._failed());
  }

  /** Step through the cycle: every station, then off, then round again. */
  next(dir = 1) {
    const n = STATIONS.length;
    // positions 0..n-1 are stations and n is off, so the cycle is n+1 long
    const at = this.station < 0 ? n : this.station;
    const to = (at + dir + n + 1) % (n + 1);
    this.tune(to === n ? -1 : to);
  }

  /** Called when a car is entered. Resumes whatever was last playing. */
  on() {
    if (this.station < 0) return;
    this.tune(this.station);
  }

  off() {
    if (this.el) this.el.pause();
    this.tuning = false;
    if (this.onstate) this.onstate(null);
  }

  /** Duck under the engine, so hard acceleration doesn't fight the music. */
  update(throttle) {
    if (!this.gain || !this.sound.ctx) return;
    const want = VOLUME * (1 - DUCK * Math.min(1, Math.abs(throttle || 0)));
    this.gain.gain.setTargetAtTime(want, this.sound.ctx.currentTime, 0.25);
  }
}
