// The Luas Green Line, which clips the west of the map between Milltown and
// Windy Arbour.
//
// The track is the real alignment: OSM splits it into a dozen short ways, which
// build_world.py chains end-to-end into one running line. The tram is an Alstom
// Citadis 502 — 54.7 m long, 2.4 m wide, silver, 100% low floor — so it is far
// too long to be one rigid box. It's built as seven sections strung along the
// track at fixed spacing, which makes it articulate through curves for free.
import * as THREE from '../vendor/three.module.js';
import { MeshBuilder, ribbon, offsetLine } from './meshbuilder.js';

const GAUGE = 1.435;
const SECTIONS = 7;
const SECTION_LEN = 7.6;              // 7 x 7.6 = 53 m, near enough a 502
const BODY_W = 2.4;
const BODY_H = 2.55;
const FLOOR = 0.35;                   // low floor, as built
const DWELL = 9.0;                    // seconds at a stop
const TOP_SPEED = 13.0;               // ~47 km/h on this stretch

// ---- bridges -------------------------------------------------------------
// The Green Line is carried over Taney Cross on the William Dargan Bridge, and
// over the Dodder on the Nine Arches. Both are tagged in OSM.
//
// Height is worked out ALONG each track, by arc length from the tagged span.
// The first attempt used straight-line distance to the span instead, and since
// the track runs on the same alignment as the bridge, points hundreds of metres
// beyond the end were still "near" it: 1,294m of track ended up in the air.
//
// Rail height is set by what passes underneath — a road wants better than 5m of
// headroom and the deck is 2.2m deep — and the ramp then follows from the 6%
// a tram can climb, a smoothstep peaking at 1.5x its mean.
// TURNED OFF. The span is in the right place — the tagged way really is over
// Taney Cross — but it does not read as a bridge in the world yet: the deck
// underside is a staircase of 4m boxes, the stays render near-black because
// they are too thin to catch light, and the 650m of embankment each side that
// flat terrain forces on us dominates everything around it. Parked rather than
// deleted: the bake still emits world.tramBridges, and flipping this back to
// true restores the lot.
const BRIDGES_ENABLED = false;

const DECK_Y = 9.0;
const RAMP = 230;
const ON_BRIDGE = 9.0;       // within this of a span centreline counts as on it

/** Distance from a point to a polyline. */
function distToLine(pts, x, z) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const vx = bx - ax, vz = bz - az;
    const L = vx * vx + vz * vz;
    const t = L < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L));
    const dd = Math.hypot(x - (ax + t * vx), z - (az + t * vz));
    if (dd < d) d = dd;
  }
  return d;
}

/**
 * Rail height at every point of one track.
 *
 * Full deck height where the track sits on a tagged span, then eased away over
 * RAMP metres MEASURED ALONG THE TRACK, which is the only measure that means
 * anything on an alignment that curves.
 */
function trackHeights(track, bridges) {
  const n = track.length;
  if (!BRIDGES_ENABLED) return new Float32Array(n);   // flat, as it was
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(track[i][0] - track[i - 1][0], track[i][1] - track[i - 1][1]);
  }
  // which points are actually on a span, and how high that span is
  const onSpan = [];
  for (let i = 0; i < n; i++) {
    let best = 0;
    for (const b of bridges) {
      if (distToLine(b.pts, track[i][0], track[i][1]) <= ON_BRIDGE) {
        const y = b.kind === 'viaduct' ? DECK_Y * 0.8 : DECK_Y;
        if (y > best) best = y;
      }
    }
    if (best > 0) onSpan.push([cum[i], best]);
  }
  const h = new Float32Array(n);
  if (!onSpan.length) return h;
  for (let i = 0; i < n; i++) {
    let best = 0;
    for (const [s, y] of onSpan) {
      const gap = Math.abs(cum[i] - s);
      let f = 0;
      if (gap <= 0.5) f = 1;
      else if (gap < RAMP) { const u = 1 - gap / RAMP; f = u * u * (3 - 2 * u); }
      if (y * f > best) best = y * f;
    }
    h[i] = best;
  }
  return h;
}

/** Height partway along a track, from its profile. */
function heightAt(track, heights, t) {
  let acc = 0;
  for (let i = 0; i < track.length - 1; i++) {
    const seg = Math.hypot(track[i + 1][0] - track[i][0], track[i + 1][1] - track[i][1]);
    if (acc + seg >= t) {
      const f = seg < 1e-9 ? 0 : (t - acc) / seg;
      return heights[i] + (heights[i + 1] - heights[i]) * f;
    }
    acc += seg;
  }
  return heights[heights.length - 1];
}

