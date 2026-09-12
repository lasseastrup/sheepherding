/**
 * Describes the simulation config for a tuning UI: which values can be changed live, what they
 * mean, and what range is sensible. Ranges are derived from the defaults unless listed in
 * OVERRIDES, so a new config field shows up in the panel without being registered anywhere.
 */
import { defaultConfig, type SimConfig } from './config';

export interface ParamSpec {
  /** dotted path into SimConfig, e.g. "run.cohesion" or "personality.boldness" */
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
  /** true for [min, max] pairs, rendered as two sliders */
  pair: boolean;
  boolean: boolean;
  /** changing it cannot be applied to a running flock, so the flock is respawned */
  rebuild: boolean;
  note?: string;
}

export interface GroupSpec {
  key: string;
  label: string;
  blurb: string;
  params: ParamSpec[];
}

/** Groups in the order a tuner wants them, with the field order inside each group preserved. */
const GROUPS: { key: string; label: string; blurb: string }[] = [
  { key: 'pressure', label: 'Pressure and fear', blurb: 'How the pointer is perceived: flight zones, contagion, habituation.' },
  { key: 'fear', label: 'Fear thresholds', blurb: 'The fear levels at which a sheep looks up, walks off, or bolts.' },
  { key: 'flee', label: 'Fleeing', blurb: 'Selfish-herd flight, point of balance, and what makes a flock split.' },
  { key: 'run', label: 'Running', blurb: 'The packing run: speeds, cohesion, contagion between runners, stamina.' },
  { key: 'walk', label: 'Walking', blurb: 'Episodic relocation: who sets off, who follows, and when they stop.' },
  { key: 'graze', label: 'Grazing', blurb: 'Idle drift, spacing and the slow spread of a settled flock.' },
  { key: 'alert', label: 'Alert', blurb: 'How long a sheep stands and stares before deciding.' },
  { key: 'group', label: 'Sub-groups', blurb: 'When a fragment counts as cut off and goes looking for the flock.' },
  { key: 'personality', label: 'Personality spread', blurb: 'Per-sheep variation, drawn once at spawn. Needs a respawn.' },
  { key: 'kinematics', label: 'Movement', blurb: 'Turn rates and how quickly sheep get up to speed and stop.' },
  { key: 'sheep', label: 'Perception', blurb: 'Field of view, how many neighbours a sheep tracks, contact size.' },
  { key: 'steering', label: 'Steering', blurb: 'Context-map resolution and anticipation of other sheep.' },
  { key: 'pbd', label: 'Collision', blurb: 'The position solver that stops sheep overlapping.' },
  { key: 'fences', label: 'Fences', blurb: 'How far from the edge sheep start to avoid it.' },
  { key: 'spawn', label: 'Spawn', blurb: 'Initial layout. Needs a respawn.' },
];

/** Anything the running simulation cannot pick up: the flock is rebuilt when these change. */
const REBUILD = new Set(['sheep.gatherCell', 'sheep.kVisible', 'steering.slots', 'dt', 'spawn.spacing']);
const REBUILD_PREFIX = ['personality.'];

