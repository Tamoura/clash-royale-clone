import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { attachWeapon } from "./render3d/glbModels";

// Standalone viewer to eyeball textured GLB characters at chosen scales + tints.

const canvas = document.getElementById("c") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcdb487);

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 3.0, 13);
camera.lookAt(0, 1.4, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a55, 1.1));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.5);
sun.position.set(4, 9, 5);
sun.castShadow = true;
scene.add(sun);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(12, 48),
  new THREE.MeshStandardMaterial({ color: 0xbfa074 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const mixers: THREE.AnimationMixer[] = [];
const loader = new GLTFLoader();

// file, label, scale, x, tint (0xffffff = none) — final Batch 2 wiring
const ROW: Array<[string, string, number, number, number]> = [
  ["Knight.glb", "Knight", 0.95, -4.6, 0xffffff],
  ["Skeleton_Warrior.glb", "P.E.K.K.A", 1.5, -1.2, 0x33384a],
  ["Knight.glb", "Prince", 1.05, 3.6, 0x7088e0],
];

const labels = document.getElementById("labels")!;
(window as unknown as { __labelData: Array<{ l: string; pct: number }> }).__labelData =
  ROW.map(([, label, , x]) => ({ l: label, pct: 50 + (x / 6.4) * 42 }));
ROW.forEach(([file, label, scale, x, tint]) => {
  loader.load(`/models/kaykit/${file}`, (gltf) => {
    const g = gltf.scene;
    g.scale.setScalar(scale);
    g.position.set(x, 0, 0);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        if (tint !== 0xffffff) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.color.multiplyScalar(1).setHex(tint);
          m.material = mat;
        }
      }
    });
    if (label === "Prince") {
      attachWeapon(g, "prince");
      (window as unknown as { __prince: THREE.Object3D }).__prince = g;
    }
    scene.add(g);
    const mixer = new THREE.AnimationMixer(g);
    const idle = gltf.animations.find((a) => a.name === "Idle");
    if (idle) mixer.clipAction(idle).play();
    mixers.push(mixer);
  });
  const d = document.createElement("div");
  d.className = "lbl";
  d.textContent = label;
  d.style.left = `${50 + (x / 6.4) * 42}%`;
  labels.appendChild(d);
});

function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

const clock = new THREE.Clock();
function tick(): void {
  const dt = clock.getDelta();
  for (const m of mixers) m.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