/** A ribbon whose height follows a per-point profile. */
function ribbonProfile(mb, pts, heights, width, lift, uvScale, colour) {
  const h = width / 2;
  let run = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    let dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    dx /= len; dz /= len;
    const nx = -dz * h, nz = dx * h;
    const y1 = heights[i] + lift, y2 = heights[i + 1] + lift;
    const u0 = run / uvScale, u1 = (run + len) / uvScale, v = width / uvScale;
    mb.quad([x1 + nx, y1, z1 + nz], [x2 + nx, y2, z2 + nz],
            [x2 - nx, y2, z2 - nz], [x1 - nx, y1, z1 - nz],
            [[u0, 0], [u1, 0], [u1, v], [u0, v]], colour);
    run += len;
  }
}

function measure(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { pts, cum, len: cum[cum.length - 1] };
}

function pointAt(line, t) {
  const { pts, cum } = line;
  t = Math.max(0, Math.min(line.len, t));
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

/**
 * The William Dargan Bridge, and the deck under any other tram bridge.
 *
 * Built to the real thing: a single inverted-Y pylon 50m tall, carrying 13 pairs
 * of stay cables down to a curved deck. The published spans are 21.5, 108.5, 18
 * and 14 metres, so the pylon stands 21.5m in from the short end and the fan
 * reaches out over the 108.5m main span — which is why it looks lopsided, and
 * should.
 *
 * The other tagged bridge on this line is the Nine Arches over the Dodder, which
 * is a masonry viaduct and gets piers rather than a pylon.
 */
function buildTramBridges(bridges, tracks, profiles, scene) {
  if (!BRIDGES_ENABLED || !bridges.length) return;
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xb9b7b0, roughness: 0.85 });
  const pylonMat = new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.7 });
  const cableMat = new THREE.MeshStandardMaterial({
    color: 0x8d9298, roughness: 0.4, metalness: 0.7 });
  const deck = new MeshBuilder();

  // Everything the track is raised on gets carried, not just the tagged span.
  // Without this the approaches were 1,294m of rail hanging in mid-air, which is
  // what made the whole thing read as broken rather than as a bridge. The Luas
  // really does climb to Taney Cross on embankment, so a retained bank is both
  // the cheap fix and the right one.
  tracks.forEach((track, ti) => {
    const hs = profiles[ti];
    for (let i = 0; i < track.length - 1; i++) {
      const h = (hs[i] + hs[i + 1]) / 2;
      if (h < 0.35) continue;
      const [x1, z1] = track[i], [x2, z2] = track[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.01) continue;
      const onSpan = bridges.some((b) => distToLine(b.pts, (x1 + x2) / 2, (z1 + z2) / 2) <= ON_BRIDGE);
      if (onSpan) continue;                 // the span itself gets a proper deck
      const yaw = Math.atan2(z2 - z1, x2 - x1);
      // a bank that widens as it gets taller, like a real embankment
      deck.box((x1 + x2) / 2, 0, (z1 + z2) / 2,
               len / 2 + 0.1, h, 3.1 + h * 0.42, yaw, 6, 0xa8a49b);
    }
  });

  for (const b of bridges) {
    const pts = b.pts;
    // cumulative length, so positions along the span can be found
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const total = cum[cum.length - 1];
    const at = (d) => {
      d = Math.max(0, Math.min(total, d));
      let i = 0;
      while (i < cum.length - 2 && cum[i + 1] < d) i++;
      const f = (d - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
              pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
    };
    const dirAt = (d) => {
      const [ax, az] = at(Math.max(0, d - 2)), [bx, bz] = at(Math.min(total, d + 2));
      const L = Math.hypot(bx - ax, bz - az) || 1;
      return [(bx - ax) / L, (bz - az) / L];
    };
    const y = b.kind === 'viaduct' ? DECK_Y * 0.8 : DECK_Y;

    // the deck: a box beam under the rails, following the curve
    const STEP = 4;
    for (let d = 0; d < total; d += STEP) {
      const [x1, z1] = at(d), [x2, z2] = at(Math.min(total, d + STEP));
      const [dx, dz] = dirAt(d + STEP / 2);
      const nx = -dz, nz = dx;
      const W = 7.2;
      const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
      const len = Math.hypot(x2 - x1, z2 - z1) + 0.15;
      deck.box(cx, y - 1.2, cz, len / 2, 1.0, W / 2,
               Math.atan2(dz, dx), 6, 0xffffff);
      // parapet each side
      for (const sgn of [1, -1]) {
        deck.box(cx + nx * sgn * (W / 2 - 0.2), y - 0.05, cz + nz * sgn * (W / 2 - 0.2),
                 len / 2, 0.55, 0.18, Math.atan2(dz, dx), 4, 0xdedcd6);
      }
    }

    // piers, at the span points where the real bridge has them
    const spans = b.kind === 'viaduct'
      ? Array.from({ length: Math.round(total / 18) }, (_, i) => (i + 0.5) * (total / Math.round(total / 18)))
      : [0.5, total - 14, total - 32];
    for (const d of spans) {
      const [x, z] = at(d);
      deck.box(x, (y - 2.2) / 2, z, 1.5, (y - 2.2) / 2, 2.2, 0, 5, 0xc9c6bf);
    }

    if (b.kind === 'viaduct') continue;

    // ---- the pylon, and the fan of stays
    const PY = 50;                       // the real one, to the tip
    const pd = 21.5;                     // the short span: where it stands
    const [px, pz] = at(pd);
    const [tx, tz] = dirAt(pd);
    const nx = -tz, nz = tx;             // across the deck

    const legGeo = new THREE.CylinderGeometry(0.55, 1.0, 26, 10);
    for (const sgn of [1, -1]) {
      const leg = new THREE.Mesh(legGeo, pylonMat);
      leg.position.set(px + nx * sgn * 3.1, 13, pz + nz * sgn * 3.1);
      // the legs lean in to meet: that is the Y
      leg.rotation.z = -sgn * 0.12;
      leg.castShadow = true;
      scene.add(leg);
    }
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, PY - 24, 10), pylonMat);
    stem.position.set(px, 24 + (PY - 24) / 2, pz);
    stem.castShadow = true;
    scene.add(stem);

    // 13 pairs of stays, fanning out over the main span
    const PAIRS = 13;
    const cableGeo = new THREE.CylinderGeometry(0.055, 0.055, 1, 5);
    for (let i = 0; i < PAIRS; i++) {
      const f = (i + 1) / (PAIRS + 0.5);
      const anchorD = pd + f * 108.5;                 // out along the main span
      const topY = PY - 2 - i * ((PY - 26) / PAIRS);  // down the stem, top stay highest
      const [ax, az] = at(anchorD);
      for (const sgn of [1, -1]) {
        const bx = ax + nx * sgn * 2.6, bz = az + nz * sgn * 2.6;
        const dx = bx - px, dy = y - topY, dz2 = bz - pz;
        const L = Math.hypot(dx, dy, dz2);
        const c = new THREE.Mesh(cableGeo, cableMat);
        c.position.set((px + bx) / 2, (topY + y) / 2, (pz + bz) / 2);
        c.scale.set(1, L, 1);
        c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(dx / L, dy / L, dz2 / L));
        c.castShadow = true;
        scene.add(c);
      }
    }
  }
  const m = deck.build(deckMat);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}

