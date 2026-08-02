// Turns the baked OSM world into geometry.
//
// The thing the old 2D attempt never nailed: every house's ROOF RIDGE runs along
// its own long axis, and its FRONT WALL is the one facing the nearest street.
// Both come out of the min-area rectangle baked into world.json, so doors land on
// the street side and no two houses fight each other.
import * as THREE from '../vendor/three.module.js';
import { MeshBuilder, ribbon, ribbonSlab, offsetLine } from './meshbuilder.js';
import { DOOR_COLOURS, RENDER_TINTS } from './materials.js';
import { makeTrees, makeHedges, treeColliders, hedgeColliders } from './props.js';

const EAVE = 0.38;          // roof overhang
const BRICK_UV = 1.7;       // metres per brick texture tile
const CHUNK = 220;          // metres per geometry chunk
const STREAM_IN = 620;      // build cells whose centre is within this of you
const STREAM_OUT = 820;     // ...and drop them again beyond this

// deterministic per-building randomness
function hash01(id, salt = 0) {
  let h = (id ^ (salt * 2654435761)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToPoly(poly, x, z) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    const dx = x2 - x1, dz = z2 - z1;
    const L2 = dx * dx + dz * dz;
    const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L2));
    best = Math.min(best, Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t)));
  }
  return best;
}

/**
 * How far the corners of a pitched roof would hang out past the walls.
 *
 * The roof is generated over the building's bounding rectangle, which only
 * matches the building when the building is a rectangle. Rather than guess
 * from an area ratio, measure the thing that actually shows: a corner of the
 * roof sitting over open ground with no wall under it.
 */
function roofOverhang(poly, cx, cz, ux, uz, vx, vz, halfL, halfD, margin = EAVE) {
  let worst = 0;
  for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const du = (halfL + margin) * su, dv = (halfD + margin) * sv;
    const x = cx + ux * du + vx * dv, z = cz + uz * du + vz * dv;
    if (pointInPoly(poly, x, z)) continue;
    const d = distToPoly(poly, x, z);
    if (d > worst) worst = d;
  }
  return worst;
}


/**
 * The wall of a building that faces its street: midpoint, outward normal,
 * tangent and length. Used both when drawing the elevation and when laying out
 * the front boundary, which have to agree.
 */
function frontFace(poly, facing, cx, cz, ux, uz, halfL, halfD) {
  const wantX = Math.cos(facing), wantZ = Math.sin(facing);
  let face = null;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    const ex = x2 - x1, ez = z2 - z1;
    const len = Math.hypot(ex, ez);
    if (len < 2.4) continue;                  // too narrow to be a frontage
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    let ox = ez / len, oz = -ex / len;
    if ((mx - cx) * ox + (mz - cz) * oz < 0) { ox = -ox; oz = -oz; }   // outward
    // prefer the wall pointing most at the street, and among those the wider
    // one — a 3m return shouldn't beat the real elevation
    const score = (ox * wantX + oz * wantZ) * Math.min(len, 12);
    if (!face || score > face.score) {
      face = { score, x: mx, z: mz, nx: ox, nz: oz, tx: ex / len, tz: ez / len, w: len };
    }
  }
  if (!face) {                                // nothing wide enough: fall back
    const alongRidge = Math.abs(wantX * ux + wantZ * uz) > 0.7;
    const ext = alongRidge ? halfL : halfD;
    face = { x: cx + wantX * ext, z: cz + wantZ * ext, nx: wantX, nz: wantZ,
             tx: -wantZ, tz: wantX, w: (alongRidge ? halfD : halfL) * 2 };
  }
  return face;
}

/** Do two wall runs cross? Only the 2D segments matter; they're all at ground
 *  level and the same thickness. */
function segmentsCross(a, b) {
  const ax1 = a.mx - a.wx * a.half, az1 = a.mz - a.wz * a.half;
  const ax2 = a.mx + a.wx * a.half, az2 = a.mz + a.wz * a.half;
  const bx1 = b.mx - b.wx * b.half, bz1 = b.mz - b.wz * b.half;
  const bx2 = b.mx + b.wx * b.half, bz2 = b.mz + b.wz * b.half;
  const o = (px, pz, qx, qz, rx, rz) => {
    const v = (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
    return Math.abs(v) < 1e-9 ? 0 : (v > 0 ? 1 : -1);
  };
  const o1 = o(ax1, az1, ax2, az2, bx1, bz1);
  const o2 = o(ax1, az1, ax2, az2, bx2, bz2);
  const o3 = o(bx1, bz1, bx2, bz2, ax1, az1);
  const o4 = o(bx1, bz1, bx2, bz2, ax2, az2);
  if (o1 !== o2 && o3 !== o4) return true;
  // near-parallel runs sitting on top of each other count as crossing too
  const near = (px, pz) => {
    const vx = bx2 - bx1, vz = bz2 - bz1;
    const L2 = vx * vx + vz * vz;
    const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - bx1) * vx + (pz - bz1) * vz) / L2));
    return Math.hypot(px - (bx1 + vx * t), pz - (bz1 + vz * t)) < 0.55;
  };
  return near(ax1, az1) || near(ax2, az2) || near(a.mx, a.mz);
}

