// Instanced nature props (Blender assets) with chunk culling, tree LOD,
// wind sway and seasonal behaviour in the vertex/fragment shaders.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PROP_NAMES, SPECIES, STAGES, TREE_VARIANTS } from '../sim/types';
import { addCommon } from './shaderlib';
import { CHUNK } from './terrain';

type Role = 'trunk' | 'pineLeaf' | 'oakLeaf' | 'birchLeaf' | 'bush' | 'berry' | 'grass' | 'rock';

/**
 * Trees being chopped shudder with each blow: up to four at once, as (x, z, strength, direction
 * the blow pushes it). The band layer sets these; the tree shaders read them.
 */
export const SHAKE = { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) };

export async function loadAssetGeometries(glb: ArrayBuffer): Promise<Map<string, THREE.BufferGeometry>> {
  const gltf = await new GLTFLoader().parseAsync(glb, '');
  const map = new Map<string, THREE.BufferGeometry>();
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    // canopy centre lets the shader shrink leaves toward it (bare winter trees)
    g.computeBoundingBox();
    const c = new THREE.Vector3();
    g.boundingBox!.getCenter(c);
    const n = g.attributes.position.count;
    const centers = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) centers.set([c.x, c.y, c.z], k * 3);
    g.setAttribute('aCenter', new THREE.BufferAttribute(centers, 3));
    map.set(m.name || o.name, g);
  });
  return map;
}

