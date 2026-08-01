// Tiny accumulator for hand-built geometry. Everything for one material goes
// into one buffer, so the whole street is a handful of draw calls.
import * as THREE from '../vendor/three.module.js';

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
  }

  get count() { return this.pos.length / 3; }

  _push(p, n, u, c) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(u[0], u[1]);
    this.col.push(c[0], c[1], c[2]);
  }

  /**
   * Quad a->b->c->d. The visible face is the side from which a,b,c,d read
   * counter-clockwise — i.e. the normal is cross(b-a, c-a). For an upright wall
   * given as (bottom-left, bottom-right, top-right, top-left) as seen from
   * OUTSIDE, that points inwards, so pass those four the other way round:
   * quad(bottomRight, bottomLeft, topLeft, topRight).
   */
  quad(a, b, c, d, uvs, colour) {
    const n = normal(a, b, c);
    const col = rgb(colour);
    const [ua, ub, uc, ud] = uvs;
    this._push(a, n, ua, col); this._push(b, n, ub, col); this._push(c, n, uc, col);
    this._push(a, n, ua, col); this._push(c, n, uc, col); this._push(d, n, ud, col);
  }

  tri(a, b, c, uvs, colour) {
    const n = normal(a, b, c);
    const col = rgb(colour);
    this._push(a, n, uvs[0], col); this._push(b, n, uvs[1], col); this._push(c, n, uvs[2], col);
  }

  /** Flat horizontal polygon at height y, triangulated. uvScale in world metres. */
  polyFlat(points2d, y, uvScale, colour, faceUp = true) {
    let src = points2d;
    let area = 0;                                  // normalise winding to CCW
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (area < 0) src = src.slice().reverse();
    const pts = src.map((p) => new THREE.Vector2(p[0], p[1]));
    const idx = THREE.ShapeUtils.triangulateShape(pts, []);
    const n = faceUp ? [0, 1, 0] : [0, -1, 0];
    const col = rgb(colour);
    for (const t of idx) {
      const tri = faceUp ? [t[0], t[2], t[1]] : t;   // z is south, so flip for +Y
      for (const i of tri) {
        const p = pts[i];
        this._push([p.x, y, p.y], n, [p.x / uvScale, p.y / uvScale], col);
      }
    }
  }

  /** Box aligned to an arbitrary yaw. c=[x,z] centre, sx/sz half-extents. */
  box(cx, y0, cz, sx, sy, sz, yaw, uvScale, colour, capTop = true) {
    const co = Math.cos(yaw), si = Math.sin(yaw);
    const P = (dx, dz, yy) => [cx + dx * co - dz * si, yy, cz + dx * si + dz * co];
    const y1 = y0 + sy;
    const c000 = P(-sx, -sz, y0), c100 = P(sx, -sz, y0), c110 = P(sx, sz, y0), c010 = P(-sx, sz, y0);
    const t000 = P(-sx, -sz, y1), t100 = P(sx, -sz, y1), t110 = P(sx, sz, y1), t010 = P(-sx, sz, y1);
    const uvw = (w, h) => [[0, 0], [w / uvScale, 0], [w / uvScale, h / uvScale], [0, h / uvScale]];
    // wound so the normals point out of the box (see quad())
    this.quad(c100, c000, t000, t100, uvw(sx * 2, sy), colour);
    this.quad(c110, c100, t100, t110, uvw(sz * 2, sy), colour);
    this.quad(c010, c110, t110, t010, uvw(sx * 2, sy), colour);
    this.quad(c000, c010, t010, t000, uvw(sz * 2, sy), colour);
    if (capTop) this.quad(t010, t110, t100, t000, uvw(sx * 2, sz * 2), colour);
  }

  build(material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

function normal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

const _c = new THREE.Color();
function rgb(hexOrArr) {
  if (Array.isArray(hexOrArr)) return hexOrArr;
  _c.set(hexOrArr);
  return [_c.r, _c.g, _c.b];
}

/** Offset a polyline sideways (for pavements alongside a road). */
export function offsetLine(pts, dist) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    out.push([p[0] - dz * dist, p[1] + dx * dist]);
  }
  return out;
}

/** Build a flat ribbon (road surface, path) along a polyline. */
export function ribbon(mb, pts, width, y, uvScale, colour) {
  const h = width / 2;
  let run = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    let dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    dx /= len; dz /= len;
    const nx = -dz * h, nz = dx * h;
    const a = [x1 + nx, y, z1 + nz], b = [x2 + nx, y, z2 + nz];
    const c = [x2 - nx, y, z2 - nz], d = [x1 - nx, y, z1 - nz];
    const u0 = run / uvScale, u1 = (run + len) / uvScale, v = width / uvScale;
    mb.quad(a, b, c, d, [[u0, 0], [u1, 0], [u1, v], [u0, v]], colour);
    run += len;
    // round out the joint so corners don't gap
    if (i < pts.length - 2) {
      const [x3, z3] = pts[i + 2];
      let ex = x3 - x2, ez = z3 - z2;
      const el = Math.hypot(ex, ez) || 1;
      ex /= el; ez /= el;
      const enx = -ez * h, enz = ex * h;
      mb.quad([x2 + nx, y, z2 + nz], [x2 + enx, y, z2 + enz],
              [x2 - nx, y, z2 - nz], [x2 - enx, y, z2 - enz],
              [[0, 0], [1, 0], [1, 1], [0, 1]], colour);
    }
  }
}

/** Raised slab with visible kerb faces — pavements. */
export function ribbonSlab(mb, pts, width, y, thick, uvScale, colour, sideColour) {
  ribbon(mb, pts, width, y, uvScale, colour);
  const h = width / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    let dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    dx /= len; dz /= len;
    for (const s of [1, -1]) {
      const nx = -dz * h * s, nz = dx * h * s;
      const a = [x1 + nx, y - thick, z1 + nz], b = [x2 + nx, y - thick, z2 + nz];
      const c = [x2 + nx, y, z2 + nz], d = [x1 + nx, y, z1 + nz];
      if (s === 1) mb.quad(a, b, c, d, [[0, 0], [len / uvScale, 0], [len / uvScale, 0.1], [0, 0.1]], sideColour);
      else mb.quad(b, a, d, c, [[0, 0], [len / uvScale, 0], [len / uvScale, 0.1], [0, 0.1]], sideColour);
    }
  }
}
