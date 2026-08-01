// Third-person character — a Stick-RPG figure, but with joints that actually swing.
// The same body serves the player and everyone walking around (see npc.js).
import * as THREE from '../vendor/three.module.js';

const DEFAULT_LOOK = {
  skin: 0xe8bfa0, top: 0xb8422f, trousers: 0x2b3a55,
  shoe: 0x24242a, hair: 0x33251b, height: 1.0, build: 1.0,
};

/** Build a body. `look` varies colouring and proportions; geometry is shared. */
export function createCharacter(look = {}) {
  const L = { ...DEFAULT_LOOK, ...look };
  const g = new THREE.Group();
  const mats = {
    skin: new THREE.MeshStandardMaterial({ color: L.skin, roughness: 0.72 }),
    top: new THREE.MeshStandardMaterial({ color: L.top, roughness: 0.8 }),
    trousers: new THREE.MeshStandardMaterial({ color: L.trousers, roughness: 0.85 }),
    shoe: new THREE.MeshStandardMaterial({ color: L.shoe, roughness: 0.6 }),
    hair: new THREE.MeshStandardMaterial({ color: L.hair, roughness: 0.9 }),
  };
  const b = L.build;
  const mk = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mats[mat]);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  };

  const torso = mk(new THREE.CapsuleGeometry(0.19 * b, 0.44, 6, 12), 'top', 0, 1.16, 0);
  const head = mk(new THREE.SphereGeometry(0.155, 20, 16), 'skin', 0, 1.63, 0);
  const nose = mk(new THREE.SphereGeometry(0.04, 8, 8), 'skin', 0, 1.61, 0.15);
  const hair = mk(new THREE.SphereGeometry(0.162, 20, 16, 0, 6.3, 0, 1.15), 'hair', 0, 1.635, 0);

  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group();
    a.position.set(s * 0.245 * b, 1.36, 0);
    a.add(mk(new THREE.CapsuleGeometry(0.062, 0.30, 4, 8), 'top', 0, -0.17, 0),
          mk(new THREE.CapsuleGeometry(0.055, 0.26, 4, 8), 'skin', 0, -0.47, 0));
    g.add(a); arms.push(a);

    const l = new THREE.Group();
    l.position.set(s * 0.105 * b, 0.86, 0);
    l.add(mk(new THREE.CapsuleGeometry(0.078, 0.32, 4, 8), 'trousers', 0, -0.18, 0),
          mk(new THREE.CapsuleGeometry(0.068, 0.30, 4, 8), 'trousers', 0, -0.50, 0),
          mk(new THREE.BoxGeometry(0.13, 0.09, 0.26), 'shoe', 0, -0.72, 0.05));
    g.add(l); legs.push(l);
  }
  g.add(torso, head, nose, hair);
  g.scale.setScalar(L.height);
  return { group: g, arms, legs, head };
}

export const createPlayer = () => createCharacter();

/** Swing the limbs. `gait` is 0 when standing, 1 at a walk, higher at a run. */
export function animateWalk(c, phase, gait, amp = 0.85) {
  const sw = Math.sin(phase) * Math.min(1, gait);
  c.legs[0].rotation.x = sw * amp;
  c.legs[1].rotation.x = -sw * amp;
  c.arms[0].rotation.x = -sw * amp * 0.8;
  c.arms[1].rotation.x = sw * amp * 0.8;
}

export class PlayerController {
  constructor(player, camera, colliders, dom) {
    this.p = player;
    this.camera = camera;
    this.colliders = colliders;
    this.dom = dom;

    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;                 // facing
    this.camYaw = Math.PI;
    this.camPitch = 0.30;
    this.camDist = 7.0;
    this.firstPerson = false;
    this.onGround = true;
    this.phase = 0;
    this.speed = 0;

    this.keys = new Set();
    // set by the touch stick: an analogue -1..1 vector that overrides the keys
    this.analog = null;
    this._bind();
  }

