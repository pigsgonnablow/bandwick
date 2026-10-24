// Time of day and season -> lighting, sky and seasonal parameters.
// Rendering only: nothing here feeds back into the simulation.
import * as THREE from 'three';

export const MINUTES_PER_DAY = 24 * 60;
export const DAYS_PER_SEASON = 12;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;
export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];

/** Uniforms shared by every material in the scene. */
export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uAmbient: { value: new THREE.Color(0.5, 0.55, 0.65) },
  uViewDir: { value: new THREE.Vector3(0, 1, 0) },
  uSnow: { value: 0 },
  uIce: { value: 0 },
  uLeaf: { value: 1 },
  uAutumn: { value: 0 },
  uSpring: { value: 0 },
  uBloom: { value: 0 },
  uBerries: { value: 0 },
  uVegTint: { value: new THREE.Vector3(1, 1, 1) },
  uCloud: { value: 0.5 },
  uNight: { value: 0 },
  uWind: { value: 0.5 },
  uNoise: { value: null as THREE.Texture | null },
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Seasonal window on a wrapping 0..4 year: rises over [a,b], falls over [c,d]. */
function window4(s: number, a: number, b: number, c: number, d: number) {
  const wrap = (x: number) => ((x % 4) + 4) % 4;
  const x = wrap(s - a);
  const rb = wrap(b - a), rc = wrap(c - a), rd = wrap(d - a);
  if (x <= rb) return smooth(0, rb, x);
  if (x <= rc) return 1;
  if (x <= rd) return 1 - smooth(rc, rd, x);
  return 0;
}

type Key = [number, number[]];
function lerpKeys(keys: Key[], x: number): number[] {
  // keys sorted on a wrapping 0..4 axis
  const n = keys.length;
  for (let i = 0; i < n; i++) {
    const [ka, va] = keys[i];
    const [kbRaw, vb] = keys[(i + 1) % n];
    const kb = kbRaw <= ka ? kbRaw + 4 : kbRaw;
    let xx = x;
    if (xx < ka) xx += 4;
    if (xx >= ka && xx <= kb) {
      const t = smooth(0, 1, (xx - ka) / (kb - ka));
      return va.map((v, j) => v + (vb[j] - v) * t);
    }
  }
  return keys[0][1];
}

const VEG_KEYS: Key[] = [
  [0.3, [0.96, 1.1, 0.84]], // spring: fresh
  [1.2, [1.0, 1.0, 1.0]], // summer
  [2.0, [1.07, 0.99, 0.82]], // late summer, drying
  [2.6, [1.24, 0.92, 0.56]], // autumn
  [3.3, [0.88, 0.84, 0.72]], // winter
];

// Sky colours (sRGB hex) for [zenith, horizon] at key sun elevations.
const SKY = {
  night: ['#0a1330', '#1c2a4f'],
  twilight: ['#3b3f6e', '#c98a74'],
  golden: ['#7aa6d6', '#f6d2a2'],
  day: ['#86bde6', '#dcedf7'],
};

export interface EnvState {
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  lightDir: THREE.Vector3; // sun by day, moon by night
  lightColor: THREE.Color;
  lightIntensity: number;
  skyColor: THREE.Color;
  groundColor: THREE.Color;
  hemiIntensity: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  night: number;
}

const c = (hex: string) => new THREE.Color(hex);
const tmpA = new THREE.Color(), tmpB = new THREE.Color();

/**
 * @param minuteOfDay 0..1440
 * @param season continuous 0..4 (0 = first day of spring)
 * @param dayAmp 1 = full day/night cycle, 0 = fixed mid-afternoon light (used at high speed)
 */
