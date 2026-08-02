// Procedural canvas textures. Everything is generated at load time so the game
// ships as pure static files — no image downloads, no keys, no CDN.
import * as THREE from '../vendor/three.module.js';

// `scale` renders the same drawing into a bigger bitmap. Canvas shapes are
// vector operations, so this genuinely sharpens edges and curves rather than
// enlarging a small image — the texture functions below keep their original
// coordinates and get twice the resolution for free.
function canvas(size = 256, scale = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size * scale;
  const x = c.getContext('2d');
  if (scale !== 1) x.scale(scale, scale);
  return [c, x];
}

function tex(c, repeat = 1, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Derive a normal map from a colour texture, treating brightness as height.
 *  Not physically right — mortar isn't dark because it is low — but for brick,
 *  render and tarmac the two line up well enough that the surface stops
 *  looking like a photograph pasted onto a flat plane. Costs one texture fetch
 *  per pixel and no extra draw calls. */
function normalTexture(src, strength = 2.0) {
  const s = src.width;
  const [c, x] = canvas(s);
  const px = src.getContext('2d').getImageData(0, 0, s, s).data;

  // Luminance once per texel rather than four times — this runs during the
  // loading screen and every millisecond here is a millisecond of black screen.
  const h = new Float32Array(s * s);
  for (let i = 0, j = 0; j < h.length; i += 4, j++) {
    h[j] = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
  }

  const out = x.createImageData(s, s);
  const d = out.data;
  // Every texture here is a power of two, so wrapping is a mask rather than
  // two modulos. Fall back if that ever stops being true.
  const pow2 = (s & (s - 1)) === 0;
  const m = s - 1;
  const wrap = pow2 ? (v) => v & m : (v) => ((v % s) + s) % s;

  for (let y = 0; y < s; y++) {
    const row = y * s, up = wrap(y - 1) * s, dn = wrap(y + 1) * s;
    for (let ix = 0; ix < s; ix++) {
      const dx = (h[row + wrap(ix - 1)] - h[row + wrap(ix + 1)]) * strength;
      const dy = (h[up + ix] - h[dn + ix]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (row + ix) * 4;
      d[i]     = (dx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  x.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  // A normal map is data, not colour — tone mapping it would be wrong.
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Colour map plus a normal map derived from it, sharing one source canvas. */
function surface(src, scale = 1.0, strength = 2.0) {
  return { map: tex(src, 1), normalMap: normalTexture(src, strength),
           normalScale: new THREE.Vector2(scale, scale) };
}

// deterministic noise so every reload looks identical
let seed = 1337;
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function jitter(base, amt) {
  const [r, g, b] = base;
  const d = (rnd() - 0.5) * amt;
  return `rgb(${Math.round(r + d)},${Math.round(g + d)},${Math.round(b + d)})`;
}

/** Dublin redbrick: english garden wall bond, 215x65mm bricks, 10mm mortar.
 *  `base` retints it — the mosque is buff brick, not red. */
function brickTexture(base = [141, 68, 48], mortar = '#b9ad97') {
  const [c, x] = canvas(512);
  x.fillStyle = mortar;
  x.fillRect(0, 0, 512, 512);
  const bw = 64, bh = 21;                        // ~ 1 tile = 1.7m of wall
  for (let row = 0, y = 0; y < 512; row++, y += bh) {
    const off = (row % 2) * (bw / 2);
    for (let bx = -bw; bx < 512 + bw; bx += bw) {
      x.fillStyle = jitter(base, 46);
      x.fillRect(bx + off + 1.2, y + 1.2, bw - 2.4, bh - 2.4);
      // slight top-light on each brick
      x.fillStyle = 'rgba(255,235,220,0.10)';
      x.fillRect(bx + off + 1.2, y + 1.2, bw - 2.4, 2);
    }
  }
  // soot / weathering wash
  for (let i = 0; i < 240; i++) {
    x.fillStyle = `rgba(60,40,30,${rnd() * 0.05})`;
    const r = 20 + rnd() * 70;
    x.beginPath(); x.arc(rnd() * 512, rnd() * 512, r, 0, 7); x.fill();
  }
  return c;
}

/** Pebbledash — the other half of every Dublin suburb. */
function pebbledashTexture() {
  const [c, x] = canvas(256, 2);
  x.fillStyle = '#cabfa9';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const g = 150 + rnd() * 90;
    x.fillStyle = `rgba(${g},${g - 8},${g - 24},${0.35 + rnd() * 0.5})`;
    x.beginPath(); x.arc(rnd() * 256, rnd() * 256, 0.7 + rnd() * 1.5, 0, 7); x.fill();
  }
  for (let i = 0; i < 60; i++) {
    x.fillStyle = `rgba(120,110,95,${rnd() * 0.06})`;
    x.beginPath(); x.arc(rnd() * 256, rnd() * 256, 15 + rnd() * 45, 0, 7); x.fill();
  }
  return c;
}

/** Smooth painted render (cream / grey / soft green houses). */
function renderTexture() {
  const [c, x] = canvas(256, 2);
  x.fillStyle = '#e8e2d6';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    x.fillStyle = `rgba(190,185,175,${rnd() * 0.28})`;
    x.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  for (let i = 0; i < 30; i++) {                 // damp staining near the base
    x.fillStyle = `rgba(150,150,140,${rnd() * 0.05})`;
    x.beginPath(); x.arc(rnd() * 256, 200 + rnd() * 56, 10 + rnd() * 40, 0, 7); x.fill();
  }
  return c;
}

/** Slate/tile roof, laid in courses. */
function roofTexture() {
  const [c, x] = canvas(256, 2);
  x.fillStyle = '#3c4349';
  x.fillRect(0, 0, 256, 256);
  const tw = 26, th = 15;
  for (let row = 0, y = 0; y < 256 + th; row++, y += th) {
    const off = (row % 2) * (tw / 2);
    for (let bx = -tw; bx < 256 + tw; bx += tw) {
      x.fillStyle = jitter([74, 82, 90], 34);
      x.beginPath();
      x.roundRect(bx + off + 0.8, y + 0.8, tw - 1.6, th * 1.55, 2);
      x.fill();
      x.fillStyle = 'rgba(0,0,0,0.22)';          // shadow under the lap
      x.fillRect(bx + off + 0.8, y + th * 1.55 - 2, tw - 1.6, 2);
    }
  }
  return c;
}

/** Coursed rubble limestone — deep blue-grey, irregular blocks, as at Dundrum. */
function limestoneTexture() {
  const [c, x] = canvas(512);
  x.fillStyle = '#6f7378';                       // lime mortar, weathered
  x.fillRect(0, 0, 512, 512);
  const ch = 30;                                 // course height
  for (let row = 0, y = 0; y < 512 + ch; row++, y += ch) {
    let bx = -40 - rnd() * 40;
    while (bx < 512) {
      const bw = 26 + rnd() * 46;                // rubble: uneven lengths
      x.fillStyle = jitter([58, 68, 80], 34);
      x.beginPath();
      x.roundRect(bx + 1.5, y + 1.5, bw - 3, ch - 3, 1.5);
      x.fill();
      x.fillStyle = 'rgba(200,215,230,0.07)';    // light catching the top arris
      x.fillRect(bx + 1.5, y + 1.5, bw - 3, 1.6);
      bx += bw;
    }
  }
  for (let i = 0; i < 180; i++) {                // damp and lichen
    x.fillStyle = `rgba(${40 + rnd() * 60},${60 + rnd() * 50},${50 + rnd() * 40},${rnd() * 0.07})`;
    x.beginPath(); x.arc(rnd() * 512, rnd() * 512, 14 + rnd() * 60, 0, 7); x.fill();
  }
  return c;
}

/** Cut granite — silver-grey, fine speckle, for quoins and dressings. */
function graniteTexture() {
  const [c, x] = canvas(256, 2);
  x.fillStyle = '#b9b6ae';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 12000; i++) {
    const g = 130 + rnd() * 110;
    x.fillStyle = `rgba(${g},${g - 3},${g - 10},${0.25 + rnd() * 0.45})`;
    x.fillRect(rnd() * 256, rnd() * 256, 1 + rnd(), 1 + rnd());
  }
  for (let i = 0; i < 700; i++) {                // darker mineral flecks
    x.fillStyle = `rgba(${50 + rnd() * 40},${50 + rnd() * 40},${55 + rnd() * 40},0.5)`;
    x.fillRect(rnd() * 256, rnd() * 256, 1.5, 1.5);
  }
  return c;
}

/** Asphalt with grit. */
function roadTexture() {
  const [c, x] = canvas(256, 2);
  x.fillStyle = '#3a3a3c';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14000; i++) {
    const g = 40 + rnd() * 70;
    x.fillStyle = `rgba(${g},${g},${g + 4},${rnd() * 0.55})`;
    x.fillRect(rnd() * 256, rnd() * 256, 1, 1);
  }
  for (let i = 0; i < 16; i++) {                 // patches & repairs, kept subtle —
    x.fillStyle = `rgba(${30 + rnd() * 30},${30 + rnd() * 30},${34 + rnd() * 30},0.08)`;
    x.beginPath(); x.arc(rnd() * 256, rnd() * 256, 8 + rnd() * 26, 0, 7); x.fill();
  }
  return c;
}

/** Concrete pavement slabs. */
function pavementTexture() {
  const [c, x] = canvas(256, 2);
  x.fillStyle = '#9a988f';
  x.fillRect(0, 0, 256, 256);
  const s = 64;
  for (let y = 0; y < 256; y += s) {
    for (let px = 0; px < 256; px += s) {
      x.fillStyle = jitter([160, 158, 150], 22);
      x.fillRect(px + 1.5, y + 1.5, s - 3, s - 3);
    }
  }
  for (let i = 0; i < 5000; i++) {
    x.fillStyle = `rgba(110,110,105,${rnd() * 0.2})`;
    x.fillRect(rnd() * 256, rnd() * 256, 1, 1);
  }
  return c;
}

/** Grass — front gardens and the greens. */
/** Clipped hedge: dense small leaves, dark gaps where the light doesn't reach. */
function hedgeTexture() {
  const [c, x] = canvas(256, 2);
  x.fillStyle = '#1e2e18';                       // shadow deep inside the hedge
  x.fillRect(0, 0, 256, 256);
  // leaves, dark ones first so the bright ones read as the outer surface
  for (const [n, lo, hi, a] of [[7000, 40, 70, 0.55], [6000, 60, 105, 0.7], [3000, 95, 150, 0.8]]) {
    for (let i = 0; i < n; i++) {
      const g = lo + rnd() * (hi - lo);
      x.fillStyle = `rgba(${Math.round(g * 0.55)},${Math.round(g)},${Math.round(g * 0.42)},${a})`;
      const px = rnd() * 256, py = rnd() * 256;
      const r = 1.1 + rnd() * 2.2, rot = rnd() * 3.14;
      x.save(); x.translate(px, py); x.rotate(rot);
      x.beginPath(); x.ellipse(0, 0, r, r * 0.55, 0, 0, 7); x.fill();
      x.restore();
    }
  }
  // clumping, so it isn't a uniform fuzz
  for (let i = 0; i < 70; i++) {
    x.fillStyle = `rgba(20,34,16,${rnd() * 0.30})`;
    x.beginPath(); x.arc(rnd() * 256, rnd() * 256, 8 + rnd() * 26, 0, 7); x.fill();
  }
  return c;
}

/** Raked bunker sand — pale, warm, faintly banded. */
function sandTexture() {
  const [c, x] = canvas(256, 2);
  x.fillStyle = '#d8c9a4';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {              // grain
    const g = 190 + rnd() * 55;
    x.fillStyle = `rgba(${Math.round(g)},${Math.round(g * 0.93)},${Math.round(g * 0.74)},${0.3 + rnd() * 0.4})`;
    x.fillRect(rnd() * 256, rnd() * 256, 1 + rnd(), 1 + rnd());
  }
  for (let i = 0; i < 26; i++) {                // rake lines
    x.strokeStyle = `rgba(150,133,102,${0.05 + rnd() * 0.06})`;
    x.lineWidth = 1.2;
    const y = rnd() * 256;
    x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(80, y + 6, 170, y - 6, 256, y); x.stroke();
  }
  for (let i = 0; i < 22; i++) {                // damp patches
    x.fillStyle = `rgba(160,144,112,${rnd() * 0.10})`;
    x.beginPath(); x.arc(rnd() * 256, rnd() * 256, 10 + rnd() * 34, 0, 7); x.fill();
  }
  return c;
}

/** Putting green — tight turf, faint mowing stripes. */
function greenTexture() {
  const [c, x] = canvas(256, 2);
  x.fillStyle = '#3f7a35';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 14000; i++) {
    const g = 105 + rnd() * 55;
    x.fillStyle = `rgba(${Math.round(g * 0.5)},${Math.round(g)},${Math.round(g * 0.42)},${0.25 + rnd() * 0.4})`;
    x.fillRect(rnd() * 256, rnd() * 256, 1, 1 + rnd());
  }
  for (let i = 0; i < 16; i++) {                // mower stripes
    x.fillStyle = `rgba(255,255,255,${0.018 + rnd() * 0.012})`;
    x.fillRect(0, i * 16 + rnd() * 3, 256, 8);
  }
  return c;
}

function grassTexture() {
  const [c, x] = canvas(256, 2);
  x.fillStyle = '#4d7a3a';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 16000; i++) {
    const g = 90 + rnd() * 80;
    x.strokeStyle = `rgba(${40 + rnd() * 40},${g},${40 + rnd() * 30},${0.25 + rnd() * 0.5})`;
    x.lineWidth = 1;
    const px = rnd() * 256, py = rnd() * 256;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + (rnd() - 0.5) * 3, py - 2 - rnd() * 3); x.stroke();
  }
  for (let i = 0; i < 40; i++) {
    x.fillStyle = `rgba(50,80,40,${rnd() * 0.18})`;
    x.beginPath(); x.arc(rnd() * 256, rnd() * 256, 12 + rnd() * 40, 0, 7); x.fill();
  }
  return c;
}

