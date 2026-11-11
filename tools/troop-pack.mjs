#!/usr/bin/env node
/**
 * Packs the KayKit characters the cast uses (CC0 1.0, Kay Lousberg:
 * Adventurers Character Pack 1.0 and Skeletons Character Pack 1.0) into
 * small binary glTFs under public/models/troops/:
 *
 *   <character>.glb   the body meshes, the props the cast wears, the skin and
 *                     the palette texture, NO animations
 *   anims.glb         the shared Rig_Medium skeleton with only the clips the
 *                     game plays, and only the channels that move a deform
 *                     bone (every character in both packs shares this rig,
 *                     so one clip set drives them all)
 *
 * then compresses each with gltfpack (MIT, run through npx at dev time):
 * EXT_meshopt_compression with float positions and UVs (the bake reads them
 * raw; three's MeshoptDecoder decodes at load), keeping node names. It also
 * writes src/render3d/cast/palettes.ts (swatch colours and the swatches each
 * mesh uses, for the team-rule test) and CREDITS.txt (sources, licence,
 * SHA-256 of every source file read).
 *
 *   node tools/troop-pack.mjs <KayKit-Character-Pack-Adventures-1.0 repo> <KayKit-Character-Pack-Skeletons-1.0 repo>
 *
 * The packs are read as data only (JSON + binary buffers); nothing in them runs.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const [advRepo, skelRepo] = process.argv.slice(2);
if (!advRepo || !skelRepo) {
  console.error("usage: node tools/troop-pack.mjs <adventurers pack repo> <skeletons pack repo>");
  process.exit(1);
}
const advDir = join(advRepo, "addons/kaykit_character_pack_adventures/Characters/gltf");
const skelDir = join(skelRepo, "addons/kaykit_character_pack_skeletons/Characters/gltf");
const skelAssets = join(skelRepo, "addons/kaykit_character_pack_skeletons/Assets/gltf");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "models", "troops");
mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "troop-pack-"));
const GLTFPACK = "gltfpack@0.22.0";

/** Clips the game plays (see src/render3d/cast/). */
const CLIPS = [
  "Idle", "Unarmed_Idle", "2H_Melee_Idle", "2H_Ranged_Aiming", "1H_Ranged_Aiming",
  "Walking_A", "Walking_B", "Running_A", "Running_B",
  "1H_Melee_Attack_Chop", "1H_Melee_Attack_Slice_Diagonal", "1H_Melee_Attack_Stab",
  "2H_Melee_Attack_Chop", "2H_Melee_Attack_Slice", "2H_Melee_Attack_Spin", "2H_Melee_Attack_Stab",
  "Unarmed_Melee_Attack_Punch_A", "Dualwield_Melee_Attack_Chop", "Throw",
  "Spellcast_Shoot", "Spellcast_Raise", "1H_Ranged_Shoot", "2H_Ranged_Shoot",
  "Hit_A", "Death_A", "Cheer", "Sit_Chair_Idle",
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

/** The props each body keeps (everything else the packs hang on them is dropped). */
const KEEP = {
  Knight: ["Knight_Helmet", "Knight_Cape", "1H_Sword", "1H_Sword_Offhand", "2H_Sword", "Badge_Shield", "Round_Shield", "Spike_Shield"],
  Barbarian: ["Barbarian_Hat", "Barbarian_Cape", "1H_Axe", "2H_Axe", "Barbarian_Round_Shield", "Mug"],
  Mage: ["Mage_Hat", "Mage_Cape", "2H_Staff", "1H_Wand", "Spellbook"],
  Rogue: ["Rogue_Cape", "1H_Crossbow", "2H_Crossbow", "Knife", "Knife_Offhand"],
  Rogue_Hooded: ["Rogue_Cape", "1H_Crossbow", "2H_Crossbow", "Knife"],
  Skeleton_Minion: ["Skeleton_Blade"],
};

const sources = new Map(); // path -> sha256
function read(file) {
  const buf = readFileSync(file);
  sources.set(file, createHash("sha256").update(buf).digest("hex"));
  return buf;
}

const pad4 = (buf, fill = 0) => {
  const extra = (4 - (buf.length % 4)) % 4;
  return extra ? Buffer.concat([buf, Buffer.alloc(extra, fill)]) : buf;
};

function readGlb(file) {
  const buf = read(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binStart = 20 + jsonLen + 8;
  const binLen = buf.readUInt32LE(20 + jsonLen);
  return { json, bin: buf.subarray(binStart, binStart + binLen) };
}

function readGltf(file) {
  const json = JSON.parse(read(file).toString("utf8"));
  const bin = read(join(dirname(file), json.buffers[0].uri));
  return { json, bin };
}

/** Drop the meshes no kept node references, remapping mesh indices. */
function pruneMeshes(json, keepNode) {
  const used = new Map();
  const meshes = [];
  for (const n of json.nodes) {
    if (n.mesh === undefined) continue;
    if (!keepNode(n)) {
      delete n.mesh;
      delete n.skin;
      continue;
    }
    if (!used.has(n.mesh)) {
      used.set(n.mesh, meshes.length);
      meshes.push(json.meshes[n.mesh]);
    }
    n.mesh = used.get(n.mesh);
  }
  json.meshes = meshes;
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

/** Compress one GLB with gltfpack: meshopt, float positions and UVs (the bake reads them raw), names kept. */
function compress(from, to) {
  execFileSync("npx", ["-y", GLTFPACK, "-i", from, "-o", to, "-cc", "-kn", "-km", "-vpf", "-vtf"], { stdio: "pipe" });
}

// --------------------------------------------------------- palette tables

/** Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced). */
function decodePng(buf) {
  let off = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = new Uint8Array(w * h * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, s = x * bpp; out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = 255; }
    prev.set(cur);
  }
  return { w, h, px: out };
}

/** Swatch colours (row-major 4 x 8) and each mesh node's swatches, from an uncompressed GLB. */
function paletteTable({ json, bin }) {
  const img = json.images[0];
  const v = json.bufferViews[img.bufferView];
  const png = decodePng(bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
  const rows = [];
  for (let r = 0; r < 4; r++) {
    const row = [];
    for (let c = 0; c < 8; c++) {
      const x = Math.floor(((c + 0.3) * png.w) / 8);
      const y = Math.floor(((r + 0.33) * png.h) / 4);
      const o = (y * png.w + x) * 4;
      row.push((png.px[o] << 16) | (png.px[o + 1] << 8) | png.px[o + 2]);
    }
    rows.push(row);
  }
  const meshes = {};
  for (const n of json.nodes) {
    if (n.mesh === undefined) continue;
    const set = new Set();
    for (const p of json.meshes[n.mesh].primitives) {
      const acc = json.accessors[p.attributes.TEXCOORD_0];
      if (!acc) continue;
      const bv = json.bufferViews[acc.bufferView];
      const o0 = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      const st = bv.byteStride ?? 8;
      for (let i = 0; i < acc.count; i++) {
        const u = bin.readFloatLE(o0 + i * st);
        const w = bin.readFloatLE(o0 + i * st + 4);
        set.add(`${Math.min(7, Math.floor(u * 8))},${Math.min(3, Math.floor(w * 4))}`);
      }
    }
    meshes[n.name] = [...set].sort();
  }
  return { rows, meshes };
}

// ------------------------------------------------------------------ pack

const report = [];
const tables = {};
const CHARACTERS = [
  [advDir, "Knight"], [advDir, "Barbarian"], [advDir, "Mage"], [advDir, "Rogue"], [advDir, "Rogue_Hooded"],
  [skelDir, "Skeleton_Minion"],
];
for (const [dir, name] of CHARACTERS) {
  const char = readGlb(join(dir, `${name}.glb`));
  delete char.json.animations;
  if (name === "Skeleton_Minion") addProp(char, readGltf(join(skelAssets, "Skeleton_Blade.gltf")), "handslot.r", "Skeleton_Blade");
  const keep = new Set(KEEP[name]);
  pruneMeshes(char.json, (n) => n.skin !== undefined || keep.has(n.name));
  const id = name.toLowerCase();
  const raw = join(work, `${id}.glb`);
  writeGlb(raw, char.json, char.bin);
  tables[id] = paletteTable(readGlbRaw(raw));
  compress(raw, join(outDir, `${id}.glb`));
  report.push(`${id}.glb ${(statSync(join(outDir, `${id}.glb`)).size / 1024).toFixed(0)} KB`);
}

function readGlbRaw(file) {
  const buf = readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  return { json, bin: buf.subarray(20 + jsonLen + 8) };
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
  const raw = join(work, "anims.glb");
  writeGlb(raw, json, bin);
  compress(raw, join(outDir, "anims.glb"));
  report.push(`anims.glb ${(statSync(join(outDir, "anims.glb")).size / 1024).toFixed(0)} KB (${CLIPS.length} clips)`);
}

// --- palette tables for the team-rule test ---
{
  const lines = [
    "/**",
    " * Generated by tools/troop-pack.mjs from the packed characters (do not edit by hand):",
    " * each palette's swatch colours (the tone a third of the way down, sRGB hex, [row][column])",
    " * and the swatches each mesh's UVs land in. The team-rule test reads these in node.",
    " */",
    "export const SWATCH_HEX: Record<string, number[][]> = {",
  ];
  for (const [id, t] of Object.entries(tables)) {
    lines.push(`  ${id}: [`);
    for (const row of t.rows) lines.push(`    [${row.map((h) => "0x" + h.toString(16).padStart(6, "0")).join(", ")}],`);
    lines.push("  ],");
  }
  lines.push("};", "", "/** Swatches (\"column,row\") each node's mesh uses, per character file. */");
  lines.push("export const MESH_SWATCHES: Record<string, Record<string, string[]>> = {");
  for (const [id, t] of Object.entries(tables)) {
    lines.push(`  ${id}: {`);
    for (const [mesh, sw] of Object.entries(t.meshes)) lines.push(`    ${/^[A-Za-z_]\w*$/.test(mesh) ? mesh : JSON.stringify(mesh)}: [${sw.map((s) => JSON.stringify(s)).join(", ")}],`);
    lines.push("  },");
  }
  lines.push("};", "");
  writeFileSync(join(root, "src/render3d/cast/palettes.ts"), lines.join("\n"));
}

// --- credits: sources, licence, checksums ---
{
  const git = (dir) => {
    try {
      return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    } catch {
      return "unknown";
    }
  };
  const lines = [
    "Characters and animations in this folder:",
    "",
    "  KayKit Adventurers Character Pack 1.0, by Kay Lousberg (www.kaylousberg.com)",
    "    https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 (commit " + git(advRepo) + ")",
    "  KayKit Skeletons Character Pack 1.0, by Kay Lousberg (www.kaylousberg.com)",
    "    https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 (commit " + git(skelRepo) + ")",
    "",
    "  Licence: Creative Commons Zero, CC0 1.0 Universal (public domain dedication).",
    "  https://creativecommons.org/publicdomain/zero/1.0/",
    "",
    "Packed by tools/troop-pack.mjs (meshes, props and clips the game uses), compressed with",
    "gltfpack 0.22 (MIT, meshoptimizer by Arseny Kapoulkine). SHA-256 of every source file read:",
    "",
  ];
  for (const [file, sha] of [...sources].sort()) {
    const rel = file.startsWith(advRepo) ? `adventurers/${relative(advRepo, file)}` : `skeletons/${relative(skelRepo, file)}`;
    lines.push(`  ${sha}  ${rel}`);
  }
  writeFileSync(join(outDir, "CREDITS.txt"), lines.join("\n") + "\n");
}

rmSync(work, { recursive: true, force: true });
let total = 0;
for (const r of report) total += Number(r.split(" ")[1]);
console.log(report.join("\n") + `\ntotal ${total} KB`);
