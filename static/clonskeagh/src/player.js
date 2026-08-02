// Third-person character — a Stick-RPG figure, but with joints that actually swing.
// The same body serves the player and everyone walking around (see npc.js).
import * as THREE from '../vendor/three.module.js';
import { colliderGrid } from './collidergrid.js';

const DEFAULT_LOOK = {
  skin: 0xe8bfa0, top: 0xb8422f, trousers: 0x2b3a55,
  shoe: 0x24242a, hair: 0x33251b, height: 1.0, build: 1.0,
};

/**
 * Merge several geometries into one, baking a colour per part into the vertex
 * colours and offsetting each into place.
 *
 * A character used to be fourteen meshes with five materials of its own, and
 * with 36 people and 24 cars on screen that was 74% of every draw call in the
 * game — more than the entire streamed city, which merges and so costs almost
 * nothing. Parts that move together can share one mesh; the colour that used to
 * come from five materials rides in the vertex colours instead, so every
 * character in the world now draws with the same single material.
 */
export function mergeParts(parts) {
  let n = 0;
  for (const p of parts) n += p.geo.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const idx = [];
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  let o = 0;
  for (const p of parts) {
    const g = p.geo;
    const gp = g.attributes.position, gn = g.attributes.normal;
    c.set(p.colour);
    for (let i = 0; i < gp.count; i++) {
      v.fromBufferAttribute(gp, i);
      pos[(o + i) * 3] = v.x + (p.x || 0);
      pos[(o + i) * 3 + 1] = v.y + (p.y || 0);
      pos[(o + i) * 3 + 2] = v.z + (p.z || 0);
      v.fromBufferAttribute(gn, i);                 // translation only: normals hold
      nrm[(o + i) * 3] = v.x;
      nrm[(o + i) * 3 + 1] = v.y;
      nrm[(o + i) * 3 + 2] = v.z;
      col[(o + i) * 3] = c.r;
      col[(o + i) * 3 + 1] = c.g;
      col[(o + i) * 3 + 2] = c.b;
    }
    const gi = g.index;
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(gi.getX(i) + o);
    else for (let i = 0; i < gp.count; i++) idx.push(o + i);
    o += gp.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

// One material for every person in the game. The five it replaces had slightly
// different roughness each; this is their middle, and at the size a person
// occupies on screen the difference is not visible.
export const CHAR_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });

/** Build a body. `look` varies colouring and proportions.
 *
 *  Five meshes: the body, and a limb each. Each is a rigid part that already
 *  moved as a unit, so the walk animation is unchanged — it still just rotates
 *  arms[] and legs[] about their shoulder and hip.
 */
export function createCharacter(look = {}) {
  const L = { ...DEFAULT_LOOK, ...look };
  const b = L.build;
  const g = new THREE.Group();
  const mesh = (geo) => {
    const m = new THREE.Mesh(geo, CHAR_MAT);
    m.castShadow = true;
    return m;
  };

  const body = mesh(mergeParts([
    { geo: new THREE.CapsuleGeometry(0.19 * b, 0.44, 6, 12), y: 1.16, colour: L.top },
    { geo: new THREE.SphereGeometry(0.155, 20, 16), y: 1.63, colour: L.skin },
    { geo: new THREE.SphereGeometry(0.04, 8, 8), y: 1.61, z: 0.15, colour: L.skin },
    { geo: new THREE.SphereGeometry(0.162, 20, 16, 0, 6.3, 0, 1.15), y: 1.635, colour: L.hair },
  ]));
  g.add(body);

  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const a = mesh(mergeParts([
      { geo: new THREE.CapsuleGeometry(0.062, 0.30, 4, 8), y: -0.17, colour: L.top },
      { geo: new THREE.CapsuleGeometry(0.055, 0.26, 4, 8), y: -0.47, colour: L.skin },
    ]));
    a.position.set(s * 0.245 * b, 1.36, 0);
    g.add(a); arms.push(a);

    const l = mesh(mergeParts([
      { geo: new THREE.CapsuleGeometry(0.078, 0.32, 4, 8), y: -0.18, colour: L.trousers },
      { geo: new THREE.CapsuleGeometry(0.068, 0.30, 4, 8), y: -0.50, colour: L.trousers },
      { geo: new THREE.BoxGeometry(0.13, 0.09, 0.26), y: -0.72, z: 0.05, colour: L.shoe },
    ]));
    l.position.set(s * 0.105 * b, 0.86, 0);
    g.add(l); legs.push(l);
  }

  g.scale.setScalar(L.height);
  return { group: g, arms, legs, body };
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
    // 5.3 m/s peaks at 0.97m, which clears the tallest front wall (0.88m)
    // and its coping. At the old 4.6 the apex was 0.73m and you'd clip it.
    if (k.has('Space') && this.onGround) { this.vel.y = 5.3; this.onGround = false; }
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

    // In a tight spot the camera just comes in close and stays third-person.
    // It used to slip to eye level once there was nowhere to stand it, which
    // reads as the game taking the camera off you — first person is the F key's
    // job, not something to be dropped into. Only the floor in
    // _camDistClamped stops it going through the wall behind.
    const eyeLevel = this.firstPerson;
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

  /** Colliders bucketed by location, so walking and the camera both look at the
   *  handful nearby instead of all hundred-and-thirty thousand every frame.
   *  Each one goes in every cell it covers, so a point query only has to look
   *  at the cells it actually touches. Rebuilt when the list changes, which
   *  happens when you get into a car. */
  _viewGrid() { return colliderGrid(this.colliders); }

  _camDistClamped() {
    const cy = Math.cos(this.camPitch);
    const dx = Math.sin(this.camYaw) * cy, dz = Math.cos(this.camYaw) * cy;
    let d = this.camDist;
    if (!this._camInside(d, dx, dz)) return d;      // almost always
    for (let i = 0; i < 16; i++) {
      d -= 0.5;
      if (d <= 0.3) return 0.3;
      if (!this._camInside(d, dx, dz)) return d;
    }
    return 0.3;
  }

  /** Would the camera be inside something solid at this distance? */
  _camInside(d, dx, dz) {
    const x = this.pos.x + dx * d, z = this.pos.z + dz * d;
    const y = this.pos.y + 1.9 + Math.sin(this.camPitch) * d;
    const PAD = 0.3;
    return this._near(x, z, PAD + 0.1, (c) => {
      if (c.soft) return false;                     // foliage never blocks the view
      if (c.h !== undefined && c.h + 0.3 < y) return false;   // clear over the roof
      const ox = x - c.x, oz = z - c.z;
      const co = Math.cos(-c.yaw), si = Math.sin(-c.yaw);
      const lx = ox * co - oz * si, lz = ox * si + oz * co;
      return Math.abs(lx) < c.hx + PAD && Math.abs(lz) < c.hz + PAD;
    });
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

  /** Push out of any building we've walked into, along the shallowest axis.
   *  Anything marked `low` — the front garden walls — stops being solid once
   *  your feet are above it, so you can hop over rather than being fenced into
   *  the footpath. Cars have no such exemption. */
  _resolve(x, z) {
    const pad = 0.34;
    const feet = this.pos.y;
    for (let iter = 0; iter < 3; iter++) {
      let hit = false;
      // The push moves x,z, so the candidates are gathered fresh each pass.
      this._near(x, z, pad + 0.1, (c) => {
        if (c.low && c.h !== undefined && feet > c.h - 0.12) return false;
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
