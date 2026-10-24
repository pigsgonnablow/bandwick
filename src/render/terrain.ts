// Terrain diorama: stepped terrace tops (painted texture) + cliff faces with strata.
import * as THREE from 'three';
import { WorldData, T, WATER, STEP, BASE_Y, DIRS4, SNOW_LEVEL } from '../sim/types';
import { addCommon } from './shaderlib';

export const CHUNK = 32;

// cliff colours (sRGB)
const SOIL = new THREE.Color('#a8825c');
const SOIL_DARK = new THREE.Color('#8f6c4b');
const ROCK = new THREE.Color('#a09686');
const ROCK_DARK = new THREE.Color('#857c6f');
const SAND_SIDE = new THREE.Color('#d6bd8a');
const GRASS_LIP = new THREE.Color('#6f9a45');
const FOREST_LIP = new THREE.Color('#557a3a');
const SNOW_LIP = new THREE.Color('#e8edf2');
const SEABED_SIDE = new THREE.Color('#8f846c');
const BASE_DARK = new THREE.Color('#3a2e24');

export function createTerrainMaterials(world: WorldData) {
  const S = world.texSize;
  const colorTex = new THREE.DataTexture(world.colorTex, S, S, THREE.RGBAFormat);
  colorTex.colorSpace = THREE.SRGBColorSpace;
  colorTex.magFilter = THREE.LinearFilter;
  colorTex.minFilter = THREE.LinearMipmapLinearFilter;
  colorTex.generateMipmaps = true;
  colorTex.anisotropy = 4;
  colorTex.needsUpdate = true;
  const maskTex = new THREE.DataTexture(world.maskTex, S, S, THREE.RGBAFormat);
  maskTex.magFilter = THREE.LinearFilter;
  maskTex.minFilter = THREE.LinearFilter;
  maskTex.needsUpdate = true;

  const top = new THREE.MeshLambertMaterial({ map: colorTex });
  top.customProgramCacheKey = () => 'terrain-top';
  top.onBeforeCompile = (shader) => {
    addCommon(shader, { uMask: { value: maskTex }, uMapSize: { value: world.size } });
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      {
        vec4 m = texture2D(uMask, vMapUv);
        vec3 col = diffuseColor.rgb;
        float veg = m.r;
        col = mix(col, col * uVegTint, veg);
        // fine ground grain
        float g = texture2D(uNoise, vWorld.xz * 0.9).b;
        float g2 = texture2D(uNoise, vWorld.xz * 2.7 + 0.5).r;
        // bare rock gets coarser grain and darker seams than turf
        float rocky = 1.0 - smoothstep(0.2, 0.6, veg);
        col *= mix(0.9 + 0.2 * g, 0.78 + 0.22 * g + 0.14 * smoothstep(0.45, 0.7, g2), rocky);
        // spring flowers
        float pick = texture2D(uNoise, vWorld.xz * 3.1).r;
        vec3 flower = pick > 0.55 ? vec3(0.95, 0.85, 0.25) : (pick > 0.45 ? vec3(0.95, 0.95, 0.92) : vec3(0.85, 0.45, 0.62));
        col = mix(col, flower, m.b * uBloom * 0.7);
        // snow: threshold in the mask, permanent where it is zero
        float th = m.g;
        float s = smoothstep(th - 0.04, th + 0.04, uSnow) * step(0.001, uSnow);
        float drift = texture2D(uNoise, vWorld.xz * 0.35).g;
        s *= smoothstep(0.15, 0.35, drift + uSnow * 0.6);
        if (th < 0.004) s = 1.0;
        col = mix(col, vec3(0.92, 0.94, 0.97), s);
        diffuseColor.rgb = col;
      }`,
    );
  };
  const side = new THREE.MeshLambertMaterial({ vertexColors: true });
  side.onBeforeCompile = (shader) => addCommon(shader);
  side.customProgramCacheKey = () => 'terrain-side';
  return { top, side, colorTex, maskTex };
}

/** Builds one mesh pair (tops + sides) per 32x32 chunk. */
export function buildTerrain(world: WorldData, mats: { top: THREE.Material; side: THREE.Material }) {
  const N = world.size;
  const group = new THREE.Group();
  group.name = 'terrain';
  const top = (x: number, z: number) => world.groundY[z * N + x];
  let tris = 0;

  for (let cz = 0; cz < N; cz += CHUNK) {
    for (let cx = 0; cx < N; cx += CHUNK) {
      const tp: number[] = [], tn: number[] = [], tu: number[] = [];
      const sp: number[] = [], sn: number[] = [], sc: number[] = [];
      const x1 = Math.min(N, cx + CHUNK), z1 = Math.min(N, cz + CHUNK);
      for (let z = cz; z < z1; z++) {
        for (let x = cx; x < x1; x++) {
          const i = z * N + x;
          const y = top(x, z);
          // top quad (two triangles, CCW seen from above)
          tp.push(x, y, z, x, y, z + 1, x + 1, y, z + 1, x, y, z, x + 1, y, z + 1, x + 1, y, z);
          for (let k = 0; k < 6; k++) tn.push(0, 1, 0);
          tu.push(x / N, z / N, x / N, (z + 1) / N, (x + 1) / N, (z + 1) / N,
            x / N, z / N, (x + 1) / N, (z + 1) / N, (x + 1) / N, z / N);
          // sides facing lower neighbours or the map edge
          for (let s = 0; s < 4; s++) {
            const nx = x + DIRS4[s][0], nz = z + DIRS4[s][1];
            const outside = nx < 0 || nz < 0 || nx >= N || nz >= N;
            const bottom = outside ? BASE_Y : top(nx, nz);
            if (bottom >= y - 1e-4) continue;
            sideFace(sp, sn, sc, x, z, s, y, bottom, world, i, outside);
          }
        }
      }
      tris += tp.length / 9 + sp.length / 9;
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
      tg.setAttribute('normal', new THREE.Float32BufferAttribute(tn, 3));
      tg.setAttribute('uv', new THREE.Float32BufferAttribute(tu, 2));
      tg.computeBoundingSphere();
      const tm = new THREE.Mesh(tg, mats.top);
      tm.receiveShadow = true;
      tm.castShadow = true;
      group.add(tm);
      if (sp.length) {
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
        sg.setAttribute('normal', new THREE.Float32BufferAttribute(sn, 3));
        sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
        sg.computeBoundingSphere();
        const sm = new THREE.Mesh(sg, mats.side);
        sm.receiveShadow = true;
        sm.castShadow = true;
        group.add(sm);
      }
    }
  }
  return { group, tris };
}

const tmpC = new THREE.Color();
function sideFace(
  P: number[], Nn: number[], C: number[], x: number, z: number, s: number,
  yTop: number, yBot: number, world: WorldData, i: number, outside: boolean,
) {
  // edge endpoints, ordered so the face points outward (CCW from outside)
  let ax: number, az: number, bx: number, bz: number;
  if (s === 0) { ax = x; az = z; bx = x + 1; bz = z; } // north (-z)
  else if (s === 1) { ax = x + 1; az = z; bx = x + 1; bz = z + 1; } // east (+x)
  else if (s === 2) { ax = x + 1; az = z + 1; bx = x; bz = z + 1; } // south (+z)
  else { ax = x; az = z + 1; bx = x; bz = z; } // west (-x)
  const nx = DIRS4[s][0], nz = DIRS4[s][1];
  const t = world.terrain[i];
  const wet = world.water[i] !== WATER.None;
  const snowy = world.level[i] >= SNOW_LEVEL;
  // split into bands at each terrace level so strata read as layers
  const cuts: number[] = [yTop];
  let lip = Math.min(0.1, (yTop - yBot) * 0.4);
  if (wet) lip = 0;
  if (lip > 0) cuts.push(yTop - lip);
  let k = Math.floor((yTop - lip - 1e-4) / STEP);
  while (k * STEP > yBot + 1e-4) {
    cuts.push(k * STEP);
    k--;
  }
  cuts.push(yBot);
  const rocky = t === T.Stone || t === T.Mountain;
  for (let b = 0; b < cuts.length - 1; b++) {
    const y0 = cuts[b], y1 = cuts[b + 1];
    if (y0 - y1 < 1e-4) continue;
    // colour of this band
    if (b === 0 && lip > 0) {
      tmpC.copy(snowy ? SNOW_LIP : t === T.Forest ? FOREST_LIP : t === T.Grass ? GRASS_LIP : t === T.Sand ? SAND_SIDE : ROCK);
    } else if (wet) {
      tmpC.copy(SEABED_SIDE);
    } else {
      const band = Math.floor(y1 / STEP + 100) % 3;
      if (t === T.Sand) tmpC.copy(SAND_SIDE);
      else if (rocky || y1 > 9 * STEP) tmpC.copy(band === 1 ? ROCK_DARK : ROCK).lerp(ROCK_DARK, band === 2 ? 0.3 : 0);
      else tmpC.copy(band === 1 ? SOIL_DARK : SOIL).lerp(SOIL_DARK, band === 2 ? 0.35 : 0);
      if (y1 < 4 * STEP) tmpC.lerp(SOIL_DARK, 0.25);
    }
    if (outside && y1 < 0) tmpC.lerp(BASE_DARK, Math.min(1, -y1 / 1.6) * 0.8);
    const lin0 = tmpC.clone().convertSRGBToLinear();
    // darker at the foot of a cliff (ambient occlusion)
    const footK = b === cuts.length - 2 && !outside ? 0.8 : 1;
    const lin1 = lin0.clone().multiplyScalar(footK);
    P.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
    for (let q = 0; q < 6; q++) Nn.push(nx, 0, nz);
    C.push(lin0.r, lin0.g, lin0.b, lin0.r, lin0.g, lin0.b, lin1.r, lin1.g, lin1.b,
      lin0.r, lin0.g, lin0.b, lin1.r, lin1.g, lin1.b, lin1.r, lin1.g, lin1.b);
  }
}
