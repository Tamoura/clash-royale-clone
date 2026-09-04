import * as THREE from "three";
import { getCard, type CardId } from "../game/cards";
import {
  animateTroop,
  buildTowerCannoneer,
  buildTowerDuchess,
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
  // Audit-tool extras: ?pose=front|back|<degrees> parks the turntable at an
  // exact angle with a frozen idle pose, and ?bg=chroma strips the set
  // (pedestal, floor, label) to a solid keyable green for masking.
  const params = new URLSearchParams(location.search);
  const poseParam = params.get("pose");
  const chroma = params.get("bg") === "chroma";
  const poseAngle =
    poseParam === "front" ? 0 :
    poseParam === "back" ? Math.PI :
    poseParam !== null ? (parseFloat(poseParam) * Math.PI) / 180 : null;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(chroma ? 0x00ff00 : 0x46588f);

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
  } else if (subject === "tower-cannoneer") {
    rig = buildTowerCannoneer();
    outlineRig(rig.group);
    title = "Cannoneer";
  } else if (subject === "tower-duchess") {
    rig = buildTowerDuchess();
    outlineRig(rig.group);
    title = "Dagger Duchess";
  } else {
    rig = buildTroop(subject as CardId); // throws on unknown/spell ids
    title = getCard(subject as CardId).name;
  }
  if (rig.arm) rig.arm.rotation.x = rig.armRest;

  // Pose: three-quarter turn on a stone pedestal.
  const stage = new THREE.Group();
  stage.add(rig.group);
  stage.rotation.y = poseAngle ?? 0.55;
  scene.add(stage);
  if (!chroma) {
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.7, 0.3, 24),
      toon(0xc6bda9),
    );
    pedestal.position.y = -0.15;
    pedestal.receiveShadow = true;
    scene.add(pedestal);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(7, 32),
      new THREE.MeshToonMaterial({ color: 0x33426e }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.3;
    floor.receiveShadow = true;
    scene.add(floor);
  }

  scene.add(new THREE.HemisphereLight(0xdfeaff, 0x4a5070, 1.25));
  const key = new THREE.DirectionalLight(0xfff2d8, 2.1);
  key.position.set(4, 6, 5);
  key.castShadow = true;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb6ff, 1.3);
  rim.position.set(-5, 4, -4);
  scene.add(rim);
  // Camera-side fill so dark armor (P.E.K.K.A & co) keeps its shape.
  const fill = new THREE.DirectionalLight(0xcfd8ff, 0.7);
  fill.position.set(0, 2, 8);
  scene.add(fill);

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
  if (!chroma) container.appendChild(label);

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
    // Fixed poses freeze the idle clock too, so shots are deterministic.
    const t = poseAngle !== null ? 0.35 : (performance.now() - t0) / 1000;
    animateTroop(rig, { moving: false, swing: 0, time: t, phase: 0 });
    if (poseAngle === null) {
      stage.rotation.y = 0.55 + Math.sin(t * 0.5) * 0.12; // slow showcase sway
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
