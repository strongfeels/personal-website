import * as THREE from '../vendor/three.module.js';
import { buildMaterials } from './materials.js';
import { buildWorld } from './world.js';
import { createPlayer, PlayerController } from './player.js';
import { Crowd } from './npc.js';
import { Traffic, Drive, makeCar, CAR } from './vehicle.js';
import { Sound } from './audio.js';
import { Radio } from './radio.js';
import { buildTramway, Tram } from './tram.js';
import { hasTouch, TouchControls } from './touch.js';
import { addCars } from './props.js';

const canvas = document.getElementById('view');
const hud = {
  street: document.getElementById('street'),
  place: document.getElementById('place'),
  clock: document.getElementById('clock'),
  loading: document.getElementById('loading'),
  loadingText: document.getElementById('loading-text'),
  prompt: document.getElementById('prompt'),
  speed: document.getElementById('speed'),
  minimap: document.getElementById('minimap'),
  audio: document.getElementById('audio'),
  radio: document.getElementById('radio'),
  radioMain: document.getElementById('r-main'),
  radioOff: document.getElementById('r-off'),
};

if (hasTouch()) hud.audio.textContent = '\u{1F50A} tap for sound';

// A phone has a fraction of the fill rate and a much denser screen, so it gets a
// lighter profile: fewer pixels, a smaller shadow map, less to draw.
const MOBILE = (('ontouchstart' in window) || navigator.maxTouchPoints > 0)
  && matchMedia('(pointer: coarse)').matches;

const renderer = new THREE.WebGLRenderer({
  canvas, antialias: !MOBILE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 2200);

// ------------------------------------------------------------------ sky ----
function skyTexture(top, mid, bottom) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top); g.addColorStop(0.52, mid); g.addColorStop(1, bottom);
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

const SKIES = {
  day: { tex: () => skyTexture('#5d8fc4', '#a8c4dd', '#dfe4e0'), fog: 0xc9d5dc, fogFar: 620,
         sun: 0xfff2df, sunI: 2.6, amb: 0xb9cade, ambI: 0.95, elev: 0.85, azim: 2.1, exp: 1.05 },
  dusk: { tex: () => skyTexture('#2c3e66', '#8a6f8e', '#e0a06a'), fog: 0x9b7f83, fogFar: 520,
          sun: 0xffb066, sunI: 1.9, amb: 0x6b7a9c, ambI: 0.65, elev: 0.16, azim: 3.5, exp: 1.0 },
  night: { tex: () => skyTexture('#070d1c', '#101a33', '#222c44'), fog: 0x0e1526, fogFar: 300,
           sun: 0x9fb6e8, sunI: 0.28, amb: 0x2a3652, ambI: 0.42, elev: 0.7, azim: 5.0, exp: 1.25 },
};
let skyMode = 'day';

const sun = new THREE.DirectionalLight(0xfff2df, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 420;
const S = 105;
Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
sun.shadow.bias = -0.0009;
sun.shadow.normalBias = 0.035;
scene.add(sun, sun.target);

const ambient = new THREE.HemisphereLight(0xb9cade, 0x4a5540, 0.95);
scene.add(ambient);

function applySky(mode) {
  const s = SKIES[mode];
  const sky = s.tex();
  scene.background = sky;
  scene.environment = sky;            // windows and car paint reflect the sky
  scene.fog = new THREE.Fog(s.fog, 90, s.fogFar);
  sun.color.setHex(s.sun);
  sun.intensity = s.sunI;
  ambient.color.setHex(s.amb);
  ambient.intensity = s.ambI;
  renderer.toneMappingExposure = s.exp;
  skyMode = mode;
  if (materials) {
    const lit = mode === 'night';
    materials.glass.emissive.setHex(lit ? 0xffcf87 : 0x0a1218);
    materials.glass.emissiveIntensity = lit ? 1.5 : 1.0;
    materials.glass.color.setHex(lit ? 0x2a2418 : 0x2c3f4d);
  }
  hud.clock.textContent = { day: '☀️ Afternoon', dusk: '🌆 Dusk', night: '🌙 Night' }[mode];
}

// ----------------------------------------------------------------- load ----
let materials = null;
let controller = null;
let crowd = null;
let traffic = null;
let parked = null;              // the instanced parked cars
let worldColliders = null;
let drive = null;               // set while you're behind the wheel
let world = null;               // the streaming chunk manager
let tram = null;
let takenSlot = -1;
let worldData = null;
const sound = new Sound();
const radio = new Radio(sound);
let radioTouched = false;

// The chip is the whole radio interface on a phone, where there is no G key:
// off it is one "Radio on" button, on it splits into cycle and off.
radio.onstate = (label) => {
  hud.radioMain.textContent = label ? '\u{1F4FB} ' + label : '\u{1F4FB} Radio on';
  hud.radio.classList.toggle('on', !!label);
};
// pointerdown, not click, so it beats the look-around drag handler on the canvas
hud.radioMain.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!drive) return;
  if (radio.station < 0) radio.power(); else radio.next(1);
});
hud.radioOff.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (drive) radio.tune(-1);
});
let stepPhase = 0;
let meter = null;
let touch = null;
let labels = [];
const clock = new THREE.Clock();