const OVERRIDES: Record<string, Partial<ParamSpec>> = {
  'pressure.zoneIdle': { label: 'Flight zone, still pointer (BL)', min: 0, max: 20, step: 0.1, note: 'A motionless pointer reads as a standing human.' },
  'pressure.zoneDog': { label: 'Flight zone, moving pointer (BL)', min: 0, max: 40, step: 0.1, note: 'A moving pointer reads as a dog. Real flocks react to one at ~58 BL; compressed to fit a screen.' },
  'pressure.lookahead': { label: 'Lookahead (s)', min: 0, max: 1, step: 0.01, note: 'Sheep react to where the pointer is heading.' },
  'pressure.speedGain': { label: 'Speed gain', min: 0, max: 3, step: 0.05, note: 'Extra pressure from motion that closes on the sheep.' },
  'pressure.directnessGain': { label: 'Head-on gain', min: 0, max: 3, step: 0.05 },
  'pressure.blindFactor': { label: 'Blind-cone sensitivity', min: 0, max: 1, step: 0.01, note: '0 = a threat directly behind is invisible.' },
  'pressure.contagionThreshold': { label: 'Contagion threshold', min: 0, max: 1, step: 0.01, note: 'Fraction of visible neighbours that must be alarmed before fear spreads.' },
  'pressure.transmitCeiling': { label: 'Transmission ceiling', min: 0, max: 1, step: 0.01, note: 'Copied alarm as a fraction of its source. At 1 the flock never calms down.' },
  'pressure.fearTau': { label: 'Fear decay (s)', min: 1, max: 60, step: 0.5 },
  'pressure.arousalTau': { label: 'Arousal decay (s)', min: 5, max: 600, step: 5, note: 'How long a bad scare keeps them jumpy.' },
  'pressure.habituationStrength': { label: 'Habituation strength', min: 0, max: 1, step: 0.01, note: 'How much the flight zone shrinks for a threat that never presses.' },
  'pressure.habituationGainTau': { label: 'Habituation gain (s)', min: 2, max: 300, step: 1 },
  'pressure.habituationBreak': { label: 'Habituation break', min: 0, max: 1, step: 0.01, note: 'Pressure above this destroys the tolerance built up.' },
  'fear.alertEnter': { label: 'Look up at', min: 0, max: 1, step: 0.01 },
  'fear.walkEnter': { label: 'Walk away at', min: 0, max: 1, step: 0.01 },
  'fear.runEnter': { label: 'Bolt at', min: 0, max: 1, step: 0.01 },
  'fear.startleEnter': { label: 'Startle at', min: 0, max: 1, step: 0.01 },
  'flee.centroidBend': { label: 'Bend toward the flock', min: 0, max: 3, step: 0.05, note: 'Selfish herd: flee through the middle rather than straight away.' },
  'flee.obstacleRadius': { label: 'Obstacle radius (BL)', min: 0, max: 12, step: 0.1, note: 'How close a sheep will path to the pointer whatever it is feeling. This is what makes you something to walk around rather than only something to fear.' },
  'flee.obstacleWeight': { label: 'Obstacle firmness', min: 0, max: 3, step: 0.05 },
  'flee.blockedAngleDeg': { label: 'Blocking corridor (deg)', min: 0, max: 90, step: 1, note: 'How directly you must stand between a sheep and the rest of the flock before it gives up on rejoining. Wider makes shedding easier.' },
  'flee.blockedReach': { label: 'Blocking reach', min: 0, max: 3, step: 0.05, note: 'How far past the flock centre you can stand and still block the way back.' },
  'flee.splitPressure': { label: 'Split pressure', min: 0, max: 1, step: 0.01, note: 'Press harder than this and the flock fractures.' },
  'flee.balanceInterest': { label: 'Point of balance, push', min: 0, max: 2, step: 0.05 },
  'flee.balanceDanger': { label: 'Point of balance, block', min: 0, max: 2, step: 0.05 },
  'run.speed': { label: 'Run speed (BL/s)', min: 0.5, max: 10, step: 0.1 },
  'run.sprintSpeed': { label: 'Sprint speed (BL/s)', min: 0.5, max: 14, step: 0.1 },
  'run.cohesion': { label: 'Cohesion', min: 0, max: 3, step: 0.01, note: 'Strength of the pull toward the local centre while running.' },
  'run.align': { label: 'Alignment', min: 0, max: 2, step: 0.05, note: 'Keep low. Sheep do not align like birds.' },
  'run.isolationDist': { label: 'Isolation distance (BL)', min: 1, max: 30, step: 0.5 },
  'walk.speed': { label: 'Walk speed (BL/s)', min: 0.1, max: 4, step: 0.05 },
  'walk.spontaneousRate': { label: 'Wanderlust', min: 0, max: 0.5, step: 0.005, note: 'Group rate of setting off; divided by group size.' },
  'walk.followGap': { label: 'Following gap (BL)', min: 0.5, max: 5, step: 0.1 },
  'walk.behindProb': { label: 'Fall in behind', min: 0, max: 1, step: 0.01, note: 'Otherwise the follower walks alongside.' },
  'graze.repelDist': { label: 'Grazing spacing (BL)', min: 0.5, max: 10, step: 0.1 },
  'sheep.fovDeg': { label: 'Field of view (deg)', min: 90, max: 360, step: 5 },
  'sheep.kVisible': { label: 'Neighbours tracked', min: 2, max: 8, step: 1, note: 'Topological neighbourhood. Fewer means the flock splits more readily.' },
  'sheep.contactRadius': { label: 'Body radius (BL)', min: 0.1, max: 1.5, step: 0.01 },
  'sheep.gatherCell': { label: 'Grid cell (BL)', min: 1, max: 8, step: 0.5, note: 'Performance only. 2 suits a packed flock.' },
  'group.shedTolerance': { label: 'Self-sufficient group size', min: 1, max: 16, step: 1, note: 'A group this size or larger stands on its own and stops seeking the rest. Raised automatically for big flocks, to a quarter of the count.' },
  'group.flockPull': { label: 'Pull to the group', min: 0, max: 3, step: 0.02, note: 'Steady pull toward the centre of the group a sheep is in. This is what keeps a flock one flock; lower it and the flock spreads and is harder to drive. It deliberately does not reach across a cut, so it will not heal one.' },
  'group.flockSpread': { label: 'Comfortable group radius', min: 0.2, max: 2.5, step: 0.05, note: 'How much room a group gives itself, as a multiple of the square root of its size. Below this radius the pull to the group fades, so a calm flock spreads out to graze instead of huddling.' },
  'group.driftTogether': { label: 'Drift back together', min: 0, max: 1.5, step: 0.01, note: 'A weak pull between separate groups, so a flock left alone reunites over minutes and does not slowly shatter into clumps. Raise it and sheds heal too quickly to work with; drop it to zero and every accidental split is permanent.' },
  'group.strayDist': { label: 'Stray distance (BL)', min: 1, max: 40, step: 0.5 },
  'pbd.iterations': { label: 'Solver iterations', min: 1, max: 8, step: 1 },
  'pbd.stiffness': { label: 'Stiffness', min: 0, max: 1, step: 0.01 },
};

