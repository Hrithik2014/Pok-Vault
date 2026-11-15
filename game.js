/*
 * PokéVault game code
 *
 * This script expects the HTML to already contain the game screens, HUD,
 * buttons, and elements referenced by ID throughout the code.
 *
 * Three.js is loaded by the script tag immediately before this one.
 */

// Short aliases for commonly used Three.js and browser helpers.
const T = THREE;
const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const $ = id => document.getElementById(id);
const cl = (value, min, max) => Math.max(min, Math.min(max, value));

// -----------------------------------------------------------------------------
// Saved progress and settings
// -----------------------------------------------------------------------------

// These are the default values used when the game has no saved data yet.
let save = {
  unlocked: 1,
  orbs: {},
  vol: 0.5,
  shd: true
};

// Load any previous progress from the browser's local storage.
try {
  Object.assign(save, JSON.parse(localStorage.getItem('lb') || '{}'));
} catch (e) {
  // Ignore invalid or unavailable saved data and use the defaults above.
}

// Save the current progress and settings.
const persist = () => {
  try {
    localStorage.setItem('lb', JSON.stringify(save));
  } catch (e) {
    // Local storage may be disabled or full; the game can still run without it.
  }
};

// -----------------------------------------------------------------------------
// Audio
// -----------------------------------------------------------------------------

// Create the audio context only when the player first needs sound.
// Browsers generally require audio to begin after a user interaction.
let AC;

function ac() {
  if (!AC) {
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      // Audio is optional, so failure to create it should not stop the game.
    }
  }

  return AC;
}

/*
 * Play a simple synthesized sound.
 *
 * f = starting frequency
 * d = sound duration
 * t = oscillator waveform
 * v = volume before applying the saved volume setting
 * s = optional frequency change over the duration
 */
function snd(f, d = 0.1, t = 'sine', v = 0.25, s = 0) {
  const audio = ac();

  // Do nothing if audio is unavailable or muted.
  if (!audio || save.vol <= 0) return;

  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  const startTime = audio.currentTime;

  oscillator.type = t;
  oscillator.frequency.setValueAtTime(f, startTime);

  // An optional frequency sweep gives effects a rising or falling pitch.
  if (s) {
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, f + s),
      startTime + d
    );
  }

  // Fade each sound out so it does not end abruptly.
  gain.gain.setValueAtTime(v * save.vol, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + d);

  oscillator.connect(gain);
  gain.connect(audio.destination);

  oscillator.start();
  oscillator.stop(startTime + d);
}

// Selects the background music pattern and its current note.
let mus = 'bg';
let ms = 0;

// The world number is also used to choose background music notes.
let wd = 0;

// Play a short note periodically to create a simple looping soundtrack.
setInterval(() => {
  // Stop the music while the game is at the menu or paused.
  if (!AC || mode === 'pause' || mode === 'menu') return;

  // Each music mode uses a different sequence of note offsets.
  const scale = mus === 'boss'
    ? [0, 3, 7, 10, 12, 10, 7, 3]
    : mus === 'win'
      ? [0, 4, 7, 12, 7, 12, 16, 19]
      : [0, 7, 12, 7, 3, 10, 15, 10];

  const baseNotes = [110, 98, 87, 123, 130];
  const noteOffset = scale[ms++ % scale.length];
  const octave = mus === 'win' ? 2 : 1;

  snd(
    baseNotes[wd] * 2 ** (noteOffset / 12) * octave,
    0.22,
    mus === 'boss' ? 'sawtooth' : 'triangle',
    0.07
  );
}, 230);

// -----------------------------------------------------------------------------
// Renderer, scene, camera, and lighting
// -----------------------------------------------------------------------------

// Set up the WebGL renderer that draws the game.
const R = new T.WebGLRenderer({ antialias: true });
R.setPixelRatio(Math.min(devicePixelRatio, 2));
R.shadowMap.enabled = true;
R.shadowMap.type = T.PCFSoftShadowMap;

// Add the renderer's canvas to the page.
document.body.prepend(R.domElement);

// The scene holds all game objects and the camera controls what is visible.
const S = new T.Scene();
const C = new T.PerspectiveCamera(65, 1, 0.1, 400);

// Keep the renderer and camera matched to the browser window.
function rs() {
  R.setSize(innerWidth, innerHeight);
  C.aspect = innerWidth / innerHeight;
  C.updateProjectionMatrix();
}

addEventListener('resize', rs);
rs();

// Soft ambient light keeps shadows from becoming completely black.
S.add(new T.HemisphereLight(0xffd9a0, 0x330008, 0.9));

// Directional light creates the main shadows in the scene.
const sun = new T.DirectionalLight(0xffffff, 0.8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);

// Limit the shadow camera to the area where the player is likely to be.
const shadowCamera = sun.shadow.camera;
shadowCamera.left = shadowCamera.bottom = -32;
shadowCamera.right = shadowCamera.top = 32;
shadowCamera.far = 140;

S.add(sun, sun.target);

// A small point light follows the player later in the game loop.
const pLight = new T.PointLight(0xffcc44, 1.6, 20);
S.add(pLight);

// Reusable geometry for platforms and decorative outlines.
const BX = new T.BoxGeometry(1, 1, 1);
const EG = new T.EdgesGeometry(BX);

// -----------------------------------------------------------------------------
// Player character
// -----------------------------------------------------------------------------

// The player is represented by a rolling sphere.
const ball = new T.Mesh(
  new T.SphereGeometry(0.5, 24, 16),
  new T.MeshStandardMaterial({
    color: 0xf2f6ff,
    emissive: 0x8899bb,
    emissiveIntensity: 0.35,
    roughness: 0.2
  })
);

ball.castShadow = true;

// Add the red cap, glowing band, and front button that make the sphere
// resemble a Poké Ball.
{
  const cap = new T.Mesh(
    new T.SphereGeometry(0.512, 24, 12, 0, 6.283, 0, 1.571),
    new T.MeshStandardMaterial({
      color: 0xff2233,
      emissive: 0xff1122,
      emissiveIntensity: 0.8,
      roughness: 0.2
    })
  );
  ball.add(cap);

  const band = new T.Mesh(
    new T.TorusGeometry(0.51, 0.04, 8, 32),
    new T.MeshStandardMaterial({
      color: 0x111122,
      emissive: 0xffcc00,
      emissiveIntensity: 0.6
    })
  );
  band.rotation.x = Math.PI / 2;
  ball.add(band);

  const button = new T.Mesh(
    new T.SphereGeometry(0.12, 12, 10),
    new T.MeshBasicMaterial({ color: 0xffcc00 })
  );
  button.position.set(0, 0, -0.5);
  button.scale.z = 0.4;
  ball.add(button);
}

// A transparent wireframe appears while the player's shield skill is active.
const shield = new T.Mesh(
  new T.SphereGeometry(0.95, 16, 12),
  new T.MeshBasicMaterial({
    color: 0x66aaff,
    transparent: true,
    opacity: 0.3,
    wireframe: true
  })
);
ball.add(shield);
S.add(ball);

// -----------------------------------------------------------------------------
// Particle effects
// -----------------------------------------------------------------------------

// Particles are reused instead of creating and deleting meshes each time.
const NP = 400;
const pp = new Float32Array(NP * 3).fill(-999);
const pc = new Float32Array(NP * 3);
const pv = [...Array(NP)].map(() => V());
const pl = new Float32Array(NP);
let pi = 0;

// Store particle positions and colours in a single buffer for rendering.
const pg = new T.BufferGeometry();
pg.setAttribute('position', new T.BufferAttribute(pp, 3));
pg.setAttribute('color', new T.BufferAttribute(pc, 3));

const pts = new T.Points(
  pg,
  new T.PointsMaterial({
    size: 0.35,
    vertexColors: true,
    transparent: true,
    blending: T.AdditiveBlending,
    depthWrite: false
  })
);

// The particle positions are managed manually, so Three.js should not
// hide the particle system based on its normal visibility calculation.
pts.frustumCulled = false;
S.add(pts);

/*
 * Emit a burst of particles at a position.
 *
 * The particles are assigned random velocities and automatically expire
 * after a short time.
 */
function burst(position, colour, count = 14, speed = 5) {
  const tint = new T.Color(colour);

  for (let i = 0; i < count; i++) {
    // Reuse particles in a circular buffer.
    const index = pi++ % NP;

    pp[index * 3] = position.x;
    pp[index * 3 + 1] = position.y;
    pp[index * 3 + 2] = position.z;

    pc[index * 3] = tint.r;
    pc[index * 3 + 1] = tint.g;
    pc[index * 3 + 2] = tint.b;

    // Give each particle a slightly different direction.
    pv[index].set(
      Math.random() - 0.5,
      Math.random() * 0.8,
      Math.random() - 0.5
    ).multiplyScalar(speed * 2);

    // Give the particle a short, slightly varied lifetime.
    pl[index] = 0.6 + Math.random() * 0.5;
  }
}

