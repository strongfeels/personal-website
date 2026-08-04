// Cars: the shape of one, the traffic that drives itself, and the one you drive.
//
// Traffic runs on a lane graph derived from the road centrelines — offset to the
// LEFT of the direction of travel, because this is Dublin. Every road yields two
// lanes (one each way) which are linked end-to-end at junctions, so cars turn
// corners rather than teleport.
import * as THREE from '../vendor/three.module.js';
import { colliderGrid } from './collidergrid.js';
import { mergeParts, CHAR_MAT } from './player.js';

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
// Only the paint differs from car to car. The glass, trim, lamps and tyres were
// being minted fresh for every one of the two dozen on the road, which is a
// shader binding each rather than one shared between them. The geometry is
// deliberately NOT merged: the windows want reflection, the lamps want to glow
// and the paint wants metalness, and flattening those into one material to save
// a few draw calls would cost more than it buys.
const CAR_GLASS = new THREE.MeshStandardMaterial({
  color: 0x223038, roughness: 0.08, metalness: 0.6, envMapIntensity: 2.0 });
const CAR_TRIM = new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.7 });
const CAR_LAMP_F = new THREE.MeshStandardMaterial({
  color: 0xfff4d6, emissive: 0xfff0c0, emissiveIntensity: 0.35, roughness: 0.3 });
const CAR_LAMP_R = new THREE.MeshStandardMaterial({
  color: 0x8b1a1a, emissive: 0xd02020, emissiveIntensity: 0.35, roughness: 0.3 });
const CAR_TYRE = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.9 });

export function makeCar(colour, seed = 0, withDriver = true) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.3, metalness: 0.5 });
  const glass = CAR_GLASS, trimM = CAR_TRIM, lampF = CAR_LAMP_F, lampR = CAR_LAMP_R;

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
  const wm = CAR_TYRE;
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
    // three meshes and three materials each, twenty-four times over, for
    // something only visible from the shoulders up — merged into one, on the
    // same material every person in the game uses
    driver = new THREE.Group();
    const skin = SKINS[Math.floor(hash01(seed, 1) * SKINS.length)];
    const top = TOPS[Math.floor(hash01(seed, 2) * TOPS.length)];
    const bust = new THREE.Mesh(mergeParts([
      { geo: new THREE.CapsuleGeometry(0.17, 0.34, 4, 10), y: 0.98, colour: top },
      { geo: new THREE.SphereGeometry(0.145, 14, 12), y: 1.36, colour: skin },
      { geo: new THREE.SphereGeometry(0.152, 14, 12, 0, 6.3, 0, 1.1), y: 1.365, colour: 0x33251b },
    ]), CHAR_MAT);
    driver.add(bust);

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

export const BUS = { len: 10.9, wid: 2.52, high: 4.35, wheelR: 0.47 };

// Current TFI livery is yellow with acid green and black; it replaced the
// yellow-and-blue that ran for over a decade, and the repaint is gradual, so a
// few of the old ones are still about.
const BUS_BLACK = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.72 });
const BUS_ROOF = new THREE.MeshStandardMaterial({ color: 0xb9bcbe, roughness: 0.85 });

/** Concatenate boxes into one geometry, so a detailed bus is still a few draws. */
function mergeBoxes(parts) {
  const geos = parts.map(([w, h, d, x, y, z]) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g.index ? g.toNonIndexed() : g;
  });
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o3 = 0, o2 = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o3);
    nrm.set(g.attributes.normal.array, o3);
    uv.set(g.attributes.uv.array, o2);
    o3 += g.attributes.position.count * 3;
    o2 += g.attributes.position.count * 2;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

/**
 * A Dublin double-decker: 10.9m long, 2.52m wide, 4.35m to the roof.
 *
 * The livery is the current TFI one: the front is FULLY yellow — that is an
 * accessibility requirement, not a style choice — and the green climbs from the
 * skirt up the flanks as it runs back, reaching full height across the rear. The
 * curve is cut into 18 vertical slices per side; at any distance you see a bus
 * from, stepped slices read as a sweep.
 *
 * Windows are individual panes with body-colour pillars between them, and there
 * are windows on the back of both decks. A single black rectangle per side was
 * the giveaway that this was a box rather than a bus.
 *
 * Everything is merged per material, so all that detail is about ten draws.
 */
