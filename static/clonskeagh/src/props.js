// Trees, parked cars, wheelie bins — instanced, so hundreds cost almost nothing.
import * as THREE from '../vendor/three.module.js';
import { carBodyGeometry, wheelGeometry } from './vehicle.js';

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
  for (const t of trees) colliders.push({ x: t.x, z: t.z, hx: 0.34, hz: 0.34, yaw: 0 });
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
    colliders.push({ x: cx, z: cz, hx: len / 2, hz: w / 2, yaw });
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
    mesh.setColorAt(i, col.setHSL(0.27 + (hash01(i, 7) - 0.5) * 0.04,
                                  0.42, 0.20 + hash01(i, 8) * 0.07));
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
    colliders.push({ x, z, hx: 2.2, hz: 0.95, yaw: Math.PI / 2 - yaw });
  });
  scene.add(cars, wheels);
  // handed back so one of these can be taken over and driven away
  return { cars, wheels, slots };
}
