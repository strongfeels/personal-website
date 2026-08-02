// Cars: the shape of one, the traffic that drives itself, and the one you drive.
//
// Traffic runs on a lane graph derived from the road centrelines — offset to the
// LEFT of the direction of travel, because this is Dublin. Every road yields two
// lanes (one each way) which are linked end-to-end at junctions, so cars turn
// corners rather than teleport.
import * as THREE from '../vendor/three.module.js';
import { colliderGrid } from './collidergrid.js';

export const CAR = { len: 4.24, wid: 1.78, wheelR: 0.33, wheelbase: 2.6 };

const BODY_COLOURS = [0x9aa0a6, 0x1e2226, 0xb3b7bb, 0x27374d, 0x6d1f1f, 0x2c4a33,
                      0xe8e8e6, 0x3a3d42, 0x54606b, 0x7a5230, 0x1f4f7a, 0x8a1f2f];

const SKINS = [0xf0d0b4, 0xe8bfa0, 0xd9a983, 0xc08e63, 0x8d5a3b, 0x6b4230];
const TOPS = [0xb8422f, 0x27496d, 0x2f5d3a, 0x1f1f24, 0xd4a017, 0x7d8a95, 0x3f6f7d];

function hash01(i, salt = 0) {
  let h = (i * 374761393 + salt * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Merged body shell, also used for the instanced parked cars. */
export function carBodyGeometry() {
  const parts = [];
  const body = new THREE.BoxGeometry(CAR.wid, 0.62, CAR.len);
  body.translate(0, 0.66, 0);
  parts.push(body);
  const cabin = new THREE.BoxGeometry(CAR.wid * 0.91, 0.56, 2.12);
  cabin.translate(0, 1.24, -0.16);
  parts.push(cabin);
  const bonnet = new THREE.BoxGeometry(CAR.wid * 0.96, 0.22, 1.15);
  bonnet.translate(0, 1.02, 1.5);
  parts.push(bonnet);
  return mergeSimple(parts);
}

export function wheelGeometry() {
  const g = new THREE.CylinderGeometry(CAR.wheelR, CAR.wheelR, 0.2, 12);
  g.rotateZ(Math.PI / 2);
  return g;
}

function mergeSimple(geos) {
  const pos = [], nrm = [];
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, idx = g.index;
    const push = (i) => {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    };
    if (idx) for (let i = 0; i < idx.count; i++) push(idx.getX(i));
    else for (let i = 0; i < p.count; i++) push(i);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}

/**
 * A car you can see up close: shell, glazing, lights, and four wheels that
 * steer and spin. Local +Z is the way it faces.
 */
export function makeCar(colour, seed = 0, withDriver = true) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.3, metalness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x223038, roughness: 0.08, metalness: 0.6, envMapIntensity: 2.0 });
  const trimM = new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.7 });
  const lampF = new THREE.MeshStandardMaterial({
    color: 0xfff4d6, emissive: 0xfff0c0, emissiveIntensity: 0.35, roughness: 0.3 });
  const lampR = new THREE.MeshStandardMaterial({
    color: 0x8b1a1a, emissive: 0xd02020, emissiveIntensity: 0.35, roughness: 0.3 });

  const shell = new THREE.Mesh(carBodyGeometry(), paint);
  shell.castShadow = shell.receiveShadow = true;
  g.add(shell);

  // glazing: a slightly smaller box inside the cabin reads as windows
  const win = new THREE.Mesh(new THREE.BoxGeometry(CAR.wid * 0.93, 0.42, 2.0), glass);
  win.position.set(0, 1.26, -0.16);
  g.add(win);

  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.1), lampF);
    f.position.set(s * 0.55, 0.78, CAR.len / 2 - 0.02);
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.1), lampR);
    r.position.set(s * 0.6, 0.82, -CAR.len / 2 + 0.02);
    g.add(f, r);
  }
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.06), trimM);
  plate.position.set(0, 0.5, -CAR.len / 2);
  g.add(plate);

  const wheels = [];
  const wg = wheelGeometry();
  const wm = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.9 });
  for (const [wx, wz] of [[0.82, 1.3], [-0.82, 1.3], [0.82, -1.3], [-0.82, -1.3]]) {
    const w = new THREE.Mesh(wg, wm);
    w.position.set(wx, CAR.wheelR, wz);
    w.castShadow = true;
    g.add(w);
    wheels.push(w);
  }

  let driver = null;
  if (withDriver) {
    // Only the head and shoulders show above the door line, so a full 14-mesh
    // character per car is ~250 meshes of nothing. Three will do.
    driver = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({
      color: SKINS[Math.floor(hash01(seed, 1) * SKINS.length)], roughness: 0.72 });
    const top = new THREE.MeshStandardMaterial({
      color: TOPS[Math.floor(hash01(seed, 2) * TOPS.length)], roughness: 0.8 });
    const hairM = new THREE.MeshStandardMaterial({ color: 0x33251b, roughness: 0.9 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.34, 4, 10), top);
    torso.position.y = 0.98;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 12), skin);
    head.position.y = 1.36;
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.152, 14, 12, 0, 6.3, 0, 1.1), hairM);
    hair.position.y = 1.365;
    driver.add(torso, head, hair);

    // Local +z is forward and +y is up, so starboard is -x: right-hand drive,
    // as in Ireland.
    driver.position.set(-0.36, 0.0, -0.30);
    g.add(driver);
  }

  return { group: g, wheels, driver, colour };
}