/** Ballast, rails, platforms and stop signs. */
export function buildTramway(world, M, scene, colliders) {
  const tracks = (world.tramTrack || []).filter((t) => t && t.length > 1);
  if (!tracks.length) return null;
  const lines = tracks.map(measure);

  const ballastMat = new THREE.MeshStandardMaterial({ color: 0x5b5852, roughness: 1.0 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.35, metalness: 0.8 });
  const platMat = new THREE.MeshStandardMaterial({ color: 0xb0aca4, roughness: 0.9 });

  const bridges = (world.tramBridges || []).filter((b) => b && b.pts && b.pts.length > 1);
  const profiles = tracks.map((t) => trackHeights(t, bridges));

  const bal = new MeshBuilder();
  tracks.forEach((track, i) => ribbonProfile(bal, track, profiles[i], 3.4, 0.05, 4, 0xffffff));
  const ballast = bal.build(ballastMat);
  ballast.receiveShadow = true;
  ballast.castShadow = false;
  scene.add(ballast);

  const rails = new MeshBuilder();
  tracks.forEach((track, i) => {
    for (const s of [1, -1]) {
      // the offset line has the same point count, so it shares the profile
      ribbonProfile(rails, offsetLine(track, (GAUGE / 2) * s), profiles[i], 0.14, 0.17, 2, 0xffffff);
    }
  });
  const railMesh = rails.build(railMat);
  railMesh.castShadow = false;
  scene.add(railMesh);

  buildTramBridges(bridges, tracks, profiles, scene);

  // ---- stops: a platform each side of the alignment, plus a sign
  // each track gets its own list of stop positions along it
  const stopsPerLine = lines.map(() => []);
  for (const s of world.tramStops || []) {
    let yaw = 0, px = s.x, pz = s.z, placed = false;
    let atLine = 0, atT = 0;          // which track, and where along it
    lines.forEach((line, li) => {
      let best = 0, bd = Infinity;
      for (let t = 0; t <= line.len; t += 2) {
        const [x, z] = pointAt(line, t);
        const d = Math.hypot(x - s.x, z - s.z);
        if (d < bd) { bd = d; best = t; }
      }
      if (bd > 60) return;
      stopsPerLine[li].push({ name: s.name, t: best });
      if (!placed) {
        placed = true;
        atLine = li; atT = best;
        [px, pz] = pointAt(line, best);
        const [ax, az] = pointAt(line, Math.max(0, best - 5));
        const [bx, bz] = pointAt(line, Math.min(line.len, best + 5));
        yaw = Math.atan2(bx - ax, bz - az);
      }
    });
    if (!placed) continue;

    const co = Math.cos(yaw), si = Math.sin(yaw);
    for (const side of [1, -1]) {
      const ox = co * 3.3 * side, oz = -si * 3.3 * side;
      const plat = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.34, 46), platMat);
      const platY = heightAt(tracks[atLine], profiles[atLine], atT);
      plat.position.set(px + ox, 0.17 + platY, pz + oz);
      plat.rotation.y = yaw;
      plat.receiveShadow = true;
      plat.castShadow = true;
      scene.add(plat);
      colliders.push({ x: px + ox, z: pz + oz, hx: 23, hz: 1.5, yaw: Math.PI / 2 - yaw });

      // a simple shelter
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.14, 9),
        new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.6, metalness: 0.4 }));
      roof.position.set(px + ox, 2.75 + platY, pz + oz);
      roof.rotation.y = yaw;
      roof.castShadow = true;
      scene.add(roof);
      for (const e of [-4, 4]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 8),
          new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.5, metalness: 0.5 }));
        post.position.set(px + ox - si * e, 1.4 + platY, pz + oz - co * e);
        scene.add(post);
      }
    }
  }
  for (const l of stopsPerLine) l.sort((a, b) => a.t - b.t);
  console.log(`luas: ${lines.length} tracks, `
    + lines.map((l) => `${l.len.toFixed(0)} m`).join(' + ')
    + `, stops: ${(world.tramStops || []).map((s) => s.name).join(', ')}`);
  return { lines, stopsPerLine, bridges, tracks, profiles };
}