/** Extent of a footprint along a given axis: returns [min,max] of the projection. */
function projectExtent(poly, ax, az) {
  let lo = Infinity, hi = -Infinity;
  for (const [x, z] of poly) {
    const d = x * ax + z * az;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

export function buildWorld(world, M, scene, landmarks = { landmarks: [] },
                           veg = { trees: [], hedges: [] },
                           golf = { courses: [] },
                           frontage = { hedges: [] }) {
  // buildings carrying detected domes are flat-roofed underneath them
  const domed = new Map();
  for (const L of landmarks.landmarks || []) {
    if (L.domes && L.domes.length) domed.set(L.id, L);
  }

  // ------------------------------------------------------------ streaming ---
  // The world is 2 km across and could grow further, so it is neither built nor
  // held in memory all at once. Features are bucketed into CHUNK-metre cells at
  // load — cheap, it's just arithmetic — and a cell's geometry is generated only
  // when you come near it, then thrown away again when you leave. That makes
  // load time and memory depend on your draw distance rather than on the size of
  // the map.
  //
  // Colliders and HUD labels ARE computed for everything up front: they're a few
  // numbers per building, and they must exist before the geometry does.
  const KEYS = ['redbrick', 'pebbledash', 'render', 'stone', 'brickBuff',
                'limestone', 'granite', 'roof',
                'glass', 'trim', 'door', 'road', 'pavement', 'grass', 'hedge',
                'wall', 'dark', 'water', 'sand', 'putting'];
  const makeBuilders = () => {
    const mb = {};
    for (const k of KEYS) mb[k] = new MeshBuilder();
    return mb;
  };

  const cells = new Map();
  const keyOf = (x, z) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
  const cellAt = (x, z) => {
    const key = keyOf(x, z);
    let c = cells.get(key);
    if (!c) {
      c = { key, cx: (Math.floor(x / CHUNK) + 0.5) * CHUNK,
            cz: (Math.floor(z / CHUNK) + 0.5) * CHUNK,
            areas: [], water: [], roads: [], paths: [], buildings: [],
            barriers: [], lamps: [], trees: [], hedges: [], golf: [],
            junctions: [], group: null };
      cells.set(key, c);
    }
    return c;
  };

  const colliders = [];      // {x,z,hx,hz,yaw} oriented boxes
  const labels = [];         // named places for the HUD

  // ------------------------------------------------- landuse / greens ------
  const AREA_STYLE = {
    grass: [M.grass, 0xa8d18a, 0.03], park: [M.grass, 0x9fca80, 0.03],
    pitch: [M.grass, 0x86bf72, 0.04], play: [M.pavement, 0xb99a7a, 0.04],
    wood: [M.grass, 0x6f9c5c, 0.03], religious: [M.pavement, 0xbfb9a8, 0.04],
    grounds: [M.grass, 0x9dc584, 0.02],
    construction: [M.pavement, 0xa79880, 0.04], parking: [M.road, 0x9a9a9a, 0.05],
    parking_space: [M.road, 0xa5a5a5, 0.06],
    // Water sits above every other ground layer. A lake is nearly always inside
    // a park or a set of grounds, and at 0.02 the grass covering it was drawn a
    // centimetre higher — UCD's Upper Lake was a field.
    water: [M.water, 0xffffff, 0.075],
  };

  // Nearest road point per building — it decides where the garden path runs and
  // where the front wall goes.
  //
  // There are 23,129 road segments and 21,500 buildings, so asking each building
  // to scan the lot is half a billion distance tests, and it was the single
  // biggest thing in the loading screen. Indexed by location it looks at a
  // handful instead. Chunk building uses the same index, so streaming gets
  // cheaper too.
  const segs = [];
  for (const r of world.roads) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      segs.push([r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1], r.w]);
    }
  }

  const SEG_G = 60;
  const segGrid = new Map();
  for (const sg of segs) {
    const [ax, az, bx, bz] = sg;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / SEG_G));
    const seen = new Set();
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const key = `${Math.floor((ax + (bx - ax) * t) / SEG_G)},${Math.floor((az + (bz - az) * t) / SEG_G)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = segGrid.get(key);
      if (a) a.push(sg); else segGrid.set(key, [sg]);
    }
  }

  /** [distance, x, z, roadWidth] of the closest carriageway, or null. */
  function nearestRoad(px, pz) {
    const gx = Math.floor(px / SEG_G), gz = Math.floor(pz / SEG_G);
    let best = null;
    for (let ring = 0; ring < 8; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (ring && Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          for (const [ax, az, bx, bz, rw] of segGrid.get(`${gx + dx},${gz + dz}`) || []) {
            const vx = bx - ax, vz = bz - az;
            const L2 = vx * vx + vz * vz;
            const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / L2));
            const qx = ax + t * vx, qz = az + t * vz;
            const d = Math.hypot(px - qx, pz - qz);
            if (!best || d < best[0]) best = [d, qx, qz, rw];
          }
        }
      }
      // once the nearest hit is closer than the next ring can possibly be, stop
      if (best && ring * SEG_G > best[0] + SEG_G) break;
    }
    return best;
  }


  // ------------------------------------------------------- carriageways ----
  // Pavements are generated per road, so at a junction one street's footpath is
  // drawn straight across the next street's tarmac. Nothing knows about anything
  // else. So: index every carriageway, and clip pavements and footways out of
  // any road surface they'd otherwise run over.
  const RG = 60;                       // metres per index cell
  const roadGrid = new Map();
  const rgKey = (x, z) => `${Math.floor(x / RG)},${Math.floor(z / RG)}`;
  for (const r of world.roads) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const seg = [ax, az, bx, bz, r.w / 2, r.id];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / RG));
      const seen = new Set();
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const key = rgKey(ax + (bx - ax) * t, az + (bz - az) * t);
        if (seen.has(key)) continue;
        seen.add(key);
        if (!roadGrid.has(key)) roadGrid.set(key, []);
        roadGrid.get(key).push(seg);
      }
    }
  }

  /** Is this point on a road surface belonging to some OTHER road? */
  function onOtherRoad(x, z, exceptId) {
    const gx = Math.floor(x / RG), gz = Math.floor(z / RG);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = roadGrid.get(`${gx + dx},${gz + dz}`);
        if (!list) continue;
        for (const [ax, az, bx, bz, half, id] of list) {
          if (id === exceptId) continue;
          const vx = bx - ax, vz = bz - az;
          const L = vx * vx + vz * vz;
          const t = L < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L));
          if (Math.hypot(x - (ax + t * vx), z - (az + t * vz)) < half) return true;
        }
      }
    }
    return false;
  }

  /**
   * Walk a line at a fine step and break it wherever it crosses somebody else's
   * carriageway, returning the runs that survive. The pavement then stops at the
   * kerb of the crossing street instead of painting over it.
   */
  function clipToKerb(pts, exceptId, step = 0.45) {
    const runs = [];
    let run = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if (onOtherRoad(x, z, exceptId)) {
          if (run.length > 1) runs.push(run);
          run = [];
        } else {
          run.push([x, z]);
        }
      }
    }
    const last = pts[pts.length - 1];
    if (!onOtherRoad(last[0], last[1], exceptId)) run.push(last);
    if (run.length > 1) runs.push(run);
    // No simplification here. The obvious version — drop a point if it sits
    // close to the line between the one before and the one after — is wrong on
    // a curve: every point on a gentle bend passes that test, so they all get
    // dropped and the error accumulates with nothing to bound it. It quietly
    // straightened the footpaths and pulled them off the kerb. Doing it
    // properly means measuring against the chord of the whole simplified span,
    // and the extra triangles are not worth that risk.
    return runs;
  }

  // ------------------------------------------------ one feature at a time ---
  function emitArea(mb, a) {
    const st = AREA_STYLE[a.kind];
    if (!st) return;
    const [mat, tint, y] = st;
    const key = mat === M.grass ? 'grass' : mat === M.road ? 'road'
      : mat === M.water ? 'water' : 'pavement';
    mb[key].polyFlat(a.poly, y, key === 'grass' ? 6 : 4, tint);
  }

  function emitWater(mb, w) { ribbon(mb.water, w.pts, w.w, 0.05, 4, 0xffffff); }

  function emitJunction(mb, j) {
    // sits a hair above the ribbons so the seams don't show through
    const r = j.w / 2 + 0.15;
    const pts = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      pts.push([j.x + Math.cos(a) * r, j.z + Math.sin(a) * r]);
    }
    mb.road.polyFlat(pts, 0.065, 6, 0xffffff);
  }

  function emitRoad(mb, r) {
    ribbon(mb.road, r.pts, r.w, 0.06, 6, 0xffffff);
    // pavements both sides of anything that isn't a back lane
    if (r.kind !== 'service') {
      const off = r.w / 2 + 0.95;
      for (const s of [1, -1]) {
        for (const run of clipToKerb(offsetLine(r.pts, off * s), r.id)) {
          ribbonSlab(mb.pavement, run, 1.9, 0.14, 0.14, 3, 0xffffff, 0xbdb8ad);
        }
      }
    }
    // centre line on the through-roads
    if (r.kind === 'secondary' || r.kind === 'tertiary') {
      dashedLine(mb.dark, r.pts, 0.16, 0.075, 2.4, 2.6, 0xd8d2b8);
    }
  }

  function emitPath(mb, p) {
    // footways get the same treatment — a path drawn over tarmac reads as a fault
    for (const run of clipToKerb(p.pts, -1)) {
      ribbon(mb.pavement, run, Math.max(1.3, p.w), 0.09, 3, 0xe8e4d8);
    }
  }

  function emitGolf(mb, gf) {
    // 4cm of clearance keeps them off the landuse polygon they sit on; a green
    // sits a touch higher again so its collar reads against the fairway.
    const y = gf.kind === 'sand' ? 0.04 : 0.05;
    const uv = gf.kind === 'sand' ? 0.6 : 1.4;   // metres per texture tile
    mb[gf.kind].polyFlat(gf.poly, y, uv, 0xffffff);
  }

  /**
   * `building=roof` is a roof and nothing else: the covered walkways across UCD,
   * bus shelters, a filling station forecourt. The bake gives them the default
   * six metres and two storeys like any other building, so they came out as long
   * blank brick walls — the UCD walkway in particular reads as a 71m barrier
   * across the campus. Here they get a deck on columns with nothing in between,
   * and you can walk or drive underneath.
   */
  function emitCanopy(mb, b) {
    const poly = b.poly;
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], c = poly[(i + 1) % poly.length];
      area += a[0] * c[1] - c[0] * a[1];
    }
    area = Math.abs(area) / 2;
    // the recorded height is the bake's default, not a survey: a forecourt has
    // to clear a lorry, a walkway only has to clear people
    const H = area > 400 ? 4.5 : 3.1 + hash01(b.id, 31) * 0.5;
    const deck = 0.26;

    mb.roof.polyFlat(poly, H + deck, 3, 0xdadada);
    mb.dark.polyFlat(poly, H, 3, 0x6a6d70, false);          // soffit, seen from below
    extrudeWalls(mb.dark, poly, H, H + deck, 0x54585c);     // fascia band

    for (let i = 0; i < poly.length; i++) {
      const [x1, z1] = poly[i];
      const [x2, z2] = poly[(i + 1) % poly.length];
      const ex = x2 - x1, ez = z2 - z1;
      const len = Math.hypot(ex, ez);
      if (len < 1.2) continue;
      const ux2 = ex / len, uz2 = ez / len;
      const inx = -(ez / len), inz = ex / len;              // inward, walls wind CCW
      const n = Math.max(1, Math.round(len / 5.5));
      for (let k = 0; k <= n; k++) {
        if (k === n && i !== poly.length - 1) continue;     // corners shared
        const t = (len * k) / n;
        const px2 = x1 + ux2 * t + inx * 0.34;
        const pz2 = z1 + uz2 * t + inz * 0.34;
        mb.dark.box(px2, 0, pz2, 0.1, H, 0.1, 0, 1, 0x4a4d50);
      }
    }
  }


  /**
   * Shops, banks and offices — 319 of them — fell through to the house
   * treatment: one front door and a bay window, which on a 24-metre bank
   * frontage leaves a blank wall the size of a tennis court. This gives them
   * what a commercial elevation actually has: a glazed shopfront the width of
   * the building, a signage fascia over it, and a regular grid of windows above.
   *
   * The footprint, height, storey count, flat roof and which wall faces the
   * street are all from the data. The arrangement of glazing on that wall is
   * not — it is a plausible commercial front, not a portrait of any one shop.
   */
  function commercialWalls(mb, poly, b, wallKey, tint) {
    const SHOP = Math.min(3.4, b.h * 0.52);        // top of the shopfront
    const FASCIA = 0.85;                           // the sign band above it
    const glassCol = 0xffffff;

    for (let i = 0; i < poly.length; i++) {
      const [x1, z1] = poly[i];
      const [x2, z2] = poly[(i + 1) % poly.length];
      const ex = x2 - x1, ez = z2 - z1;
      const len = Math.hypot(ex, ez);
      if (len < 3.0) continue;
      const tx = ex / len, tz = ez / len;
      const nx = ez / len, nz = -ex / len;         // outward
      const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
      const yaw = Math.atan2(nx, -nz);
      const face = (off, y, w, h, key, colour, proud) => {
        const ax = mx + tx * (off - w / 2) + nx * proud, az = mz + tz * (off - w / 2) + nz * proud;
        const bx = mx + tx * (off + w / 2) + nx * proud, bz = mz + tz * (off + w / 2) + nz * proud;
        mb[key].quad([bx, y, bz], [ax, y, az], [ax, y + h, az], [bx, y + h, bz],
                     [[0, 0], [1, 0], [1, 1], [0, 1]], colour);
      };

      // ground floor: one run of glazing, held off the ends by a pier
      const pier = 0.7;
      const glazed = len - pier * 2;
      if (glazed > 1.5) {
        face(0, 0.45, glazed, SHOP - 0.7, 'glass', glassCol, 0.06);
        face(0, 0.0, glazed, 0.45, 'dark', 0x3d4045, 0.07);            // stall riser
        // mullions every 2m or so
        const bays = Math.max(1, Math.round(glazed / 2.1));
        for (let k = 1; k < bays; k++) {
          face(-glazed / 2 + (glazed * k) / bays, 0.45, 0.1, SHOP - 0.7, 'trim', 0xe8e6e0, 0.1);
        }
        // fascia band, where the sign goes
        face(0, SHOP, len - 0.2, FASCIA, 'dark', 0x2f3338, 0.09);
        face(0, SHOP + FASCIA - 0.06, len - 0.2, 0.06, 'trim', 0xd9d5cc, 0.11);
      }

      // upper floors: a regular grid, as offices over a shop
      const floors = Math.max(1, Math.round((b.h - SHOP - FASCIA) / 3.0));
      const cols = Math.max(1, Math.floor(len / 3.0));
      for (let f = 0; f < floors; f++) {
        const y = SHOP + FASCIA + 0.75 + f * 3.0;
        if (y + 1.5 > b.h) break;
        for (let k = 0; k < cols; k++) {
          const off = -len / 2 + (len * (k + 0.5)) / cols;
          face(off, y, 1.35, 1.5, 'trim', 0xf0ede6, 0.05);
          face(off, y + 0.08, 1.2, 1.34, 'glass', glassCol, 0.07);
        }
      }
    }

    // a parapet, since these are flat-roofed
    extrudeWalls(mb[wallKey], poly, b.h, b.h + 0.55, tint);
    mb.granite.polyFlat(poly, b.h + 0.58, 3, 0xffffff);
  }


  /**
   * A residential block — apartments, student halls, anything several storeys
   * over a large footprint.
   *
   * 404 of these were taking the house treatment: one front door and a bay
   * window, which on UCD Village's 84x78m seven-storey slab is a blank wall the
   * size of a football pitch. They need what a block actually has — the same
   * window, repeated on a grid, on every elevation — plus a way in at the
   * bottom and something to finish the top.
   *
   * The storey height, the footprint and which wall faces the street are from
   * the data. The bay spacing is not; it is a regular rhythm at a believable
   * pitch rather than a survey of any particular building.
   */
  function blockWalls(mb, poly, b, wallKey, tint) {
    const FLOOR = 3.0;                            // storey to storey
    const floors = Math.max(1, Math.min(14, Math.round(b.h / FLOOR)));
    const glassCol = 0xffffff;

    for (let i = 0; i < poly.length; i++) {
      const [x1, z1] = poly[i];
      const [x2, z2] = poly[(i + 1) % poly.length];
      const ex = x2 - x1, ez = z2 - z1;
      const len = Math.hypot(ex, ez);
      if (len < 2.6) continue;
      const tx = ex / len, tz = ez / len;
      const nx = ez / len, nz = -ex / len;        // outward
      const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
      const yaw = Math.atan2(nx, -nz);
      const face = (off, y, w, h, key, colour, proud) => {
        const ax = mx + tx * (off - w / 2) + nx * proud, az = mz + tz * (off - w / 2) + nz * proud;
        const bx = mx + tx * (off + w / 2) + nx * proud, bz = mz + tz * (off + w / 2) + nz * proud;
        mb[key].quad([bx, y, bz], [ax, y, az], [ax, y + h, az], [bx, y + h, bz],
                     [[0, 0], [1, 0], [1, 1], [0, 1]], colour);
      };

      const bays = Math.max(1, Math.round(len / 3.6));
      const pitch = len / bays;
      for (let f = 0; f < floors; f++) {
        const sill = f * FLOOR + 1.0;
        if (sill + 1.5 > b.h) break;
        // a band between storeys, which is what stops it reading as one slab
        if (f > 0) face(0, f * FLOOR - 0.16, len - 0.1, 0.3, 'trim', 0xdedad0, 0.04);
        for (let k = 0; k < bays; k++) {
          const off = -len / 2 + pitch * (k + 0.5);
          const w = Math.min(1.6, pitch - 1.1);
          if (w < 0.7) continue;
          face(off, sill - 0.1, w + 0.24, 1.7, 'trim', 0xf0ede6, 0.05);
          face(off, sill, w, 1.5, 'glass', glassCol, 0.07);
          face(off, sill + 0.72, w, 0.06, 'trim', 0xf0ede6, 0.09);   // transom
        }
      }

      // a way in, on the longer elevations only
      if (len > 9) {
        const doorCol = DOOR_COLOURS[Math.floor(hash01(b.id, 5) * DOOR_COLOURS.length)];
        face(0, 0.0, 2.3, 2.5, 'dark', 0x2f3338, 0.06);
        face(0, 0.0, 1.9, 2.25, 'glass', glassCol, 0.08);
        face(0, 2.5, 2.8, 0.22, 'trim', 0xe6e2d8, 0.12);              // canopy
        face(-1.55, 0.0, 0.22, 2.5, 'door', doorCol, 0.08);
      }
    }

    extrudeWalls(mb[wallKey], poly, b.h, b.h + 0.6, tint);            // parapet
    mb.granite.polyFlat(poly, b.h + 0.63, 3, 0xffffff);
  }

  // landmark classes that keep the arcaded, period elevation
  const PERIOD = new Set(['church', 'mosque', 'school']);

  function emitBuilding(mb, b) {
    if (b.type === 'roof') { emitCanopy(mb, b); return; }
    const poly = b.poly;
    const wallKey = M[b.mat] ? b.mat : 'redbrick';
    const isOut = b.type === 'shed' || b.type === 'garage' || b.type === 'garages';

    // per-building tint keeps a terrace from looking like one long extrusion
    let tint;
    if (wallKey === 'render') tint = RENDER_TINTS[Math.floor(hash01(b.id, 3) * RENDER_TINTS.length)];
    else {
      const v = 0.86 + hash01(b.id, 1) * 0.28;
      tint = new THREE.Color(v, v * 0.99, v * 0.97).getHex();
    }

    // a nave carrying domes has no pitched roof to build
    if (domed.has(b.id)) b = { ...b, roof: 'flat' };
    // ---- oriented box from the baked ridge angle
    const ux = Math.cos(b.ridge), uz = Math.sin(b.ridge);   // along ridge
    const vx = -uz, vz = ux;                                // across ridge
    const [ulo, uhi] = projectExtent(poly, ux, uz);
    const [vlo, vhi] = projectExtent(poly, vx, vz);
    const uc = (ulo + uhi) / 2, vc = (vlo + vhi) / 2;
    const halfL = (uhi - ulo) / 2, halfD = (vhi - vlo) / 2;
    const cx = ux * uc + vx * vc, cz = uz * uc + vz * vc;
    const P = (du, dv, y) => [cx + ux * du + vx * dv, y, cz + uz * du + vz * dv];

    // The pitched roof below is generated over that bounding box, which only
    // fits when the building is a box. On an L-shaped or angled footprint it
    // hangs out over the garden with no wall beneath it — a roof floating in
    // mid-air, in front of a collider you still can't walk through. Over a
    // quarter of the buildings here overhang by more than a metre and the
    // worst by nearly sixty, so anything that isn't roughly rectangular gets a
    // flat roof on its real outline instead.
    // Two different thresholds on the same measurement, because they are two
    // different kinds of decision. Collision accuracy has no downside, so any
    // real overhang gets walls you can actually touch. Roof shape is a look:
    // a metre of extra eaves reads as generous, so only the badly wrong ones
    // give up their pitch.
    const overhang = roofOverhang(poly, cx, cz, ux, uz, vx, vz, halfL, halfD);
    const flatRoof = b.roof === 'flat' || overhang > 3.0;

    const wallTop = flatRoof ? b.h + 0.35 : b.h;
    extrudeWalls(mb[wallKey], poly, 0, wallTop, tint);

    // ---- roof
    if (flatRoof) {
      mb.dark.polyFlat(poly, b.h + 0.36, 3, 0x4a4a4c);
    } else {
      const L = halfL + EAVE, D = halfD + EAVE, y0 = b.h, y1 = b.h + b.roofH;
      const rt = 0.9 + hash01(b.id, 7) * 0.2;
      const rc = new THREE.Color(rt * 0.95, rt * 0.97, rt).getHex();
      const ridgeShrink = b.roof === 'hip' ? Math.min(D, L * 0.75) : 0;
      const rA = P(-L + ridgeShrink, 0, y1), rB = P(L - ridgeShrink, 0, y1);
      const e00 = P(-L, -D, y0), e10 = P(L, -D, y0), e11 = P(L, D, y0), e01 = P(-L, D, y0);
      const slopeLen = Math.hypot(D, b.roofH);
      const uvS = (len, w) => [[0, 0], [len / 1.2, 0], [len / 1.2, w / 1.2], [0, w / 1.2]];
      // all wound so the normals face up and out of the roof
      mb.roof.quad(e10, e00, rA, rB, uvS(L * 2, slopeLen), rc);
      mb.roof.quad(e01, e11, rB, rA, uvS(L * 2, slopeLen), rc);
      if (b.roof === 'hip') {
        mb.roof.tri(e11, e10, rB, [[0, 0], [D * 1.6, 0], [D * 0.8, slopeLen]], rc);
        mb.roof.tri(e00, e01, rA, [[0, 0], [D * 1.6, 0], [D * 0.8, slopeLen]], rc);
      } else {
        // gable ends are masonry, not tile
        const g0 = P(-halfL, -halfD, y0), g1 = P(-halfL, halfD, y0), gt = P(-halfL, 0, y1);
        const h0 = P(halfL, halfD, y0), h1 = P(halfL, -halfD, y0), ht = P(halfL, 0, y1);
        const guv = [[0, 0], [halfD * 2 / BRICK_UV, 0], [halfD / BRICK_UV, b.roofH / BRICK_UV]];
        mb[wallKey].tri(g0, g1, gt, guv, tint);
        mb[wallKey].tri(h0, h1, ht, guv, tint);
      }
      if (b.lm === 'hospital') {
        // paired rendered stacks on chamfered bases, and the miniature gablets
        // that embellish the roofline (NIAH)
        for (const side of [-1, 1]) {
          const sx = cx + ux * (halfL * 0.55) * side, sz = cz + uz * (halfL * 0.55) * side;
          for (const o of [-0.5, 0.5]) {
            mb.render.box(sx + vx * o, b.h - 0.3, sz + vz * o, 0.34, b.roofH + 1.6, 0.34,
              b.ridge, 1.5, 0xd8d2c6, false);
            mb.dark.box(sx + vx * o, b.h + b.roofH + 1.25, sz + vz * o, 0.2, 0.34, 0.2,
              b.ridge, 1, 0x8a4a30);            // terracotta pot
          }
        }
        const gab = Math.max(2, Math.round(halfL / 4));
        for (let g = -gab; g <= gab; g += 2) {
          const gx2 = cx + ux * (g * halfL / (gab + 1)), gz2 = cz + uz * (g * halfL / (gab + 1));
          for (const s2 of [-1, 1]) {
            const px2 = gx2 + vx * halfD * s2, pz2 = gz2 + vz * halfD * s2;
            mb.roof.tri([px2 - ux * 0.9, b.h, pz2 - uz * 0.9],
                        [px2 + ux * 0.9, b.h, pz2 + uz * 0.9],
                        [px2, b.h + 1.15, pz2],
                        [[0, 0], [1.5, 0], [0.75, 1]], 0xd8dde2);
          }
        }
      }
      // chimney on a gable end — the thing that makes a Dublin roofline read right
      if (b.lm !== 'hospital' && !isOut && b.area > 45 && hash01(b.id, 11) > 0.25) {
        const side = hash01(b.id, 12) > 0.5 ? 1 : -1;
        const chx = cx + ux * (halfL - 0.55) * side, chz = cz + uz * (halfL - 0.55) * side;
        mb.redbrick.box(chx, b.h - 0.4, chz, 0.42, b.roofH + 1.0, 0.34, b.ridge, BRICK_UV, 0xb08a72, false);
        mb.dark.box(chx, b.h + b.roofH + 0.55, chz, 0.5, 0.16, 0.42, b.ridge, 1, 0x38383a);
      }
    }

    // ---- landmarks get arcaded elevations, not a semi-d's door and bay
    if (b.lm === 'hospital') {
      victorianWalls(mb, poly, b);
    } else if (b.lm === 'commercial' && b.h >= 4) {
      commercialWalls(mb, poly, b, wallKey, tint);
    } else if (!isOut && !PERIOD.has(b.lm)
               && (b.lm === 'university' || b.levels >= 3 || b.h >= 9)) {
      // Universities here are 1960s faculty blocks — Sutherland and Quinn are
      // 70m and 97m across, and the arcade treatment written for period
      // buildings gives them almost nothing — so they come here regardless of
      // height. Churches, the mosque and the schools do NOT: a nine-metre
      // church caught by a height test would get a residential window grid,
      // which is what PERIOD is there to prevent. It was catching 24 of the 26
      // churches, the Miraculous Medal among them.
      blockWalls(mb, poly, b, wallKey, tint);
    } else if (b.lm && b.lm !== 'commercial' && b.lm !== 'apartments') {
      arcadeWalls(mb, poly, b, wallKey, tint);
    } else if (!isOut) {
      // Put the front on the wall that actually faces the street, rather than
      // on the building's bounding rectangle. For anything that isn't a plain
      // box those are different places — on the worst footprints here, eleven
      // metres apart — and the door and windows ended up hanging in the garden
      // with no wall behind them.
      const face = frontFace(poly, b.facing, cx, cz, ux, uz, halfL, halfD);
      const nx = face.nx, nz = face.nz;
      const tx = face.tx, tz = face.tz;           // tangent along the facade
      const fx = face.x, fz = face.z;
      const faceW = face.w;
      const put = (off, y, w, h, key, colour, proud) => {
        const a = [fx + tx * (off - w / 2) + nx * proud, y, fz + tz * (off - w / 2) + nz * proud];
        const bb = [fx + tx * (off + w / 2) + nx * proud, y, fz + tz * (off + w / 2) + nz * proud];
        const c = [bb[0], y + h, bb[2]], d = [a[0], y + h, a[2]];
        mb[key].quad(bb, a, d, c, [[0, 0], [1, 0], [1, 1], [0, 1]], colour);   // faces the street
      };
      const opening = (off, y, w, h, glassCol) => {
        put(off, y - 0.08, w + 0.16, h + 0.16, 'trim', 0xf4f1e8, 0.05);   // frame/reveal
        put(off, y, w, h, 'glass', glassCol, 0.09);
        // glazing bars
        put(off, y + h / 2 - 0.03, w, 0.06, 'trim', 0xf4f1e8, 0.11);
        put(off - 0.03, y, 0.06, h, 'trim', 0xf4f1e8, 0.11);
      };
      const glassCol = 0xffffff;
      const doorCol = DOOR_COLOURS[Math.floor(hash01(b.id, 5) * DOOR_COLOURS.length)];

      if (faceW >= 4.0) {
        // classic Dublin semi-d front: door to one side, bay window beside it
        const side = hash01(b.id, 6) > 0.5 ? 1 : -1;
        const doorOff = side * (faceW / 2 - 1.0);
        put(doorOff, 0.0, 1.02, 2.08, 'door', doorCol, 0.07);
        put(doorOff, 0.0, 1.22, 2.26, 'trim', 0xf4f1e8, 0.04);
        put(doorOff, 2.12, 0.9, 0.34, 'glass', 0xfff0d0, 0.09);          // fanlight
        // porch canopy
        const yawT = Math.atan2(nx, -nz);
        mb.dark.box(fx + tx * doorOff + nx * 0.34, 2.5, fz + tz * doorOff + nz * 0.34,
          0.78, 0.14, 0.42, yawT, 1, 0x55585c);

        const winOff = -side * (faceW / 2 - 1.35);
        const winW = Math.min(2.2, faceW - 2.9);
        if (faceW >= 5.2 && !isOut && hash01(b.id, 14) > 0.4) {
          // projecting bay — the thing that gives these streets their depth
          const bayD = 0.62, bayH = 2.5, bayW = Math.min(2.5, winW + 0.3);
          const bxp = fx + tx * winOff + nx * (bayD / 2);
          const bzp = fz + tz * winOff + nz * (bayD / 2);
          mb[wallKey].box(bxp, 0, bzp, bayW / 2, bayH, bayD / 2, yawT, BRICK_UV, tint, false);
          mb.dark.box(bxp, bayH, bzp, bayW / 2 + 0.09, 0.14, bayD / 2 + 0.09, yawT, 1, 0x4e5155);
          put(winOff, 0.95, bayW * 0.72, 1.35, 'glass', glassCol, bayD + 0.02);
          put(winOff, 0.95 - 0.08, bayW * 0.72 + 0.16, 1.51, 'trim', 0xf4f1e8, bayD - 0.01);
          put(winOff, 0.95 + 0.63, bayW * 0.72, 0.06, 'trim', 0xf4f1e8, bayD + 0.04);
        } else {
          opening(winOff, 0.95, winW, 1.35, glassCol);
        }
        // top-floor sills sit a storey below the eaves, not a fixed height up
        const topY = b.h - 2.85 + 0.85;
        if (b.levels >= 2) {
          opening(doorOff, topY, 1.05, 1.3, glassCol);
          opening(-side * (faceW / 2 - 1.35), topY, Math.min(1.7, faceW - 3.2), 1.3, glassCol);
        }
        if (b.levels >= 3) opening(0, topY - 2.85, 1.2, 1.2, glassCol);
      } else if (faceW >= 2.4) {
        put(0, 0.0, 0.98, 2.05, 'door', doorCol, 0.07);
        if (b.levels >= 2) opening(0, b.h - 2.85 + 0.85, Math.min(1.2, faceW - 1.0), 1.25, glassCol);
      }

      // garden path from the door out to the kerb
      let best = null;
      for (const [ax, az, bx2, bz2, rw] of segs) {
        const vx2 = bx2 - ax, vz2 = bz2 - az;
        const L2 = vx2 * vx2 + vz2 * vz2;
        const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((fx - ax) * vx2 + (fz - az) * vz2) / L2));
        const qx = ax + t * vx2, qz = az + t * vz2;
        const d = Math.hypot(fx - qx, fz - qz);
        if (!best || d < best[0]) best = [d, qx, qz, rw];
      }
      if (best && best[0] < 26) {
        const [d, qx, qz, rw] = best;
        const dx = (qx - fx) / d, dz = (qz - fz) / d;
        const end = Math.max(0.6, d - rw / 2 - 1.9);
        ribbon(mb.pavement, [[fx + dx * 0.1, fz + dz * 0.1],
                             [fx + dx * end, fz + dz * end]], 1.15, 0.10, 3, 0xd9d3c4);

        // the front wall, laid out globally so neighbours can't cross
        for (const w of wallsFor.get(b.id) || []) {
          if (w.style < 0.18) {
            mb.hedge.box(w.mx, 0, w.mz, w.half, w.h + 0.45, 0.32, w.yaw, 1.2, 0xffffff);
            continue;
          }
          mb[wallKey].box(w.mx, 0, w.mz, w.half, w.h, 0.15, w.yaw, BRICK_UV, tint, false);
          mb.granite.box(w.mx, w.h, w.mz, w.half + 0.03, 0.08, 0.19, w.yaw, 1.4, 0xffffff);
          for (const e of [-1, 1]) {              // a pier at each end of the run
            const px2 = w.mx + w.wx * w.half * e, pz2 = w.mz + w.wz * w.half * e;
            mb[wallKey].box(px2, 0, pz2, 0.2, w.h + 0.15, 0.2, w.yaw, BRICK_UV, tint, false);
            mb.granite.box(px2, w.h + 0.15, pz2, 0.24, 0.07, 0.24, w.yaw, 1.4, 0xffffff);
          }
        }
      }
    }

  }

  function emitBarrier(mb, bar) {
    const key = bar.kind === 'hedge' ? 'hedge' : bar.kind === 'fence' ? 'dark' : 'wall';
    const th = bar.kind === 'hedge' ? 0.5 : bar.kind === 'fence' ? 0.08 : 0.32;
    for (let i = 0; i < bar.pts.length - 1; i++) {
      const [x1, z1] = bar.pts[i], [x2, z2] = bar.pts[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.2) continue;
      const yaw = Math.atan2(z2 - z1, x2 - x1);
      mb[key].box((x1 + x2) / 2, 0, (z1 + z2) / 2, len / 2, bar.h, th / 2, yaw, 1.2,
        bar.kind === 'hedge' ? 0x4a7a3a : 0xffffff);
    }
  }

  function emitLamps(mb, r) {
    if (r.kind === 'service' || r.kind === 'footway') return;
    const side = offsetLine(r.pts, r.w / 2 + 1.4);
    let travelled = 0, next = 14;                 // distance along the whole street
    for (let i = 0; i < side.length - 1; i++) {
      const [x1, z1] = side[i], [x2, z2] = side[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.01) continue;
      const yaw = Math.atan2(z2 - z1, x2 - x1);
      while (next < travelled + len) {
        const t = (next - travelled) / len;
        const px = x1 + (x2 - x1) * t, pz = z1 + (z2 - z1) * t;
        mb.dark.box(px, 0.14, pz, 0.075, 4.6, 0.075, 0, 1, 0x3a3d40);
        mb.dark.box(px, 4.7, pz, 0.5, 0.16, 0.22, yaw, 1, 0x4a4d50);
        next += 32;
      }
      travelled += len;
    }
  }

  // --------------------------------------------------- bucket the features --
  for (const a of world.areas) {
    if (AREA_STYLE[a.kind]) cellAt(a.poly[0][0], a.poly[0][1]).areas.push(a);
  }
  for (const w of world.water) cellAt(w.pts[0][0], w.pts[0][1]).water.push(w);
  for (const r of world.roads) {
    const c = cellAt(r.pts[0][0], r.pts[0][1]);
    c.roads.push(r);
    c.lamps.push(r);
  }
  for (const p of world.paths) cellAt(p.pts[0][0], p.pts[0][1]).paths.push(p);

  // Every road is drawn as its own ribbon and they simply stop where they meet,
  // so a junction is a notch of grass between four blunt ends, and the clipped
  // pavements leave a gap around it. A patch of carriageway at each meeting
  // point closes both. 1,655 of them, a dozen triangles each.
  {
    const at = new Map();
    for (const r of world.roads) {
      for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) {
        const k = `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
        const j = at.get(k);
        if (j) { j.n++; j.w = Math.max(j.w, r.w); }
        else at.set(k, { x: p[0], z: p[1], w: r.w, n: 1 });
      }
    }
    for (const j of at.values()) {
      if (j.n < 2) continue;                    // a dead end needs no patch
      cellAt(j.x, j.z).junctions.push(j);
    }
  }
  // The mapped walls, fences and hedges — 131km of them — were drawn and never
  // collided with, so you could drive straight through a boundary wall. They
  // get the same treatment as the garden walls: solid to cars, and anything low
  // enough to hop is marked so you can.
  for (const bar of world.barriers) {
    cellAt(bar.pts[0][0], bar.pts[0][1]).barriers.push(bar);
    const th = bar.kind === 'hedge' ? 0.5 : bar.kind === 'fence' ? 0.08 : 0.32;
    for (let i = 0; i < bar.pts.length - 1; i++) {
      const [x1, z1] = bar.pts[i], [x2, z2] = bar.pts[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.4) continue;
      colliders.push({
        x: (x1 + x2) / 2, z: (z1 + z2) / 2,
        hx: len / 2,
        // never thinner than this, or a car crosses it between frames
        hz: Math.max(th / 2, 0.22),
        yaw: Math.atan2(z2 - z1, x2 - x1),
        h: bar.h,
        low: bar.h <= 1.0,
      });
    }
  }

  // ------------------------------------------------ front garden walls ----
  //
  // Almost none of this is in the map: of the houses sampled, 4% had any
  // barrier recorded between them and their street. So the low wall along the
  // footpath is generated, like the doors and bays — placed against a real
  // footprint on a real street rather than surveyed.
  //
  // It has to be laid out here, in one pass over every building, rather than
  // per chunk. Each house knows nothing about its neighbours, so on a corner
  // plot two of these ran straight through each other; and a chunk streaming
  // in later must not produce different walls from the same chunk streaming in
  // first, which anything order-dependent would.
  const wallsFor = new Map();          // building id -> segments to draw
  {
    // Where the imagery actually found a hedge along a frontage, use it instead
    // of the invented wall: measured position, measured width. 474 of them. The
    // detector's `wall` class is not shipped — a narrow pale line is just as
    // good a description of a driveway, and most of what it found were drives.
    const measured = new Map();
    for (const h of frontage.hedges || []) measured.set(h.id, h);
    const laid = [];                   // everything accepted so far, for crossing tests
    const GW = 24, gwGrid = new Map();
    const add = (seg) => {
      const k = `${Math.floor(seg.mx / GW)},${Math.floor(seg.mz / GW)}`;
      const a = gwGrid.get(k);
      if (a) a.push(seg); else gwGrid.set(k, [seg]);
      laid.push(seg);
    };
    const crosses = (seg) => {
      const gx = Math.floor(seg.mx / GW), gz = Math.floor(seg.mz / GW);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const o of gwGrid.get(`${gx + dx},${gz + dz}`) || []) {
            if (segmentsCross(seg, o)) return true;
          }
        }
      }
      return false;
    };

    // deterministic order, so the result never depends on streaming
    const sorted = world.buildings.slice().sort((a, b) => a.id - b.id);
    for (const b of sorted) {
      if (b.lm || b.type === 'roof' || b.type === 'shed'
          || b.type === 'garage' || b.type === 'garages') continue;
      const poly = b.poly;
      const ux = Math.cos(b.ridge), uz = Math.sin(b.ridge);
      const vx = -uz, vz = ux;
      const [ulo, uhi] = projectExtent(poly, ux, uz);
      const [vlo, vhi] = projectExtent(poly, vx, vz);
      const uc = (ulo + uhi) / 2, vc = (vlo + vhi) / 2;
      const halfL = (uhi - ulo) / 2, halfD = (vhi - vlo) / 2;
      const cx = ux * uc + vx * vc, cz = uz * uc + vz * vc;
      const face = frontFace(poly, b.facing, cx, cz, ux, uz, halfL, halfD);
      if (face.w < 3.5) continue;

      // the property line: where the garden path stops, at the back of the kerb
      const best = nearestRoad(face.x, face.z);
      if (!best || best[0] >= 26) continue;
      const [d, qx, qz, rw] = best;
      const dirx = (qx - face.x) / d, dirz = (qz - face.z) / d;
      const end = Math.max(0.6, d - rw / 2 - 1.9);
      if (end <= 2.4) continue;

      const seen = measured.get(b.id);
      const bx = seen ? seen.x : face.x + dirx * end;
      const bz = seen ? seen.z : face.z + dirz * end;
      const wx = seen ? seen.tx : -dirz;           // along the street
      const wz = seen ? seen.tz : dirx;
      const yaw = Math.atan2(wz, wx);
      const half = Math.min((seen ? seen.w : face.w) / 2 + 0.5, 9);
      const gate = 1.0;
      // a measured frontage is a hedge by definition; the rest keep the mix
      const style = seen ? 0.0 : hash01(b.id, 21);
      const h = 0.62 + hash01(b.id, 22) * 0.26;
      const out = [];
      for (const [a0, a1] of [[-half, -gate], [gate, half]]) {
        const len = a1 - a0;
        if (len < 0.5) continue;
        const mx = bx + wx * (a0 + len / 2), mz = bz + wz * (a0 + len / 2);
        const seg = { mx, mz, half: len / 2, wx, wz, yaw, h, style, id: b.id };
        if (crosses(seg)) continue;                // a neighbour got here first
        add(seg);
        out.push(seg);
      }
      if (out.length) {
        // gate piers only where a run actually survived beside them
        out.push(...[]);
        wallsFor.set(b.id, out);
        for (const seg of out) {
          colliders.push({ x: seg.mx, z: seg.mz, hx: seg.half, hz: 0.16,
                           yaw: seg.yaw, h: seg.h, low: true });
        }
      }
    }
  }

  for (const b of world.buildings) {
    cellAt(b.poly[0][0], b.poly[0][1]).buildings.push(b);
    // the oriented box, needed for collision long before any geometry exists
    const ux = Math.cos(b.ridge), uz = Math.sin(b.ridge);
    const vx = -uz, vz = ux;
    const [ulo, uhi] = projectExtent(b.poly, ux, uz);
    const [vlo, vhi] = projectExtent(b.poly, vx, vz);
    const uc = (ulo + uhi) / 2, vc = (vlo + vhi) / 2;
    const halfL = (uhi - ulo) / 2, halfD = (vhi - vlo) / 2;
    const cx = ux * uc + vx * vc, cz = uz * uc + vz * vc;
    // The bounding box is also what you bump into, so on those same footprints
    // it walls off garden you can plainly see is empty. Where it fits the
    // building, keep it — one box is far cheaper than six. Where it doesn't,
    // put a slab along each wall so the obstruction matches what's drawn.
    // A canopy is a roof on posts: only the posts are solid, or you could not
    // walk under the thing it exists to walk under.
    if (b.type === 'roof') {
      const cp = b.poly;
      for (let i = 0; i < cp.length; i++) {
        const [x1, z1] = cp[i];
        const [x2, z2] = cp[(i + 1) % cp.length];
        const ex = x2 - x1, ez = z2 - z1;
        const len = Math.hypot(ex, ez);
        if (len < 1.2) continue;
        const n = Math.max(1, Math.round(len / 5.5));
        for (let k = 0; k < n; k++) {
          const t = (len * k) / n;
          colliders.push({
            x: x1 + (ex / len) * t - (ez / len) * 0.34,
            z: z1 + (ez / len) * t + (ex / len) * 0.34,
            hx: 0.16, hz: 0.16, yaw: 0, h: 3.2,
          });
        }
      }
      continue;
    }

    // Same test the roof uses, so the two can never disagree.
    const poly = b.poly;
    // The collider is the bare rectangle, with no eaves on it, and a box that
    // juts even 15cm past the walls is a barrier you can see through. Slabs are
    // cheap now that the colliders are indexed, so the bar is low: this costs
    // about 5,000 extra colliders out of 140,000.
    const overhang = roofOverhang(poly, cx, cz, ux, uz, vx, vz, halfL, halfD, 0);
    const boxy = overhang <= 0.15;
    // how high it stands, so the camera can rise clear of it rather than
    // treating every roof as an infinitely tall wall in plan view
    const top = b.h + (b.roof !== 'flat'
      && roofOverhang(poly, cx, cz, ux, uz, vx, vz, halfL, halfD) <= 3.0
      ? (b.roofH || 0) : 0.4);
    if (boxy) {
      colliders.push({ x: cx, z: cz, hx: halfL, hz: halfD, yaw: b.ridge, h: top });
    } else {
      // The slab has to be THICK or a car crosses it between frames — at
      // 21 m/s that is 0.35m per frame at 60fps and 0.7m at 30 — but a thick
      // slab centred on the wall would block you half a metre out in the
      // garden. So it is thick and pushed inwards, leaving its outer face
      // exactly on the brickwork. Every footprint winds the same way, so for
      // an edge (ex, ez) the outward normal is (ez, -ex) with no ambiguity,
      // which matters on the notch of an L-shaped building.
      const T = 0.45;                            // half-thickness: 0.9m of solid
      for (let i = 0; i < poly.length; i++) {
        const [x1, z1] = poly[i];
        const [x2, z2] = poly[(i + 1) % poly.length];
        const ex = x2 - x1, ez = z2 - z1;
        const len = Math.hypot(ex, ez);
        if (len < 0.4) continue;
        const ox = ez / len, oz = -ex / len;     // outward
        colliders.push({
          x: (x1 + x2) / 2 - ox * T, z: (z1 + z2) / 2 - oz * T,
          hx: len / 2, hz: T, yaw: Math.atan2(ez, ex), h: top,
        });
      }
    }
    if (b.name) {
      labels.push({ name: b.name, x: cx, z: cz, y: b.h + b.roofH + 2.5, kind: b.amenity });
    }
  }

  // Vegetation streams with everything else: at this size a single instanced
  // mesh for every tree in the map has one bounding sphere, so it can never be
  // culled and the whole forest is drawn every frame.
  // Golf: OSM maps the course boundary and nothing inside it, so the bunkers
  // and greens are traced off the imagery instead. They sit a few centimetres
  // above the grass so there is no z-fighting with the landuse polygon.
  for (const c of golf.courses || []) {
    for (const b of c.bunkers || []) cellAt(b.poly[0][0], b.poly[0][1]).golf.push({ kind: 'sand', poly: b.poly });
    for (const g of c.greens || []) cellAt(g.poly[0][0], g.poly[0][1]).golf.push({ kind: 'putting', poly: g.poly });
  }
  for (const t of veg.trees || []) cellAt(t.x, t.z).trees.push(t);
  for (const h of veg.hedges || []) cellAt(h.pts[0][0], h.pts[0][1]).hedges.push(h);
  treeColliders(veg.trees || [], colliders);
  hedgeColliders(veg.hedges || [], colliders);

  // ------------------------------------------------- build / drop a cell ----
  // Building a whole chunk at once meant one frame doing every building, road
  // and tree in 220 m of city, plus all the mesh uploads — which is exactly what
  // a stutter is. So a chunk is prepared as a queue of small jobs and worked
  // through against a time budget, spilling into the next frame when it runs out.
  function prepare(c) {
    const mb = makeBuilders();
    const q = [];
    for (const a of c.areas) q.push(() => emitArea(mb, a));
    for (const w of c.water) q.push(() => emitWater(mb, w));
    for (const j of c.junctions) q.push(() => emitJunction(mb, j));
    for (const r of c.roads) q.push(() => emitRoad(mb, r));
    for (const p of c.paths) q.push(() => emitPath(mb, p));
    for (const gf of c.golf) q.push(() => emitGolf(mb, gf));
    for (const b of c.buildings) q.push(() => emitBuilding(mb, b));
    for (const bar of c.barriers) q.push(() => emitBarrier(mb, bar));
    for (const r of c.lamps) q.push(() => emitLamps(mb, r));

    const g = new THREE.Group();
    g.name = `chunk ${c.key}`;
    // the meshes can only be made once every emitter above has run, so they go
    // on the end of the same queue
    for (const key of KEYS) {
      q.push(() => { if (mb[key].count) g.add(mb[key].build(M[key])); });
    }
    q.push(() => { for (const m of makeTrees(c.trees, M)) g.add(m); });
    q.push(() => { for (const m of makeHedges(c.hedges, M)) g.add(m); });
    q.push(() => { scene.add(g); c.group = g; });

    c.pending = { q, i: 0 };
  }

  /** Work at a chunk until the deadline. Returns true when it's finished. */
  function stepCell(c, deadline) {
    if (!c.pending) prepare(c);
    const p = c.pending;
    while (p.i < p.q.length) {
      p.q[p.i++]();
      // Check the clock every job, not every sixteenth.
      //
      // Sixteen was fine when a job was a plain extruded box. It is not now: a
      // job can be a seven-storey block with a window grid on every elevation,
      // or a road with its pavements and junction, and sixteen of those blow
      // through a 6ms budget several times over. Measured while driving into
      // fresh ground, the median stream() was taking 40ms against its 6ms
      // budget, which is the stutter. performance.now() costs tens of
      // nanoseconds; emitting a building costs far more.
      if (performance.now() >= deadline) return false;
    }
    c.pending = null;
    return true;
  }

  function dropCell(c) {
    c.pending = null;                    // abandon any half-built work
    if (!c.group) return;
    scene.remove(c.group);
    // free the GPU buffers; the materials are shared, so leave those alone
    c.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.dispose) o.dispose();          // InstancedMesh holds GPU buffers too
    });
    c.group = null;
  }

  /**
   * Build what you can see, drop what you can't. `ms` caps how long may be spent
   * generating geometry this frame, so arriving somewhere new costs a slightly
   * later chunk rather than a dropped frame.
   */
  function stream(pos, ms = 6) {
    const deadline = performance.now() + ms;
    const todo = [];
    for (const c of cells.values()) {
      const d = Math.hypot(c.cx - pos.x, c.cz - pos.z);
      if (d < STREAM_IN) {
        if (!c.group || c.pending) todo.push([d, c]);
      } else if (d > STREAM_OUT && (c.group || c.pending)) {
        dropCell(c);
      }
    }
    todo.sort((a, b) => a[0] - b[0]);          // nearest first
    for (const [, c] of todo) {
      if (performance.now() >= deadline) break;
      stepCell(c, deadline);
    }
    return todo.length;
  }

  // the ground plane and the landmarks are small and always present
  const staticMb = makeBuilders();
  {
    const mb = staticMb;
  // ------------------------------------------------------------- ground ----
  // Built into the same buffer as the greens so one grass texture serves both
  // (a shared material can only carry one repeat setting).
  const R = world.meta.radius;
  const A = R * 1.4;
  mb.grass.quad([-A, 0, -A], [-A, 0, A], [A, 0, A], [A, 0, -A],
    [[-A / 6, -A / 6], [-A / 6, A / 6], [A / 6, A / 6], [A / 6, -A / 6]], 0x9dbd85);

  }

  // ------------------------------------------------------- landmarks ------
  addLandmarks(landmarks, M, scene, colliders, labels);

  // --------------------------------------------------------- meshes --------
  const group = new THREE.Group();
  for (const [key, builder] of Object.entries(staticMb)) {
    if (builder.count === 0) continue;
    group.add(builder.build(M[key]));
  }
  scene.add(group);
  console.log(`world: ${cells.size} chunks, streamed on demand`);

  return { colliders, labels, group, cells, stream };
}

