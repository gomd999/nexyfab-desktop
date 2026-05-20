/**
 * gearTrainRatio.ts — Compute the overall ratio, output speed/torque, and
 * per-stage loads of a multi-stage gear train (simple or compound).
 *
 * For a simple train, idlers don't change the magnitude of the ratio
 * (only direction). For a compound train, each stage multiplies:
 *
 *   total ratio = Π (driven_teeth / driver_teeth)
 *   output speed = input speed / total ratio
 *   output torque = input torque · total ratio · efficiency
 *
 * Direction (sign) flips once per external mesh. We also report the
 * cumulative ratio and torque at each stage for sizing intermediate
 * shafts/bearings.
 */

export interface GearStage {
  driverTeeth: number;
  drivenTeeth: number;
  efficiency?: number; // per mesh, default 0.97
}

export interface GearTrainInput {
  stages: GearStage[];
  inputSpeedRpm: number;
  inputTorqueNm: number;
}

export interface StageResult {
  stageIndex: number;
  stageRatio: number;
  cumulativeRatio: number;
  shaftSpeedRpm: number;   // speed of the driven shaft after this stage
  shaftTorqueNm: number;   // torque on the driven shaft after this stage
}

export interface GearTrainResult {
  totalRatio: number;
  outputSpeedRpm: number;
  outputTorqueNm: number;
  direction: 1 | -1;       // +1 same as input, −1 reversed
  overallEfficiency: number;
  stages: StageResult[];
  warnings: string[];
}

export function compute(input: GearTrainInput): GearTrainResult {
  const warnings: string[] = [];
  if (input.stages.length === 0) warnings.push('No gear stages provided.');

  let cumRatio = 1;
  let speed = input.inputSpeedRpm;
  let torque = input.inputTorqueNm;
  let efficiency = 1;
  let direction: 1 | -1 = 1;

  const stages: StageResult[] = input.stages.map((s, i) => {
    if (s.driverTeeth <= 0 || s.drivenTeeth <= 0) {
      warnings.push(`Stage ${i + 1} has non-positive teeth count.`);
    }
    const ratio = s.driverTeeth > 0 ? s.drivenTeeth / s.driverTeeth : 0;
    const eff = s.efficiency ?? 0.97;
    cumRatio *= ratio;
    efficiency *= eff;
    direction = (direction * -1) as 1 | -1; // each external mesh reverses
    speed = ratio > 0 ? speed / ratio : 0;
    torque = torque * ratio * eff;
    return {
      stageIndex: i,
      stageRatio: ratio,
      cumulativeRatio: cumRatio,
      shaftSpeedRpm: speed,
      shaftTorqueNm: torque,
    };
  });

  return {
    totalRatio: cumRatio,
    outputSpeedRpm: cumRatio > 0 ? input.inputSpeedRpm / cumRatio : 0,
    outputTorqueNm: input.inputTorqueNm * cumRatio * efficiency,
    direction,
    overallEfficiency: efficiency,
    stages,
    warnings,
  };
}

/** Pick stage ratios to hit a target total ratio with a max per-stage ratio. */
export function distributeRatio(targetRatio: number, maxStageRatio: number = 6): number[] {
  if (targetRatio <= 1) return [targetRatio];
  const nStages = Math.ceil(Math.log(targetRatio) / Math.log(maxStageRatio));
  const perStage = Math.pow(targetRatio, 1 / nStages);
  return Array.from({ length: nStages }, () => perStage);
}

/** Is the train speed-reducing (ratio>1) or increasing (<1)? */
export function trainType(result: GearTrainResult): 'reducer' | 'overdrive' | 'direct' {
  if (result.totalRatio > 1.0001) return 'reducer';
  if (result.totalRatio < 0.9999) return 'overdrive';
  return 'direct';
}

export function summarize(r: GearTrainResult): { totalRatio: number; outputSpeedRpm: number; outputTorqueNm: number } {
  return { totalRatio: r.totalRatio, outputSpeedRpm: r.outputSpeedRpm, outputTorqueNm: r.outputTorqueNm };
}