/**
 * Put the player where the game starts: the bench on Gledswood Drive, standing
 * a step in front of it looking the way it looks.
 *
 * Camera forward is (-sin yaw, -cos yaw), so the yaw that looks along `face` is
 * atan2(-cos face, -sin face). Module scope because the R key needs it too, and
 * it falls back to Gledswood Avenue so an older world.json still loads.
 */
/**
 * Poe over the running world, for a few seconds.
 *
 * Not a gate: the loading screen has already gone and the game is live and
 * playable underneath, so this blocks nothing.
 *
 * Nothing dismisses it. It used to go on any key or tap, which was wrong the
 * moment the world became playable underneath it — you reach for the controls
 * straight away, and the poem vanished before it had finished arriving. It runs
 * its course. ?nodream=1 skips it outright for anyone reloading all day.
 */
function showCouplet(skip) {
  const el = document.getElementById('dream');
  if (!el || skip) return;
  el.classList.add('show');
  setTimeout(() => el.classList.add('done'), 4600);
}

function placeAtStart() {
  const sp = worldData && worldData.spawn;
  if (sp) {
    controller.pos.set(sp.x, 0, sp.z);
    controller.camYaw = Math.atan2(-Math.cos(sp.face), -Math.sin(sp.face));
    return;
  }
  const ave = worldData.gledswoodAvenue.flat();
  if (ave.length >= 2) {
    const mid = ave[Math.floor(ave.length / 2)];
    controller.pos.set(mid[0], 0, mid[1] + 2.2);
    controller.camYaw = Math.PI / 2;
  }
}

function toggleSound() {
  sound.start();                       // a tap counts as the gesture browsers want
  const on = sound.toggle();
  // The master gain covers everything in the graph, but a no-CORS station plays
  // outside it and has to be muted by hand.
  radio.setMuted(!on);
  hud.audio.textContent = on ? '\u{1F50A} sound on' : '\u{1F507} muted';
  hud.audio.style.opacity = 1;
  setTimeout(() => { hud.audio.style.opacity = 0; }, 1400);
  if (touch) touch.setMuted(!on);
  return on;
}