// ------------------------------------------------------------ lane graph ---
/** Offset a polyline to the LEFT of the direction of travel. */
function leftOf(pts, d) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    // viewed from above with x east and z south, the left of (dx,dz) is (dz,-dx)
    out.push([pts[i][0] + dz * d, pts[i][1] - dx * d]);
  }
  return out;
}

function measure(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { pts, cum, len: cum[cum.length - 1] };
}

function pointAt(lane, t) {
  const { pts, cum } = lane;
  t = Math.max(0, Math.min(lane.len, t));
  let lo = 0, hi = cum.length - 1;
  while (lo + 1 < hi) {
    const m = (lo + hi) >> 1;
    if (cum[m] <= t) lo = m; else hi = m;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const f = (t - cum[lo]) / seg;
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f,
          pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f];
}

export function buildLanes(world) {
  const lanes = [];
  for (const r of world.roads) {
    if (r.kind === 'service' || r.w < 4.5) continue;
    const off = Math.max(1.3, r.w * 0.25);
    const fwd = measure(leftOf(r.pts, off));
    const rev = measure(leftOf([...r.pts].reverse(), off));
    if (fwd.len < 12) continue;
    fwd.speed = rev.speed = r.kind === 'residential' ? 8.5 : 12.0;
    fwd.name = rev.name = r.name;
    lanes.push(fwd, rev);
    fwd.pair = lanes.length - 1;      // index of rev
    rev.pair = lanes.length - 2;
  }

  // link the end of each lane to the start of any lane that carries on from it
  const heading = (lane, t) => {
    const [ax, az] = pointAt(lane, Math.max(0, t - 1.5));
    const [bx, bz] = pointAt(lane, Math.min(lane.len, t + 1.5));
    const l = Math.hypot(bx - ax, bz - az) || 1;
    return [(bx - ax) / l, (bz - az) / l];
  };
  for (const lane of lanes) {
    lane.next = [];
    const end = pointAt(lane, lane.len);
    const [hx, hz] = heading(lane, lane.len);
    lanes.forEach((other, j) => {
      if (other === lane) return;
      const start = pointAt(other, 0);
      if (Math.hypot(start[0] - end[0], start[1] - end[1]) > 11) return;
      const [ox, oz] = heading(other, 0);
      if (hx * ox + hz * oz < -0.25) return;       // no instant U-turns
      lane.next.push(j);
    });
  }
  return lanes;
}

