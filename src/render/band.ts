// Draws the band: animated villagers and deer (instanced, posed in the vertex shader),
// carried items, buildings rising as they're built, the hearth fire, its light and smoke.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ACT, CARRY, FLASH, TASK_KINDS } from '../sim/band';
import { SHAKE } from './props';
import type { Frame } from '../sim/runner';
import { WorldData, WATER } from '../sim/types';
import { addCommon } from './shaderlib';
import { U } from './env';
import gait from '../assets/gait.json';

const P_STRIDE = 16;
/** Poses only the renderer chooses (the simulation just says where people are). */
const SWIM = 19, TREAD = 20;
const FISH_TASK = TASK_KINDS.indexOf('fish') + 1;
/** Drawn in a woodcutter's hands while they chop: an axe, or a hand chopper (a knapped stone in the fist). */
const AXE = 99, CHOPPER = 98;
/** How walls that are not wood colour a building (multiplied over its own colours). */
const WALL_TINT: Record<string, [number, number, number]> = { daub: [1.0, 0.86, 0.68], stone: [0.8, 0.82, 0.86] };
/** A box of one colour, turned about its own centre and set down at (x, y, z) (y is its foot). */
function plank(w: number, h: number, d: number, x: number, y: number, z: number, rx: number, ry: number, hex: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(rx);
  g.rotateY(ry);
  g.translate(x, y + h / 2, z);
  const c = new THREE.Color(hex).convertSRGBToLinear();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}
/**
 * The fire's comforts, made here rather than in Blender: a windbreak of stakes and rails in an arc behind
 * the fire (outside the ring where people sit), and a thatched roof on four posts over the stockpile's log stack.
 */
function fireWorks(): Map<string, THREE.BufferGeometry> {
  const out = new Map<string, THREE.BufferGeometry>();
  const STAKE = 0x5b4128, RAIL = 0x7a5a3a, THATCH = 0xb8a062;
  {
    const parts: THREE.BufferGeometry[] = [];
    const r = 1.55, n = 6, span = 2.4;
    const at = (i: number) => -span / 2 + (span * i) / (n - 1);
    // stakes on the arc, behind the fire (towards -z before the building's turn)
    for (let i = 0; i < n; i++) parts.push(plank(0.04, 0.34, 0.04, Math.sin(at(i)) * r, 0, -Math.cos(at(i)) * r, 0, 0, STAKE));
    // three rails between each pair of stakes
    for (let i = 0; i < n - 1; i++) {
      const a = (at(i) + at(i + 1)) / 2, len = 2 * r * Math.sin((at(i + 1) - at(i)) / 2) + 0.04;
      for (const y of [0.04, 0.13, 0.22]) parts.push(plank(len, 0.05, 0.05, Math.sin(a) * (r - 0.03), y, -Math.cos(a) * (r - 0.03), 0, -a, RAIL));
    }
    out.set('bld__windbreak', mergeGeometries(parts)!);
  }
  {
    const parts: THREE.BufferGeometry[] = [];
    // over the log stack at the back of the stockpile (see drawPiles): posts a little wider than the logs
    const x0 = 0.3, zb = -0.34, zf = -0.1;
    for (const x of [-x0, x0]) {
      parts.push(plank(0.03, 0.44, 0.03, x, 0, zb, 0, 0, STAKE));
      parts.push(plank(0.03, 0.5, 0.03, x, 0, zf, 0, 0, STAKE));
    }
    // the roof slopes down to the back
    parts.push(plank(0.7, 0.03, 0.34, 0, 0.45, (zb + zf) / 2, -Math.atan2(0.06, zf - zb), 0, THATCH));
    out.set('bld__woodshed', mergeGeometries(parts)!);
  }
  return out;
}