/** One articulated section of the tram. */
function makeSection(nose) {
  const g = new THREE.Group();
  const silver = new THREE.MeshStandardMaterial({
    color: 0xc9ced2, roughness: 0.35, metalness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x1d262c, roughness: 0.07, metalness: 0.6, envMapIntensity: 2.0 });
  const skirt = new THREE.MeshStandardMaterial({ color: 0x4a5054, roughness: 0.7 });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(BODY_W, BODY_H - 0.5, SECTION_LEN - 0.35), silver);
  body.position.y = FLOOR + (BODY_H - 0.5) / 2;
  body.castShadow = true;
  g.add(body);

  // continuous glazing band, the thing that makes a modern tram read as one
  const win = new THREE.Mesh(
    new THREE.BoxGeometry(BODY_W + 0.03, 1.05, SECTION_LEN - 0.85), glass);
  win.position.y = FLOOR + 1.55;
  g.add(win);

  const sk = new THREE.Mesh(new THREE.BoxGeometry(BODY_W - 0.12, FLOOR + 0.1, SECTION_LEN - 0.5), skirt);
  sk.position.y = (FLOOR + 0.1) / 2;
  g.add(sk);

  // roof fairing
  const roof = new THREE.Mesh(new THREE.BoxGeometry(BODY_W - 0.5, 0.34, SECTION_LEN - 1.4),
    new THREE.MeshStandardMaterial({ color: 0x9fa5a9, roughness: 0.6 }));
  roof.position.y = FLOOR + BODY_H - 0.32;
  g.add(roof);

  if (nose) {
    // raked cab front and a windscreen
    const cab = new THREE.Mesh(new THREE.BoxGeometry(BODY_W - 0.22, 1.5, 0.5), silver);
    cab.position.set(0, FLOOR + 0.95, (SECTION_LEN - 0.35) / 2 * nose);
    g.add(cab);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(BODY_W - 0.42, 0.95, 0.12), glass);
    screen.position.set(0, FLOOR + 1.55, ((SECTION_LEN - 0.35) / 2 + 0.22) * nose);
    g.add(screen);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(BODY_W - 0.8, 0.16, 0.1),
      new THREE.MeshStandardMaterial({
        color: 0xfff6e0, emissive: 0xffedc0, emissiveIntensity: 0.5, roughness: 0.3 }));
    lamp.position.set(0, FLOOR + 0.55, ((SECTION_LEN - 0.35) / 2 + 0.24) * nose);
    g.add(lamp);
  }
  return g;
}

