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
// 158 benches and 136 waste baskets, all of which OSM has been carrying and the
// game has never drawn. The tags are unusually good for street furniture — four
// benches in five say whether they have a backrest, a third name their material
// — so these vary rather than being one model stamped 294 times.
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

export function furnitureColliders(items, colliders) {
  // `soft` for the same reason trees are: being unable to walk through a bench
  // is right, having the camera shoved off it is not.
  for (const f of items) {
    if (f.kind === 'bench') {
      colliders.push({ x: f.x, z: f.z, hx: benchLength(f) / 2 + 0.05, hz: 0.34,
                       yaw: (f.face ?? 0) + Math.PI / 2, soft: true, h: 0.88 });
    } else {
      colliders.push({ x: f.x, z: f.z, hx: 0.25, hz: 0.25, yaw: 0, soft: true, h: 1.11 });
    }
  }
}

/**
 * One chunk's benches and baskets.
 *
 * Local space for a bench is +X along the seat and +Z behind the sitter's back.
 * Three's rotation about Y sends local +X to world angle -theta, so putting the
 * seat across the direction of view means theta = -(face + PI/2).
 */
export function makeFurniture(items, M) {
  if (!items || !items.length) return [];

  const benches = items.filter((f) => f.kind === 'bench');
  const bins = items.filter((f) => f.kind !== 'bench');
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
        pos.set(b.x + lx * co + lz * si, ly, b.z - lx * si + lz * co);
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
        // leaned back a little; the tilt is about local X, which is the seat line
        place(0, 0.71, 0.20, L, 0.42, 0.055, wood, -0.16);
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

      pos.set(f.x, 0, f.z);
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

  return out;
}
