#!/usr/bin/env node
/**
 * Packs the KayKit character models the battle uses (CC0, Kay Lousberg:
 * Adventurers 1.0 and Skeletons 1.0) into small binary glTFs under
 * public/models/troops/:
 *
 *   <character>.glb   the meshes, skin and palette texture, NO animations
 *   anims.glb         the shared Rig_Medium skeleton with only the clips the
 *                     game plays, and only the channels that move a deform
 *                     bone (every character in both packs shares this rig,
 *                     so one clip set drives them all)
 *
 * The source files ship 76-95 clips each (3.6-4.8 MB per character, two
 * thirds of it animation JSON); packed, a character is ~0.3 MB.
 *
 *   node tools/troop-pack.mjs <Adventurers .../Characters/gltf> <Skeletons .../Characters/gltf> <Skeletons .../Assets/gltf>
 *
 * The packs are read as data only (JSON + binary buffers); nothing in them runs.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const [advDir, skelDir, skelAssets] = process.argv.slice(2);
if (!advDir || !skelDir || !skelAssets) {
  console.error("usage: node tools/troop-pack.mjs <adventurers gltf dir> <skeletons gltf dir> <skeleton assets gltf dir>");
  process.exit(1);
}
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "models", "troops");
mkdirSync(outDir, { recursive: true });

/** Clips the game plays (see src/render3d/kitTroops.ts). */
const CLIPS = [
  "Idle", "Unarmed_Idle", "2H_Melee_Idle", "2H_Ranged_Aiming",
  "Walking_A", "Running_A",
  "1H_Melee_Attack_Chop", "1H_Melee_Attack_Slice_Diagonal",
  "2H_Melee_Attack_Chop", "2H_Melee_Attack_Slice", "2H_Melee_Attack_Spin",
  "Unarmed_Melee_Attack_Punch_A", "Dualwield_Melee_Attack_Chop",
  "Spellcast_Shoot", "Spellcast_Raise", "1H_Ranged_Shoot", "2H_Ranged_Shoot",
  "Hit_A", "Death_A", "Cheer",
];
/** Bones that deform a mesh or carry a prop; the IK/control bones are baked out. */
const DEFORM = new Set([
  "root", "hips", "spine", "chest", "head",
  "upperarm.l", "lowerarm.l", "wrist.l", "hand.l", "handslot.l",
  "upperarm.r", "lowerarm.r", "wrist.r", "hand.r", "handslot.r",
  "upperleg.l", "lowerleg.l", "foot.l", "toes.l",
  "upperleg.r", "lowerleg.r", "foot.r", "toes.r",
]);
const MOVES = new Set(["root", "hips"]); // the only bones whose translation is animated

const pad4 = (buf, fill = 0) => {
  const extra = (4 - (buf.length % 4)) % 4;
  return extra ? Buffer.concat([buf, Buffer.alloc(extra, fill)]) : buf;
};

function readGlb(file) {
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binStart = 20 + jsonLen + 8;
  const binLen = buf.readUInt32LE(20 + jsonLen);
  return { json, bin: buf.subarray(binStart, binStart + binLen) };
}

function readGltf(file) {
  const json = JSON.parse(readFileSync(file, "utf8"));
  const bin = readFileSync(join(dirname(file), json.buffers[0].uri));
  return { json, bin };
}

