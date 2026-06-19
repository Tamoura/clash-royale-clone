import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { buildTroop, outlineRig } from "./render3d/characters3d";

// Tiny standalone viewer to eyeball characters side by side:
// primitive Wizard (old) | Mage GLB (new Wizard) | Knight GLB.

const canvas = document.getElementById("c") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcdb487);

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 2.2, 7.5);
camera.lookAt(0, 1.1, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a55, 1.1));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.5);
sun.position.set(4, 8, 5);
sun.castShadow = true;
scene.add(sun);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(8, 48),
  new THREE.MeshStandardMaterial({ color: 0xbfa074 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const mixers: THREE.AnimationMixer[] = [];

// 1) Primitive wizard rig (the look the other wizards still use).
const rig = buildTroop("wizard");
const rigScale = 1.25 * 0.95;
rig.group.scale.setScalar(rigScale);
rig.group.position.set(-2.4, 0, 0);
rig.group.rotation.y = 0;
outlineRig(rig.group);
scene.add(rig.group);

// 2 + 3) GLB models.
const loader = new GLTFLoader();
function addGlb(file: string, x: number): void {
  loader.load(`/models/kaykit/${file}`, (gltf) => {
    const g = gltf.scene;
    g.scale.setScalar(0.95);
    g.position.set(x, 0, 0);
    g.rotation.y = 0;
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    scene.add(g);
    const mixer = new THREE.AnimationMixer(g);
    const idle = gltf.animations.find((a) => a.name === "Idle");
    if (idle) mixer.clipAction(idle).play();
    mixers.push(mixer);
  });
}
addGlb("Mage.glb", 0);
addGlb("Knight.glb", 2.4);

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
  rig.extras?.(clock.elapsedTime, 0);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();