// Move active particles and hide them when their lifetime runs out.
function partUp(dt) {
  for (let i = 0; i < NP; i++) {
    if (pl[i] <= 0) continue;

    pl[i] -= dt;
    pv[i].y -= 8 * dt;

    pp[i * 3] += pv[i].x * dt;
    pp[i * 3 + 1] += pv[i].y * dt;
    pp[i * 3 + 2] += pv[i].z * dt;

    if (pl[i] <= 0) {
      // Move expired particles out of view.
      pp[i * 3 + 1] = -999;
    }
  }

  // Tell Three.js that the particle buffers have changed.
  pg.attributes.position.needsUpdate = true;
  pg.attributes.color.needsUpdate = true;
}

// -----------------------------------------------------------------------------
// Shared game state
// -----------------------------------------------------------------------------

let mode = 'menu';
let cur = 1;
let time = 0;

// The current level group and its collections of gameplay objects.
let L;
let plats;
let enemies;
let orbs;
let zones;
let hazards;
let projs;
let BOSS;
let goal;
let TH;

// Player position used when respawning.
let spawn = V();

// Checkpoint and goal locations.
let chkPlat;
let chkZ = 0;
let goalPos = V();

// Orb counters for the current level.
let orbCount = 0;
let orbTotal = 0;

// Camera orientation.
let yaw = 0;
let pitch = 0.45;

// Input state.
let keys = {};
let jumpReq = 0;
let joy = { x: 0, y: 0 };
let touchBoost = false;

// All values that change as the player moves through the level.
const P = {
  p: V(),          // Player position.
  v: V(),          // Player velocity.
  hp: 100,         // Health.
  en: 0,           // Energy used by boosts and skills.
  combo: 0,        // Consecutive bounce count.
  air: 1,          // Available mid-air jumps.
  coy: 0,          // Short grace period after leaving a ledge.
  inv: 0,          // Remaining damage-invulnerability time.
  sh: 0,           // Remaining shield duration.
  gt: 0,           // Time spent grounded.
  ride: null,      // Moving platform currently carrying the player.
  sel: 0,          // Selected skill.
  rt: 0,           // Timer for rolling sounds.
  gr: false        // Whether the player is currently grounded.
};

// Skills unlock at different levels and each costs a set amount of energy.
const ABN = [
  'Super Bounce',
  'Energy Shield',
  'Bounce Blast',
  'Teleport'
];

const ABL = [6, 11, 21, 31];
const ABC = [30, 40, 50, 40];

// Each world has a platform accent colour and a background colour.
const THEMES = [
  [0xffcc00, 0x000000],
  [0xff2233, 0x0a0000],
  [0xffcc00, 0x0a0800],
  [0xff2233, 0x000000],
  [0xffee55, 0x120000]
];

/*
 * Make a small seeded random-number generator.
 *
 * Level layout choices use this generator, so a given level number produces
 * a consistent layout.
 */
const mul = seed => () => {
  seed |= 0;
  seed = seed + 0x6D2B79F5 | 0;

  let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
  value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;

  return ((value ^ value >>> 14) >>> 0) / 4294967296;
};

// -----------------------------------------------------------------------------
// Menus and settings
// -----------------------------------------------------------------------------

// Show one screen and hide the others.
function ui(name) {
  document.querySelectorAll('.s').forEach(screen => {
    screen.classList.toggle('on', screen.id === name);
  });

  // Refresh the level buttons whenever the level-selection screen opens.
  if (name === 'select') grid();
}

// Build the level-selection grid, grouped by world.
function grid() {
  let html = '';

  const worldNames = [
    'TRAINING FACILITY',
    'LASER LABORATORY',
    'ABANDONED FACTORY',
    'ENERGY CORE',
    'FINAL ESCAPE'
  ];

  for (let world = 0; world < 5; world++) {
    html += `<div class="wl" style="grid-column:1/-1">WORLD ${world + 1} – ${worldNames[world]}</div>`;

    for (let level = 1; level <= 10; level++) {
      const number = world * 10 + level;
      const disabled = number > save.unlocked ? 'disabled' : '';

      html += `<button ${disabled} onclick="start(${number})">${number}</button>`;
    }
  }

  $('grid').innerHTML = html;
}

// Connect the settings controls to the saved options.
$('vol').value = save.vol;
$('vol').oninput = event => {
  save.vol = +event.target.value;
  persist();
};

$('shd').checked = save.shd;
$('shd').onchange = event => {
  save.shd = event.target.checked;
  sun.castShadow = save.shd;
  persist();
};

// Apply the saved shadow setting during startup as well.
sun.castShadow = save.shd;

// -----------------------------------------------------------------------------
// Level-building helpers
// -----------------------------------------------------------------------------

/*
 * Create a platform and store its gameplay properties.
 *
 * The type (`t`) controls special behaviour such as movement, electricity,
 * falling, bouncing, or checkpoint activation.
 */
function addPlat(x, y, z, w, h, d, t = 'n') {
  const colour = {
    gum: 0xff66cc,
    pad: 0xff8800,
    elec: 0xffcc00,
    fall: 0x998866,
    dis: 0xffffff,
    chk: 0xffffff
  }[t] || TH.p;

  const mesh = new T.Mesh(
    BX,
    new T.MeshStandardMaterial({
      color: 0x151a33,
      emissive: colour,
      emissiveIntensity: 0.25,
      roughness: 0.5,
      metalness: 0.6,
      transparent: true
    })
  );

  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Outline the platform so it stands out against the dark environment.
  const edges = new T.LineSegments(
    EG,
    new T.LineBasicMaterial({
      color: colour,
      transparent: true
    })
  );
  mesh.add(edges);
  L.add(mesh);

  const platform = {
    m: mesh,
    e: edges,
    w,
    h,
    d,
    t,
    b: mesh.position.clone(), // Original position, used by moving platforms.
    ph: Math.random() * 6,     // Offset so platforms animate at different times.
    on: true,
    tm: 0,
    vy: 0,
    dx: V(),                  // Movement since the previous update.
    col: colour
  };

  plats.push(platform);
  return platform;
}

// Keep references to Kai characters in the level.
const kids = [];

// Zapkin's position and its follow-behind trail.
let crit;
let trail = [];
let cboost = 0;

/*
 * Make a floating name label using a small canvas texture.
 * This is used above characters and the player.
 */
function tag(text, y) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;

  const context = canvas.getContext('2d');
  context.font = 'bold 36px system-ui,sans-serif';
  context.textAlign = 'center';
  context.fillStyle = '#fff';
  context.shadowColor = '#33ddff';
  context.shadowBlur = 8;
  context.fillText(text, 128, 44);

  const sprite = new T.Sprite(
    new T.SpriteMaterial({
      map: new T.CanvasTexture(canvas),
      transparent: true,
      depthTest: false
    })
  );

  sprite.scale.set(2.4, 0.6, 1);
  sprite.position.y = y;

  return sprite;
}

// The floating label above the player.
const ballTag = tag('Volt Orb', 0);
S.add(ballTag);

/*
 * Build Zapkin from basic Three.js shapes.
 * Zapkin follows behind the player during normal gameplay.
 */
function mkCritter() {
  const group = new T.Group();

  const material = (colour, intensity = 0.3) =>
    new T.MeshStandardMaterial({
      color: colour,
      emissive: colour,
      emissiveIntensity: intensity
    });

  const addPart = (geometry, mat, x, y, z) => {
    const mesh = new T.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };

  // Body and head.
  addPart(new T.SphereGeometry(0.4, 14, 10), material(0x44ccdd), 0, 0.4, 0);
  addPart(new T.SphereGeometry(0.3, 14, 10), material(0x66e0ee), 0, 0.95, 0);

  // Ears, eyes, and cheeks.
  for (const side of [-1, 1]) {
    addPart(
      new T.ConeGeometry(0.12, 0.7, 4),
      material(0x44ccdd),
      side * 0.2,
      1.4,
      0
    ).rotation.z = -side * 0.25;

    addPart(
      new T.SphereGeometry(0.05),
      new T.MeshBasicMaterial({ color: 0x111122 }),
      side * 0.12,
      1,
      -0.27
    );

    addPart(
      new T.SphereGeometry(0.07),
      material(0xff66aa, 0.6),
      side * 0.24,
      0.88,
      -0.24
    );
  }

  // Small lightning-shaped details on the body.
  for (let i = 0; i < 3; i++) {
    const stripe = addPart(
      BX,
      material(0xffee55, 0.8),
      i % 2 ? 0.15 : -0.15,
      0.4 + i * 0.28,
      0.42
    );

    stripe.scale.set(0.3, 0.12, 0.1);
    stripe.rotation.z = i % 2 ? 0.5 : -0.5;
  }

  group.add(tag('Zapkin', 1.9));
  group.userData.by = 0;
  group.position.set(1.5, 0.5, 1);
  L.add(group);

  crit = group;
  trail = [];
  cboost = 0;
}

