// Premium-look prototype v2: several fully-detailed hero characters to show
// the quality ceiling. Standalone (Vite + headless Chrome).
//   /prototype.html?char=knight | wizard | pekka
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

// ---- shared shading -------------------------------------------------------
function ramp(steps: number[]): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(steps), steps.length, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
const GRAD = ramp([58, 128, 198, 255]);

/** Toon material with a subtle cool Fresnel rim-light baked in. */
function toon(color: number, rim = 0.28): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: GRAD });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      "#include <dithering_fragment>",
      `float _rim = 1.0 - max(dot(normalize(vViewPosition), normal), 0.0);
       _rim = smoothstep(0.68, 1.0, _rim) * ${rim.toFixed(2)};
       gl_FragColor.rgb += _rim * vec3(0.40, 0.55, 0.78);
       #include <dithering_fragment>`,
    );
  };
  return m;
}
const metal = (color: number): THREE.Material => toon(color, 0.45); // cartoon sheen
function glow(color: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color });
  m.toneMapped = false;
  return m;
}
const rbox = (w: number, h: number, d: number): THREE.BufferGeometry =>
  new RoundedBoxGeometry(w, h, d, 4, Math.min(w, h, d) * 0.3);
const sph = (r: number): THREE.BufferGeometry => new THREE.SphereGeometry(r, 28, 22);
const cyl = (rt: number, rb: number, h: number): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(rt, rb, h, 28);
const cone = (r: number, h: number): THREE.BufferGeometry => new THREE.ConeGeometry(r, h, 24);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Inverted-hull cel outline on the larger solid (non-glow) meshes. */
function outlineGroup(g: THREE.Group): void {
  const targets: THREE.Mesh[] = [];
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.name === "outline") return;
    const mat = m.material as THREE.Material & { toneMapped?: boolean };
    if (mat.toneMapped === false) return; // skip glowing bits (eyes, gems)
    m.geometry.computeBoundingSphere();
    const r = (m.geometry.boundingSphere?.radius ?? 0) * Math.max(m.scale.x, m.scale.y, m.scale.z);
    if (r >= 0.12) targets.push(m);
  });
  for (const m of targets) {
    const o = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({ color: 0x0a0d14, side: THREE.BackSide }));
    o.name = "outline";
    o.scale.setScalar(1.07);
    m.add(o);
  }
}

function eyes(g: THREE.Group, y: number, z: number, spread: number, r = 0.07, look = 0): void {
  for (const sx of [-1, 1]) {
    g.add(mesh(sph(r * 1.25), toon(0x2b2333), sx * spread, y, z - 0.04));
    g.add(mesh(sph(r), glow(0xffffff), sx * spread, y, z));
    g.add(mesh(sph(r * 0.5), glow(0x1b2233), sx * spread + look, y, z + r * 0.7));
    g.add(mesh(sph(r * 0.2), glow(0xffffff), sx * spread + r * 0.4, y + r * 0.4, z + r * 0.9));
  }
}
function brows(g: THREE.Group, y: number, z: number, spread: number, color: number, tilt = 0.28): void {
  for (const sx of [-1, 1]) {
    const b = mesh(rbox(0.14, 0.04, 0.06), toon(color), sx * spread, y, z);
    b.rotation.z = -sx * tilt;
    g.add(b);
  }
}

const SKIN = 0xefb98a;

