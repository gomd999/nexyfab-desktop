/**
 * economizerChangeover.ts — Decide whether an air-side economizer should
 * use outdoor air for "free cooling", using dry-bulb or enthalpy
 * (high-limit) changeover logic, and estimate the free-cooling fraction.
 *
 * Dry-bulb changeover: enable economizer when T_outdoor < T_changeover.
 * Enthalpy (differential) changeover: enable when h_outdoor < h_return
 * (outdoor air carries less total heat than the air being exhausted).
 *
 * When enabled and outdoor air alone can't fully meet the cooling
 * setpoint, the economizer modulates the OA damper to hold the mixed-air
 * (supply) temperature, blending with return air. We compute the OA
 * fraction needed and whether mechanical cooling is still required.
 */

export type ChangeoverMode = 'dry-bulb' | 'enthalpy' | 'differential-enthalpy';

export interface EconomizerInput {
  outdoorDryBulbC: number;
  outdoorEnthalpyKJkg?: number;
  returnDryBulbC: number;
  returnEnthalpyKJkg?: number;
  supplySetpointC: number;     // mixed-air target
  changeoverMode: ChangeoverMode;
  dryBulbLimitC?: number;      // for dry-bulb mode, default 18
  minOutdoorFraction?: number; // ventilation minimum, default 0.15
}

export interface EconomizerResult {
  economizerEnabled: boolean;
  outdoorAirFraction: number;  // damper position 0..1
  mechanicalCoolingNeeded: boolean;
  freeCoolingFraction: number; // fraction of cooling met by OA
  reason: string;
  warnings: string[];
}

export function evaluate(input: EconomizerInput): EconomizerResult {
  const warnings: string[] = [];
  const minOA = input.minOutdoorFraction ?? 0.15;

  let enabled = false;
  let reason = '';
  switch (input.changeoverMode) {
    case 'dry-bulb': {
      const limit = input.dryBulbLimitC ?? 18;
      enabled = input.outdoorDryBulbC < limit;
      reason = enabled ? `OA ${input.outdoorDryBulbC}°C < limit ${limit}°C` : `OA ${input.outdoorDryBulbC}°C ≥ limit ${limit}°C`;
      break;
    }
    case 'enthalpy':
    case 'differential-enthalpy': {
      if (input.outdoorEnthalpyKJkg == null || input.returnEnthalpyKJkg == null) {
        warnings.push('Enthalpy mode needs outdoor + return enthalpy.');
        enabled = false;
        reason = 'missing enthalpy data';
      } else {
        enabled = input.outdoorEnthalpyKJkg < input.returnEnthalpyKJkg;
        reason = enabled ? 'OA enthalpy < return enthalpy' : 'OA enthalpy ≥ return enthalpy';
      }
      break;
    }
  }

  let oaFraction = minOA;
  let mechanical = true;
  let freeFraction = 0;

  if (enabled) {
    // Mixed air: T_mix = f·T_oa + (1−f)·T_ra. Solve f for T_mix = setpoint.
    const Toa = input.outdoorDryBulbC;
    const Tra = input.returnDryBulbC;
    if (Toa < input.supplySetpointC && Tra > input.supplySetpointC) {
      // economizer can hit setpoint by blending.
      const f = (input.supplySetpointC - Tra) / (Toa - Tra);
      oaFraction = Math.max(minOA, Math.min(1, f));
      mechanical = false;
      freeFraction = 1;
    } else if (Toa <= input.supplySetpointC && Tra <= input.supplySetpointC) {
      // both already cold; min OA, no cooling needed.
      oaFraction = minOA;
      mechanical = false;
      freeFraction = 1;
    } else {
      // OA colder than return but not below setpoint enough → 100% OA, still need mech.
      oaFraction = 1;
      mechanical = Toa > input.supplySetpointC;
      // free fraction = how much of the (return→setpoint) gap OA covers.
      const gap = Tra - input.supplySetpointC;
      const covered = Tra - Math.max(Toa, input.supplySetpointC);
      freeFraction = gap > 0 ? Math.max(0, Math.min(1, covered / gap)) : 0;
    }
  }

  return {
    economizerEnabled: enabled,
    outdoorAirFraction: oaFraction,
    mechanicalCoolingNeeded: mechanical,
    freeCoolingFraction: freeFraction,
    reason,
    warnings,
  };
}

/** Mixed-air temperature for a given OA fraction. */
export function mixedAirTempC(outdoorC: number, returnC: number, oaFraction: number): number {
  const f = Math.max(0, Math.min(1, oaFraction));
  return f * outdoorC + (1 - f) * returnC;
}

export function summarize(r: EconomizerResult): { economizerEnabled: boolean; outdoorAirFraction: number; mechanicalCoolingNeeded: boolean } {
  return { economizerEnabled: r.economizerEnabled, outdoorAirFraction: r.outdoorAirFraction, mechanicalCoolingNeeded: r.mechanicalCoolingNeeded };
}
