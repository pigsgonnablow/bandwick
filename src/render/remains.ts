// What is left of the unburied dead, past the first days: a rotting body, a skeleton, scattered bones.
// (Fresh, a dead villager is still drawn as the villager, lying on its back; see REMAINS in the sim.)
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REMAINS } from '../sim/band';
import { addCommon } from './shaderlib';

/** Each stage's model: Blender parts, and whether each carries real colours or the villager's region codes. */
const MODELS: [number, [string, boolean][]][] = [
  [REMAINS.Rotting, [['corpse__rot', false], ['corpse__rotBare', true]]],
  [REMAINS.Bones, [['corpse__bones', true], ['corpse__bonesRags', false]]],
  [REMAINS.Scattered, [['corpse__scatter', true]]],
];

export class RemainsLayer {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.InstancedMesh>();
  private counts = new Map<number, number>();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private at = new THREE.Vector3();
  private size = new THREE.Vector3();

  constructor(geoms: Map<string, THREE.BufferGeometry>) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    mat.customProgramCacheKey = () => 'remains';
    mat.onBeforeCompile = (sh) => {
      addCommon(sh);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aReal;
          attribute vec4 iCloth;
          varying float vReal;
          varying vec4 vCloth;
          varying vec3 vSpot;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vReal = aReal; vCloth = iCloth; vSpot = position;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vReal;
          varying vec4 vCloth;
          varying vec3 vSpot;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec3 code = diffuseColor.rgb;
            float k = vCloth.a;
            // rotting flesh: mottled grey-green and purple-brown, darker and drier as it goes
            float n = fract(sin(dot(floor(vSpot * 160.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            vec3 flesh = mix(vec3(0.13, 0.14, 0.075), vec3(0.10, 0.055, 0.055), n);
            flesh = mix(flesh, vec3(0.06, 0.045, 0.03), k * 0.7);
            // the clothes faded and soiled
            vec3 cloth = mix(vCloth.rgb, vec3(dot(vCloth.rgb, vec3(0.3, 0.5, 0.2))) * vec3(0.8, 0.72, 0.6), 0.5) * 0.8;
            float rest = clamp(1.0 - code.r - code.g - code.b, 0.0, 1.0);
            vec3 col = code.r * cloth + code.g * flesh + code.b * vec3(0.035, 0.025, 0.02) + rest * vec3(0.09, 0.065, 0.045);
            col = mix(col, code, vReal);
            col *= mix(vec3(1.0), vec3(0.92, 0.95, 1.0), uSnow * 0.2);
            diffuseColor.rgb = col;
          }`);
    };
    for (const [stage, parts] of MODELS) {
      const list: THREE.BufferGeometry[] = [];
      for (const [name, real] of parts) {
        const g0 = geoms.get(name);
        if (!g0) continue;
        const g = g0.index ? g0.toNonIndexed() : g0.clone();
        for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(a)) g.deleteAttribute(a);
        g.setAttribute('aReal', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(real ? 1 : 0), 1));
        list.push(g);
      }
      if (!list.length) continue;
      const geo = mergeGeometries(list)!;
      const cap = 64;
      geo.setAttribute('iCloth', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = stage === REMAINS.Rotting;
      m.receiveShadow = true;
      this.meshes.set(stage, m);
      this.group.add(m);
    }
  }

  begin() {
    this.counts.clear();
  }

  /**
   * One body. `shown` is the stage plus how far it has got toward the next (REMAINS.Rotting + 0.4: rotting,
   * part way to the bones); `cloth` the colour they wore (linear).
   */
  add(shown: number, x: number, y: number, z: number, angle: number, scale: number, cloth: THREE.Color) {
    const stage = Math.floor(shown), k = shown - stage;
    let m = this.meshes.get(stage);
    if (!m) return;
    const n = this.counts.get(stage) ?? 0;
    if (n >= m.instanceMatrix.count) m = this.grow(stage, m);
    // a body swells for the first while, then falls in on itself
    const swell = stage === REMAINS.Rotting ? (k < 0.3 ? k / 0.3 : Math.max(0, 1 - (k - 0.3) / 0.4)) : 0;
    const sink = stage === REMAINS.Rotting ? Math.max(0, (k - 0.3) / 0.7) : 0;
    this.q.setFromAxisAngle(this.up, angle);
    this.size.set(scale * (1 + 0.1 * swell), scale * (1 + 0.3 * swell - 0.3 * sink), scale * (1 + 0.03 * swell));
    m.setMatrixAt(n, this.m4.compose(this.at.set(x, y, z), this.q, this.size));
    (m.geometry.attributes.iCloth as THREE.InstancedBufferAttribute).setXYZW(n, cloth.r, cloth.g, cloth.b, k);
    this.counts.set(stage, n + 1);
  }

  end() {
    for (const [stage, m] of this.meshes) {
      m.count = this.counts.get(stage) ?? 0;
      m.instanceMatrix.needsUpdate = true;
      m.geometry.attributes.iCloth.needsUpdate = true;
    }
  }

  private grow(stage: number, m: THREE.InstancedMesh) {
    const next = m.instanceMatrix.count * 2;
    const g = m.geometry;
    const old = g.attributes.iCloth as THREE.InstancedBufferAttribute;
    const arr = new Float32Array(next * 4);
    arr.set(old.array as Float32Array);
    g.setAttribute('iCloth', new THREE.InstancedBufferAttribute(arr, 4));
    const nm = new THREE.InstancedMesh(g, m.material, next);
    for (let i = 0; i < m.instanceMatrix.count; i++) { m.getMatrixAt(i, this.m4); nm.setMatrixAt(i, this.m4); }
    nm.count = 0;
    nm.frustumCulled = false;
    nm.castShadow = m.castShadow;
    nm.receiveShadow = true;
    this.group.remove(m);
    this.group.add(nm);
    this.meshes.set(stage, nm);
    return nm;
  }
}
