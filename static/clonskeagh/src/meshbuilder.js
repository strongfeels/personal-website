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
  quad(a, b, c, d, uvs, colour, ao) {
    const n = normal(a, b, c);
    const col = rgb(colour);
    const [ua, ub, uc, ud] = uvs;
    if (!ao) {
      this._push(a, n, ua, col); this._push(b, n, ub, col); this._push(c, n, uc, col);
      this._push(a, n, ua, col); this._push(c, n, uc, col); this._push(d, n, ud, col);
      return;
    }
    // `ao` is one brightness multiplier per corner, in the same order as the
    // vertices. Baked occlusion rides along in the colour attribute that is
    // already there, so it costs nothing to draw.
    const shade = (k) => [col[0] * ao[k], col[1] * ao[k], col[2] * ao[k]];
    const ca = shade(0), cb = shade(1), cc = shade(2), cd = shade(3);
    this._push(a, n, ua, ca); this._push(b, n, ub, cb); this._push(c, n, uc, cc);
    this._push(a, n, ua, ca); this._push(c, n, uc, cc); this._push(d, n, ud, cd);
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

/** A flat triangle wound so it faces up, whichever order the points arrive in. */
function flatTri(mb, a, b, c, colour) {
  const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  const uv = [[0, 0], [1, 0], [0, 1]];
  if (up >= 0) mb.tri(a, b, c, uv, colour);
  else mb.tri(a, c, b, uv, colour);
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

    // Fill the wedge on the OUTSIDE of the bend.
    //
    // Each segment is its own rectangle, square to its own direction, so at
    // every vertex the two rectangles overlap on the inside of the turn and
    // leave a wedge of nothing on the outside. This used to be patched with a
    // quad wound outer-prev, outer-next, inner-prev, inner-next — a bowtie,
    // correct for one turn direction and inside-out for the other, so half of
    // them were back-facing and culled. A road that keeps turning the same way
    // therefore gapped the whole way along its outer edge, which is why
    // roundabouts looked chewed.
    if (i < pts.length - 2) {
      const [x3, z3] = pts[i + 2];
      let ex = x3 - x2, ez = z3 - z2;
      const el = Math.hypot(ex, ez);
      if (el > 0.01) {
        ex /= el; ez /= el;
        const turn = dx * ez - dz * ex;          // sign says which way it bends
        if (Math.abs(turn) > 1e-4) {
          const s = turn > 0 ? -1 : 1;           // the outside of the bend
          flatTri(mb,
            [x2, y, z2],
            [x2 + (-dz * h) * s, y, z2 + (dx * h) * s],
            [x2 + (-ez * h) * s, y, z2 + (ex * h) * s],
            colour);
        }
      }
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

    // The kerb face has the same problem the surface had: each segment's side
    // is square to its own direction, so at a bend the outer face stops and the
    // next one starts somewhere else, leaving a slot straight through the kerb.
    // Around a roundabout that reads as a dashed line of holes. Close it with an
    // upright quad between the two faces, on the outside of the turn.
    if (i < pts.length - 2) {
      const [x3, z3] = pts[i + 2];
      let ex = x3 - x2, ez = z3 - z2;
      const el = Math.hypot(ex, ez);
      if (el > 0.01) {
        ex /= el; ez /= el;
        const turn = dx * ez - dz * ex;
        if (Math.abs(turn) > 1e-4) {
          const s = turn > 0 ? -1 : 1;
          const p1x = x2 + (-dz * h) * s, p1z = z2 + (dx * h) * s;
          const p2x = x2 + (-ez * h) * s, p2z = z2 + (ex * h) * s;
          const lo1 = [p1x, y - thick, p1z], lo2 = [p2x, y - thick, p2z];
          const hi1 = [p1x, y, p1z], hi2 = [p2x, y, p2z];
          const uv = [[0, 0], [0.3, 0], [0.3, 0.1], [0, 0.1]];
          if (s === 1) mb.quad(lo1, lo2, hi2, hi1, uv, sideColour);
          else mb.quad(lo2, lo1, hi1, hi2, uv, sideColour);
        }
      }
    }
  }
}