/** Rebuild the binary with only the buffer views still referenced, remapping every index. */
function writeGlb(file, json, bin) {
  const usedAcc = new Set();
  for (const m of json.meshes ?? []) {
    for (const p of m.primitives) {
      for (const a of Object.values(p.attributes)) usedAcc.add(a);
      if (p.indices !== undefined) usedAcc.add(p.indices);
    }
  }
  for (const s of json.skins ?? []) if (s.inverseBindMatrices !== undefined) usedAcc.add(s.inverseBindMatrices);
  for (const a of json.animations ?? []) for (const s of a.samplers) usedAcc.add(s.input).add(s.output);
  const accMap = new Map();
  const viewMap = new Map();
  const views = [];
  const chunks = [];
  let offset = 0;
  const keepView = (i) => {
    if (viewMap.has(i)) return viewMap.get(i);
    const v = json.bufferViews[i];
    const data = pad4(Buffer.from(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)));
    const next = { ...v, buffer: 0, byteOffset: offset };
    chunks.push(data);
    offset += data.length;
    views.push(next);
    viewMap.set(i, views.length - 1);
    return views.length - 1;
  };
  const accessors = [];
  for (const i of [...usedAcc].sort((a, b) => a - b)) {
    const a = { ...json.accessors[i] };
    a.bufferView = keepView(a.bufferView);
    accMap.set(i, accessors.length);
    accessors.push(a);
  }
  for (const img of json.images ?? []) if (img.bufferView !== undefined) img.bufferView = keepView(img.bufferView);
  for (const m of json.meshes ?? []) {
    for (const p of m.primitives) {
      for (const k of Object.keys(p.attributes)) p.attributes[k] = accMap.get(p.attributes[k]);
      if (p.indices !== undefined) p.indices = accMap.get(p.indices);
    }
  }
  for (const s of json.skins ?? []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = accMap.get(s.inverseBindMatrices);
  for (const a of json.animations ?? []) {
    for (const s of a.samplers) {
      s.input = accMap.get(s.input);
      s.output = accMap.get(s.output);
    }
  }
  json.accessors = accessors;
  json.bufferViews = views;
  const body = Buffer.concat(chunks);
  json.buffers = [{ byteLength: body.length }];
  json.asset = { version: "2.0", generator: "crown-rush troop-pack", copyright: "KayKit character packs by Kay Lousberg, CC0" };
  const jsonBuf = pad4(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + body.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(body.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  writeFileSync(file, Buffer.concat([header, jh, jsonBuf, bh, body]));
  return 12 + 8 + jsonBuf.length + 8 + body.length;
}

/** Append a prop (a .gltf + .bin with one mesh) under a bone of a character, sharing its material. */
function addProp(char, prop, bone, name) {
  const { json, bin } = char;
  const base = json.bufferViews.length;
  const accBase = json.accessors.length;
  const binOffset = bin.length;
  char.bin = Buffer.concat([bin, prop.bin]);
  for (const v of prop.json.bufferViews) json.bufferViews.push({ ...v, buffer: 0, byteOffset: (v.byteOffset ?? 0) + binOffset });
  for (const a of prop.json.accessors) json.accessors.push({ ...a, bufferView: a.bufferView + base });
  const mesh = prop.json.meshes[0];
  json.meshes.push({
    name,
    primitives: mesh.primitives.map((p) => ({
      ...p,
      attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, v + accBase])),
      indices: p.indices === undefined ? undefined : p.indices + accBase,
      material: 0,
    })),
  });
  json.nodes.push({ name, mesh: json.meshes.length - 1 });
  const parent = json.nodes.find((n) => n.name === bone);
  (parent.children ??= []).push(json.nodes.length - 1);
}

const report = [];

// --- characters: everything but the animations ---
const CHARACTERS = [
  [advDir, "Knight"], [advDir, "Barbarian"], [advDir, "Mage"], [advDir, "Rogue"], [advDir, "Rogue_Hooded"],
  [skelDir, "Skeleton_Minion"],
];
for (const [dir, name] of CHARACTERS) {
  const char = readGlb(join(dir, `${name}.glb`));
  delete char.json.animations;
  if (name === "Skeleton_Minion") addProp(char, readGltf(join(skelAssets, "Skeleton_Blade.gltf")), "handslot.r", "Skeleton_Blade");
  const bytes = writeGlb(join(outDir, `${name.toLowerCase()}.glb`), char.json, char.bin);
  report.push(`${name.toLowerCase()}.glb ${(bytes / 1024).toFixed(0)} KB`);
}

// --- the shared clip set: the rig's bones and the chosen animations only ---
{
  const { json, bin } = readGlb(join(advDir, "Knight.glb"));
  for (const n of json.nodes) {
    delete n.mesh;
    delete n.skin;
  }
  delete json.meshes;
  delete json.skins;
  delete json.materials;
  delete json.textures;
  delete json.images;
  delete json.samplers;
  const anims = [];
  for (const clip of CLIPS) {
    const a = json.animations.find((x) => x.name === clip);
    if (!a) throw new Error(`clip ${clip} missing`);
    const samplers = [];
    const channels = [];
    for (const ch of a.channels) {
      const bone = json.nodes[ch.target.node].name;
      if (!DEFORM.has(bone)) continue;
      if (ch.target.path === "scale") continue;
      if (ch.target.path === "translation" && !MOVES.has(bone)) continue;
      samplers.push(a.samplers[ch.sampler]);
      channels.push({ ...ch, sampler: samplers.length - 1 });
    }
    anims.push({ name: clip, samplers, channels });
  }
  json.animations = anims;
  const bytes = writeGlb(join(outDir, "anims.glb"), json, bin);
  report.push(`anims.glb ${(bytes / 1024).toFixed(0)} KB (${CLIPS.length} clips)`);
}

writeFileSync(
  join(outDir, "CREDITS.txt"),
  "Characters and animations: KayKit Adventurers Character Pack 1.0 and KayKit Skeletons Character Pack 1.0\nby Kay Lousberg (www.kaylousberg.com), CC0. Packed by tools/troop-pack.mjs.\n",
);
console.log(report.join("\n"));