// ---- KNIGHT ---------------------------------------------------------------
function buildKnight(): THREE.Group {
  const g = new THREE.Group();
  const BLUE = 0x2f6bd8, BLUEDK = 0x244e9c, STEEL = 0xc7d0dd, GOLD = 0xf2c14e;
  for (const sx of [-1, 1]) {
    g.add(mesh(rbox(0.26, 0.42, 0.28), toon(BLUEDK), sx * 0.2, 0.5, 0));
    g.add(mesh(rbox(0.27, 0.3, 0.29), metal(STEEL), sx * 0.2, 0.26, 0.01)); // greave
    g.add(mesh(sph(0.13), metal(GOLD), sx * 0.2, 0.4, 0.14)); // knee rivet
    g.add(mesh(rbox(0.3, 0.18, 0.44), toon(0x4a3417), sx * 0.2, 0.1, 0.08)); // boot
  }
  g.add(mesh(rbox(0.78, 0.86, 0.5), toon(BLUE), 0, 1.12, 0)); // tunic
  g.add(mesh(rbox(0.72, 0.64, 0.52), metal(STEEL), 0, 1.26, 0.02)); // breastplate
  g.add(mesh(cyl(0.34, 0.34, 0.12), metal(0x9aa6b5), 0, 1.6, 0)); // chainmail collar
  // Chest emblem — a gold diamond stud (no cross).
  g.add(mesh(new THREE.OctahedronGeometry(0.12), metal(GOLD), 0, 1.3, 0.28));
  g.add(mesh(rbox(0.3, 0.78, 0.04), toon(BLUEDK), 0, 1.02, 0.27)); // tabard
  g.add(mesh(rbox(0.82, 0.14, 0.54), toon(0x5a3a1c), 0, 0.74, 0)); // belt
  g.add(mesh(rbox(0.16, 0.16, 0.06), metal(GOLD), 0, 0.74, 0.28)); // buckle
  for (const sx of [-1, 1]) {
    g.add(mesh(sph(0.21), metal(STEEL), sx * 0.46, 1.46, 0)); // pauldron
    g.add(mesh(sph(0.07), metal(GOLD), sx * 0.46, 1.6, 0.12)); // pauldron rivet
    g.add(mesh(rbox(0.22, 0.5, 0.24), toon(BLUE), sx * 0.46, 1.12, 0)); // arm
    g.add(mesh(sph(0.15), metal(STEEL), sx * 0.46, 0.85, 0.02)); // gauntlet
  }
  const headR = 0.4, headY = 1.12 + 0.43 + headR * 0.7;
  g.add(mesh(sph(headR), toon(SKIN, 0.4), 0, headY, 0));
  const dome = mesh(sph(headR * 0.99), metal(STEEL), 0, headY + headR * 0.22, 0);
  dome.scale.y = 0.86; g.add(dome);
  g.add(mesh(cyl(headR * 1.04, headR * 1.04, 0.08), metal(0x9aa6b5), 0, headY + headR * 0.02, 0)); // brim
  g.add(mesh(rbox(0.07, 0.36, 0.07), metal(STEEL), 0, headY - headR * 0.08, headR * 0.92)); // nose guard
  g.add(mesh(rbox(0.12, 0.56, 0.18), toon(0xe23b3b), 0, headY + headR * 0.95, -0.05)); // plume
  eyes(g, headY + 0.02, headR * 0.9, 0.16);
  brows(g, headY + 0.17, headR * 0.86, 0.16, 0x6b4a2a);
  const smile = mesh(new THREE.TorusGeometry(0.08, 0.018, 8, 16, Math.PI), toon(0x5a3a2a), 0, headY - 0.16, headR * 0.87);
  smile.rotation.z = Math.PI; g.add(smile);
  // Sword in the right gauntlet.
  const sword = new THREE.Group();
  sword.add(mesh(sph(0.06), metal(GOLD), 0, -0.32, 0));
  sword.add(mesh(cyl(0.045, 0.045, 0.28), toon(0x4a2f17), 0, -0.17, 0));
  sword.add(mesh(rbox(0.42, 0.08, 0.1), metal(GOLD), 0, 0, 0));
  sword.add(mesh(rbox(0.13, 1.3, 0.05), metal(0xe7ecf3), 0, 0.68, 0));
  sword.position.set(0.5, 0.98, 0.16); sword.rotation.z = -0.08; g.add(sword);
  // Kite shield on the left.
  const shield = new THREE.Group();
  shield.add(mesh(rbox(0.62, 0.8, 0.05), metal(GOLD), 0, 0, -0.02)); // border
  shield.add(mesh(rbox(0.54, 0.72, 0.08), toon(0xc23b3b), 0, 0, 0)); // face
  shield.add(mesh(sph(0.1), metal(STEEL), 0, 0.06, 0.06)); // boss
  const emblem = mesh(cone(0.09, 0.2), glow(GOLD), 0, -0.16, 0.06); g.add(emblem); shield.add(emblem);
  shield.position.set(-0.58, 1.05, 0.2); shield.rotation.set(0, 0.5, 0.08); g.add(shield);
  // Flowing cape.
  const cape = mesh(rbox(0.64, 1.0, 0.05), toon(0x7a1f2b), 0, 1.0, -0.3); cape.rotation.x = 0.1; g.add(cape);
  return g;
}

