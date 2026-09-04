/**
 * Trophy Road arena looks: every arena on the ladder is its own world.
 * scene3d consumes one ArenaLook per battle — floor, sky, mid-band,
 * crossings, towers, props, lights — so climbing visibly changes the
 * stage you fight on. The Arabic edition keeps its single night bazaar.
 */

export type BrickVariant =
  | "sand" | "pink" | "blue" | "grey" | "marble" | "dark" | "ice" | "moss" | "bone";

export type ScatterStyle =
  | "confetti" | "pebbles" | "grass" | "bones" | "embers" | "snow" | "crystals" | "none";

export type BridgeStyle = "gate" | "timber" | "stone" | "ice";

export type TreeKind = "pine" | "topiary" | "dead" | "palm";

export interface ArenaLook {
  id: string;
  /** Surround + fog. */
  sky: number;
  apron: number;
  far: number;
  fieldSide: number;
  edging: number;
  drift: number;
  fogNear: number;
  fogFar: number;
  /** Daylight rig. */
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sun: number;
  fill: number;
  /** Living-sky target: what the sky becomes by overtime. */
  nightSky: number;
  floor: {
    a: string;
    b: string;
    grid: string;
    lane: string;
    laneEdge: string;
    watermark: string | null;
    scatter: ScatterStyle;
  };
  band: {
    fill: string;
    streak: string;
    glint: number;
    glintOpacity: number;
    foam: number;
    foamOpacity: number;
    bridge: BridgeStyle;
  };
  tower: {
    enemy: BrickVariant;
    player: BrickVariant;
    platformEnemy: number;
    platformPlayer: number;
    plinth: number;
    battlement: number;
  };
  fencePost: number;
  fenceRail: number;
  standWall: number;
  standRoofEnemy: number;
  standRoofPlayer: number;
  tentWall: number;
  cornerPost: number;
  /** Neon cage lights on the corner posts / end strips (null = none). */
  neon: { enemy: number; player: number } | null;
  /** String-light colors ringing the field (null = no strings). */
  lanterns: number[] | null;
  /** Bridge lamp glow. */
  torch: number;
  tree: { kind: TreeKind; trunk: number; leafA: number; leafB: number };
  rock: number;
  flowers: boolean;
}

const WHITE_STREAK = "rgba(255,255,255,0.5)";