// -------------------------------------------------------------- traffic ---
const SEE = 300;        // beyond this a car is hidden, so it can be moved
const NEAR = 130;       // ...and brought back this close, out of your eyeline
const STUCK_UNSEEN = 60;   // seconds jammed before a car off-screen is recycled
const STUCK_SEEN = 180;    // ...and a longer grace period if you can see it

export class Traffic {
  constructor(world, scene, count = 24, seed = 7) {
    this.lanes = buildLanes(world);
    this.cars = [];
    if (!this.lanes.length) return;

    for (let i = 0; i < count; i++) {
      const car = makeCar(BODY_COLOURS[Math.floor(hash01(seed + i, 3) * BODY_COLOURS.length)],
        seed + i, true);
      scene.add(car.group);
      const c = { ...car, lane: 0, t: 0, speed: 0, target: 8, yaw: 0, spin: 0, stuck: 0 };
      this.cars.push(c);
      this.place(c, { x: 0, z: 0 }, null, 20, 220);
    }
  }

  /**
   * Put a car on a lane somewhere in a ring around the player. 24 cars spread
   * over 100 km of lane would empty the neighbourhood within a minute, so cars
   * that wander out of sight are recycled back to where you are. `forward` lets
   * us prefer spots behind the camera, so nothing pops into view.
   */
  place(c, at, forward, minD, maxD) {
    let best = null, bestErr = Infinity;
    for (let k = 0; k < 24; k++) {
      const li = Math.floor(Math.random() * this.lanes.length);
      const lane = this.lanes[li];
      const t = Math.random() * lane.len;
      const [x, z] = pointAt(lane, t);
      const dx = x - at.x, dz = z - at.z;
      const d = Math.hypot(dx, dz);
      const inBand = d >= minD && d <= maxD;
      const behind = !forward || (dx * forward.x + dz * forward.z) / (d || 1) <= 0.2;
      if (inBand && (behind || k >= 18)) { best = [li, t, lane]; break; }
      // keep the nearest miss, so a car is never left stranded on lane 0
      const err = inBand ? 0 : (d < minD ? minD - d : d - maxD);
      if (err < bestErr) { bestErr = err; best = [li, t, lane]; }
    }
    if (!best) return false;
    const [li, t, lane] = best;
    c.lane = li;
    c.t = t;
    c.speed = lane.speed * 0.7;
    c.target = lane.speed * (0.8 + Math.random() * 0.35);
    return true;
  }