  _bind() {
    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    let dragging = false, lx = 0, ly = 0;
    this.dom.addEventListener('mousedown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
    addEventListener('mouseup', () => { dragging = false; });
    addEventListener('mousemove', (e) => {
      if (!dragging && !document.pointerLockElement) return;
      const dx = document.pointerLockElement ? e.movementX : e.clientX - lx;
      const dy = document.pointerLockElement ? e.movementY : e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      this.camYaw -= dx * 0.0045;
      this.camPitch = Math.max(-0.35, Math.min(1.15, this.camPitch + dy * 0.0035));
    });
    this.dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist = Math.max(2.2, Math.min(28, this.camDist + e.deltaY * 0.012));
    }, { passive: false });
    this.dom.addEventListener('dblclick', () => this.dom.requestPointerLock());
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && document.pointerLockElement) document.exitPointerLock();
    });
  }

  update(dt) {
    const k = this.keys;
    let ix = 0, iz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) iz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) iz -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;

    // the stick is analogue, so it can also ask for a walk rather than a stride
    let throttle = 1;
    if (this.analog && (this.analog.x || this.analog.y)) {
      ix = this.analog.x;
      iz = -this.analog.y;                 // screen down is backwards
      throttle = Math.min(1, Math.hypot(ix, iz));
    }

    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const maxSpeed = (run ? 7.2 : 2.9) * throttle;

    // movement is relative to where the camera is looking
    const fx = -Math.sin(this.camYaw), fz = -Math.cos(this.camYaw);
    const rx = -fz, rz = fx;
    let mx = fx * iz + rx * ix, mz = fz * iz + rz * ix;
    const ml = Math.hypot(mx, mz);
    if (ml > 0.001) {
      mx /= ml; mz /= ml;
      this.yaw = Math.atan2(mx, mz);
    }
    const target = ml > 0.001 ? maxSpeed : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 11);

    let nx = this.pos.x + mx * this.speed * dt;
    let nz = this.pos.z + mz * this.speed * dt;
    [nx, nz] = this._resolve(nx, nz);
    this.pos.x = nx; this.pos.z = nz;

    // jump / gravity
    if (k.has('Space') && this.onGround) { this.vel.y = 4.6; this.onGround = false; }
    this.vel.y -= 14.5 * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }

    // ---- animate
    this.phase += this.speed * dt * 2.3;
    animateWalk(this.p, this.phase, this.speed / 3.4, run ? 1.15 : 0.85);
    const bob = this.onGround ? Math.abs(Math.cos(this.phase)) * 0.035 * Math.min(1, this.speed / 3) : 0;

    this.p.group.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    this.p.group.rotation.y = this.yaw;

    // ---- camera
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + 1.62, this.pos.z);
    const dist = this.firstPerson ? 0 : this._camDistClamped();

    // In a narrow side passage there is nowhere to put a third-person camera:
    // far enough back is inside the neighbour's wall, close enough is inside
    // the player's head. Slip to eye level instead — the view the F key gives
    // — rather than filling the screen with the back of a skull.
    //
    // The threshold is deliberately low. Over-the-shoulder still works at a
    // metre, and this should feel like a rescue from an impossible camera, not
    // like the game taking the camera off you. It never fires in the open, and
    // for roughly one angle in eight when you are right up against a house.
    const eyeLevel = this.firstPerson || dist < 0.9;
    this.p.group.visible = !eyeLevel;

    if (eyeLevel) {
      this.camera.position.copy(eye).addScaledVector(
        new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw)), 0.18);
      this.camera.lookAt(
        eye.x - Math.sin(this.camYaw) * 10,
        eye.y - Math.sin(this.camPitch) * 10,
        eye.z - Math.cos(this.camYaw) * 10);
    } else {
      const cy = Math.cos(this.camPitch);
      this.camera.position.set(
        this.pos.x + Math.sin(this.camYaw) * dist * cy,
        this.pos.y + 1.5 + Math.sin(this.camPitch) * dist + 0.4,
        this.pos.z + Math.cos(this.camYaw) * dist * cy);
      this.camera.lookAt(this.pos.x, this.pos.y + 1.25, this.pos.z);
    }
  }

  /** Don't let the camera sit inside a house.
   *
   *  Shrinking the distance until the end point happened to be clear was not
   *  enough. In a narrow gap between two houses every distance down to the old
   *  1.6m floor is still inside the neighbour, and the camera was simply left
   *  there — and from the inside a wall is a back face, so it disappears. That
   *  is the "invisible walls you can't walk through" effect: you were looking
   *  out through a house whose windows were still drawn.
   *
   *  So find where the sight line first crosses into something and stop just
   *  short of it, rather than sampling a few points along the way. One pass
   *  over the colliders instead of up to six.
   */
  /** Colliders bucketed by location, so walking and the camera both look at the
   *  handful nearby instead of all hundred-and-thirty thousand every frame.
   *  Each one goes in every cell it covers, so a point query only has to look
   *  at the cells it actually touches. Rebuilt when the list changes, which
   *  happens when you get into a car. */
  _viewGrid() {
    if (this._grid && this._gridN === this.colliders.length) return this._grid;
    const G = 16, cells = new Map();
    for (const c of this.colliders) {
      const r = c.hx + c.hz;
      for (let gx = Math.floor((c.x - r) / G); gx <= Math.floor((c.x + r) / G); gx++) {
        for (let gz = Math.floor((c.z - r) / G); gz <= Math.floor((c.z + r) / G); gz++) {
          const k = gx + ',' + gz;
          const a = cells.get(k);
          if (a) a.push(c); else cells.set(k, [c]);
        }
      }
    }
    this._gridN = this.colliders.length;
    return (this._grid = { G, cells });
  }

  _camDistClamped() {
    const cy = Math.cos(this.camPitch);
    const dx = Math.sin(this.camYaw) * cy, dz = Math.cos(this.camYaw) * cy;
    const PAD = 0.45;
    let best = this.camDist;

    // Only the cells the sight line can reach. Testing a collider twice costs
    // nothing — it yields the same answer — so there is no dedup here.
    const { G, cells } = this._viewGrid();
    const ex = this.pos.x + dx * best, ez = this.pos.z + dz * best;
    const gx0 = Math.floor((Math.min(this.pos.x, ex) - PAD) / G);
    const gx1 = Math.floor((Math.max(this.pos.x, ex) + PAD) / G);
    const gz0 = Math.floor((Math.min(this.pos.z, ez) - PAD) / G);
    const gz1 = Math.floor((Math.max(this.pos.z, ez) + PAD) / G);

    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
    const bucket = cells.get(gx + ',' + gz);
    if (!bucket) continue;
    for (const c of bucket) {
      if (c.soft) continue;                       // foliage blocks walking, not the view
      const ox = this.pos.x - c.x, oz = this.pos.z - c.z;
      const reach = c.hx + c.hz + PAD + best;     // hx+hz >= the half-diagonal, so this is safe
      if (ox > reach || ox < -reach || oz > reach || oz < -reach) continue;

      // Ray against an oriented box: rotate into the box's frame and do the
      // usual slab test.
      const co = Math.cos(-c.yaw), si = Math.sin(-c.yaw);
      const lx = ox * co - oz * si, lz = ox * si + oz * co;
      const rx = dx * co - dz * si, rz = dx * si + dz * co;
      const hx = c.hx + PAD, hz = c.hz + PAD;
      let t0 = 0, t1 = best;

      if (rx > -1e-6 && rx < 1e-6) {
        if (lx > hx || lx < -hx) continue;        // parallel and outside this slab
      } else {
        let a = (-hx - lx) / rx, b = (hx - lx) / rx;
        if (a > b) { const t = a; a = b; b = t; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) continue;
      }
      if (rz > -1e-6 && rz < 1e-6) {
        if (lz > hz || lz < -hz) continue;
      } else {
        let a = (-hz - lz) / rz, b = (hz - lz) / rz;
        if (a > b) { const t = a; a = b; b = t; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
        if (t0 > t1) continue;
      }
      // A roof is not an infinitely tall wall. When the camera is pitched up it
      // rides over the houses, so anything whose top is below the sight line
      // where it crosses simply isn't in the way.
      if (c.h !== undefined) {
        const rise = this.pos.y + 1.9 + Math.tan(this.camPitch) * t0;
        if (c.h + 0.4 < rise) continue;
      }
      if (t0 < best) best = t0;
    }
    }
    // When the player is pressed against a wall the line enters immediately and
    // this floor is all that is left. It has to stay under _resolve's 0.34m
    // standing distance, or the floor itself puts the camera through the wall
    // it is trying to avoid.
    return Math.max(0.25, best);
  }

  /** Run fn over every collider that could contain a point within `r` of x,z. */
  _near(x, z, r, fn) {
    const { G, cells } = this._viewGrid();
    for (let gx = Math.floor((x - r) / G); gx <= Math.floor((x + r) / G); gx++) {
      for (let gz = Math.floor((z - r) / G); gz <= Math.floor((z + r) / G); gz++) {
        const bucket = cells.get(gx + ',' + gz);
        if (!bucket) continue;
        for (const c of bucket) if (fn(c)) return true;
      }
    }
    return false;
  }

  _inside(x, z, pad) {
    return this._near(x, z, pad + 0.1, (c) => {
      const dx = x - c.x, dz = z - c.z;
      if (Math.abs(dx) > c.hx + c.hz + pad + 2) return false;
      const co = Math.cos(-c.yaw), si = Math.sin(-c.yaw);
      const lx = dx * co - dz * si, lz = dx * si + dz * co;
      return Math.abs(lx) < c.hx + pad && Math.abs(lz) < c.hz + pad;
    });
  }

  /** Push out of any building we've walked into, along the shallowest axis. */
  _resolve(x, z) {
    const pad = 0.34;
    for (let iter = 0; iter < 3; iter++) {
      let hit = false;
      // The push moves x,z, so the candidates are gathered fresh each pass.
      this._near(x, z, pad + 0.1, (c) => {
        const dx = x - c.x, dz = z - c.z;
        const reach = c.hx + c.hz + pad + 1;
        if (Math.abs(dx) > reach || Math.abs(dz) > reach) return false;
        const co = Math.cos(-c.yaw), si = Math.sin(-c.yaw);
        const lx = dx * co - dz * si, lz = dx * si + dz * co;
        const ox = c.hx + pad - Math.abs(lx);
        const oz = c.hz + pad - Math.abs(lz);
        if (ox <= 0 || oz <= 0) return false;
        let nlx = lx, nlz = lz;
        if (ox < oz) nlx += Math.sign(lx || 1) * ox;
        else nlz += Math.sign(lz || 1) * oz;
        const bc = Math.cos(c.yaw), bs = Math.sin(c.yaw);
        x = c.x + nlx * bc - nlz * bs;
        z = c.z + nlx * bs + nlz * bc;
        hit = true;
        return false;                      // keep going: other walls may still push
      });
      if (!hit) break;
    }
    return [x, z];
  }
}
