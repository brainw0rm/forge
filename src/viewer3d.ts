// 3D character viewer for item sets. Loads a prebuilt glTF model (scripts/model3d/build_set_model.py)
// and stands it in a small torch-lit stone hall, like the in-game character screen: you turn the
// character (drag, or arrow keys), not the camera, and zoom with the mouse wheel. three.js is only
// loaded on pages that show a model, so it never weighs down the rest of the site.

export interface ModelIndex {
  /** Set id -> model files, e.g. { "321": ["set-321-1-0.glb"] }. */
  sets: Record<string, { file: string; label: string }[]>;
}

// The models are Blizzard assets, so they live in an R2 bucket instead of the public repo
// (scripts/model3d/upload.mjs). Without VITE_MODELS_URL they come from public/models (local builds).
const MODELS_URL = ((import.meta.env.VITE_MODELS_URL as string | undefined) || "/models").replace(/\/$/, "");
export const modelUrl = (file: string) => `${MODELS_URL}/${file}`;

let index: Promise<ModelIndex | null> | null = null;
export const getModelIndex = () =>
  (index ??= fetch(modelUrl("index.json")).then((r) => (r.ok ? (r.json() as Promise<ModelIndex>) : null)).catch(() => null));

type Three = typeof import("three");

const BACKGROUND = 0x0b0a10;

