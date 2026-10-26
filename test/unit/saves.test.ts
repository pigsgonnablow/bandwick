import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { unpack, yearSeason } from '../../src/saves';
import { TICKS_PER_SEASON, TICKS_PER_YEAR } from '../../src/sim/time';

const fake = { v: 1, params: { seed: 7, size: 128, landFraction: 0.44, mountains: 1 }, tick: 1234 };

describe('unpack', () => {
  it('reads plain JSON saves', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(fake));
    expect(await unpack(bytes)).toEqual(fake);
  });

  it('reads gzipped saves', async () => {
    const bytes = new Uint8Array(gzipSync(Buffer.from(JSON.stringify(fake))));
    expect(await unpack(bytes)).toEqual(fake);
  });

  it('refuses files that are not saves', async () => {
    await expect(unpack(new TextEncoder().encode('not json'))).rejects.toThrow(/not a Bandwick save/);
    await expect(unpack(new TextEncoder().encode('{"hello":1}'))).rejects.toThrow(/not a Bandwick save/);
    await expect(unpack(new TextEncoder().encode('null'))).rejects.toThrow(/not a Bandwick save/);
  });
});

describe('yearSeason', () => {
  it('names the season and year of a tick', () => {
    expect(yearSeason(0)).toBe('spring of year 1');
    expect(yearSeason(3 * TICKS_PER_SEASON + 5)).toBe('winter of year 1');
    expect(yearSeason(TICKS_PER_YEAR + TICKS_PER_SEASON)).toBe('summer of year 2');
  });
});
