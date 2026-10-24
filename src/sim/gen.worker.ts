// World generation off the main thread.
import { generateWorld } from './worldgen';
import type { WorldParams, WorldData } from './types';

export function transferables(w: WorldData): ArrayBuffer[] {
  return [
    w.level, w.groundY, w.terrain, w.water, w.waterY, w.flow, w.moisture, w.temperature, w.fertility,
    w.stone, w.ore, w.clay, w.propType, w.propPos, w.propRot, w.propScale, w.propTile, w.colorTex, w.maskTex,
  ].map((a) => a.buffer as ArrayBuffer);
}

self.onmessage = (e: MessageEvent<WorldParams>) => {
  const world = generateWorld(e.data);
  (self as unknown as Worker).postMessage(world, transferables(world));
};