export function makeBus(seed = 0) {
  const g = new THREE.Group();
  const L = BUS.len, W = BUS.wid, H = BUS.high;
  const FLOOR = 0.62;                       // underside of the body
  const old = hash01(seed, 11) > 0.75;      // some are still in the old blue
  const paint = new THREE.MeshStandardMaterial({
    color: old ? 0xf5c518 : 0xf2c317, roughness: 0.42, metalness: 0.15 });
  const accent = new THREE.MeshStandardMaterial({
    color: old ? 0x11317a : 0x3f8a2b, roughness: 0.45, metalness: 0.12 });

  const body = [], acc = [], glass = [], black = [];

  body.push([W, H - FLOOR, L, 0, FLOOR + (H - FLOOR) / 2, 0]);

  // The wave. Green height rises from nothing under the front to the full flank
  // by roughly a third back, then stays up and wraps the rear.
  const SLICES = 18;
  const ease = (t) => t * t * (3 - 2 * t);
  for (let i = 0; i < SLICES; i++) {
    const z0 = L / 2 - (i / SLICES) * L;
    const dz = L / SLICES;
    const zc = z0 - dz / 2;
    const t = ease(Math.min(1, Math.max(0, (L / 2 - 0.9 - zc) / (L * 0.42))));
    const hh = t * (H - FLOOR - 0.10);
    if (hh < 0.05) continue;
    acc.push([W + 0.012, hh, dz + 0.004, 0, FLOOR + hh / 2, zc]);
  }
  acc.push([W + 0.014, H - FLOOR - 0.10, 0.05, 0, FLOOR + (H - FLOOR - 0.10) / 2, -L / 2 - 0.005]);
  acc.push([W + 0.02, 0.40, L, 0, FLOOR + 0.20, 0]);          // skirt band, full length


  // ---- glazing. Panes with pillars between them, not one long rectangle.
  const pane = (y, h, zFrom, zTo, n) => {
    const span = zTo - zFrom;
    const gap = 0.13;
    const wpane = (span - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const zc = zFrom + wpane / 2 + i * (wpane + gap);
      glass.push([W + 0.03, h, wpane, 0, y, zc]);
    }
  };
  pane(1.72, 0.76, -L / 2 + 0.75, L / 2 - 1.75, 6);            // lower deck
  pane(3.28, 0.90, -L / 2 + 0.55, L / 2 - 0.95, 7);            // upper deck
  // windscreens, and the rear windows that were missing entirely
  glass.push([W - 0.18, 0.86, 0.08, 0, 1.76, L / 2 + 0.015]);
  glass.push([W - 0.18, 1.02, 0.08, 0, 3.24, L / 2 + 0.015]);
  glass.push([W - 0.30, 0.74, 0.08, 0, 1.74, -L / 2 - 0.03]);
  glass.push([W - 0.26, 0.94, 0.08, 0, 3.26, -L / 2 - 0.03]);

  black.push([W - 0.34, 0.30, 0.06, 0, 3.92, L / 2 + 0.03]);   // destination blind
  black.push([W + 0.035, 0.12, L - 1.3, 0, 2.34, -0.1]);       // deck line

  const roof = new THREE.Mesh(mergeBoxes([[W - 0.16, 0.16, L - 0.5, 0, H - 0.06, 0]]), BUS_ROOF);
  roof.castShadow = true;
  g.add(roof);

  const paintMesh = new THREE.Mesh(mergeBoxes(body), paint);
  const accMesh = new THREE.Mesh(mergeBoxes(acc), accent);
  const glassMesh = new THREE.Mesh(mergeBoxes(glass), CAR_GLASS);
  const blackMesh = new THREE.Mesh(mergeBoxes(black), BUS_BLACK);
  for (const m of [paintMesh, accMesh, glassMesh, blackMesh]) {
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }

  const lampF = [], lampR = [];
  for (const s of [-1, 1]) {
    lampF.push([0.3, 0.16, 0.08, s * (W / 2 - 0.32), 0.72, L / 2 + 0.02]);
    lampR.push([0.28, 0.16, 0.08, s * (W / 2 - 0.3), 0.78, -L / 2 - 0.02]);
  }
  const fm = new THREE.Mesh(mergeBoxes(lampF), CAR_LAMP_F);
  const rm = new THREE.Mesh(mergeBoxes(lampR), CAR_LAMP_R);
  g.add(fm, rm);

  // one axle at the front, a doubled one at the back
  const wheels = [];
  const tyre = new THREE.CylinderGeometry(BUS.wheelR, BUS.wheelR, 0.26, 12);
  tyre.rotateZ(Math.PI / 2);
  for (const zz of [L / 2 - 1.9, -L / 2 + 2.6, -L / 2 + 1.55]) {
    for (const s of [-1, 1]) {
      const wm = new THREE.Mesh(tyre, CAR_TYRE);
      wm.position.set(s * (W / 2 - 0.14), BUS.wheelR, zz);
      wm.castShadow = true;
      g.add(wm);
      wheels.push(wm);
    }
  }
  return { group: g, wheels, wheelR: BUS.wheelR, big: true };
}

