import * as THREE from "three";
import { getCard, type CardId } from "../game/cards";
import {
  animateTroop,
  buildTowerKing,
  buildTowerPrincess,
  buildTroop,
  outlineRig,
  toon,
  type TroopRig,
} from "./characters3d";

/**
 * Character portrait studio (dev tool): `?gallery=<id>` renders one
 * character posed on a pedestal. Accepts any troop card id plus
 * "tower-princess" and "tower-king".
 */
export function startGallery(container: HTMLElement, subject: string): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x27355c);

  let rig: TroopRig;
  let title: string;
  if (subject === "tower-princess") {
    rig = buildTowerPrincess();
    outlineRig(rig.group);
    title = "Tower Princess";
  } else if (subject === "tower-king") {
    rig = buildTowerKing();
    outlineRig(rig.group);
    title = "The King";
  } else {
    rig = buildTroop(subject as CardId); // throws on unknown/spell ids
    title = getCard(subject as CardId).name;
  }
  if (rig.arm) rig.arm.rotation.x = rig.armRest;

  // Pose: three-quarter turn on a stone pedestal.
  const stage = new THREE.Group();
  stage.add(rig.group);
  stage.rotation.y = 0.55;
  scene.add(stage);
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.7, 0.3, 24),
    toon(0xc6bda9),
  );
  pedestal.position.y = -0.15;
  pedestal.receiveShadow = true;
  scene.add(pedestal);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(7, 32),
    new THREE.MeshToonMaterial({ color: 0x1d2845 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.3;
  floor.receiveShadow = true;
  scene.add(floor);

  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x3a3f5c, 1.0));
  const key = new THREE.DirectionalLight(0xfff2d8, 1.9);
  key.position.set(4, 6, 5);
  key.castShadow = true;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb6ff, 1.0);
  rim.position.set(-5, 4, -4);
  scene.add(rim);

  // Frame the character by its height.
  const h = (rig.hover ?? 0) + rig.height;
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  camera.position.set(0, h * 0.62, h * 2.6);
  camera.lookAt(0, h * 0.48, 0);

  const label = document.createElement("div");
  label.style.cssText =
    "position:absolute;left:0;right:0;bottom:26px;text-align:center;" +
    "font-size:34px;font-weight:bold;color:#ffe082;" +
    "text-shadow:-2px -2px 0 #14213a,2px -2px 0 #14213a," +
    "-2px 2px 0 #14213a,2px 2px 0 #14213a,0 4px 6px rgba(0,0,0,.6)";
  label.textContent = title;
  container.appendChild(label);

  const resize = (): void => {
    const w = container.clientWidth || 1;
    const ht = container.clientHeight || 1;
    renderer.setSize(w, ht, false);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    camera.aspect = w / ht;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  const t0 = performance.now();
  const frame = (): void => {
    const t = (performance.now() - t0) / 1000;
    animateTroop(rig, { moving: false, swing: 0, time: t, phase: 0 });
    stage.rotation.y = 0.55 + Math.sin(t * 0.5) * 0.12; // slow showcase sway
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