export const LOOKS: Record<string, ArenaLook> = {
  meadow: {
    id: "meadow",
    sky: 0x7ec8ff, apron: 0x4f9a3c, far: 0x3d7a2f, fieldSide: 0x8a6a3c, edging: 0x8b6b45, drift: 0x5fae4c,
    fogNear: 30, fogFar: 70,
    hemiSky: 0xdff3ff, hemiGround: 0x4f7a3c, hemiIntensity: 1.0, sun: 0xfff2d8, fill: 0xffe2b8,
    nightSky: 0x1a2450,
    floor: { a: "#7fc957", b: "#72bb4d", grid: "rgba(60,110,40,0.3)", lane: "rgba(214,178,112,0.9)", laneEdge: "rgba(150,112,58,0.5)", watermark: null, scatter: "grass" },
    band: { fill: "#3aa0d8", streak: WHITE_STREAK, glint: 0xcff7ff, glintOpacity: 0.72, foam: 0xd8fff8, foamOpacity: 0.45, bridge: "timber" },
    tower: { enemy: "sand", player: "sand", platformEnemy: 0xcfc4ab, platformPlayer: 0xcfc4ab, plinth: 0x9c8d74, battlement: 0x9c8d74 },
    fencePost: 0x6e4a28, fenceRail: 0x7d5a36, standWall: 0x9c8a6a, standRoofEnemy: 0xc62828, standRoofPlayer: 0x2c55b8, tentWall: 0xe8e3d8, cornerPost: 0xb3a890,
    neon: null, lanterns: null, torch: 0xffa726,
    tree: { kind: "pine", trunk: 0x6e4a28, leafA: 0x3f8f45, leafB: 0x4ba14f }, rock: 0x8e9aa5, flowers: true,
  },
  swamp: {
    id: "swamp",
    sky: 0x2c4a2e, apron: 0x2f4a26, far: 0x1c2f18, fieldSide: 0x4a5a2a, edging: 0x5b4a2a, drift: 0x3f6a33,
    fogNear: 24, fogFar: 56,
    hemiSky: 0xb8d9a8, hemiGround: 0x2a3a1c, hemiIntensity: 0.95, sun: 0xe8f0c8, fill: 0xa8c890,
    nightSky: 0x0f1a12,
    floor: { a: "#6c8f3a", b: "#5f8034", grid: "rgba(40,60,20,0.35)", lane: "rgba(120,110,70,0.85)", laneEdge: "rgba(70,60,30,0.5)", watermark: null, scatter: "pebbles" },
    band: { fill: "#2f5a3a", streak: "rgba(160,220,120,0.35)", glint: 0x9ef08a, glintOpacity: 0.5, foam: 0x8fe07a, foamOpacity: 0.3, bridge: "timber" },
    tower: { enemy: "moss", player: "moss", platformEnemy: 0x9aa27a, platformPlayer: 0x9aa27a, plinth: 0x6f7a55, battlement: 0x6f7a55 },
    fencePost: 0x3f2a16, fenceRail: 0x4a3018, standWall: 0x4a4a2a, standRoofEnemy: 0x7a1e14, standRoofPlayer: 0x1c3a6e, tentWall: 0x8a7a5a, cornerPost: 0x6a5a3a,
    neon: null, lanterns: [0x9dff5a, 0xfff176, 0x9dff5a], torch: 0x9dff5a,
    tree: { kind: "pine", trunk: 0x4a3a20, leafA: 0x2e6b32, leafB: 0x3a8a3c }, rock: 0x5a6a52, flowers: false,
  },
  bone: {
    id: "bone",
    sky: 0x5a2d6e, apron: 0x8a6f4a, far: 0x4a2a5a, fieldSide: 0x9c8a5c, edging: 0x8f7a55, drift: 0xb8a878,
    fogNear: 26, fogFar: 60,
    hemiSky: 0xf0d8ff, hemiGround: 0x5a4a3a, hemiIntensity: 1.0, sun: 0xffe0c8, fill: 0xd8b8ff,
    nightSky: 0x1a0f2a,
    floor: { a: "#d9c9a3", b: "#cdbd97", grid: "rgba(120,100,60,0.3)", lane: "rgba(180,150,100,0.9)", laneEdge: "rgba(110,85,50,0.5)", watermark: null, scatter: "bones" },
    band: { fill: "#3c2a4a", streak: "rgba(180,120,220,0.3)", glint: 0xc88aff, glintOpacity: 0.45, foam: 0x9a6fd0, foamOpacity: 0.25, bridge: "stone" },
    tower: { enemy: "bone", player: "bone", platformEnemy: 0xd3c7a6, platformPlayer: 0xd3c7a6, plinth: 0xa89a78, battlement: 0xa89a78 },
    fencePost: 0x6e5a3a, fenceRail: 0x7a6a4a, standWall: 0x8a7a5a, standRoofEnemy: 0x7a1e5a, standRoofPlayer: 0x2c3a8a, tentWall: 0xcbbc9a, cornerPost: 0xb3a890,
    neon: null, lanterns: [0xc88aff, 0xff8ad8, 0xc88aff], torch: 0xc88aff,
    tree: { kind: "dead", trunk: 0x5a4a3a, leafA: 0x4a3a2a, leafB: 0x5a4a3a }, rock: 0xcfc4ab, flowers: false,
  },
  snow: {
    id: "snow",
    sky: 0x9fc8e8, apron: 0xe8f0f6, far: 0xc8d8e8, fieldSide: 0x8c8a86, edging: 0x7a7268, drift: 0xf4f8fb,
    fogNear: 30, fogFar: 68,
    hemiSky: 0xe8f4ff, hemiGround: 0x8a9ab0, hemiIntensity: 1.05, sun: 0xfff6e8, fill: 0xd8e8ff,
    nightSky: 0x101a30,
    floor: { a: "#eef4f8", b: "#e2eaf0", grid: "rgba(150,170,190,0.3)", lane: "rgba(190,200,215,0.9)", laneEdge: "rgba(120,135,155,0.5)", watermark: null, scatter: "snow" },
    band: { fill: "#5fb5e0", streak: WHITE_STREAK, glint: 0xffffff, glintOpacity: 0.7, foam: 0xe8f4ff, foamOpacity: 0.5, bridge: "ice" },
    tower: { enemy: "grey", player: "grey", platformEnemy: 0xd8dde4, platformPlayer: 0xd8dde4, plinth: 0x8d93a4, battlement: 0x8d93a4 },
    fencePost: 0x5a4a3a, fenceRail: 0x6a5a4a, standWall: 0x8a8a8a, standRoofEnemy: 0xc62828, standRoofPlayer: 0x2c55b8, tentWall: 0xe8e3d8, cornerPost: 0xb3b8c0,
    neon: null, lanterns: [0xffe08a, 0xfff6e0, 0xffe08a], torch: 0xffa726,
    tree: { kind: "pine", trunk: 0x4a3a2a, leafA: 0x2f6b4a, leafB: 0x3a7f5a }, rock: 0x9aa5b0, flowers: false,
  },
  forge: {
    id: "forge",
    sky: 0x2a1410, apron: 0x2e2226, far: 0x160c0a, fieldSide: 0x3a3238, edging: 0x4a3a3a, drift: 0x3a2a2a,
    fogNear: 22, fogFar: 54,
    hemiSky: 0xffb090, hemiGround: 0x2a1a1a, hemiIntensity: 0.9, sun: 0xffcaa0, fill: 0xff8a5a,
    nightSky: 0x120806,
    floor: { a: "#4a4650", b: "#403c46", grid: "rgba(255,140,60,0.18)", lane: "rgba(120,80,60,0.85)", laneEdge: "rgba(255,120,40,0.35)", watermark: "rgba(255,150,60,0.15)", scatter: "embers" },
    band: { fill: "#ff6a1a", streak: "rgba(255,230,120,0.5)", glint: 0xffe08a, glintOpacity: 0.8, foam: 0xff9a3a, foamOpacity: 0.35, bridge: "stone" },
    tower: { enemy: "dark", player: "dark", platformEnemy: 0x5a5560, platformPlayer: 0x5a5560, plinth: 0x3a3540, battlement: 0x3a3540 },
    fencePost: 0x2a2226, fenceRail: 0x3a3236, standWall: 0x3a2a2a, standRoofEnemy: 0xd84e2a, standRoofPlayer: 0x2c55b8, tentWall: 0x4a3a3a, cornerPost: 0x3a3540,
    neon: { enemy: 0xff7a36, player: 0xffb04a }, lanterns: [0xff7a36, 0xff5340, 0xffb04a], torch: 0xff7a36,
    tree: { kind: "dead", trunk: 0x2a2226, leafA: 0x3a3236, leafB: 0x2a2226 }, rock: 0x4a4650, flowers: false,
  },
  mystic: {
    id: "mystic",
    sky: 0x2a1a5a, apron: 0x3a2a6a, far: 0x1a0f3a, fieldSide: 0x6a5aa0, edging: 0x5a4a8a, drift: 0x6a4aa8,
    fogNear: 26, fogFar: 60,
    hemiSky: 0xd8c8ff, hemiGround: 0x3a2a5a, hemiIntensity: 1.0, sun: 0xf0e8ff, fill: 0xb890ff,
    nightSky: 0x0d0820,
    floor: { a: "#7a6ab0", b: "#6e5ea4", grid: "rgba(200,180,255,0.2)", lane: "rgba(190,160,255,0.85)", laneEdge: "rgba(120,90,200,0.5)", watermark: "rgba(220,200,255,0.16)", scatter: "crystals" },
    band: { fill: "#5a3aa8", streak: "rgba(220,200,255,0.5)", glint: 0xe0c8ff, glintOpacity: 0.7, foam: 0xc8b0ff, foamOpacity: 0.35, bridge: "stone" },
    tower: { enemy: "marble", player: "marble", platformEnemy: 0xcfc4e0, platformPlayer: 0xcfc4e0, plinth: 0x8a7aa8, battlement: 0x8a7aa8 },
    fencePost: 0x3a2a6a, fenceRail: 0x4a3a7a, standWall: 0x3a2a5a, standRoofEnemy: 0xc02a7a, standRoofPlayer: 0x3a5ad8, tentWall: 0x8a7ab0, cornerPost: 0x5a4a8a,
    neon: { enemy: 0xff6ad8, player: 0x6ab0ff }, lanterns: [0xb08aff, 0x59d6ff, 0xff8ad8], torch: 0xb08aff,
    tree: { kind: "topiary", trunk: 0x3a2a5a, leafA: 0x4a3a8c, leafB: 0x5a4aa0 }, rock: 0x8a7ab0, flowers: false,
  },
  workshop: {
    id: "workshop",
    sky: 0x8a6a4a, apron: 0x6a4a2a, far: 0x3a2a1a, fieldSide: 0x7a5a3a, edging: 0x9a6a3a, drift: 0x8a6a4a,
    fogNear: 26, fogFar: 60,
    hemiSky: 0xffe8c8, hemiGround: 0x5a3a1a, hemiIntensity: 1.0, sun: 0xfff0d0, fill: 0xffd8a0,
    nightSky: 0x1a1008,
    floor: { a: "#b8925a", b: "#ad8850", grid: "rgba(80,50,20,0.35)", lane: "rgba(140,100,60,0.9)", laneEdge: "rgba(70,45,20,0.5)", watermark: null, scatter: "pebbles" },
    band: { fill: "#4a4a52", streak: "rgba(220,200,160,0.3)", glint: 0xffd080, glintOpacity: 0.5, foam: 0xc0a060, foamOpacity: 0.25, bridge: "timber" },
    tower: { enemy: "sand", player: "sand", platformEnemy: 0xc0a070, platformPlayer: 0xc0a070, plinth: 0x8a6a3a, battlement: 0x8a6a3a },
    fencePost: 0x6a4a28, fenceRail: 0x7d5a36, standWall: 0x6a4a2a, standRoofEnemy: 0xb03a2a, standRoofPlayer: 0x2a5ab0, tentWall: 0xc8b090, cornerPost: 0x9a7a4a,
    neon: null, lanterns: [0xffc46b, 0xffe08a, 0xffb04a], torch: 0xffa726,
    tree: { kind: "pine", trunk: 0x5a3a1a, leafA: 0x6a8a3a, leafB: 0x7a9a4a }, rock: 0x8e8a80, flowers: false,
  },
  royal: {
    id: "royal",
    sky: 0x6aa8e8, apron: 0xd8d0c0, far: 0x8a9ab0, fieldSide: 0xc8c0b0, edging: 0xd9a93f, drift: 0xe0d8c8,
    fogNear: 32, fogFar: 72,
    hemiSky: 0xf0f6ff, hemiGround: 0x8a8070, hemiIntensity: 1.05, sun: 0xfff6e0, fill: 0xffe8c8,
    nightSky: 0x141a38,
    floor: { a: "#ece6d8", b: "#e2dccd", grid: "rgba(160,140,110,0.3)", lane: "rgba(220,180,90,0.85)", laneEdge: "rgba(170,130,50,0.5)", watermark: "rgba(200,170,90,0.2)", scatter: "none" },
    band: { fill: "#2f7fd0", streak: WHITE_STREAK, glint: 0xcff7ff, glintOpacity: 0.7, foam: 0xd8fff8, foamOpacity: 0.45, bridge: "stone" },
    tower: { enemy: "marble", player: "marble", platformEnemy: 0xe8e0d0, platformPlayer: 0xe8e0d0, plinth: 0xbdb4a2, battlement: 0xbdb4a2 },
    fencePost: 0xb3a890, fenceRail: 0xc8b898, standWall: 0xd0c8b8, standRoofEnemy: 0xc62828, standRoofPlayer: 0x2c55b8, tentWall: 0xf0e8d8, cornerPost: 0xd9a93f,
    neon: null, lanterns: [0xffe08a, 0xfff6e0, 0xffd060], torch: 0xffd060,
    tree: { kind: "topiary", trunk: 0x6a4a2a, leafA: 0x3f8f45, leafB: 0x4ba14f }, rock: 0xcfc4ab, flowers: true,
  },
  ice: {
    id: "ice",
    sky: 0x5a8ac8, apron: 0xd0e4f4, far: 0x8ab0d8, fieldSide: 0x7a9ab8, edging: 0x6a8aa8, drift: 0xe8f4ff,
    fogNear: 30, fogFar: 68,
    hemiSky: 0xd8ecff, hemiGround: 0x5a7a9a, hemiIntensity: 1.0, sun: 0xfff6e8, fill: 0xc8e0ff,
    nightSky: 0x0a1428,
    floor: { a: "#d8ecf8", b: "#cce2f0", grid: "rgba(120,160,200,0.35)", lane: "rgba(160,190,220,0.9)", laneEdge: "rgba(90,130,170,0.5)", watermark: null, scatter: "snow" },
    band: { fill: "#a8dcf4", streak: "rgba(255,255,255,0.6)", glint: 0xffffff, glintOpacity: 0.8, foam: 0xffffff, foamOpacity: 0.4, bridge: "ice" },
    tower: { enemy: "ice", player: "ice", platformEnemy: 0xe0f0fa, platformPlayer: 0xe0f0fa, plinth: 0x9ab8d0, battlement: 0x9ab8d0 },
    fencePost: 0x5a6a7a, fenceRail: 0x6a7a8a, standWall: 0x8aa0b8, standRoofEnemy: 0xc62828, standRoofPlayer: 0x2c55b8, tentWall: 0xe8f0f8, cornerPost: 0xb8d0e0,
    neon: null, lanterns: [0x9adcff, 0xffffff, 0x9adcff], torch: 0x9adcff,
    tree: { kind: "pine", trunk: 0x3a3a4a, leafA: 0x9ac8e0, leafB: 0xb0d8f0 }, rock: 0xb8ccd8, flowers: false,
  },
  jungle: {
    id: "jungle",
    sky: 0x3a7a4a, apron: 0x2a5a2a, far: 0x163a1a, fieldSide: 0x5a4a2a, edging: 0x6a5a3a, drift: 0x2f7a3a,
    fogNear: 24, fogFar: 58,
    hemiSky: 0xc8f0c8, hemiGround: 0x1a3a1a, hemiIntensity: 1.0, sun: 0xfff2d8, fill: 0xa0e0a0,
    nightSky: 0x08140a,
    floor: { a: "#5a9a3a", b: "#529032", grid: "rgba(30,70,20,0.35)", lane: "rgba(160,120,70,0.9)", laneEdge: "rgba(90,60,30,0.5)", watermark: null, scatter: "grass" },
    band: { fill: "#1f8a8a", streak: "rgba(200,255,240,0.45)", glint: 0xaaffee, glintOpacity: 0.6, foam: 0xc8fff0, foamOpacity: 0.4, bridge: "timber" },
    tower: { enemy: "moss", player: "moss", platformEnemy: 0xb0a880, platformPlayer: 0xb0a880, plinth: 0x7a7a55, battlement: 0x7a7a55 },
    fencePost: 0x4a3a1a, fenceRail: 0x5a4a2a, standWall: 0x5a4a2a, standRoofEnemy: 0xc62828, standRoofPlayer: 0x2c55b8, tentWall: 0xc8b890, cornerPost: 0x8a7a5a,
    neon: null, lanterns: [0xffe08a, 0x9dff5a, 0xffe08a], torch: 0xffa726,
    tree: { kind: "palm", trunk: 0x8a6a3e, leafA: 0x3f8f45, leafB: 0x57a83f }, rock: 0x6a7a5a, flowers: true,
  },
  neon: {
    id: "neon",
    sky: 0x2c1247, apron: 0x2a1a44, far: 0x190b30, fieldSide: 0x8a7cc2, edging: 0x453e66, drift: 0x554b80,
    fogNear: 26, fogFar: 58,
    hemiSky: 0xcfe0ff, hemiGround: 0x3a2c58, hemiIntensity: 1.05, sun: 0xeef2ff, fill: 0xd8c2ff,
    nightSky: 0x120830,
    floor: { a: "#d3e6ef", b: "#c4dae7", grid: "rgba(150,175,205,0.28)", lane: "rgba(178,162,224,0.78)", laneEdge: "rgba(140,120,190,0.5)", watermark: "rgba(110,135,190,0.13)", scatter: "confetti" },
    band: { fill: "#262b42", streak: "rgba(150,160,220,0.28)", glint: 0xe08aff, glintOpacity: 0.5, foam: 0xb98aff, foamOpacity: 0.3, bridge: "gate" },
    tower: { enemy: "pink", player: "blue", platformEnemy: 0xd2a8d8, platformPlayer: 0xaebeda, plinth: 0x8d93a4, battlement: 0x8d93a4 },
    fencePost: 0x2b2f48, fenceRail: 0x3a4060, standWall: 0x2e3352, standRoofEnemy: 0xa8236e, standRoofPlayer: 0x2c55b8, tentWall: 0x6a5f92, cornerPost: 0x3c3a5c,
    neon: { enemy: 0xff4fd8, player: 0x4f8aff }, lanterns: [0xff4fd8, 0x59d6ff, 0xb08aff], torch: 0xd96aff,
    tree: { kind: "topiary", trunk: 0x2f2a4a, leafA: 0x3d2f66, leafB: 0x4a3a7c }, rock: 0x6a628f, flowers: false,
  },
};

