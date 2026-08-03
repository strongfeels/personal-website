// Trees, parked cars, wheelie bins — instanced, so hundreds cost almost nothing.
import * as THREE from '../vendor/three.module.js';
import { carBodyGeometry, wheelGeometry, CAR } from './vehicle.js';

function hash01(i, salt = 0) {
  let h = (i * 374761393 + salt * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const LEAF_COLOURS = [0x3f6f30, 0x4a7d38, 0x35602a, 0x527f3c, 0x2f5a28, 0x5b8642];

/**
 * Trees found in the satellite imagery by detect_vegetation.py — each one has a
 * real position, a crown radius measured off the picture, and the crown's own
 * colour. Height isn't visible from directly overhead, so it's estimated from
 * the crown width the way a forester would.
 */
export function treeColliders(trees, colliders) {
  // `soft` blocks walking but not the camera: a trunk clipping the view for a
  // moment is far less jarring than the camera being shoved into your back.
  for (const t of trees) colliders.push({ x: t.x, z: t.z, hx: 0.34, hz: 0.34, yaw: 0, soft: true });
}

/** Instanced trunks and canopies for one chunk's worth of trees. */
export function makeTrees(trees, M) {
  if (!trees || !trees.length) return [];

  const trunkGeo = new THREE.CylinderGeometry(0.13, 0.21, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const leafGeo = new THREE.IcosahedronGeometry(1, 1);

  const trunks = new THREE.InstancedMesh(trunkGeo, M.bark, trees.length);
  const leaves = new THREE.InstancedMesh(leafGeo, M.leaf, trees.length * 2);
  trunks.castShadow = leaves.castShadow = true;
  leaves.receiveShadow = true;

  const m = new THREE.Matrix4();
  const upright = new THREE.Quaternion();   // trunks only — never rotated
  const q = new THREE.Quaternion();         // scratch, for tumbling the canopy
  const col = new THREE.Color(), tmp = new THREE.Color();
  let li = 0;
  trees.forEach((t, i) => {
    const r = t.r;
    const h = Math.min(16, Math.max(3.2, r * 1.9 + 2.0));
    m.compose(new THREE.Vector3(t.x, 0, t.z), upright, new THREE.Vector3(
      Math.max(0.7, r * 0.34), h, Math.max(0.7, r * 0.34)));
    trunks.setMatrixAt(i, m);

    // the sampled crown colour is deep-shadow dark; keep its hue, lift it to
    // something that reads as foliage in daylight
    if (t.col) {
      tmp.setRGB(t.col[0] / 255, t.col[1] / 255, t.col[2] / 255).convertSRGBToLinear();
      const hsl = {};
      tmp.getHSL(hsl);
      col.setHSL(hsl.h > 0.05 && hsl.h < 0.45 ? hsl.h : 0.27,
                 Math.min(0.62, Math.max(0.3, hsl.s)),
                 Math.min(0.42, Math.max(0.2, hsl.l + 0.16)));
    } else {
      col.set(LEAF_COLOURS[i % LEAF_COLOURS.length]);
    }

    for (let k = 0; k < 2; k++) {
      const off = k === 0 ? 0 : 0.5;
      // spin freely about the vertical, but only a slight tilt — a fully
      // tumbled ellipsoid reads as a canopy falling off the tree
      q.setFromEuler(new THREE.Euler((hash01(i, 30 + k) - 0.5) * 0.45,
                                     hash01(i, 40 + k) * 6.283, 0));
      m.compose(
        new THREE.Vector3(t.x + (hash01(i, 50 + k) - 0.5) * r * 0.5,
                          h * (0.78 + off * 0.3),
                          t.z + (hash01(i, 60 + k) - 0.5) * r * 0.5),
        q,
        new THREE.Vector3(r * (1 - off * 0.32), r * 0.86 * (1 - off * 0.28), r * (1 - off * 0.32)));
      leaves.setMatrixAt(li, m);
      leaves.setColorAt(li, tmp.copy(col).offsetHSL(0, 0, (hash01(i, 70 + k) - 0.5) * 0.08));
      li++;
    }
  });
  leaves.count = li;
  return [trunks, leaves];
}

/** Hedges traced from the imagery — mostly garden and boundary hedging. */
export function hedgeParts(hedges) {
  const parts = [];
  for (const h of hedges || []) {
    for (let i = 0; i < h.pts.length - 1; i++) {
      const [x1, z1] = h.pts[i], [x2, z2] = h.pts[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.3 || len > 30) continue;
      parts.push([(x1 + x2) / 2, (z1 + z2) / 2, len + h.w * 0.5,
                  h.w, h.h, Math.atan2(z2 - z1, x2 - x1)]);
    }
  }
  return parts;
}

export function hedgeColliders(hedges, colliders) {
  for (const [cx, cz, len, w, h, yaw] of hedgeParts(hedges)) {
    colliders.push({ x: cx, z: cz, hx: len / 2, hz: w / 2, yaw, soft: true });
  }
}

/** One instanced mesh for a chunk's hedges. */
export function makeHedges(hedges, M) {
  if (!hedges || !hedges.length) return [];

  const box = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const parts = hedgeParts(hedges);
  if (!parts.length) return [];

  const mesh = new THREE.InstancedMesh(box, M.hedge, parts.length);
  mesh.castShadow = mesh.receiveShadow = true;
  const col = new THREE.Color();
  parts.forEach(([cx, cz, len, w, h, yaw], i) => {
    e.set(0, -yaw, 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(cx, h / 2, cz), q, new THREE.Vector3(len, h, w));
    mesh.setMatrixAt(i, m);
    // darker and more saturated than the original guess, which was chosen
    // when these rendered black and nobody could see it
    mesh.setColorAt(i, col.setHSL(0.28 + (hash01(i, 7) - 0.5) * 0.05,
                                  0.55, 0.085 + hash01(i, 8) * 0.045));
  });
  return [mesh];
}

const CAR_COLOURS = [0x9aa0a6, 0x1e2226, 0xb3b7bb, 0x27374d, 0x6d1f1f, 0x2c4a33,
                     0xe8e8e6, 0x3a3d42, 0x54606b, 0x7a5230];

export function addCars(world, scene, colliders) {
  const slots = [];
  for (const a of world.areas) {
    if (a.kind !== 'parking_space') continue;
    // orientation from the longest edge of the bay
    let bestLen = 0, yaw = 0, cx = 0, cz = 0;
    for (let i = 0; i < a.poly.length; i++) {
      const [x1, z1] = a.poly[i], [x2, z2] = a.poly[(i + 1) % a.poly.length];
      const l = Math.hypot(x2 - x1, z2 - z1);
      if (l > bestLen) { bestLen = l; yaw = Math.atan2(x2 - x1, z2 - z1); }
      cx += a.poly[i][0] / a.poly.length; cz += a.poly[i][1] / a.poly.length;
    }
    if (bestLen < 3.4 || bestLen > 8) continue;
    slots.push([cx, cz, yaw]);
  }
  // a few parked at the kerb on the residential streets
  for (const r of world.roads) {
    if (r.kind !== 'residential') continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const dirYaw = Math.atan2(x2 - x1, z2 - z1);
      for (let t = 6; t < len - 6; t += 12) {
        const s = hash01(r.id + i * 31 + Math.floor(t), 3) > 0.45 ? 1 : -1;
        if (hash01(r.id + i * 17 + Math.floor(t), 4) > 0.55) continue;
        const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
        const off = (r.w / 2 - 1.05) * s;
        slots.push([x1 + ux * t - uz * off, z1 + uz * t + ux * off, dirYaw]);
      }
    }
  }
  if (!slots.length) return null;

  const bodyGeo = carBodyGeometry();
  const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.45 });
  const cars = new THREE.InstancedMesh(bodyGeo, bodyMat, slots.length);
  const wheels = new THREE.InstancedMesh(
    wheelGeometry(),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.9 }),
    slots.length * 4);
  cars.castShadow = wheels.castShadow = true;
  cars.receiveShadow = true;

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const col = new THREE.Color();
  const one = new THREE.Vector3(1, 1, 1);
  let wi = 0;
  slots.forEach(([x, z, yaw], i) => {
    e.set(0, yaw, 0); q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, 0, z), q, one);
    cars.setMatrixAt(i, m);
    cars.setColorAt(i, col.setHex(CAR_COLOURS[Math.floor(hash01(i, 5) * CAR_COLOURS.length)]));
    for (const [wx, wz] of [[0.82, 1.42], [-0.82, 1.42], [0.82, -1.42], [-0.82, -1.42]]) {
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      m.compose(new THREE.Vector3(x + wx * cs + wz * sn, 0.33, z - wx * sn + wz * cs), q, one);
      wheels.setMatrixAt(wi++, m);
    }
    // the car's long axis points along (sin yaw, cos yaw); collider x-axis must match
    // Match the body, not a box around it. This used to be 2.2 x 0.95 for a
    // car that is 4.24 x 1.78, and the driving test padded it again — so you
    // "hit" a parked car with 20cm of clear air still showing.
    colliders.push({ x, z, hx: CAR.len / 2, hz: CAR.wid / 2, yaw: Math.PI / 2 - yaw });
  });
  scene.add(cars, wheels);
  // handed back so one of these can be taken over and driven away
  return { cars, wheels, slots };
}