/** An upright rectangular panel in a wall plane. */
function panel(mb, key, bx, by, bz, tx, tz, nx, nz, w, h, proud, colour) {
  const hw = w / 2;
  const P = (o, y) => [bx + tx * o + nx * proud, y, bz + tz * o + nz * proud];
  const a = P(-hw, by), b2 = P(hw, by), c = P(hw, by + h), d = P(-hw, by + h);
  mb[key].quad(b2, a, d, c, [[0, 0], [1, 0], [1, 1], [0, 1]], colour);
}

/**
 * The former Central Mental Hospital, Dundrum (Jacob Owen & F.V. Clarendon,
 * 1847-51). Built to the NIAH description: coursed rubble limestone with cut
 * granite quoins and a chamfered cushion course, and three tiers of windows
 * that diminish floor by floor — the detail that gives the elevation its
 * graduated look. Bay spacing gives seventeen bays across the main range.
 */
function victorianWalls(mb, poly, b) {
  const GRANITE = 0xe4e0d6, GLASS = 0xcfdae2;
  const main = b.area > 600;
  const BAY = 3.45;                     // ~17 bays across the main block
  const eaves = b.h;

  // three storeys over basement: sill heights and diminishing window heights
  const tiers = [
    { sill: 1.75, h: 2.40, wide: main ? 2.5 : 1.5 },   // ground, tripartite
    { sill: 5.35, h: 1.95, wide: 1.35 },
    { sill: 8.80, h: 1.55, wide: 1.25 },
  ].filter((t) => t.sill + t.h < eaves - 0.9);

  let cx = 0, cz = 0;
  for (const p of poly) { cx += p[0] / poly.length; cz += p[1] / poly.length; }

  // longest wall gets the entrance
  let longest = 0, longIdx = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i], [x2, z2] = poly[(i + 1) % poly.length];
    const L = Math.hypot(x2 - x1, z2 - z1);
    if (L > longest) { longest = L; longIdx = i; }
  }

  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 4) continue;
    const tx = (x2 - x1) / len, tz = (z2 - z1) / len;
    let nx = tz, nz = -tx;
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    const flip = (mx - cx) * nx + (mz - cz) * nz < 0;
    if (flip) { nx = -nx; nz = -nz; }
    const wx = flip ? -tx : tx, wz = flip ? -tz : tz;
    const at = (d) => [x1 + tx * d, z1 + tz * d];

    // cut-granite chamfered cushion course along the base
    for (let d = 0; d < len; d += 4) {
      const seg = Math.min(4, len - d);
      const [px, pz] = at(d + seg / 2);
      panel(mb, 'granite', px, 0, pz, wx, wz, nx, nz, seg + 0.02, 0.62, 0.05, GRANITE);
    }

    const n = Math.max(1, Math.round(len / BAY) - 1);
    const step = len / (n + 1);
    for (let k = 1; k <= n; k++) {
      const [px, pz] = at(k * step);
      for (const t of tiers) {
        // granite surround, then the glazing proud of it
        panel(mb, 'granite', px, t.sill - 0.16, pz, wx, wz, nx, nz,
          t.wide + 0.34, t.h + 0.32, 0.05, GRANITE);
        panel(mb, 'glass', px, t.sill, pz, wx, wz, nx, nz, t.wide, t.h, 0.10, GLASS);
        // ground floor is tripartite: two mullions
        if (t === tiers[0] && main) {
          for (const o of [-t.wide / 6, t.wide / 6]) {
            panel(mb, 'granite', px + wx * o, t.sill, pz + wz * o, wx, wz, nx, nz,
              0.11, t.h, 0.12, GRANITE);
          }
        }
      }
    }

    // Tudor-headed central doorway with a block-and-start granite surround
    if (main && i === longIdx) {
      const [px, pz] = at(len / 2);
      panel(mb, 'granite', px, 0, pz, wx, wz, nx, nz, 2.5, 4.2, 0.06, GRANITE);
      panel(mb, 'door', px, 0, pz, wx, wz, nx, nz, 1.7, 2.9, 0.12, 0x3a2a1c);
      panel(mb, 'glass', px, 2.95, pz, wx, wz, nx, nz, 1.6, 0.55, 0.12, 0xf2e6c8);
    }
  }

  // cut-granite flush quoins at every corner
  for (const [qx, qz] of poly) {
    mb.granite.box(qx, 0, qz, 0.42, eaves, 0.42, 0, 2.0, GRANITE, false);
  }
}