function makeMaterial(role: Role): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    side: role === 'grass' ? THREE.DoubleSide : THREE.FrontSide,
  });
  // each role injects different shader code from the same function, so give three a distinct cache key
  mat.customProgramCacheKey = () => `prop-${role}`;
  const leafy = role === 'oakLeaf' || role === 'birchLeaf';
  const autumn = role === 'oakLeaf' ? 'vec3(0.62, 0.2, 0.035)' : 'vec3(0.78, 0.5, 0.04)';
  mat.onBeforeCompile = (shader) => {
    addCommon(shader);
    shader.uniforms.uShake = SHAKE;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute vec3 aCenter;
         attribute float aFruit;
         uniform vec4 uShake[4];
         varying float vUp;
         varying float vHash;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec3 ip = vec3(0.0);
         #ifdef USE_INSTANCING
           ip = instanceMatrix[3].xyz;
         #endif
         vHash = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
         ${leafy ? `
           // leaves come and go with the seasons, each tree on its own schedule
           float leaf = clamp(uLeaf * 1.25 - vHash * 0.25, 0.0, 1.0);
           transformed = mix(aCenter, transformed, leaf);` : ''}
         ${role === 'berry' ? 'transformed *= clamp(aFruit, 0.0, 1.0);' : ''}
         ${role === 'trunk' || leafy || role === 'pineLeaf' ? `
           // a shudder from the axe, strongest at the top
           for (int i = 0; i < 4; i++) {
             vec4 sk = uShake[i];
             if (sk.z > 0.001 && distance(ip.xz, sk.xy) < 0.06) {
               float wob = sk.z * sin(uTime * 34.0) * max(position.y, 0.0) * 0.07;
               transformed.x += cos(sk.w) * wob;
               transformed.z += sin(sk.w) * wob;
             }
           }` : ''}
         ${role !== 'rock' ? `
           // wind sway grows with height above the ground
           float hgt = max(position.y, 0.0);
           float sway = ${role === 'grass' ? '0.06' : role === 'bush' ? '0.02' : '0.022'} * (0.6 + uWind) * hgt * hgt;
           transformed.x += sin(uTime * 1.6 + ip.x * 0.7 + ip.z * 0.3) * sway;
           transformed.z += cos(uTime * 1.2 + ip.z * 0.6) * sway * 0.6;` : ''}
         `,
      )
      .replace(
        '#include <defaultnormal_vertex>',
        `#include <defaultnormal_vertex>
         {
           vec3 wn = objectNormal;
           #ifdef USE_INSTANCING
             wn = mat3(instanceMatrix) * wn;
           #endif
           vUp = normalize(mat3(modelMatrix) * wn).y;
         }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vUp;\nvarying float vHash;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         {
           vec3 col = diffuseColor.rgb;
           ${leafy ? `
             col = mix(col, col * vec3(1.18, 1.25, 0.8), uSpring * 0.8);
             float aut = clamp(uAutumn * 1.3 - vHash * 0.3, 0.0, 1.0);
             col = mix(col, ${autumn} * (0.85 + 0.3 * vHash), aut);` : ''}
           ${role === 'pineLeaf' ? 'col *= mix(vec3(1.0), vec3(0.9, 0.95, 0.95), uSnow);' : ''}
           ${role === 'bush' || role === 'grass' ? `
             col *= uVegTint;
             col = mix(col, col * vec3(1.0, 0.85, 0.6), uAutumn * 0.6);` : ''}
           // snow settles on upward faces in winter
           ${role === 'grass' ? 'col = mix(col, vec3(0.85, 0.87, 0.85), uSnow * 0.6);' : `
             float snowK = smoothstep(0.35, 0.8, vUp) * uSnow * ${role === 'trunk' ? '0.3' : '0.85'};
             col = mix(col, vec3(0.93, 0.95, 0.98), snowK);`}
           diffuseColor.rgb = col;
         }`,
      );
  };
  return mat;
}

/** The simulation's live props (trees, bushes, stumps, logs, graves...). */
export interface PropState {
  count: number;
  type: Uint16Array;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  rot: Float32Array;
  scale: Float32Array;
  alive: Uint8Array;
  val: Float32Array;
}

interface Bucket {
  meshes: THREE.InstancedMesh[];
  types: number[]; // prop types gathered in this bucket
  src: Float32Array; // matrices sorted by chunk
  fruitSrc: Float32Array;
  chunkStart: Int32Array; // per chunk: first instance (length chunks+1)
  attr: THREE.InstancedBufferAttribute;
  fruit: THREE.InstancedBufferAttribute;
  lod: 'hi' | 'lo' | 'any';
  small: boolean; // hidden when zoomed far out
  tri: number;
}

const BERRY0 = PROP_NAMES.indexOf('berry_v0');

export class PropLayer {
  group = new THREE.Group();
  private buckets: Bucket[] = [];
  private chunksX: number;
  private lastKey = '';
  private view = { x0: 0, z0: 0, x1: 0, z1: 0, detail: 'hi' as 'hi' | 'lo', small: true };
  visibleInstances = 0;

  constructor(private N: number, geoms: Map<string, THREE.BufferGeometry>) {
    this.group.name = 'props';
    this.chunksX = Math.ceil(N / CHUNK);
    this.geoms = geoms;
    const mats = this.mats;
    const mat = (r: Role) => {
      if (!mats.has(r)) mats.set(r, makeMaterial(r));
      return mats.get(r)!;
    };
    const roleOf = (part: string, base: string): Role => {
      if (part.includes('trunk')) return 'trunk';
      if (base === 'pine') return 'pineLeaf';
      if (base === 'oak') return 'oakLeaf';
      if (base === 'birch') return 'birchLeaf';
      if (base === 'berry') return part === 'berry' ? 'berry' : 'bush';
      if (base === 'grass' || base === 'reeds') return 'grass';
      if (base === 'bush') return 'bush';
      return 'rock';
    };
    const makeBucket = (types: number[], parts: [string, Role][], lod: Bucket['lod'], small: boolean) => {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(16 * 16), 16);
      attr.setUsage(THREE.DynamicDrawUsage);
      const fruit = new THREE.InstancedBufferAttribute(new Float32Array(16), 1);
      fruit.setUsage(THREE.DynamicDrawUsage);
      const meshes: THREE.InstancedMesh[] = [];
      let tri = 0;
      for (const [geoName, role] of parts) {
        const g0 = geoms.get(geoName);
        if (!g0) continue;
        const g = g0.clone();
        g.setAttribute('aFruit', fruit);
        const mesh = new THREE.InstancedMesh(g, mat(role), 16);
        mesh.instanceMatrix = attr;
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = role !== 'grass';
        mesh.receiveShadow = true;
        meshes.push(mesh);
        this.group.add(mesh);
        tri += (g.index ? g.index.count : g.attributes.position.count) / 3;
      }
      this.buckets.push({
        meshes, types, src: new Float32Array(0), fruitSrc: new Float32Array(0), chunkStart: new Int32Array(this.chunksX * this.chunksX + 1),
        attr, fruit, lod, small, tri,
      });
    };
    PROP_NAMES.forEach((name, id) => {
      const base = name.split('_')[0];
      const isTree = (SPECIES as readonly string[]).includes(base);
      const parts: [string, Role][] = isTree
        ? [[`${name}__trunk`, 'trunk'], [`${name}__leaf`, roleOf('leaf', base)]]
        : base === 'berry'
          ? [[`${name}__leaf`, 'bush'], [`${name}__berry`, 'berry']]
          : [[`${name}__main`, roleOf('main', base)]];
      makeBucket([id], parts, isTree ? 'hi' : 'any', base === 'grass' || base === 'reeds' || base === 'berry' || base === 'bush');
    });
    // low-detail trees: one bucket per species x stage, all variants together
    SPECIES.forEach((sp, si) => {
      for (let st = 0; st < STAGES; st++) {
        const types: number[] = [];
        for (let v2 = 0; v2 < TREE_VARIANTS; v2++) types.push(si * STAGES * TREE_VARIANTS + st * TREE_VARIANTS + v2);
        makeBucket(types, [[`${sp}_s${st}__lo_trunk`, 'trunk'], [`${sp}_s${st}__lo_leaf`, roleOf('leaf', sp)]], 'lo', false);
      }
    });
  }

  /** Where whoever felled a tree at (x, z) is standing, so it can fall away from them. */
  cutterAt: (x: number, z: number) => { x: number; z: number } | null = () => null;
  /** Felled trees topple only at speeds where anyone could watch them do it. */
  animateFalls = true;
  private geoms: Map<string, THREE.BufferGeometry>;
  private mats = new Map<Role, THREE.MeshLambertMaterial>();
  private prevAlive: Uint8Array | null = null;
  private prevType: Uint16Array | null = null;
  private falling: { obj: THREE.Group; axis: THREE.Vector3; at: number; base: THREE.Quaternion; y: number }[] = [];

  /** A tree that has just been cut through: it tips, falls faster and faster, bounces, lies a moment, and goes. */
  private fell(st: { type: Uint16Array; x: Float32Array; y: Float32Array; z: Float32Array; rot: Float32Array; scale: Float32Array }, k: number, now: number) {
    const name = PROP_NAMES[st.type[k]];
    const sp = name.split('_')[0];
    const g = new THREE.Group();
    for (const [part, role] of [['trunk', 'trunk'], ['leaf', sp === 'pine' ? 'pineLeaf' : sp === 'oak' ? 'oakLeaf' : 'birchLeaf']] as const) {
      const geo = this.geoms.get(`${name}__${part}`);
      if (!geo) continue;
      const m = new THREE.Mesh(geo, this.mats.get(role) ?? makeMaterial(role));
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    const x = st.x[k], z = st.z[k];
    const cut = this.cutterAt(x, z);
    // away from the cutter (or any way, if no one is there)
    let dx = cut ? x - cut.x : Math.cos(k * 2.399), dz = cut ? z - cut.z : Math.sin(k * 2.399);
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    const base = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), st.rot[k]);
    g.position.set(x, st.y[k], z);
    g.quaternion.copy(base);
    g.scale.setScalar(st.scale[k]);
    this.group.add(g);
    this.falling.push({ obj: g, axis: new THREE.Vector3(dz, 0, -dx), at: now, base, y: st.y[k] });
  }

  /** Per frame: move falling trees along. */
  animate(now: number) {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      const t = (now - f.at) / 1000;
      // gravity: slow at first, then all at once; a small bounce; lie there; sink away
      let a: number;
      if (t < 1.05) a = (Math.PI / 2 - 0.06) * Math.pow(t / 1.05, 2.2);
      else a = Math.PI / 2 - 0.06 - Math.max(0, Math.sin((t - 1.05) * 9) * Math.exp(-(t - 1.05) * 6) * 0.09);
      const tip = new THREE.Quaternion().setFromAxisAngle(f.axis, a);
      f.obj.quaternion.copy(tip).multiply(f.base);
      f.obj.position.y = f.y - Math.max(0, t - 2.6) * 0.25;
      if (t > 3.4) {
        this.group.remove(f.obj);
        this.falling.splice(i, 1);
      }
    }
  }

  /** Rebuild every bucket from the simulation's current props. */
  setProps(st: PropState) {
    // trees that were standing last time and are gone now were felled: show them falling
    if (this.prevAlive && this.prevType && this.animateFalls) {
      const now = performance.now();
      const n = Math.min(this.prevAlive.length, st.count);
      let fallen = 0;
      for (let k = 0; k < n && fallen < 6; k++) {
        if (this.prevAlive[k] && !st.alive[k] && this.prevType[k] < SPECIES.length * STAGES * TREE_VARIANTS && this.prevType[k] === st.type[k]) {
          this.fell(st, k, now);
          fallen++;
        }
      }
    }
    this.prevAlive = st.alive.slice();
    this.prevType = st.type.slice();
    const N = this.N;
    const nChunks = this.chunksX * this.chunksX;
    const byType: number[][] = PROP_NAMES.map(() => []);
    for (let k = 0; k < st.count; k++) if (st.alive[k]) byType[st.type[k]]?.push(k);
    const chunkOf = (k: number) => {
      const x = Math.min(N - 1, Math.max(0, Math.floor(st.x[k])));
      const z = Math.min(N - 1, Math.max(0, Math.floor(st.z[k])));
      return Math.floor(z / CHUNK) * this.chunksX + Math.floor(x / CHUNK);
    };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc3 = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const b of this.buckets) {
      const inst: number[] = [];
      for (const t of b.types) inst.push(...byType[t]);
      const chunk = inst.map(chunkOf);
      const order = inst.map((_, i) => i).sort((a, c) => chunk[a] - chunk[c] || inst[a] - inst[c]);
      const n = inst.length;
      if (b.src.length < n * 16) {
        b.src = new Float32Array(n * 16);
        b.fruitSrc = new Float32Array(n);
      }
      let ci = 0;
      order.forEach((oi, idx) => {
        const k = inst[oi];
        const c = chunk[oi];
        while (ci <= c) b.chunkStart[ci++] = idx;
        v.set(st.x[k], st.y[k], st.z[k]);
        q.setFromAxisAngle(up, st.rot[k]);
        const s = st.scale[k];
        sc3.set(s, s, s);
        m4.compose(v, q, sc3);
        m4.toArray(b.src, idx * 16);
        b.fruitSrc[idx] = st.type[k] >= BERRY0 && st.type[k] < BERRY0 + 3 ? Math.min(1, st.val[k] / 3) : 1;
      });
      while (ci <= nChunks) b.chunkStart[ci++] = n;
      if (b.attr.count < n) {
        const cap = Math.ceil(n * 1.3) + 8;
        b.attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
        b.attr.setUsage(THREE.DynamicDrawUsage);
        b.fruit = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
        b.fruit.setUsage(THREE.DynamicDrawUsage);
        for (const m of b.meshes) {
          m.instanceMatrix = b.attr;
          m.geometry.setAttribute('aFruit', b.fruit);
          (m as unknown as { count: number }).count = 0;
        }
      }
    }
    this.lastKey = '';
    const vw = this.view;
    this.update(vw.x0, vw.z0, vw.x1, vw.z1, vw.detail, vw.small);
  }

  private shadows = true;
  setShadows(on: boolean) {
    if (on === this.shadows) return;
    this.shadows = on;
    for (const b of this.buckets) for (const m of b.meshes) m.castShadow = on && !(m.material as THREE.Material).side;
  }

  /**
   * Show instances in the chunks overlapping [x0,x1]x[z0,z1] (tile coords).
   * @param detail 'hi' near the camera, 'lo' when zoomed out; small props only when close.
   */
  update(x0: number, z0: number, x1: number, z1: number, detail: 'hi' | 'lo', showSmall: boolean) {
    this.view = { x0, z0, x1, z1, detail, small: showSmall };
    const cx0 = Math.max(0, Math.floor(x0 / CHUNK)), cz0 = Math.max(0, Math.floor(z0 / CHUNK));
    const cx1 = Math.min(this.chunksX - 1, Math.floor(x1 / CHUNK)), cz1 = Math.min(this.chunksX - 1, Math.floor(z1 / CHUNK));
    const key = `${cx0},${cz0},${cx1},${cz1},${detail},${showSmall}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    let total = 0;
    for (const b of this.buckets) {
      const on = (b.lod === 'any' || b.lod === detail) && (!b.small || showSmall);
      let count = 0;
      if (on) {
        const dst = b.attr.array as Float32Array;
        const fd = b.fruit.array as Float32Array;
        for (let cz = cz0; cz <= cz1; cz++) {
          // chunks in a row are contiguous in sorted order
          const a = b.chunkStart[cz * this.chunksX + cx0];
          const e = b.chunkStart[cz * this.chunksX + cx1 + 1];
          if (e > a) {
            dst.set(b.src.subarray(a * 16, e * 16), count * 16);
            fd.set(b.fruitSrc.subarray(a, e), count);
            count += e - a;
          }
        }
        b.attr.clearUpdateRanges();
        b.attr.addUpdateRange(0, count * 16);
        b.attr.needsUpdate = true;
        b.fruit.clearUpdateRanges();
        b.fruit.addUpdateRange(0, count);
        b.fruit.needsUpdate = true;
      }
      for (const m of b.meshes) {
        m.count = count;
        m.visible = count > 0;
      }
      total += count;
    }
    this.visibleInstances = total;
  }
}
