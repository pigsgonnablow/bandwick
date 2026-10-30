// The world view: renderer, lights, sky, terrain/water/props, clock-driven lighting,
// hover picking and automatic quality.
import * as THREE from 'three';
import { WorldData, WATER } from '../sim/types';
import { IsoCamera } from './camera';
import { createTerrainMaterials, buildTerrain } from './terrain';
import { buildWater } from './water';
import { PropLayer, PropState } from './props';
import { BandLayer } from './band';
import type { Frame } from '../sim/runner';
import { U, computeEnv, applySeason, EnvState } from './env';
import { makeNoiseTexture } from './shaderlib';
import { Snowfall } from './weather';

export interface Quality {
  level: number; // 0 low .. 3 high
  auto: boolean;
}
const QUALITY = [
  { pixelRatio: 1, shadows: false, shadowSize: 1024 },
  { pixelRatio: 1, shadows: true, shadowSize: 1024 },
  { pixelRatio: 1.25, shadows: true, shadowSize: 2048 },
  { pixelRatio: 1.5, shadows: true, shadowSize: 2048 },
];
export const QUALITY_NAMES = ['Low', 'Medium', 'High', 'Ultra'];

export class WorldView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  cam: IsoCamera;
  sun = new THREE.DirectionalLight(0xffffff, 2);
  hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  world?: WorldData;
  private worldGroup = new THREE.Group();
  private props?: PropLayer;
  private snow = new Snowfall();
  private hover = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0.85, depthTest: false }),
  );
  private env?: EnvState;
  private skyEl: HTMLElement;
  quality: Quality = { level: 2, auto: true };
  private frameTimes: number[] = [];
  private lastQualityChange = 0;
  private failed = new Set<number>();
  stats = { fps: 0, calls: 0, tris: 0, instances: 0, terrainTris: 0, waterTris: 0 };
  hoverTile = -1;

  band?: BandLayer;
  private worldTextures: THREE.Texture[] = [];

  constructor(private host: HTMLElement, sky: HTMLElement, geoms: Map<string, THREE.BufferGeometry>, private bandGeoms: Map<string, THREE.BufferGeometry>) {
    this.skyEl = sky;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    this.cam = new IsoCamera(this.renderer.domElement);
    this.geoms = geoms;
    U.uNoise.value = makeNoiseTexture();

    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.worldGroup);
    this.hover.renderOrder = 10;
    this.hover.visible = false;
    this.scene.add(this.hover);
    this.scene.add(this.snow.points);
    this.applyQuality();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  private geoms: Map<string, THREE.BufferGeometry>;

  setWorld(world: WorldData) {
    // free the previous world's GPU memory: geometries, materials and their textures
    // (the Blender asset geometries are shared between worlds and are kept)
    const shared = new Set<THREE.BufferGeometry>([...this.geoms.values(), ...this.bandGeoms.values()]);
    const mats = new Set<THREE.Material>();
    this.worldGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !shared.has(m.geometry)) m.geometry.dispose();
      const mm = m.material as THREE.Material | THREE.Material[] | undefined;
      if (mm) (Array.isArray(mm) ? mm : [mm]).forEach((x) => mats.add(x));
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    for (const m of mats) {
      for (const v of Object.values(m as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture && v !== U.uNoise.value) v.dispose();
      m.dispose();
    }
    this.worldTextures.forEach((t) => t.dispose());
    this.worldGroup.clear();
    this.world = world;
    this.hoverDrawn = -2;
    const terrainMats = createTerrainMaterials(world);
    this.worldTextures = [terrainMats.colorTex, terrainMats.maskTex];
    const terrain = buildTerrain(world, terrainMats);
    const water = buildWater(world);
    this.props = new PropLayer(world.size, this.geoms);
    this.props.setProps(propsFromWorld(world));
    this.band = new BandLayer(world, this.bandGeoms);
    { const band = this.band; this.props.cutterAt = (x, z) => band.nearestTo(x, z); }
    this.worldGroup.add(terrain.group, water.mesh, this.props.group, this.band.group);
    this.stats.terrainTris = terrain.tris;
    this.stats.waterTris = water.tris;
    const N = world.size;
    this.cam.setBounds(N);
    this.cam.heightAt = (x, z) => {
      const tx = Math.min(N - 1, Math.max(0, Math.floor(x)));
      const tz = Math.min(N - 1, Math.max(0, Math.floor(z)));
      const i = tz * N + tx;
      return Math.max(world.groundY[i], world.water[i] ? world.waterY[i] : -99);
    };
    // open on the most interesting land: the centre of mass of non-water tiles
    let sx = 0, sz = 0, n = 0;
    for (let i = 0; i < N * N; i++)
      if (world.water[i] === WATER.None) {
        sx += i % N;
        sz += Math.floor(i / N);
        n++;
      }
    this.cam.frame(n ? sx / n : N / 2, n ? sz / n : N / 2, N * 0.62);
  }

  /** A new frame from the simulation. */
  onFrame(f: Frame, tps: number) {
    if (this.props) this.props.animateFalls = tps <= 32;
    if (f.props) this.props?.setProps(f.props);
    if (f.buildings) this.band?.setBuildings(f.buildings);
    if (f.piles) this.band?.setPiles(f.piles);
    if (f.traps) this.band?.setTraps(f.traps);
    this.band?.onFrame(f, tps, performance.now());
  }

  /** Screen position (client px) of a world point. */
  project(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.cam.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.cam.changed = true;
  }

  setQuality(level: number, auto: boolean) {
    this.quality = { level: Math.max(0, Math.min(3, level)), auto };
    this.applyQuality();
  }

  private applyQuality() {
    const q = QUALITY[this.quality.level];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    if (this.sun.shadow.mapSize.x !== q.shadowSize) {
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
    // materials must recompile when shadows toggle
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  /** Tile index under a screen point, by marching the view ray over the terraces. */
  pick(clientX: number, clientY: number): number {
    const w = this.world;
    if (!w) return -1;
    const N = w.size;
    const ray = this.cam.ray(clientX, clientY);
    // start where the ray is above the tallest possible terrain
    const top = 8;
    let t = (top - ray.origin.y) / ray.direction.y;
    const p = new THREE.Vector3();
    const stepT = 0.08 / Math.hypot(ray.direction.x, ray.direction.z);
    for (let k = 0; k < 6000; k++) {
      p.copy(ray.origin).addScaledVector(ray.direction, t);
      if (p.y < -3) break;
      const x = Math.floor(p.x), z = Math.floor(p.z);
      if (x >= 0 && z >= 0 && x < N && z < N) {
        const i = z * N + x;
        const h = Math.max(w.groundY[i], w.water[i] ? w.waterY[i] : -99);
        if (p.y <= h) return i;
      }
      t += stepT;
    }
    return -1;
  }

  private hoverPos = new THREE.Float32BufferAttribute(new Float32Array(12), 3);
  private hoverDrawn = -2;
  setHover(tile: number) {
    this.hoverTile = tile;
    const w = this.world;
    if (!w || tile < 0) {
      this.hover.visible = false;
      return;
    }
    this.hover.visible = true;
    if (tile === this.hoverDrawn) return; // one small buffer, rewritten only when the tile changes
    this.hoverDrawn = tile;
    const N = w.size;
    const x = tile % N, z = Math.floor(tile / N);
    const y = Math.max(w.groundY[tile], w.water[tile] ? w.waterY[tile] : -99) + 0.02;
    (this.hoverPos.array as Float32Array).set([x, y, z, x + 1, y, z, x + 1, y, z + 1, x, y, z + 1]);
    this.hoverPos.needsUpdate = true;
    const g = this.hover.geometry;
    if (g.attributes.position !== this.hoverPos) g.setAttribute('position', this.hoverPos);
    g.computeBoundingSphere();
  }

  /**
   * @param minuteOfDay 0..1440, @param season 0..4, @param dayAmp 1 = full cycle
   */
  render(dt: number, timeSec: number, minuteOfDay: number, season: number, dayAmp: number, wind: number, frameDt = dt) {
    const w = this.world;
    const el = this.renderer.domElement;
    const aspect = el.clientWidth / Math.max(1, el.clientHeight);
    this.cam.update(dt, aspect);

    // environment
    this.env = computeEnv(minuteOfDay, season, dayAmp, this.env);
    const e = this.env;
    applySeason(season);
    U.uTime.value = timeSec;
    U.uWind.value = wind;
    U.uNight.value = e.night;
    U.uSunDir.value.copy(e.lightDir);
    U.uSunColor.value.copy(e.lightColor).multiplyScalar(e.lightIntensity / 2.7);
    U.uAmbient.value.copy(e.skyColor).multiplyScalar(e.hemiIntensity * 0.5);
    this.cam.viewDir(U.uViewDir.value);
    U.uCloud.value = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(timeSec * 0.013) * Math.sin(timeSec * 0.0071 + 1.3));
    this.sun.color.copy(e.lightColor);
    this.sun.intensity = e.lightIntensity;
    this.hemi.color.copy(e.skyColor);
    this.hemi.groundColor.copy(e.groundColor);
    this.hemi.intensity = e.hemiIntensity;
    const z = '#' + e.zenith.getHexString(), h = '#' + e.horizon.getHexString();
    this.skyEl.style.background = `radial-gradient(ellipse 120% 90% at 50% 100%, ${h} 0%, ${h} 18%, ${z} 100%)`;

    // shadows follow the view
    const tgt = this.cam.target;
    const span = this.cam.zoom * Math.max(1, aspect) * 0.72 + 6;
    const sc = this.sun.shadow.camera;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.near = 1;
    sc.far = 400;
    sc.updateProjectionMatrix();
    this.sun.target.position.copy(tgt);
    this.sun.position.copy(tgt).addScaledVector(e.lightDir, 150);
    // snap the shadow camera to texels to avoid shimmering while panning
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();

    // prop visibility
    if (w && this.props && this.cam.changed) {
      const r = el.getBoundingClientRect();
      const pts = [
        [r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom],
      ];
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [px, py] of pts)
        for (const y of [-1, 8]) {
          const g = this.cam.groundAt(px, py, y);
          x0 = Math.min(x0, g.x); x1 = Math.max(x1, g.x);
          z0 = Math.min(z0, g.z); z1 = Math.max(z1, g.z);
        }
      const pad = 3;
      const zoom = this.cam.zoom;
      const detail = zoom < 70 ? 'hi' : 'lo';
      const small = zoom < (this.quality.level >= 2 ? 60 : 38);
      this.props.update(x0 - pad, z0 - pad, x1 + pad, z1 + pad, detail, small);
      // far away, tree shadows cost more than they show
      this.props.setShadows(detail === 'hi');
      this.cam.changed = false;
    }

    // snow storms come and go through the winter
    const day = (minuteOfDay / 1440) + Math.floor(season * 12);
    const storm = Math.max(0, Math.sin(day * 0.9) * 0.7 + Math.sin(day * 0.37 + 1.7) * 0.5);
    const winterK = Math.max(0, Math.min(1, (U.uSnow.value - 0.15) * 2));
    const light = new THREE.Color(0.9, 0.93, 1).multiplyScalar(0.55 + 0.45 * (1 - e.night));
    this.snow.update(timeSec, this.cam.target, this.cam.zoom, winterK * Math.min(1, storm), this.renderer.getPixelRatio(), light);

    this.props?.animate(performance.now());
    if (this.band) this.band.viewZoom = this.cam.zoom;
    this.band?.update(dt, performance.now(), Math.max(e.night, 1 - Math.min(1, e.sunIntensity / 1.2)) , this.cam.target);
    this.renderer.render(this.scene, this.cam.camera);
    const info = this.renderer.info.render;
    this.stats.calls = info.calls;
    this.stats.tris = info.triangles;
    this.stats.instances = this.props?.visibleInstances ?? 0;
    // a single long stall (a tab switch, a GC pause) says nothing about steady performance
    if (frameDt < 0.5) this.trackPerformance(frameDt);
  }

  private trackPerformance(dt: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.stats.fps = avg > 0 ? 1 / avg : 0;
    if (!this.quality.auto || this.frameTimes.length < 90) return;
    const now = performance.now();
    if (now - this.lastQualityChange < 4000 || document.hidden) return;
    if (avg > 1 / 45 && this.quality.level > 0) {
      // too slow: step down, and remember this level struggled
      this.failed.add(this.quality.level);
      this.lastQualityChange = now;
      this.frameTimes.length = 0;
      this.setQuality(this.quality.level - 1, true);
    } else if (avg < 1 / 57 && this.quality.level < 3 && !this.failed.has(this.quality.level + 1) &&
      now - this.lastQualityChange > 15000) {
      // holding the display's refresh rate comfortably: try one step up
      this.lastQualityChange = now;
      this.frameTimes.length = 0;
      this.setQuality(this.quality.level + 1, true);
    }
  }
}

function propsFromWorld(w: WorldData): PropState {
  const n = w.propCount;
  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    x[k] = w.propPos[k * 3];
    y[k] = w.propPos[k * 3 + 1];
    z[k] = w.propPos[k * 3 + 2];
  }
  return { count: n, type: w.propType, x, y, z, rot: w.propRot, scale: w.propScale, alive: new Uint8Array(n).fill(1), val: new Float32Array(n) };
}