async function boot() {
  hud.loadingText.textContent = 'Reading Clonskeagh…';
  worldData = await (await fetch('./world.json')).json();
  // vegetation is optional — the game still runs if it hasn't been detected yet
  const veg = await fetch('./vegetation.json')
    .then((r) => (r.ok ? r.json() : { trees: [], hedges: [] }))
    .catch(() => ({ trees: [], hedges: [] }));
  const marks = await fetch('./landmarks.json')
    .then((r) => (r.ok ? r.json() : { landmarks: [] }))
    .catch(() => ({ landmarks: [] }));
  // bunkers and greens, traced from imagery — OSM has only the course outline
  const golf = await fetch('./golf.json')
    .then((r) => (r.ok ? r.json() : { courses: [] }))
    .catch(() => ({ courses: [] }));
  // front boundaries measured off the imagery, where one was actually found
  const frontage = await fetch('./frontage.json')
    .then((r) => (r.ok ? r.json() : { frontages: [] }))
    .catch(() => ({ frontages: [] }));
  // Surveyed trees the detector never found — a third of what OSM records had
  // no detected tree within 6m, and the imagery says there is one there. Kept in
  // its own file so re-running detect_vegetation.py can't quietly drop them.
  const osmTrees = await fetch('./osm_trees.json')
    .then((r) => (r.ok ? r.json() : { trees: [] }))
    .catch(() => ({ trees: [] }));
  veg.trees = (veg.trees || []).concat(osmTrees.trees || []);
  // Corrections from looking at the actual place. The detector and the survey
  // both get individual trees wrong sometimes, and neither can be argued with
  // from a desk — a removal is a circle, and anything drawn inside it goes.
  const fixes = await fetch('./tree_fixes.json')
    .then((r) => (r.ok ? r.json() : { remove: [], add: [] }))
    .catch(() => ({ remove: [], add: [] }));
  const cuts = fixes.remove || [];
  if (cuts.length) {
    veg.trees = veg.trees.filter((t) => !cuts.some(
      (c) => Math.hypot(t.x - c.x, t.z - c.z) <= c.r));
  }
  veg.trees = veg.trees.concat(fixes.add || []);

  hud.loadingText.textContent = 'Mixing mortar…';
  await frame();
  materials = buildMaterials();

  hud.loadingText.textContent = `Placing ${worldData.meta.counts.buildings} buildings…`;
  await frame();
  const built = buildWorld(worldData, materials, scene, marks, veg, golf, frontage);
  labels = built.labels;
  world = built;

  await frame();
  parked = addCars(worldData, scene, built.colliders);

  const player = createPlayer();
  scene.add(player.group);
  controller = new PlayerController(player, camera, built.colliders, canvas);

  if (hasTouch()) {
    document.body.classList.add('touch');
    touch = new TouchControls((action) => {
      if (action === 'car') {
        if (drive) exitCar(); else enterCar();
      } else if (action === 'view') {
        controller.firstPerson = !controller.firstPerson;
        touch.setFirstPerson(controller.firstPerson);
      } else if (action === 'sound') {
        toggleSound();
      }
    });
  }

  hud.loadingText.textContent = 'Putting people on the street…';
  await frame();
  crowd = new Crowd(worldData, scene, MOBILE ? 16 : 36);
  // the parked cars are handed over so the lanes can be eased around them
  traffic = new Traffic(worldData, scene, MOBILE ? 12 : 24, 7,
    parked ? parked.slots : null);
  const tramway = buildTramway(worldData, materials, scene, built.colliders);
  // one tram each way, as on the real double track
  if (tramway) {
    tram = tramway.lines.map((_, i) => new Tram(tramway, scene, i, i === 0 ? 1 : -1));
  }
  worldColliders = built.colliders;

  placeAtStart();

  // ?x=&z=&yaw=&pitch=&dist=&sky= — handy for grabbing a specific view
  const q = new URLSearchParams(location.search);
  const num = (k, f) => (q.has(k) ? parseFloat(q.get(k)) : f);
  controller.pos.x = num('x', controller.pos.x);
  controller.pos.z = num('z', controller.pos.z);
  controller.camYaw = num('yaw', controller.camYaw);
  controller.camPitch = num('pitch', controller.camPitch);
  controller.camDist = num('dist', controller.camDist);

  // Build only what's around the spawn before we show anything; the rest
  // streams in as you move. This is what keeps load time independent of map size.
  hud.loadingText.textContent = 'Building the streets around you…';
  await frame();
  for (let pass = 0; pass < 400; pass++) {
    if (world.stream(controller.pos, 40) === 0) break;
    if (pass % 6 === 5) await frame();
  }

  if (q.has('drive')) enterCar();          // start behind the wheel

  if (q.has('fps')) {
    meter = document.createElement('div');
    meter.className = 'hud';
    meter.id = 'meter';
    document.body.appendChild(meter);
  }

  applySky(q.get('sky') || 'day');
  drawMinimap();

  // Draw one frame synchronously so there's always something on screen even if
  // rAF is throttled, then start the loop.
  if (drive) driveCamera(0.016); else controller.update(0.016);
  updateSun();
  renderer.render(scene, camera);
  animate();

  // The loading screen goes now — the world is up and playable from here. The
  // couplet lies over the top of it and blocks nothing.
  hud.loading.classList.add('gone');
  showCouplet(q.has('nodream'));
}