/** A flying chip of wood or a drop of water. */
interface Bit { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; size: number; r: number; g: number; b: number; floor: number }
/** Water deeper than this share of someone's height means swimming rather than wading. */
const SWIM_DEPTH = 0.72;
const D_STRIDE = 6;
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
function baseArm(carry: number, act: number): [number, number, number] {
  if (carry === CARRY.Spear) return act === ACT.Hunt ? [-2.35, -0.35, 0.28] : act === ACT.Fish ? [-2.2, -0.35, 0.28] : [-0.45, -0.75, 0.05];
  if (carry === CARRY.Log || carry === CARRY.Meat) return [-1.55, -1.95, 0.05];
  if (carry === CARRY.Body) return [-1.25, -1.35, 0.05];
  if (carry === CARRY.Berries || carry === CARRY.Fiber || carry === CARRY.Mud || carry === CARRY.Stone) return [-0.15, -0.55, 0.05];
  return [-0.1, -0.5, 0.05];
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
  /** the tool in hand: 0 none, 1 chopper, 2 axe */
  tool: number;
  /** where the axe swing had got to last frame; whether this stab has hit the water yet */
  swing: number; splashed: boolean;
}

export class BandLayer {
  group = new THREE.Group();
  private people = new Map<number, Shown>();
  private deer = new Map<number, { x: number; z: number; px: number; pz: number; y: number; angle: number; want: number; seen: number; state: number; fawn: boolean }>();
  private villagers: THREE.InstancedMesh;
  private deerMesh: THREE.InstancedMesh;
  private carryMeshes = new Map<number, THREE.InstancedMesh>();
  private buildingMeshes = new Map<string, THREE.InstancedMesh>();
  private flames: THREE.InstancedMesh;
  /** what lies on each stockpile (by building id), and the meshes that show it */
  private piles = new Map<number, { wood: number; berries: number; meat: number; fish: number; preserved: number }>();
  private pileMeshes = new Map<string, THREE.InstancedMesh>();
  private glow: THREE.Sprite[] = [];
  private lights: THREE.PointLight[] = [];
  private smoke: THREE.Points;
  private smokeMat: THREE.ShaderMaterial;
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

