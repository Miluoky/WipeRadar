/**
 * Procedural Rust-style island rendered as a diorama on a "map table":
 *  - square rounded landmass from seeded fBm noise (like Rust's procedural maps)
 *  - biomes by latitude — snow in the north, desert in the south, grass between, rock on the peaks
 *  - low-poly flat shading with per-vertex colour jitter so nothing looks machine-perfect
 *  - glassy water block, steel base plate, radar rings + a rotating sweep
 *  - red blips for "monuments"; real wipe events spawn an expanding ring
 *  - click regenerates the island from a new seed (the map "wipes" and rises out of the water)
 *
 * Loaded with a dynamic import after the page is idle, so it never touches first paint.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  WebGLRenderer,
  type Material,
} from "three";

const WORLD = 10; // island is WORLD × WORLD units
const SEGMENTS = 150;
const HEIGHT = 1.7;
const FLOOR = -0.5;

export interface IslandHandle {
  /** Spawn an expanding ring (a wipe just happened somewhere). */
  ping(): void;
  /** Rebuild the island from a new seed, with a rise animation. */
  regenerate(seed: number): void;
  dispose(): void;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed: number) {
  const rnd = mulberry32(seed);
  const G = 256;
  const grid = new Float32Array(G * G);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const s = (t: number) => t * t * (3 - 2 * t);
  const g = (i: number, j: number) => grid[((j & 255) << 8) | (i & 255)];
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = s(x - xi);
    const v = s(y - yi);
    const a = g(xi, yi);
    const b = g(xi + 1, yi);
    const c = g(xi, yi + 1);
    const d = g(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const PALETTE = {
  seabed: new Color("#4a5a52"),
  beach: new Color("#cdb882"),
  grass: new Color("#667a3c"),
  grassDark: new Color("#4d6130"),
  desert: new Color("#bf9f5c"),
  rock: new Color("#74705f"),
  peak: new Color("#a39f92"),
  snow: new Color("#e6ebec"),
  tundra: new Color("#8c9486"),
};

/** Fills position + colour attributes of the terrain for a seed. Returns land sample points. */
function buildTerrain(geo: BufferGeometry, seed: number): { x: number; z: number }[] {
  const noise = makeNoise(seed);
  const jitter = mulberry32(seed ^ 0x9e3779b9);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const land: { x: number; z: number }[] = [];
  const c = new Color();

  for (let i = 0; i < pos.count; i++) {
    const wx = pos.getX(i);
    const wz = pos.getZ(i);
    const x = (wx / WORLD) * 2; // −1..1
    const z = (wz / WORLD) * 2; // −1 = north (far side)
    const d = Math.pow(Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(z), 4), 0.25); // squarish
    const mask = 1 - smooth(0.52, 0.96, d);

    let n = 0;
    let amp = 0.55;
    let f = 1.5;
    for (let o = 0; o < 5; o++) {
      n += amp * noise(x * f + 11 + o * 3.1, z * f + 7 - o * 1.7);
      amp *= 0.5;
      f *= 2.05;
    }
    const h = mask * (0.16 + n * 1.2) - 0.3; // metres above sea level, before scaling
    const y = Math.max(FLOOR, h * HEIGHT);
    pos.setY(i, y);

    // colour
    const j = 1 + (jitter() - 0.5) * 0.14;
    if (h < 0.0) {
      c.copy(PALETTE.seabed).multiplyScalar(0.55 + Math.max(-0.4, h) * -0.4);
    } else if (h < 0.05) {
      c.copy(PALETTE.beach);
    } else if (z < -0.32 && h > 0.04) {
      c.copy(PALETTE.tundra).lerp(PALETTE.snow, smooth(-0.32, -0.62, z) * 0.9 + (h > 0.32 ? 0.2 : 0));
    } else if (z > 0.55 && h < 0.5) {
      c.copy(PALETTE.desert).lerp(PALETTE.grass, smooth(0.55, 0.45, z) * 0.6).lerp(PALETTE.rock, smooth(0.3, 0.5, h) * 0.8);
    } else {
      c.copy(PALETTE.grass).lerp(PALETTE.grassDark, smooth(0.1, 0.4, n));
      if (h > 0.5) c.lerp(PALETTE.rock, smooth(0.5, 0.7, h));
    }
    if (h > 0.72) c.lerp(PALETTE.peak, smooth(0.72, 0.95, h));
    c.multiplyScalar(j);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;

    if (h > 0.1 && h < 0.7) land.push({ x: wx, z: wz });
  }
  geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return land;
}

function disposeMaterial(m: Material | Material[]) {
  (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
}

export function mountIsland(host: HTMLElement, opts: { seed: number; reduceMotion: boolean }): IslandHandle {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  const canvas = renderer.domElement;
  canvas.style.cssText = "width:100%;height:100%;display:block;touch-action:pan-y";
  host.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 60);
  camera.position.set(0, 13.2, 17.4);
  camera.lookAt(0, -0.4, 0.3);

  scene.add(new HemisphereLight(0xffe7cf, 0x2a3128, 1.15));
  const sun = new DirectionalLight(0xffd9a8, 2.6);
  sun.position.set(6, 9, 4);
  scene.add(sun);

  const table = new Group();
  scene.add(table);

  // --- terrain
  const terrainGeo = new PlaneGeometry(WORLD, WORLD, SEGMENTS, SEGMENTS);
  terrainGeo.rotateX(-Math.PI / 2);
  let land = buildTerrain(terrainGeo, opts.seed);
  const terrain = new Mesh(terrainGeo, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  table.add(terrain);

  // --- water block (glassy), border, steel base
  const waterGeo = new BoxGeometry(WORLD, 0.5, WORLD);
  const water = new Mesh(
    waterGeo,
    new MeshBasicMaterial({ color: 0x1f5666, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  water.position.y = -0.25;
  table.add(water);
  const edges = new LineSegments(new EdgesGeometry(waterGeo), new LineBasicMaterial({ color: 0xe4dad1, transparent: true, opacity: 0.4 }));
  edges.position.y = -0.25;
  table.add(edges);

  const base = new Mesh(new BoxGeometry(WORLD + 0.7, 0.38, WORLD + 0.7), new MeshLambertMaterial({ color: 0x23231f }));
  base.position.y = -0.72;
  table.add(base);
  const baseRim = new LineSegments(
    new EdgesGeometry(new BoxGeometry(WORLD + 0.7, 0.38, WORLD + 0.7)),
    new LineBasicMaterial({ color: 0xcd412b, transparent: true, opacity: 0.8 }),
  );
  baseRim.position.y = -0.72;
  table.add(baseRim);

  // --- radar: range rings + sweep
  const ringMat = new MeshBasicMaterial({ color: 0xe8a93a, transparent: true, opacity: 0.18, side: DoubleSide, depthWrite: false });
  for (const r of [2.2, 3.9, 5.6]) {
    const ring = new Mesh(new RingGeometry(r, r + 0.025, 96), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    table.add(ring);
  }
  const SWEEP_SEG = 40;
  const sweepGeo = new CircleGeometry(WORLD * 0.62, SWEEP_SEG, 0, 0.95);
  sweepGeo.rotateX(-Math.PI / 2);
  const rgba = new Float32Array((SWEEP_SEG + 2) * 4);
  for (let i = 0; i < SWEEP_SEG + 2; i++) {
    const a = i === 0 ? 0.04 : 0.5 * (1 - (i - 1) / SWEEP_SEG); // leading edge bright, tail fades
    rgba.set([0.62, 0.78, 0.33, a], i * 4);
  }
  sweepGeo.setAttribute("color", new Float32BufferAttribute(rgba, 4));
  const sweep = new Mesh(
    sweepGeo,
    new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
  );
  sweep.position.y = 0.03;
  table.add(sweep);

  // --- monuments: little towers with a pulsing red blip
  const blips: { mesh: Mesh; ring: Mesh; phase: number }[] = [];
  const towerGeo = new CylinderGeometry(0.05, 0.08, 0.34, 6);
  const blipMat = new MeshBasicMaterial({ color: 0xcd412b });
  const pulseMat = new MeshBasicMaterial({ color: 0xcd412b, transparent: true, opacity: 0.6, depthWrite: false, side: DoubleSide });
  const pulseGeo = new RingGeometry(0.1, 0.13, 24);
  const placeBlips = () => {
    const rnd = mulberry32(opts.seed * 7 + 1);
    blips.splice(0).forEach((b) => {
      table.remove(b.mesh, b.ring);
    });
    for (let i = 0; i < 8 && land.length; i++) {
      const p = land[Math.floor(rnd() * land.length)];
      const y = sampleHeight(p.x, p.z);
      const mesh = new Mesh(towerGeo, blipMat);
      mesh.position.set(p.x, y + 0.17, p.z);
      const ring = new Mesh(pulseGeo, pulseMat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, y + 0.04, p.z);
      table.add(mesh, ring);
      blips.push({ mesh, ring, phase: rnd() * 6 });
    }
  };
  const sampleHeight = (x: number, z: number) => {
    // nearest-vertex lookup is plenty for placing props
    const step = WORLD / SEGMENTS;
    const i = Math.round((x + WORLD / 2) / step);
    const j = Math.round((z + WORLD / 2) / step);
    return terrainGeo.attributes.position.getY(j * (SEGMENTS + 1) + i);
  };
  placeBlips();

  // --- event rings
  const events: { mesh: Mesh; t0: number }[] = [];
  const ping = () => {
    if (!land.length) return;
    const p = land[Math.floor(Math.random() * land.length)];
    const m = new Mesh(new RingGeometry(0.08, 0.14, 40), new MeshBasicMaterial({ color: 0xe8a93a, transparent: true, opacity: 0.9, depthWrite: false, side: DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.x, sampleHeight(p.x, p.z) + 0.06, p.z);
    table.add(m);
    events.push({ mesh: m, t0: performance.now() });
  };

  // --- regenerate ("wipe")
  let riseStart = -1;
  const regenerate = (seed: number) => {
    opts.seed = seed;
    land = buildTerrain(terrainGeo, seed);
    placeBlips();
    riseStart = performance.now();
    ping();
    ping();
  };

  // --- interaction + sizing
  let px = 0;
  let py = 0;
  const onMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    px = ((e.clientX - r.left) / r.width - 0.5) * 2;
    py = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  host.addEventListener("pointermove", onMove);

  const resize = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the whole table in frame on tall/narrow hosts
    camera.fov = w / h < 1.2 ? 40 : 32;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  // --- loop (pauses off-screen and in background tabs)
  let raf = 0;
  let visible = true;
  let last = performance.now();
  let spin = 0.5;
  const frame = (now: number) => {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    spin += dt * 0.09;
    table.rotation.y += (spin + px * 0.35 - table.rotation.y) * Math.min(1, dt * 3);
    table.rotation.x += (py * 0.06 - table.rotation.x) * Math.min(1, dt * 3);
    sweep.rotation.y -= dt * 1.15;

    if (riseStart >= 0) {
      const t = Math.min(1, (now - riseStart) / 1100);
      terrain.scale.y = 0.02 + 0.98 * (1 - Math.pow(1 - t, 3));
      blips.forEach((b) => (b.mesh.visible = b.ring.visible = t > 0.8));
      if (t >= 1) riseStart = -1;
    }
    for (const b of blips) {
      const k = ((now / 1000 + b.phase) % 2.2) / 2.2;
      b.ring.scale.setScalar(1 + k * 5);
      (b.ring.material as MeshBasicMaterial).opacity = 0.65 * (1 - k);
    }
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      const k = (now - e.t0) / 2400;
      if (k >= 1) {
        table.remove(e.mesh);
        e.mesh.geometry.dispose();
        disposeMaterial(e.mesh.material);
        events.splice(i, 1);
        continue;
      }
      e.mesh.scale.setScalar(1 + k * 14);
      (e.mesh.material as MeshBasicMaterial).opacity = 0.9 * (1 - k);
    }

    renderer.render(scene, camera);
    if (visible && !document.hidden && !opts.reduceMotion) raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) kick();
  });
  io.observe(host);
  const onVis = () => !document.hidden && kick();
  document.addEventListener("visibilitychange", onVis);
  resize();
  if (opts.reduceMotion) {
    // a single still frame at a nice angle; user can still click to regenerate
    table.rotation.y = 0.55;
    renderer.render(scene, camera);
  } else {
    kick();
  }

  return {
    ping,
    regenerate: (seed) => {
      regenerate(seed);
      if (opts.reduceMotion) {
        terrain.scale.y = 1;
        riseStart = -1;
        blips.forEach((b) => (b.mesh.visible = b.ring.visible = true));
        renderer.render(scene, camera);
      } else kick();
    },
    dispose() {
      cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      io.disconnect();
      host.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVis);
      scene.traverse((o) => {
        const m = o as Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) disposeMaterial(m.material);
      });
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