// Yield so the loading text repaints. rAF alone would hang in a background tab,
// so race it against a timer.
const frame = () => new Promise((r) => {
  let done = false;
  const fire = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(() => setTimeout(fire, 0));
  setTimeout(fire, 60);
});

// ------------------------------------------------------------- minimap ----
/**
 * The map is rendered once, whole, into an offscreen canvas at a good
 * resolution. Each frame we blit the window of it around the player, so the map
 * scrolls under a fixed marker instead of the marker crawling over a fixed map.
 * `M` pulls back to show the lot.
 */
let mapSheet = null;                  // offscreen canvas of the entire world
let mapScale = 1;                     // pixels per metre on that canvas
const MAP_SPAN = 360;                 // metres across the small map

function drawMinimap() {
  const R = worldData.meta.radius;
  mapScale = Math.min(3, 3600 / (R * 2));
  const size = Math.round(R * 2 * mapScale);
  mapSheet = document.createElement('canvas');
  mapSheet.width = mapSheet.height = size;
  const x = mapSheet.getContext('2d');
  const T = (wx, wz) => [(wx + R) * mapScale, (wz + R) * mapScale];

  x.fillStyle = '#151a15';
  x.fillRect(0, 0, size, size);

  x.fillStyle = '#22301f';
  for (const a of worldData.areas) {
    if (!['grass', 'park', 'wood', 'pitch'].includes(a.kind)) continue;
    x.beginPath();
    a.poly.forEach((p, i) => { const [px, pz] = T(p[0], p[1]); i ? x.lineTo(px, pz) : x.moveTo(px, pz); });
    x.closePath(); x.fill();
  }
  x.strokeStyle = '#5a5f66'; x.lineCap = 'round'; x.lineJoin = 'round';
  for (const r of worldData.roads) {
    x.lineWidth = Math.max(1, r.w * mapScale);
    x.beginPath();
    r.pts.forEach((p, i) => { const [px, pz] = T(p[0], p[1]); i ? x.lineTo(px, pz) : x.moveTo(px, pz); });
    x.stroke();
  }
  for (const b of worldData.buildings) {
    x.fillStyle = b.lm ? '#c08a5a' : '#8b6d5c';       // landmarks stand out
    x.beginPath();
    b.poly.forEach((p, i) => { const [px, pz] = T(p[0], p[1]); i ? x.lineTo(px, pz) : x.moveTo(px, pz); });
    x.closePath(); x.fill();
  }
  // the Green Line, in Luas green
  x.strokeStyle = '#5fbf6a'; x.lineWidth = Math.max(2, 3 * mapScale);
  for (const seg of (worldData.tramTrack || [])) {
    x.beginPath();
    seg.forEach((p, i) => { const [px, pz] = T(p[0], p[1]); i ? x.lineTo(px, pz) : x.moveTo(px, pz); });
    x.stroke();
  }
  x.fillStyle = '#eaf7ea';
  for (const s2 of (worldData.tramStops || [])) {
    const [px, pz] = T(s2.x, s2.z);
    x.beginPath(); x.arc(px, pz, Math.max(2.5, 3.5 * mapScale), 0, 7); x.fill();
  }

  x.strokeStyle = '#ffd166'; x.lineWidth = Math.max(1.5, 2 * mapScale);
  for (const seg of worldData.gledswoodAvenue) {
    x.beginPath();
    seg.forEach((p, i) => { const [px, pz] = T(p[0], p[1]); i ? x.lineTo(px, pz) : x.moveTo(px, pz); });
    x.stroke();
  }
}