/*
 * Build one of the human characters.
 * Kai's arm is kept separately so it can wave when the player is nearby.
 */
function mkKid(x, y, z, colours) {
  const group = new T.Group();

  const material = (colour, intensity = 0.15) =>
    new T.MeshStandardMaterial({
      color: colour,
      emissive: colour,
      emissiveIntensity: intensity,
      roughness: 0.6
    });

  const addPart = (geometry, mat, px, py, pz, parent = group) => {
    const mesh = new T.Mesh(geometry, mat);
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Legs and shoes.
  for (const side of [-1, 1]) {
    addPart(BX, material(colours.k), side * 0.17, 0.32, 0)
      .scale.set(0.22, 0.64, 0.22);

    addPart(BX, material(0x222233), side * 0.17, 0.06, -0.06)
      .scale.set(0.26, 0.14, 0.4);
  }

  // Clothes, sleeves, and the front detail on the shirt.
  addPart(BX, material(colours.s), 0, 0.8, 0)
    .scale.set(0.7, 0.4, 0.42);

  addPart(BX, material(0xffffff, 0.3), 0, 1.4, 0)
    .scale.set(0.68, 0.8, 0.4);

  addPart(BX, material(colours.v, 0.35), -0.3, 1.4, 0)
    .scale.set(0.2, 0.82, 0.46);

  addPart(BX, material(colours.v, 0.35), 0.3, 1.4, 0)
    .scale.set(0.2, 0.82, 0.46);

  addPart(BX, material(colours.c, 0.35), 0, 1.45, -0.22)
    .scale.set(0.3, 0.14, 0.02);

  // Head, hair, hat, and eyes.
  addPart(new T.SphereGeometry(0.38, 14, 10), material(colours.k), 0, 2.05, 0);

  addPart(
    new T.SphereGeometry(0.41, 14, 8, 0, 6.283, 0, 1.571),
    material(colours.c, 0.4),
    0,
    2.12,
    0
  );

  addPart(BX, material(colours.c, 0.4), 0, 2.1, -0.4)
    .scale.set(0.5, 0.05, 0.3);

  for (const side of [-1, 1]) {
    addPart(BX, material(0x221111), side * 0.13, 2.02, -0.34)
      .scale.set(0.09, 0.12, 0.04);
  }

  // One arm stays still; the other is animated as a wave.
  addPart(BX, material(colours.k), -0.46, 1.3, 0)
    .scale.set(0.16, 0.6, 0.16);

  const arm = new T.Group();
  arm.position.set(0.46, 1.75, 0);

  addPart(BX, material(colours.k), 0, -0.3, 0, arm)
    .scale.set(0.16, 0.6, 0.16);

  group.add(arm);
  group.add(tag('Kai', 2.8));

  group.scale.setScalar(0.9);
  group.position.set(x, y, z);
  L.add(group);

  kids.push({
    g: group,
    arm,
    ph: Math.random() * 6,
    y
  });
}

/*
 * Add an enemy to a platform.
 * The second argument is retained from the original function signature.
 */
function mkEnemy(o, boss) {
  const group = new T.Group();

  const body = new T.Mesh(
    BX,
    new T.MeshStandardMaterial({
      color: 0x332211,
      emissive: 0xff6611,
      emissiveIntensity: 0.6
    })
  );
  body.scale.set(0.9, 0.8, 0.9);
  body.position.y = 0.4;
  body.castShadow = true;
  group.add(body);

  const eye = new T.Mesh(
    new T.SphereGeometry(0.18),
    new T.MeshBasicMaterial({ color: 0xff2244 })
  );
  eye.position.set(0, 0.5, -0.45);
  group.add(eye);

  L.add(group);

  enemies.push({
    g: group,
    o,
    ph: Math.random() * 6,
    dead: false
  });
}

// -----------------------------------------------------------------------------
// Level generation
// -----------------------------------------------------------------------------

/*
 * Build a level from its number.
 *
 * Levels are grouped into five worlds. Each world changes the colours and
 * types of hazards that may appear.
 */
function build(n) {
  // Remove the previous level before creating a new one.
  if (L) S.remove(L);

  L = new T.Group();
  S.add(L);

  // Start each level with fresh object lists.
  plats = [];
  enemies = [];
  orbs = [];
  zones = [];
  hazards = [];
  projs = [];
  BOSS = null;
  kids.length = 0;

  // Convert level number into a zero-based world number.
  wd = Math.floor((n - 1) / 10);

  // Use a level-specific seed for the generated layout.
  const r = mul(n * 7919);
  const boss = n % 10 === 0;

  TH = { p: THEMES[wd][0] };
  S.background = new T.Color(THEMES[wd][1]);
  S.fog = new T.Fog(THEMES[wd][1], 40, 150);

  // Distant buildings make the level feel like it is inside a facility.
  for (let i = 0; i < 30; i++) {
    const height = 20 + r() * 60;

    const building = new T.Mesh(
      BX,
      new T.MeshStandardMaterial({
        color: 0x0a0e22,
        emissive: THEMES[wd][0],
        emissiveIntensity: 0.08
      })
    );

    building.scale.set(8 + r() * 10, height, 8 + r() * 10);

    const side = r() < 0.5 ? -1 : 1;
    building.position.set(
      side * (30 + r() * 50),
      -40 + height / 2 - 10,
      -r() * 190
    );
    L.add(building);

    const outline = new T.LineSegments(
      EG,
      new T.LineBasicMaterial({
        color: TH.p,
        transparent: true,
        opacity: 0.4
      })
    );

    building.add(outline);
  }

  // Each world has a different selection of platform types.
  const pool = [
    ['n', 'n', 'n', 'pad', 'mx'],
    ['n', 'mx', 'mz', 'elec', 'n'],
    ['n', 'mx', 'fall', 'dis', 'n'],
    ['n', 'my', 'dis', 'pad', 'elec'],
    ['n', 'mx', 'my', 'dis', 'elec', 'fall']
  ][wd];

  let x = 0;
  let y = 0;
  let z = 0;

  // The first platform is the starting platform.
  let prev = addPlat(0, 0, 0, 9, 1, 9, 'n');
  spawn.set(0, 1.6, 0);

  // Later levels contain more platforms per section.
  const cnt = 5 + Math.floor(n / 8);

  /*
   * Generate one stretch of platforms.
   * The next platform is positioned relative to the previous one, creating
   * a forward path with gaps, height changes, and occasional hazards.
   */
  function seg() {
    for (let i = 0; i < cnt; i++) {
      const w = Math.max(3, 6 - r() * 2 - n / 25);
      const d = Math.max(3, 6 - r() * 2 - n / 25);
      const gap = 2.2 + r() * 1.4 + Math.min(n / 40, 1.2);

      z -= prev.d / 2 + gap + d / 2;
      x = cl(x + (r() - 0.5) * 5, -9, 9);
      y = cl(y + (r() - 0.4) * 1.6, -3, 6);

      // Early platforms are kept simple so the player can learn the game.
      const type = n < 3 && i < 2
        ? 'n'
        : pool[Math.floor(r() * pool.length)];

      const platform = addPlat(x, y, z, w, 1, d, type);
      prev = platform;

      // Place a collectible above some platforms.
      if (r() < 0.55) {
        orbs.push({ m: orbMesh(x, y + 1.6, z) });
      }

      // Add enemies more often in later levels.
      if (
        (i % 2 && n >= 5 && r() < 0.25 + wd * 0.08 && type === 'n') ||
        (type === 'n' && n >= 3 && r() < 0.15 && i > 1)
      ) {
        mkEnemy(platform);
      }

      // Later worlds introduce more hazard types.
      if (wd >= 1 && type === 'n' && r() < 0.3 && w >= 4) {
        laser(platform, r);
      }

      if (wd >= 2 && type === 'n' && r() < 0.3 && w >= 4.5) {
        spinner(platform, n);
      }

      if (wd >= 3 && r() < 0.25) {
        zone(platform, r() < 0.5 ? 0.3 : 1.7);
      }

      // Bounce pads appear as smaller platforms above regular platforms.
      if (n >= 2 && type === 'n' && w >= 4 && r() < 0.35) {
        addPlat(
          x + (r() - 0.5) * w * 0.4,
          y + 1.3,
          z + (r() - 0.5) * d * 0.3,
          1.6,
          1.6,
          1.6,
          'gum'
        );
      }
    }
  }

  // Build the opening section, then add a checkpoint.
  seg();

  const checkpoint = addPlat(x, y, z - 8, 10, 1, 10, 'chk');
  checkpoint.cz = z - 8;
  chkZ = checkpoint.cz;
  chkPlat = checkpoint;

  // Generate another section beyond the checkpoint.
  z -= 8;
  prev = checkpoint;
  seg();

  // Create the final platform, with extra space for a boss fight if needed.
  z -= prev.d / 2 + 4 + (boss ? 13 : 4);

  const goalSize = boss ? 24 : 8;
  addPlat(x, y, z, goalSize, 1, goalSize, 'n');
  goalPos.set(x, y + 1, z);

  if (boss) {
    // Add low walls around the boss arena.
    for (const [sx, sz, w, d] of [
      [-1, 0, 0.6, goalSize],
      [1, 0, 0.6, goalSize],
      [0, -1, goalSize, 0.6],
      [0, 1, goalSize, 0.6]
    ]) {
      addPlat(
        x + sx * goalSize / 2,
        y + 1.25,
        z + sz * goalSize / 2,
        w,
        2.5,
        d,
        'n'
      );
    }

    // Create the boss and switch to boss music.
    BOSS = mkBoss(x, y + 0.5, z - 2, wd);
    $('boss').hidden = false;
    mus = 'boss';
  } else {
    $('boss').hidden = true;
    mus = 'bg';
  }

  // The glowing ring marks the level exit.
  const exitRing = new T.Mesh(
    new T.TorusGeometry(1.4, 0.18, 10, 28),
    new T.MeshBasicMaterial({ color: 0xffee55 })
  );

  exitRing.position.set(x, y + 2.2, z + (boss ? 8 : 0));
  goalPos.set(x, y + 1, z + (boss ? 8 : 0));
  L.add(exitRing);

  goal = exitRing;

  // The exit only becomes active after the boss is defeated.
  goal.visible = !boss;

  // Place Kai near the checkpoint, the exit, and the starting area.
  mkKid(chkPlat.b.x + 3, chkPlat.b.y + 0.5, chkPlat.b.z, {
    v: 0x33ddff,
    c: 0xff9933,
    s: 0x5533aa,
    k: 0xd9a070
  });

  mkKid(goalPos.x + 3.5, goalPos.y - 0.5, goalPos.z, {
    v: 0xff55aa,
    c: 0x33ffcc,
    s: 0x223388,
    k: 0xf0c8a0
  });

  mkKid(0, 0.5, 2.5, {
    v: 0xaa55ff,
    c: 0x33ddff,
    s: 0x883322,
    k: 0xb87850
  });

  // Add Zapkin to the level.
  mkCritter();

  // Record the number of collectibles in this level.
  orbTotal = orbs.length;
  orbCount = 0;
}

// Create a single collectible orb.
function orbMesh(x, y, z) {
  const mesh = new T.Mesh(
    new T.SphereGeometry(0.3, 12, 10),
    new T.MeshBasicMaterial({ color: 0xffaa33 })
  );

  mesh.position.set(x, y, z);
  L.add(mesh);

  return mesh;
}

// Add a timed laser hazard to a platform.
function laser(o, r) {
  const mesh = new T.Mesh(
    BX,
    new T.MeshBasicMaterial({ color: 0xff2255 })
  );

  mesh.scale.set(o.w, 0.12, 0.12);
  mesh.position.set(
    o.b.x,
    o.b.y + 1.5,
    o.b.z + (r() - 0.5) * o.d * 0.5
  );
  L.add(mesh);

  hazards.push({
    k: 'l',
    m: mesh,
    o,
    ph: Math.random() * 3,
    w: o.w
  });
}

// Add a rotating bar hazard.
function spinner(o, n) {
  const mesh = new T.Mesh(
    BX,
    new T.MeshStandardMaterial({
      color: 0x331122,
      emissive: 0xff3355,
      emissiveIntensity: 0.8
    })
  );

  mesh.scale.set(o.w * 1.1, 0.5, 0.5);
  mesh.castShadow = true;
  mesh.position.set(o.b.x, o.b.y + 1.1, o.b.z);
  L.add(mesh);

  hazards.push({
    k: 's',
    m: mesh,
    o,
    sp: 1.4 + n / 25,
    len: o.w * 1.1
  });
}

// Add a region that changes the player's gravity.
function zone(o, gravity) {
  const mesh = new T.Mesh(
    BX,
    new T.MeshBasicMaterial({
      color: gravity < 1 ? 0x55aaff : 0xff5533,
      transparent: true,
      opacity: 0.08,
      depthWrite: false
    })
  );

  mesh.scale.set(o.w + 2, 9, o.d + 2);
  mesh.position.set(o.b.x, o.b.y + 4, o.b.z);
  L.add(mesh);

  zones.push({
    m: mesh,
    g: gravity,
    w: o.w + 2,
    d: o.d + 2
  });
}

// Build a boss for the current world's boss level.
function mkBoss(x, y, z, world) {
  const group = new T.Group();
  const colour = [
    0x33ddff,
    0xff3355,
    0xff9933,
    0xaa55ff,
    0xffffff
  ][world];

  const body = new T.Mesh(
    BX,
    new T.MeshStandardMaterial({
      color: 0x222244,
      emissive: colour,
      emissiveIntensity: 0.6
    })
  );
  body.scale.set(4, 4, 4);
  body.position.y = 2;
  body.castShadow = true;
  group.add(body);

  const eye = new T.Mesh(
    new T.SphereGeometry(0.7),
    new T.MeshBasicMaterial({ color: 0xffffff })
  );
  eye.position.set(0, 2.6, -2);
  group.add(eye);

  // The boss's top ornament changes shape between worlds.
  const ornament = new T.Mesh(
    world % 2
      ? new T.ConeGeometry(1.2, 2, 4)
      : new T.OctahedronGeometry(1.2),
    new T.MeshStandardMaterial({
      color: colour,
      emissive: colour,
      emissiveIntensity: 0.9
    })
  );
  ornament.position.y = 5;
  group.add(ornament);

  group.position.set(x, y, z);
  L.add(group);

  return {
    g: group,
    b: body,
    hp: 4 + world,
    max: 4 + world,
    wd: world,
    t: 0,
    stun: 0,
    vy: 0,
    y0: y,
    home: V(x, y, z),
    dash: 0,
    col: colour
  };
}

// -----------------------------------------------------------------------------
// Starting, restarting, and completing levels
// -----------------------------------------------------------------------------

function start(n) {
  // Audio is initialized here because this is called from a user action.
  ac();

  cur = Math.min(n, 50);
  build(cur);
  ui('');

  $('hud').classList.add('on');
  mode = 'play';

  // Reset the main player values for a fresh attempt.
  Object.assign(P, {
    hp: 100,
    en: 0,
    combo: 0,
    inv: 0,
    sh: 0,
    ride: null,
    air: 1
  });

  // Select the highest skill unlocked for this level.
  P.sel = 0;
  chkSet = false;
  respawn(true);
  $('chk').textContent = '';

  const lastAbility = ABL.reduce(
    (best, unlockLevel, index) => cur >= unlockLevel ? index : best,
    -1
  );

  P.sel = Math.max(0, lastAbility);
  saveLv();
}

// Kept as a placeholder for level-saving behaviour.
function saveLv() {}

let chkSet = false;

// Put the player back at the saved spawn point.
function respawn(full) {
  P.p.copy(spawn);
  trail.length = 0;
  P.v.set(0, 0, 0);

  // A short invulnerability period prevents immediate repeated damage.
  if (!full) {
    P.inv = 1.5;
  }
}

// Return to the title screen.
function toMenu() {
  mode = 'menu';
  $('hud').classList.remove('on');
  ui('menu');
  build(1);
  mus = 'bg';
}

// Show or leave the pause screen.
function pause() {
  if (mode === 'play') {
    mode = 'pause';
    ui('pause');
  }
}

function resume() {
  mode = 'play';
  ui('');
}

/*
 * Apply damage unless the player is invulnerable, shielded, or not playing.
 * Optional knockback values push the player away from the damage source.
 */
function hurt(amount, knockX, knockZ) {
  if (P.inv > 0 || P.sh > 0 || mode !== 'play') return;

  P.hp -= amount;
  P.inv = 1;

  snd(110, 0.3, 'sawtooth', 0.3, -60);
  burst(P.p, 0xff3355, 18);

  if (knockX !== undefined) {
    P.v.x = knockX;
    P.v.z = knockZ;
    P.v.y = Math.max(P.v.y, 6);
  }

  if (P.hp <= 0) {
    mode = 'over';
    mus = 'bg';
    ui('over');
  }
}

// Store progress and display the completion screen.
function complete() {
  mode = 'win';
  mus = 'win';

  const totalOrbs = orbTotal;
  const collectedOrbs = orbCount;

  save.orbs[cur] = Math.max(save.orbs[cur] || 0, collectedOrbs);
  save.unlocked = Math.max(save.unlocked, Math.min(50, cur + 1));
  persist();

  snd(660, 0.5, 'triangle', 0.3, 400);

  $('wt').textContent = cur === 50
    ? 'YOU ESCAPED THE FACILITY!'
    : 'LEVEL ' + cur + ' COMPLETE';

  // Move Zapkin beside Kai to show that it has returned to its owner.
  crit.position.set(
    kids[1].g.position.x - 1,
    kids[1].y,
    kids[1].g.position.z
  );

  $('wp').textContent =
    'Orbs: ' + collectedOrbs + ' / ' + totalOrbs +
    (cur % 10 === 0 ? ' – BOSS DEFEATED' : '') +
    ' · Zapkin is back with its owner!';

  // There is no level after the final one.
  $('nx').style.display = cur === 50 ? 'none' : '';
  ui('win');
}

// -----------------------------------------------------------------------------
// Keyboard, mouse, and touch controls
// -----------------------------------------------------------------------------

// Track keyboard input and trigger one-shot actions.
addEventListener('keydown', event => {
  keys[event.code] = true;

  if (event.code === 'Space') {
    jumpReq = 0.15;
    event.preventDefault();
  }

  if (event.code === 'Escape') {
    mode === 'play'
      ? pause()
      : mode === 'pause' && resume();
  }

  if (event.code === 'KeyQ') useAb();
  if (event.code === 'KeyE') interact();
  if (event.code === 'KeyR') cycle();

  // Number keys select skills once their unlock level has been reached.
  if (/^Digit[1-4]$/.test(event.code)) {
    const index = +event.code[5] - 1;

    if (cur >= ABL[index]) {
      P.sel = index;
    }
  }
});

addEventListener('keyup', event => {
  keys[event.code] = false;
});

// Mouse or touch dragging rotates the camera.
let drag = null;

R.domElement.addEventListener('pointerdown', event => {
  drag = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY
  };

  ac();
});