// ------------------------------------------------------------ street furniture
// 158 benches, 136 waste baskets, 114 bike racks and 66 post boxes, all of which
// OSM has been carrying and the game never drew. The tags are unusually good for
// street furniture — four benches in five say whether they have a backrest, and
// 87 racks give a capacity — so these vary rather than being one model stamped
// 474 times.
//
// What OSM does not say is which way they point: one bench in 158 has
// `direction`. The bake infers it from the path beside them and writes `face`,
// the direction the sitter looks in.

/**
 * Concatenate geometries that will share a transform and a colour.
 *
 * A bin's rim and hood are always drawn together, in the same place, in the same
 * shade, so keeping them as separate instanced meshes buys nothing and costs a
 * draw call per chunk. three's BufferGeometryUtils lives in examples/, which
 * isn't vendored here, so this does the one case that is needed.
 */
function mergeGeo(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
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

const BENCH_COLOUR = {
  wood: 0x8a6a45, stone: 0x9a958c, metal: 0x4e565c, steel: 0x4e565c,
  concrete: 0xa39e94, plastic: 0x2f6a44,
};
// OSM `colour` is free text: a hex string, or one of a handful of names.
const NAMED = {
  black: 0x24272a, white: 0xd8d5cc, grey: 0x808589, gray: 0x808589,
  green: 0x2f5d3a, darkgreen: 0x24462c, blue: 0x2a4a6b, red: 0x7a2f2a,
  brown: 0x6b4a2f, silver: 0xa8adb1, yellow: 0xb59433,
};

function benchColour(b) {
  const c = (b.col || '').trim().toLowerCase();
  if (c.startsWith('#') && (c.length === 7 || c.length === 4)) {
    const v = parseInt(c.length === 4
      ? c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c.slice(1), 16);
    if (!Number.isNaN(v)) return v;
  }
  if (NAMED[c] !== undefined) return NAMED[c];
  return BENCH_COLOUR[(b.mat || '').toLowerCase()] ?? 0x8a6a45;
}

/** Seat length. `seats` is present on 39% of them; the rest get a two-seater. */
function benchLength(b) {
  const n = b.seats;
  return n ? Math.max(1.1, Math.min(3.2, n * 0.52)) : 1.75;
}

/**
 * Hoops in a Sheffield stand. `capacity` counts BIKES and one hoop takes two,
 * so a capacity of 10 is five hoops, not ten. Getting that wrong would double
 * the length of every rack in UCD.
 */
function hoopCount(f) {
  if (f.cap) return Math.max(1, Math.min(14, Math.round(f.cap / 2)));
  return 3;
}

const HOOP_GAP = 0.8;                 // centres, metres
const HOOP_W = 0.75, HOOP_H = 0.78;   // a Sheffield stand is about this
const BOX_H = 1.35, BOX_R = 0.30;     // pillar box, Type B proportions

/**
 * The rest of the street fittings.
 *
 * Ticket machines, bottle banks, EV chargers, street clocks, phone boxes and
 * drinking fountains are all the same two shapes: an optional post with a box
 * on top. Describing them as data rather than as six builders means they cost
 * two draw calls between them instead of a dozen.
 *
 * post: [radius, height] or null.  head: [width, height, depth].
 * The head sits directly on the post, or on the ground where there isn't one.
 */
const FITTINGS = {
  // 50 of the 52 outdoor "vending machines" are pay-and-display posts
  parking_tickets:  { post: [0.05, 0.95], head: [0.34, 0.62, 0.24], body: 0x35393c, face: 0x22262a },
  vending_other:    { post: null,         head: [0.62, 1.55, 0.42], body: 0x33383b, face: 0x22262a },
  // a bring bank is a row of containers, built below — head is its collider size
  recycling:        { post: null, head: [1.40, 1.85, 1.30], body: 0x4a4e51, face: 0x4a4e51, bank: true },
  charging_station: { post: [0.06, 0.55], head: [0.30, 0.80, 0.22], body: 0x2f3438, face: 0x9fd8b4 },
  clock:            { post: [0.055, 3.05], head: [0.52, 0.52, 0.13], body: 0x1e2124, face: 0xe6e0cf, sign: true },
  drinking_water:   { post: [0.07, 0.80], head: [0.26, 0.18, 0.26], body: 0x8d8b84, face: 0x8d8b84 },
  // TFI's palette is green, yellow and black and the flag sits near the top of a
  // grey pole. No dimension sheet turned up — the NTA's "bus stop pole
  // information note" is a logo file — so these sizes are taken from the
  // proportions and should be read as approximate, not specified.
  // Stainless steel pole — never painted — with a green and yellow flag at the
  // top and, below it, the yellow plastic carousel that holds the timetable.
  // The carousel is the round thing you actually notice on a Dublin stop, and
  // leaving it off left a bare stick with a rectangle on it.
  bus_stop:         { post: [0.048, 2.30], head: [0.46, 0.56, 0.05], body: 0xacb3b8, face: 0x1f7a3d, sign: true, stop: true },
  // built as a kiosk out of boxes instead — see KIOSK below
  telephone:        { post: null, head: [0.95, 2.30, 0.95], body: 0xd0cbb6, face: 0x2c5c3a, kiosk: true },
};

const FITTING_KINDS = new Set(['vending_machine', 'recycling', 'charging_station',
                               'clock', 'telephone', 'drinking_water', 'bus_stop']);

/**
 * A phone kiosk, as boxes.
 *
 * It was one cream cuboid, which is not a phone box — it is a fridge. An Irish
 * kiosk is a frame: dark posts at the corners, a deep sign band over the door, a
 * plinth, and cream panels filling three sides with the front left open. The
 * open front and the visible frame are what make it read as a kiosk at all.
 *
 * [lx, ly, lz, w, h, d, colour] in the fitting's own local space, so these ride
 * the heads mesh that is already being drawn and cost no extra draw call.
 */
const KIOSK_FRAME = 0x1f4a2e, KIOSK_PANEL = 0xd8d3bf;
function kioskParts() {
  const W = 0.90, H = 2.42, P = 0.075, half = W / 2;
  const panelY = 0.12 + (H - 0.2) / 2, panelH = H - 0.2;
  const out = [[0, 0.06, 0, W + 0.08, 0.12, W + 0.08, KIOSK_FRAME]];      // plinth
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      out.push([sx * (half - P / 2), H / 2, sz * (half - P / 2), P, H, P, KIOSK_FRAME]);
    }
  }
  out.push([0, panelY, half - 0.03, W - P * 2, panelH, 0.05, KIOSK_PANEL]);   // back
  for (const sx of [-1, 1]) {
    out.push([sx * (half - 0.03), panelY, 0, 0.05, panelH, W - P * 2, KIOSK_PANEL]);
    // the pair flanking the door, leaving the middle of the front open
    out.push([sx * (half - 0.16), panelY, -(half - 0.03), 0.22, panelH, 0.05, KIOSK_PANEL]);
  }
  out.push([0, H + 0.12, 0, W + 0.10, 0.24, W + 0.10, KIOSK_FRAME]);      // sign band
  return out;
}
const KIOSK = kioskParts();