/** Small seeded random numbers, so the painted stones look the same on every visit. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paints rows of stones with mortar gaps, a little grain and a bevel: floor flagstones or wall blocks. */
function paintStones(ctx: CanvasRenderingContext2D, w: number, h: number, o: { rowH: [number, number]; stoneW: [number, number]; light: [number, number]; seed: number }) {
  const rand = seeded(o.seed);
  const between = ([a, b]: [number, number]) => a + rand() * (b - a);
  ctx.fillStyle = "#120e0b";
  ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < h; ) {
    const rh = between(o.rowH);
    for (let x = -between(o.stoneW) * rand(); x < w; ) {
      const sw = between(o.stoneW);
      const l = between(o.light);
      ctx.fillStyle = `hsl(${26 + rand() * 10} ${8 + rand() * 8}% ${l}%)`;
      ctx.beginPath();
      ctx.roundRect(x + 2, y + 2, sw - 4, rh - 4, 4);
      ctx.fill();
      // Lit top edge and shaded bottom edge, so each stone reads as a stone.
      ctx.fillStyle = `hsl(32 18% ${l + 9}% / .55)`;
      ctx.fillRect(x + 4, y + 2, sw - 8, 2);
      ctx.fillStyle = "rgb(0 0 0 / .35)";
      ctx.fillRect(x + 4, y + rh - 5, sw - 8, 3);
      x += sw;
    }
    y += rh;
  }
  // Grain and wear.
  for (let i = 0; i < w * h * 0.02; i++) {
    ctx.fillStyle = rand() < 0.5 ? `rgb(0 0 0 / ${rand() * 0.25})` : `rgb(255 235 200 / ${rand() * 0.06})`;
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

function canvasTexture(THREE: Three, canvas: HTMLCanvasElement, maxAnisotropy = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/** A round flagstone floor that fades into the dark at its edge. */
function floorTexture(THREE: Three, aniso: number) {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const ctx = c.getContext("2d")!;
  paintStones(ctx, 1024, 1024, { rowH: [52, 84], stoneW: [70, 150], light: [17, 25], seed: 7 });
  const fade = ctx.createRadialGradient(512, 512, 120, 512, 512, 512);
  fade.addColorStop(0, "#000");
  fade.addColorStop(0.55, "rgb(0 0 0 / .85)");
  fade.addColorStop(1, "rgb(0 0 0 / 0)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 1024, 1024);
  return canvasTexture(THREE, c, aniso);
}

/** Squared stone blocks for the back wall, darkening towards the edges and the top. */
function wallTexture(THREE: Three, aniso: number) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 464;
  const ctx = c.getContext("2d")!;
  paintStones(ctx, 1024, 464, { rowH: [44, 62], stoneW: [80, 190], light: [10, 16], seed: 3 });
  const vignette = ctx.createRadialGradient(512, 300, 80, 512, 300, 560);
  vignette.addColorStop(0, "rgb(11 10 16 / 0)");
  vignette.addColorStop(1, "rgb(11 10 16 / 1)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, 1024, 464);
  const top = ctx.createLinearGradient(0, 0, 0, 464);
  top.addColorStop(0, "rgb(11 10 16 / 1)");
  top.addColorStop(0.45, "rgb(11 10 16 / 0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, 1024, 464);
  // Shade where the wall meets the floor.
  const foot = ctx.createLinearGradient(0, 380, 0, 464);
  foot.addColorStop(0, "rgb(0 0 0 / 0)");
  foot.addColorStop(1, "rgb(0 0 0 / .7)");
  ctx.fillStyle = foot;
  ctx.fillRect(0, 380, 1024, 84);
  return canvasTexture(THREE, c, aniso);
}

/** A soft round blob: the dark contact shadow under the feet, or (warm, additive) a torch flame. */
function glowTexture(THREE: Three, stops: [number, string][]) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return canvasTexture(THREE, c);
}

/** Mounts a viewer into `host` and returns a function that tears it down. */
export async function mountViewer(host: HTMLElement, url: string): Promise<() => void> {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const aniso = renderer.capabilities.getMaxAnisotropy();

  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  // Stand the character on the floor (y = 0), centred on the turntable.
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);
  model.traverse((o) => {
    const mesh = o as import("three").Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    for (const m of [mesh.material].flat() as import("three").MeshStandardMaterial[]) if (m.map) m.map.anisotropy = aniso;
  });
  const turntable = new THREE.Group();
  turntable.add(model);
  const h = size.y;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.add(turntable);

  // The hall: flagstone floor, a block wall behind, a dark contact shadow under the feet.
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(h * 2.6, 64),
    new THREE.MeshStandardMaterial({ map: floorTexture(THREE, aniso), transparent: true, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const wallZ = -h * 1.25;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(h * 6, h * 2.72), new THREE.MeshStandardMaterial({ map: wallTexture(THREE, aniso), roughness: 1 }));
  wall.position.set(0, h * 1.36, wallZ);
  wall.receiveShadow = true;
  scene.add(wall);
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(h * 0.75, h * 0.75),
    new THREE.MeshBasicMaterial({ map: glowTexture(THREE, [[0, "rgb(0 0 0 / .55)"], [1, "rgb(0 0 0 / 0)"]]), transparent: true, depthWrite: false }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = h * 0.002;
  scene.add(contact);

  // Two torches on the wall, either side of the character: a flame glow and a warm, flickering light.
  const flame = glowTexture(THREE, [[0, "rgb(255 244 200 / 1)"], [0.25, "rgb(255 170 60 / .85)"], [1, "rgb(255 90 20 / 0)"]]);
  const torches = [-1, 1].map((side) => {
    const x = side * h * 0.95;
    const bracket = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.02, h * 0.012, h * 0.16, 8), new THREE.MeshStandardMaterial({ color: 0x2a1d12, roughness: 0.8 }));
    bracket.position.set(x, h * 0.86, wallZ + h * 0.05);
    bracket.rotation.x = 0.35;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: flame, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.set(x, h * 0.97, wallZ + h * 0.08);
    glow.scale.setScalar(h * 0.2);
    const light = new THREE.PointLight(0xff9440, 1.1 * h * h, h * 3, 2);
    light.position.set(x, h * 0.98, wallZ + h * 0.2);
    scene.add(bracket, glow, light);
    return { glow, light, base: light.intensity, phase: side * 1.7 };
  });

  // Character lighting: soft fill, a warm key from the front-left that casts the shadow, a cool rim.
  scene.add(new THREE.HemisphereLight(0xffe9c8, 0x1a1626, 0.9));
  const key = new THREE.DirectionalLight(0xffdcab, 2.1);
  key.position.set(-h * 0.9, h * 2.2, h * 1.8);
  key.target.position.set(0, h * 0.4, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 5;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02 * h;
  Object.assign(key.shadow.camera, { left: -h * 1.6, right: h * 1.6, top: h * 1.6, bottom: -h * 1.2, near: h * 0.5, far: h * 6 });
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x9fb4ff, 1.3);
  rim.position.set(h, h * 1.4, -h * 1.1);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(30, 1, h * 0.05, h * 20);
  let zoom = 1;
  const frameCamera = () => {
    // Fit the character's height with some room; zooming in looks towards the chest and head.
    // Narrow (phone) stages fit the width instead, with room to turn (shoulders stick out).
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const reach = Math.max(size.x, size.z) * 0.62;
    const dist = Math.max((h * 1.32) / (2 * tanHalf), reach / (tanHalf * camera.aspect) + reach) * zoom;
    const lookY = h * (0.45 + 0.3 * (1 - zoom));
    camera.position.set(0, lookY + h * 0.1, dist);
    camera.lookAt(0, lookY, 0);
  };

  host.append(renderer.domElement);
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "3D character: drag or use the arrow keys to turn");

  // Turning: drag sideways (vertical swipes still scroll the page on phones), arrow keys, or idle spin.
  let spinning = !still;
  let drag: { x: number; id: number } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    spinning = false;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    turntable.rotation.y += (e.clientX - drag.x) * 0.012;
    drag.x = e.clientX;
  });
  const endDrag = () => (drag = null);
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    spinning = false;
    turntable.rotation.y += e.key === "ArrowLeft" ? -0.2 : 0.2;
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom = Math.min(1.35, Math.max(0.42, zoom * (1 + e.deltaY * 0.0012)));
      frameCamera();
    },
    { passive: false },
  );

  const resize = () => {
    const w = host.clientWidth;
    const hh = host.clientHeight;
    renderer.setSize(w, hh, false);
    camera.aspect = w / hh;
    camera.updateProjectionMatrix();
    frameCamera();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  let frame = 0;
  let last = performance.now();
  // Only draw while the viewer is on screen (saves the battery on phones).
  let visible = true;
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && !frame) {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  });
  io.observe(host);

  const stop = () => {
    cancelAnimationFrame(frame);
    ro.disconnect();
    io.disconnect();
    renderer.dispose();
    canvas.remove();
  };
  const tick = (now: number) => {
    frame = 0;
    // The page navigated away (views replace their HTML): stop rendering.
    if (!host.isConnected) return stop();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (spinning) turntable.rotation.y += dt * 0.35;
    if (!still) {
      const t = now / 1000;
      for (const torch of torches) {
        const f = 1 + 0.09 * Math.sin(t * 9.1 + torch.phase) + 0.05 * Math.sin(t * 23.7 + torch.phase * 3);
        torch.light.intensity = torch.base * f;
        torch.glow.scale.setScalar(h * 0.2 * (0.94 + 0.06 * f));
      }
    }
    renderer.render(scene, camera);
    if (visible) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return stop;
}