addEventListener('pointermove', event => {
  if (
    drag &&
    event.pointerId === drag.id &&
    !(event.pointerType === 'touch' && drag.x < innerWidth * 0.4)
  ) {
    yaw -= (event.clientX - drag.x) * 0.005;
    pitch = cl(
      pitch + (event.clientY - drag.y) * 0.004,
      0.1,
      1.2
    );
  }

  // Update the saved pointer position for the next movement event.
  if (drag && event.pointerId === drag.id) {
    drag.x = event.clientX;
    drag.y = event.clientY;
  }
});

addEventListener('pointerup', () => {
  drag = null;
});

// Add a joystick and action buttons on touch-capable devices.
if ('ontouchstart' in window) {
  document.body.classList.add('touch');

  const joystick = $('joy');
  const knob = $('kn');

  // Convert the pointer's position into normalized joystick values.
  const moveJoystick = event => {
    const rect = joystick.getBoundingClientRect();
    const dx = event.clientX - rect.left - 60;
    const dy = event.clientY - rect.top - 60;
    const length = Math.min(1, Math.hypot(dx, dy) / 50);
    const angle = Math.atan2(dy, dx);

    joy.x = Math.cos(angle) * length;
    joy.y = Math.sin(angle) * length;

    knob.style.left = 40 + joy.x * 40 + 'px';
    knob.style.top = 40 + joy.y * 40 + 'px';
  };

  joystick.addEventListener('pointerdown', event => {
    event.stopPropagation();
    joystick.setPointerCapture(event.pointerId);
    moveJoystick(event);
  });

  joystick.addEventListener('pointermove', event => {
    if (event.buttons || event.pressure) {
      moveJoystick(event);
    }
  });

  joystick.addEventListener('pointerup', () => {
    joy.x = 0;
    joy.y = 0;
    knob.style.left = '40px';
    knob.style.top = '40px';
  });

  // Small helper for connecting touch buttons to game actions.
  const bindTouchButton = (id, onDown, onUp) => {
    const button = $(id);

    button.addEventListener('pointerdown', event => {
      event.stopPropagation();
      onDown();
    });

    if (onUp) {
      button.addEventListener('pointerup', onUp);
    }
  };

  bindTouchButton('bJ', () => jumpReq = 0.15);
  bindTouchButton('bB', () => touchBoost = true, () => touchBoost = false);
  bindTouchButton('bA', useAb);
  bindTouchButton('bC', cycle);
}

