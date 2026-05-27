/**
 * steamPipeSizing.ts — Size a steam (or gas) pipe diameter from mass flow
 * + specific volume, holding the velocity within a recommended band, then
 * pick the next standard nominal bore.
 *
 *   volumeFlow = massFlowKgH · specificVolumeM3Kg / 3600   [m³/s]
 *   area       = volumeFlow / velocity
 *   diameter   = sqrt(4·area/π)
 *
 * Recommended steam velocities: saturated 25–40 m/s, superheated 40–60
 * m/s, condensate/wet < 15 m/s. We compute the ideal bore for a target
 * velocity, then the actual velocity at the chosen standard NB.
 */

export type SteamService = 'saturated' | 'superheated' | 'wet' | 'condensate';

const TARGET_VELOCITY: Record<SteamService, number> = {
  saturated: 30, superheated: 50, wet: 20, condensate: 12,
};

// Standard nominal bores (mm).
const STD_NB = [15, 20, 25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300];

export interface SteamPipeInput {
  massFlowKgH: number;
  specificVolumeM3Kg: number;  // v_g at pressure (≈0.19 @ 10 bar sat)
  service: SteamService;
  targetVelocityOverrideMS?: number;
}

export interface SteamPipeResult {
  volumeFlowM3S: number;
  targetVelocityMS: number;
  idealBoreMm: number;
  selectedNbMm: number;
  actualVelocityMS: number;
  velocityOk: boolean;
  warnings: string[];
}

export function size(input: SteamPipeInput): SteamPipeResult {
  const warnings: string[] = [];
  if (input.massFlowKgH <= 0) warnings.push('Mass flow must be positive.');
  if (input.specificVolumeM3Kg <= 0) warnings.push('Specific volume must be positive.');

  const vTarget = input.targetVelocityOverrideMS ?? TARGET_VELOCITY[input.service] ?? 30;
  const volumeFlow = (input.massFlowKgH * input.specificVolumeM3Kg) / 3600; // m³/s

  const idealArea = vTarget > 0 ? volumeFlow / vTarget : 0;
  const idealBore = Math.sqrt((4 * idealArea) / Math.PI) * 1000; // mm

  const selected = STD_NB.find(nb => nb >= idealBore) ?? STD_NB[STD_NB.length - 1]!;
  if (idealBore > STD_NB[STD_NB.length - 1]!) warnings.push('Required bore exceeds 300 mm NB; use a larger main or split flow.');

  const actualArea = (Math.PI / 4) * Math.pow(selected / 1000, 2);
  const actualVel = actualArea > 0 ? volumeFlow / actualArea : 0;

  // Velocity ok if within ±40% of the band centre (chosen NB is a step up).
  const velocityOk = actualVel <= vTarget * 1.1;
  if (actualVel > vTarget * 1.1) warnings.push(`Velocity ${actualVel.toFixed(1)} m/s above target ${vTarget} m/s; step up a size.`);

  return {
    volumeFlowM3S: volumeFlow,
    targetVelocityMS: vTarget,
    idealBoreMm: idealBore,
    selectedNbMm: selected,
    actualVelocityMS: actualVel,
    velocityOk,
    warnings,
  };
}

/** Velocity at a given nominal bore for the same flow. */
export function velocityAtNb(volumeFlowM3S: number, nbMm: number): number {
  const area = (Math.PI / 4) * Math.pow(nbMm / 1000, 2);
  return area > 0 ? volumeFlowM3S / area : 0;
}

export function summarize(r: SteamPipeResult): { selectedNbMm: number; actualVelocityMS: number; velocityOk: boolean } {
  return { selectedNbMm: r.selectedNbMm, actualVelocityMS: r.actualVelocityMS, velocityOk: r.velocityOk };
}
