// Draws the band: animated villagers and deer (instanced, posed in the vertex shader),
// carried items, buildings rising as they're built, the hearth fire, its light and smoke.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ACT, CARRY, FLASH, TASK_KINDS, ITEM_KINDS, POT_HOLDS } from '../sim/band';
import { SHAKE } from './props';
import type { Frame } from '../sim/runner';
import { BASE_TPS } from '../sim/runner';
import { HareLayer } from './hares';
import { FishLayer } from './fish';
import { BirdLayer } from './birds';
import { TrackLayer } from './tracks';
import { WolfLayer, Keeper } from './wolves';
import { RemainsLayer } from './remains';
import { BeastLayer } from './beasts';
import { BEAST } from '../sim/band';
import { WorldData, WATER, STEP } from '../sim/types';
import { addCommon } from './shaderlib';
import { U } from './env';
import gait from '../assets/gait.json';

const P_STRIDE = 18;
/** Poses only the renderer chooses (the simulation just says where people are). */
const SWIM = 19, TREAD = 20;
const FISH_TASK = TASK_KINDS.indexOf('fish') + 1;
/** Drawn in a woodcutter's hands while they chop: an axe, or a hand chopper (a knapped stone in the fist). */
const AXE = 99, CHOPPER = 98;
/** Tools carried when the hands are otherwise free: a digging stick held low, a trap on the way to be set. */
const STICK = 97, SNARE = 96, FISHTRAP = 95;
/** A gathering basket: swung empty on the way out, and heaped with berries on the way home. */
const BASKET = 94, BASKET_FULL = 93;
/** A hare from the snares, carried home dangling from the fist on the trap round. */
const HARE = 92;
/** A clay lamp set down beside someone at work after dark, burning (the tool in hand is the lamp they lit). */
const LAMP = 91;
const LAMP_TOOL = ITEM_KINDS.indexOf('lamp') + 1;
/**
 * Fishing gear: a barbed harpoon (held and stabbed as the spear is), a hook and line (wound on its stick in the
 * fist on the way, held out over the water on a short rod while they sit at it), and a net (bundled on the
 * shoulder on the way, out in the water in front of whoever keeps it while it is hauled).
 */
const HARPOON = 90, LINE = 89, LINE_CAST = 88, NET = 87, NET_OUT = 86;
/** A log sledge dragged along behind a woodcutter on its rope: empty on the way out, loaded with logs on the way home. */
const SLEDGE = 85, SLEDGE_FULL = 84;
const SLEDGE_TOOL = ITEM_KINDS.indexOf('sledge') + 1;
/** A dugout canoe under someone paddling it or fishing from it out on the water (its floor rides this high over the water). */
const CANOE = 83;
const CANOE_TASK = TASK_KINDS.indexOf('canoe') + 1;
const CANOE_RIDE = 0.045;
const HARPOON_TOOL = ITEM_KINDS.indexOf('harpoon') + 1, LINE_TOOL = ITEM_KINDS.indexOf('line') + 1, NET_TOOL = ITEM_KINDS.indexOf('net') + 1;
/** The tip of the lamp's wick, where its flame burns, in the lamp model's own space (see LAMP_WICK in blender/build_band.py). */
const LAMP_WICK = new THREE.Vector3(0.0155, 0.0085, 0);
/** Where the lamp is set down: in front of the sitter and a little to one side, on the ground (drawn at twice its size, or it would be lost at the scale of the camp). */
const LAMP_AT = new THREE.Matrix4().makeRotationY(-0.6).scale(new THREE.Vector3(2, 2, 2)).setPosition(0.13, 0, 0.07);
const TRAP_TASK = TASK_KINDS.indexOf('trap') + 1;
const HUNT_TASK = TASK_KINDS.indexOf('hunt') + 1;
const EGGS_TASK = TASK_KINDS.indexOf('eggs') + 1, HONEY_TASK = TASK_KINDS.indexOf('honey') + 1;
/** How walls that are not wood colour a building that has no model of its own for them (multiplied over its own colours). */
const WALL_TINT: Record<string, [number, number, number]> = { daub: [1.0, 0.86, 0.68], stone: [0.8, 0.82, 0.86] };
/** A flying chip of wood or a drop of water. */
interface Bit {
  x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; r: number; g: number; b: number; floor: number;
  /** a breath of vapour rather than a chip or a drop: it drifts up instead of falling, and spreads as it goes */
  vapour?: boolean;
}
/** Water deeper than this share of someone's height means swimming rather than wading. */
const SWIM_DEPTH = 0.72;
const D_STRIDE = 6;
/** deer gait: stride lengths (tiles, for a grown deer), the pace (tiles a second) it breaks into
 *  a gallop over, the fastest its legs can cycle, and half the distance from fore to hind hooves */
const DEER_STRIDE_WALK = 0.34, DEER_STRIDE_RUN = 0.95, DEER_GALLOP_FROM = 2.2, DEER_GALLOP_FULL = 3.8, DEER_MAX_CADENCE = 6, DEER_HALF = 0.09;
interface DeerShown {
  /** where the simulation has it, and where the glide there started (and when, and how long it takes) */
  x: number; z: number; sx: number; sz: number; t0: number; dur: number; movedAt: number;
  /** drawn position (follows the glide with a little lag to round off corners) */
  dx: number; dz: number;
  /** ground under the fore and hind hooves, the body's height and its tilt (nose up is positive) */
  yf: number; yb: number; y: number; pitch: number;
  angle: number; want: number;
  phase: number; gait: number; moving: number;
  seen: number; state: number; fawn: boolean;
  /** distance walked since the last print in the snow, and which foot comes next */
  trail: number; foot: number;
  /** the last roar it steamed a breath for, and the last clash of antlers it threw up snow or dirt for */
  puffed: number; clashed: number;
}
const JT = gait.joints as unknown as Record<string, [number, number, number]>;
const HIP_Y = JT.hip[1];
/** Ground speed (body heights a second) where a walk turns into a run, and the fastest leg cadence shown. */
const RUN_FROM = 2.3, RUN_FULL = 3.6, MAX_CADENCE = 3.4;

/** Every clip authored in Blender (walk, run, the loops and the one-off moves), by name. */
const CLIPS = gait.clips as string[];
const CLIP = Object.fromEntries(CLIPS.map((n, i) => [n, i])) as Record<string, number>;
const clipRows = (name: string) => (gait as unknown as Record<string, number[][]>)[name];
const CH = Object.fromEntries((gait.channels as string[]).map((n, i) => [n, i])) as Record<string, number>;
/** A one-off clip's value for one channel, `pr` from 0 (start) to 1 (end). */
function onceAt(name: string, ch: string, pr: number) {
  const row = clipRows(name)[CH[ch]];
  const x = Math.min(1, Math.max(0, pr)) * (gait.samples - 1);
  const i = Math.floor(x), j = Math.min(i + 1, gait.samples - 1);
  return row[i] + (row[j] - row[i]) * (x - i);
}
/** One-off moves: which clip, and how long it plays at 1x (ms). */
const GESTURES = { lift: 850, putdown: 850, thrust: 750, stab: 650 } as const;
type Gesture = keyof typeof GESTURES;
/** How strongly a one-off move holds the body at a point in it: in quickly, out at the end. */
const gestureWeight = (pr: number) => smooth(0, 0.12, pr) * (1 - smooth(0.88, 1, pr));
function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
/** The arm a carried thing hangs from, in the pose it is normally carried in: [shoulder, elbow, lean]. */
function baseArm(carry: number): [number, number, number] {
  if (carry === CARRY.Log || carry === CARRY.Meat || carry === CARRY.Stone || carry === CARRY.Grain) return [-1.55, -1.95, 0.05];
  if (carry === CARRY.Body) return [-1.25, -1.35, 0.05];
  if (carry === CARRY.Berries || carry === CARRY.Fiber || carry === CARRY.Mud || carry === CARRY.Roots || carry === CARRY.Nuts || carry === CARRY.Herbs || carry === CARRY.Eggs || carry === CARRY.Honey || carry === CARRY.Mushrooms || carry === CARRY.Greens) return [-0.15, -0.55, 0.05];
  return [-0.1, -0.5, 0.05];
}
/** The walk (0) or run (1) cycle's value for one channel at stride phase `ph`, as gaitAt in POSE_GLSL. */
function loopAt(g: number, ch: string, ph: number) {
  const row = clipRows(CLIPS[g])[CH[ch]];
  const x = (ph - Math.floor(ph)) * gait.samples;
  const i = Math.floor(x) % gait.samples;
  return row[i] + (row[(i + 1) % gait.samples] - row[i]) * (x - Math.floor(x));
}
const gaitCh = (ch: string, ph: number, run: number) => loopAt(0, ch, ph) + (loopAt(1, ch, ph) - loopAt(0, ch, ph)) * run;
/** The right arm with a spear in hand, as POSE_GLSL bends it for one pose (holdCarry included):
 *  shoulder, elbow, lean and rise (bob less crouch); and how the spear lies in the hand in that hold,
 *  its angle (`grip`) when the arm and body are at `arm` (shoulder + elbow) and `tilt` (lean). */
interface SpearHold { sh: number; el: number; lean: number; y: number; grip: number; arm: number; tilt: number }
function spearHold(act: number, t: number, ph: number, run: number): SpearHold {
  // poised over the water, bobbing as they wait for a fish; point down and out
  if (act === ACT.Fish) return { sh: -2.2 + 0.45 * Math.max(0, Math.sin(t * 3)), el: -0.35, lean: 0.28, y: 0, grip: Math.PI / 2 + 0.55, arm: -2.55, tilt: 0.28 };
  const walking = act === ACT.Walk || act === ACT.Run || act === ACT.Hunt;
  const r = act === ACT.Hunt ? Math.max(run, 0.75) : run;
  const lean = walking ? gaitCh('lean', ph, r) : 0;
  const y = walking ? gaitCh('bob', ph, r) : act === ACT.Idle ? 0.0015 * Math.sin(t * 2.1) : 0;
  // raised to throw, nearly level
  if (act === ACT.Hunt) return { sh: -2.35, el: -0.35, lean: lean + 0.08, y, grip: Math.PI / 2 - 0.25, arm: -2.7, tilt: 0.28 };
  // held low at the side, point up
  return { sh: -0.45, el: -0.75, lean, y, grip: 0.22, arm: -1.2, tilt: 0.05 };
}
/** How much of a swing of the arm the wrist passes on to the spear (it takes up the rest itself). */
const WRIST = 0.45;
/** The grip a thrust or a stab is made with, whatever the spear was held in before (grip, arm, tilt as in SpearHold):
 *  overhand, so the point drives forward and down at a deer, or straight down into the water. */
const STRIKE: Partial<Record<Gesture, [number, number, number]>> = { thrust: [Math.PI / 2 - 0.25, -2.7, 0.05], stab: [Math.PI / 2 + 0.55, -2.55, 0.28] };
/** The spear in the right hand (person space): the holds of the pose being left and the one coming in,
 *  blended as the shader blends them (`k`), an elder's stoop, and a one-off move playing over it all. */
function spearInHand(from: SpearHold, to: SpearHold, k: number, stoop: number, g: Gesture | null, gpr: number, gw: number) {
  const mix = (a: number, b: number, w: number) => a + (b - a) * w;
  let sh = mix(from.sh, to.sh, k), el = mix(from.el, to.el, k), lean = mix(from.lean, to.lean, k) + stoop, y = mix(from.y, to.y, k);
  if (g && gw > 0) {
    sh = mix(sh, onceAt(g, 'shoulderR', gpr), gw);
    el = mix(el, onceAt(g, 'elbowR', gpr), gw);
    lean = mix(lean, onceAt(g, 'lean', gpr), gw);
    y = mix(y, onceAt(g, 'bob', gpr) - onceAt(g, 'lower', gpr), gw);
  }
  let grip = mix(from.grip, to.grip, k), arm = mix(from.arm, to.arm, k), tilt = mix(from.tilt, to.tilt, k);
  const strike = g && gw > 0 ? STRIKE[g] : undefined;
  if (strike) { grip = mix(grip, strike[0], gw); arm = mix(arm, strike[1], gw); tilt = mix(tilt, strike[2], gw); }
  // the shaft turns with the body, and part way with the arm: a stab drives the point down, a wind-up lifts it
  const angle = grip + (lean - tilt) + WRIST * (sh + el - arm);
  return new THREE.Matrix4().makeRotationX(angle).setPosition(handAt(sh, el, lean, -y));
}
/** Where the right hand is (person space) for given arm angles and lean, as the shader bends the body. */
function handAt(sh: number, el: number, lean: number, lower: number, out = new THREE.Vector3()) {
  const S = JT.shoulderR, E = JT.elbowR, H = JT.hip;
  // forearm, bent at the elbow, then the whole arm swung at the shoulder (rx as in POSE_GLSL)
  const rx = (v: THREE.Vector3, a: number) => v.set(v.x, Math.cos(a) * v.y - Math.sin(a) * v.z, Math.sin(a) * v.y + Math.cos(a) * v.z);
  const fore = rx(new THREE.Vector3(0, -0.068, 0), el);
  const arm = rx(new THREE.Vector3(E[0] - S[0], E[1] - S[1], E[2] - S[2]).add(fore), sh);
  out.set(S[0] + arm.x, S[1] + arm.y, S[2] + arm.z);
  // the upper body leans over the hips
  out.sub(new THREE.Vector3(0, H[1], 0));
  rx(out, lean);
  out.y += H[1] - lower;
  return out;
}

