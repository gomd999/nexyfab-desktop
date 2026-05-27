/**
 * pumpSpecificSpeed.ts — Compute a pump's specific speed Ns, classify the
 * impeller type it implies, and estimate attainable efficiency.
 *
 * Specific speed (SI, rpm·m³/s·m form):
 *   Ns = N · sqrt(Q) / H^0.75
 *
 * (N rpm, Q m³/s per eye, H metres per stage.) Ns governs impeller
 * geometry:
 *   Ns < 30   → radial (low flow, high head)
 *   30–80     → Francis / mixed
 *   80–160    → mixed flow
 *   > 160     → axial (high flow, low head)
 *
 * Attainable peak efficiency rises with flow and an Ns near the optimum
 * band; very low Ns pumps are inherently less efficient.
 */

export type ImpellerType = 'radial' | 'francis' | 'mixed-flow' | 'axial';

export interface PumpSpecificSpeedInput {
  flowM3S: number;          // per impeller eye
  headM: number;            // per stage
  speedRpm: number;
  stages?: number;
  doubleSuction?: boolean;  // halves the flow per eye
}

export interface PumpSpecificSpeedResult {
  specificSpeed: number;
  impellerType: ImpellerType;
  estimatedPeakEfficiency: number; // 0..1
  headPerStageM: number;
  flowPerEyeM3S: number;
  warnings: string[];
}

export function compute(input: PumpSpecificSpeedInput): PumpSpecificSpeedResult {
  const warnings: string[] = [];
  if (input.headM <= 0) warnings.push('Head must be positive.');
  if (input.flowM3S <= 0) warnings.push('Flow must be positive.');

  const stages = Math.max(1, input.stages ?? 1);
  const headPerStage = input.headM / stages;
  const flowPerEye = input.doubleSuction ? input.flowM3S / 2 : input.flowM3S;

  const Ns = headPerStage > 0
    ? input.speedRpm * Math.sqrt(flowPerEye) / Math.pow(headPerStage, 0.75)
    : 0;

  const impellerType = classifyImpeller(Ns);
  const eff = estimateEfficiency(Ns, input.flowM3S);

  return {
    specificSpeed: Ns,
    impellerType,
    estimatedPeakEfficiency: eff,
    headPerStageM: headPerStage,
    flowPerEyeM3S: flowPerEye,
    warnings,
  };
}

function classifyImpeller(Ns: number): ImpellerType {
  if (Ns < 30) return 'radial';
  if (Ns < 80) return 'francis';
  if (Ns < 160) return 'mixed-flow';
  return 'axial';
}

function estimateEfficiency(Ns: number, flowM3S: number): number {
  // Peak efficiency band ~ Ns 40–120; low Ns + low flow penalised.
  let eff = 0.88;
  if (Ns < 20) eff -= 0.20;
  else if (Ns < 40) eff -= 0.08;
  else if (Ns > 200) eff -= 0.10;
  // small pumps lose efficiency.
  if (flowM3S < 0.005) eff -= 0.10;
  else if (flowM3S < 0.02) eff -= 0.04;
  return Math.max(0.3, Math.min(0.92, eff));
}

/** Suggested minimum stages to keep head/stage in a good Ns band. */
export function suggestStages(flowM3S: number, totalHeadM: number, speedRpm: number, targetNsMin = 30): number {
  // Ns = N√Q / (H/stages)^0.75 ≥ targetNsMin → solve stages.
  // (H/stages)^0.75 ≤ N√Q/targetNsMin → H/stages ≤ (...)^(4/3)
  const hPerStageMax = Math.pow(speedRpm * Math.sqrt(flowM3S) / targetNsMin, 4 / 3);
  return hPerStageMax > 0 ? Math.max(1, Math.ceil(totalHeadM / hPerStageMax)) : 1;
}

export function summarize(r: PumpSpecificSpeedResult): { specificSpeed: number; impellerType: ImpellerType; estimatedPeakEfficiency: number } {
  return { specificSpeed: r.specificSpeed, impellerType: r.impellerType, estimatedPeakEfficiency: r.estimatedPeakEfficiency };
}