/** Arabic edition: one night bazaar, driven by the fields scene3d shares. */
export const ARABIC_LOOK: ArenaLook = {
  ...LOOKS.neon,
  id: "arabic",
  sky: 0x141a38, apron: 0x8a6f48, far: 0x241d3e, fieldSide: 0xa89870, edging: 0xc8a85c, drift: 0xb89a68,
  fogNear: 30, fogFar: 62,
  hemiSky: 0xcfd8ff, hemiGround: 0x4a3a58, hemiIntensity: 0.95, sun: 0xfff2d8, fill: 0xffe2b8,
  nightSky: 0x0a0e24,
  band: { fill: "#1460c8", streak: WHITE_STREAK, glint: 0xcff7ff, glintOpacity: 0.72, foam: 0xe8f4ff, foamOpacity: 0.45, bridge: "stone" },
  tower: { enemy: "sand", player: "sand", platformEnemy: 0xcfc4ab, platformPlayer: 0xcfc4ab, plinth: 0x9c8d74, battlement: 0x9c8d74 },
  fencePost: 0x6e4a28, fenceRail: 0x7d5a36, standWall: 0xb3a890, standRoofEnemy: 0xb02e22, standRoofPlayer: 0x2c55b8, tentWall: 0xe8e3d8, cornerPost: 0xb3a890,
  neon: null, lanterns: [0xffc46b, 0x5ad7c8, 0xffe08a], torch: 0xffc46b,
  tree: { kind: "palm", trunk: 0x8a6a3e, leafA: 0x3f8f45, leafB: 0x57a83f }, rock: 0x8e9aa5, flowers: true,
};

/** Which world each trophy-road arena is staged in. */
const ARENA_TO_LOOK: Record<string, string> = {
  "training-camp": "meadow",
  "goblin-stadium": "swamp",
  "bone-pit": "bone",
  "barbarian-bowl": "snow",
  "pekka-playhouse": "forge",
  "spell-valley": "mystic",
  "builders-workshop": "workshop",
  "royal-arena": "royal",
  "frozen-peak": "ice",
  "jungle-arena": "jungle",
  "legendary-peak": "neon",
};

export function lookForArena(arenaId: string): ArenaLook {
  return LOOKS[ARENA_TO_LOOK[arenaId] ?? "neon"] ?? LOOKS.neon;
}