/**
 * A bring bank: a row of charcoal containers with a coloured front panel each.
 *
 * It was one green box, which is not what these look like. The body is dark grey
 * plastic with a domed shoulder; the colour is a panel on the front carrying the
 * aperture, and it says which stream the unit takes. Glass is collected in three
 * separate colours here — clear, green and brown — so a site that accepts glass
 * at all gets three units, not one, which is why they come in rows of four.
 *
 * No published dimension sheet turned up for these, so 1.40 x 1.30 x 1.85 is
 * taken from the proportions in a photograph and should be read as close.
 */
const BANK_BODY = 0x4a4e51, BANK_DARK = 0x303336, BANK_HOLE = 0x141617;
const BANK_STREAM = {
  cans:   0x2a6cb0,      // blue
  green:  0x2f7d3f,
  clear:  0xd3d6da,      // white/silver
  brown:  0x8c3a2a,      // maroon
  // textile banks are branded by whichever charity runs them rather than by a
  // national colour, so this one is a choice, not a fact
  clothes: 0x2f6f7d,
  paper:  0x9a8248,
};
const BANK_W = 1.40, BANK_D = 1.30, BANK_H = 1.55, BANK_GAP = 0.05;

/** Which containers stand at a site, given the streams it accepts. */
function bankStreams(f) {
  const acc = (f.recs || []).map((s) => s.toLowerCase());
  const out = [];
  if (acc.includes('cans')) out.push('cans');
  // any glass at all means the full set of three, because they are never mixed
  if (!acc.length || acc.some((a) => a.startsWith('glass'))) {
    out.push('green', 'clear', 'brown');
  }
  if (acc.includes('clothes')) out.push('clothes');
  if (acc.includes('paper')) out.push('paper');
  return out.length ? out : ['green', 'clear', 'brown'];
}