// ---- WIZARD ---------------------------------------------------------------
function buildWizard(): THREE.Group {
  const g = new THREE.Group();
  const ROBE = 0x2456c8, ROBEDK = 0x18337e, TRIM = 0xf2c14e;
  g.add(mesh(cyl(0.34, 0.74, 1.1), toon(ROBE), 0, 0.55, 0)); // flared robe
  g.add(mesh(cyl(0.75, 0.78, 0.12), toon(ROBEDK), 0, 0.05, 0)); // hem
  // Star trims on the robe.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(mesh(sph(0.05), glow(TRIM), Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.25, 0.5));
  }
  g.add(mesh(rbox(0.6, 0.12, 0.5), toon(0x5a3a1c), 0, 0.96, 0)); // belt
  g.add(mesh(rbox(0.14, 0.14, 0.05), metal(TRIM), 0, 0.96, 0.26));
  // Sleeves/arms.
  for (const sx of [-1, 1]) {
    g.add(mesh(cyl(0.1, 0.2, 0.5), toon(ROBE), sx * 0.42, 1.1, 0.05));
    g.add(mesh(sph(0.12), toon(SKIN), sx * 0.46, 0.85, 0.12)); // hand
  }
  const headR = 0.34, headY = 1.55;
  g.add(mesh(sph(headR), toon(SKIN, 0.4), 0, headY, 0));
  // Long pointed hat with curl + brim + band (doesn't shade the face).
  const hat = mesh(cone(0.4, 1.0), toon(ROBEDK), 0, headY + 0.58, -0.04);
  hat.rotation.x = -0.12; hat.castShadow = false; g.add(hat);
  const band = mesh(new THREE.TorusGeometry(0.4, 0.07, 10, 24), toon(ROBE), 0, headY + 0.14, 0);
  band.rotation.x = Math.PI / 2; band.castShadow = false; g.add(band);
  g.add(mesh(sph(0.08), glow(TRIM), 0, headY + 1.05, -0.16)); // hat tip star
  // Short chin beard (kept clear of the face).
  const beard = mesh(cone(0.2, 0.42), toon(0xeef3fa), 0, headY - 0.42, 0.12);
  beard.rotation.x = Math.PI; beard.castShadow = false; g.add(beard);
  // Hair tufts at the sides.
  for (const sx of [-1, 1]) g.add(mesh(sph(0.12), toon(0xeef3fa), sx * headR * 0.82, headY - 0.06, 0.04));
  eyes(g, headY + 0.06, headR * 0.94, 0.13, 0.055);
  brows(g, headY + 0.17, headR * 0.92, 0.13, 0xc7d2de, 0.16);
  // Staff with a glowing crystal.
  const staff = new THREE.Group();
  staff.add(mesh(cyl(0.04, 0.05, 1.5), toon(0x6b4a2a), 0, 0, 0));
  staff.add(mesh(new THREE.OctahedronGeometry(0.16), glow(0x59c8ff), 0, 0.85, 0));
  staff.add(mesh(sph(0.24), new THREE.MeshBasicMaterial({ color: 0x59c8ff, transparent: true, opacity: 0.22, toneMapped: false }), 0, 0.85, 0));
  staff.position.set(0.5, 0.85, 0.14); g.add(staff);
  return g;
}

