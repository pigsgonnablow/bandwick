// Every stat the windows show has a hover tip: each trait, skill, need and place on the body.
import { describe, it, expect } from 'vitest';
import { TRAITS, SKILLS, SLOTS } from '../../src/sim/band';
import { NEED_TIPS, SKILL_TIPS, TRAIT_TIPS, SLOT_TIPS } from '../../src/ui/tips';

describe('tooltips', () => {
  it('cover every trait, skill, need and slot', () => {
    for (const t of TRAITS) expect(TRAIT_TIPS[t], t).toBeTruthy();
    for (const k of SKILLS) expect(SKILL_TIPS[k], k).toBeTruthy();
    for (const k of ['food', 'rest', 'warmth', 'belonging', 'safety']) expect(NEED_TIPS[k], k).toBeTruthy();
    for (const s of SLOTS) expect(SLOT_TIPS[s], s).toBeTruthy();
  });
});