  update(dt, playerPos, obstacles, forward = null) {
    for (const c of this.cars) {
      // Nothing is simulated city-wide: there are only ever `count` cars, and
      // they follow you. One that drifts out of sight is moved back around you.
      const gx = c.group.position.x - playerPos.x, gz = c.group.position.z - playerPos.z;
      const away = gx * gx + gz * gz;
      const unseen = away > SEE * SEE;
      if (unseen) {
        this.place(c, playerPos, forward, NEAR, SEE - 40);
        c.stuck = 0;
      } else if (c.stuck > STUCK_SEEN) {
        // wedged in plain sight for a very long time — something is wrong with
        // it, so recycle anyway rather than leave a permanent ornament
        this.place(c, playerPos, forward, NEAR, SEE - 40);
        c.stuck = 0;
      }

      const lane = this.lanes[c.lane];

      // look ahead for anything in our way and lift off if there is
      const [px, pz] = pointAt(lane, c.t);
      let blocked = false;
      for (const o of obstacles) {
        const dx = o.x - px, dz = o.z - pz;
        const d = Math.hypot(dx, dz);
        if (d > 12 || d < 0.1) continue;
        const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        if ((dx * fx + dz * fz) / d > 0.82) { blocked = true; break; }
      }
      for (const other of this.cars) {
        if (other === c || blocked) continue;
        const [ox, oz] = pointAt(this.lanes[other.lane], other.t);
        const dx = ox - px, dz = oz - pz;
        const d = Math.hypot(dx, dz);
        if (d > 11) continue;
        const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        if ((dx * fx + dz * fz) / d > 0.85) { blocked = true; break; }
      }

      const want = blocked ? 0 : c.target;
      c.speed += (want - c.speed) * Math.min(1, dt * (blocked ? 3.2 : 1.3));
      c.t += c.speed * dt;

      // a car going nowhere for a minute has jammed against something; once it's
      // out of sight it gets recycled rather than sitting there forever
      c.stuck = c.speed < 0.4 ? c.stuck + dt : 0;
      if (c.stuck > STUCK_UNSEEN && away > NEAR * NEAR) {
        this.place(c, playerPos, forward, NEAR, SEE - 40);
        c.stuck = 0;
        continue;
      }

      if (c.t >= lane.len) {
        const opts = lane.next;
        const over = c.t - lane.len;
        if (opts.length) {
          c.lane = opts[Math.floor(Math.random() * opts.length)];
        } else {
          c.lane = lane.pair !== undefined ? lane.pair : c.lane;   // dead end: come back
        }
        c.t = over;
        c.target = this.lanes[c.lane].speed * (0.8 + Math.random() * 0.35);
      }

      const lane2 = this.lanes[c.lane];
      const [x, z] = pointAt(lane2, c.t);
      const [ax, az] = pointAt(lane2, Math.min(lane2.len, c.t + 4.5));
      const dx = ax - x, dz = az - z;
      if (dx || dz) {
        const want2 = Math.atan2(dx, dz);
        let diff = want2 - c.yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        c.yaw += diff * Math.min(1, dt * 5.5);
      }
      c.group.position.set(x, 0, z);
      c.group.rotation.y = c.yaw;

      c.spin += c.speed * dt / CAR.wheelR;
      for (const w of c.wheels) w.rotation.x = c.spin;

      c.group.visible = Math.hypot(x - playerPos.x, z - playerPos.z) < SEE;
    }
  }

  /** Positions, so the player's car can be avoided and vice versa. */
  positions() {
    return this.cars.map((c) => ({ x: c.group.position.x, z: c.group.position.z }));
  }
}

// --------------------------------------------------------- player's car ---
export class Drive {
  constructor(car, colliders) {
    this.car = car;
    this.colliders = colliders;
    this.x = 0; this.z = 0; this.yaw = 0;
    this.speed = 0;
    this.steer = 0;
    this.spin = 0;
  }

  place(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.speed = 0;
    this.sync();
  }

  sync() {
    this.car.group.position.set(this.x, 0, this.z);
    this.car.group.rotation.y = this.yaw;
  }