/** The clips authored in Blender, as a float texture: x = sample, y = clip * channels + channel. */
function gaitTexture() {
  const S = gait.samples, C = gait.channels.length;
  const data = new Float32Array(S * C * CLIPS.length);
  CLIPS.forEach((g, gi) => {
    clipRows(g).forEach((row, ci) => row.forEach((v, k) => (data[(gi * C + ci) * S + k] = v)));
  });
  const t = new THREE.DataTexture(data, S, C * CLIPS.length, THREE.RedFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

// sRGB palettes; each person's look seed picks from these
const CLOTH = ['#cbb894', '#8f6b4a', '#a86b3c', '#7b8b58', '#8e4b3b', '#70727a', '#4f6283', '#bba06f', '#5f4b3a', '#9a8a70'];
/** A woven tunic of nettle thread, in place of their own clothes: left pale, or dyed with bark or roots. */
const TUNIC = ['#cdc2a2', '#bfb291', '#a98563', '#9a5a44', '#d6ccb0'];
const SKIN = ['#efcfae', '#e2b892', '#d3a27a', '#bd8a62', '#a3714d', '#85583b'];
const HAIR = ['#21170f', '#33241a', '#4d331f', '#6e4426', '#9a6b38', '#c9a46a', '#7c3418', '#3e2a1a'];
const GREY = new THREE.Color('#bdb8ae');

interface Shown {
  x: number; z: number; px: number; pz: number; y: number; angle: number;
  act: number; carry: number; indoors: boolean; age: number; sex: number; look: number;
  seen: number; task: number;
  /** where they are drawn: the simulation's path, lightly smoothed so corners round off */
  dx: number; dz: number;
  /** heading to face (from the simulation); the drawn angle turns toward it */
  want: number;
  /** stride cycle position (in cycles) and walk-to-run mix */
  phase: number; run: number;
  /** pose blending: the pose being shown, the one before it, and when it changed */
  shownAct: number; prevAct: number; actAt: number; still: number;
  /** the last one-off move asked for by the simulation, and the one playing now */
  flash: number; gesture: Gesture | null; gestAt: number;
  /** what was in their hands as a put-down began (the simulation has already let go of it) */
  gestCarry: number;
  /** the point the simulation has them facing (the tree they chop, the water they fish) */
  fx: number; fz: number;
  /** their band */
  band: number;
  /** the tool in hand: 0 none, 1 chopper, 2 axe, 3 digging stick, 4 snare, 5 fish trap, 6 basket */
  tool: number;
  /** what they wear (the sim's dress flags: 1 cloak, 2 hat, 4 shoes, 8 reed cape, 16 bag, 32 mittens, 512 a woven tunic), and 64 a dog with them (128 a pup) */
  dress: number;
  /** someone dead and unburied: what is left of them (REMAINS stage plus the way to the next) */
  remains: number;
  /** where the axe swing had got to last frame; whether this stab has hit the water yet */
  swing: number; splashed: boolean;
}

/** The villager shader's style bits for what someone wears: cloak 32, hat 64, reed cape 128, bag 256, fur cloak 512 (in place of the hide one). */
export function dressStyle(dress: number) {
  const fur = dress & 256;
  return (dress & 1 && !fur ? 32 : 0) + (dress & 2 ? 64 : 0) + (dress & 8 ? 128 : 0) + (dress & 16 ? 256 : 0) + (fur ? 512 : 0);
}

/** Where the opening scene has someone, in place of where the simulation has them. */
export interface IntroPose {
  x: number;
  z: number;
  act: number;
  /** height to draw them at (default: the ground) */
  y?: number;
  /** heading (default: the way they move) */
  angle?: number;
  /** in the boat or stepping out of it: never swimming */
  afloat?: boolean;
}

export class BandLayer {
  group = new THREE.Group();
  /** the opening scene: draws people where it has them instead (null: as the simulation has them) */
  introPose: ((id: number, now: number) => IntroPose | null) | null = null;
  /** the opening scene: how far along the hearth and stockpile are (building id -> 0..1; 0 is not there yet) */
  introBuild = new Map<number, number>();
  /** a model from band.glb by name (e.g. the landing's boat) */
  geom(name: string) {
    return this.geoms.get(name);
  }
  private people = new Map<number, Shown>();
  private deer = new Map<number, DeerShown>();
  private villagers: THREE.InstancedMesh;
  private deerMesh: THREE.InstancedMesh;
  /** a few of the hares the simulation counts on the land, hopping about near the camera */
  hares: HareLayer;
  /** trout glimpsed under the water, rising and leaping, more where the water is full of fish */
  fish: FishLayer;
  /** finch flocks, geese passing over, birds round a robbed nest and bees round a smoked hive */
  birds: BirdLayer;
  /** hoofprints left in the snow */
  tracks = new TrackLayer();
  /** wolf packs from the simulation, and each keeper's dog at their heels */
  wolves: WolfLayer;
  remains: RemainsLayer;
  /** wild boar, foxes and beavers, and the beavers' lodges and dams */
  beasts: BeastLayer;
  private keepers: Keeper[] = [];
  /** anyone robbing a nest (kind 0) or smoking out a hive (kind 1) this frame, at the tree */
  private gleaners: { id: number; kind: number; x: number; z: number; y: number }[] = [];
  private carryMeshes = new Map<number, THREE.InstancedMesh>();
  private buildingMeshes = new Map<string, THREE.InstancedMesh>();
  private flames: THREE.InstancedMesh;
  /** what lies on each stockpile (by building id), and the meshes that show it */
  private piles = new Map<number, { wood: number; berries: number; meat: number; fish: number; preserved: number; pots?: number; bowls?: number; beads?: number; sashes?: number; jars?: number }>();
  private pileMeshes = new Map<string, THREE.InstancedMesh>();
  /** the snares and fish traps standing in the world, and their meshes (set, and holding a catch) */
  private traps: NonNullable<Frame['traps']> = [];
  private trapMeshes = new Map<string, THREE.InstancedMesh>();
  private glow: THREE.Sprite[] = [];
  /** the lamps burning beside those at work after dark: a little flame at each wick, and a soft halo */
  private lampFlames!: THREE.InstancedMesh;
  private lampGlow: THREE.Sprite[] = [];
  private lampsLit: THREE.Vector3[] = [];
  private lights: THREE.PointLight[] = [];
  private smoke: THREE.Points;
  private smokeMat: THREE.ShaderMaterial;
  /** the smoke from a charcoal clamp smouldering (the nearest one) */
  private clampSmoke: THREE.Points;
  private clampSmokeMat: THREE.ShaderMaterial;
  private selRing: THREE.Mesh;
  private hoverRing: THREE.Mesh;
  private buildings: NonNullable<Frame['buildings']> = [];
  private frameAt = 0;
  private tickMs = 100;
  selected = -1;
  hovered = -1;
  /** testing aid: show these people in a given pose (person id -> ACT code) */
  debugAct = new Map<number, number>();
  /** screen-space lookups for picking and labels */
  visible: { id: number; x: number; y: number; z: number; child: boolean }[] = [];
  visibleDeer: { id: number; x: number; y: number; z: number; fawn: boolean; state: number }[] = [];
  /** a ring marking whatever non-person thing is selected */
  marker: THREE.Mesh;
  markerAt: { x: number; y: number; z: number; r: number } | null = null;

  constructor(private world: WorldData, private geoms: Map<string, THREE.BufferGeometry>) {
    this.group.name = 'band';
    this.villagers = this.makeVillagers(geoms);
    this.deerMesh = this.makeDeer(geoms);
    this.hares = new HareLayer(world.size, world.terrain, (x, z) => this.groundAt(x, z), geoms);
    this.fish = new FishLayer(world, geoms, (x, z, y, size, drops) => this.waterMark(x, z, y, size, drops));
    this.birds = new BirdLayer(world, (x, z) => this.groundAt(x, z), geoms);
    this.wolves = new WolfLayer(geoms, (x, z) => this.groundAt(x, z), this.tracks);
    this.remains = new RemainsLayer(geoms);
    this.beasts = new BeastLayer(geoms, world, (x, z) => this.groundAt(x, z), this.tracks, (x, z, y, size, drops) => this.waterMark(x, z, y, size, drops),
      (x, y, z, n, [r, g, b], up) => {
        for (let k = 0; k < n; k++) {
          const a = Math.random() * Math.PI * 2, sp = 0.05 + Math.random() * 0.12;
          this.bits.push({ x, y, z, vx: Math.cos(a) * sp, vy: up * (0.5 + Math.random()), vz: Math.sin(a) * sp, age: 0, life: 0.6,
            size: 0.006 + Math.random() * 0.005, r, g, b, floor: this.groundAt(x, z) });
        }
      });
    this.group.add(this.beasts.group, this.villagers, this.deerMesh, this.hares.mesh, this.fish.mesh, this.fish.salmonMesh, this.birds.group, this.tracks.mesh, this.wolves.group, this.remains.group);
    // carried things
    const carryNames: [number, string][] = [
      [CARRY.Log, 'log'], [CARRY.Berries, 'berries'], [CARRY.Meat, 'meat'], [CARRY.Fish, 'fish'],
      [CARRY.Spear, 'spear'], [CARRY.Body, 'body'], [CARRY.Baby, 'baby'], [AXE, 'axe'], [CHOPPER, 'chopper'],
      [STICK, 'stick'], [SNARE, 'snare'], [FISHTRAP, 'fishtrap'], [BASKET, 'basket'], [BASKET_FULL, 'basketFull'], [HARE, 'hare'],
      // cut grass in a bundle, clay in a hide, a stone on the shoulder
      [CARRY.Fiber, 'fiber'], [CARRY.Mud, 'mud'], [CARRY.Stone, 'stone'], [CARRY.Roots, 'roots'], [CARRY.Nuts, 'nuts'], [CARRY.Herbs, 'herbs'],
      [CARRY.Eggs, 'eggs'], [CARRY.Honey, 'honey'], [CARRY.Mushrooms, 'mushrooms'], [CARRY.Grain, 'grain'], [CARRY.Greens, 'greens'],
      // a piglet carried home from the hunt in the arms, for the pen
      [CARRY.Piglet, 'piglet'],
      // a deer, or a boar or pig, laid out on its hide on the ground in front of whoever is butchering it
      [CARRY.Carcass, 'carcass'], [CARRY.BoarCarcass, 'boarCarcass'],
      [HARPOON, 'harpoon'], [LINE, 'line'], [LINE_CAST, 'lineCast'], [NET, 'net'], [NET_OUT, 'netOut'],
      [SLEDGE, 'sledge'], [SLEDGE_FULL, 'sledgeFull'], [CANOE, 'canoe'],
    ];
    const carryMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    carryMat.onBeforeCompile = (sh) => addCommon(sh);
    carryMat.customProgramCacheKey = () => 'carry';
    for (const [id, name] of [...carryNames, [LAMP, 'lamp'] as [number, string]]) {
      const g = geoms.get(`carry__${name}`) ?? geoms.get(`trap__${name}`) ?? geoms.get(`pile__${name}`);
      if (!g) continue;
      const m = new THREE.InstancedMesh(g, carryMat, 128);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      this.carryMeshes.set(id, m);
      this.group.add(m);
    }
    // buildings
    for (const kind of ['hearth', 'leanto', 'bedding', 'hut0', 'hut1', 'hut0d', 'hut1d', 'hut0s', 'hut1s', 'hut0p', 'hut1p', 'storehouse', 'storehoused', 'storehouses', 'storehousep', 'rack', 'site', 'stockpile', 'windbreak', 'woodshed',
      'plot', 'plotBurnt', 'plotSown', 'plotRoots', 'plotGrain', 'plotRipe', 'plotStubble', 'fence', 'pit', 'kiln', 'loom', 'pen', 'barrow1', 'barrow2', 'barrow3', 'barrow', 'stones1', 'stones2', 'stones3', 'stones', 'weir', 'weirFull', 'clamp', 'clampLit', 'canoe', 'canoeOut']) {
      const g0 = geoms.get(`bld__${kind}`);
      if (!g0) continue;
      const g = g0.clone();
      g.computeBoundingBox();
      const m = new THREE.InstancedMesh(g, this.buildingMaterial(kind, g.boundingBox!.max.y), 64);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      // a half-built wall casts the shadow of what is standing so far, not of the finished thing
      m.customDepthMaterial = this.buildingDepthMaterial(kind, g.boundingBox!.max.y);
      const prog = new THREE.InstancedBufferAttribute(new Float32Array(64).fill(1), 1);
      g.setAttribute('iProgress', prog);
      this.buildingMeshes.set(kind, m);
      this.group.add(m);
    }
    // fire
    const flameGeo = geoms.get('bld__flame') ?? new THREE.ConeGeometry(0.08, 0.25, 5);
    // the stockpile's contents: split logs stacked at the back, pots, baskets, meat and fish laid on the mat
    {
      const pm = new THREE.MeshLambertMaterial({ vertexColors: true });
      pm.onBeforeCompile = (sh) => addCommon(sh);
      pm.customProgramCacheKey = () => 'pile';
      for (const [key, geo] of [['log', 'pile__log'], ['basket', 'carry__berries'], ['meat', 'carry__meat'], ['fish', 'carry__fish'], ['pot', 'pile__pot'], ['bowl', 'pile__bowl'], ['beads', 'pile__beads'], ['sash', 'pile__sash'], ['jar', 'pile__jar']] as const) {
        const g = geoms.get(geo);
        if (!g) continue;
        const m = new THREE.InstancedMesh(g, pm, 64);
        m.count = 0;
        m.frustumCulled = false;
        m.castShadow = true;
        m.receiveShadow = true;
        this.pileMeshes.set(key, m);
        this.group.add(m);
      }
      for (const key of ['snare', 'snareFull', 'fishtrap', 'fishtrapFull', 'deadfall', 'deadfallFull', 'deadfallBeaver']) {
        const g = geoms.get(`trap__${key}`);
        if (!g) continue;
        const m = new THREE.InstancedMesh(g, pm, 32);
        m.count = 0;
        m.frustumCulled = false;
        m.castShadow = true;
        m.receiveShadow = true;
        this.trapMeshes.set(key, m);
        this.group.add(m);
      }
    }
    this.flames = new THREE.InstancedMesh(flameGeo, this.flameMaterial(), 8);
    this.flames.count = 0;
    this.flames.frustumCulled = false;
    this.flames.renderOrder = 4;
    this.group.add(this.flames);
    // a lamp's flame is the fire's, small
    this.lampFlames = new THREE.InstancedMesh(flameGeo.clone().scale(0.11, 0.13, 0.11), this.flameMaterial(), 16);
    this.lampFlames.count = 0;
    this.lampFlames.frustumCulled = false;
    this.lampFlames.renderOrder = 4;
    this.group.add(this.lampFlames);
    const glowTex = radialTexture();
    for (let k = 0; k < 8; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffb860, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.visible = false;
      sp.renderOrder = 6;
      this.lampGlow.push(sp);
      this.group.add(sp);
    }
    for (let k = 0; k < 4; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sp.visible = false;
      sp.renderOrder = 6;
      this.glow.push(sp);
      this.group.add(sp);
    }
    for (let k = 0; k < 2; k++) {
      const l = new THREE.PointLight(0xffa24a, 0, 9, 1.6);
      l.castShadow = false;
      this.lights.push(l);
      this.group.add(l);
    }
    const sm = makeSmoke();
    this.smoke = sm.points;
    this.smokeMat = sm.mat;
    this.group.add(this.smoke);
    const cs = makeSmoke();
    this.clampSmoke = cs.points;
    this.clampSmokeMat = cs.mat;
    this.group.add(this.clampSmoke);
    // selection rings
    const ringMat = (c: number, o: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide });
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.21, 24).rotateX(-Math.PI / 2), ringMat(0xe3ab4e, 0.95));
    this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.19, 24).rotateX(-Math.PI / 2), ringMat(0xfff2d0, 0.6));
    this.selRing.renderOrder = this.hoverRing.renderOrder = 7;
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2), ringMat(0xe3ab4e, 0.9));
    this.marker.renderOrder = 7;
    this.marker.visible = false;
    this.group.add(this.selRing, this.hoverRing, this.marker);
    // rings spreading on the water around anyone swimming
    const rg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const rm = new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
    this.ripples = new THREE.InstancedMesh(rg, rm, 96);
    this.ripples.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(96 * 3), 3);
    this.ripples.count = 0;
    this.ripples.frustumCulled = false;
    this.ripples.renderOrder = 3;
    this.group.add(this.ripples);
    // band colours: a glow on the ground around everyone, and a wide one around every building
    {
      const ag = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      ag.setAttribute('iStrength', new THREE.InstancedBufferAttribute(new Float32Array(256), 1));
      // the band's own colour laid over the ground (not added to it, so teal stays teal on green grass)
      const am = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uMap: { value: radialTexture() } },
        vertexShader: `
          attribute float iStrength;
          varying vec2 vUv; varying vec3 vCol; varying float vK;
          void main() {
            vUv = uv; vCol = instanceColor; vK = iStrength;
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform sampler2D uMap;
          varying vec2 vUv; varying vec3 vCol; varying float vK;
          void main() {
            float a = texture2D(uMap, vUv).a * vK;
            if (a < 0.003) discard;
            gl_FragColor = vec4(vCol, a);
            #include <colorspace_fragment>
          }`,
      });
      this.auras = new THREE.InstancedMesh(ag, am, 256);
      this.auras.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(256 * 3), 3);
      this.auras.count = 0;
      this.auras.frustumCulled = false;
      this.auras.renderOrder = 2;
      this.group.add(this.auras);
    }
    // chips of wood and drops of water
    const bm = new THREE.MeshLambertMaterial({ color: 0xffffff });
    bm.onBeforeCompile = (sh) => addCommon(sh);
    bm.customProgramCacheKey = () => 'bits';
    this.bitMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.5, 1), bm, 256);
    this.bitMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(256 * 3), 3);
    this.bitMesh.count = 0;
    this.bitMesh.frustumCulled = false;
    this.group.add(this.bitMesh);
  }

  /**
   * Make sure an instanced mesh can draw `need` copies; grows (doubling) by building a new mesh
   * over the same geometry, carrying its per-instance attributes across.
   */
  private grow(m: THREE.InstancedMesh, need: number): THREE.InstancedMesh {
    const cap = m.instanceMatrix.count;
    if (need <= cap) return m;
    const next = Math.max(need, cap * 2);
    const g = m.geometry;
    for (const [name, a] of Object.entries(g.attributes)) {
      if (!(a instanceof THREE.InstancedBufferAttribute)) continue;
      const arr = new Float32Array(next * a.itemSize);
      arr.set(a.array as Float32Array);
      if (name === 'iProgress') arr.fill(1, a.array.length);
      g.setAttribute(name, new THREE.InstancedBufferAttribute(arr, a.itemSize));
    }
    const nm = new THREE.InstancedMesh(g, m.material, next);
    nm.count = 0;
    nm.frustumCulled = false;
    nm.castShadow = m.castShadow;
    nm.receiveShadow = m.receiveShadow;
    nm.renderOrder = m.renderOrder;
    const parent = m.parent;
    parent?.add(nm);
    parent?.remove(m);
    m.dispose();
    return nm;
  }

  // ---------------------------------------------------------------- villager mesh
  private makeVillagers(geoms: Map<string, THREE.BufferGeometry>) {
    // part id, proximal joint (it turns about), distal joint (for shins and forearms)
    const none: [number, number, number] = [0, 0, 0];
    const parts: [string, number, [number, number, number], [number, number, number]][] = [
      ['torso', 0, JT.hip, none], ['head', 1, JT.neck, none],
      ['armL', 2, JT.shoulderL, none], ['armR', 3, JT.shoulderR, none],
      ['thighL', 4, JT.hipL, none], ['thighR', 5, JT.hipR, none],
      ['hairS', 6, JT.neck, none], ['hairL', 7, JT.neck, none],
      ['foreL', 8, JT.shoulderL, JT.elbowL], ['foreR', 9, JT.shoulderR, JT.elbowR],
      ['shinL', 10, JT.hipL, JT.kneeL], ['shinR', 11, JT.hipR, JT.kneeR],
      ['hairB', 12, JT.neck, none], ['hairU', 13, JT.neck, none], ['beard', 14, JT.neck, none],
      // the hide cloak hangs from the shoulders and goes with the upper body
      ['cloak', 15, JT.hip, none],
      // a fur hat goes with the head; a reed cape hangs like the cloak; a hide bag hangs at the hip from its strap
      ['hat', 16, JT.neck, none], ['cape', 17, JT.hip, none], ['bag', 18, JT.hip, none],
      // a fur cloak hangs like the hide one; its pelts are painted in their own colours, not the wearer's
      ['furcloak', 19, JT.hip, none],
    ];
    const list: THREE.BufferGeometry[] = [];
    for (const [name, id, p1, p2] of parts) {
      const g0 = geoms.get(`villager__${name}`);
      if (!g0) continue;
      const g = (g0.index ? g0.toNonIndexed() : g0.clone());
      g.deleteAttribute('aCenter');
      const n = g.attributes.position.count;
      // the body part id rides in the pivot's spare component (vertex inputs are few: at most 16)
      const a = new Float32Array(n * 4), b = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) { a.set(p1, k * 4); a[k * 4 + 3] = id; b.set(p2, k * 3); }
      g.setAttribute('aPivotPart', new THREE.BufferAttribute(a, 4));
      g.setAttribute('aPivot2', new THREE.BufferAttribute(b, 3));
      list.push(g);
    }
    const geo = mergeGeometries(list)!;
    const cap = 256;
    geo.setAttribute('iAnim', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    geo.setAttribute('iAnim2', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    geo.setAttribute('iAnim3', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    geo.setAttribute('iCloth', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    geo.setAttribute('iSkin', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    geo.setAttribute('iHair', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const gaitTex = gaitTexture();
    mat.customProgramCacheKey = () => 'villager2';
    mat.onBeforeCompile = (sh) => {
      addCommon(sh, { uGait: { value: gaitTex } });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 aPivotPart;
          #define aPivot (aPivotPart.xyz)
          #define aPart (aPivotPart.w)
          attribute vec3 aPivot2;
          attribute vec4 iAnim;
          attribute vec4 iAnim2;
          attribute vec4 iAnim3;
          attribute vec3 iCloth;
          attribute vec3 iSkin;
          attribute vec3 iHair;
          varying vec3 vCloth;
          varying vec3 vSkin;
          varying vec3 vHair;
          varying float vDead;
          varying float vReal;
          ${POSE_GLSL}`)
        .replace('#include <beginnormal_vertex>', `
          vec3 posed; mat3 poseR;
          poseVertex(position, posed, poseR);
          vec3 objectNormal = poseR * vec3(normal);
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif`)
        .replace('#include <begin_vertex>', `
          vec3 transformed = posed;
          vCloth = iCloth; vSkin = iSkin; vHair = iHair;
          vDead = step(10.5, iAnim.x) * step(iAnim.x, 11.5);
          vReal = step(18.5, aPart);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vCloth;
          varying vec3 vSkin;
          varying vec3 vHair;
          varying float vDead;
          varying float vReal;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec3 code = diffuseColor.rgb;
            float rest = clamp(1.0 - code.r - code.g - code.b, 0.0, 1.0);
            vec3 col = code.r * vCloth + code.g * vSkin + code.b * vHair + rest * vec3(0.12, 0.085, 0.06);
            // (the fur cloak carries its real colours)
            col = mix(col, code, vReal);
            col = mix(col, vec3(dot(col, vec3(0.3, 0.5, 0.2))) * vec3(0.85, 0.88, 0.95), vDead * 0.7);
            col *= mix(vec3(1.0), vec3(0.92, 0.95, 1.0), uSnow * 0.2);
            diffuseColor.rgb = col;
          }`);
    };
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // ---------------------------------------------------------------- deer mesh
  private makeDeer(geoms: Map<string, THREE.BufferGeometry>) {
    const parts: [string, number, [number, number, number]][] = [
      ['body', 0, [0, 0.19, 0]], ['head', 1, [0, 0.21, 0.1]], ['antlers', 6, [0, 0.21, 0.1]], ['spots', 7, [0, 0.19, 0]], ['jaw', 8, [0, 0.21, 0.1]],
      ['legFL', 2, [-0.035, 0.15, 0.09]], ['legFR', 3, [0.035, 0.15, 0.09]], ['legBL', 4, [-0.035, 0.15, -0.09]], ['legBR', 5, [0.035, 0.15, -0.09]],
    ];
    const list: THREE.BufferGeometry[] = [];
    for (const [name, id, pivot] of parts) {
      const g0 = geoms.get(`deer__${name}`);
      if (!g0) continue;
      const g = g0.index ? g0.toNonIndexed() : g0.clone();
      g.deleteAttribute('aCenter');
      const n = g.attributes.position.count;
      g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(id), 1));
      const pv = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) pv.set(pivot, k * 3);
      g.setAttribute('aPivot', new THREE.BufferAttribute(pv, 3));
      list.push(g);
    }
    const geo = mergeGeometries(list)!;
    const cap = 512;
    geo.setAttribute('iAnim', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    geo.setAttribute('iAnim2', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.customProgramCacheKey = () => 'deer';
    mat.onBeforeCompile = (sh) => {
      addCommon(sh);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aPart;
          attribute vec3 aPivot;
          attribute vec4 iAnim;
          // stride phase (0..1), walk-to-gallop, how much it is moving, mid-leap
          attribute vec4 iAnim2;
          mat3 rx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
          void deerPose(out mat3 R, out vec3 T) {
            float st = iAnim.x;
            float ph = iAnim2.x * 6.2831853;
            float gait = iAnim2.y, mv = iAnim2.z, leap = iAnim2.w;
            float a = 0.0, tilt = 0.0;
            float bob = 0.0;
            // the rut. A roaring stag (state 3) stretches his neck up and out and drops his jaw for a
            // long bellow, then draws breath; two fighting stags (state 4) put their heads down and lock
            // antlers, shove one way and then the other, and every so often draw back and crash together.
            // iAnim.y is which way this one gives ground (+1 or -1), so the pair heave together.
            float roar = step(2.5, st) * step(st, 3.5);
            float spar = step(3.5, st);
            float bell = roar * pow(max(0.0, sin((uTime + iAnim.y) * 1.7)), 1.5);
            float cyc = fract(uTime / 2.4);
            float draw = spar * smoothstep(0.62, 0.9, cyc) * (1.0 - smoothstep(0.9, 0.97, cyc));
            float jolt = spar * (1.0 - smoothstep(0.0, 0.12, cyc));
            float push = spar * iAnim.y * (sin(uTime * 0.9) * 0.7 + sin(uTime * 2.3 + 1.0) * 0.3) * (1.0 - draw);
            if (aPart > 1.5 && aPart < 5.5) {
              bool front = aPart < 3.5;
              bool left = aPart < 2.5 || (aPart > 3.5 && aPart < 4.5);
              // a walk sets the feet down one at a time (hind left, fore left, hind right, fore right);
              // a gallop bounds, hind pair then fore pair, each pair a touch apart
              float offW = front ? (left ? 0.25 : 0.75) : (left ? 0.0 : 0.5);
              float offG = front ? (left ? 0.5 : 0.58) : (left ? 0.0 : 0.08);
              float off = mix(offW, offG, gait) * 6.2831853;
              float sw = sin(ph + off);
              // the leg swings forward quickly and pushes back slowly along the ground
              sw = sw + 0.25 * sin(2.0 * (ph + off));
              a = sw * mix(0.4, 0.8, gait) * mv;
              // springing up or down a ledge: forelegs tuck forward, hind legs push out behind
              a += leap * (front ? -0.7 : 0.55);
              // braced to fight: forefeet planted out in front, hind legs driving back, harder as he gains ground
              a += spar * (front ? -0.22 - 0.1 * push : 0.3 + 0.18 * max(0.0, push));
            } else if ((aPart > 0.5 && aPart < 6.5) || aPart > 7.5) {
              // grazing: head down most of the time, up now and then to look around
              float graze = st < 0.5 ? smoothstep(-0.3, 0.3, sin((uTime + iAnim.y) * 0.6)) * (1.0 - mv) : 0.0;
              // a nod in time with the walk, stretched out at the gallop
              float nod = sin(ph * 2.0) * 0.06 * mv * (1.0 - gait);
              a = graze + nod - 0.25 * gait * mv;
              // roaring: neck stretched out and the nose thrown up, antlers laid back along the spine;
              // fighting: neck low and the brow tucked so the antlers point at the rival, tossed up as they draw back
              a += roar * 0.12 * bell + spar * (0.75 - 0.5 * draw + 0.1 * jolt);
              tilt = roar * (-0.45 - 0.55 * bell) + spar * (1.0 - 0.5 * draw);
            }
            // the body rises over each stride: a slight sway at the walk, a bound at the gallop
            bob = (abs(sin(ph)) * mix(0.006, 0.035, gait)) * mv;
            // the head nods on the top of the neck (the poll) as well as the neck swinging from the
            // shoulders: the part of the head part beyond the poll bends with it, the lower jaw hinges open
            // under the head (and is only there at all while roaring)
            mat3 Rp = mat3(1.0);
            T = vec3(0.0);
            if (aPart > 7.5) {
              vec3 hinge = vec3(0.0, 0.300, 0.181);
              Rp = rx(bell * 0.6);
              T = hinge - Rp * hinge;
            }
            if (tilt != 0.0 && ((aPart > 0.5 && aPart < 1.5) || (aPart > 5.5 && aPart < 6.5) || aPart > 7.5)) {
              vec3 poll = vec3(0.0, 0.315, 0.150);
              mat3 Rt = rx(tilt * smoothstep(0.13, 0.15, position.z));
              Rp = Rt * Rp;
              T = Rt * T + poll - Rt * poll;
            }
            mat3 Rn = rx(a);
            Rp = Rn * Rp;
            T = Rn * T + aPivot - Rn * aPivot;
            if (aPart > 7.5 && roar < 0.5) Rp = mat3(0.0);
            // antlers are worn by stags only (iAnim.z), a dappled coat by fawns only (iAnim.w)
            if (aPart > 5.5 && aPart < 6.5 && iAnim.z < 0.5) Rp = mat3(0.0);
            if (aPart > 6.5 && aPart < 7.5 && iAnim.w < 0.5) Rp = mat3(0.0);
            R = Rp;
            T.y += bob + bell * 0.004;
            // the pair heave to and fro together, and both rock back before each crash
            T.z += push * 0.022 - draw * 0.03 + jolt * 0.008;
          }`)
        .replace('#include <beginnormal_vertex>', `
          mat3 poseR; vec3 poseT;
          deerPose(poseR, poseT);
          vec3 objectNormal = poseR * vec3(normal);
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif`)
        .replace('#include <begin_vertex>', `vec3 transformed = poseR * vec3(position) + poseT;`);
    };
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = true;
    return m;
  }

  private buildingMaterial(kind: string, height: number) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.customProgramCacheKey = () => `bld-${kind}`;
    mat.onBeforeCompile = (sh) => {
      addCommon(sh, { uHeight: { value: height + 0.01 }, uDoorGlow: { value: kind.startsWith('hut') ? 1 : 0 } });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float iProgress;
          varying float vLocalY;
          varying float vProg;
          varying float vUpN;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vLocalY = position.y;
          vProg = iProgress;
          vUpN = normal.y;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vLocalY;
          varying float vProg;
          varying float vUpN;`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (vLocalY > vProg * uHeight + 0.002) discard;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec3 col = diffuseColor.rgb;
            col = mix(col, vec3(0.93, 0.95, 0.98), smoothstep(0.3, 0.8, vUpN) * uSnow * 0.8);
            diffuseColor.rgb = col;
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            // hut doorways glow with firelight after dark
            float dark = step(dot(diffuseColor.rgb, vec3(1.0)), 0.06) * step(0.99, vProg);
            totalEmissiveRadiance += dark * uDoorGlow * uNight * vec3(1.0, 0.55, 0.2) * 0.9;
          }`);
    };
    return mat;
  }

  /** The shadow pass for a building, cut off at the same height as the building is drawn. */
  private buildingDepthMaterial(kind: string, height: number) {
    const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    mat.customProgramCacheKey = () => `bld-depth-${kind}`;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uHeight = { value: height + 0.01 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float iProgress;
          varying float vLocalY;
          varying float vProg;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vLocalY = position.y;
          vProg = iProgress;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uHeight;
          varying float vLocalY;
          varying float vProg;`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          if (vLocalY > vProg * uHeight + 0.002) discard;`);
    };
    return mat;
  }

  private flameMaterial() {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: U.uTime },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying float vY;
        void main() {
          vec3 p = position;
          float h = max(p.y - 0.03, 0.0);
          p.x += sin(uTime * 9.0 + p.y * 30.0) * 0.02 * h * 4.0;
          p.z += cos(uTime * 7.0 + p.y * 25.0) * 0.02 * h * 4.0;
          p.y *= 0.85 + 0.2 * sin(uTime * 11.0) * sin(uTime * 5.3);
          vY = position.y;
          gl_Position = projectionMatrix * viewMatrix * (instanceMatrix * vec4(p, 1.0));
        }`,
      fragmentShader: /* glsl */ `
        varying float vY;
        void main() {
          float t = clamp((vY - 0.02) / 0.26, 0.0, 1.0);
          vec3 c = mix(vec3(1.0, 0.85, 0.35), vec3(0.95, 0.25, 0.04), t);
          gl_FragColor = vec4(c * 1.4, 0.9 - t * 0.6);
          #include <colorspace_fragment>
        }`,
    });
  }

  // ---------------------------------------------------------------- frames
  setBuildings(b: NonNullable<Frame['buildings']>) {
    // a building the band has only planned shows nothing until someone carries something to it or starts work:
    // no frame, no pile of poles (so the first band's lean-to isn't standing on the shore before they land)
    this.buildings = b.filter((q) => q.begun);
  }

  /** New positions from the simulation. */
  /** @param tps simulation ticks per real second right now */
  /** how many of each one-off move have been shown (for tests) */
  gestureCount: Record<string, number> = {};
  private startGesture(s: Shown, g: Gesture, now: number) {
    this.gestureCount[g] = (this.gestureCount[g] ?? 0) + 1;
    s.splashed = false;
    s.gesture = g;
    s.gestAt = now;
    s.gestCarry = 0;
  }
  /** Hold someone part-way through a one-off move (for previews): [move, 0..1]. */
  debugHold = new Map<number, [Gesture, number]>();
  /** Force a one-off move on someone (for tests and previews). */
  debugGesture(id: number, g: Gesture) {
    const s = this.people.get(id);
    if (s) this.startGesture(s, g, performance.now());
  }

  /** the simulation's current speed (ticks a second): small effects only when it's slow enough to see */
  private tpsNow = 2.5;
  private bits: Bit[] = [];
  private bitMesh: THREE.InstancedMesh;
  private rings: { x: number; y: number; z: number; at: number; size: number }[] = [];
  /** Where an axe blow lands: the tree shudders and chips fly toward the cutter. */
  private axeBlow(tx: number, tz: number, fromX: number, fromZ: number, y: number) {
    const dir = Math.atan2(tz - fromZ, tx - fromX);
    const sl = SHAKE.value;
    let slot = sl.findIndex((v) => Math.abs(v.x - tx) < 0.01 && Math.abs(v.y - tz) < 0.01);
    if (slot < 0) slot = sl.reduce((m, v, i) => (v.z < sl[m].z ? i : m), 0);
    sl[slot].set(tx, tz, 1, dir);
    const back = dir + Math.PI;
    for (let k = 0; k < 4; k++) {
      const a = back + (Math.random() - 0.5) * 1.6, sp = 0.35 + Math.random() * 0.4, light = Math.random() < 0.6;
      this.bits.push({ x: tx + Math.cos(back) * 0.04, y: y + 0.09, z: tz + Math.sin(back) * 0.04, vx: Math.cos(a) * sp, vy: 0.55 + Math.random() * 0.5, vz: Math.sin(a) * sp,
        age: 0, life: 0.7, size: 0.011 + Math.random() * 0.008, r: light ? 0.86 : 0.42, g: light ? 0.72 : 0.3, b: light ? 0.5 : 0.2, floor: y });
    }
  }
  /** A spear goes into the water: a splash and a ring. */
  private splash(x: number, z: number, y: number, now: number) {
    for (let k = 0; k < 9; k++) {
      const a = Math.random() * Math.PI * 2, sp = 0.08 + Math.random() * 0.22;
      this.bits.push({ x, y: y + 0.01, z, vx: Math.cos(a) * sp, vy: 0.6 + Math.random() * 0.55, vz: Math.sin(a) * sp,
        age: 0, life: 0.55, size: 0.009 + Math.random() * 0.007, r: 0.82, g: 0.9, b: 0.98, floor: y });
    }
    this.rings.push({ x, y, z, at: now, size: 0.5 });
  }
  /** A mark on the water: a ring spreading from a point, and a splash of `drops` drops. */
  private waterMark(x: number, z: number, y: number, size: number, drops: number) {
    for (let k = 0; k < drops; k++) {
      const a = Math.random() * Math.PI * 2, sp = 0.05 + Math.random() * 0.16;
      this.bits.push({ x, y: y + 0.01, z, vx: Math.cos(a) * sp, vy: 0.45 + Math.random() * 0.45, vz: Math.sin(a) * sp,
        age: 0, life: 0.5, size: 0.007 + Math.random() * 0.006, r: 0.82, g: 0.9, b: 0.98, floor: y });
    }
    this.rings.push({ x, y, z, at: performance.now(), size });
  }
  /** Whoever is nearest a point (a tree just felled), if anyone is close. */
  nearestTo(x: number, z: number, within = 1.2) {
    let best: { x: number; z: number } | null = null, bd = within;
    for (const [, s] of this.people) {
      const d = Math.hypot(s.dx - x, s.dz - z);
      if (d < bd && !s.indoors) { bd = d; best = { x: s.dx, z: s.dz }; }
    }
    return best;
  }

  onFrame(f: Frame, tps: number, now: number) {
    this.tpsNow = tps;
    if (f.game) this.hares.setGame(f.game);
    if (f.fish) this.fish.setFish(f.fish);
    this.fish.setTick(f.tick);
    this.birds.setTick(f.tick);
    // where everyone is drawn right now becomes the start of the next glide
    // (this must be measured before the frame clock is reset)
    const a = this.alpha(now);
    // glide over the real gap between frames (steady at 1x, ~30 ms at high speed)
    const gap = this.frameAt ? now - this.frameAt : 1000 / Math.max(1, tps);
    this.tickMs = Math.min(450, Math.max(16, this.tickMs * 0.7 + gap * 0.3));
    this.frameAt = now;
    const seen = f.tick;
    const P = f.people;
    for (let o = 0; o < P.length; o += P_STRIDE) {
      const id = P[o];
      let s = this.people.get(id);
      if (!s) {
        s = { x: P[o + 1], z: P[o + 2], px: P[o + 1], pz: P[o + 2], y: this.groundAt(P[o + 1], P[o + 2]), angle: 0, act: 0, indoors: false, age: 0, sex: 0, look: 0, seen, task: 0,
          dx: P[o + 1], dz: P[o + 2], want: 0, phase: (id * 0.37) % 1, run: 0, shownAct: P[o + 5], prevAct: P[o + 5], actAt: -1e9, still: 0,
          flash: P[o + 13], gesture: null, gestAt: 0, gestCarry: 0, carry: P[o + 6], fx: P[o + 3], fz: P[o + 4], swing: 0, splashed: false, band: P[o + 14], tool: P[o + 15], dress: P[o + 16], remains: P[o + 17] };
        s.angle = s.want = Math.atan2(P[o + 3] - P[o + 1], P[o + 4] - P[o + 2]) || 0;
        this.people.set(id, s);
      } else {
        // start interpolating from where they are drawn now
        s.px = s.px + (s.x - s.px) * a;
        s.pz = s.pz + (s.z - s.pz) * a;
        s.x = P[o + 1];
        s.z = P[o + 2];
        // teleports (e.g. infants handed over) don't slide across the map
        if (Math.abs(s.x - s.px) + Math.abs(s.z - s.pz) > 3) { s.px = s.x; s.pz = s.z; s.dx = s.x; s.dz = s.z; }
      }
      // where the simulation has them facing (the drawn heading turns toward it smoothly)
      s.fx = P[o + 3];
      s.fz = P[o + 4];
      s.band = P[o + 14];
      s.tool = P[o + 15];
      s.dress = P[o + 16];
      s.remains = P[o + 17];
      const fx = P[o + 3] - P[o + 1], fz = P[o + 4] - P[o + 2];
      if (fx * fx + fz * fz > 1e-4) s.want = Math.atan2(fx, fz);
      s.act = P[o + 5];
      // one-off moves, shown only at speeds where a person can be watched doing them
      const slow = tps <= 32 && !s.indoors;
      const flash = P[o + 13];
      const busy = s.gesture !== null && now - s.gestAt < GESTURES[s.gesture];
      if (flash !== s.flash) {
        s.flash = flash;
        if (slow && s.act !== ACT.Dead) this.startGesture(s, (flash & 3) === FLASH.Thrust ? 'thrust' : 'stab', now);
      } else if (slow && !busy && s.act !== ACT.Dead && P[o + 6] !== s.carry) {
        if (s.carry === CARRY.None && P[o + 6] !== CARRY.Baby) this.startGesture(s, 'lift', now);
        else if (P[o + 6] === CARRY.None && s.carry !== CARRY.Baby) { this.startGesture(s, 'putdown', now); s.gestCarry = s.carry; }
      }
      s.carry = P[o + 6];
      s.indoors = P[o + 7] > 0.5;
      s.age = P[o + 8];
      s.sex = P[o + 9];
      s.look = P[o + 10] + P[o + 11] * 65536;
      s.task = P[o + 12];
      s.seen = seen;
    }
    for (const [id, s] of this.people) if (s.seen !== seen) this.people.delete(id);

    const D = f.deer;
    for (let o = 0; o < D.length; o += D_STRIDE) {
      const id = D[o];
      const nx = D[o + 1], nz = D[o + 2];
      let d = this.deer.get(id);
      if (!d) {
        const gy = this.groundAt(nx, nz);
        d = { x: nx, z: nz, sx: nx, sz: nz, t0: now, dur: this.tickMs * 2, movedAt: 0, dx: nx, dz: nz, yf: gy, yb: gy, y: gy, pitch: 0,
          angle: 0, want: 0, phase: (id % 17) / 17, gait: 0, moving: 0, seen, state: 0, fawn: false, trail: 0, foot: 0, puffed: -1, clashed: -1 };
        this.deer.set(id, d);
      } else if (Math.abs(nx - d.x) + Math.abs(nz - d.z) > 1e-5) {
        // the herd only moves every other tick: glide from wherever it is drawn to the new spot
        // over the time the last step took, so it keeps a steady pace instead of lurching
        const t = Math.min(1, (now - d.t0) / d.dur);
        d.sx += (d.x - d.sx) * t;
        d.sz += (d.z - d.sz) * t;
        const gap = now - d.movedAt;
        d.dur = gap < 1200 ? Math.min(900, Math.max(16, d.dur * 0.5 + gap * 0.5)) : this.tickMs * 2;
        d.t0 = now;
        d.movedAt = now;
        d.x = nx;
        d.z = nz;
      }
      const fx = D[o + 3] - nx, fz = D[o + 4] - nz;
      if (fx * fx + fz * fz > 1e-4) d.want = Math.atan2(fx, fz);
      d.state = D[o + 5] % 10;
      d.fawn = D[o + 5] >= 10;
      d.seen = seen;
    }
    for (const [id, d] of this.deer) if (d.seen !== seen) this.deer.delete(id);
    if (f.wolves) this.wolves.setWolves(f.wolves, now, this.tickMs, seen);
    if (f.beasts) this.beasts.setBeasts(f.beasts, f.dens, now, this.tickMs, seen);
  }

  private alpha(now: number) {
    return Math.min(1, Math.max(0, (now - this.frameAt) / this.tickMs));
  }

  /** The water at a point: its surface and how deep it is (null on land). */
  waterAt(x: number, z: number) {
    const w = this.world, N = w.size;
    const tx = Math.min(N - 1, Math.max(0, Math.floor(x))), tz = Math.min(N - 1, Math.max(0, Math.floor(z)));
    const i = tz * N + tx;
    if (w.water[i] === WATER.None) return null;
    return { surface: w.waterY[i], depth: w.waterY[i] - w.groundY[i] };
  }
  private ripples: THREE.InstancedMesh;
  private auras: THREE.InstancedMesh;
  /** show each band's colour on its people and buildings */
  colorMode = false;
  private bandColors = new Map<number, { color: THREE.Color; light: THREE.Color; gone: boolean }>();
  private bandPop = new Map<number, number>();
  /** Band colours as HSL (degrees, 0..1, 0..1), and which bands are gone. */
  setBandColors(list: { id: number; color: { h: number; s: number; l: number }; gone: number; pop: number }[]) {
    for (const b of list) {
      this.bandPop.set(b.id, b.pop);
      const c = new THREE.Color().setHSL(b.color.h / 360, b.color.s, b.color.l, THREE.SRGBColorSpace);
      const light = new THREE.Color().setHSL(b.color.h / 360, Math.min(1, b.color.s + 0.1), Math.min(0.85, b.color.l + 0.18), THREE.SRGBColorSpace);
      this.bandColors.set(b.id, { color: c, light, gone: !!b.gone });
    }
  }
  private auraList: { x: number; y: number; z: number; r: number; c: THREE.Color; k: number; terr?: boolean }[] = [];
  /** how much of the world the camera shows (for sizing the colour glows) */
  viewZoom = 20;
  /** Everyone in the water this frame (for the ripples). */
  swimmers: { x: number; z: number; y: number; r: number; moving: boolean; seed: number }[] = [];

  groundAt(x: number, z: number) {
    const w = this.world, N = w.size;
    const tx = Math.min(N - 1, Math.max(0, Math.floor(x))), tz = Math.min(N - 1, Math.max(0, Math.floor(z)));
    const i = tz * N + tx;
    if (w.water[i] !== WATER.None) return Math.max(w.groundY[i], w.waterY[i] - 0.17);
    return w.groundY[i];
  }

  /** Per render frame: interpolate, pose and draw. */
  update(dt: number, now: number, night: number, camTarget: THREE.Vector3) {
    const a = this.alpha(now);
    // room for everyone, however large the band grows
    this.villagers = this.grow(this.villagers, this.people.size);
    this.deerMesh = this.grow(this.deerMesh, this.deer.size);
    for (const [kind, cm] of this.carryMeshes) this.carryMeshes.set(kind, this.grow(cm, this.people.size));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const anim = this.villagers.geometry.attributes.iAnim as THREE.InstancedBufferAttribute;
    const cloth = this.villagers.geometry.attributes.iCloth as THREE.InstancedBufferAttribute;
    const skin = this.villagers.geometry.attributes.iSkin as THREE.InstancedBufferAttribute;
    const hair = this.villagers.geometry.attributes.iHair as THREE.InstancedBufferAttribute;
    const carryCount = new Map<number, number>();
    this.lampsLit.length = 0;
    const col = new THREE.Color();
    let n = 0;
    this.remains.begin();
    this.visible.length = 0;
    this.gleaners.length = 0;
    this.swimmers.length = 0;
    this.auraList.length = 0;
    // infants riding with a carer: the carer shows a bundle instead
    const babyCarriers = new Set<number>();
    for (const [, s] of this.people) {
      if (s.age < 2 && (s.act === ACT.Walk || s.act === ACT.Run)) {
        let best = -1, bd = 0.35;
        for (const [oid, o] of this.people) {
          if (o.age < 12) continue;
          const d = Math.hypot(o.x - s.x, o.z - s.z);
          if (d < bd) { bd = d; best = oid; }
        }
        if (best >= 0) babyCarriers.add(best);
      }
    }
    const sel = { x: 0, y: -99, z: 0 }, hov = { x: 0, y: -99, z: 0 };
    const anim2 = this.villagers.geometry.attributes.iAnim2 as THREE.InstancedBufferAttribute;
    const anim3 = this.villagers.geometry.attributes.iAnim3 as THREE.InstancedBufferAttribute;
    // how quickly the drawn path catches up with the simulation's: enough to round off the
    // corners of a grid path, never so much that people visibly lag (shorter at high speed)
    const lag = Math.min(0.11, Math.max(0.025, this.tickMs * 0.00028));
    const follow = 1 - Math.exp(-dt / lag);
    for (const [id, s] of this.people) {
      // move the drawn position along (even indoors, so they step out where they went in)
      const tx = s.px + (s.x - s.px) * a, tz = s.pz + (s.z - s.pz) * a;
      const ox = s.dx, oz = s.dz;
      if (Math.abs(tx - s.dx) + Math.abs(tz - s.dz) > 1.5) { s.dx = tx; s.dz = tz; }
      else { s.dx += (tx - s.dx) * follow; s.dz += (tz - s.dz) * follow; }
      const ov = this.introPose?.(id, now) ?? null;
      if (ov) { s.dx = ov.x; s.dz = ov.z; s.act = ov.act; if (ov.angle !== undefined) s.want = ov.angle; }
      if (s.indoors) continue;
      if (s.age < 2 && (s.act === ACT.Walk || s.act === ACT.Run)) continue;
      if (n >= anim.count) break;
      let x = s.dx, z = s.dz;
      // children at play chase each other round in a ring about where the game is
      const playing = s.shownAct === ACT.Play;
      let ringAngle = 0;
      if (playing) {
        const r = 0.34 * smooth(0, 700, now - s.actAt);
        const th = now * 0.0016 + (id % 7) * 0.9;
        x += Math.cos(th) * r;
        z += Math.sin(th) * r;
        ringAngle = Math.atan2(-Math.sin(th), Math.cos(th)); // the direction of travel round the ring
      }
      const scale = s.age < 2 ? 0.42 : s.age < 14 ? 0.55 + (s.age - 2) * 0.035 : s.sex === 1 ? 1.03 : 0.96;
      // ground speed, in body heights a second
      const moved = Math.hypot(x - ox, z - oz);
      const speed = dt > 0 ? moved / dt / (0.4 * scale) : 0;
      const walking = s.act === ACT.Walk || s.act === ACT.Run || s.act === ACT.Hunt;
      s.still = walking && speed < 0.15 ? s.still + dt : 0;
      // in water too deep to stand in (for their height): swim if going somewhere, else tread water
      const wt = this.waterAt(x, z);
      // out on the water in the band's canoe: sat in it, riding on the water
      const canoeing = wt !== null && s.task === CANOE_TASK && s.act === ACT.Sit && !s.indoors;
      const swimming = wt !== null && wt.depth > SWIM_DEPTH * 0.4 * scale && s.act !== ACT.Dead && !ov?.afloat && !canoeing;
      const stroke = swimming && walking && s.still < 0.25 && s.carry === CARRY.None;
      const gy = canoeing ? wt!.surface + CANOE_RIDE : swimming ? wt!.surface - (stroke ? 0.168 : 0.3) * scale : this.groundAt(x, z);
      s.y += (gy - s.y) * Math.min(1, dt * (swimming ? 6 : 14));
      if (ov?.y !== undefined) s.y = ov.y;
      // the pose to show: someone 'walking' who has stopped (between path steps) stands instead
      const act = this.debugAct.get(id) ?? (swimming ? (stroke ? SWIM : TREAD) : walking && s.still > 0.25 ? ACT.Idle : s.act);
      if (swimming) this.swimmers.push({ x, z, y: wt!.surface, r: scale, moving: stroke, seed: id });
      // (a canoe under way spreads a wake of rings behind it)
      if (canoeing && speed > 0.2) this.swimmers.push({ x, z, y: wt!.surface, r: 1.6, moving: true, seed: id });
      if (act !== s.shownAct) {
        // start a blend from wherever the last one had got to
        // (if a blend is still under way, carry on from whichever pose dominates it)
        s.prevAct = (now - s.actAt) / 220 < 0.5 ? s.prevAct : s.shownAct;
        s.shownAct = act;
        s.actAt = now;
      }
      // walk turns to run with speed; the stride cycle advances with distance covered, so feet
      // don't slide (above the fastest cadence a person can show, they simply lope)
      const runGoal = s.act === ACT.Run ? 1 : Math.min(1, Math.max(0, (speed - RUN_FROM) / (RUN_FULL - RUN_FROM)));
      s.run += (runGoal - s.run) * (1 - Math.exp(-dt * 5));
      if (stroke && moved > 0) s.phase += Math.min(moved / (0.2 * scale), 1.6 * dt); // a stroke cycle per body length or so
      else if (walking && moved > 0) {
        const stride = (gait.strideWalk + (gait.strideRun - gait.strideWalk) * s.run) * scale;
        s.phase += Math.min(moved / stride, MAX_CADENCE * dt);
      }
      // face where they're going while moving, otherwise what the simulation says; turn smoothly
      const want = playing ? ringAngle : walking && moved > 0.002 * dt * 60 && ov?.angle === undefined ? Math.atan2(x - ox, z - oz) : s.want;
      s.angle += shortest(s.angle, want) * (1 - Math.exp(-dt * (walking || playing ? 12 : 8)));
      // past the first days, someone left unburied is drawn as what is left of them
      if (s.act === ACT.Dead && s.remains >= 1) {
        col.set(CLOTH[(s.look >>> 8) % CLOTH.length]).convertSRGBToLinear();
        this.remains.add(s.remains, x, s.y, z, s.angle, scale, col);
        this.visible.push({ id, x, y: s.y + 0.42 * scale, z, child: s.age < 14 });
        if (id === this.selected) Object.assign(sel, { x, y: s.y, z });
        if (id === this.hovered) Object.assign(hov, { x, y: s.y, z });
        continue;
      }
      pos.set(x, s.y, z);
      q.setFromAxisAngle(up, s.angle);
      scl.setScalar(scale);
      m4.compose(pos, q, scl);
      this.villagers.setMatrixAt(n, m4);
      const look = s.look;
      const elder = s.age >= 58 ? 1 : 0;
      // hair: 0 short, 1 long, 2 braids, 3 a bun; most women wear it long, plaited or tied up,
      // most men short; about half the grown men have a beard
      const cut = (look >>> 4) % 10;
      const hairStyle = s.sex === 0 ? (cut < 4 ? 1 : cut < 6 ? 2 : cut < 8 ? 3 : 0) : (cut < 1 ? 1 : 0);
      const beard = s.sex === 1 && s.age >= 18 && (look >>> 24) % 10 < 5 ? 1 : 0;
      const dead = s.act === ACT.Dead ? 1 : 0;
      const blend = Math.min(1, Math.max(0, (now - s.actAt) / 220));
      anim.setXYZW(n, s.shownAct, s.prevAct, blend, hairStyle + elder * 4 + dead * 8 + beard * 16 + dressStyle(s.dress));
      // a one-off move under way
      let gpr = -1;
      const held = this.debugHold.get(id);
      if (held) { s.gesture = held[0]; s.gestAt = now - held[1] * GESTURES[held[0]]; }
      if (s.gesture) {
        gpr = (now - s.gestAt) / GESTURES[s.gesture];
        if (gpr >= 1 || s.act === ACT.Dead) { s.gesture = null; s.gestCarry = 0; gpr = -1; }
      }
      const gw = gpr >= 0 ? gestureWeight(gpr) : 0;
      const watchable = this.tpsNow <= 32;
      // each axe blow lands when the swing reaches the bottom (see the chopping pose in POSE_GLSL)
      if (s.shownAct === ACT.Chop && watchable && now - s.actAt > 220) {
        const sw = ((U.uTime.value + (look % 997) * 0.37) * 5.5) % (Math.PI * 2);
        if (s.swing < Math.PI / 2 && sw >= Math.PI / 2 && sw - s.swing < 1.5) this.axeBlow(s.fx, s.fz, x, z, s.y);
        s.swing = sw;
      }
      // a fishing stab goes into the water part-way through
      if (s.gesture === 'stab' && !s.splashed && gpr >= 0.4 && watchable) {
        s.splashed = true;
        // where the spear meets the water: the first water along the way to what they're watching
        const ddx = s.fx - x, ddz = s.fz - z, dl = Math.hypot(ddx, ddz);
        for (let d = 0.15; d <= Math.min(1.6, dl + 0.2); d += 0.05) {
          const px = x + (ddx / (dl || 1)) * d, pz = z + (ddz / (dl || 1)) * d;
          const wt2 = this.waterAt(px, pz);
          if (wt2) { this.splash(px, pz, wt2.surface, now); break; }
        }
      }
      anim3.setXYZW(n, gpr >= 0 ? CLIP[s.gesture!] + 1 : 0, Math.max(0, gpr), 0, 0);
      // hands hold what they carry; while putting something down they still hold it until it's set down
      let carry = s.carry !== CARRY.None ? s.carry : s.gestCarry && gpr < 0.55 ? s.gestCarry : babyCarriers.has(id) ? CARRY.Baby : CARRY.None;
      if (s.gesture === 'lift' && gpr < 0.42) carry = CARRY.None; // not picked up yet
      // a picker sets their basket down at their feet while both hands are in the bush
      const basketDown = s.tool === 6 && s.shownAct === ACT.Gather && s.act !== ACT.Dead ? (carry === CARRY.Berries ? BASKET_FULL : BASKET) : 0;
      if (basketDown) carry = CARRY.None;
      // a carcass being butchered lies on the ground in front of them, not in their hands
      const carcassDown = (carry === CARRY.Carcass || carry === CARRY.BoarCarcass) && s.act !== ACT.Dead ? carry : 0;
      if (carcassDown) carry = CARRY.None;
      // logs on a sledge are dragged along behind on its rope, not carried; an empty one is dragged out to them
      const dragged = s.tool === SLEDGE_TOOL && (s.act === ACT.Walk || s.act === ACT.Run || s.act === ACT.Idle) && !s.gesture && (carry === CARRY.Log || carry === CARRY.None) ? (carry === CARRY.Log ? SLEDGE_FULL : SLEDGE) : 0;
      if (dragged) carry = CARRY.None;
      // a fisher's catch comes home on the spear it was caught with
      // (not one caught on a line or in a net: that is carried home in the hand)
      const onSpear = carry === CARRY.Fish && s.task === FISH_TASK && s.tool !== LINE_TOOL && s.tool !== NET_TOOL;
      if (onSpear) carry = CARRY.Spear;
      // with free hands on the move, a digging stick is held low like a spear and a trap swings like a basket
      const loose = carry === CARRY.None && !s.gesture && (s.act === ACT.Walk || s.act === ACT.Run || s.act === ACT.Idle);
      const toolCarry = loose ? (s.tool === 3 ? STICK : s.tool === 4 ? SNARE : s.tool === 5 ? FISHTRAP : s.tool === 6 ? BASKET : s.tool === LINE_TOOL ? LINE : s.tool === NET_TOOL ? NET : 0) : 0;
      // berries picked into a basket come home in it, and the catch from the snares as the hares themselves
      const snared = carry === CARRY.Meat && s.task === TRAP_TASK;
      // (a harpoon is held as the spear is, and drawn in its place)
      const shown = carry === CARRY.Berries && s.tool === 6 ? BASKET_FULL : snared ? HARE : carry === CARRY.Spear && s.tool === HARPOON_TOOL ? HARPOON : carry;
      const speared = shown === CARRY.Spear || shown === HARPOON;
      const spearAt = () => {
        const t = U.uTime.value + (look % 997) * 0.37, ph = s.phase % 1;
        return spearInHand(spearHold(s.prevAct, t, ph, s.run), spearHold(s.shownAct, t, ph, s.run), smooth(0, 1, blend), elder * 0.18, s.gesture, gpr, gw);
      };
      anim2.setXYZW(n, s.phase % 1, s.run, (look % 997) * 0.37, toolCarry === STICK ? CARRY.Spear : toolCarry === NET ? CARRY.Grain : toolCarry || snared || dragged ? CARRY.Berries : carry);
      col.set((s.dress & 512 ? TUNIC : CLOTH)[(look >>> 8) % (s.dress & 512 ? TUNIC.length : CLOTH.length)]).convertSRGBToLinear();
      const bc = this.colorMode ? this.bandColors.get(s.band) : undefined;
      if (bc) col.lerp(bc.color, 0.7);
      cloth.setXYZ(n, col.r, col.g, col.b);
      col.set(SKIN[(look >>> 12) % 3 + ((look >>> 20) % 2) * 2]).convertSRGBToLinear();
      skin.setXYZ(n, col.r, col.g, col.b);
      col.set(HAIR[(look >>> 16) % HAIR.length]).convertSRGBToLinear();
      if (s.age > 50) col.lerp(GREY.clone().convertSRGBToLinear(), Math.min(1, (s.age - 50) / 18));
      hair.setXYZ(n, col.r, col.g, col.b);
      n++;
      // carried item
      if (carry !== CARRY.None && s.act !== ACT.Dead) {
        const cm = this.carryMeshes.get(shown);
        if (cm) {
          const k = carryCount.get(shown) ?? 0;
          if (k < cm.instanceMatrix.count) {
            // a spear is held in the hand, wherever the arm is in the pose and any move playing over it
            const off = speared ? spearAt() : carryOffset(shown);
            // during a one-off move the item goes where the hand goes
            if (gw > 0 && s.gesture && !speared) {
              const [bs, be, bl] = baseArm(carry);
              const g = s.gesture;
              const from = handAt(bs, be, bl, 0);
              const to = handAt(onceAt(g, 'shoulderR', gpr), onceAt(g, 'elbowR', gpr), onceAt(g, 'lean', gpr), onceAt(g, 'lower', gpr));
              const shift = to.sub(from).multiplyScalar(gw);
              off.elements[12] += shift.x;
              off.elements[13] += shift.y;
              off.elements[14] += shift.z;
            }
            const held = m4.clone().multiply(off);
            cm.setMatrixAt(k, held);
            carryCount.set(shown, k + 1);
            if (onSpear) {
              const fm = this.carryMeshes.get(CARRY.Fish);
              const fk = carryCount.get(CARRY.Fish) ?? 0;
              if (fm && fk < fm.instanceMatrix.count) {
                // skewered just below the point, across the shaft
                fm.setMatrixAt(fk, held.clone().multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(0, 0.175, 0)));
                carryCount.set(CARRY.Fish, fk + 1);
              }
            }
          }
        }
      }
      if (basketDown) {
        const bm = this.carryMeshes.get(basketDown);
        const bk = carryCount.get(basketDown) ?? 0;
        if (bm && bk < bm.instanceMatrix.count) {
          bm.setMatrixAt(bk, m4.clone().multiply(new THREE.Matrix4().setPosition(0.1, 0.092, 0.03)));
          carryCount.set(basketDown, bk + 1);
        }
      }
      if (carcassDown) {
        const cm = this.carryMeshes.get(carcassDown);
        const ck = carryCount.get(carcassDown) ?? 0;
        if (cm && ck < cm.instanceMatrix.count) {
          // (modelled in the butcher's own frame on the ground in front of them, set a little further out to leave
          // room for their knees; never scaled with a child)
          const un = 1 / Math.max(0.5, scale);
          cm.setMatrixAt(ck, m4.clone().multiply(new THREE.Matrix4().makeScale(un, un, un).setPosition(0, 0, 0.04 * un)));
          carryCount.set(carcassDown, ck + 1);
        }
      }
      // a hook and line held out over the water by someone sat at it; a net out in the water in front of its keeper,
      // its float line on the surface (the others hauling it stand at its ends)
      const fishing = (s.task === FISH_TASK || s.task === CANOE_TASK) && s.act !== ACT.Dead && carry === CARRY.None;
      const gearOut = fishing && s.tool === LINE_TOOL && s.shownAct === ACT.Sit ? LINE_CAST : fishing && s.tool === NET_TOOL && s.shownAct === ACT.Fish ? NET_OUT : 0;
      if (gearOut) {
        const gm = this.carryMeshes.get(gearOut);
        const gk = carryCount.get(gearOut) ?? 0;
        if (gm && gk < gm.instanceMatrix.count) {
          const at = m4.clone();
          if (gearOut === NET_OUT) {
            const out = new THREE.Vector3(0, 0, 0.55).applyMatrix4(m4);
            const wt = this.waterAt(out.x, out.z);
            if (wt) at.elements[13] = wt.surface + 0.004;
          }
          gm.setMatrixAt(gk, at);
          carryCount.set(gearOut, gk + 1);
        }
      }
      if (canoeing) {
        const cm = this.carryMeshes.get(CANOE);
        const ck = carryCount.get(CANOE) ?? 0;
        if (cm && ck < cm.instanceMatrix.count) {
          // (modelled round the paddler sat in it, its floor at their seat; never scaled with them)
          const un = 1 / Math.max(0.5, scale);
          cm.setMatrixAt(ck, m4.clone().multiply(new THREE.Matrix4().makeScale(un, un, un)));
          carryCount.set(CANOE, ck + 1);
        }
      }
      if (dragged) {
        const dm = this.carryMeshes.get(dragged);
        const dk = carryCount.get(dragged) ?? 0;
        if (dm && dk < dm.instanceMatrix.count) {
          // (modelled with its rope rising to the right hand; never scaled with a child)
          const un = 1 / Math.max(0.5, scale);
          dm.setMatrixAt(dk, m4.clone().multiply(new THREE.Matrix4().makeScale(un, un, un)));
          carryCount.set(dragged, dk + 1);
        }
      }
      if (toolCarry && s.act !== ACT.Dead) {
        const tm = this.carryMeshes.get(toolCarry);
        const tk = carryCount.get(toolCarry) ?? 0;
        if (tm && tk < tm.instanceMatrix.count) {
          // a digging stick sits in the hand as a spear held low does (point up: it is modelled point down)
          const off = toolCarry === STICK ? spearAt().multiply(new THREE.Matrix4().makeRotationX(Math.PI)) : carryOffset(toolCarry);
          tm.setMatrixAt(tk, m4.clone().multiply(off));
          carryCount.set(toolCarry, tk + 1);
        }
      }
      // a digging stick in both hands, stabbed down as the arms drop (as the digging pose in POSE_GLSL)
      if (s.shownAct === ACT.Dig && s.tool === 3 && s.act !== ACT.Dead) {
        const dm = this.carryMeshes.get(STICK);
        const dk = carryCount.get(STICK) ?? 0;
        if (dm && dk < dm.instanceMatrix.count) {
          const c = Math.abs(Math.sin((U.uTime.value + (look % 997) * 0.37) * 5));
          const hand = handAt(-1.75 + 0.95 * c, -0.45, 0.5 + (elder ? 0.18 : 0), 0);
          // held at a slant, point down and forward: it reaches the ground as the hands come down
          dm.setMatrixAt(dk, m4.clone().multiply(new THREE.Matrix4().makeRotationX(-0.48).setPosition(0.05, hand.y, hand.z)));
          carryCount.set(STICK, dk + 1);
        }
      }
      // a woodcutter's axe, in both hands, following the swing (as POSE_GLSL bends the arms)
      if (s.shownAct === ACT.Chop && s.act !== ACT.Dead) {
        const held = s.tool === 1 ? CHOPPER : AXE;
        const am = this.carryMeshes.get(held);
        const ak = carryCount.get(held) ?? 0;
        if (am && ak < am.instanceMatrix.count) {
          const c = Math.max(0, Math.sin((U.uTime.value + (look % 997) * 0.37) * 5.5));
          const sh = -2.75 + 1.85 * c, el = -0.35 + 0.25 * c, lean = 0.1 + 0.22 * c + (elder ? 0.18 : 0);
          const hand = handAt(sh, el, lean, 0);
          const am4 = new THREE.Matrix4().makeRotationX(sh + el + lean + Math.PI - 0.5).setPosition(0.035, hand.y, hand.z);
          am.setMatrixAt(ak, m4.clone().multiply(am4));
          carryCount.set(held, ak + 1);
        }
      }
      // a lamp lit beside someone sitting at their work after dark
      if (s.tool === LAMP_TOOL && s.shownAct === ACT.Sit && s.act !== ACT.Dead) {
        const lm = this.carryMeshes.get(LAMP);
        const lk = carryCount.get(LAMP) ?? 0;
        if (lm && lk < lm.instanceMatrix.count) {
          const at = m4.clone().multiply(LAMP_AT);
          lm.setMatrixAt(lk, at);
          carryCount.set(LAMP, lk + 1);
          this.lampsLit.push(LAMP_WICK.clone().applyMatrix4(at));
        }
      }
      if (bc && s.act !== ACT.Dead) this.auraList.push({ x, y: s.y, z, r: 1.0 * Math.max(0.7, scale), c: bc.color, k: 0.6 });
      this.visible.push({ id, x, y: s.y + 0.42 * scale, z, child: s.age < 14 });
      if ((s.task === EGGS_TASK && s.shownAct === ACT.Gather) || (s.task === HONEY_TASK && s.shownAct === ACT.Tend))
        this.gleaners.push({ id, kind: s.task === EGGS_TASK ? 0 : 1, x: s.fx, z: s.fz, y: this.groundAt(s.fx, s.fz) });
      if (id === this.selected) Object.assign(sel, { x, y: s.y, z });
      if (id === this.hovered) Object.assign(hov, { x, y: s.y, z });
    }
    this.villagers.count = n;
    this.remains.end();
    // chips and drops: thrown up, falling back, gone
    {
      const bm4 = new THREE.Matrix4(), bc = new THREE.Color();
      const sl = SHAKE.value;
      for (const v of sl) v.z *= Math.exp(-dt * 7);
      let k = 0;
      for (let i = this.bits.length - 1; i >= 0; i--) {
        const b = this.bits[i];
        b.age += dt;
        if (b.age >= b.life) { this.bits[i] = this.bits[this.bits.length - 1]; this.bits.pop(); continue; }
        if (b.age < 0) continue;
        if (b.vapour) {
          const drag = Math.exp(-dt * 1.6);
          b.vx *= drag; b.vz *= drag;
          b.vy += 0.04 * dt;
        } else b.vy -= 3.2 * dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        if (b.y < b.floor) { b.y = b.floor; b.vx *= 0.3; b.vz *= 0.3; b.vy = 0; }
        if (k >= this.bitMesh.instanceMatrix.count) continue;
        const sz = b.size * (1 - Math.max(0, (b.age - b.life * 0.6) / (b.life * 0.4))) * (b.vapour ? 1 + b.age * 2.2 : 1);
        bm4.makeRotationY(i * 1.3 + b.age * 6).scale(new THREE.Vector3(sz, sz, sz)).setPosition(b.x, b.y, b.z);
        this.bitMesh.setMatrixAt(k, bm4);
        this.bitMesh.setColorAt(k, bc.setRGB(b.r, b.g, b.b).convertSRGBToLinear());
        k++;
      }
      if (this.bits.length > 400) this.bits.length = 400;
      this.bitMesh.count = k;
      this.bitMesh.instanceMatrix.needsUpdate = true;
      if (this.bitMesh.instanceColor) this.bitMesh.instanceColor.needsUpdate = true;
    }
    // two rings each, spreading and fading; a swimmer on the move leaves them quicker and wider
    {
      const rm4 = new THREE.Matrix4(), rc = new THREE.Color();
      let k = 0;
      const glow = 1 - night * 0.75;
      for (const w of this.swimmers) {
        for (let j = 0; j < 2 && k < this.ripples.instanceMatrix.count; j++) {
          const ph = (now * (w.moving ? 0.0011 : 0.0006) + j * 0.5 + w.seed * 0.137) % 1;
          const size = (0.16 + (w.moving ? 0.62 : 0.42) * ph) * w.r;
          rm4.makeScale(size, 1, size).setPosition(w.x, w.y + 0.004, w.z);
          this.ripples.setMatrixAt(k, rm4);
          const a = Math.pow(1 - ph, 1.6) * 0.3 * glow;
          this.ripples.setColorAt(k, rc.setRGB(a, a, a));
          k++;
        }
      }
      // rings left by a spear going into the water
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i];
        const ph = (now - r.at) / 900;
        if (ph >= 1) { this.rings.splice(i, 1); continue; }
        if (k >= this.ripples.instanceMatrix.count) continue;
        const size = (0.08 + 0.32 * ph) * r.size;
        rm4.makeScale(size, 1, size).setPosition(r.x, r.y + 0.004, r.z);
        this.ripples.setMatrixAt(k, rm4);
        const a = Math.pow(1 - ph, 1.4) * 0.45 * glow;
        this.ripples.setColorAt(k, rc.setRGB(a, a, a));
        k++;
      }
      this.ripples.count = k;
      this.ripples.instanceMatrix.needsUpdate = true;
      if (this.ripples.instanceColor) this.ripples.instanceColor.needsUpdate = true;
    }
    this.villagers.instanceMatrix.needsUpdate = true;
    anim.needsUpdate = anim2.needsUpdate = anim3.needsUpdate = cloth.needsUpdate = skin.needsUpdate = hair.needsUpdate = true;
    for (const [kind, cm] of this.carryMeshes) {
      cm.count = carryCount.get(kind) ?? 0;
      cm.instanceMatrix.needsUpdate = true;
    }
    // the lamps' flames, and a halo round the nearest few
    {
      this.lampFlames = this.grow(this.lampFlames, this.lampsLit.length);
      const fm = new THREE.Matrix4();
      this.lampsLit.forEach((w, k) => this.lampFlames.setMatrixAt(k, fm.makeTranslation(w.x, w.y - 0.002, w.z)));
      this.lampFlames.count = this.lampsLit.length;
      this.lampFlames.instanceMatrix.needsUpdate = true;
      const near = [...this.lampsLit].sort((p1, p2) => p1.distanceToSquared(camTarget) - p2.distanceToSquared(camTarget));
      this.lampGlow.forEach((g, k) => {
        const w = near[k];
        g.visible = !!w;
        if (!w) return;
        // (lifted by a third of its size, so the ground never cuts through it)
        const size = 0.07 + night * 0.07;
        g.position.set(w.x, w.y + size * 0.3, w.z);
        g.scale.setScalar(size);
        (g.material as THREE.SpriteMaterial).opacity = 0.25 + night * 0.45;
      });
    }
    this.selRing.visible = sel.y > -90;
    this.selRing.position.set(sel.x, sel.y + 0.02, sel.z);
    this.hoverRing.visible = hov.y > -90 && this.hovered !== this.selected;
    this.hoverRing.position.set(hov.x, hov.y + 0.02, hov.z);

    // deer
    const dAnim = this.deerMesh.geometry.attributes.iAnim as THREE.InstancedBufferAttribute;
    const dAnim2 = this.deerMesh.geometry.attributes.iAnim2 as THREE.InstancedBufferAttribute;
    const pitchQ = new THREE.Quaternion(), xAxis = new THREE.Vector3(1, 0, 0);
    let dn = 0;
    this.visibleDeer.length = 0;
    const snowy = this.tracks.snowy;
    for (const [id, d] of this.deer) {
      if (dn >= dAnim.count) break;
      const t = Math.min(1, (now - d.t0) / d.dur);
      const tx = d.sx + (d.x - d.sx) * t, tz = d.sz + (d.z - d.sz) * t;
      const ox = d.dx, oz = d.dz;
      if (Math.abs(tx - d.dx) + Math.abs(tz - d.dz) > 1.5) { d.dx = tx; d.dz = tz; }
      else { d.dx += (tx - d.dx) * follow; d.dz += (tz - d.dz) * follow; }
      const x = d.dx, z = d.dz;
      const size = d.fawn ? 0.62 : 1;
      // ground speed in tiles a second; the legs step with the distance covered, so hooves
      // don't skate, and break from a walk into a bounding gallop as the pace picks up
      const moved = Math.hypot(x - ox, z - oz);
      const speed = dt > 0 ? moved / dt / size : 0;
      const k = 1 - Math.exp(-dt * 6);
      d.moving += (Math.min(1, speed / 0.35) - d.moving) * k;
      d.gait += (smooth(DEER_GALLOP_FROM, DEER_GALLOP_FULL, speed) - d.gait) * k;
      const stride = (DEER_STRIDE_WALK + (DEER_STRIDE_RUN - DEER_STRIDE_WALK) * d.gait) * size;
      if (moved > 0) d.phase = (d.phase + Math.min(moved / stride, DEER_MAX_CADENCE * dt)) % 1;
      // face the way it is going while on the move, otherwise where the herd wants to be
      const want = moved > 0.0015 * dt * 60 ? Math.atan2(x - ox, z - oz) : d.want;
      d.angle += shortest(d.angle, want) * (1 - Math.exp(-dt * (d.state === 2 ? 10 : 6)));
      // forefeet and hind feet each find their own footing, so the body tips up or down
      // over a terrace edge and springs from one level to the next instead of floating
      const hx = Math.sin(d.angle) * DEER_HALF * size, hz = Math.cos(d.angle) * DEER_HALF * size;
      const kf = Math.min(1, dt * 16);
      d.yf += (this.groundAt(x + hx, z + hz) - d.yf) * kf;
      d.yb += (this.groundAt(x - hx, z - hz) - d.yb) * kf;
      const rise = d.yf - d.yb;
      const pitchGoal = Math.max(-0.6, Math.min(0.6, Math.atan2(rise, DEER_HALF * 2 * size)));
      d.pitch += (pitchGoal - d.pitch) * Math.min(1, dt * 14);
      const leap = Math.min(1, Math.abs(rise) / (STEP * 0.5));
      d.y = (d.yf + d.yb) / 2 + leap * (1 - leap * 0.5) * 0.08 * size;
      // a line of slots behind it in the snow, left and right feet in turn
      if (snowy && moved > 0 && moved < 1) {
        d.trail += moved;
        const gap = stride * 0.5;
        while (d.trail > gap) {
          d.trail -= gap;
          d.foot = 1 - d.foot;
          const side = (d.foot ? 1 : -1) * 0.03 * size, back = d.trail;
          const px = x + Math.cos(d.angle) * side - Math.sin(d.angle) * back, pz = z - Math.sin(d.angle) * side - Math.cos(d.angle) * back;
          this.tracks.press(px, this.groundAt(px, pz) + 0.003, pz, d.angle, size);
        }
      }
      // two stags locked together heave as one: each needs to know which way it gives ground
      const yields = Math.sin(d.angle + 0.3) >= 0 ? 1 : -1;
      if (d.state === 4 && yields > 0) {
        // each crash of antlers throws up a spurt of snow or earth between them
        const n = Math.floor(U.uTime.value / 2.4);
        if (n !== d.clashed) {
          if (d.clashed >= 0 && Math.hypot(x - camTarget.x, z - camTarget.z) < 30) {
            const hx2 = x + Math.sin(d.angle) * 0.17, hz2 = z + Math.cos(d.angle) * 0.17, gy = this.groundAt(hx2, hz2);
            const white = U.uSnow.value > 0.4;
            for (let k = 0; k < 6; k++) {
              const a2 = Math.random() * Math.PI * 2, sp = 0.1 + Math.random() * 0.25;
              this.bits.push({ x: hx2, y: d.y + 0.22, z: hz2, vx: Math.cos(a2) * sp, vy: 0.3 + Math.random() * 0.5, vz: Math.sin(a2) * sp,
                age: 0, life: 0.7, size: 0.008 + Math.random() * 0.006, r: white ? 0.93 : 0.5, g: white ? 0.95 : 0.4, b: white ? 0.98 : 0.3, floor: gy });
            }
          }
          d.clashed = n;
        }
      }
      // a roaring stag's breath steams in the cold autumn air at the height of each bellow
      if (d.state === 3) {
        const tr = (U.uTime.value + (id % 97) * 0.61) * 1.7;
        const cycle = Math.floor((tr - Math.PI * 0.5) / (Math.PI * 2));
        if (cycle !== d.puffed) {
          if (d.puffed >= 0 && Math.hypot(x - camTarget.x, z - camTarget.z) < 30) {
            const mx = x + Math.sin(d.angle) * 0.26 * size, mz = z + Math.cos(d.angle) * 0.26 * size;
            for (let k = 0; k < 5; k++) {
              this.bits.push({ x: mx, y: d.y + 0.37 * size, z: mz, vx: Math.sin(d.angle) * (0.12 + k * 0.03) + (Math.random() - 0.5) * 0.05, vy: 0.05 + Math.random() * 0.05,
                vz: Math.cos(d.angle) * (0.12 + k * 0.03) + (Math.random() - 0.5) * 0.05, age: -k * 0.05, life: 1.3, size: 0.012 + Math.random() * 0.006,
                r: 0.92, g: 0.93, b: 0.95, floor: -99, vapour: true });
            }
          }
          d.puffed = cycle;
        }
      }
      pos.set(x, d.y, z);
      q.setFromAxisAngle(up, d.angle).multiply(pitchQ.setFromAxisAngle(xAxis, -d.pitch));
      scl.setScalar(size);
      m4.compose(pos, q, scl);
      this.deerMesh.setMatrixAt(dn, m4);
      dAnim.setXYZW(dn, d.state, d.state === 4 ? yields : (id % 97) * 0.61, !d.fawn && id % 2 ? 1 : 0, d.fawn ? 1 : 0);
      dAnim2.setXYZW(dn, d.phase, d.gait, d.moving, leap);
      dn++;
      this.visibleDeer.push({ id, x, y: d.y + 0.2, z, fawn: d.fawn, state: d.state });
      if (this.markerAt && this.markerAt.r < 0 && -this.markerAt.r === id) this.markerAt = { x, y: d.y, z, r: -id };
    }
    this.deerMesh.count = dn;
    this.deerMesh.instanceMatrix.needsUpdate = true;
    dAnim.needsUpdate = true;
    dAnim2.needsUpdate = true;

    // hares keep the game's pace: still while it is paused, quicker (up to a point) when it runs fast
    const paced = now - this.frameAt > 1200 ? 0 : dt * Math.min(4, Math.max(0.5, this.tpsNow / BASE_TPS));
    // dogs go with whoever keeps them (the living, out and about or indoors)
    this.keepers.length = 0;
    for (const [id, s] of this.people) {
      if (!(s.dress & 64) || s.act === ACT.Dead) continue;
      this.keepers.push({ id, x: s.dx, y: s.y, z: s.dz, angle: s.angle, indoors: s.indoors, pup: (s.dress & 128) !== 0, hunting: s.task === HUNT_TASK });
    }
    this.wolves.update(dt, now, follow, this.keepers);
    this.beasts.update(dt, now, follow, camTarget);
    // hares and finches take fright at wolves, dogs and foxes as well as at people (and the finches at the boar)
    const foxes = this.beasts.visible.filter((v) => v.kind === BEAST.Fox || v.kind === BEAST.Boar);
    const scary = this.wolves.visible.length || this.wolves.dogSpots.length || foxes.length ? [...this.visible, ...this.wolves.visible, ...this.wolves.dogSpots, ...foxes] : this.visible;
    this.hares.update(paced, camTarget, this.viewZoom, scary);
    this.tracks.update(paced);
    // fish scatter from anyone in the water and from a spear going in
    const spears = this.rings.filter((r) => r.size >= 0.5 && now - r.at < 400);
    this.fish.update(paced, camTarget, this.viewZoom, this.swimmers, spears);
    this.birds.update(paced, camTarget, this.viewZoom, night, scary, this.gleaners);

    this.drawBuildings(night, camTarget);
    this.drawAuras(night);
    const mk = this.markerAt;
    this.marker.visible = !!mk;
    if (mk) {
      const r = mk.r < 0 ? 0.32 : mk.r;
      this.marker.position.set(mk.x, mk.y + 0.03, mk.z);
      this.marker.scale.setScalar(r);
    }
  }

  /** People's current state for the camera director. */
  each(fn: (id: number, s: { x: number; z: number; act: number; task: number; age: number; indoors: boolean }) => void) {
    for (const [id, s] of this.people) fn(id, s);
  }
  getBuildings() {
    return this.buildings;
  }

  /** Which model draws a building: huts come in two shapes, each with wattle, daub, stone and split-plank walls. */
  private modelOf(b: { kind: string; id: number; walls?: string; look?: string }) {
    // (a garden plot as it grows, a monument as it goes up, a weir with fish in its basket, a charcoal clamp smouldering)
    if (b.kind === 'plot' || b.kind === 'barrow' || b.kind === 'stones' || b.kind === 'weir' || b.kind === 'clamp' || b.kind === 'canoe') return b.look && this.buildingMeshes.has(b.look) ? b.look : b.kind;
    if (b.kind !== 'hut' && b.kind !== 'storehouse') return b.kind;
    const shape = b.kind === 'storehouse' ? b.kind : b.id % 2 ? 'hut1' : 'hut0';
    const own = shape + (b.walls === 'daub' ? 'd' : b.walls === 'stone' ? 's' : b.walls === 'plank' ? 'p' : '');
    return this.buildingMeshes.has(own) ? own : shape;
  }

  private drawBuildings(night: number, camTarget: THREE.Vector3) {
    const counts = new Map<string, number>();
    const need = new Map<string, number>();
    for (const b of this.buildings) {
      if (this.introBuild.get(b.id) === 0) continue;
      const kind = this.modelOf(b);
      need.set(kind, (need.get(kind) ?? 0) + 1);
      if (!b.built && b.kind !== 'plot' && b.kind !== 'barrow' && b.kind !== 'stones') need.set('site', (need.get('site') ?? 0) + 1);
      if (b.bedding) need.set('bedding', (need.get('bedding') ?? 0) + 1);
    }
    for (const [kind, n] of need) {
      const m = this.buildingMeshes.get(kind);
      if (m) this.buildingMeshes.set(kind, this.grow(m, n));
    }
    this.flames = this.grow(this.flames, need.get('hearth') ?? 0);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    const put = (kind: string, x: number, z: number, rot: number, progress: number, s = 1, band = -1, walls = 'wood') => {
      const m = this.buildingMeshes.get(kind);
      if (!m) return;
      const k = counts.get(kind) ?? 0;
      if (k >= m.instanceMatrix.count) return;
      // in colour mode a building takes on its band's colour; otherwise it is as built
      if (!m.instanceColor) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(m.instanceMatrix.count * 3).fill(1), 3);
      const bc = this.colorMode && band >= 0 ? this.bandColors.get(band) : undefined;
      // daubed walls take on the colour of dried mud, stone ones go grey (huts and the storehouse have their own models)
      const wt = /^(hut\d|storehouse)[ds]$/.test(kind) ? undefined : WALL_TINT[walls];
      if (wt) tint.setRGB(wt[0], wt[1], wt[2]);
      else tint.setRGB(1, 1, 1);
      if (bc) tint.lerp(bc.light, bc.gone ? 0.25 : 0.65);
      m.setColorAt(k, tint);
      pos.set(x, this.world.groundY[Math.floor(z) * this.world.size + Math.floor(x)], z);
      q.setFromAxisAngle(up, rot);
      scl.setScalar(s);
      m4.compose(pos, q, scl);
      m.setMatrixAt(k, m4);
      (m.geometry.attributes.iProgress as THREE.InstancedBufferAttribute).setX(k, progress);
      counts.set(kind, k + 1);
    };
    const fires: { x: number; y: number; z: number; fuel: number }[] = [];
    const clamps: { x: number; y: number; z: number }[] = [];
    this.drawPiles();
    this.drawTraps();
    for (const b of this.buildings) {
      // (in the opening scene the hearth and stockpile are laid out as the band arrives)
      const laid = this.introBuild.get(b.id);
      if (laid === 0) continue;
      const cx = b.x + 0.5, cz = b.z + 0.5;
      const rot = (b.rot * Math.PI) / 2;
      const kind = this.modelOf(b);
      put(kind, cx, cz, rot, laid !== undefined ? Math.max(0.02, laid) : b.built ? 1 : Math.max(0.02, b.progress), 1, b.band, b.walls);
      const bc = this.colorMode ? this.bandColors.get(b.band) : undefined;
      if (bc) this.auraList.push({ x: cx, y: this.world.groundY[b.z * this.world.size + b.x], z: cz, r: b.kind === 'hearth' ? 3 : 2.2, c: bc.color, k: bc.gone ? 0.12 : 0.42 });
      // the band's range: a wide wash around a lived-in camp's hearth, wider the more people there are
      if (bc && b.kind === 'hearth' && !bc.gone) {
        const pop = this.bandPop.get(b.band) ?? 10;
        this.auraList.unshift({ x: cx, y: this.world.groundY[b.z * this.world.size + b.x], z: cz, r: 7 + Math.sqrt(pop) * 1.8, c: bc.color, k: 0.3, terr: true });
      }
      // (a monument has no pile of stakes and rods: it is earth and stone, and the stone lies on the ground in its model)
      if (!b.built && b.kind !== 'plot' && b.kind !== 'barrow' && b.kind !== 'stones') {
        // the pile of stakes and rods lies where the work is: a windbreak goes up in an arc behind the fire,
        // so its pile sits just inside the arc rather than in the fire on the hearth's tile
        if (b.kind === 'windbreak') {
          const side = rot + 0.3;
          put('site', cx - Math.sin(side) * 1.3, cz - Math.cos(side) * 1.3, rot + 0.6, 1, 0.8);
        } else if (b.kind === 'weir') {
          // (a weir's stakes and withies lie on the bank it is built from, not in the river: the bank to the
          // left looking downstream, as weirBank picks it)
          put('site', cx - Math.cos(rot) * 0.8, cz + Math.sin(rot) * 0.8, rot + 0.6, 1, 0.8);
        } else put('site', cx + 0.28, cz + 0.3, rot + 0.6, 1, 0.8);
      }
      // fresh grass laid under a lean-to (a hut's is out of sight inside)
      if (b.bedding && b.kind === 'leanto' && b.built) put('bedding', cx, cz, rot, 1, 1, b.band);
      if (b.kind === 'clamp' && b.look === 'clampLit') clamps.push({ x: cx, y: this.world.groundY[b.z * this.world.size + b.x], z: cz });
      if (b.kind === 'hearth' && b.fuel > 0 && (laid === undefined || laid >= 1)) fires.push({ x: cx, y: this.world.groundY[b.z * this.world.size + b.x], z: cz, fuel: b.fuel });
    }
    for (const [kind, m] of this.buildingMeshes) {
      m.count = counts.get(kind) ?? 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      (m.geometry.attributes.iProgress as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
    // fire, glow, light and smoke
    let fi = 0;
    for (const f of fires) {
      if (fi >= this.flames.instanceMatrix.count) break;
      const s = 0.6 + Math.min(1, f.fuel / 5) * 0.5;
      pos.set(f.x, f.y, f.z);
      q.identity();
      scl.setScalar(s);
      m4.compose(pos, q, scl);
      this.flames.setMatrixAt(fi, m4);
      const g = this.glow[fi];
      if (g) {
        g.visible = true;
        // a halo around the flames only: kept small and lifted so the ground never cuts through it
        // (the warm pool of light on the ground comes from the point light)
        g.position.set(f.x, f.y + 0.32, f.z);
        g.scale.setScalar(0.55 + night * 0.75);
        (g.material as THREE.SpriteMaterial).opacity = 0.2 + night * 0.5;
      }
      fi++;
    }
    this.flames.count = fi;
    this.flames.instanceMatrix.needsUpdate = true;
    for (let k = fi; k < this.glow.length; k++) this.glow[k].visible = false;
    fires.sort((p1, p2) => Math.hypot(p1.x - camTarget.x, p1.z - camTarget.z) - Math.hypot(p2.x - camTarget.x, p2.z - camTarget.z));
    this.lights.forEach((l, k) => {
      const f = fires[k];
      if (!f) {
        l.intensity = 0;
        return;
      }
      l.position.set(f.x, f.y + 0.5, f.z);
      const flicker = 0.85 + 0.15 * Math.sin(performance.now() * 0.013) * Math.sin(performance.now() * 0.0071);
      l.intensity = (0.25 + night * 3.2) * Math.min(1, f.fuel / 3) * flicker;
    });
    const f0 = fires[0];
    this.smoke.visible = !!f0;
    if (f0) this.smokeMat.uniforms.uOrigin.value.set(f0.x, f0.y + 0.25, f0.z);
    this.smokeMat.uniforms.uNight.value = night;
    // and a slow grey plume from the top of a smouldering charcoal clamp
    let c0: { x: number; y: number; z: number } | undefined;
    for (const c of clamps) if (!c0 || Math.hypot(c.x - camTarget.x, c.z - camTarget.z) < Math.hypot(c0.x - camTarget.x, c0.z - camTarget.z)) c0 = c;
    this.clampSmoke.visible = !!c0;
    if (c0) this.clampSmokeMat.uniforms.uOrigin.value.set(c0.x, c0.y + 0.16, c0.z);
    this.clampSmokeMat.uniforms.uNight.value = night;
  }

  /** The band-colour glows gathered this frame (people and buildings), drawn on the ground. */
  private drawAuras(night: number) {
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    const list = this.colorMode ? this.auraList : [];
    if (list.length > this.auras.instanceMatrix.count) {
      const cap = Math.ceil(list.length * 1.5);
      this.auras.geometry.setAttribute('iStrength', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
      const next = new THREE.InstancedMesh(this.auras.geometry, this.auras.material, cap);
      next.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      next.frustumCulled = false;
      next.renderOrder = this.auras.renderOrder;
      this.group.remove(this.auras);
      this.group.add(next);
      this.auras = next;
    }
    // stronger and wider when zoomed out, so a band's whole range reads at a glance
    const far = Math.min(1, Math.max(0, (this.viewZoom - 14) / 50));
    const strength = this.auras.geometry.attributes.iStrength as THREE.InstancedBufferAttribute;
    list.forEach((a, i) => {
      const r = a.r * (1 + far * (a.terr ? 0.2 : 1.2));
      m4.makeScale(r * 2, 1, r * 2).setPosition(a.x, a.y + (a.terr ? 0.02 : 0.03), a.z);
      this.auras.setMatrixAt(i, m4);
      this.auras.setColorAt(i, c.copy(a.c));
      strength.setX(i, Math.min(0.9, a.k * (1 + far * 0.8) * (1 + night * 0.2)));
    });
    this.auras.count = list.length;
    this.auras.instanceMatrix.needsUpdate = true;
    strength.needsUpdate = true;
    if (this.auras.instanceColor) this.auras.instanceColor.needsUpdate = true;
  }

  setPiles(p: { id: number; wood: number; berries: number; meat: number; fish: number; preserved: number; pots?: number; bowls?: number; beads?: number; sashes?: number; jars?: number }[]) {
    this.piles = new Map(p.map((q) => [q.id, q]));
  }

  setTraps(t: NonNullable<Frame['traps']>) {
    this.traps = t;
  }

  /** Snares stand at the foot of the bushes, off the middle of their tile, as do deadfalls by the earths; fish traps lie half sunk in the shallows. */
  private drawTraps() {
    const counts = new Map<string, number>();
    // a little over life size, so a set line still reads from the usual height
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), size = new THREE.Vector3(1.3, 1.3, 1.3);
    for (const t of this.traps) {
      const key = (t.kind === 0 ? 'snare' : t.kind === 2 ? 'deadfall' : 'fishtrap') + (t.caught ? (t.beaver ? 'Beaver' : 'Full') : '');
      let m = this.trapMeshes.get(key);
      if (!m) continue;
      const k = counts.get(key) ?? 0;
      if (k >= m.instanceMatrix.count) this.trapMeshes.set(key, (m = this.grow(m, k + 1)));
      const h = (i: number) => ((t.id * 7919 + i * 104729) % 1000) / 1000;
      const x = t.x + 0.5 + (h(1) - 0.5) * 0.5, z = t.z + 0.5 + (h(2) - 0.5) * 0.5;
      const wt = t.kind === 1 ? this.waterAt(x, z) : null;
      const y = wt ? wt.surface - 0.02 : this.groundAt(x, z);
      q.setFromAxisAngle(up, h(3) * Math.PI * 2);
      m4.compose(new THREE.Vector3(x, y, z), q, size);
      m.setMatrixAt(k, m4);
      counts.set(key, k + 1);
    }
    for (const [key, m] of this.trapMeshes) {
      m.count = counts.get(key) ?? 0;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  /** Lay out each stockpile's contents: more wood, a taller stack; more food, more on the mat. */
  private drawPiles() {
    const counts = new Map<string, number>();
    const local = new THREE.Matrix4(), base = new THREE.Matrix4(), out = new THREE.Matrix4(), rq = new THREE.Quaternion(), e = new THREE.Euler();
    const up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const place = (key: string, x: number, y: number, z: number, rx: number, ry: number, s = 1) => {
      const m = this.pileMeshes.get(key);
      const k = counts.get(key) ?? 0;
      if (!m) return;
      if (k >= m.instanceMatrix.count) {
        this.pileMeshes.set(key, this.grow(m, k + 1));
        return place(key, x, y, z, rx, ry, s);
      }
      rq.setFromEuler(e.set(rx, ry, 0));
      local.compose(new THREE.Vector3(x, y, z), rq, new THREE.Vector3(s, s, s));
      out.multiplyMatrices(base, local);
      m.setMatrixAt(k, out);
      counts.set(key, k + 1);
    };
    for (const b of this.buildings) {
      if (b.kind !== 'stockpile') continue;
      const laid = this.introBuild.get(b.id);
      if (laid !== undefined && laid < 1) continue;
      const p = this.piles.get(b.id);
      if (!p) continue;
      const gy = this.world.groundY[b.z * this.world.size + b.x];
      base.compose(new THREE.Vector3(b.x + 0.5, gy, b.z + 0.5), new THREE.Quaternion().setFromAxisAngle(up, (b.rot * Math.PI) / 2), one);
      const h = (i: number) => ((b.id * 7919 + i * 104729) % 1000) / 1000;
      // three loads of wood to a log, three logs across, stacked up between the stakes
      const logs = Math.min(36, Math.ceil(p.wood / 3));
      for (let i = 0; i < logs; i++) {
        const layer = Math.floor(i / 3), col = i % 3;
        place('log', (h(i) - 0.5) * 0.03, 0.045 + layer * 0.04, -0.265 + col * 0.046 + (layer % 2) * 0.006, (h(i + 50) - 0.5) * 0.4, (h(i + 90) - 0.5) * 0.06);
      }
      // food on the mat, in rows
      const items: string[] = [];
      // the band's pots stand in the front row; berries that don't fit in them sit in open baskets
      const pots = Math.min(5, p.pots ?? 0);
      for (let i = 0; i < pots; i++) items.push('pot');
      for (let i = 0; i < Math.min(5 - pots, Math.ceil(Math.max(0, p.berries - (p.pots ?? 0) * POT_HOLDS) / 5)); i++) items.push('basket');
      for (let i = 0; i < Math.min(4, Math.ceil(p.meat / 6)); i++) items.push('meat');
      for (let i = 0; i < Math.min(4, Math.ceil(p.fish / 4)); i++) items.push('fish');
      for (let i = 0; i < Math.min(3, Math.ceil(p.preserved / 8)); i++) items.push('dried');
      // the band's goods in a row in front of the woodpile: bowls stacked in twos, strings of beads laid beside them
      const bowls = Math.min(8, p.bowls ?? 0), beads = Math.min(6, p.beads ?? 0);
      for (let i = 0; i < bowls; i++) {
        const col = Math.floor(i / 2), up = i % 2;
        place('bowl', -0.22 + col * 0.065 + (h(i + 500) - 0.5) * 0.01, 0.008 + up * 0.018, -0.1 + (h(i + 520) - 0.5) * 0.01, 0, h(i + 540) * Math.PI * 2);
      }
      for (let i = 0; i < beads; i++)
        place('beads', 0.06 + (i % 3) * 0.055 + (h(i + 600) - 0.5) * 0.01, 0.006 + Math.floor(i / 3) * 0.006, -0.1 + (h(i + 620) - 0.5) * 0.02, 0, h(i + 640) * Math.PI * 2);
      // and the woven sashes laid one on another at the end of the row
      const sashes = Math.min(5, p.sashes ?? 0);
      for (let i = 0; i < sashes; i++)
        place('sash', 0.22 + (h(i + 700) - 0.5) * 0.02, 0.003 + i * 0.004, -0.1 + (h(i + 720) - 0.5) * 0.02, 0, h(i + 740) * Math.PI * 2);
      // sealed storage jars standing in two files along the side of the mat
      const jars = Math.min(10, p.jars ?? 0);
      for (let i = 0; i < jars; i++)
        place('jar', 0.33 + (i % 2) * 0.085 + (h(i + 800) - 0.5) * 0.01, 0, -0.22 + Math.floor(i / 2) * 0.09 + (h(i + 820) - 0.5) * 0.01, 0, h(i + 840) * Math.PI * 2);
      items.slice(0, 15).forEach((it, i) => {
        const col = i % 5, row = Math.floor(i / 5);
        const x = -0.2 + col * 0.1 + (h(i + 200) - 0.5) * 0.02, z = 0.05 + row * 0.085 + (h(i + 300) - 0.5) * 0.02;
        const ry = h(i + 400) * Math.PI * 2;
        if (it === 'basket') place('basket', x, 0.045, z, 0, ry);
        else if (it === 'pot') place('pot', x, 0.016, z, 0, ry);
        else if (it === 'fish') place('fish', x, 0.028, z, Math.PI / 2, ry);
        else place('meat', x, it === 'dried' ? 0.04 : 0.055, z, 0, ry, it === 'dried' ? 0.75 : 1);
      });
    }
    for (const [key, m] of this.pileMeshes) {
      m.count = counts.get(key) ?? 0;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  /** Person nearest a screen point (client px), using a projector from world to screen. */
  pickPerson(clientX: number, clientY: number, project: (x: number, y: number, z: number) => { x: number; y: number }, radius = 16) {
    let best = -1, bd = radius;
    for (const v of this.visible) {
      const p = project(v.x, v.y - 0.2, v.z);
      const d = Math.hypot(p.x - clientX, p.y - clientY);
      if (d < bd) { bd = d; best = v.id; }
    }
    return best;
  }

  /** Where a person is drawn right now (for following with the camera). */
  positionOf(id: number) {
    const s = this.people.get(id);
    if (!s) return null;
    return { x: s.dx, y: s.y, z: s.dz, indoors: s.indoors };
  }
}

/** The signed shortest turn from one heading to another. */
function shortest(cur: number, want: number) {
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}


/** Where each carried item sits on the body (person-local space, facing +Z); a spear and a digging stick follow the hand instead (spearInHand). */
function carryOffset(kind: number) {
  const m = new THREE.Matrix4();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  switch (kind) {
    case CARRY.Log: p.set(0.06, 0.3, 0); e.set(0, Math.PI / 2, 0.15); break;
    case CARRY.Berries: p.set(0.075, 0.16, 0.04); break;
    case CARRY.Fiber: p.set(0.078, 0.15, 0.035); e.set(0.15, 0, 0); break; // gripped at the tie, heads up
    case CARRY.Mud: p.set(0.076, 0.15, 0.035); break; // hanging from the twist of the hide
    case HARE: p.set(0.076, 0.15, 0.035); break; // dangling from the noose's cord
    case CARRY.Roots: p.set(0.076, 0.15, 0.035); break; // held by the tied stems
    case CARRY.Nuts: p.set(0.076, 0.15, 0.035); break; // a hide bag, by its neck
    case CARRY.Herbs: p.set(0.078, 0.15, 0.035); e.set(0.15, 0, 0); break; // a bunch, stems in the fist
    case CARRY.Eggs: p.set(0.076, 0.14, 0.035); break; // a nest of eggs held in the hand
    case CARRY.Honey: p.set(0.076, 0.14, 0.035); break; // comb on a slab of bark
    case CARRY.Mushrooms: p.set(0.076, 0.15, 0.035); break; // a small grass basket, by its handle
    case CARRY.Greens: p.set(0.076, 0.15, 0.035); break; // a bunch of greens, by the tied stalks
    case CARRY.Grain: p.set(0.06, 0.3, 0); e.set(0, Math.PI / 2, 0.15); break; // a sheaf on the shoulder, like a log
    case CARRY.Stone: p.set(0.06, 0.315, -0.008); e.set(0, 0.3, 0); break; // on the right shoulder
    case CARRY.Meat: p.set(0, 0.3, -0.03); e.set(0, Math.PI / 2, 0); break;
    case CARRY.Fish: p.set(0.078, 0.15, 0.02); e.set(0, Math.PI / 2, -1.2); break;
    case CARRY.Body: p.set(0, 0.215, 0.085); e.set(0, 0, 0); break; // held across the arms
    case CARRY.Baby: p.set(0, 0.23, 0.055); break;
    case CARRY.Piglet: p.set(0, 0.225, 0.06); break; // held tight against the chest, wriggling
    case SNARE: p.set(0.075, 0.16, 0.04); break; // the coil in the fist, its stake hanging
    case FISHTRAP: p.set(0.075, 0.075, 0.04); e.set(Math.PI / 2, 0, 0); break; // by the tail, mouth down
    case BASKET: case BASKET_FULL: p.set(0.08, 0.16, 0.035); break; // hung from the fist by its handle
    case LINE: p.set(0.076, 0.15, 0.035); break; // the stick it is wound on, in the fist
    case NET: p.set(0.06, 0.3, 0); e.set(0, Math.PI / 2, 0.15); break; // bundled on the shoulder, like a log
  }
  m.makeRotationFromEuler(e).setPosition(p);
  return m;
}

/** A thin bright ring on transparent, for ripples (computed per pixel so the edge is clean). */
function ringTexture() {
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const r = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2);
      const v = Math.max(0, 1 - Math.abs(r - 0.82) / 0.1);
      const o = (y * N + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(v * v * 255);
    }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  return t;
}

function radialTexture() {
  // computed per pixel (not a canvas gradient) so the edge is exactly transparent
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const r = Math.hypot(x + 0.5 - N / 2, y + 0.5 - N / 2) / (N / 2);
      const a = Math.pow(Math.max(0, 1 - r), 2.2);
      const o = (y * N + x) * 4;
      data[o] = 255; data[o + 1] = 190 + 40 * a; data[o + 2] = 120 + 60 * a; data[o + 3] = Math.round(a * 255);
    }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function makeSmoke() {
  const n = 28;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) pos.set([i / n, ((i * 37) % n) / n, ((i * 11) % n) / n], i * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: U.uTime, uOrigin: { value: new THREE.Vector3() }, uNight: { value: 0 }, uWind: U.uWind },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uOrigin;
      uniform float uWind;
      varying float vLife;
      void main() {
        float life = fract(position.x + uTime * 0.07);
        vLife = life;
        vec3 p = uOrigin;
        p.y += life * 2.4;
        p.x += (position.y - 0.5) * 0.25 * life + life * life * (0.5 + uWind) * 1.1;
        p.z += (position.z - 0.5) * 0.25 * life;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        gl_PointSize = (6.0 + life * 26.0) * (projectionMatrix[1][1] * 9.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      varying float vLife;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = (1.0 - smoothstep(0.0, 0.5, length(d))) * (1.0 - vLife) * smoothstep(0.0, 0.08, vLife) * 0.32;
        vec3 c = mix(vec3(0.82, 0.8, 0.78), vec3(0.32, 0.33, 0.38), uNight);
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }`,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  return { points, mat };
}

