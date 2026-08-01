// People walking around Clonskeagh.
//
// They are confined to a footpath graph built from the very same centrelines the
// pavements are drawn along, so nobody ever strolls across a garden or down the
// middle of the road. At a junction they pick another connected path; at a dead
// end they turn around.
import * as THREE from '../vendor/three.module.js';
import { offsetLine } from './meshbuilder.js';
import { createCharacter, animateWalk } from './player.js';

const PAVE_OFFSET = 0.95;        // matches world.js: kerb + half the 1.9 m slab
const JOIN_DIST = 9.0;           // how close two path ends must be to connect
const DRAW_RANGE = 190;          // hide people beyond this, to spare draw calls
const NEAR = 55;                 // recycled walkers reappear this far off, at least
const FOOT_LIFT = 0.095;         // sole height above the body origin, at scale 1

// A Dublin street's worth of coats, hair and skin tones.
const SKIN = [0xf0d0b4, 0xe8bfa0, 0xd9a983, 0xc08e63, 0x8d5a3b, 0x6b4230, 0x4a2f21];
const HAIRS = [0x2a1d14, 0x4a3524, 0x6b4a2a, 0x8d6a3a, 0xb08d54, 0x9a3b1e, 0x3a3a3a,
               0x151515, 0xd8d2c4];
const TOPS = [0xb8422f, 0x27496d, 0x2f5d3a, 0x6b2f5d, 0x1f1f24, 0xd4a017, 0x7d8a95,
              0xa8452f, 0x3f6f7d, 0xe0dcd2, 0x5b3a8c, 0x246b57];
const TROUSERS = [0x2b3a55, 0x24242a, 0x3f3f46, 0x5a4a38, 0x1d2a3a, 0x6b6455, 0x2f2f38];
const SHOES = [0x24242a, 0x3a2a1e, 0x1a1a1c, 0x6b6b70, 0xd8d8d4];

function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every walkable line: both pavements of each street, plus OSM footways. */
export function buildFootpaths(world) {
  const routes = [];
  for (const r of world.roads) {
    if (r.kind === 'service') continue;              // back lanes have no pavement
    const off = r.w / 2 + PAVE_OFFSET;
    for (const s of [1, -1]) routes.push(offsetLine(r.pts, off * s));
  }
  for (const p of world.paths) routes.push(p.pts.map((q) => [q[0], q[1]]));

  // measure them, and drop stubs too short to walk along
  const out = [];
  for (const pts of routes) {
    if (pts.length < 2) continue;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    if (cum[cum.length - 1] < 14) continue;
    out.push({ pts, cum, len: cum[cum.length - 1] });
  }
  return out;
}

/** Link path ends that meet, so walkers can turn corners. */
function linkEnds(routes) {
  const ends = [];
  routes.forEach((r, i) => {
    ends.push({ i, e: 0, x: r.pts[0][0], z: r.pts[0][1] });
    ends.push({ i, e: 1, x: r.pts[r.pts.length - 1][0], z: r.pts[r.pts.length - 1][1] });
  });
  const links = routes.map(() => [[], []]);
  for (let a = 0; a < ends.length; a++) {
    for (let b = a + 1; b < ends.length; b++) {
      if (ends[a].i === ends[b].i) continue;
      if (Math.hypot(ends[a].x - ends[b].x, ends[a].z - ends[b].z) > JOIN_DIST) continue;
      links[ends[a].i][ends[a].e].push([ends[b].i, ends[b].e]);
      links[ends[b].i][ends[b].e].push([ends[a].i, ends[a].e]);
    }
  }
  return links;
}

function pointAt(route, t) {
  const { pts, cum } = route;
  t = Math.max(0, Math.min(route.len, t));
  let lo = 0, hi = cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= t) lo = mid; else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const f = (t - cum[lo]) / seg;
  return [pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f,
          pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f];
}