// Select the next skill that is unlocked for the current level.
function cycle() {
  for (let i = 1; i <= 4; i++) {
    const next = (P.sel + i) % 4;

    if (cur >= ABL[next]) {
      P.sel = next;
      break;
    }
  }
}

/*
 * Use the currently selected ability, if it is unlocked and the player has
 * enough energy.
 */
function useAb() {
  if (mode !== 'play' || cur < ABL[P.sel] || P.en < ABC[P.sel]) return;

  const skill = P.sel;
  P.en -= ABC[skill];

  // Skill 1: launch the player upward.
  if (skill === 0) {
    P.v.y = 20;
    snd(300, 0.3, 'square', 0.2, 500);
  }

  // Skill 2: temporarily protect the player from damage.
  if (skill === 1) {
    P.sh = 5;
    snd(500, 0.4, 'sine', 0.2, 300);
  }

  // Skill 3: damage nearby enemies and bosses.
  if (skill === 2) {
    snd(90, 0.4, 'sawtooth', 0.3, -40);
    burst(P.p, 0xffaa33, 60, 9);

    for (const enemy of enemies) {
      if (!enemy.dead && enemy.g.position.distanceTo(P.p) < 9) {
        enemy.dead = true;
        L.remove(enemy.g);
      }
    }

    if (BOSS && BOSS.g.position.distanceTo(P.p) < 10) {
      hitBoss();
    }
  }

  // Skill 4: teleport back to the checkpoint or forward to the goal area.
  if (skill === 3) {
    const target = P.p.z > chkZ + 5 ? chkPlat.b : goalPos;

    P.p.set(target.x, target.y + 2.5, target.z);
    P.v.set(0, 0, 0);

    burst(P.p, 0xaa55ff, 30);
    snd(900, 0.3, 'sine', 0.2, -700);
  }
}

// Use E near the checkpoint to restore some health.
function interact() {
  if (
    mode === 'play' &&
    chkPlat &&
    P.p.distanceTo(chkPlat.m.position) < 7 &&
    !chkPlat.used
  ) {
    chkPlat.used = true;
    P.hp = Math.min(100, P.hp + 30);

    snd(700, 0.2);
    burst(P.p, 0x44ff88, 20);
  }
}

// -----------------------------------------------------------------------------
// Boss combat
// -----------------------------------------------------------------------------

// Reduce the boss's health and briefly stun it.
function hitBoss() {
  if (BOSS.stun > 0) return;

  BOSS.hp--;
  BOSS.stun = 1.4;

  snd(150, 0.4, 'square', 0.3, -80);
  burst(BOSS.g.position.clone().add(V(0, 3, 0)), BOSS.col, 40, 8);

  if (BOSS.hp <= 0) {
    burst(BOSS.g.position.clone().add(V(0, 2, 0)), 0xffffff, 80, 12);

    L.remove(BOSS.g);
    BOSS = null;

    $('boss').hidden = true;
    goal.visible = true;
    mus = 'bg';

    snd(80, 0.8, 'sawtooth', 0.4, -50);
  }
}

/*
 * Update boss movement, attacks, jumping, and collisions with the player.
 */
