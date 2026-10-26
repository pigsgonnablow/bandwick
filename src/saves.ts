// Saved worlds, kept in this browser (IndexedDB), compressed. Also export to / import from files.
import type { SaveData } from './sim/sim';
import { TICKS_PER_YEAR, TICKS_PER_SEASON } from './sim/time';

export interface SaveMeta {
  id: string;
  name: string;
  world: string;
  camp: string;
  seed: number;
  size: number;
  tick: number;
  pop: number;
  savedAt: number;
  auto: boolean;
  bytes: number;
}
interface SaveRecord extends SaveMeta {
  data: Uint8Array;
}

const DB = 'living-world';
const STORE = 'saves';
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

export const yearSeason = (tick: number) => `${SEASONS[Math.floor((tick % TICKS_PER_YEAR) / TICKS_PER_SEASON)]} of year ${Math.floor(tick / TICKS_PER_YEAR) + 1}`;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('This browser is not letting the game store saves.'));
    req.onblocked = () => reject(new Error('Saves are open in another tab of this game.'));
  });
}
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = run(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(r.result); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error ?? new Error('The save could not be written.')); };
  });
}

// ---- packing: JSON, gzip where the browser can
async function pack(save: SaveData): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(JSON.stringify(save));
  if (typeof CompressionStream === 'undefined') return raw;
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function unpack(bytes: Uint8Array): Promise<SaveData> {
  let raw = bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot open compressed saves.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    raw = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const text = new TextDecoder().decode(raw);
  let data: SaveData;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('that file is not a Bandwick save.');
  }
  if (!data || typeof data !== 'object' || !('v' in data) || !('params' in data)) throw new Error('that file is not a Bandwick save.');
  return data;
}

export async function listSaves(): Promise<SaveMeta[]> {
  const all = await tx<SaveRecord[]>('readonly', (s) => s.getAll());
  return all.map(({ data: _d, ...meta }) => meta).sort((a, b) => b.savedAt - a.savedAt);
}
export async function writeSave(save: SaveData, meta: Omit<SaveMeta, 'bytes' | 'savedAt' | 'tick' | 'seed' | 'size'>): Promise<SaveMeta> {
  const data = await pack(save);
  const rec: SaveRecord = { ...meta, tick: save.tick, seed: save.params.seed, size: save.params.size, savedAt: Date.now(), bytes: data.length, data };
  await tx('readwrite', (s) => s.put(rec));
  const { data: _d, ...out } = rec;
  return out;
}
export async function readSave(id: string): Promise<SaveData> {
  const rec = await tx<SaveRecord | undefined>('readonly', (s) => s.get(id));
  if (!rec) throw new Error('that save is no longer here.');
  return unpack(rec.data);
}
export async function readSaveBytes(id: string): Promise<{ meta: SaveMeta; data: Uint8Array }> {
  const rec = await tx<SaveRecord | undefined>('readonly', (s) => s.get(id));
  if (!rec) throw new Error('that save is no longer here.');
  const { data, ...meta } = rec;
  return { meta, data };
}
export async function deleteSave(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

/** Offer a save as a file download (works when the game runs from a file or a normal web page). */
export function downloadSave(meta: SaveMeta, data: Uint8Array) {
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = `${meta.world} y${Math.floor(meta.tick / TICKS_PER_YEAR) + 1}`.replace(/[^\w\- ]+/g, '').trim() || 'world';
  a.href = url;
  a.download = `${safe}.lwsave`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