/** Boxes for one bank, local space, +Z facing the street. */
function bankParts(streams) {
  const out = [];
  const pitch = BANK_W + BANK_GAP;
  const span = (streams.length - 1) * pitch;
  streams.forEach((s, i) => {
    const cx = -span / 2 + i * pitch;
    const col = BANK_STREAM[s] ?? BANK_STREAM.green;
    out.push([cx, 0.06, 0, BANK_W + 0.06, 0.12, BANK_D + 0.06, BANK_DARK]);      // plinth
    out.push([cx, 0.12 + BANK_H / 2, 0, BANK_W, BANK_H, BANK_D, BANK_BODY]);     // body
    // domed shoulder, faked with two narrowing slabs — at any distance you see
    // one of these from, that reads as a curve
    out.push([cx, BANK_H + 0.18, 0, BANK_W - 0.16, 0.14, BANK_D - 0.14, BANK_BODY]);
    out.push([cx, BANK_H + 0.30, 0, BANK_W - 0.44, 0.10, BANK_D - 0.40, BANK_BODY]);
    // the coloured panel, and the hole you post bottles through
    out.push([cx, 0.12 + BANK_H * 0.62, BANK_D / 2 + 0.01, BANK_W - 0.34, BANK_H * 0.66, 0.04, col]);
    out.push([cx, 0.12 + BANK_H * 0.86, BANK_D / 2 + 0.03, 0.30, 0.22, 0.04, BANK_HOLE]);
  });
  return out;
}

const STOP_YELLOW = 0xf2c317, STOP_GREEN = 0x1f7a3d, STOP_STEEL = 0xacb3b8;
const SHELTER_FRAME = 0x3c4348, SHELTER_ROOF = 0x5b6469;