/**
 * Tall round-headed windows, set in bays along every long wall — the arcaded
 * elevation both the church and the mosque have, and the thing that stops them
 * reading as a warehouse with a dome on top.
 */
function arcadeWalls(mb, poly, b, wallKey, tint) {
  const tall = b.lm === 'church' || b.lm === 'worship';
  const winW = tall ? 1.35 : 1.6;
  const winH = Math.min(b.h * 0.55, tall ? 4.6 : 2.9);
  const sill = tall ? b.h * 0.28 : 1.1;
  const spacing = tall ? 4.6 : 5.4;

  // outward direction comes from the centroid, so it holds for any winding
  let cx = 0, cz = 0;
  for (const p of poly) { cx += p[0] / poly.length; cz += p[1] / poly.length; }

  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < spacing * 1.4) continue;              // too short for a bay
    const tx = (x2 - x1) / len, tz = (z2 - z1) / len;
    let nx = tz, nz = -tx;                          // wall normal
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    const flip = (mx - cx) * nx + (mz - cz) * nz < 0;
    if (flip) { nx = -nx; nz = -nz; }
    // The window's own facing comes from its winding, which follows the tangent
    // we hand it — so mirror the tangent whenever the normal was flipped, or
    // half of them end up facing into the building.
    const wx = flip ? -tx : tx, wz = flip ? -tz : tz;

    const n = Math.max(1, Math.floor((len - 2.2) / spacing));
    const step = len / (n + 1);
    for (let k = 1; k <= n; k++) {
      const d = k * step;
      archWindow(mb, x1 + tx * d, sill, z1 + tz * d, wx, wz, nx, nz, winW, winH);
    }
  }
}

