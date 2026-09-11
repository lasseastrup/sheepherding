/**
 * Simulation configuration. Units: body lengths (BL) and seconds unless noted.
 * Defaults follow docs/flock-design.md; every value is a tuning knob.
 */
export interface SimConfig {
  seed: number;
  count: number;
  dt: number;
  world: { width: number; height: number };
  spawn: { spacing: number };
  sheep: {
    contactRadius: number;
    kVisible: number;
    fovDeg: number;
    occlusionDeg: number;
    gatherCell: number;
  };
  personality: {
    scale: [number, number];
    boldness: [number, number];
    gregarious: [number, number];
    reactionDelay: [number, number];
    fearDecay: [number, number];
    speedMult: [number, number];
    grazeBias: [number, number];
  };
  graze: {
    stepInterval: [number, number];
    stepDist: [number, number];
    stepSpeed: number;
    headingNoiseDeg: number;
    repelDist: number;
    repelWeight: number;
    rejoinDist: number;
    rejoinWeight: number;
  };
  walk: {
    speed: number;
    followGap: number;
    behindProb: number;
    spontaneousRate: number;
    mimetic: { a: number; b: number; g: number };
    stop: { a: number; b: number; g: number };
    initiatorPersistence: number;
    initiatorPersistTime: number;
    initiatorTimeout: number;
    initiatorDuration: [number, number];
    spontaneousStopRate: number;
    arrivalRate: number;
    arrivalDist: number;
    headingNoiseDeg: number;
    cohesionWeight: number;
  };
  run: {
    speed: number;
    sprintSpeed: number;
    isolationDist: number;
    isolationRate: number;
    dispersalRef: number;
    dispersalRatio: number;
    dispersalRate: number;
    mimetic: { tau: number; a: number; d: number; g: number; refractory: number };
    stop: { tau: number; a: number; d: number; closeDist: number; packedDist: number; maxDuration: number; stuckSpeed: number; stuckTime: number };
    cohesion: number;
    cohesionCentroidMix: number;
    repel: number;
    repelDist: number;
    align: number;
    threatRepel: number;
    noise: number;
    noiseTau: number;
    staminaDrain: number;
    staminaRefill: number;
  };
  alert: {
    duration: [number, number];
    calmTime: [number, number];
  };
  kinematics: {
    turnRateDeg: { graze: number; alert: number; walk: number; run: number };
    accelTau: { graze: number; walk: number; run: number };
    decelTau: { graze: number; walk: number; run: number };
    movingThreshold: number;
  };
  steering: {
    slots: number;
    maskMargin: number;
    neighbourDangerDist: number;
    neighbourDangerWeight: number;
  };
  pressure: {
    lookahead: number;
    idleSpeed: number;
    dogSpeed: number;
    zoneIdle: number;
    zoneDog: number;
    outerScale: number;
    innerScale: number;
    speedGain: number;
    directnessGain: number;
    blindFactor: number;
    blindProximity: number;
    contagionGain: number;
    contagionThreshold: number;
    contagionBypassFear: number;
    alarmedThreshold: number;
    towardBoost: number;
    transmitCeiling: number;
    fearTau: number;
    fearTauPacked: number;
    packedDist: number;
    arousalGain: number;
    arousalTau: number;
    lonelyFear: number;
    habituationStrength: number;
    habituationGainTau: number;
    habituationLossTau: number;
    habituationBreak: number;
    habituationForgetTau: number;
  };
  fear: {
    alertEnter: number;
    alertExit: number;
    walkEnter: number;
    runEnter: number;
    startleEnter: number;
    startleJump: number;
    alertMimeticRate: number;
    walkRate: number;
  };
  flee: {
    dangerWeight: number;
    interestWeight: number;
    centroidBend: number;
    centroidBendPacked: number;
    balanceInterest: number;
    balanceDanger: number;
    balanceAngleDeg: number;
    splitPressure: number;
    splitDuration: number;
    splitNeighbours: number;
    lonelyDangerScale: number;
    lonelyCohesion: number;
  };
  group: {
    linkDist: number;
    comfortable: number;
    strayDist: number;
    rejoinWeight: number;
    rejoinRunWeight: number;
    threatMemory: number;
  };
  fences: { dangerStart: number; dangerFull: number };
  pbd: { iterations: number; stiffness: number; slack: number; friction: number; xsph: number };
  behaviourEnabled: boolean;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function defaultConfig(): SimConfig {
  return {
    seed: 1,
    count: 20,
    dt: 1 / 30,
    world: { width: 40, height: 22 },
    spawn: { spacing: 1.3 },
    sheep: {
      contactRadius: 0.45,
      kVisible: 6,
      fovDeg: 300,
      occlusionDeg: 12,
      gatherCell: 2,
    },
    personality: {
      scale: [0.9, 1.1],
      boldness: [0.6, 1.4],
      gregarious: [0.7, 1.3],
      reactionDelay: [0.3, 1.2],
      fearDecay: [0.7, 1.3],
      speedMult: [0.88, 1.12],
      grazeBias: [0.7, 1.3],
    },
    graze: {
      stepInterval: [5, 20],
      stepDist: [0.5, 2.0],
      stepSpeed: 0.3,
      headingNoiseDeg: 30,
      repelDist: 2.5,
      repelWeight: 1.0,
      rejoinDist: 4.0,
      rejoinWeight: 0.6,
    },
    walk: {
      speed: 1.15,
      followGap: 1.4,
      behindProb: 0.8,
      spontaneousRate: 0.05,
      mimetic: { a: 0.32, b: 0.61, g: 0.71 },
      stop: { a: 0.42, b: 0.48, g: 0.54 },
      initiatorPersistence: 0.1,
      initiatorPersistTime: 10,
      initiatorTimeout: 15,
      initiatorDuration: [6, 15],
      spontaneousStopRate: 0.05,
      arrivalRate: 2.0,
      arrivalDist: 1.5,
      headingNoiseDeg: 15,
      cohesionWeight: 0.4,
    },
    run: {
      speed: 3.5,
      sprintSpeed: 6.0,
      isolationDist: 8,
      isolationRate: 0.02,
      dispersalRef: 3.5,
      dispersalRatio: 2.0,
      dispersalRate: 0.004,
      mimetic: { tau: 4, a: 1.0, d: 2.0, g: 1.0, refractory: 1.5 },
      stop: { tau: 3, a: 2.5, d: 2.5, closeDist: 1.5, packedDist: 2.0, maxDuration: 6, stuckSpeed: 0.6, stuckTime: 1.5 },
      cohesion: 1.05,
      cohesionCentroidMix: 0.5,
      repel: 1.0,
      repelDist: 1.2,
      align: 0.3,
      threatRepel: 1.4,
      noise: 0.3,
      noiseTau: 1.5,
      staminaDrain: 0.35,
      staminaRefill: 0.1,
    },
    alert: {
      duration: [1, 5],
      calmTime: [2, 6],
    },
    kinematics: {
      turnRateDeg: { graze: 90, alert: 90, walk: 180, run: 360 },
      accelTau: { graze: 0.4, walk: 0.4, run: 0.3 },
      decelTau: { graze: 0.8, walk: 0.8, run: 0.6 },
      movingThreshold: 0.15,
    },
    steering: {
      slots: 16,
      maskMargin: 0.1,
      neighbourDangerDist: 1.2,
      neighbourDangerWeight: 0.8,
    },
    pressure: {
      lookahead: 0.2,
      idleSpeed: 0.3,
      dogSpeed: 2.0,
      zoneIdle: 3,
      zoneDog: 8,
      outerScale: 1.5,
      innerScale: 0.35,
      speedGain: 0.6,
      directnessGain: 0.5,
      blindFactor: 0.3,
      blindProximity: 2,
      contagionGain: 0.9,
      contagionThreshold: 0.35,
      contagionBypassFear: 0.5,
      alarmedThreshold: 0.4,
      towardBoost: 1.6,
      transmitCeiling: 0.85,
      fearTau: 12,
      fearTauPacked: 6,
      packedDist: 2,
      arousalGain: 0.6,
      arousalTau: 120,
      lonelyFear: 0.3,
      habituationStrength: 0.45,
      habituationGainTau: 40,
      habituationLossTau: 5,
      habituationBreak: 0.8,
      habituationForgetTau: 300,
    },
    fear: {
      alertEnter: 0.15,
      alertExit: 0.12,
      walkEnter: 0.25,
      runEnter: 0.45,
      startleEnter: 0.6,
      startleJump: 0.3,
      alertMimeticRate: 1.0,
      walkRate: 1.5,
    },
    flee: {
      dangerWeight: 1.4,
      interestWeight: 1.2,
      centroidBend: 0.8,
      centroidBendPacked: 1.6,
      balanceInterest: 0.4,
      balanceDanger: 0.5,
      balanceAngleDeg: 70,
      splitPressure: 0.85,
      splitDuration: 3,
      splitNeighbours: 3,
      lonelyDangerScale: 0.5,
      lonelyCohesion: 2,
    },
    group: {
      linkDist: 6,
      comfortable: 4,
      strayDist: 8,
      rejoinWeight: 1.1,
      rejoinRunWeight: 0.9,
      threatMemory: 12,
    },
    fences: { dangerStart: 3, dangerFull: 0.5 },
    pbd: { iterations: 3, stiffness: 0.6, slack: 0.97, friction: 0.3, xsph: 0.3 },
    behaviourEnabled: true,
  };
}

/** Deep-merge a partial config over a base config, returning a new object. */
export function mergeConfig<T extends object>(base: T, patch: DeepPartial<T> | undefined): T {
  if (!patch) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(patch) as (keyof T & string)[]) {
    const pv = (patch as Record<string, unknown>)[key];
    const bv = (base as Record<string, unknown>)[key];
    if (pv === undefined) continue;
    if (pv !== null && typeof pv === 'object' && !Array.isArray(pv) && bv !== null && typeof bv === 'object' && !Array.isArray(bv)) {
      out[key] = mergeConfig(bv as object, pv as DeepPartial<object>);
    } else {
      out[key] = pv;
    }
  }
  return out as T;
}