/**
 * Ease each lane sideways around the cars parked along it.
 *
 * Every residential road here is 6m: the driving lane sits 1.50m from the
 * centreline and parked cars at 1.95m, so with a car 1.78m wide they overlap by
 * 1.33m. Traffic was not occasionally clipping a parked car, it was driving
 * through every one of them, by geometry.
 *
 * Both the lanes and the parked cars are fixed, so this is decided once at load
 * rather than swerved at runtime: sample the lane, work out how far it has to
 * move to clear anything parked beside it, then smooth that profile so the line
 * eases out and back instead of stepping. A car just follows its lane and the
 * pulling-out happens for free, with nothing to oscillate.
 *
 * On a 6m street pulling out means crossing the centreline, which is exactly
 * what you do here in reality, so the offset is capped rather than made to fit.
 */
const LAT_STEP = 2.0;     // metres between samples
const LAT_NEED = 1.93;    // half a car plus half a parked car, plus a margin
const LAT_MAX = 1.5;      // never wander further than this off the lane

function bakeLateral(lanes, slots) {
  const G = 20.0;
  const grid = new Map();
  for (const [x, z] of slots) {
    const k = `${Math.floor(x / G)},${Math.floor(z / G)}`;
    const a = grid.get(k);
    if (a) a.push([x, z]); else grid.set(k, [[x, z]]);
  }
  for (const lane of lanes) {
    const n = Math.max(2, Math.ceil(lane.len / LAT_STEP) + 1);
    const lat = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = Math.min(lane.len, i * LAT_STEP);
      const [x, z] = pointAt(lane, t);
      const [ax, az] = pointAt(lane, Math.max(0, t - 1));
      const [bx, bz] = pointAt(lane, Math.min(lane.len, t + 1));
      const dl = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / dl, nz = (bx - ax) / dl;
      let push = 0;
      const gx = Math.floor(x / G), gz = Math.floor(z / G);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(`${gx + dx},${gz + dz}`);
          if (!list) continue;
          for (const [cx, cz] of list) {
            const ox = cx - x, oz = cz - z;
            // A generous along-track window on purpose: it makes the raw
            // profile a plateau rather than a spike, so the smoothing below
            // eases the shoulders instead of cutting the peak off.
            if (Math.abs(ox * (bx - ax) / dl + oz * (bz - az) / dl) > 6.0) continue;
            const side = ox * nx + oz * nz;
            if (Math.abs(side) >= LAT_NEED) continue;
            const want = -Math.sign(side || 1) * (LAT_NEED - Math.abs(side));
            if (Math.abs(want) > Math.abs(push)) push = want;
          }
        }
      }
      lat[i] = Math.max(-LAT_MAX, Math.min(LAT_MAX, push));
    }
    // smooth, so the line eases out and back rather than stepping sideways
    for (let pass = 0; pass < 4; pass++) {
      const cp = Float32Array.from(lat);
      for (let i = 0; i < n; i++) {
        const a = cp[Math.max(0, i - 1)], b = cp[i], c = cp[Math.min(n - 1, i + 1)];
        lat[i] = a * 0.25 + b * 0.5 + c * 0.25;
      }
    }
    lane.lat = lat;
  }
}