/** One round-headed window: a light with a semicircular head, plus its surround. */
function archWindow(mb, bx, by, bz, tx, tz, nx, nz, w, h) {
  const hw = w / 2;
  const spring = Math.max(0.4, h - hw);            // where the arch springs from
  const SEG = 9;
  const GC = 0xdfe8ef, TC = 0xede7d8;

  // point in the wall plane: `o` along the wall, `y` up, `p` proud of the face
  const pt = (o, y, p) => [bx + tx * o + nx * p, y, bz + tz * o + nz * p];

  const light = (key, half, proud, colour) => {
    const a = pt(-half, by, proud), b2 = pt(half, by, proud);
    const c = pt(half, by + spring, proud), d = pt(-half, by + spring, proud);
    mb[key].quad(b2, a, d, c, [[0, 0], [1, 0], [1, 1], [0, 1]], colour);
    const apex = by + spring;
    const ctr = pt(0, apex, proud);
    for (let s = 0; s < SEG; s++) {
      const a0 = Math.PI * (s / SEG), a1 = Math.PI * ((s + 1) / SEG);
      const p0 = pt(half * Math.cos(a0), apex + half * Math.sin(a0), proud);
      const p1 = pt(half * Math.cos(a1), apex + half * Math.sin(a1), proud);
      mb[key].tri(p1, p0, ctr, [[0, 0], [1, 0], [0.5, 1]], colour);
    }
  };

  light('trim', hw + 0.16, 0.05, TC);              // surround, set back
  light('glass', hw, 0.10, GC);                    // glazing, proud of it
}