export function computeEnv(minuteOfDay: number, season: number, dayAmp: number, out?: EnvState): EnvState {
  const o: EnvState = out ?? {
    sunDir: new THREE.Vector3(), sunColor: new THREE.Color(), sunIntensity: 1,
    lightDir: new THREE.Vector3(), lightColor: new THREE.Color(), lightIntensity: 1,
    skyColor: new THREE.Color(), groundColor: new THREE.Color(), hemiIntensity: 1,
    zenith: new THREE.Color(), horizon: new THREE.Color(), night: 0,
  };
  // longer days in summer, shorter in winter
  const dayLen = 12 + 2.6 * Math.cos(((season - 1.5) / 4) * Math.PI * 2); // hours of daylight
  const noon = 12.5;
  const realHour = minuteOfDay / 60;
  const fixedHour = 14.5;
  // blend in hour-space toward a fixed afternoon when day/night is damped
  const hour = fixedHour + (realHour - fixedHour) * dayAmp;
  const sunrise = noon - dayLen / 2;
  // sun phase: 0 at sunrise, PI at sunset
  const phase = ((hour - sunrise) / dayLen) * Math.PI;
  const maxElev = 0.62 + 0.28 * Math.cos(((season - 1.5) / 4) * Math.PI * 2) * 0.5; // radians-ish
  const elev = Math.sin(phase) * maxElev; // < 0 at night
  const az = -Math.PI * 0.15 + phase * 0.9;
  o.sunDir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev) * 0.8 + 0.35).normalize();

  const e = elev; // radians
  const dayK = smooth(-0.08, 0.25, e); // 0 night .. 1 day
  const golden = 1 - smooth(0.05, 0.42, e); // warm near horizon
  o.night = 1 - smooth(-0.18, 0.04, e);

  // sun colour + intensity
  tmpA.setRGB(1.0, 0.96, 0.88);
  tmpB.setRGB(1.0, 0.74, 0.52);
  o.sunColor.copy(tmpA).lerp(tmpB, golden * dayK);
  o.sunIntensity = 2.7 * smooth(-0.04, 0.3, e);

  // moon takes over the key light at night
  const moonK = o.night;
  if (o.sunIntensity > 0.18 || moonK < 0.5) {
    o.lightDir.copy(o.sunDir);
    if (o.lightDir.y < 0.08) o.lightDir.y = 0.08;
    o.lightDir.normalize();
    o.lightColor.copy(o.sunColor);
    o.lightIntensity = Math.max(o.sunIntensity, 0.75 * moonK);
    if (o.sunIntensity < 0.75 * moonK) o.lightColor.setRGB(0.62, 0.72, 1.0);
  } else {
    o.lightDir.set(-o.sunDir.x * 0.7, 0.75, -o.sunDir.z * 0.7 + 0.2).normalize();
    o.lightColor.setRGB(0.62, 0.72, 1.0);
    o.lightIntensity = 0.75 * moonK;
  }

  // ambient (hemisphere)
  const daySky = c('#b4cdec'), duskSky = c('#b9a7c2'), nightSky = c('#3b4f86');
  o.skyColor.copy(nightSky).lerp(duskSky, smooth(-0.15, 0.05, e)).lerp(daySky, smooth(0.05, 0.35, e));
  o.groundColor.copy(c('#2a3040')).lerp(c('#9a8a70'), dayK);
  o.hemiIntensity = 1.0 + 1.0 * dayK;

  // sky gradient
  const zen = new THREE.Color(), hor = new THREE.Color();
  const kTw = smooth(-0.2, -0.02, e), kGold = smooth(-0.02, 0.12, e), kDay = smooth(0.12, 0.4, e);
  zen.set(SKY.night[0]).lerp(c(SKY.twilight[0]), kTw).lerp(c(SKY.golden[0]), kGold).lerp(c(SKY.day[0]), kDay);
  hor.set(SKY.night[1]).lerp(c(SKY.twilight[1]), kTw).lerp(c(SKY.golden[1]), kGold).lerp(c(SKY.day[1]), kDay);
  // winter skies are paler
  const winter = window4(season, 2.9, 3.2, 3.7, 3.95);
  zen.lerp(c('#b7c6d6'), winter * 0.35 * dayK);
  hor.lerp(c('#eef2f5'), winter * 0.3 * dayK);
  o.zenith.copy(zen);
  o.horizon.copy(hor);
  return o;
}

/** Seasonal shader parameters for a continuous season value 0..4. */
export function applySeason(season: number) {
  const s = ((season % 4) + 4) % 4;
  U.uSnow.value = window4(s, 2.8, 3.25, 3.78, 0.15);
  U.uIce.value = window4(s, 3.05, 3.35, 3.7, 3.88);
  // deciduous canopy: buds in early spring, full through summer, drop in late autumn
  U.uLeaf.value = window4(s, 3.86, 0.3, 2.78, 3.1);
  U.uAutumn.value = window4(s, 2.15, 2.6, 3.0, 3.6);
  U.uSpring.value = window4(s, 3.9, 0.2, 0.6, 1.1);
  U.uBloom.value = window4(s, 0.12, 0.45, 1.2, 1.7);
  U.uBerries.value = window4(s, 1.4, 1.7, 2.6, 2.9);
  const v = lerpKeys(VEG_KEYS, s);
  U.uVegTint.value.set(v[0], v[1], v[2]);
}

export function seasonIndex(season: number) {
  return Math.floor((((season % 4) + 4) % 4));
}