const HIDDEN = new Set(['seed', 'count', 'world.width', 'world.height', 'behaviourEnabled', 'steering.slots']);

function titleise(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase().replace(/\bdeg\b/, '(deg)');
}

/** A workable range when nothing better is known: never negative, generous above the default. */
function derive(value: number): { min: number; max: number; step: number } {
  const mag = Math.abs(value);
  const max = mag === 0 ? 1 : mag <= 1 ? Math.max(1, mag * 4) : mag * 4;
  const step = max <= 2 ? 0.01 : max <= 20 ? 0.05 : max <= 200 ? 0.5 : 5;
  return { min: 0, max: Number(max.toFixed(4)), step };
}

function isPair(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number';
}

function walk(obj: Record<string, unknown>, prefix: string, out: ParamSpec[]): void {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (HIDDEN.has(path)) continue;
    const rebuild = REBUILD.has(path) || REBUILD_PREFIX.some((p) => path.startsWith(p));
    if (typeof value === 'boolean') {
      out.push({ path, label: titleise(key), min: 0, max: 1, step: 1, pair: false, boolean: true, rebuild, ...OVERRIDES[path] });
    } else if (typeof value === 'number') {
      out.push({ path, label: titleise(key), ...derive(value), pair: false, boolean: false, rebuild, ...OVERRIDES[path] });
    } else if (isPair(value)) {
      const d = derive(Math.max(Math.abs(value[0]), Math.abs(value[1])));
      out.push({ path, label: titleise(key), ...d, pair: true, boolean: false, rebuild, ...OVERRIDES[path] });
    } else if (value && typeof value === 'object') {
      walk(value as Record<string, unknown>, path, out);
    }
  }
}

let cached: GroupSpec[] | null = null;

/** The tunable parameters, grouped. Computed once from the defaults. */
export function tuningSchema(): GroupSpec[] {
  if (cached) return cached;
  const defaults = defaultConfig() as unknown as Record<string, unknown>;
  cached = GROUPS.filter((g) => defaults[g.key] !== undefined).map((g) => {
    const params: ParamSpec[] = [];
    walk(defaults[g.key] as Record<string, unknown>, g.key, params);
    return { ...g, params };
  }).filter((g) => g.params.length > 0);
  return cached;
}

export function getPath(cfg: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], cfg);
}

/** Set a dotted path on a plain object, creating intermediate objects. Returns the same object. */
export function setPath<T>(target: T, path: string, value: unknown): T {
  const keys = path.split('.');
  let node = target as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof node[keys[i]] !== 'object' || node[keys[i]] === null) node[keys[i]] = {};
    node = node[keys[i]] as Record<string, unknown>;
  }
  node[keys[keys.length - 1]] = value;
  return target;
}

/** Only the values that differ from the defaults, as a patch you can paste into config.ts. */
export function diffFromDefaults(cfg: SimConfig): Record<string, unknown> {
  const defaults = defaultConfig();
  const out: Record<string, unknown> = {};
  for (const group of tuningSchema()) {
    for (const p of group.params) {
      const a = getPath(cfg, p.path);
      const b = getPath(defaults, p.path);
      if (JSON.stringify(a) !== JSON.stringify(b)) setPath(out, p.path, a);
    }
  }
  return out;
}

export function paramCount(): number {
  return tuningSchema().reduce((n, g) => n + g.params.length, 0);
}