function bossUp(dt) {
  const boss = BOSS;

  boss.stun -= dt;

  // Make the boss flash while it is stunned.
  boss.b.material.emissiveIntensity = boss.stun > 0
    ? (Math.sin(time * 30) > 0 ? 2 : 0.1)
    : 0.6;

  const group = boss.g;
  const dx = P.p.x - group.position.x;
  const dz = P.p.z - group.position.z;
  const distance = Math.hypot(dx, dz) || 1;

  // Turn the boss toward the player.
  group.rotation.y = Math.atan2(-dx, -dz);

  if (boss.stun <= 0) {
    let speed = 2.2 + boss.wd * 0.5;

    // A dash temporarily makes the boss move much faster.
    if (boss.dash > 0) {
      speed *= 3.5;
      boss.dash -= dt;
    }

    // Chase the player, but keep the boss close to its arena.
    group.position.x = cl(
      group.position.x + dx / distance * speed * dt,
      boss.home.x - 10,
      boss.home.x + 10
    );

    group.position.z = cl(
      group.position.z + dz / distance * speed * dt,
      boss.home.z - 10,
      boss.home.z + 10
    );

    boss.t += dt;

    // Choose an attack after a short delay.
    if (boss.t > 3.6 - boss.wd * 0.25) {
      boss.t = 0;

      const attack = boss.wd === 4
        ? Math.floor(Math.random() * 4)
        : boss.wd;

      // Attack 1: dash toward the player.
      if (attack === 0) {
        boss.dash = 0.9;
      }

      // Attack 2: fire three projectiles in a spread.
      if (attack === 1) {
        for (let i = -1; i <= 1; i++) {
          const mesh = new T.Mesh(
            new T.SphereGeometry(0.4),
            new T.MeshBasicMaterial({ color: 0xff3355 })
          );

          mesh.position.copy(group.position).add(V(0, 2.5, 0));
          L.add(mesh);

          const angle = Math.atan2(dx, dz) + i * 0.3;

          projs.push({
            m: mesh,
            v: V(Math.sin(angle) * 11, 0, Math.cos(angle) * 11),
            life: 4
          });
        }

        snd(500, 0.2, 'square', 0.15, -300);
      }

      // Attack 3: jump into the air.
      if (attack === 2) {
        boss.vy = 13;
      }

      // Attack 4: teleport to another spot in the arena.
      if (attack === 3) {
        group.position.x = boss.home.x + (Math.random() - 0.5) * 16;
        group.position.z = boss.home.z + (Math.random() - 0.5) * 16;
        burst(group.position, 0xaa55ff, 30);
      }
    }
  }

  // Apply gravity to the boss during its jump.
  if (boss.vy !== 0 || group.position.y > boss.y0) {
    boss.vy -= 30 * dt;
    group.position.y += boss.vy * dt;

    if (group.position.y <= boss.y0) {
      group.position.y = boss.y0;

      if (boss.vy < -8) {
        burst(group.position, 0xff9933, 30, 8);
        snd(60, 0.4, 'sawtooth', 0.4);

        // The landing shockwave can hurt a grounded player nearby.
        if (P.gr && Math.hypot(dx, dz) < 8) {
          hurt(20);
        }
      }

      boss.vy = 0;
    }
  }

  // Check whether the player is close enough to hit or be hit.
  const top = group.position.y + 4;
  const absDx = Math.abs(P.p.x - group.position.x);
  const absDz = Math.abs(P.p.z - group.position.z);

  if (
    absDx < 2.5 &&
    absDz < 2.5 &&
    P.p.y > group.position.y - 0.5 &&
    P.p.y < top + 0.9
  ) {
    // Landing on the boss from above deals damage.
    if (P.p.y - 0.5 >= top - 0.7 && P.v.y < 0) {
      if (boss.stun <= 0) {
        hitBoss();
        P.v.y = 15;
      } else {
        P.v.y = 12;
      }
    } else if (boss.stun <= 0) {
      // Touching the boss from the side damages and knocks back the player.
      hurt(20, dx / distance * 10, dz / distance * 10);
    }
  }

  // Keep the boss health bar in sync with its remaining health.
  $('bhp').style.width = BOSS
    ? boss.hp / boss.max * 100 + '%'
    : 0;
}

// -----------------------------------------------------------------------------
// Platform animation and collision handling
// -----------------------------------------------------------------------------

/*
 * Animate a platform and calculate how far it moved this frame.
 * The movement delta is used to carry the player when standing on it.
 */
function upd(o) {
  const mesh = o.m;
  const oldX = mesh.position.x;
  const oldY = mesh.position.y;
  const oldZ = mesh.position.z;
  const phase = time + o.ph;

  // Gummy platforms squash briefly when the player lands on them.
  if (o.t === 'gum') {
    o.sq = Math.max(0, (o.sq || 0) - 1 / 60);

    const scale =
      1 +
      Math.sin(time * 3 + o.ph) * 0.04 +
      Math.sin(o.sq * 30) * 0.25 * o.sq / 0.35;

    mesh.scale.set(o.w * scale, o.h / scale, o.d * scale);
  }

  // Moving platforms travel along one axis.
  if (o.t === 'mx') {
    mesh.position.x = o.b.x + Math.sin(phase * 0.8) * 3;
  } else if (o.t === 'mz') {
    mesh.position.z = o.b.z + Math.sin(phase * 0.8) * 3;
  } else if (o.t === 'my') {
    mesh.position.y = o.b.y + Math.sin(phase * 0.9) * 2.2;
  } else if (o.t === 'dis') {
    // Disappearing platforms fade out, then flicker before returning.
    o.on = phase % 4 < 2.6;

    mesh.visible = o.on || phase % 4 > 3.7
      ? o.on || Math.floor(phase * 10) % 2 === 0
      : false;

    if (!o.on && phase % 4 < 3.7) {
      mesh.visible = false;
    }
  } else if (o.t === 'elec') {
    // Electric platforms alternate between active and safe states.
    o.on = phase % 3 < 1.4;
    o.e.material.color.setHex(o.on ? 0xff2244 : 0xffcc00);
    mesh.material.emissive.setHex(o.on ? 0xff2244 : 0xffcc00);
  } else if (o.t === 'fall' && o.tm) {
    // A falling platform waits briefly, drops, then resets.
    if (time - o.tm > 0.6) {
      o.vy -= 25 * (1 / 60);
      mesh.position.y += o.vy / 60;

      if (time - o.tm > 3.5) {
        o.tm = 0;
        o.vy = 0;
        mesh.position.copy(o.b);
      }
    } else {
      // Shake slightly before it starts falling.
      mesh.position.x = o.b.x + (Math.random() - 0.5) * 0.1;
    }
  }

  // Store the platform's movement since the previous update.
  o.dx.set(
    mesh.position.x - oldX,
    mesh.position.y - oldY,
    mesh.position.z - oldZ
  );
}

/*
 * Resolve collisions between the player's spherical collider and platforms.
 *
 * The player's visible ball has radius 0.5. For each box platform, the closest
 * point on the box is found and used to determine whether the sphere overlaps.
 */
