import { BASE_TPS } from '../sim/runner';
/** Speed buttons: 1x is a walking pace; 400x runs a game year in about ten seconds. */
export const SPEEDS = [1, 4, 12, 40, 120, 400];
/** Simulation ticks per real second at a given speed. */
export const tps = (speed: number) => speed * BASE_TPS;

export function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % 1_000_000;
}

/** CSS colour for a band's colour. */
export const bandCss = (c: { h: number; s: number; l: number }) => `hsl(${Math.round(c.h)} ${Math.round(c.s * 100)}% ${Math.round(c.l * 100)}%)`;
