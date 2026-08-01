// Touch controls, for phones and tablets.
//
// Left thumb is an analogue stick — walking or steering. Right thumb drags to
// look, and two fingers pinch to pull the camera in and out. Buttons sit under
// the right thumb. Nothing here exists on a desktop; the whole overlay is only
// created when the device actually has a coarse pointer.
//
// The stick is analogue rather than four fake key presses, so you can amble.

const STICK_R = 62;          // px, radius of the stick's travel
const DEAD = 0.14;           // ignore the first fraction of the throw

export function hasTouch() {
  // ?touch=1 forces the overlay on, which is the only way to try it on a desktop
  if (new URLSearchParams(location.search).has('touch')) return true;
  return (('ontouchstart' in window) || navigator.maxTouchPoints > 0)
    && matchMedia('(pointer: coarse)').matches;
}

export class TouchControls {
  constructor(onAction) {
    this.move = { x: 0, y: 0 };     // -1..1, analogue
    this.look = { dx: 0, dy: 0 };   // consumed and cleared each frame
    this.pinch = 0;                 // camera distance delta, consumed per frame
    this.keys = new Set();          // virtual held buttons ('ShiftLeft', 'Space')
    this.onAction = onAction;       // one-shot taps, e.g. the car button

    this.stickId = null;
    this.lookId = null;
    this.lastLook = { x: 0, y: 0 };
    this.pinchStart = 0;

    this._build();
  }

  _build() {
    const wrap = document.createElement('div');
    wrap.id = 'touch';
    wrap.innerHTML = `
      <div id="t-stick"><div id="t-knob"></div></div>
      <div id="t-buttons">
        <button id="t-car" class="t-btn t-wide">Car</button>
        <div class="t-row">
          <button id="t-run" class="t-btn">Run</button>
          <button id="t-jump" class="t-btn">Jump</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    this.stick = wrap.querySelector('#t-stick');
    this.knob = wrap.querySelector('#t-knob');

    // held buttons
    const hold = (id, code) => {
      const el = wrap.querySelector(id);
      const down = (e) => { e.preventDefault(); this.keys.add(code); el.classList.add('on'); };
      const up = (e) => { e.preventDefault(); this.keys.delete(code); el.classList.remove('on'); };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend', up, { passive: false });
      el.addEventListener('touchcancel', up, { passive: false });
    };
    hold('#t-run', 'ShiftLeft');
    hold('#t-jump', 'Space');

    // one-shot button
    const car = wrap.querySelector('#t-car');
    car.addEventListener('touchstart', (e) => {
      e.preventDefault();
      car.classList.add('on');
      if (this.onAction) this.onAction('car');
    }, { passive: false });
    car.addEventListener('touchend', () => car.classList.remove('on'));

    // the stick
    this.stick.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this.stickId = t.identifier;
      this._stickTo(t);
    }, { passive: false });

    // look and pinch, anywhere that isn't a control
    const surface = document.getElementById('view');
    surface.addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        if (this.lookId === null) {
          this.lookId = t.identifier;
          this.lastLook = { x: t.clientX, y: t.clientY };
        }
      }
      if (e.touches.length === 2) {
        this.pinchStart = this._spread(e.touches);
      }
    }, { passive: false });

    const move = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === this.stickId) this._stickTo(t);
        else if (t.identifier === this.lookId) {
          this.look.dx += t.clientX - this.lastLook.x;
          this.look.dy += t.clientY - this.lastLook.y;
          this.lastLook = { x: t.clientX, y: t.clientY };
        }
      }
      if (e.touches.length === 2 && this.pinchStart) {
        const s = this._spread(e.touches);
        this.pinch += (this.pinchStart - s) * 0.05;
        this.pinchStart = s;
      }
    };
    addEventListener('touchmove', move, { passive: false });

    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.stickId) {
          this.stickId = null;
          this.move.x = this.move.y = 0;
          this.knob.style.transform = 'translate(-50%,-50%)';
        }
        if (t.identifier === this.lookId) this.lookId = null;
      }
      if (e.touches.length < 2) this.pinchStart = 0;
    };
    addEventListener('touchend', end);
    addEventListener('touchcancel', end);
  }

  _spread(touches) {
    return Math.hypot(touches[0].clientX - touches[1].clientX,
                      touches[0].clientY - touches[1].clientY);
  }

  _stickTo(t) {
    const r = this.stick.getBoundingClientRect();
    let dx = t.clientX - (r.left + r.width / 2);
    let dy = t.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const mag = Math.min(1, d / STICK_R);
    const scaled = mag < DEAD ? 0 : (mag - DEAD) / (1 - DEAD);
    const a = Math.atan2(dy, dx);
    this.move.x = Math.cos(a) * scaled;
    this.move.y = Math.sin(a) * scaled;      // screen down is +y
  }

  /** Read and clear the per-frame deltas. */
  takeLook() {
    const l = { dx: this.look.dx, dy: this.look.dy };
    this.look.dx = this.look.dy = 0;
    return l;
  }

  takePinch() {
    const p = this.pinch;
    this.pinch = 0;
    return p;
  }

  /** Swap the car button's label as you get in and out. */
  setDriving(driving) {
    const b = document.getElementById('t-car');
    if (b) b.textContent = driving ? 'Exit' : 'Car';
    const j = document.getElementById('t-jump');
    if (j) j.textContent = driving ? 'Brake' : 'Jump';
  }
}
