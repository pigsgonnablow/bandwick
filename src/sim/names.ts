// Placeholder world names until cultures generate their own languages (M4).
import { Rng } from './rng';

const ONSET = ['b', 'br', 'c', 'd', 'dr', 'f', 'g', 'gl', 'h', 'k', 'l', 'm', 'n', 'r', 's', 'st', 't', 'th', 'v', 'w'];
const VOWEL = ['a', 'e', 'i', 'o', 'u', 'ae', 'ei', 'ou', 'y'];
const CODA = ['', '', 'n', 'r', 'l', 'th', 'm', 'rn', 'ld', 'sk'];
const END = ['holm', 'mere', 'vale', 'reach', 'fell', 'wick', 'ford', 'moor', 'dale', 'strand', 'haven', 'shire'];

export function worldName(seed: number): string {
  const r = Rng.stream(seed, 'worldname');
  const syll = () => r.pick(ONSET) + r.pick(VOWEL) + r.pick(CODA);
  let root = syll();
  if (r.chance(0.5)) root += r.pick(VOWEL.slice(0, 5)) + r.pick(CODA);
  const name = root + r.pick(END);
  const cap = name[0].toUpperCase() + name.slice(1);
  return r.chance(0.6) ? `The Isle of ${cap}` : cap;
}

/** A small generated tongue for a people: their personal names share its sounds. */
export class Tongue {
  private onsets: string[];
  private vowels: string[];
  private codas: string[];
  private fem: string[];
  private masc: string[];
  constructor(readonly r: Rng) {
    const pickN = (arr: string[], n: number) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = r.int(0, i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a.slice(0, n);
    };
    this.onsets = pickN(['b', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'r', 's', 't', 'v', 'w', 'th', 'sh', 'br', 'kr', 'tr', 'dr', 'gr', 'j', 'z', 'p', 'c'], 15);
    this.vowels = pickN(['a', 'e', 'i', 'o', 'u', 'a', 'e', 'ai', 'ei', 'ou', 'ia', 'y'], 6);
    this.codas = pickN(['n', 'r', 'l', 's', 'th', 'm', 'k', 'rn', 'ld', 'sk', 'nd'], 5);
    this.fem = pickN(['a', 'e', 'ia', 'i', 'ea', 'wen', 'ra', 'la', 'ys'], 3);
    this.masc = pickN(['o', 'an', 'ur', 'ek', 'or', 'in', 'ad', 'ith', 'ul'], 3);
  }
  name(sex: 0 | 1): string {
    // a made-up word that happens to be a real (and unfortunate) one is passed over
    for (let k = 0; k < 8; k++) {
      const n = this.makeName(sex);
      if (!AWKWARD.has(n.toLowerCase())) return n;
    }
    return this.makeName(sex) + 'a';
  }
  private makeName(sex: 0 | 1): string {
    const r = this.r;
    let s = r.pick(this.onsets) + r.pick(this.vowels);
    if (r.chance(0.45)) s += r.pick(this.codas) + r.pick(this.vowels);
    else if (r.chance(0.3)) s += r.pick(this.onsets);
    s += r.pick(sex === 0 ? this.fem : this.masc);
    s = s.replace(/(.)\1\1/g, '$1$1').replace(/([aeiouy])\1/g, '$1').replace(/([aeiouy]{2})[aeiouy]+/g, '$1');
    if (s.length > 9) s = s.slice(0, 8);
    return s[0].toUpperCase() + s.slice(1);
  }
  place(): string {
    const r = this.r;
    const s = r.pick(this.onsets) + r.pick(this.vowels) + r.pick(this.codas) + r.pick(['ford', 'mere', 'holt', 'stead', 'wick', 'hollow', 'brook']);
    return s[0].toUpperCase() + s.slice(1);
  }
}

/** Real words a generated name should never be. */
const AWKWARD = new Set([
  'dead', 'die', 'died', 'death', 'kill', 'killer', 'slay', 'doom', 'dread', 'grave', 'tomb', 'shit', 'piss', 'fart', 'butt', 'damn', 'hell',
  'rape', 'nazi', 'dumb', 'fat', 'ugly', 'slut', 'whore', 'bitch', 'cunt', 'dick', 'cock', 'puss', 'tit', 'tits', 'fuck', 'ass', 'arse', 'poo', 'pee',
  'sick', 'pus', 'rot', 'rotten', 'dung', 'vomit', 'mud', 'muck', 'lame', 'loser', 'nob', 'knob', 'twat', 'wank', 'prick', 'scum', 'filth',
  'bad', 'evil', 'sin', 'satan', 'demon', 'devil', 'god', 'jesus', 'allah', 'man', 'woman', 'boy', 'girl', 'baby', 'king', 'queen', 'lord',
]);