// ---- P.E.K.K.A ------------------------------------------------------------
function buildPekka(): THREE.Group {
  const g = new THREE.Group();
  const ARMOR = 0x20283f, ARMORLT = 0x2d3a5c, EDGE = 0xc9d3e6, VISOR = 0xff3ea5, GEM = 0x9b6cff;
  for (const sx of [-1, 1]) {
    g.add(mesh(rbox(0.3, 0.5, 0.32), metal(ARMOR), sx * 0.22, 0.42, 0)); // leg
    g.add(mesh(rbox(0.36, 0.2, 0.46), metal(ARMORLT), sx * 0.22, 0.13, 0.06)); // foot
  }
  g.add(mesh(rbox(0.92, 0.86, 0.6), metal(ARMOR), 0, 1.05, 0)); // torso
  g.add(mesh(rbox(0.7, 0.5, 0.62), metal(ARMORLT), 0, 1.12, 0.02)); // chest plate
  g.add(mesh(new THREE.OctahedronGeometry(0.14), glow(GEM), 0, 1.16, 0.32)); // chest gem
  // Shoulder spikes.
  for (const sx of [-1, 1]) {
    g.add(mesh(sph(0.26), metal(ARMORLT), sx * 0.56, 1.42, 0));
    const sp = mesh(cone(0.12, 0.6), metal(EDGE), sx * 0.6, 1.7, -0.05); sp.rotation.z = sx * 0.5; g.add(sp);
    const sp2 = mesh(cone(0.09, 0.42), metal(EDGE), sx * 0.66, 1.55, 0.18); sp2.rotation.set(0.6, 0, sx * 0.7); g.add(sp2);
    g.add(mesh(rbox(0.26, 0.5, 0.28), metal(ARMOR), sx * 0.56, 1.05, 0)); // arm
    g.add(mesh(sph(0.16), metal(ARMORLT), sx * 0.56, 0.78, 0.02)); // fist
  }
  // Helmet (rounded wedge) with a glowing visor slit + horns.
  const headY = 1.78;
  const helm = mesh(rbox(0.66, 0.6, 0.58), metal(ARMOR), 0, headY, 0); g.add(helm);
  g.add(mesh(rbox(0.5, 0.12, 0.06), glow(VISOR), 0, headY + 0.02, 0.3)); // visor slit
  g.add(mesh(rbox(0.62, 0.2, 0.1), glow(VISOR), 0, headY + 0.02, 0.18)); // visor inner glow
  for (const sx of [-1, 1]) {
    const horn = mesh(cone(0.1, 0.66), metal(EDGE), sx * 0.26, headY + 0.5, -0.05);
    horn.rotation.z = sx * 0.45; g.add(horn);
  }
  // Big two-handed sword with a glowing edge.
  const sword = new THREE.Group();
  sword.add(mesh(cyl(0.05, 0.05, 0.34), toon(0x2a2f3c), 0, -0.2, 0));
  sword.add(mesh(rbox(0.5, 0.1, 0.12), metal(EDGE), 0, 0, 0));
  sword.add(mesh(rbox(0.2, 1.7, 0.07), metal(0x39507f), 0, 0.9, 0));
  sword.add(mesh(rbox(0.06, 1.7, 0.09), glow(0x76d9ff), 0.1, 0.9, 0)); // glowing edge
  sword.position.set(0.62, 1.1, 0.2); sword.rotation.z = -0.12; g.add(sword);
  return g;
}

const BUILDERS: Record<string, () => THREE.Group> = {
  knight: buildKnight,
  wizard: buildWizard,
  pekka: buildPekka,
};

// ---- scene + lighting + post ---------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const bg = document.createElement("canvas");
bg.width = bg.height = 512;
const ctx = bg.getContext("2d")!;
const grd = ctx.createRadialGradient(256, 200, 60, 256, 256, 380);
grd.addColorStop(0, "#46568a");
grd.addColorStop(0.6, "#28314e");
grd.addColorStop(1, "#141a2a");
ctx.fillStyle = grd;
ctx.fillRect(0, 0, 512, 512);
const bgTex = new THREE.CanvasTexture(bg);
bgTex.colorSpace = THREE.SRGBColorSpace;
scene.background = bgTex;

const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0.2, 1.7, 5.8);
camera.lookAt(0, 1.25, 0);

scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x30343f, 0.55));
const key = new THREE.DirectionalLight(0xfff1dc, 1.4);
key.position.set(3.5, 5.5, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1; key.shadow.camera.far = 20;
key.shadow.bias = -0.0004; key.shadow.radius = 7;
scene.add(key);
const rim = new THREE.DirectionalLight(0x86b6ff, 1.1);
rim.position.set(-4, 3.5, -3.5); scene.add(rim);
const fill = new THREE.DirectionalLight(0xffffff, 0.32);
fill.position.set(-3, 1.2, 4.5); scene.add(fill);

const ground = new THREE.Mesh(new THREE.CircleGeometry(7, 64), new THREE.MeshStandardMaterial({ color: 0x2a3147, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.18, 0.18, 48), new THREE.MeshStandardMaterial({ color: 0x39415c, roughness: 0.85 }));
pedestal.position.y = 0.09; pedestal.receiveShadow = true; pedestal.castShadow = true; scene.add(pedestal);

const charId = new URLSearchParams(location.search).get("char") ?? "knight";
const char = (BUILDERS[charId] ?? buildKnight)();
char.position.y = 0.18;
outlineGroup(char);
scene.add(char);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.18, 0.55, 0.85));

const cap = document.createElement("div");
cap.textContent = `Premium prototype — ${charId}`;
cap.style.cssText = "position:fixed;left:0;right:0;bottom:16px;text-align:center;font:600 18px system-ui,sans-serif;color:#dbe6ff;text-transform:capitalize;";
document.body.appendChild(cap);

let t = 0;
function animate(): void {
  requestAnimationFrame(animate);
  t += 0.008;
  char.rotation.y = Math.sin(t) * 0.42;
  composer.render();
}
animate();
window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