export class Tram {
  constructor(tramway, scene, index = 0, dir = 1) {
    this.line = tramway.lines[index % tramway.lines.length];
    this.stops = tramway.stopsPerLine[index % tramway.lines.length];
    // the tram has to climb with the track, or it drives through the bridge
    const li = index % tramway.lines.length;
    this.track = tramway.tracks[li];
    this.profile = tramway.profiles[li];
    this.sections = [];
    for (let i = 0; i < SECTIONS; i++) {
      const g = makeSection(i === 0 ? 1 : i === SECTIONS - 1 ? -1 : 0);
      scene.add(g);
      this.sections.push(g);
    }
    // start it at the first stop, heading up the line
    const half = SECTION_LEN * SECTIONS;
    this.dir = dir;
    this.t = this.stops.length
      ? this.stops[dir > 0 ? 0 : this.stops.length - 1].t
      : Math.max(half, Math.min(this.line.len - half, this.line.len / 2));
    this.t = Math.max(half, Math.min(this.line.len - half, this.t));
    this.speed = 0;
    this.wait = 2;
    this.target = null;
    this._nextStop();
  }

  _nextStop() {
    const ahead = this.stops
      .filter((s) => (this.dir > 0 ? s.t > this.t + 12 : s.t < this.t - 12))
      .sort((a, b) => (this.dir > 0 ? a.t - b.t : b.t - a.t));
    this.target = ahead.length ? ahead[0] : null;
  }

  update(dt, playerPos) {
    const L = this.line;
    const half = SECTION_LEN * SECTIONS;          // keep the whole tram on the line

    if (this.wait > 0) {
      this.wait -= dt;
      this.speed = 0;
    } else {
      // slow for the next stop, and for the end of the line
      const stopDist = this.target
        ? Math.abs(this.target.t - this.t)
        : (this.dir > 0 ? L.len - half - this.t : this.t - half);
      const want = Math.min(TOP_SPEED, Math.max(1.2, Math.sqrt(Math.max(0, stopDist) * 2 * 0.9)));
      this.speed += (want - this.speed) * Math.min(1, dt * 0.9);
      this.t += this.dir * this.speed * dt;

      if (this.target && Math.abs(this.t - this.target.t) < 1.5) {
        this.t = this.target.t;
        this.wait = DWELL;
        this._nextStop();
      } else if (!this.target && (this.t > L.len - half || this.t < half)) {
        this.t = Math.max(half, Math.min(L.len - half, this.t));
        this.dir *= -1;                            // terminus: change ends
        this.wait = DWELL * 1.6;
        this._nextStop();
      }
    }

    // string the sections along the line behind the leading end
    let visible = false;
    for (let i = 0; i < SECTIONS; i++) {
      const st = this.t - this.dir * (i - (SECTIONS - 1) / 2) * SECTION_LEN;
      const [x, z] = pointAt(L, st);
      const [ax, az] = pointAt(L, st - 2);
      const [bx, bz] = pointAt(L, st + 2);
      const g = this.sections[i];
      g.position.set(x, heightAt(this.track, this.profile, st), z);
      g.rotation.y = Math.atan2(bx - ax, bz - az) + (this.dir > 0 ? 0 : Math.PI);
      if (Math.hypot(x - playerPos.x, z - playerPos.z) < 420) visible = true;
    }
    for (const g of this.sections) g.visible = visible;
  }
}