/**
 * Domes and minarets. Plan geometry — where each dome sits and how wide it is —
 * is measured off satellite imagery by detect_landmarks.py. The dome heights
 * follow from that: these are hemispheres, so the rise equals the radius. Only
 * the minaret's height is a guess, and it's flagged as one in the data.
 */
function addLandmarks(landmarks, M, scene, colliders, labels) {
  const list = landmarks.landmarks || [];
  if (!list.length) return;
  const g = new THREE.Group();
  g.name = 'landmarks';

  for (const L of list) {
    const mat = M[L.domeMat] || M.copper;
    const wallMat = M[L.wallMat] || M.stone;
    for (const d of L.domes || []) {
      // The end dome stands on a tall colonnaded drum — the "tower" the building
      // is known for. The rest sit on shallow drums along the nave.
      const drumH = d.colonnade ? d.r * 1.5 : Math.max(0.8, d.r * 0.45);
      const drum = new THREE.Mesh(
        new THREE.CylinderGeometry(d.r * 0.98, d.r * 1.02, drumH, 32), wallMat);
      drum.position.set(d.x, L.base + drumH / 2, d.z);
      drum.castShadow = drum.receiveShadow = true;

      if (d.colonnade) {
        const n = 16, cr = d.r * 1.12, colH = drumH * 0.62;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const col = new THREE.Mesh(
            new THREE.CylinderGeometry(d.r * 0.075, d.r * 0.075, colH, 8), wallMat);
          col.position.set(d.x + Math.cos(a) * cr, L.base + colH / 2, d.z + Math.sin(a) * cr);
          col.castShadow = true;
          g.add(col);
        }
        const cornice = new THREE.Mesh(
          new THREE.CylinderGeometry(cr * 1.06, cr * 1.06, d.r * 0.16, 32), wallMat);
        cornice.position.set(d.x, L.base + colH + d.r * 0.08, d.z);
        cornice.castShadow = cornice.receiveShadow = true;
        g.add(cornice);
      }

      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(d.r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      dome.position.set(d.x, L.base + drumH, d.z);
      dome.castShadow = dome.receiveShadow = true;

      const finial = new THREE.Mesh(new THREE.SphereGeometry(d.r * 0.09, 10, 8), mat);
      finial.position.set(d.x, L.base + drumH + d.r + d.r * 0.06, d.z);
      g.add(drum, dome, finial);
    }

    const m = L.minaret;
    if (m) {
      const shaftH = m.h * 0.78;
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(m.w * 0.34, m.w * 0.5, shaftH, 12), wallMat);
      shaft.position.set(m.x, shaftH / 2, m.z);

      const balcony = new THREE.Mesh(
        new THREE.CylinderGeometry(m.w * 0.62, m.w * 0.62, m.w * 0.34, 14), M.steel);
      balcony.position.set(m.x, shaftH, m.z);

      const upper = new THREE.Mesh(
        new THREE.CylinderGeometry(m.w * 0.26, m.w * 0.32, m.h * 0.14, 12), wallMat);
      upper.position.set(m.x, shaftH + m.h * 0.07 + m.w * 0.17, m.z);

      const capH = m.h * 0.12;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(m.w * 0.34, capH, 14),
        M[L.domeMat] || M.lead);
      cap.position.set(m.x, shaftH + m.h * 0.14 + m.w * 0.17 + capH / 2, m.z);

      for (const part of [shaft, balcony, upper, cap]) {
        part.castShadow = part.receiveShadow = true;
        g.add(part);
      }
      colliders.push({ x: m.x, z: m.z, hx: m.w * 0.5, hz: m.w * 0.5, yaw: 0 });
    }

    if (L.name && L.domes && L.domes.length) {
      const d = L.domes[0];
      labels.push({ name: L.name, x: d.x, z: d.z, y: L.base + d.r * 2, kind: L.lm });
    }
  }
  scene.add(g);
}

