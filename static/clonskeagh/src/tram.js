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

/** Ballast, rails, platforms and stop signs. */
export function buildTramway(world, M, scene, colliders) {
  const tracks = (world.tramTrack || []).filter((t) => t && t.length > 1);
  if (!tracks.length) return null;
  const lines = tracks.map(measure);

  const ballastMat = new THREE.MeshStandardMaterial({ color: 0x5b5852, roughness: 1.0 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.35, metalness: 0.8 });
  const platMat = new THREE.MeshStandardMaterial({ color: 0xb0aca4, roughness: 0.9 });

  const bal = new MeshBuilder();
  for (const track of tracks) ribbon(bal, track, 3.4, 0.05, 4, 0xffffff);
  const ballast = bal.build(ballastMat);
  ballast.receiveShadow = true;
  ballast.castShadow = false;
  scene.add(ballast);

  const rails = new MeshBuilder();
  for (const track of tracks) {
    for (const s of [1, -1]) {
      ribbon(rails, offsetLine(track, (GAUGE / 2) * s), 0.14, 0.17, 2, 0xffffff);
    }
  }
  const railMesh = rails.build(railMat);
  railMesh.castShadow = false;
  scene.add(railMesh);

  // ---- stops: a platform each side of the alignment, plus a sign
  // each track gets its own list of stop positions along it
  const stopsPerLine = lines.map(() => []);
  for (const s of world.tramStops || []) {
    let yaw = 0, px = s.x, pz = s.z, placed = false;
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
      plat.position.set(px + ox, 0.17, pz + oz);
      plat.rotation.y = yaw;
      plat.receiveShadow = true;
      plat.castShadow = true;
      scene.add(plat);
      colliders.push({ x: px + ox, z: pz + oz, hx: 23, hz: 1.5, yaw: Math.PI / 2 - yaw });

      // a simple shelter
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.14, 9),
        new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.6, metalness: 0.4 }));
      roof.position.set(px + ox, 2.75, pz + oz);
      roof.rotation.y = yaw;
      roof.castShadow = true;
      scene.add(roof);
      for (const e of [-4, 4]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 8),
          new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.5, metalness: 0.5 }));
        post.position.set(px + ox - si * e, 1.4, pz + oz - co * e);
        scene.add(post);
      }
    }
  }
  for (const l of stopsPerLine) l.sort((a, b) => a.t - b.t);
  console.log(`luas: ${lines.length} tracks, `
    + lines.map((l) => `${l.len.toFixed(0)} m`).join(' + ')
    + `, stops: ${(world.tramStops || []).map((s) => s.name).join(', ')}`);
  return { lines, stopsPerLine };
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
      g.position.set(x, 0, z);
      g.rotation.y = Math.atan2(bx - ax, bz - az) + (this.dir > 0 ? 0 : Math.PI);
      if (Math.hypot(x - playerPos.x, z - playerPos.z) < 420) visible = true;
    }
    for (const g of this.sections) g.visible = visible;
  }
}