export class Crowd {
  constructor(world, scene, count = 30, seed = 20260731) {
    this.routes = buildFootpaths(world);
    this.links = linkEnds(this.routes);
    this.people = [];
    if (!this.routes.length) return;

    const rnd = mulberry(seed);

    for (let i = 0; i < count; i++) {
      const look = {
        skin: SKIN[Math.floor(rnd() * SKIN.length)],
        hair: HAIRS[Math.floor(rnd() * HAIRS.length)],
        top: TOPS[Math.floor(rnd() * TOPS.length)],
        trousers: TROUSERS[Math.floor(rnd() * TROUSERS.length)],
        shoe: SHOES[Math.floor(rnd() * SHOES.length)],
        height: 0.86 + rnd() * 0.3,
        build: 0.88 + rnd() * 0.3,
      };
      const c = createCharacter(look);
      scene.add(c.group);

      const [ri, t0] = this.spot({ x: 0, z: 0 }, null, 5, 170) || [0, 0];
      this.people.push({
        c,
        route: ri,
        t: t0,
        dir: rnd() < 0.5 ? 1 : -1,
        speed: 0.85 + rnd() * 0.85,         // 0.85–1.7 m/s, a normal walk
        phase: rnd() * 6.283,
        yaw: 0,
        pause: 0,
        stuck: 0,
        height: look.height,
        rnd,
      });
    }
  }

  /**
   * A place on the footpath network in a ring around `at`. 30 people spread over
   * 20 km of pavement would leave the street empty within a minute, so walkers
   * who stray out of sight are brought back near you — behind you where we can,
   * so nobody materialises in front of your eyes.
   */
  spot(at, forward, minD, maxD) {
    let best = null, bestErr = Infinity;
    for (let k = 0; k < 26; k++) {
      const ri = Math.floor(Math.random() * this.routes.length);
      const t = Math.random() * this.routes[ri].len;
      const [x, z] = pointAt(this.routes[ri], t);
      const dx = x - at.x, dz = z - at.z;
      const d = Math.hypot(dx, dz);
      const inBand = d >= minD && d <= maxD;
      const behind = !forward || (dx * forward.x + dz * forward.z) / (d || 1) <= 0.2;
      if (inBand && (behind || k >= 20)) return [ri, t];
      const err = inBand ? 0 : (d < minD ? minD - d : d - maxD);
      if (err < bestErr) { bestErr = err; best = [ri, t]; }
    }
    return best;
  }

  update(dt, playerPos, forward = null) {
    for (const p of this.people) {
      // Out of sight, or standing still far too long? Put them back on a path
      // near the player. Only `count` people exist at any time — the rest of the
      // network is empty until you get there.
      const g = p.c.group.position;
      const away = Math.hypot(g.x - playerPos.x, g.z - playerPos.z);
      p.stuck = p.pause <= 0 && p.speed < 0.05 ? p.stuck + dt : 0;
      if (away > DRAW_RANGE + 40 || (p.stuck > 60 && away > NEAR)) {
        const s = this.spot(playerPos, forward, NEAR, DRAW_RANGE - 15);
        if (s) { p.route = s[0]; p.t = s[1]; p.pause = 0; p.stuck = 0; }
      }
      const route = this.routes[p.route];

      if (p.pause > 0) {
        p.pause -= dt;
      } else {
        p.t += p.dir * p.speed * dt;
        if (p.t <= 0 || p.t >= route.len) {
          const end = p.t <= 0 ? 0 : 1;
          const opts = this.links[p.route][end];
          if (opts.length && p.rnd() < 0.85) {
            const [j, ej] = opts[Math.floor(p.rnd() * opts.length)];
            p.route = j;
            p.t = ej === 0 ? 0 : this.routes[j].len;
            p.dir = ej === 0 ? 1 : -1;
          } else {
            p.dir *= -1;                    // dead end: turn round
            p.t = Math.max(0, Math.min(route.len, p.t));
          }
          if (p.rnd() < 0.12) p.pause = 0.6 + p.rnd() * 2.2;   // a moment's dawdle
        }
      }

      const r2 = this.routes[p.route];
      const [x, z] = pointAt(r2, p.t);
      const [ax, az] = pointAt(r2, p.t + p.dir * 1.2);
      const dx = ax - x, dz = az - z;
      if (dx || dz) {
        const want = Math.atan2(dx, dz);
        let d = want - p.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        p.yaw += d * Math.min(1, dt * 6);
      }

      const moving = p.pause <= 0;
      p.phase += (moving ? p.speed : 0) * dt * 2.4;
      animateWalk(p.c, p.phase, moving ? p.speed / 1.25 : 0);

      // stand on the pavement slab: the soles sit FOOT_LIFT above the body
      // origin, and that scales with the person's height
      p.c.group.position.set(x, 0.14 - FOOT_LIFT * p.height, z);
      p.c.group.rotation.y = p.yaw;
      const far = Math.hypot(x - playerPos.x, z - playerPos.z) > DRAW_RANGE;
      p.c.group.visible = !far;
    }
  }
}
