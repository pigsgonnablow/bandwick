// Water: sea, lakes and rivers as one translucent mesh with depth colour, shore foam,
// animated ripples, flowing rivers, waterfalls and winter ice on fresh water.
import * as THREE from 'three';
import { WorldData, WATER, DIRS4, BASE_Y } from '../sim/types';
import { U } from './env';

const KIND_SURFACE = 0, KIND_FALL = 1, KIND_GLASS = 2;

export function buildWater(world: WorldData) {
  const N = world.size;
  const pos: number[] = [], depth: number[] = [], flow: number[] = [], kind: number[] = [], fresh: number[] = [];
  const edge: number[] = [], local: number[] = [];
  const wY = world.waterY, gY = world.groundY, W = world.water;
  const isW = (x: number, z: number) => x >= 0 && z >= 0 && x < N && z < N && W[z * N + x] !== WATER.None;

  // depth at a tile corner, averaged over the water tiles sharing it (land is ignored here;
  // shore foam comes from the land edges instead, so narrow rivers stay blue)
  const cornerDepth = (cx: number, cz: number, surf: number) => {
    let d = 0, n = 0;
    for (let k = 0; k < 4; k++) {
      const x = cx - (k & 1), z = cz - (k >> 1);
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const i = z * N + x;
      if (W[i] !== WATER.None && Math.abs(wY[i] - surf) < 0.01) {
        d += surf - gY[i];
        n++;
      }
    }
    return n ? d / n : 0.3;
  };
  const landAt = (x: number, z: number, surf: number) => {
    if (x < 0 || z < 0 || x >= N || z >= N) return 0;
    const j = z * N + x;
    if (W[j] !== WATER.None) return 0;
    return gY[j] > surf - 0.01 ? 1 : 0;
  };
  const DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      if (W[i] === WATER.None) continue;
      const y = wY[i];
      const f = world.flow[i];
      const fx = f >= 0 ? DIR[f][0] : 0, fz = f >= 0 ? DIR[f][1] : 0;
      const fr = W[i] === WATER.Sea ? 0 : 1;
      const d00 = cornerDepth(x, z, y), d01 = cornerDepth(x, z + 1, y);
      const d11 = cornerDepth(x + 1, z + 1, y), d10 = cornerDepth(x + 1, z, y);
      const quad = [
        [x, z, d00], [x, z + 1, d01], [x + 1, z + 1, d11],
        [x, z, d00], [x + 1, z + 1, d11], [x + 1, z, d10],
      ];
      // which sides (N, E, S, W) touch dry land above the water: foam lines there
      const eN = landAt(x, z - 1, y), eE = landAt(x + 1, z, y), eS = landAt(x, z + 1, y), eW = landAt(x - 1, z, y);
      for (const [qx, qz, qd] of quad) {
        pos.push(qx, y, qz);
        depth.push(qd);
        flow.push(fx, fz);
        kind.push(KIND_SURFACE);
        fresh.push(fr);
        edge.push(eN, eE, eS, eW);
        local.push(qx - x, qz - z);
      }
      // vertical faces: waterfalls into lower water, glass where water stands above lower ground
      for (let s = 0; s < 4; s++) {
        const nx = x + DIRS4[s][0], nz = z + DIRS4[s][1];
        const outside = nx < 0 || nz < 0 || nx >= N || nz >= N;
        let bottom: number, k: number;
        if (outside) {
          bottom = Math.max(BASE_Y, gY[i]);
          k = KIND_GLASS;
        } else {
          const j = nz * N + nx;
          if (isW(nx, nz)) {
            if (wY[j] >= y - 0.01) continue;
            bottom = wY[j];
            k = KIND_FALL;
          } else {
            if (gY[j] >= y - 0.01) continue;
            bottom = Math.max(gY[j], gY[i]);
            k = KIND_GLASS;
          }
        }
        if (bottom >= y - 0.01) continue;
        let ax: number, az: number, bx: number, bz: number;
        if (s === 0) { ax = x; az = z; bx = x + 1; bz = z; }
        else if (s === 1) { ax = x + 1; az = z; bx = x + 1; bz = z + 1; }
        else if (s === 2) { ax = x + 1; az = z + 1; bx = x; bz = z + 1; }
        else { ax = x; az = z + 1; bx = x; bz = z; }
        const verts = [[ax, y, az], [bx, y, bz], [bx, bottom, bz], [ax, y, az], [bx, bottom, bz], [ax, bottom, az]];
        for (const [vx, vy, vz] of verts) {
          pos.push(vx, vy, vz);
          // for vertical faces, "depth" carries distance below the surface (for gradients)
          depth.push(y - vy);
          flow.push(DIRS4[s][0], DIRS4[s][1]);
          kind.push(k);
          fresh.push(fr);
          edge.push(0, 0, 0, 0);
          local.push(0, 0);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setAttribute('aFresh', new THREE.Float32BufferAttribute(fresh, 1));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 4));
  g.setAttribute('aLocal', new THREE.Float32BufferAttribute(local, 2));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, createWaterMaterial());
  mesh.renderOrder = 2;
  mesh.name = 'water';
  return { mesh, tris: pos.length / 9 };
}

function createWaterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
      attribute float aDepth;
      attribute vec2 aFlow;
      attribute float aKind;
      attribute float aFresh;
      attribute vec4 aEdge;
      attribute vec2 aLocal;
      varying vec4 vEdge;
      varying vec2 vLocal;
      varying vec3 vWorld;
      varying float vDepth;
      varying vec2 vFlow;
      varying float vKind;
      varying float vFresh;
      uniform float uTime;
      void main() {
        vec3 p = position;
        vEdge = aEdge;
        vLocal = aLocal;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vDepth = aDepth;
        vFlow = aFlow;
        vKind = aKind;
        vFresh = aFresh;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uAmbient;
      uniform vec3 uViewDir;
      uniform float uIce;
      uniform float uCloud;
      uniform float uNight;
      uniform sampler2D uNoise;
      varying vec3 vWorld;
      varying float vDepth;
      varying vec2 vFlow;
      varying float vKind;
      varying float vFresh;
      varying vec4 vEdge;
      varying vec2 vLocal;

      float cloudShade(vec3 wp) {
        vec2 p = wp.xz * 0.012 + vec2(uTime * 0.0035, uTime * 0.0021);
        float n = texture2D(uNoise, p).r * 0.65 + texture2D(uNoise, p * 2.3 + 0.37).g * 0.35;
        float c = smoothstep(0.62 - uCloud * 0.2, 0.78 - uCloud * 0.2, n);
        return 1.0 - c * 0.32 * (0.4 + uCloud * 0.6);
      }

      void main() {
        vec3 shallow = vec3(0.10, 0.52, 0.56);
        vec3 deep = vec3(0.012, 0.09, 0.2);
        vec3 freshShallow = vec3(0.16, 0.45, 0.42);
        float t = uTime;
        vec3 col;
        float alpha;
        if (vKind < 0.5) {
          vec2 uv = vWorld.xz;
          vec2 fl = vFlow * t;
          vec2 a = texture2D(uNoise, uv * 0.11 + vec2(t * 0.011, t * 0.007) - fl * 0.06).rg - 0.5;
          vec2 b = texture2D(uNoise, uv * 0.27 - vec2(t * 0.009, -t * 0.013) - fl * 0.11).rg - 0.5;
          vec3 n = normalize(vec3((a.x + b.x) * 0.9, 1.0, (a.y + b.y) * 0.9));
          float d = vDepth;
          float dn = smoothstep(0.05, 1.3, d);
          col = mix(mix(shallow, freshShallow, vFresh), deep, dn);
          float diff = 0.72 + 0.28 * max(dot(n, uSunDir), 0.0);
          col *= uAmbient * 0.75 + uSunColor * diff * 0.45;
          vec3 h = normalize(uSunDir + uViewDir);
          float spec = pow(max(dot(n, h), 0.0), 260.0) * 0.75 * (1.0 - uNight);
          // shore foam: distance (in tiles) to the nearest land edge of this tile
          float de = 9.0;
          if (vEdge.x > 0.5) de = min(de, vLocal.y);
          if (vEdge.y > 0.5) de = min(de, 1.0 - vLocal.x);
          if (vEdge.z > 0.5) de = min(de, 1.0 - vLocal.y);
          if (vEdge.w > 0.5) de = min(de, vLocal.x);
          float foamN = texture2D(uNoise, uv * 0.6 + vec2(t * 0.02, 0.0)).b;
          float reach = vFresh > 0.5 ? 0.09 : 0.3;
          float bands = 0.5 + 0.5 * sin(de * 30.0 - t * 2.0 + foamN * 6.0);
          float foam = (1.0 - smoothstep(0.0, reach, de)) * smoothstep(0.3, 0.7, bands * 0.55 + foamN * 0.6);
          foam = max(foam, (1.0 - smoothstep(0.0, 0.035, de)) * 0.85);
          // river streaks show the current
          float streak = 0.0;
          if (dot(vFlow, vFlow) > 0.5) {
            float s = texture2D(uNoise, uv * vec2(0.9, 0.9) - vFlow * t * 0.35).b;
            streak = smoothstep(0.62, 0.8, s) * 0.35;
          }
          col = mix(col, vec3(0.9, 0.95, 0.97) * (uAmbient * 0.6 + uSunColor * 0.5), clamp(foam + streak, 0.0, 1.0));
          col += uSunColor * spec;
          alpha = mix(0.58, 0.93, dn);
          alpha = max(alpha, foam * 0.95);
          // winter ice on lakes and rivers
          float ice = uIce * vFresh;
          if (ice > 0.001) {
            float crack = texture2D(uNoise, uv * 0.8).g;
            vec3 iceCol = vec3(0.78, 0.86, 0.9) * (0.92 + 0.12 * crack) * (uAmbient * 0.7 + uSunColor * 0.5);
            col = mix(col, iceCol, ice * 0.92);
            alpha = mix(alpha, 0.96, ice);
          }
        } else if (vKind < 1.5) {
          // waterfall: white water streaming down
          vec2 uv = vec2((vWorld.x + vWorld.z) * 1.6, vWorld.y * 0.9 + t * 1.4);
          float s = texture2D(uNoise, uv * vec2(1.0, 0.35)).r;
          float white = smoothstep(0.4, 0.7, s);
          col = mix(vec3(0.42, 0.66, 0.72), vec3(0.95, 0.98, 1.0), white);
          col *= uAmbient * 0.6 + uSunColor * 0.55;
          alpha = 0.82 + 0.15 * white;
          if (uIce * vFresh > 0.5) { col = vec3(0.82, 0.9, 0.95) * (uAmbient * 0.7 + uSunColor * 0.4); alpha = 0.95; }
        } else {
          // glass: the cut face of the water body
          float k = smoothstep(0.0, 1.6, vDepth);
          col = mix(shallow * 0.9, deep * 0.7, k) * (uAmbient * 0.8 + uSunColor * 0.25);
          float topLine = 1.0 - smoothstep(0.0, 0.03, vDepth);
          col = mix(col, vec3(0.85, 0.95, 1.0) * (uAmbient * 0.7 + uSunColor * 0.4), topLine * 0.7);
          alpha = mix(0.55, 0.88, k);
        }
        col *= cloudShade(vWorld);
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, lum * vec3(0.72, 0.84, 1.15), uNight * 0.6);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