  update(dt, keys, others = [], analog = null) {
    let throttle = (keys.has('KeyW') || keys.has('ArrowUp')) ? 1 : 0;
    let brake = (keys.has('KeyS') || keys.has('ArrowDown')) ? 1 : 0;
    let left = (keys.has('KeyA') || keys.has('ArrowLeft')) ? 1 : 0;
    let right = (keys.has('KeyD') || keys.has('ArrowRight')) ? 1 : 0;
    const hand = keys.has('Space') ? 1 : 0;

    // push the stick forward to accelerate, back to brake, sideways to steer
    if (analog && (analog.x || analog.y)) {
      if (analog.y < 0) throttle = Math.max(throttle, -analog.y);
      if (analog.y > 0) brake = Math.max(brake, analog.y);
      if (analog.x < 0) left = Math.max(left, -analog.x);
      if (analog.x > 0) right = Math.max(right, analog.x);
    }

    const MAX = 21;                     // ~75 km/h, plenty for these streets
    if (throttle) this.speed += 7.5 * dt;
    if (brake) this.speed -= (this.speed > 0 ? 13 : 6) * dt;
    if (hand) this.speed *= Math.max(0, 1 - dt * 4.5);
    if (!throttle && !brake && !hand) this.speed *= Math.max(0, 1 - dt * 0.7);
    this.speed = Math.max(-7, Math.min(MAX, this.speed));

    // steering bites less at a crawl and less again at speed
    const grip = Math.min(1, Math.abs(this.speed) / 3.2);
    const wantSteer = (left - right) * 0.55 * (1 - Math.min(0.55, Math.abs(this.speed) / MAX));
    this.steer += (wantSteer - this.steer) * Math.min(1, dt * 8);
    this.yaw += this.steer * grip * (this.speed >= 0 ? 1 : -1) * dt * 2.2;

    // don't drive through the traffic: shove up against it instead
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    // A 4.6m circle with a 60-degree cone was too blunt: a car in the next lane,
    // or one you were drawing level with, sat inside it and pinned you to a
    // crawl with clear road ahead. Measure along the car's own axes instead, so
    // only something genuinely in your path counts.
    const GAP = 0.3;                          // stop this far off its bumper
    for (const o of others) {
      const dx = o.x - this.x, dz = o.z - this.z;
      const along = dx * fx + dz * fz;        // + is in front of you
      const side = -dx * fz + dz * fx;        // lateral offset
      if (side > CAR.wid || side < -CAR.wid) continue;   // beside you, not ahead
      if (along > 0 && along < CAR.len + GAP && this.speed > 0) {
        this.speed = Math.min(this.speed, 0.4);
      }
      if (along < 0 && along > -(CAR.len + GAP) && this.speed < 0) {
        this.speed = Math.max(this.speed, -0.4);
      }
    }

    const nx = this.x + fx * this.speed * dt;
    const nz = this.z + fz * this.speed * dt;
    if (this.blocked(nx, nz)) {
      this.speed *= -0.22;                     // bump and bounce off
    } else {
      this.x = nx; this.z = nz;
    }

    this.spin += this.speed * dt / CAR.wheelR;
    for (let i = 0; i < this.car.wheels.length; i++) {
      const w = this.car.wheels[i];
      w.rotation.x = this.spin;
      w.rotation.y = i < 2 ? this.steer * 0.9 : 0;   // front wheels turn
    }
    this.sync();
  }

  /** Colliders bucketed by location. Without this, every frame behind the wheel
   *  tested five corners against all hundred-and-thirty thousand of them, which
   *  cost 3.7ms a frame on its own. (PlayerController keeps its own copy of this
   *  for walking; the two lists are the same array but the classes are apart.) */
  _grid() { return colliderGrid(this.colliders); }

  /** Corners of the car against the world's boxes. */
  blocked(x, z) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const hl = CAR.len / 2, hw = CAR.wid / 2;
    // 4cm, not 15. The old margin plus an oversized parked-car box meant you
    // stopped dead with a fifth of a metre of daylight still showing.
    const PAD = 0.04;
    const { G, cells } = this._grid();
    for (const [ox, oz] of [[hw, hl], [-hw, hl], [hw, -hl], [-hw, -hl], [0, hl]]) {
      const px = x + ox * c + oz * s;
      const pz = z - ox * s + oz * c;
      // Every collider is registered in each cell it covers, so a point test
      // only has to look at the cells the point itself touches — usually one.
      const gx0 = Math.floor((px - PAD) / G), gx1 = Math.floor((px + PAD) / G);
      const gz0 = Math.floor((pz - PAD) / G), gz1 = Math.floor((pz + PAD) / G);
      for (let ix = gx0; ix <= gx1; ix++) {
        for (let iz = gz0; iz <= gz1; iz++) {
          const bucket = cells.get(ix + ',' + iz);
          if (!bucket) continue;
          for (const o of bucket) {
            const dx = px - o.x, dz = pz - o.z;
            if (Math.abs(dx) > o.hx + o.hz + 3 || Math.abs(dz) > o.hx + o.hz + 3) continue;
            const co = Math.cos(-o.yaw), si = Math.sin(-o.yaw);
            const lx = dx * co - dz * si, lz = dx * si + dz * co;
            if (Math.abs(lx) < o.hx + PAD && Math.abs(lz) < o.hz + PAD) return true;
          }
        }
      }
    }
    return false;
  }
}