// Poses. Every joint turns about the body's sideways axis: thighs and upper arms at the hip and
// shoulder, shins and forearms at the knee and elbow (riding on the limb above), the head at the
// neck; the upper body leans and sways about the hips. Walking and running play the cycles
// authored in Blender (gait texture) at a stride phase the CPU advances with distance walked;
// everything else is a held or gently moving pose. Two poses are blended while one turns into
// the next, so nothing pops.
const POSE_GLSL = /* glsl */ `
struct Pose { float thL, thR, knL, knR, shL, shR, elL, elR, lean, bob, roll, head, lower, lie, side; };

float gaitAt(int g, int ch, float ph) {
  float x = fract(ph) * ${gait.samples}.0;
  int i = int(floor(x));
  float f = x - float(i);
  int row = g * ${gait.channels.length} + ch;
  return mix(texelFetch(uGait, ivec2(i, row), 0).r, texelFetch(uGait, ivec2((i + 1) % ${gait.samples}, row), 0).r, f);
}
float gaitCh(int ch, float ph, float run) { return mix(gaitAt(0, ch, ph), gaitAt(1, ch, ph), run); }
/** a one-off clip, start (0) to end (1), not wrapping */
float onceAt(int g, int ch, float pr) {
  float x = clamp(pr, 0.0, 1.0) * ${gait.samples - 1}.0;
  int i = int(floor(x));
  int j = min(i + 1, ${gait.samples - 1});
  int row = g * ${gait.channels.length} + ch;
  return mix(texelFetch(uGait, ivec2(i, row), 0).r, texelFetch(uGait, ivec2(j, row), 0).r, x - float(i));
}

Pose still() { return Pose(0.0, 0.0, 0.03, 0.03, 0.0, 0.0, -0.12, -0.12, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0); }

Pose loopPose(int g, float ph) {
  return Pose(gaitAt(g, 0, ph), gaitAt(g, 1, ph), gaitAt(g, 2, ph), gaitAt(g, 3, ph), gaitAt(g, 4, ph), gaitAt(g, 5, ph),
    gaitAt(g, 6, ph), gaitAt(g, 7, ph), gaitAt(g, 8, ph), gaitAt(g, 9, ph), gaitAt(g, 10, ph), gaitAt(g, 11, ph), gaitAt(g, 12, ph), 0.0, 0.0);
}
Pose oncePose(int g, float pr) {
  return Pose(onceAt(g, 0, pr), onceAt(g, 1, pr), onceAt(g, 2, pr), onceAt(g, 3, pr), onceAt(g, 4, pr), onceAt(g, 5, pr),
    onceAt(g, 6, pr), onceAt(g, 7, pr), onceAt(g, 8, pr), onceAt(g, 9, pr), onceAt(g, 10, pr), onceAt(g, 11, pr), onceAt(g, 12, pr), 0.0, 0.0);
}

Pose sitting() {
  Pose p = still();
  p.thL = p.thR = -2.05; p.knL = p.knR = 1.55; p.lower = 0.125;
  p.shL = p.shR = -0.55; p.elL = p.elR = -0.55; p.lean = 0.12;
  return p;
}

Pose poseFor(float act, float t, float ph, float run) {
  Pose p = still();
  if (act < 0.5) {                       // idle: breathing, a little shift of weight
    p.shL = 0.05 * sin(t * 1.6); p.shR = -p.shL; p.head = 0.05 * sin(t * 0.7);
    p.bob = 0.0015 * sin(t * 2.1); p.roll = 0.015 * sin(t * 0.45);
  } else if (act < 1.5 || (act > 11.5 && act < 13.5)) {   // walk, run, hunt: the authored cycles
    float r = act > 11.5 ? max(run, 0.75) : run;
    p.thL = gaitCh(0, ph, r); p.thR = gaitCh(1, ph, r); p.knL = gaitCh(2, ph, r); p.knR = gaitCh(3, ph, r);
    p.shL = gaitCh(4, ph, r); p.shR = gaitCh(5, ph, r); p.elL = gaitCh(6, ph, r); p.elR = gaitCh(7, ph, r);
    p.lean = gaitCh(8, ph, r); p.bob = gaitCh(9, ph, r); p.roll = gaitCh(10, ph, r); p.head = gaitCh(11, ph, r);
    if (act > 12.5) { p.shR = -2.35; p.elR = -0.35; p.lean += 0.08; }  // spear raised
  } else if (act < 2.5) {                // chopping: feet apart, overhead swing
    float c = max(0.0, sin(t * 5.5));
    p.thL = -0.18; p.thR = 0.16; p.knL = p.knR = 0.15;
    p.shL = p.shR = -2.75 + 1.85 * c; p.elL = p.elR = -0.35 + 0.25 * c; p.lean = 0.1 + 0.22 * c;
  } else if (act < 3.5) {                // gathering: bent at knees and hips, hands busy
    p.thL = p.thR = -0.45; p.knL = p.knR = 0.75; p.lower = 0.018; p.lean = 0.7; p.head = 0.25;
    p.shL = -1.0 + 0.25 * sin(t * 6.0); p.shR = -1.1 - 0.25 * sin(t * 6.0 + 1.0); p.elL = p.elR = -0.35;
  } else if (act < 4.5) {                // sitting on the ground, knees up
    p = sitting();
  } else if (act < 5.5) {                // asleep: curled up on one side, hands tucked under the chin, breathing slowly
    p.lie = 1.0; p.side = 1.0;
    p.thL = -0.95; p.thR = -0.75; p.knL = 1.35; p.knR = 1.15;
    p.shL = -1.15; p.shR = -0.95; p.elL = p.elR = -1.6;
    p.head = 0.3; p.lean = 0.18 + 0.025 * sin(t * 1.3);
  } else if (act < 6.5) {                // talking, with a hand
    p.shR = -0.55 - 0.45 * max(0.0, sin(t * 4.0)); p.elR = -0.9; p.head = 0.12 * sin(t * 2.2);
    p.roll = 0.02 * sin(t * 0.8);
  } else if (act < 7.5) {                // building: down on one knee, hammering
    p.thL = -1.45; p.knL = 1.55; p.thR = 0.25; p.knR = 1.85; p.lower = 0.064; p.lean = 0.28;
    p.shR = -1.9 + 1.0 * abs(sin(t * 8.0)); p.elR = -0.55; p.shL = -0.75; p.elL = -0.6;
  } else if (act < 8.5) {                // fishing: spear poised over the water
    p.thL = -0.2; p.thR = 0.15; p.knL = p.knR = 0.2; p.lean = 0.28; p.head = 0.32;
    p.shR = -2.2 + 0.45 * max(0.0, sin(t * 3.0)); p.elR = -0.35; p.shL = -0.9; p.elL = -0.95;
  } else if (act < 9.5) {                // eating, sitting
    p = sitting();
    p.shR = -0.55 - 0.85 * max(0.0, sin(t * 3.0)); p.elR = -1.95;
  } else if (act < 10.5) {               // mourning: kneeling, head bowed
    p.thL = p.thR = -0.08; p.knL = p.knR = 1.6; p.lower = 0.07; p.lean = 0.42; p.head = 0.5;
    p.shL = p.shR = -0.35; p.elL = p.elR = -0.9;
  } else if (act < 11.5) {               // dead
    p.lie = 1.0;
  } else if (act < 14.5) {               // digging
    float c = abs(sin(t * 5.0));
    p.thL = -0.25; p.thR = 0.22; p.knL = p.knR = 0.35; p.lean = 0.5;
    p.shL = p.shR = -1.75 + 0.95 * c; p.elL = p.elR = -0.45;
  } else if (act < 15.5) {               // playing: skipping round after each other
    p = loopPose(${CLIP.skip}, t * 1.7);
  } else if (act < 16.5) {               // tending the fire
    p = loopPose(${CLIP.tend}, t / 2.2);
  } else if (act < 17.5) {               // hanging food on the drying rack
    p = loopPose(${CLIP.rack}, t / 2.6);
  } else if (act < 18.5) {               // warming hands at the fire
    p = loopPose(${CLIP.warm}, t / 1.8);
  } else if (act < 19.5) {               // swimming, the stroke driven by distance covered
    p = loopPose(${CLIP.swim}, ph);
  } else {                               // treading water
    p = loopPose(${CLIP.tread}, t / 1.4);
  }
  return p;
}

Pose blendPose(Pose a, Pose b, float k) {
  return Pose(mix(a.thL, b.thL, k), mix(a.thR, b.thR, k), mix(a.knL, b.knL, k), mix(a.knR, b.knR, k),
    mix(a.shL, b.shL, k), mix(a.shR, b.shR, k), mix(a.elL, b.elL, k), mix(a.elR, b.elR, k),
    mix(a.lean, b.lean, k), mix(a.bob, b.bob, k), mix(a.roll, b.roll, k), mix(a.head, b.head, k),
    mix(a.lower, b.lower, k), mix(a.lie, b.lie, k), mix(a.side, b.side, k));
}

mat3 rx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 ry(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rz(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void turn(inout vec3 v, inout mat3 R, mat3 M, vec3 c) { v = M * (v - c) + c; R = M * R; }

// hands that are carrying something hold it (codes as CARRY in sim/band.ts); done to each pose
// before two are blended, so the arms ease from one hold to the next along with the body
void holdCarry(inout Pose p, float act, float carry) {
  if (p.lie > 0.5 || carry < 0.5) return;
  if (carry < 1.5 || (carry > 2.5 && carry < 3.5) || (carry > 9.5 && carry < 10.5)) { p.shR = -1.55; p.elR = -1.95; } // log, meat, stone: on the right shoulder
  else if (carry > 4.5 && carry < 5.5) { p.shL = p.shR = -1.25; p.elL = p.elR = -1.35; }         // a body, in both arms
  else if ((carry > 6.5 && carry < 7.5) || (carry > 18.5 && carry < 19.5)) { p.shL = p.shR = -0.75; p.elL = p.elR = -1.45; } // a baby, cradled (or a piglet held tight)
  else if (carry > 5.5 && carry < 6.5) {
    // a spear, held low; hunting (raised to throw) and fishing (poised over the water) hold it in their own poses
    if (!(act > 7.5 && act < 8.5) && !(act > 12.5 && act < 13.5)) { p.shR = -0.45; p.elR = -0.75; }
  }
  else if ((carry > 1.5 && carry < 2.5) || carry > 7.5) { p.shR = -0.15; p.elR = -0.55; }        // a basket of berries, grass, clay
}

void poseVertex(vec3 pos, out vec3 v, out mat3 R) {
  float t = uTime + iAnim2.z;
  float k = smoothstep(0.0, 1.0, iAnim.z);
  float carry = iAnim2.w;
  Pose a = poseFor(iAnim.y, t, iAnim2.x, iAnim2.y), b = poseFor(iAnim.x, t, iAnim2.x, iAnim2.y);
  holdCarry(a, iAnim.y, carry);
  holdCarry(b, iAnim.x, carry);
  Pose p = blendPose(a, b, k);
  float style = iAnim.w;
  float hairStyle = mod(style, 4.0);
  p.lean += step(3.5, mod(style, 8.0)) * 0.18;   // elders stoop
  // a one-off move (picking up, setting down, a thrust, a stab) plays over all of that
  if (iAnim3.x > 0.5 && p.lie < 0.5) {
    float pr = iAnim3.y;
    float w = smoothstep(0.0, 0.12, pr) * (1.0 - smoothstep(0.88, 1.0, pr));
    p = blendPose(p, oncePose(int(iAnim3.x + 0.5) - 1, pr), w);
  }
  v = pos; R = mat3(1.0);
  float part = aPart;
  bool left = part > 1.5 && part < 2.5 || part > 3.5 && part < 4.5 || part > 7.5 && part < 8.5 || part > 9.5 && part < 10.5;
  bool leg = part > 3.5 && part < 5.5 || part > 9.5 && part < 11.5;
  bool arm = part > 1.5 && part < 3.5 || part > 7.5 && part < 9.5;
  bool headish = part > 0.5 && part < 1.5 || part > 5.5 && part < 7.5 || part > 11.5 && part < 14.5 || part > 15.5 && part < 16.5;
  // only one hair style is shown (parts 6, 7, 12, 13 are styles 0-3), the beard only on the bearded,
  // and the cloak (part 15), hat (16), reed cape (17), bag (18) and fur cloak (19) only on those who have them (style bits 32, 64, 128, 256, 512)
  float hairPart = part > 5.5 && part < 7.5 ? part - 6.0 : part > 11.5 && part < 13.5 ? part - 10.0 : -1.0;
  if ((hairPart > -0.5 && abs(hairPart - hairStyle) > 0.5) || (part > 13.5 && part < 14.5 && mod(style, 32.0) < 15.5) || (part > 14.5 && part < 15.5 && mod(style, 64.0) < 31.5) || (part > 15.5 && part < 16.5 && mod(style, 128.0) < 63.5) || (part > 16.5 && part < 17.5 && mod(style, 256.0) < 127.5) || (part > 17.5 && part < 18.5 && mod(style, 512.0) < 255.5) || (part > 18.5 && style < 511.5)) { v = vec3(0.0, -1.0, 0.0); R = mat3(0.0); return; }
  // lower joint first (knee, elbow), then the limb it hangs from
  if (part > 9.5 && part < 11.5) turn(v, R, rx(left ? p.knL : p.knR), aPivot2);
  else if (part > 7.5 && part < 9.5) turn(v, R, rx(left ? p.elL : p.elR), aPivot2);
  if (leg) turn(v, R, rx(left ? p.thL : p.thR), aPivot);
  if (arm) turn(v, R, rx(left ? p.shL : p.shR), aPivot);
  if (headish) turn(v, R, rx(p.head), aPivot);
  // the upper body leans and sways over the hips
  if (!leg) turn(v, R, rz(p.roll) * rx(p.lean), vec3(0.0, ${HIP_Y.toFixed(3)}, 0.0));
  v.y += p.bob - p.lower;
  // lying down, centred where they stood: on the back, face to the sky, or (side) turned onto one
  // side first, so a shoulder rather than the back is on the ground
  if (p.lie > 0.001) {
    turn(v, R, rx(-p.lie * 1.5708) * ry(p.side * 1.5708), vec3(0.0));
    v += vec3(0.0, p.lie * mix(0.036, 0.074, p.side), p.lie * 0.18);
  }
}
`;