export function buildMaterials() {
  seed = 1337;
  const wallOpts = { roughness: 0.94, metalness: 0.0, vertexColors: true };

  const M = {
    // The normal-map strengths are set per surface: brick and slate have real
    // relief, painted render is nearly flat, and grass would read as noise if
    // it were lit as bumps.
    redbrick: new THREE.MeshStandardMaterial({ ...surface(brickTexture(), 0.9, 2.4), ...wallOpts }),
    pebbledash: new THREE.MeshStandardMaterial({ ...surface(pebbledashTexture(), 1.1, 3.0), ...wallOpts }),
    render: new THREE.MeshStandardMaterial({ ...surface(renderTexture(), 0.35, 1.2), ...wallOpts }),
    stone: new THREE.MeshStandardMaterial({ ...surface(pebbledashTexture(), 1.0, 2.6), color: 0xb9b2a3, ...wallOpts }),
    // buff brick — the ICCI is brick infill, not stone
    brickBuff: new THREE.MeshStandardMaterial({
      ...surface(brickTexture([196, 172, 133], '#cdc3ad'), 0.9, 2.4), ...wallOpts }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb6bcc0, roughness: 0.28, metalness: 0.8 }),
    // the former Central Mental Hospital: blue limestone with granite dressings
    limestone: new THREE.MeshStandardMaterial({ ...surface(limestoneTexture(), 1.0, 2.8), ...wallOpts }),
    granite: new THREE.MeshStandardMaterial({ ...surface(graniteTexture(), 0.5, 1.6), ...wallOpts }),
    roof: new THREE.MeshStandardMaterial({ ...surface(roofTexture(), 0.9, 2.6), roughness: 0.86, vertexColors: true }),
    road: new THREE.MeshStandardMaterial({ ...surface(roadTexture(), 0.6, 1.8), roughness: 0.97, vertexColors: true }),
    pavement: new THREE.MeshStandardMaterial({ ...surface(pavementTexture(), 0.7, 2.0), roughness: 0.95, vertexColors: true }),
    sand: new THREE.MeshStandardMaterial({
      ...surface(sandTexture(), 0.8, 2.2), roughness: 1.0, vertexColors: true }),
    putting: new THREE.MeshStandardMaterial({
      ...surface(greenTexture(), 0.5, 1.4), roughness: 1.0, vertexColors: true }),
    grass: new THREE.MeshStandardMaterial({ map: tex(grassTexture(), 1), roughness: 1.0, vertexColors: true }),
    // scene.environment gives these something to reflect; without it they read
    // as black holes in the wall
    glass: new THREE.MeshStandardMaterial({
      color: 0x93a9bb, roughness: 0.06, metalness: 0.5, envMapIntensity: 2.2,
      emissive: 0x1b2836, emissiveIntensity: 1.0, vertexColors: true,
    }),
    trim: new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6, vertexColors: true }),
    door: new THREE.MeshStandardMaterial({ roughness: 0.5, vertexColors: true }),
    // verdigris — the Church of the Miraculous Medal's copper domes
    copper: new THREE.MeshStandardMaterial({ color: 0x54b39a, roughness: 0.52, metalness: 0.35 }),
    lead: new THREE.MeshStandardMaterial({ color: 0x6d7b74, roughness: 0.62, metalness: 0.3 }),
    // same trap as `leaf` below: the hedges are instanced boxes coloured with
    // setColorAt, and a plain BoxGeometry carries no colour attribute — asking
    // for vertexColors here renders every hedge as a black slab
    hedge: new THREE.MeshStandardMaterial({
      ...surface(hedgeTexture(), 1.3, 3.2), color: 0xffffff, roughness: 1.0 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x8d8577, roughness: 0.95, vertexColors: true }),
    dark: new THREE.MeshStandardMaterial({ roughness: 0.8, vertexColors: true }),
    water: new THREE.MeshStandardMaterial({ color: 0x35566b, roughness: 0.16, metalness: 0.4, vertexColors: true }),
    bark: new THREE.MeshStandardMaterial({ color: 0x5a4433, roughness: 0.95 }),
    // instanced foliage gets its variety from setColorAt, not a vertex-colour
    // attribute — asking for vertexColors here renders the canopies black
    leaf: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }),
  };

  // Wall textures repeat in world units (set per-geometry via UVs), so keep repeat at 1
  // and let the UV generator do the scaling.
  return M;
}

/** Paint colours used for rendered houses / doors — Dublin front-door energy. */
export const DOOR_COLOURS = [
  0x1f3d2b, 0x7a1f24, 0x21384f, 0x2f2f33, 0x6d4b1f, 0x123a3a, 0x4a1f4a, 0xb0532a,
];
export const RENDER_TINTS = [
  0xf0ead9, 0xe4e7e2, 0xdfe5ea, 0xece4d2, 0xdfe0d6, 0xf2e6d8,
];
