// Data definitions for people, buildings, animals and the camp.

export const TRAITS = [
  'industrious', 'lazy', 'curious', 'brave', 'cautious', 'kind', 'cruel',
  'ambitious', 'pious', 'wanderlust', 'charismatic', 'greedy',
] as const;
export type Trait = (typeof TRAITS)[number];
export const OPPOSED: [Trait, Trait][] = [['industrious', 'lazy'], ['brave', 'cautious'], ['kind', 'cruel']];

export const SKILLS = ['foraging', 'woodcutting', 'building', 'hunting', 'fishing', 'crafting'] as const;
export type Skill = (typeof SKILLS)[number];
export const SK = { forage: 0, wood: 1, build: 2, hunt: 3, fish: 4, craft: 5 } as const;

/** What a person's body is doing (drives animation). */
export const ACT = {
  Idle: 0, Walk: 1, Chop: 2, Gather: 3, Sit: 4, Sleep: 5, Chat: 6, Build: 7, Fish: 8, Eat: 9,
  Mourn: 10, Dead: 11, Run: 12, Hunt: 13, Dig: 14,
  /** children's games; squatting to tend the fire; hanging food on the rack; hands out to the fire */
  Play: 15, Tend: 16, Rack: 17, Warm: 18,
} as const;
/** One-off moves the renderer plays when a person's `flash` changes (low two bits). */
export const FLASH = { Thrust: 1, Stab: 2 } as const;
export const ACT_NAMES = Object.keys(ACT);

/** What a person is carrying. */
export const CARRY = { None: 0, Log: 1, Berries: 2, Meat: 3, Fish: 4, Body: 5, Spear: 6, Baby: 7 } as const;

export type TaskKind =
  | 'eat' | 'eatwild' | 'sleep' | 'warm' | 'socialize' | 'play' | 'idle' | 'mourn'
  | 'forage' | 'fell' | 'haul' | 'hunt' | 'fish' | 'build' | 'supply' | 'fuel' | 'preserve' | 'bury' | 'explore'
  | 'deadwood' | 'swim' | 'migrate';

/** Task kinds in a fixed order, so the renderer can be told what each person is doing. */
export const TASK_KINDS: TaskKind[] = [
  'eat', 'eatwild', 'sleep', 'warm', 'socialize', 'play', 'idle', 'mourn',
  'forage', 'fell', 'haul', 'hunt', 'fish', 'build', 'supply', 'fuel', 'preserve', 'bury', 'explore',
  'deadwood', 'swim', 'migrate',
];

/** Anything in the world that can be clicked. */
export interface Ref {
  kind: 'person' | 'deer' | 'building' | 'prop' | 'tile';
  id: number;
}
export interface CardLine {
  label: string;
  value: string;
  ref?: Ref;
}
/** A description of a thing for the inspector card. */
export interface Card {
  ref: Ref;
  title: string;
  subtitle: string;
  lines: CardLine[];
  notes: string[];
  x: number;
  z: number;
  gone?: boolean;
}

export interface Task {
  kind: TaskKind;
  stage: number;
  /** destination tile */
  goal: number;
  /** exact spot inside the goal tile (tile units) */
  gx: number;
  gz: number;
  /** id of the thing worked on (prop, building, deer, person) */
  ref: number;
  timer: number;
  started: number;
  amount: number;
  near: boolean;
  /** tick by which a chase gives up (hunting: longer for herds further out) */
  deadline?: number;
  /** tick the walk back to the stores began, while carrying goods home */
  homeAt?: number;
}

export interface Memory {
  kind: string;
  tick: number;
  /** -100..100 effect on mood when fresh */
  weight: number;
  /** how many years it takes to fade */
  years: number;
  subject: number;
  text: string;
}

export interface Person {
  id: number;
  /** the band (camp id) they belong to */
  band: number;
  name: string;
  sex: 0 | 1; // 0 female, 1 male
  birth: number;
  mother: number;
  father: number;
  partner: number;
  /** attraction: 0 = the other sex, 1 = the same sex */
  samesex: boolean;
  alive: boolean;
  death: number;
  cause: string;
  buried: boolean;
  x: number;
  z: number;
  fx: number; // facing target
  fz: number;
  path: Int32Array | null;
  pathIdx: number;
  task: Task | null;
  nextThink: number;
  food: number;
  rest: number;
  warmth: number;
  safety: number;
  belonging: number;
  health: number;
  mood: number;
  sick: number; // days of fever left
  traits: Trait[];
  skills: Float32Array;
  carry: number;
  carryAmt: number;
  home: number;
  indoors: boolean;
  act: number;
  thought: string;
  memories: Memory[];
  rel: Map<number, number>;
  pregnantUntil: number;
  babyFather: number;
  look: number; // seed for clothes, skin, hair
  kills: number;
  /** a rare constitution: ages far more slowly once old (absent = no) */
  hardy?: boolean;
  /** who killed them, if someone did */
  killer?: number;
  /** a one-off move to show: count * 4 + FLASH code (looks only; changes nothing) */
  flash?: number;
  children: number[];
  /** tick of the last time they went to mourn */
  mourned: number;
  /** who raises them when both parents are dead (-1: their parents); kinship stays with the birth parents */
  carer: number;
}

export const BUILD_KINDS = ['hearth', 'leanto', 'hut', 'storehouse', 'rack', 'stockpile'] as const;
export type BuildKind = (typeof BUILD_KINDS)[number];
export const BUILD: Record<BuildKind, { wood: number; work: number; cap: number; shelter: number; label: string }> = {
  hearth: { wood: 0, work: 0, cap: 0, shelter: 0, label: 'Hearth' },
  leanto: { wood: 4, work: 40, cap: 2, shelter: 0.5, label: 'Lean-to' },
  hut: { wood: 14, work: 150, cap: 6, shelter: 0.78, label: 'Hut' },
  storehouse: { wood: 10, work: 110, cap: 0, shelter: 0, label: 'Storehouse' },
  rack: { wood: 5, work: 45, cap: 0, shelter: 0, label: 'Drying rack' },
  stockpile: { wood: 0, work: 0, cap: 0, shelter: 0, label: 'Stockpile' },
};

export interface Building {
  id: number;
  /** the band (camp id) that built it */
  band: number;
  kind: BuildKind;
  tile: number;
  x: number;
  z: number;
  rot: number; // quarter turns
  wood: number; // delivered
  work: number; // done
  built: boolean;
  owner: number; // person id of the household head
  fuel: number;
  started: number;
  finished: number;
  builders: number[];
}

export interface Deer {
  id: number;
  herd: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  fx: number;
  fz: number;
  state: number; // 0 graze, 1 walk, 2 flee
  timer: number;
  alive: boolean;
  fawn: boolean;
}

export interface Herd {
  id: number;
  hx: number;
  hz: number;
  /** wander target shared by the herd */
  tx: number;
  tz: number;
  next: number;
}

export interface Stock {
  berries: number;
  meat: number;
  fish: number;
  preserved: number;
  wood: number;
}

export interface SimEvent {
  id: number;
  tick: number;
  kind: string;
  text: string;
  people: number[];
  x: number;
  z: number;
  /** 1 routine .. 5 momentous; the history engine (M2) builds on this */
  weight: number;
}

export const foodTotal = (s: Stock) => s.berries + s.meat + s.fish + s.preserved;