function updateMinimap() {
  if (!mapSheet) return;
  const c = hud.minimap, x = c.getContext('2d');
  const R = worldData.meta.radius;
  const wide = c.classList.contains('big');
  const span = wide ? R * 2 : MAP_SPAN;             // metres shown across
  const src = span * mapScale;                      // pixels of the sheet

  // centre the window on the player, clamped so we never sample off the sheet
  const cx = (controller.pos.x + R) * mapScale;
  const cz = (controller.pos.z + R) * mapScale;
  const half = src / 2;
  const sx = Math.max(0, Math.min(mapSheet.width - src, cx - half));
  const sz = Math.max(0, Math.min(mapSheet.height - src, cz - half));

  x.imageSmoothingEnabled = true;
  x.clearRect(0, 0, c.width, c.height);
  x.drawImage(mapSheet, sx, sz, src, src, 0, 0, c.width, c.height);

  // the marker sits wherever the player actually is in that window
  const k = c.width / src;
  const mx = (cx - sx) * k, mz = (cz - sz) * k;
  // Which way to point the arrow. controller.yaw only updates while you're
  // actually walking, and not at all while driving, so on its own it freezes.
  // Fall back to the camera heading when stationary — that's where you're
  // looking, which is what you want off a map.
  const heading = drive ? drive.yaw
    : controller.speed > 0.6 ? controller.yaw
      : controller.camYaw + Math.PI;
  x.save();
  x.translate(mx, mz);
  x.rotate(Math.PI - heading);
  x.fillStyle = '#ff4d4d';
  x.strokeStyle = 'rgba(0,0,0,.55)';
  x.lineWidth = 2;
  const r = wide ? 7 : 9;
  x.beginPath();
  x.moveTo(0, -r); x.lineTo(r * 0.62, r * 0.8); x.lineTo(0, r * 0.38); x.lineTo(-r * 0.62, r * 0.8);
  x.closePath(); x.fill(); x.stroke();
  x.restore();
}

/** What you're standing on, so a step on grass doesn't sound like concrete. */
function surfaceUnder(px, pz) {
  let best = Infinity, kerb = 0, pave = 0;
  for (const r of worldData.roads) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const vx = bx - ax, vz = bz - az;
      const L = vx * vx + vz * vz;
      const t = L < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / L));
      const d = Math.hypot(px - (ax + t * vx), pz - (az + t * vz));
      if (d < best) {
        best = d;
        kerb = r.w / 2;
        pave = kerb + (r.kind === 'service' ? 0 : 1.9);
      }
    }
  }
  if (best <= kerb) return 'road';
  if (best <= pave) return 'pavement';
  return 'grass';
}

// ------------------------------------------------------------ street HUD ---
function nearestStreet() {
  let best = null;
  const px = controller.pos.x, pz = controller.pos.z;
  for (const r of worldData.roads) {
    if (!r.name) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const vx = bx - ax, vz = bz - az;
      const L = vx * vx + vz * vz;
      const t = L < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / L));
      const d = Math.hypot(px - (ax + t * vx), pz - (az + t * vz));
      if (!best || d < best[0]) best = [d, r.name];
    }
  }
  return best && best[0] < 40 ? best[1] : '';
}

function nearestPlace() {
  let best = null;
  for (const l of labels) {
    const d = Math.hypot(l.x - controller.pos.x, l.z - controller.pos.z);
    if (d < 55 && (!best || d < best[0])) best = [d, l.name];
  }
  return best ? best[1] : '';
}