/** Vertical walls around a footprint, with UVs that keep brick courses level. */
// Contact shading where a wall meets the ground. Real walls are darker at the
// base because the ground blocks half the sky there, and without it buildings
// look like they are hovering. The band is a fixed height in metres, not a
// fraction, so a four-storey block doesn't get a four-storey smudge.
const AO_BAND = 2.6;      // metres
const AO_DARK = 0.66;     // brightness right at the ground

function extrudeWalls(mb, poly, y0, y1, colour) {
  const n = poly.length;
  const band = Math.min(AO_BAND, (y1 - y0) * 0.5);
  for (let i = 0; i < n; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % n];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.05) continue;
    const u = len / BRICK_UV;
    if (band <= 0.01) {
      const a = [x1, y0, z1], b = [x2, y0, z2], c = [x2, y1, z2], d = [x1, y1, z1];
      const v = (y1 - y0) / BRICK_UV;
      mb.quad(b, a, d, c, [[0, 0], [u, 0], [u, v], [0, v]], colour);
      continue;
    }
    // Split into a shaded base and a clean upper face. One extra quad per wall
    // face; triangles are cheap here, draw calls are not, and this adds none.
    const ym = y0 + band;
    const vm = band / BRICK_UV, v1 = (y1 - y0) / BRICK_UV;
    const a0 = [x1, y0, z1], b0 = [x2, y0, z2];
    const am = [x1, ym, z1], bm = [x2, ym, z2];
    const a1 = [x1, y1, z1], b1 = [x2, y1, z2];
    // quad(bottomRight, bottomLeft, topLeft, topRight) — see MeshBuilder.quad
    mb.quad(b0, a0, am, bm, [[0, 0], [u, 0], [u, vm], [0, vm]], colour,
            [AO_DARK, AO_DARK, 1, 1]);
    mb.quad(bm, am, a1, b1, [[0, vm], [u, vm], [u, v1], [0, v1]], colour);
  }
}

function dashedLine(mb, pts, y, halfW, dash, gap, colour) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.2) continue;
    const dx = (x2 - x1) / len, dz = (z2 - z1) / len;
    const nx = -dz * halfW, nz = dx * halfW;
    for (let t = 0; t + dash < len; t += dash + gap) {
      const ax = x1 + dx * t, az = z1 + dz * t;
      const bx = x1 + dx * (t + dash), bz = z1 + dz * (t + dash);
      mb.quad([ax + nx, y, az + nz], [bx + nx, y, bz + nz],
              [bx - nx, y, bz - nz], [ax - nx, y, az - nz],
              [[0, 0], [1, 0], [1, 1], [0, 1]], colour);
    }
  }
}