  constructor(private world: WorldData, geoms: Map<string, THREE.BufferGeometry>) {
    this.group.name = 'band';
    this.villagers = this.makeVillagers(geoms);
    this.deerMesh = this.makeDeer(geoms);
    this.group.add(this.villagers, this.deerMesh);
    // carried things
    const carryNames: [number, string][] = [
      [CARRY.Log, 'log'], [CARRY.Berries, 'berries'], [CARRY.Meat, 'meat'], [CARRY.Fish, 'fish'],
      [CARRY.Spear, 'spear'], [CARRY.Body, 'body'], [CARRY.Baby, 'baby'], [AXE, 'axe'], [CHOPPER, 'chopper'],
      // cut grass and cordage go home in a basket like berries
      [CARRY.Fiber, 'berries'], [CARRY.Mud, 'berries'], [CARRY.Stone, 'berries'],
    ];
    const carryMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    carryMat.onBeforeCompile = (sh) => addCommon(sh);
    carryMat.customProgramCacheKey = () => 'carry';
    for (const [id, name] of carryNames) {
      const g = geoms.get(`carry__${name}`) ?? (name === 'chopper' ? plank(0.045, 0.06, 0.035, 0, -0.03, 0, 0.3, 0.2, 0x8a8478) : undefined);
      if (!g) continue;
      const m = new THREE.InstancedMesh(g, carryMat, 128);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      this.carryMeshes.set(id, m);
      this.group.add(m);
    }
    // buildings
    const works = fireWorks();
    for (const kind of ['hearth', 'leanto', 'hut0', 'hut1', 'storehouse', 'rack', 'site', 'stockpile', 'windbreak', 'woodshed']) {
      const g0 = geoms.get(`bld__${kind}`) ?? works.get(`bld__${kind}`);
      if (!g0) continue;
      const g = g0.clone();
      g.computeBoundingBox();
      const m = new THREE.InstancedMesh(g, this.buildingMaterial(kind, g.boundingBox!.max.y), 64);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      const prog = new THREE.InstancedBufferAttribute(new Float32Array(64).fill(1), 1);
      g.setAttribute('iProgress', prog);
      this.buildingMeshes.set(kind, m);
      this.group.add(m);
    }
    // fire
    const flameGeo = geoms.get('bld__flame') ?? new THREE.ConeGeometry(0.08, 0.25, 5);
    // the stockpile's contents: split logs stacked at the back, baskets, meat and fish laid on the mat
    {
      const pm = new THREE.MeshLambertMaterial({ vertexColors: true });
      pm.onBeforeCompile = (sh) => addCommon(sh);
      pm.customProgramCacheKey = () => 'pile';
      for (const [key, geo] of [['log', 'pile__log'], ['basket', 'carry__berries'], ['meat', 'carry__meat'], ['fish', 'carry__fish']] as const) {
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
    }
    this.flames = new THREE.InstancedMesh(flameGeo, this.flameMaterial(), 8);
    this.flames.count = 0;
    this.flames.frustumCulled = false;
    this.flames.renderOrder = 4;
    this.group.add(this.flames);
    const glowTex = radialTexture();
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
          vDead = step(10.5, iAnim.x) * step(iAnim.x, 11.5);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vCloth;
          varying vec3 vSkin;
          varying vec3 vHair;
          varying float vDead;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec3 code = diffuseColor.rgb;
            float rest = clamp(1.0 - code.r - code.g - code.b, 0.0, 1.0);
            vec3 col = code.r * vCloth + code.g * vSkin + code.b * vHair + rest * vec3(0.12, 0.085, 0.06);
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
      ['body', 0, [0, 0.19, 0]], ['head', 1, [0, 0.21, 0.1]], ['antlers', 6, [0, 0.21, 0.1]],
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
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.customProgramCacheKey = () => 'deer';
    mat.onBeforeCompile = (sh) => {
      addCommon(sh);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aPart;
          attribute vec3 aPivot;
          attribute vec4 iAnim;
          mat3 rx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
          void deerPose(out mat3 R, out vec3 T) {
            float st = iAnim.x;
            float ph = uTime + iAnim.y;
            float a = 0.0;
            float speed = st > 1.5 ? 16.0 : 7.0;
            float amp = st > 1.5 ? 0.75 : (st > 0.5 ? 0.45 : 0.0);
            float s = sin(ph * speed);
            if (aPart > 1.5 && aPart < 5.5) {
              float sgn = (aPart < 2.5 || aPart > 4.5) ? 1.0 : -1.0;
              a = s * amp * sgn;
            } else if (aPart > 0.5) {
              // grazing: head down most of the time, up now and then to look around
              float graze = st < 0.5 ? smoothstep(-0.3, 0.3, sin(ph * 0.6)) : 0.0;
              a = graze * 1.0 + (st > 1.5 ? -0.25 : 0.0);
            }
            mat3 Rp = rx(a);
            // antlers are worn by stags only (iAnim.z)
            if (aPart > 5.5 && iAnim.z < 0.5) Rp = mat3(0.0);
            R = Rp;
            T = aPivot - Rp * aPivot;
            if (st > 1.5) {
              float bob = abs(sin(ph * speed * 0.5)) * 0.04;
              T.y += bob;
            }
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
    this.buildings = b;
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
          flash: P[o + 13], gesture: null, gestAt: 0, gestCarry: 0, carry: P[o + 6], fx: P[o + 3], fz: P[o + 4], swing: 0, splashed: false, band: P[o + 14], tool: P[o + 15] };
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
      let d = this.deer.get(id);
      if (!d) {
        d = { x: D[o + 1], z: D[o + 2], px: D[o + 1], pz: D[o + 2], y: this.groundAt(D[o + 1], D[o + 2]), angle: 0, want: 0, seen, state: 0, fawn: false };
        this.deer.set(id, d);
      } else {
        d.px = d.px + (d.x - d.px) * a;
        d.pz = d.pz + (d.z - d.pz) * a;
        d.x = D[o + 1];
        d.z = D[o + 2];
      }
      const fx = D[o + 3] - D[o + 1], fz = D[o + 4] - D[o + 2];
      if (fx * fx + fz * fz > 1e-4) d.want = Math.atan2(fx, fz);
      d.state = D[o + 5] % 10;
      d.fawn = D[o + 5] >= 10;
      d.seen = seen;
    }
    for (const [id, d] of this.deer) if (d.seen !== seen) this.deer.delete(id);
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
    const col = new THREE.Color();
    let n = 0;
    this.visible.length = 0;
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
      const swimming = wt !== null && wt.depth > SWIM_DEPTH * 0.4 * scale && s.act !== ACT.Dead;
      const stroke = swimming && walking && s.still < 0.25 && s.carry === CARRY.None;
      const gy = swimming ? wt!.surface - (stroke ? 0.168 : 0.3) * scale : this.groundAt(x, z);
      s.y += (gy - s.y) * Math.min(1, dt * (swimming ? 6 : 14));
      // the pose to show: someone 'walking' who has stopped (between path steps) stands instead
      const act = this.debugAct.get(id) ?? (swimming ? (stroke ? SWIM : TREAD) : walking && s.still > 0.25 ? ACT.Idle : s.act);
      if (swimming) this.swimmers.push({ x, z, y: wt!.surface, r: scale, moving: stroke, seed: id });
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
      const want = playing ? ringAngle : walking && moved > 0.002 * dt * 60 ? Math.atan2(x - ox, z - oz) : s.want;
      s.angle += shortest(s.angle, want) * (1 - Math.exp(-dt * (walking || playing ? 12 : 8)));
      pos.set(x, s.y, z);
      q.setFromAxisAngle(up, s.angle);
      scl.setScalar(scale);
      m4.compose(pos, q, scl);
      this.villagers.setMatrixAt(n, m4);
      const look = s.look;
      const elder = s.age >= 58 ? 1 : 0;
      const longHair = s.sex === 0 ? ((look >>> 4) % 10 < 8 ? 1 : 0) : ((look >>> 4) % 10 < 1 ? 1 : 0);
      const dead = s.act === ACT.Dead ? 1 : 0;
      const blend = Math.min(1, Math.max(0, (now - s.actAt) / 220));
      anim.setXYZW(n, s.shownAct, s.prevAct, blend, longHair + elder * 2 + dead * 4);
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
      // a fisher's catch comes home on the spear it was caught with
      const onSpear = carry === CARRY.Fish && s.task === FISH_TASK;
      if (onSpear) carry = CARRY.Spear;
      anim2.setXYZW(n, s.phase % 1, s.run, (look % 997) * 0.37, carry);
      col.set(CLOTH[(look >>> 8) % CLOTH.length]).convertSRGBToLinear();
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
        const cm = this.carryMeshes.get(carry);
        if (cm) {
          const k = carryCount.get(carry) ?? 0;
          if (k < cm.instanceMatrix.count) {
            const off = carryOffset(carry, s.act);
            // during a one-off move the item goes where the hand goes
            if (gw > 0 && s.gesture) {
              const [bs, be, bl] = baseArm(carry, s.act);
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
            carryCount.set(carry, k + 1);
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
      if (bc && s.act !== ACT.Dead) this.auraList.push({ x, y: s.y, z, r: 1.0 * Math.max(0.7, scale), c: bc.color, k: 0.6 });
      this.visible.push({ id, x, y: s.y + 0.42 * scale, z, child: s.age < 14 });
      if (id === this.selected) Object.assign(sel, { x, y: s.y, z });
      if (id === this.hovered) Object.assign(hov, { x, y: s.y, z });
    }
    this.villagers.count = n;
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
        b.vy -= 3.2 * dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        if (b.y < b.floor) { b.y = b.floor; b.vx *= 0.3; b.vz *= 0.3; b.vy = 0; }
        if (k >= this.bitMesh.instanceMatrix.count) continue;
        const sz = b.size * (1 - Math.max(0, (b.age - b.life * 0.6) / (b.life * 0.4)));
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
    this.selRing.visible = sel.y > -90;
    this.selRing.position.set(sel.x, sel.y + 0.02, sel.z);
    this.hoverRing.visible = hov.y > -90 && this.hovered !== this.selected;
    this.hoverRing.position.set(hov.x, hov.y + 0.02, hov.z);

    // deer
    const dAnim = this.deerMesh.geometry.attributes.iAnim as THREE.InstancedBufferAttribute;
    let dn = 0;
    this.visibleDeer.length = 0;
    for (const [id, d] of this.deer) {
      if (dn >= dAnim.count) break;
      const x = d.px + (d.x - d.px) * a, z = d.pz + (d.z - d.pz) * a;
      const gy = this.groundAt(x, z);
      d.y += (gy - d.y) * Math.min(1, dt * 12);
      d.angle += shortest(d.angle, d.want) * (1 - Math.exp(-dt * (d.state === 2 ? 10 : 6)));
      pos.set(x, d.y, z);
      q.setFromAxisAngle(up, d.angle);
      scl.setScalar(d.fawn ? 0.62 : 1);
      m4.compose(pos, q, scl);
      this.deerMesh.setMatrixAt(dn, m4);
      dAnim.setXYZW(dn, d.state, (id % 97) * 0.61, !d.fawn && id % 2 ? 1 : 0, 0);
      dn++;
      this.visibleDeer.push({ id, x, y: d.y + 0.2, z, fawn: d.fawn, state: d.state });
      if (this.markerAt && this.markerAt.r < 0 && -this.markerAt.r === id) this.markerAt = { x, y: d.y, z, r: -id };
    }
    this.deerMesh.count = dn;
    this.deerMesh.instanceMatrix.needsUpdate = true;
    dAnim.needsUpdate = true;

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

  private drawBuildings(night: number, camTarget: THREE.Vector3) {
    const counts = new Map<string, number>();
    const need = new Map<string, number>();
    for (const b of this.buildings) {
      const kind = b.kind === 'hut' ? (b.id % 2 ? 'hut1' : 'hut0') : b.kind;
      need.set(kind, (need.get(kind) ?? 0) + 1);
      if (!b.built) need.set('site', (need.get('site') ?? 0) + 1);
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
      // daubed walls take on the colour of dried mud, stone ones go grey
      const wt = WALL_TINT[walls];
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
    this.drawPiles();
    for (const b of this.buildings) {
      const cx = b.x + 0.5, cz = b.z + 0.5;
      const rot = (b.rot * Math.PI) / 2;
      const kind = b.kind === 'hut' ? (b.id % 2 ? 'hut1' : 'hut0') : b.kind;
      put(kind, cx, cz, rot, b.built ? 1 : Math.max(0.02, b.progress), 1, b.band, b.walls);
      const bc = this.colorMode ? this.bandColors.get(b.band) : undefined;
      if (bc) this.auraList.push({ x: cx, y: this.world.groundY[b.z * this.world.size + b.x], z: cz, r: b.kind === 'hearth' ? 3 : 2.2, c: bc.color, k: bc.gone ? 0.12 : 0.42 });
      // the band's range: a wide wash around a lived-in camp's hearth, wider the more people there are
      if (bc && b.kind === 'hearth' && !bc.gone) {
        const pop = this.bandPop.get(b.band) ?? 10;
        this.auraList.unshift({ x: cx, y: this.world.groundY[b.z * this.world.size + b.x], z: cz, r: 7 + Math.sqrt(pop) * 1.8, c: bc.color, k: 0.3, terr: true });
      }
      if (!b.built) put('site', cx + 0.28, cz + 0.3, rot + 0.6, 1, 0.8);
      if (b.kind === 'hearth' && b.fuel > 0) fires.push({ x: cx, y: this.world.groundY[b.z * this.world.size + b.x], z: cz, fuel: b.fuel });
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

  setPiles(p: { id: number; wood: number; berries: number; meat: number; fish: number; preserved: number }[]) {
    this.piles = new Map(p.map((q) => [q.id, q]));
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
      for (let i = 0; i < Math.min(5, Math.ceil(p.berries / 5)); i++) items.push('basket');
      for (let i = 0; i < Math.min(4, Math.ceil(p.meat / 6)); i++) items.push('meat');
      for (let i = 0; i < Math.min(4, Math.ceil(p.fish / 4)); i++) items.push('fish');
      for (let i = 0; i < Math.min(3, Math.ceil(p.preserved / 8)); i++) items.push('dried');
      items.slice(0, 15).forEach((it, i) => {
        const col = i % 5, row = Math.floor(i / 5);
        const x = -0.2 + col * 0.1 + (h(i + 200) - 0.5) * 0.02, z = 0.05 + row * 0.085 + (h(i + 300) - 0.5) * 0.02;
        const ry = h(i + 400) * Math.PI * 2;
        if (it === 'basket') place('basket', x, 0.045, z, 0, ry);
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


/** Where each carried item sits on the body (person-local space, facing +Z). */
function carryOffset(kind: number, act: number) {
  const m = new THREE.Matrix4();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  switch (kind) {
    case CARRY.Log: p.set(0.06, 0.3, 0); e.set(0, Math.PI / 2, 0.15); break;
    case CARRY.Berries: case CARRY.Fiber: case CARRY.Mud: case CARRY.Stone: p.set(0.075, 0.16, 0.04); break;
    case CARRY.Meat: p.set(0, 0.3, -0.03); e.set(0, Math.PI / 2, 0); break;
    case CARRY.Fish: p.set(0.078, 0.15, 0.02); e.set(0, Math.PI / 2, -1.2); break;
    case CARRY.Spear:
      // in the right hand, wherever the pose puts it (see the arm angles in POSE_GLSL)
      if (act === ACT.Hunt) { p.set(0.075, 0.37, 0.07); e.set(Math.PI / 2 - 0.25, 0, 0); } // raised to throw
      else if (act === ACT.Fish) { p.set(0.075, 0.35, 0.09); e.set(Math.PI / 2 + 0.55, 0, 0); } // poised over the water
      else { p.set(0.076, 0.16, 0.055); e.set(0.22, 0, 0); } // held low, point up
      break;
    case CARRY.Body: p.set(0, 0.215, 0.085); e.set(0, 0, 0); break; // held across the arms
    case CARRY.Baby: p.set(0, 0.23, 0.055); break;
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
        float a = smoothstep(0.5, 0.0, length(d)) * (1.0 - vLife) * smoothstep(0.0, 0.08, vLife) * 0.32;
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
struct Pose { float thL, thR, knL, knR, shL, shR, elL, elR, lean, bob, roll, head, lower, lie; };

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

Pose still() { return Pose(0.0, 0.0, 0.03, 0.03, 0.0, 0.0, -0.12, -0.12, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0); }

Pose loopPose(int g, float ph) {
  return Pose(gaitAt(g, 0, ph), gaitAt(g, 1, ph), gaitAt(g, 2, ph), gaitAt(g, 3, ph), gaitAt(g, 4, ph), gaitAt(g, 5, ph),
    gaitAt(g, 6, ph), gaitAt(g, 7, ph), gaitAt(g, 8, ph), gaitAt(g, 9, ph), gaitAt(g, 10, ph), gaitAt(g, 11, ph), gaitAt(g, 12, ph), 0.0);
}
Pose oncePose(int g, float pr) {
  return Pose(onceAt(g, 0, pr), onceAt(g, 1, pr), onceAt(g, 2, pr), onceAt(g, 3, pr), onceAt(g, 4, pr), onceAt(g, 5, pr),
    onceAt(g, 6, pr), onceAt(g, 7, pr), onceAt(g, 8, pr), onceAt(g, 9, pr), onceAt(g, 10, pr), onceAt(g, 11, pr), onceAt(g, 12, pr), 0.0);
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
  } else if (act < 5.5) {                // asleep, curled a little
    p.lie = 1.0; p.thL = p.thR = -0.45; p.knL = p.knR = 0.8; p.shL = p.shR = -0.5; p.elL = p.elR = -1.1;
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
    mix(a.lower, b.lower, k), mix(a.lie, b.lie, k));
}

mat3 rx(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rz(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
void turn(inout vec3 v, inout mat3 R, mat3 M, vec3 c) { v = M * (v - c) + c; R = M * R; }

void poseVertex(vec3 pos, out vec3 v, out mat3 R) {
  float t = uTime + iAnim2.z;
  float k = smoothstep(0.0, 1.0, iAnim.z);
  Pose p = blendPose(poseFor(iAnim.y, t, iAnim2.x, iAnim2.y), poseFor(iAnim.x, t, iAnim2.x, iAnim2.y), k);
  float style = iAnim.w;
  float hairLong = mod(style, 2.0);
  p.lean += step(1.5, mod(style, 4.0)) * 0.18;   // elders stoop
  // hands that are carrying something hold it (codes as CARRY in sim/band.ts)
  float carry = iAnim2.w;
  if (p.lie < 0.5 && carry > 0.5) {
    if (carry < 1.5 || (carry > 2.5 && carry < 3.5)) { p.shR = -1.55; p.elR = -1.95; }            // log, meat: on the right shoulder
    else if (carry > 4.5 && carry < 5.5) { p.shL = p.shR = -1.25; p.elL = p.elR = -1.35; }         // a body, in both arms
    else if (carry > 6.5 && carry < 7.5) { p.shL = p.shR = -0.75; p.elL = p.elR = -1.45; }                         // a baby, cradled
    else if (carry > 5.5 && iAnim.x < 12.5) { p.shR = -0.45; p.elR = -0.75; }                      // a spear, held low
    else if ((carry > 1.5 && carry < 2.5) || carry > 7.5) { p.shR = -0.15; p.elR = -0.55; }        // a basket of berries or grass
  }
  // a one-off move (picking up, setting down, a thrust, a stab) plays over all of that
  if (iAnim3.x > 0.5 && p.lie < 0.5) {
    float pr = iAnim3.y;
    float w = smoothstep(0.0, 0.12, pr) * (1.0 - smoothstep(0.88, 1.0, pr));
    p = blendPose(p, oncePose(int(iAnim3.x + 0.5) - 1, pr), w);
  }
  v = pos; R = mat3(1.0);
  float part = aPart;
  bool left = part > 1.5 && part < 2.5 || part > 3.5 && part < 4.5 || part > 7.5 && part < 8.5 || part > 9.5 && part < 10.5;
  bool leg = part > 3.5 && part < 5.5 || part > 9.5;
  bool arm = part > 1.5 && part < 3.5 || part > 7.5 && part < 9.5;
  bool headish = part > 0.5 && part < 1.5 || part > 5.5 && part < 7.5;
  // only one of the two hair styles is shown
  if ((part > 5.5 && part < 6.5 && hairLong > 0.5) || (part > 6.5 && part < 7.5 && hairLong < 0.5)) { v = vec3(0.0, -1.0, 0.0); R = mat3(0.0); return; }
  // lower joint first (knee, elbow), then the limb it hangs from
  if (part > 9.5) turn(v, R, rx(left ? p.knL : p.knR), aPivot2);
  else if (part > 7.5) turn(v, R, rx(left ? p.elL : p.elR), aPivot2);
  if (leg) turn(v, R, rx(left ? p.thL : p.thR), aPivot);
  if (arm) turn(v, R, rx(left ? p.shL : p.shR), aPivot);
  if (headish) turn(v, R, rx(p.head), aPivot);
  // the upper body leans and sways over the hips
  if (!leg) turn(v, R, rz(p.roll) * rx(p.lean), vec3(0.0, ${HIP_Y.toFixed(3)}, 0.0));
  v.y += p.bob - p.lower;
  // lying down: on the back, face to the sky, centred where they stood
  if (p.lie > 0.001) { turn(v, R, rx(-p.lie * 1.5708), vec3(0.0)); v += vec3(0.0, p.lie * 0.036, p.lie * 0.18); }
}
`;