function collide(dt) {
  const radius = 0.5;
  const p = P.p;
  const v = P.v;

  P.gr = false;

  for (const o of plats) {
    if (!o.m.visible) continue;

    const center = o.m.position;
    const halfW = o.w / 2;
    const halfH = o.h / 2;
    const halfD = o.d / 2;

    // Find the closest point on the platform to the player.
    const qx = cl(p.x, center.x - halfW, center.x + halfW);
    const qy = cl(p.y, center.y - halfH, center.y + halfH);
    const qz = cl(p.z, center.z - halfD, center.z + halfD);

    let nx = p.x - qx;
    let ny = p.y - qy;
    let nz = p.z - qz;

    const distanceSquared = nx * nx + ny * ny + nz * nz;

    // The player is not touching this platform.
    if (distanceSquared >= radius * radius) continue;

    const distance = Math.sqrt(distanceSquared);
    let penetration;

    if (distance > 1e-5) {
      // Normal points away from the platform surface.
      nx /= distance;
      ny /= distance;
      nz /= distance;
      penetration = radius - distance;
    } else {
      // If the player is exactly inside the box, push upward.
      nx = 0;
      ny = 1;
      nz = 0;
      penetration = radius + halfH - (p.y - center.y);
    }

    // Push the player out of the platform.
    p.x += nx * penetration;
    p.y += ny * penetration;
    p.z += nz * penetration;

    // Velocity toward the surface is used to calculate bouncing.
    const velocityAlongNormal = v.x * nx + v.y * ny + v.z * nz;

    if (o.t === 'gum') {
      // Gummies bounce the player much more strongly than normal platforms.
      if (velocityAlongNormal < 0) {
        const bounce = -2.3 * velocityAlongNormal;

        v.x += nx * bounce;
        v.y += ny * bounce;
        v.z += nz * bounce;

        if (ny > 0.5) {
          v.y = Math.max(v.y, 16);
        }

        o.sq = 0.35;
        cboost = 1;

        snd(250, 0.25, 'sine', 0.3, 300);
        burst(p, 0xff66cc, 10, 4);
      }
    } else if (velocityAlongNormal < 0) {
      const impactSpeed = -velocityAlongNormal;

      if (ny > 0.5) {
        // The player has landed on top of the platform.
        P.gr = true;
        P.ride = o;

        if (o.t === 'pad') {
          // Orange pads launch the player upward automatically.
          v.y = 22;
          snd(260, 0.3, 'square', 0.2, 500);
          burst(p, 0xff9933, 16);
        } else if (impactSpeed > 5) {
          // A hard landing triggers a bounce and builds a combo.
          P.combo++;

          const elasticity = 0.5 + Math.min(P.combo, 6) * 0.04;

          v.x -= (1 + elasticity) * velocityAlongNormal * nx;
          v.y -= (1 + elasticity) * velocityAlongNormal * ny;
          v.z -= (1 + elasticity) * velocityAlongNormal * nz;

          // Holding jump during a landing gives an extra bounce.
          if (keys.Space || jumpReq > 0) {
            v.y = Math.min(21, Math.max(v.y, 12 + P.combo * 1.3));
          }

          P.en = Math.min(100, P.en + 4 * P.combo);

          snd(180 + P.combo * 40, 0.15, 'sine', 0.3, 200);
          burst(p, TH.p, 8, 3);
        } else {
          // A gentle landing stops the downward velocity.
          v.x -= velocityAlongNormal * nx;
          v.y -= velocityAlongNormal * ny;
          v.z -= velocityAlongNormal * nz;

          if (P.combo && P.gt > 0.35) {
            P.combo = 0;
          }
        }

        // Start the timer that causes a falling platform to drop.
        if (o.t === 'fall' && !o.tm) {
          o.tm = time;
        }

        // Active electric platforms damage the player.
        if (o.t === 'elec' && o.on) {
          hurt(15);
        }

        // Touching a checkpoint saves the player's respawn position.
        if (o.t === 'chk' && !o.used0) {
          o.used0 = true;
          spawn.set(
            o.m.position.x,
            o.m.position.y + 1.6,
            o.m.position.z
          );

          $('chk').textContent =
            '◆ CHECKPOINT REACHED (press E near it to repair)';

          snd(800, 0.2, 'triangle', 0.25, 300);
          burst(p, 0x44ff88, 24);
        }
      } else {
        // Side collisions remove most of the velocity toward the wall.
        v.x -= 1.6 * velocityAlongNormal * nx;
        v.y -= 1.6 * velocityAlongNormal * ny;
        v.z -= 1.6 * velocityAlongNormal * nz;

        if (impactSpeed > 4) {
          snd(130, 0.1, 'triangle', 0.2);
        }
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Main gameplay update
// -----------------------------------------------------------------------------

function step(dt) {
  time += dt;

  // Update moving, falling, and animated platforms first.
  for (const platform of plats) {
    upd(platform);
  }

  // Carry the player along with the platform they were standing on.
  if (P.ride && P.ride.m.visible) {
    P.p.add(P.ride.dx);
  }
  P.ride = null;

  const p = P.p;
  const v = P.v;

  // Update temporary effects and timers.
  P.inv -= dt;
  P.sh -= dt;
  jumpReq -= dt;
  shield.visible = P.sh > 0;

  // Combine keyboard and joystick input.
  let ix =
    (keys.KeyD || keys.ArrowRight ? 1 : 0) -
    (keys.KeyA || keys.ArrowLeft ? 1 : 0) +
    joy.x;

  let iz =
    (keys.KeyW || keys.ArrowUp ? 1 : 0) -
    (keys.KeyS || keys.ArrowDown ? 1 : 0) -
    joy.y;

  // Normalize diagonal input so it is not faster than straight movement.
  const inputLength = Math.hypot(ix, iz);

  if (inputLength > 1) {
    ix /= inputLength;
    iz /= inputLength;
  }

  // Rotate the movement direction to match the camera's horizontal angle.
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const wx = cy * ix - sy * iz;
  const wz = -sy * ix - cy * iz;

  // Boost consumes energy while the player is moving.
  const boosting =
    (keys.ShiftLeft || keys.ShiftRight || touchBoost) &&
    P.en > 0 &&
    inputLength > 0;

  if (boosting) {
    P.en -= 12 * dt;
  }

  const speed = boosting ? 12 : 7;
  const acceleration = Math.min(1, (P.coy > 0 ? 10 : 3.5) * dt);

  if (inputLength > 0) {
    v.x += (wx * speed - v.x) * acceleration;
    v.z += (wz * speed - v.z) * acceleration;
  } else if (P.coy > 0) {
    // Slow down gradually when grounded.
    v.x *= 1 - 5 * dt;
    v.z *= 1 - 5 * dt;
  }

  // A short coyote-time window lets the player jump just after leaving a ledge.
  P.coy = P.gr ? 0.1 : P.coy - dt;
  P.gt = P.gr ? P.gt + dt : 0;

  // Later levels allow the player to regain one air jump after landing.
  if (P.gr) {
    P.air = cur >= 3 ? 1 : 0;
  }

  // Jump either from the ground or, when available, once in mid-air.
  if (jumpReq > 0) {
    if (P.coy > 0) {
      v.y = 11;
      P.coy = 0;
      jumpReq = 0;

      snd(320, 0.15, 'sine', 0.2, 200);
    } else if (P.air > 0) {
      P.air--;
      v.y = 10;
      jumpReq = 0;

      snd(420, 0.15, 'sine', 0.2, 250);
      burst(p, TH.p, 10, 3);
    }
  }

  // Gravity zones multiply the normal gravity while the player is inside them.
  let gravity = 26;

  for (const zone of zones) {
    const center = zone.m.position;

    if (
      Math.abs(p.x - center.x) < zone.w / 2 &&
      Math.abs(p.y - center.y) < 4.5 &&
      Math.abs(p.z - center.z) < zone.d / 2
    ) {
      gravity *= zone.g;
    }
  }

  // Two smaller physics steps help make platform collisions more reliable.
  for (let i = 0; i < 2; i++) {
    const halfStep = dt / 2;

    v.y -= gravity * halfStep;
    p.addScaledVector(v, halfStep);
    collide(halfStep);
  }

  // Play a rolling sound now and then while the player is moving on the ground.
  if (P.gr && Math.hypot(v.x, v.z) > 2) {
    P.rt += dt;

    if (P.rt > 0.22) {
      P.rt = 0;
      snd(60 + Math.hypot(v.x, v.z) * 5, 0.08, 'sine', 0.12);
    }
  }

  // Energy slowly regenerates during play.
  P.en = Math.min(100, P.en + 1.5 * dt);

  // Falling below the level costs health and returns the player to the spawn.
  if (p.y < -30) {
    P.hp -= 25;
    snd(80, 0.4, 'sawtooth', 0.3, -50);

    if (P.hp <= 0) {
      mode = 'over';
      ui('over');
    } else {
      respawn();
    }
  }

  // ---------------------------------------------------------------------------
  // Hazards
  // ---------------------------------------------------------------------------

  for (const hazard of hazards) {
    if (hazard.k === 's') {
      // Rotate the spinning bar and keep it attached to its platform.
      hazard.m.rotation.y += hazard.sp * dt;

      const center = hazard.m.position;
      const dx =
        p.x -
        (center.x + hazard.o.dx.x * 0) -
        (hazard.o.m.position.x - hazard.o.b.x);

      const dz =
        p.z -
        center.z -
        (hazard.o.m.position.z - hazard.o.b.z);

      const angle = -hazard.m.rotation.y;
      const localX = dx * Math.cos(angle) - dz * Math.sin(angle);
      const localZ = dx * Math.sin(angle) + dz * Math.cos(angle);

      hazard.m.position.x = hazard.o.m.position.x;
      hazard.m.position.z = hazard.o.m.position.z;
      hazard.m.position.y = hazard.o.m.position.y + 1.1;

      if (
        Math.abs(localX) < hazard.len / 2 + 0.4 &&
        Math.abs(localZ) < 0.7 &&
        Math.abs(p.y - hazard.m.position.y) < 0.9
      ) {
        hurt(15, Math.sign(dx) * 8, Math.sign(dz) * 8);
      }
    } else {
      // Lasers switch between visible/active and hidden/inactive states.
      const active = (time + hazard.ph) % 3 < 1.6;

      hazard.m.visible = active;
      hazard.m.position.x = hazard.o.m.position.x;
      hazard.m.position.y = hazard.o.m.position.y + 1.5;

      if (
        active &&
        Math.abs(p.z - hazard.m.position.z) < 0.6 &&
        Math.abs(p.y - hazard.m.position.y) < 0.8 &&
        Math.abs(p.x - hazard.m.position.x) < hazard.w / 2
      ) {
        hurt(20);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Enemies
  // ---------------------------------------------------------------------------

  for (const enemy of enemies) {
    if (enemy.dead) continue;

    const platform = enemy.o;

    // Enemies move side to side across their platform.
    const offset = Math.sin(time * 1.2 + enemy.ph) * platform.w * 0.35;

    enemy.g.position.set(
      platform.m.position.x + offset,
      platform.m.position.y + 0.5,
      platform.m.position.z
    );

    enemy.g.rotation.y = Math.cos(time * 1.2 + enemy.ph) > 0
      ? -Math.PI / 2
      : Math.PI / 2;

    const dx = p.x - enemy.g.position.x;
    const dz = p.z - enemy.g.position.z;
    const dy = p.y - enemy.g.position.y;

    if (
      Math.abs(dx) < 0.9 &&
      Math.abs(dz) < 0.9 &&
      dy > -0.3 &&
      dy < 1.6
    ) {
      if (dy > 0.9 && v.y < 0) {
        // Jumping on an enemy defeats it and bounces the player upward.
        enemy.dead = true;
        L.remove(enemy.g);
        v.y = 13;

        snd(220, 0.2, 'square', 0.25, -120);
        burst(enemy.g.position, 0xff6611, 20);

        P.en = Math.min(100, P.en + 10);
      } else {
        hurt(15, Math.sign(dx) * 8, Math.sign(dz) * 8);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Boss projectiles
  // ---------------------------------------------------------------------------

  for (let i = projs.length - 1; i >= 0; i--) {
    const projectile = projs[i];

    projectile.m.position.addScaledVector(projectile.v, dt);
    projectile.life -= dt;

    if (projectile.m.position.distanceTo(p) < 0.9) {
      hurt(15);
      projectile.life = 0;
    }

    if (projectile.life <= 0) {
      L.remove(projectile.m);
      projs.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Kai and Zapkin
  // ---------------------------------------------------------------------------

  // Kai looks toward the player and waves when the player is nearby.
  for (const kid of kids) {
    const position = kid.g.position;
    const dx = p.x - position.x;
    const dz = p.z - position.z;
    const nearby = Math.hypot(dx, dz) < 9;

    kid.g.rotation.y = Math.atan2(-dx, -dz);
    kid.g.position.y = kid.y + (
      nearby
        ? Math.abs(Math.sin(time * 6 + kid.ph)) * 0.25
        : 0
    );

    kid.arm.rotation.z = nearby
      ? 2.7 + Math.sin(time * 9) * 0.45
      : 0.1;
  }

  // Keep a short history of the player's positions for Zapkin to follow.
  trail.push(p.clone());

  if (trail.length > 45) {
    trail.shift();
  }

  {
    const target = trail[0];
    const position = crit.position;

    // If Zapkin gets too far away, move it back near the trail.
    if (Math.hypot(target.x - position.x, target.z - position.z) > 25) {
      position.set(target.x, target.y, target.z);
    }

    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const distance = Math.hypot(dx, dz);
    const followAmount = Math.min(1, 6 * dt);

    position.x += dx * followAmount;
    position.z += dz * followAmount;

    // Smoothly move Zapkin up or down to match the trail's height.
    crit.userData.by +=
      (target.y - 0.5 - crit.userData.by) * Math.min(1, 10 * dt);

    cboost = Math.max(0, cboost - dt);

    // Make Zapkin hop when moving or when the player bounces on a gummy.
    position.y = crit.userData.by +
      (
        distance > 0.4 || cboost > 0
          ? Math.abs(Math.sin(time * 9)) * 0.45 * (1 + cboost * 2)
          : 0
      );

    if (distance > 0.3) {
      crit.rotation.y = Math.atan2(-dx, -dz);
    }
  }

  // Update the boss if this is a boss level.
  if (BOSS) {
    bossUp(dt);
  }

  // ---------------------------------------------------------------------------
  // Collectibles and exit
  // ---------------------------------------------------------------------------

  for (const orb of orbs) {
    if (orb.got) continue;

    orb.m.rotation.y += dt * 3;
    orb.m.position.y += Math.sin(time * 3) * 0.002;

    if (orb.m.position.distanceTo(p) < 1) {
      orb.got = true;
      L.remove(orb.m);

      orbCount++;
      P.en = Math.min(100, P.en + 10);

      snd(900, 0.1, 'sine', 0.2, 400);
      burst(orb.m.position, 0xffaa33, 8, 3);
    }
  }

  // The exit ring spins and completes the level when the player reaches it.
  if (goal.visible) {
    goal.rotation.y += dt * 2;

    if (p.distanceTo(goalPos) < 2.2) {
      complete();
    }
  }

  // ---------------------------------------------------------------------------
  // Update player visuals
  // ---------------------------------------------------------------------------

  const horizontalSpeed = Math.hypot(v.x, v.z);

  // Rotate the ball in the direction it is travelling.
  if (horizontalSpeed > 0.1) {
    const axis = V(v.z, 0, -v.x).normalize();
    ball.rotateOnWorldAxis(axis, horizontalSpeed * dt / 0.5);
  }

  ball.position.copy(p);
  pLight.position.copy(p).add(V(0, 1, 0));

  // Flash while temporarily invulnerable after taking damage.
  if (P.inv > 0) {
    ball.visible = Math.floor(time * 20) % 2 === 0;
  } else {
    ball.visible = true;
  }

  // Add a small trail effect while boosting.
  if (boosting && Math.random() < 0.6) {
    burst(p, 0xffcc00, 1, 1);
  }
}

// -----------------------------------------------------------------------------
// Camera and HUD
// -----------------------------------------------------------------------------

// Follow the player during gameplay, or orbit the player on the title screen.
function camUp(dt, menu) {
  const target = ball.position;

  if (menu) {
    const angle = time * 0.25;

    C.position.set(
      target.x + Math.sin(angle) * 12,
      target.y + 6,
      target.z + Math.cos(angle) * 12
    );

    C.lookAt(target.x, target.y + 1, target.z - 6);
    return;
  }

  const distance = 9;
  const cosPitch = Math.cos(pitch);

  const desiredPosition = V(
    target.x + Math.sin(yaw) * cosPitch * distance,
    target.y + Math.sin(pitch) * distance + 1,
    target.z + Math.cos(yaw) * cosPitch * distance
  );

  // Smooth camera movement prevents the view from snapping instantly.
  C.position.lerp(
    desiredPosition,
    1 - Math.pow(0.0005, dt)
  );

  C.lookAt(target.x, target.y + 1, target.z);
}

// Update the health, energy, level, collectible, and skill displays.
function hud() {
  $('hp').firstChild.style.width = Math.max(0, P.hp) + '%';
  $('en').firstChild.style.width = P.en + '%';

  $('orb').textContent = '◉ Orbs ' + orbCount + ' / ' + orbTotal;

  const worldNames = [
    'Training Facility',
    'Laser Laboratory',
    'Abandoned Factory',
    'Energy Core',
    'Final Escape'
  ];

  $('lv').textContent =
    'Level ' + cur +
    ' · ' + worldNames[wd] +
    (cur % 10 === 0 ? ' · BOSS' : '');

  $('ab').textContent =
    (cur >= 3 ? 'Double Bounce ✔  ' : '') +
    (
      cur >= ABL[P.sel]
        ? 'Skill [Q]: ' + ABN[P.sel] + ' (cost ' + ABC[P.sel] + ')' +
          (P.combo > 1 ? '  combo x' + P.combo : '')
        : ''
    );
}

// -----------------------------------------------------------------------------
// Main animation loop
// -----------------------------------------------------------------------------

let last = performance.now();

function loop(now) {
  // Schedule the next frame before doing the current frame's work.
  requestAnimationFrame(loop);

  // Cap the frame time so a pause or slow frame does not cause a huge physics step.
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;

  if (mode === 'play') {
    step(dt);
    camUp(dt);
    hud();
  } else if (mode === 'menu') {
    // Keep the player gently bouncing on the title screen.
    time += dt;
    ball.position.set(
      0,
      1.1 + Math.abs(Math.sin(time * 3)) * 1.5,
      0
    );

    camUp(dt, true);
  }

  // Keep the directional light and player label near the player.
  sun.position.set(
    ball.position.x + 20,
    ball.position.y + 40,
    ball.position.z + 15
  );
  sun.target.position.copy(ball.position);

  ballTag.position.copy(ball.position).add(V(0, 1.2, 0));

  // Update particles and draw the finished scene.
  partUp(dt);
  R.render(S, C);
}

// Add the PokéVault logo to each screen that contains the `.lg` class.
document.querySelectorAll('.lg').forEach(element => {
  element.innerHTML =
    '<svg class="em" viewBox="0 0 40 40">' +
      '<circle cx="20" cy="20" r="18" fill="#000" stroke="#ffcc00" stroke-width="3"/>' +
      '<circle cx="20" cy="20" r="11" fill="#ff2233"/>' +
      '<circle cx="20" cy="20" r="4" fill="#ffcc00"/>' +
      '<rect x="19" y="20" width="2" height="9" fill="#ffcc00"/>' +
    '</svg>' +
    '<b>POKÉ<i>VAULT</i></b>';
});

// Prepare the first level and start rendering.
build(1);
P.p.copy(spawn);
requestAnimationFrame(loop);