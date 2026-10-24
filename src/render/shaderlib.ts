// Shader snippets and helpers shared by the scene's materials.
import * as THREE from 'three';
import { U } from './env';

/** A tileable value-noise texture (RGB = three independent channels), generated once. */
export function makeNoiseTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const lattice = (seed: number, cells: number) => {
    const g = new Float32Array(cells * cells);
    let s = seed;
    for (let i = 0; i < g.length; i++) {
      s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
      g[i] = (s >>> 8) / 16777216;
    }
    return g;
  };
  const sample = (g: Float32Array, cells: number, u: number, v: number) => {
    const x = u * cells, y = v * cells;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (i: number, j: number) => g[((j + cells) % cells) * cells + ((i + cells) % cells)];
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const octs = [8, 16, 32, 64];
  const grids = [0, 1, 2].map((ch) => octs.map((cells, k) => lattice(1234 + ch * 97 + k * 13, cells)));
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0, amp = 1, norm = 0;
        for (let k = 0; k < octs.length; k++) {
          sum += sample(grids[ch][k], octs[k], u, v) * amp;
          norm += amp;
          amp *= 0.5;
        }
        data[(y * size + x) * 4 + ch] = Math.round((sum / norm) * 255);
      }
      data[(y * size + x) * 4 + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** GLSL: drifting cloud shadow factor (1 = clear). Needs uNoise, uTime, uCloud. */
export const CLOUD_GLSL = /* glsl */ `
float cloudShade(vec3 wp) {
  vec2 p = wp.xz * 0.012 + vec2(uTime * 0.0035, uTime * 0.0021);
  float n = texture2D(uNoise, p).r * 0.65 + texture2D(uNoise, p * 2.3 + 0.37).g * 0.35;
  float c = smoothstep(0.62 - uCloud * 0.2, 0.78 - uCloud * 0.2, n);
  return 1.0 - c * 0.32 * (0.4 + uCloud * 0.6);
}
`;

type Shader = THREE.WebGLProgramParametersWithUniforms;

/** Adds world position varying + shared uniforms to a built-in material's shader. */
export function addCommon(shader: Shader, extra: Record<string, THREE.IUniform> = {}) {
  Object.assign(shader.uniforms, U, extra);
  const decls = Object.keys({ ...U, ...extra })
    .map((k) => {
      const v = (U as Record<string, THREE.IUniform>)[k] ?? extra[k];
      const val = v.value;
      const type =
        val instanceof THREE.Vector3 || val instanceof THREE.Color ? 'vec3'
          : val instanceof THREE.Vector2 ? 'vec2'
          : val === null || val instanceof THREE.Texture ? 'sampler2D'
          : 'float';
      return `uniform ${type} ${k};`;
    })
    .join('\n');
  shader.vertexShader = `${decls}\nvarying vec3 vWorld;\n` + shader.vertexShader;
  shader.fragmentShader = `${decls}\nvarying vec3 vWorld;\n${CLOUD_GLSL}\n` + shader.fragmentShader;
  shader.vertexShader = shader.vertexShader.replace(
    '#include <worldpos_vertex>',
    `#include <worldpos_vertex>
     {
       vec4 wp4 = vec4(transformed, 1.0);
       #ifdef USE_INSTANCING
         wp4 = instanceMatrix * wp4;
       #endif
       vWorld = (modelMatrix * wp4).xyz;
     }`,
  );
  // cloud shadows dim everything a little, direct light most
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <opaque_fragment>',
    `outgoingLight *= cloudShade(vWorld);
     // colours drain toward blue-grey under moonlight
     float lum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
     outgoingLight = mix(outgoingLight, lum * vec3(0.72, 0.84, 1.15), uNight * 0.55);
     #include <opaque_fragment>`,
  );
}