/**
 * The rest of a bus stop: the carousel, and a shelter where there is one.
 *
 * The carousel is a yellow cylinder clasped round the pole at reading height —
 * high-visibility plastic, holding the printed timetable. The flag above it is
 * the green-and-yellow TFI one, which the head instance already draws.
 *
 * The shelter is a cantilever: two posts at the back, a flat roof over, a glazed
 * back panel and one end panel, open to the road. Returned as boxes in local
 * space where +Z is the road side, matching the fitting's own facing.
 */
function busStopExtras(sheltered) {
  const out = [];
  // carousel: a drum on the pole, drawn as a squat box — at this size the
  // difference between a 12-sided drum and a box is not visible, and this way
  // it rides the heads mesh instead of needing its own
  out.push([0, 1.32, 0, 0.30, 0.44, 0.30, STOP_YELLOW]);
  if (!sheltered) return out;
  const W = 3.9, D = 1.45, H = 2.42;
  out.push([0, H + 0.06, 0.05, W, 0.12, D + 0.30, SHELTER_ROOF]);          // roof
  out.push([0, H / 2, D / 2, W, H, 0.06, 0x9fb6c4]);                        // back glazing
  for (const sx of [-1, 1]) {
    out.push([sx * (W / 2 - 0.05), H / 2, D / 2 - 0.03, 0.09, H, 0.09, SHELTER_FRAME]);
  }
  out.push([-W / 2 + 0.04, H / 2, 0, 0.06, H, D, 0x9fb6c4]);                // one end panel
  out.push([0, 0.62, D / 2 - 0.22, W - 0.9, 0.07, 0.34, 0xd8b23a]);         // bench, yellow arms
  return out;
}

const RECYCLING_COLOUR = {
  glass_bottles: 0x1f6b3a, glass: 0x1f6b3a, clothes: 0x2a4f7a,
  cans: 0x7c8288, paper: 0x2f4f7a,
};

/** Which entry in FITTINGS describes this POI. */
function fittingSpec(f) {
  if (f.kind !== 'vending_machine') return FITTINGS[f.kind];
  // the `vending` tag is the whole point: a parking-ticket post is not a
  // vending machine and drawing it as one would be the obvious mistake here
  return f.vend === 'parking_tickets' ? FITTINGS.parking_tickets : FITTINGS.vending_other;
}

export function furnitureColliders(items, colliders) {
  // `soft` for the same reason trees are: being unable to walk through a bench
  // is right, having the camera shoved off it is not.
  for (const f of items) {
    if (f.kind === 'bench') {
      colliders.push({ x: f.x, z: f.z, hx: benchLength(f) / 2 + 0.05, hz: 0.34,
                       yaw: (f.face ?? 0) + Math.PI / 2, soft: true, h: 0.88 });
    } else if (f.kind === 'bicycle_parking') {
      // one box round the whole rack; the gaps between hoops are not worth
      // resolving and walking through a rack of bikes should not be possible
      const run = (hoopCount(f) - 1) * HOOP_GAP;
      colliders.push({ x: f.x, z: f.z, hx: HOOP_W / 2 + 0.1, hz: run / 2 + 0.2,
                       yaw: f.face ?? 0, soft: true, h: HOOP_H });
    } else if (f.kind === 'post_box') {
      colliders.push({ x: f.x, z: f.z, hx: BOX_R, hz: BOX_R, yaw: 0, soft: true, h: BOX_H });
    } else if (FITTING_KINDS.has(f.kind)) {
      const spec = fittingSpec(f);
      if (!spec) continue;
      const [w, h, d] = spec.head;
      const top = (spec.post ? spec.post[1] : 0) + h;
      // a street clock is a pole you walk under, so block the pole, not the dial
      let wide = spec.post ? Math.max(0.12, spec.post[0] * 2) : w / 2;
      const deep = spec.post ? Math.max(0.12, spec.post[0] * 2) : d / 2;
      // a bring bank is a ROW; blocking one container's width leaves you able to
      // walk through the other three
      if (spec.bank) wide = (bankStreams(f).length * (BANK_W + BANK_GAP)) / 2;
      colliders.push({ x: f.x, z: f.z, hx: wide, hz: deep,
                       yaw: f.face ?? 0, soft: true, h: Math.min(top, 2.4) });
    } else {
      colliders.push({ x: f.x, z: f.z, hx: 0.25, hz: 0.25, yaw: 0, soft: true, h: 1.11 });
    }
  }
}

/**
 * One chunk's street furniture.
 *
 * Local space for a bench is +X along the seat and +Z behind the sitter's back.
 * Three's rotation about Y sends local +X to world angle -theta, so putting the
 * seat across the direction of view means theta = -(face + PI/2).
 */
