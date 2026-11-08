// 3D character viewer for item sets (prototype). Loads a prebuilt glTF model
// (scripts/model3d/build_set_model.py) and lets you turn and zoom it. three.js is only loaded on
// pages that show a model, so it never weighs down the rest of the site.

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

/** Mounts a viewer into `host` and returns a function that tears it down. */
export async function mountViewer(host: HTMLElement, url: string): Promise<() => void> {
  const THREE = await import("three");
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  // Warm candlelight from the front-left, cool moonlight rim from behind, like the site's colors.
  scene.add(new THREE.HemisphereLight(0xfff1d6, 0x1b2340, 1.1));
  const key = new THREE.DirectionalLight(0xffd9a0, 2.2);
  key.position.set(-1.5, 2.5, 2.5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fa8ff, 1.4);
  rim.position.set(1.5, 2, -2.5);
  scene.add(rim);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.autoRotate = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  controls.autoRotateSpeed = 1.2;
  controls.addEventListener("start", () => (controls.autoRotate = false));

  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  model.traverse((o) => {
    const mesh = o as import("three").Mesh;
    if (mesh.isMesh) {
      for (const m of [mesh.material].flat() as import("three").MeshStandardMaterial[]) {
        if (m.map) m.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
      }
    }
  });
  scene.add(model);

  // Frame the character: look at its middle, from a distance that fits its height.
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  const dist = size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.25;
  camera.position.set(center.x, center.y + size.y * 0.05, center.z + dist);
  controls.minDistance = dist * 0.35;
  controls.maxDistance = dist * 2;

  const resize = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    ro.disconnect();
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
  const tick = () => {
    // The page navigated away (views replace their HTML): stop rendering.
    if (!host.isConnected) return stop();
    controls.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  tick();
  return stop;
}