// --------------------------------------------------------------- cars ----
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function nearestParkedSlot() {
  if (!parked) return -1;
  let best = -1, bd = 5.0;
  parked.slots.forEach(([x, z], i) => {
    if (i === takenSlot) return;
    const d = Math.hypot(x - controller.pos.x, z - controller.pos.z);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function enterCar() {
  const i = nearestParkedSlot();
  if (i < 0) return false;
  const [x, z, yaw] = parked.slots[i];

  // take this one out of the instanced field and stand a real car in its place
  parked.cars.setMatrixAt(i, ZERO);
  parked.cars.instanceMatrix.needsUpdate = true;
  for (let k = 0; k < 4; k++) parked.wheels.setMatrixAt(i * 4 + k, ZERO);
  parked.wheels.instanceMatrix.needsUpdate = true;
  takenSlot = i;

  // and drop its collider, or the car would be stuck inside itself
  const ci = worldColliders.findIndex(
    (c) => Math.abs(c.x - x) < 0.02 && Math.abs(c.z - z) < 0.02 && c.hx > 2);
  if (ci >= 0) worldColliders.splice(ci, 1);

  const car = makeCar(0x1f4f7a, 991, false);
  scene.add(car.group);
  drive = new Drive(car, worldColliders);
  drive.place(x, z, yaw);
  controller.p.group.visible = false;
  controller.camYaw = yaw + Math.PI;
  if (touch) touch.setDriving(true);      // Run and Jump make no sense in a car

  // A live stream costs about a megabyte a minute, so it stays off by default on
  // a phone and the chip is there to turn it on. On a desktop it just plays.
  if (radio.station < 0 && !radioTouched && !touch) { radioTouched = true; radio.tune(0); }
  else radio.on();
  hud.radio.classList.add('shown');
  return true;
}

function exitCar() {
  if (!drive) return;
  // step out onto the driver's side — starboard, this being Ireland
  const rx = -Math.cos(drive.yaw), rz = Math.sin(drive.yaw);
  controller.pos.set(drive.x + rx * 1.9, 0, drive.z + rz * 1.9);
  controller.speed = 0;
  controller.p.group.visible = true;
  drive = null;
  radio.off();
  hud.radio.classList.remove('shown');
  if (touch) touch.setDriving(false);
}

function driveCamera(dt) {
  // swing round behind the car once it's moving, but let the mouse override
  if (Math.abs(drive.speed) > 1.2) {
    const want = drive.yaw + Math.PI;
    let d = want - controller.camYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    controller.camYaw += d * Math.min(1, dt * 1.6);
  }
  if (controller.firstPerson) {
    // sit in the driver's seat. Local +z is the way the car faces and +y is up,
    // so starboard — right-hand drive — is -x.
    const c = Math.cos(drive.yaw), s = Math.sin(drive.yaw);
    const ox = -0.36, oz = -0.15;                 // seat, in car-local metres
    const px = drive.x + ox * c + oz * s;
    const pz = drive.z - ox * s + oz * c;
    const eye = 1.32;
    camera.position.set(px, eye, pz);
    // camYaw points at the camera from the car, so looking is the reverse of it
    camera.lookAt(
      px - Math.sin(controller.camYaw) * 10,
      eye - Math.sin(controller.camPitch) * 10,
      pz - Math.cos(controller.camYaw) * 10);
    return;
  }

  const dist = 10.5, cy = Math.cos(controller.camPitch);
  camera.position.set(
    drive.x + Math.sin(controller.camYaw) * dist * cy,
    2.0 + Math.sin(controller.camPitch) * dist + 0.8,
    drive.z + Math.cos(controller.camYaw) * dist * cy);
  camera.lookAt(drive.x, 1.1, drive.z);
}

// ---------------------------------------------------------------- input ---
// browsers block audio until the user interacts, so build the graph on the
// first gesture of any kind
for (const ev of ['pointerdown', 'keydown']) {
  addEventListener(ev, () => {
    sound.start();
    hud.audio.style.opacity = 0;
  }, { once: true });
}

addEventListener('keydown', (e) => {
  if (!controller) return;
  if (e.code === 'KeyP') toggleSound();
  if (e.code === 'KeyE') { if (drive) exitCar(); else enterCar(); }
  if (e.code === 'KeyN') applySky(skyMode === 'day' ? 'dusk' : skyMode === 'dusk' ? 'night' : 'day');
  if (e.code === 'KeyF') {
    controller.firstPerson = !controller.firstPerson;
    if (touch) touch.setFirstPerson(controller.firstPerson);
  }
  if (e.code === 'KeyG' && drive) { if (e.shiftKey) radio.tune(-1); else radio.next(1); }
  if (e.code === 'KeyM') hud.minimap.classList.toggle('big');
  if (e.code === 'KeyC') document.getElementById('help').classList.toggle('gone');
  if (e.code === 'KeyR') placeAtStart();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setSize(innerWidth, innerHeight);

// ----------------------------------------------------------------- loop ---
/** Keep the shadow frustum travelling with the player. */
function updateSun() {
  const p = controller.pos;
  const s = SKIES[skyMode];
  const d = 150;
  sun.position.set(
    p.x + Math.cos(s.azim) * Math.cos(s.elev) * d,
    Math.sin(s.elev) * d,
    p.z + Math.sin(s.azim) * Math.cos(s.elev) * d);
  sun.target.position.set(p.x, 0, p.z);
  sun.target.updateMatrixWorld();
}

let hudTick = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());

  if (touch) {
    const look = touch.takeLook();
    controller.camYaw -= look.dx * 0.006;
    controller.camPitch = Math.max(-0.35, Math.min(1.15, controller.camPitch + look.dy * 0.005));
    controller.camDist = Math.max(2.2, Math.min(28, controller.camDist + touch.takePinch()));
    controller.analog = drive ? null : touch.move;
    for (const c of ['ShiftLeft', 'Space']) {
      if (touch.keys.has(c)) controller.keys.add(c); else controller.keys.delete(c);
    }
  }

  if (drive) {
    drive.update(dt, controller.keys, traffic ? traffic.positions() : [],
      touch ? touch.move : null);
    controller.pos.set(drive.x, 0, drive.z);
    driveCamera(dt);
  } else {
    controller.update(dt);
  }
  // footsteps come off the walk cycle: one per half stride
  if (!drive && controller.onGround && controller.speed > 0.6) {
    const ph = controller.phase / Math.PI;
    if (Math.floor(ph) !== Math.floor(stepPhase)) {
      sound.footstep(surfaceUnder(controller.pos.x, controller.pos.z),
        Math.min(1, 0.55 + controller.speed / 9));
    }
    stepPhase = ph;
  } else {
    stepPhase = controller.phase / Math.PI;
  }

  // where the camera is looking, so recycled people and cars reappear behind you
  const fwd = { x: -Math.sin(controller.camYaw), z: -Math.cos(controller.camYaw) };
  if (crowd) crowd.update(dt, controller.pos, fwd);
  if (tram) for (const t of tram) t.update(dt, controller.pos);
  if (traffic) {
    // You were only an obstacle while driving, so on foot the traffic went
    // straight through you. You are always one now.
    traffic.update(dt, controller.pos,
      drive ? [{ x: drive.x, z: drive.z }]
            : [{ x: controller.pos.x, z: controller.pos.z }], fwd);
  }
  if (drive) {
    const throttle = controller.keys.has('KeyW') || controller.keys.has('ArrowUp') ? 1 : 0;
    sound.engine(drive.speed, throttle);
    radio.update(throttle);
  } else {
    sound.engineOff();
  }

  // bring in the chunks you're heading towards. The number is a millisecond
  // budget, not a chunk count — a big chunk now spills across frames instead of
  // blocking one.
  if (world) world.stream(controller.pos, drive ? 6 : 5);

  updateSun();

  if ((hudTick = (hudTick + 1) % 12) === 0) {
    hud.street.textContent = nearestStreet();
    if (drive) {
      hud.speed.firstChild.textContent = String(Math.round(Math.abs(drive.speed) * 3.6));
      hud.speed.style.opacity = 1;
      // On a phone the Car / Exit buttons are right there and say so
      // themselves, so the prompt only exists to name the keyboard shortcut.
      hud.prompt.textContent = 'E — get out';
      hud.prompt.style.opacity = !touch && Math.abs(drive.speed) < 0.6 ? 1 : 0;
    } else {
      hud.speed.style.opacity = 0;
      const near = nearestParkedSlot() >= 0;
      hud.prompt.textContent = 'E — get in';
      hud.prompt.style.opacity = !touch && near ? 1 : 0;
    }
    const pl = nearestPlace();
    hud.place.textContent = pl;
    hud.place.style.opacity = pl ? 1 : 0;
  }
  updateMinimap();          // scrolls with you, so it can't run at 5 Hz
  renderer.render(scene, camera);

  if (meter) {
    meterFrames++;
    meterWorst = Math.max(meterWorst, dt);
    const now = performance.now();
    if (now - meterAt > 500) {
      const fps = meterFrames / ((now - meterAt) / 1000);
      let resident = 0;
      for (const c of world.cells.values()) if (c.group) resident++;
      meter.textContent = `${fps.toFixed(0)} fps · worst frame ${(meterWorst * 1000).toFixed(0)} ms · `
        + `${resident} chunks`;
      meterFrames = 0; meterWorst = 0; meterAt = now;
    }
  }
}

let meterFrames = 0, meterWorst = 0, meterAt = performance.now();

boot().catch((err) => {
  hud.loadingText.textContent = 'Failed: ' + err.message;
  console.error(err);
});