export function makeFurniture(items, M) {
  if (!items || !items.length) return [];

  // Select each kind by name. This used to take bins as "everything that is not
  // a bench", which quietly turns every new kind added here into a waste bin.
  const benches = items.filter((f) => f.kind === 'bench');
  const bins = items.filter((f) => f.kind === 'waste_basket');
  const racks = items.filter((f) => f.kind === 'bicycle_parking');
  const boxes_ = items.filter((f) => f.kind === 'post_box');
  const fittings = items.filter((f) => FITTING_KINDS.has(f.kind));
  const out = [];

  if (benches.length) {
    // seat, back, two legs, two armrests — every one of them a box
    let boxes = 0;
    for (const b of benches) boxes += 3 + (b.back ? 1 : 0) + (b.arm ? 2 : 0);

    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.furniture, boxes);
    mesh.castShadow = mesh.receiveShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const col = new THREE.Color();
    let i = 0;

    benches.forEach((b, bi) => {
      const face = b.face ?? 0;
      const theta = -(face + Math.PI / 2);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), theta);
      const co = Math.cos(theta), si = Math.sin(theta);
      // local (lx, ly, lz) -> world, matching the rotation above
      const place = (lx, ly, lz, sx, sy, sz, colour, tilt) => {
        pos.set(b.x + lx * co + lz * si, (b.y || 0) + ly, b.z - lx * si + lz * co);
        scl.set(sx, sy, sz);
        if (tilt) {
          const t = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
          m.compose(pos, q.clone().multiply(t), scl);
        } else {
          m.compose(pos, q, scl);
        }
        mesh.setMatrixAt(i, m);
        col.setHex(colour);
        // a touch of per-bench variation so a row of them isn't one flat colour
        const j = 0.93 + hash01(bi, 7) * 0.14;
        col.multiplyScalar(j);
        mesh.setColorAt(i, col);
        i++;
      };

      const L = benchLength(b);
      const wood = benchColour(b);
      const metal = (b.mat || '').toLowerCase() === 'stone' ? wood : 0x3a4046;
      const SEAT_Y = 0.45;

      place(0, SEAT_Y, 0, L, 0.06, 0.44, wood);                       // seat slab
      const legX = Math.max(0.18, L / 2 - 0.22);
      place(-legX, SEAT_Y / 2, 0, 0.07, SEAT_Y, 0.4, metal);          // legs
      place(legX, SEAT_Y / 2, 0, 0.07, SEAT_Y, 0.4, metal);
      if (b.back) {
        // Reclined a little, about local X — the seat line. The sign matters and
        // was wrong: rotating by -0.16 sends the TOP of the slab to negative z,
        // which is the sitter's side, so the backrest tipped forward over the
        // seat. Positive leans it back, which is what a bench actually does.
        place(0, 0.71, 0.20, L, 0.42, 0.055, wood, 0.16);
      }
      if (b.arm) {
        place(-L / 2 + 0.03, 0.63, 0.02, 0.05, 0.05, 0.42, metal);
        place(L / 2 - 0.03, 0.63, 0.02, 0.05, 0.05, 0.42, metal);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    out.push(mesh);
  }

  if (bins.length) {
    // The Dublin street bin is the "Heritage" pattern made by Larkin: a black
    // cylinder with gold banding and a concave top, 1110mm tall and 450mm across.
    // Those are the manufacturer's figures, and both matter — an earlier guess
    // here had them dark green and 840mm, which is hip height on a bin that
    // should reach your chest.
    const BIN_H = 1.11, R = 0.225;

    // Black shell: plinth, body, the shoulder, and the top flaring back out —
    // that flare is what reads as the concave lid from a distance.
    const plinth = new THREE.CylinderGeometry(R + 0.015, R + 0.02, 0.06, 12);
    plinth.translate(0, 0.03, 0);
    const barrel = new THREE.CylinderGeometry(R + 0.01, R, 0.80, 12);
    barrel.translate(0, 0.46, 0);
    const shoulder = new THREE.CylinderGeometry(R - 0.03, R + 0.02, 0.10, 12);
    shoulder.translate(0, 0.91, 0);
    const lid = new THREE.CylinderGeometry(R, R - 0.03, 0.15, 12);
    lid.translate(0, 1.035, 0);

    // Gold: a wide band below the shoulder and a narrower one near the foot.
    const bandHi = new THREE.CylinderGeometry(R + 0.022, R + 0.022, 0.075, 12);
    bandHi.translate(0, 0.745, 0);
    const bandLo = new THREE.CylinderGeometry(R + 0.018, R + 0.018, 0.045, 12);
    bandLo.translate(0, 0.155, 0);

    const shell = new THREE.InstancedMesh(
      mergeGeo([plinth, barrel, shoulder, lid]), M.furniture, bins.length);
    const band = new THREE.InstancedMesh(mergeGeo([bandHi, bandLo]), M.furniture, bins.length);
    shell.castShadow = band.castShadow = true;
    shell.receiveShadow = true;

    const m = new THREE.Matrix4();
    const up = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const col = new THREE.Color();

    bins.forEach((f, i) => {
      // What goes in it is the only tag that changes the look. A dog-waste bin
      // is a small green one, and recycling is colour-coded; both are single
      // instances here but would be wrong drawn as a heritage litter bin.
      // `material` is deliberately ignored — the heritage bin IS metal, so
      // metal/steel says nothing that black-and-gold doesn't already say.
      const waste = (f.waste || '').toLowerCase();
      let bodyCol = 0x1b1b1d;                       // black gloss
      let bandCol = 0xa8842f;                       // gold
      let s = 1.0;
      if (waste === 'dog_excrement') { bodyCol = 0x3f7a34; bandCol = 0x2a4a24; s = 0.78; }
      else if (waste === 'recycling') { bodyCol = 0x2b4f72; bandCol = 0xa8842f; }
      const named = NAMED[(f.col || '').trim().toLowerCase()];
      if (named !== undefined) bodyCol = named;     // the band stays gold

      pos.set(f.x, f.y || 0, f.z);
      scl.set(s, s, s);
      m.compose(pos, up, scl);
      shell.setMatrixAt(i, m); band.setMatrixAt(i, m);

      // barely any variation: these are painted to a spec, not weathered timber
      const g = 0.96 + hash01(i, 11) * 0.08;
      shell.setColorAt(i, col.setHex(bodyCol).multiplyScalar(g));
      band.setColorAt(i, col.setHex(bandCol).multiplyScalar(g));
    });
    for (const mesh of [shell, band]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    out.push(shell, band);
  }

  if (racks.length) {
    // A Sheffield stand is an arch: two straight legs and a half-round top. The
    // arch plane faces along the row, because bikes park in the gaps BETWEEN
    // hoops, side-on to the footpath — so the hoops are spaced along the path
    // and each one stands across it.
    const R = HOOP_W / 2, TUBE = 0.027, LEG = HOOP_H - R;
    const leg = new THREE.CylinderGeometry(TUBE, TUBE, LEG, 7);
    leg.translate(0, LEG / 2, 0);
    const legL = leg.clone(); legL.translate(-R, 0, 0);
    const legR = leg.clone(); legR.translate(R, 0, 0);
    const arch = new THREE.TorusGeometry(R, TUBE, 6, 10, Math.PI);
    arch.translate(0, LEG, 0);
    const hoopGeo = mergeGeo([legL, legR, arch]);

    let total = 0;
    for (const f of racks) total += hoopCount(f);
    const mesh = new THREE.InstancedMesh(hoopGeo, M.furniture, total);
    mesh.castShadow = true;

    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const col = new THREE.Color();
    let i = 0;
    racks.forEach((f, ri) => {
      const face = f.face ?? 0;
      // theta = -face puts local +X along `face` (the arch spans across the
      // path) and local +Z along face+90 (the row runs along it)
      const theta = -face;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), theta);
      const co = Math.cos(theta), si = Math.sin(theta);
      const n = hoopCount(f);
      // galvanised on the street, black where somebody has painted them
      const tint = f.covered ? 0x3c4247 : 0x9aa1a6;
      for (let k = 0; k < n; k++) {
        const lz = (k - (n - 1) / 2) * HOOP_GAP;
        pos.set(f.x + lz * si, f.y || 0, f.z + lz * co);
        m.compose(pos, q, one);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, col.setHex(tint).multiplyScalar(0.94 + hash01(ri * 31 + k, 13) * 0.12));
        i++;
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    out.push(mesh);
  }

  if (boxes_.length) {
    // An Post pillar box. Green since 1922, and that part is certain; the
    // proportions are the usual Type B figures (about 1.35m to the cap, 0.6m
    // across) rather than a spec I could find published, so treat the size as
    // close rather than exact.
    const barrel = new THREE.CylinderGeometry(BOX_R, BOX_R, BOX_H - 0.18, 12);
    barrel.translate(0, (BOX_H - 0.18) / 2, 0);
    const collar = new THREE.CylinderGeometry(BOX_R + 0.025, BOX_R + 0.025, 0.05, 12);
    collar.translate(0, BOX_H - 0.18, 0);
    // the cap is a squashed dome, not a cone — flatten a sphere rather than
    // taper a cylinder, or it reads as a pencil
    const cap = new THREE.SphereGeometry(BOX_R + 0.02, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.55, 1);
    cap.translate(0, BOX_H - 0.155, 0);
    const bodyGeo = mergeGeo([barrel, collar, cap]);

    // the aperture: a dark slot on the side that faces the street
    const slotGeo = new THREE.BoxGeometry(0.32, 0.055, 0.06);
    slotGeo.translate(0, 1.0, BOX_R - 0.01);

    const body = new THREE.InstancedMesh(bodyGeo, M.furniture, boxes_.length);
    const slot = new THREE.InstancedMesh(slotGeo, M.furniture, boxes_.length);
    body.castShadow = slot.castShadow = true;
    body.receiveShadow = true;

    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const col = new THREE.Color();
    boxes_.forEach((f, i) => {
      // the slot sits at local +Z, so local +Z must point at the street: with
      // theta = -(face - PI/2), local +Z lands on `face`
      const theta = -(f.face ?? 0) + Math.PI / 2;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), theta);
      pos.set(f.x, f.y || 0, f.z);
      m.compose(pos, q, one);
      body.setMatrixAt(i, m); slot.setMatrixAt(i, m);
      const named = NAMED[(f.col || '').trim().toLowerCase()];
      const green = named !== undefined ? named : 0x1c5c34;   // An Post green
      body.setColorAt(i, col.setHex(green).multiplyScalar(0.95 + hash01(i, 17) * 0.1));
      slot.setColorAt(i, col.setHex(0x14181a));
    });
    for (const mesh of [body, slot]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    out.push(body, slot);
  }

  if (fittings.length) {
    // One posts mesh and one heads mesh for all six kinds. Both are unit shapes
    // scaled per instance, so a 3m clock pole and a 0.55m charger stem come off
    // the same geometry.
    const specs = fittings.map(fittingSpec);
    const nPosts = specs.filter((s) => s && s.post).length;
    let nHeads = 0;
    for (let i = 0; i < specs.length; i++) {
      const sp = specs[i];
      if (!sp) continue;
      if (sp.kiosk) { nHeads += KIOSK.length; continue; }
      if (sp.bank) { nHeads += bankParts(bankStreams(fittings[i])).length; continue; }
      nHeads += 1;
      if (sp.stop) nHeads += busStopExtras(!!fittings[i].shelter).length;
    }

    const postGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
    postGeo.translate(0, 0.5, 0);                       // stands on the ground
    const posts = nPosts
      ? new THREE.InstancedMesh(postGeo, M.furniture, nPosts) : null;
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), M.furniture, nHeads);
    if (posts) posts.castShadow = true;
    heads.castShadow = heads.receiveShadow = true;

    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const col = new THREE.Color();
    let pi = 0, hi = 0;

    fittings.forEach((f, i) => {
      const spec = specs[i];
      if (!spec) return;
      // local +Z has to land on `face` so the screen, dial or slot looks at the
      // street; rotation about Y sends local +Z to PI/2 - theta
      const theta = Math.PI / 2 - (f.face ?? 0);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), theta);

      let bodyCol = spec.body;
      if (f.kind === 'recycling') bodyCol = RECYCLING_COLOUR[f.rec] ?? spec.body;

      if (spec.post) {
        const [r, h] = spec.post;
        pos.set(f.x, f.y || 0, f.z);
        scl.set(r * 2, h, r * 2);
        m.compose(pos, q, scl);
        posts.setMatrixAt(pi, m);
        posts.setColorAt(pi, col.setHex(spec.body).multiplyScalar(0.94 + hash01(i, 19) * 0.1));
        pi++;
      }

      const y0 = f.y || 0;
      if (spec.bank) {
        const co3 = Math.cos(theta), si3 = Math.sin(theta);
        for (const [lx, ly, lz, w, h, d, c] of bankParts(bankStreams(f))) {
          pos.set(f.x + lx * co3 + lz * si3, y0 + ly, f.z - lx * si3 + lz * co3);
          scl.set(w, h, d);
          m.compose(pos, q, scl);
          heads.setMatrixAt(hi, m);
          heads.setColorAt(hi, col.setHex(c).multiplyScalar(0.95 + hash01(i, 29) * 0.09));
          hi++;
        }
        return;
      }
      if (spec.stop) {
        const co2 = Math.cos(theta), si2 = Math.sin(theta);
        for (const [lx, ly, lz, w, h, d, c] of busStopExtras(!!f.shelter)) {
          pos.set(f.x + lx * co2 + lz * si2, y0 + ly, f.z - lx * si2 + lz * co2);
          scl.set(w, h, d);
          m.compose(pos, q, scl);
          heads.setMatrixAt(hi, m);
          heads.setColorAt(hi, col.setHex(c));
          hi++;
        }
      }
      if (spec.kiosk) {
        const co = Math.cos(theta), si = Math.sin(theta);
        for (const [lx, ly, lz, w, h, d, c] of KIOSK) {
          pos.set(f.x + lx * co + lz * si, y0 + ly, f.z - lx * si + lz * co);
          scl.set(w, h, d);
          m.compose(pos, q, scl);
          heads.setMatrixAt(hi, m);
          heads.setColorAt(hi, col.setHex(c).multiplyScalar(0.96 + hash01(i, 23) * 0.07));
          hi++;
        }
        return;
      }
      const [w, h, d] = spec.head;
      const base = spec.post ? spec.post[1] : 0;
      pos.set(f.x, y0 + base + h / 2, f.z);
      scl.set(w, h, d);
      m.compose(pos, q, scl);
      heads.setMatrixAt(hi, m);
      // a box carries one colour, so a fitting that is basically all face — a
      // clock dial, a bus stop flag — takes the face colour, the rest the body
      heads.setColorAt(hi, col.setHex(spec.sign ? spec.face : bodyCol)
        .multiplyScalar(0.94 + hash01(i, 23) * 0.1));
      hi++;
    });

    if (posts) {
      posts.instanceMatrix.needsUpdate = true;
      if (posts.instanceColor) posts.instanceColor.needsUpdate = true;
      out.push(posts);
    }
    heads.instanceMatrix.needsUpdate = true;
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
    out.push(heads);
  }

  return out;
}
