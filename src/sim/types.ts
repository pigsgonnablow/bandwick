// Shared world data types and constants (sim + renderer).

export const T = {
  DeepWater: 0,
  ShallowWater: 1,
  Sand: 2,
  Grass: 3,
  Forest: 4,
  Stone: 5,
  Mountain: 6,
} as const;
export type TerrainId = (typeof T)[keyof typeof T];

export const TERRAIN_NAMES = ['Deep water', 'Shallow water', 'Shore', 'Grass', 'Forest', 'Stone', 'Mountain'];

export const WATER = { None: 0, Sea: 1, Lake: 2, River: 3 } as const;
export const WATER_NAMES = ['', 'Sea', 'Lake', 'River'];

export const ORE_NAMES = ['', 'Copper', 'Tin', 'Iron', 'Gold'];

/** World units: 1 tile = 1 unit (about 6 m). */
export const STEP = 0.45; // height of one terrace level
export const LEVELS = 16;
export const SEA = 4; // highest underwater level; land starts at SEA + 1
export const SNOW_LEVEL = 15; // permanent snow at and above
export const BASE_Y = -1.6; // bottom of the diorama block

/** Water surfaces sit a quarter step below the bank they belong to. */
export const surfaceY = (bankLevel: number) => (bankLevel - 0.25) * STEP;
export const SEA_SURFACE = surfaceY(SEA + 1);

export interface WorldParams {
  seed: number;
  size: number; // tiles per side
  landFraction: number; // share of the map above sea
  mountains: number; // 0..2 multiplier
}

export const DEFAULT_PARAMS: Omit<WorldParams, 'seed'> = {
  size: 128,
  landFraction: 0.44,
  mountains: 1,
};

// ---- Prop catalog (shared with the Blender build script by naming convention) ----
export const SPECIES = ['pine', 'oak', 'birch'] as const;
export const STAGES = 4; // sapling, young, mature, old
export const TREE_VARIANTS = 3;
export const SMALL_PROPS: [string, number][] = [
  ['bush', 3],
  ['berry', 3],
  ['reeds', 3],
  ['grass', 3],
  ['rock', 5],
  ['outcrop', 3],
  // dynamic props created by the simulation (appended so worldgen ids never change)
  ['stump', 3], // one per species
  ['logs', 2],
  ['grave', 2],
];

export const PROP_NAMES: string[] = (() => {
  const names: string[] = [];
  for (const sp of SPECIES)
    for (let s = 0; s < STAGES; s++) for (let v = 0; v < TREE_VARIANTS; v++) names.push(`${sp}_s${s}_v${v}`);
  for (const [base, n] of SMALL_PROPS) for (let v = 0; v < n; v++) names.push(`${base}_v${v}`);
  return names;
})();
export const propId = (name: string) => PROP_NAMES.indexOf(name);
export const treeId = (species: number, stage: number, variant: number) =>
  species * STAGES * TREE_VARIANTS + stage * TREE_VARIANTS + variant;
export const smallPropId = (base: string, variant: number) => propId(`${base}_v${variant}`);

export interface WorldData {
  params: WorldParams;
  size: number;
  level: Uint8Array; // terrace level of the ground (0..15)
  groundY: Float32Array; // height of the tile's top surface (river beds are carved)
  terrain: Uint8Array; // TerrainId
  water: Uint8Array; // WATER kind
  waterY: Float32Array; // water surface height, or -1000 when dry
  flow: Int8Array; // river downstream direction 0..3 (N,E,S,W), -1 none
  moisture: Uint8Array; // 0..255
  temperature: Uint8Array; // 0..255
  fertility: Uint8Array; // 0..255
  stone: Uint16Array; // quarryable stone units
  ore: Uint8Array; // ORE index (hidden until mining tech)
  clay: Uint8Array; // 0/1
  // props
  propCount: number;
  propType: Uint16Array;
  propPos: Float32Array; // x, y, z
  propRot: Float32Array;
  propScale: Float32Array;
  propTile: Uint32Array;
  // painted ground textures
  texSize: number;
  colorTex: Uint8Array; // RGBA
  maskTex: Uint8Array; // R vegetation, G snow threshold, B flowers, A wetness
  // bookkeeping
  hash: string;
  genMs: number;
  stats: Record<string, number>;
}

export const DIRS4 = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;