/** Lateral offset baked into a lane at distance t, interpolated. */
function latAt(lane, t) {
  const lat = lane.lat;
  if (!lat) return 0;
  const f = Math.max(0, Math.min(lat.length - 1, t / LAT_STEP));
  const i = Math.floor(f), g = f - i;
  const a = lat[i], b = lat[Math.min(lat.length - 1, i + 1)];
  return a + (b - a) * g;
}

/** Where a vehicle actually sits: the lane, plus its baked pull-out. */
function driveAt(lane, t) {
  const [x, z] = pointAt(lane, t);
  const off = latAt(lane, t);
  if (!off) return [x, z];
  const [ax, az] = pointAt(lane, Math.max(0, t - 1));
  const [bx, bz] = pointAt(lane, Math.min(lane.len, t + 1));
  const dl = Math.hypot(bx - ax, bz - az) || 1;
  return [x - (bz - az) / dl * off, z + (bx - ax) / dl * off];
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
    fwd.kind = rev.kind = r.kind;
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
  // Link each lane end to wherever another lane carries on from it — including
  // partway along that lane, which is the whole point. Linking end-to-START
  // only, as this did, cannot turn a car out of a side road onto a main road:
  // OSM splits a main road into long ways, so its start is typically hundreds
  // of metres from the junction and nothing is in range. 44% of lanes ended up
  // with no successor at all, and every car reaching one of them was flipped
  // onto its own reverse lane and driven back the way it came.
  //
  // Sample every lane, index the samples, and join to the nearest sample of any
  // other lane. This is all build-time; nothing here runs per frame.
  const STEP = 4.0;              // sample spacing along a lane
  const JOIN = 11.0;             // how close a join has to be
  const GRID = 12.0;
  const sx = [], sz = [], sl = [], st = [];
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / GRID)},${Math.floor(z / GRID)}`;
  lanes.forEach((lane, li) => {
    for (let t = 0; t <= lane.len; t += STEP) {
      const [x, z] = pointAt(lane, t);
      const i = sx.length;
      sx.push(x); sz.push(z); sl.push(li); st.push(t);
      const k = key(x, z);
      let cell = grid.get(k);
      if (!cell) grid.set(k, cell = []);
      cell.push(i);
    }
  });

  lanes.forEach((lane, li) => {
    lane.next = [];
    const end = pointAt(lane, lane.len);
    const [hx, hz] = heading(lane, lane.len);
    const best = new Map();                        // target lane -> closest join
    const gx = Math.floor(end[0] / GRID), gz = Math.floor(end[1] / GRID);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = grid.get(`${gx + dx},${gz + dz}`);
        if (!cell) continue;
        for (const i of cell) {
          const j = sl[i];
          if (j === li || j === lane.pair) continue;   // self, and no U-turn
          const ox = sx[i] - end[0], oz = sz[i] - end[1];
          const d = Math.hypot(ox, oz);
          if (d > JOIN) continue;
          // The join must be ahead of us, or a lane running parallel ten metres
          // away qualifies and cars hop sideways between neighbouring streets.
          if (d > 0.5 && (ox * hx + oz * hz) / d < 0.3) continue;
          const other = lanes[j];
          if (st[i] > other.len - 6) continue;         // nothing left to drive
          const [ux, uz] = heading(other, st[i]);
          if (hx * ux + hz * uz < -0.25) continue;     // no doubling back
          const prev = best.get(j);
          if (!prev || d < prev.d) best.set(j, { lane: j, t: st[i], d });
        }
      }
    }
    for (const v of best.values()) lane.next.push({ lane: v.lane, t: v.t });
  });
  return lanes;
}

// -------------------------------------------------------------- traffic ---
const SEE = 420;        // beyond this a car is hidden, so it can be moved
const NEAR = 200;       // ...and brought back no closer than this, out of your eyeline
// A bus is different. There is always exactly one, and it is rare because it is
// usually somewhere else — not because the pool might not contain one, which is
// what a per-load coin gave: a bus for the whole session or none at all.
// Letting it wander three times as far before being recycled, and bringing it
// back at arm's length rather than into your lap, means you meet it when your
// routes cross. Between SEE and BUS_SEE it is simulated and not drawn, so being
// out there costs nothing.
// Tuned by simulating a player walking and driving real lanes for eight
// minutes: at 950/320 the bus was never met at all, and at 320/130 it was
// underfoot like a car. This gives one encounter every 2-3 minutes.
const BUS_SEE = 450;
const BUS_NEAR = 180;

// What counts as "in my way". This used to be a cone — anything within 31.8
// degrees of straight ahead out to 11m — and a cone that wide is wider than the
// road: at 11m it spans 6.8m either side, so a car coming the other way in the
// opposite lane read as an obstruction and the two of them stopped for each
// other with a full lane of clear air between. Along-track and cross-track
// instead, so it blocks only for something genuinely ahead AND in this lane.
// Following was all-or-nothing: full speed until something came within reach,
// then brake. That is what tailgating is — closing to the limit and stopping
// dead. The gap is measured now and speed scales with it, so a car eases off
// early and settles at a distance instead of arriving at your bumper.
const LOOK = 18.0;             // start easing off this far behind another car
const LOOK_PLAYER = 22.0;      // ...and further behind you, who are less predictable
// Centre to centre, and a car is 4.24m long, so 9m leaves about 4.7m of clear
// air between bumpers. At 6 it was under two metres, which still reads as
// sitting on somebody's boot.
const KEEP = 9.0;
const LANE_HALF = 1.7;         // lateral tolerance; lanes here sit ~3m apart
const LANE_HALF_PLAYER = 2.0;
// Traffic coming the other way is not an obstruction, it is traffic: it will
// have gone past by the time you get there, and you do not brake for it. This
// matters because pulling out around parked cars puts a car within 1.7m of the
// oncoming lane — with one tolerance for both, the two stopped for each other
// and the streets locked up 30% of the time. Head-on only counts if it is
// genuinely in your path.
const LANE_HALF_ONCOMING = 0.85;
const STUCK_UNSEEN = 60;   // seconds jammed before a car off-screen is recycled
const PLACE_TRIES = 400;   // how hard place() looks for a spot in the ring
const PLACE_RELAX = 300;   // ...after which it stops insisting on being behind you
const STUCK_SEEN = 180;    // ...and a longer grace period if you can see it

export class Traffic {
  constructor(world, scene, count = 24, seed = 7, parkedSlots = null) {
    this.lanes = buildLanes(world);
    if (parkedSlots && parkedSlots.length) bakeLateral(this.lanes, parkedSlots);
    this.cars = [];
    if (!this.lanes.length) return;

    // Buses run the through-roads only, and there are one or two in the whole
    // simulation — a double-decker down every residential cul-de-sac is both
    // wrong and far more noticeable than a wrong car.
    this.busLanes = [];
    this.lanes.forEach((l, i) => {
      if (l.kind === 'secondary' || l.kind === 'tertiary') this.busLanes.push(i);
    });
    const buses = this.busLanes.length ? 1 : 0;

    for (let i = 0; i < count; i++) {
      const v = i < buses
        ? makeBus(seed + i)
        : makeCar(BODY_COLOURS[Math.floor(hash01(seed + i, 3) * BODY_COLOURS.length)],
          seed + i, true);
      scene.add(v.group);
      const c = { ...v, lane: 0, t: 0, speed: 0, target: 8, yaw: 0, spin: 0, stuck: 0 };
      this.cars.push(c);
      this.place(c, { x: 0, z: 0 }, null,
        c.big ? BUS_NEAR : 70, c.big ? BUS_SEE - 120 : 300);
    }
  }

  /**
   * Put a car on a lane somewhere in a ring around the player. 24 cars spread
   * over 100 km of lane would empty the neighbourhood within a minute, so cars
   * that wander out of sight are recycled back to where you are. `forward` lets
   * us prefer spots behind the camera, so nothing pops into view.
   */
  place(c, at, forward, minD, maxD) {
    let best = null, bestErr = Infinity;      // nearest miss, whichever side
    let far = null, farErr = Infinity;        // nearest miss that is not too close
    const pool = c.big ? this.busLanes : null;
    // A point picked uniformly from 400km of lane lands in the target ring
    // about 1% of the time, so 24 tries found one twice in twenty and the rest
    // fell back. Respawns are rare — a car survives half a minute or more
    // before it is recycled — so this can afford to keep looking. It breaks the
    // moment it succeeds, which takes about 110 tries on average: tens of
    // microseconds, and nothing per frame.
    for (let k = 0; k < PLACE_TRIES; k++) {
      const li = pool ? pool[Math.floor(Math.random() * pool.length)]
        : Math.floor(Math.random() * this.lanes.length);
      const lane = this.lanes[li];
      const t = Math.random() * lane.len;
      const [x, z] = pointAt(lane, t);
      const dx = x - at.x, dz = z - at.z;
      const d = Math.hypot(dx, dz);
      const inBand = d >= minD && d <= maxD;
      const behind = !forward || (dx * forward.x + dz * forward.z) / (d || 1) <= 0.2;
      if (inBand && (behind || k >= PLACE_RELAX)) { best = [li, t, lane]; break; }
      const err = inBand ? 0 : (d < minD ? minD - d : d - maxD);
      // Two fallbacks, and the order matters. A point picked uniformly from 400km
      // of lane is almost never inside the band — 89% of respawns used to land
      // here — and taking the nearest miss by absolute error meant a car
      // materialising 40m away in plain sight. Overshooting is free: a car that
      // appears 400m off is a car you cannot see. So prefer too far to too near,
      // and only accept too near if nothing else turned up at all.
      if (d >= minD && err < farErr) { farErr = err; far = [li, t, lane]; }
      if (err < bestErr) { bestErr = err; best = [li, t, lane]; }
    }
    best = far || best;
    if (!best) return false;
    const [li, t, lane] = best;
    c.lane = li;
    c.t = t;
    c.speed = lane.speed * 0.7;
    // heavier, stops more; a bus should never be the quick thing on the road
    c.target = lane.speed * (c.big ? 0.62 + Math.random() * 0.2 : 0.8 + Math.random() * 0.35);
    return true;
  }

  update(dt, playerPos, obstacles, forward = null) {
    for (const c of this.cars) {
      // Nothing is simulated city-wide: there are only ever `count` cars, and
      // they follow you. One that drifts out of sight is moved back around you.
      const gx = c.group.position.x - playerPos.x, gz = c.group.position.z - playerPos.z;
      const away = gx * gx + gz * gz;
      const far = c.big ? BUS_SEE : SEE;
      const back = c.big ? BUS_NEAR : NEAR;
      const unseen = away > far * far;
      if (unseen) {
        this.place(c, playerPos, forward, back, far - 40);
        c.stuck = 0;
      } else if (c.stuck > STUCK_SEEN) {
        // wedged in plain sight for a very long time — something is wrong with
        // it, so recycle anyway rather than leave a permanent ornament
        this.place(c, playerPos, forward, back, far - 40);
        c.stuck = 0;
      }

      const lane = this.lanes[c.lane];

      // look ahead for anything in our way and lift off if there is
      const [px, pz] = driveAt(lane, c.t);
      let gap = 1e9, reach = LOOK;
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      // how far ahead, in this lane — 1e9 when it is not in the way at all
      const aheadBy = (dx, dz, limit, halfWidth) => {
        const along = dx * fx + dz * fz;
        if (along <= 0.1 || along > limit) return 1e9;
        return Math.abs(dx * fz - dz * fx) < halfWidth ? along : 1e9;
      };
      for (const o of obstacles) {
        const g = aheadBy(o.x - px, o.z - pz, LOOK_PLAYER, LANE_HALF_PLAYER);
        if (g < gap) { gap = g; reach = LOOK_PLAYER; }
      }
      for (const other of this.cars) {
        if (other === c) continue;
        const [ox, oz] = driveAt(this.lanes[other.lane], other.t);
        // same way as us, or head-on?
        const facing = Math.sin(other.yaw) * fx + Math.cos(other.yaw) * fz;
        const halfWidth = facing < 0 ? LANE_HALF_ONCOMING : LANE_HALF;
        const g = aheadBy(ox - px, oz - pz, LOOK, halfWidth);
        if (g < gap) { gap = g; reach = LOOK; }
      }

      // gap -> target: full speed at the look-ahead, stopped at KEEP
      const ease = gap >= 1e8 ? 1
        : Math.max(0, Math.min(1, (gap - KEEP) / (reach - KEEP)));
      const want = c.target * ease;
      const closing = want < c.speed;
      c.speed += (want - c.speed) * Math.min(1, dt * (closing ? 3.2 : 1.3));
      c.t += c.speed * dt;

      // a car going nowhere for a minute has jammed against something; once it's
      // out of sight it gets recycled rather than sitting there forever
      c.stuck = c.speed < 0.4 ? c.stuck + dt : 0;
      if (c.stuck > STUCK_UNSEEN && away > back * back) {
        this.place(c, playerPos, forward, back, far - 40);
        c.stuck = 0;
        continue;
      }

      if (c.t >= lane.len) {
        const opts = lane.next;
        const over = c.t - lane.len;
        if (opts.length) {
          // a join can be partway along the next lane, so carry the offset
          const pick = opts[Math.floor(Math.random() * opts.length)];
          c.lane = pick.lane;
          c.t = pick.t + over;
        } else {
          // a genuine dead end — a cul-de-sac — where turning round is right
          c.lane = lane.pair !== undefined ? lane.pair : c.lane;
          c.t = over;
        }
        c.target = this.lanes[c.lane].speed
          * (c.big ? 0.62 + Math.random() * 0.2 : 0.8 + Math.random() * 0.35);
      }

      const lane2 = this.lanes[c.lane];
      const [x, z] = driveAt(lane2, c.t);
      const [ax, az] = driveAt(lane2, Math.min(lane2.len, c.t + 4.5));
      const dx = ax - x, dz = az - z;
      if (dx || dz) {
        const want2 = Math.atan2(dx, dz);
        let diff = want2 - c.yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        c.yaw += diff * Math.min(1, dt * 5.5);
      }
      c.group.position.set(x, 0, z);
      c.group.rotation.y = c.yaw;

      c.spin += c.speed * dt / (c.wheelR || CAR.wheelR);
      for (const w of c.wheels) w.rotation.x = c.spin;

      c.group.visible = Math.hypot(x - playerPos.x, z - playerPos.z) < SEE;
    }
  }

  /**
   * Positions, so the player's car can be avoided and vice versa.
   *
   * Avoidance works on points, and a bus is 10.9m long — reported as a single
   * point you could drive clean through both ends of it. So a bus reports three
   * along its length and behaves like the obstacle it actually is.
   */
  positions() {
    const out = [];
    for (const c of this.cars) {
      const { x, z } = c.group.position;
      out.push({ x, z });
      if (!c.big) continue;
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), d = BUS.len * 0.33;
      out.push({ x: x + fx * d, z: z + fz * d });
      out.push({ x: x - fx * d, z: z - fz * d });
    }
    return out;
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
