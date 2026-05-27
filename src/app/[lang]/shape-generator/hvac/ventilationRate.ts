/**
 * ventilationRate.ts — Compute the required outdoor-air ventilation rate
 * for a zone per ASHRAE 62.1 (ventilation rate procedure), then the
 * system intake accounting for zone + system ventilation efficiency.
 *
 *   breathing-zone OA:  Vbz = Rp·Pz + Ra·Az
 *   zone OA:            Voz = Vbz / Ez       (Ez = zone air distribution eff)
 *   system OA (approx): Vot = Voz / Ev       (Ev system ventilation eff)
 *
 * Rp (per person) and Ra (per area) come from the occupancy category.
 * Output in L/s and m³/h, plus the OA fraction of supply airflow.
 */

export type OccupancyCategory = 'office' | 'classroom' | 'retail' | 'conference' | 'lobby' | 'gym' | 'lab';

interface CategoryRates {
  rpLsPerson: number;   // L/s per person
  raLpsM2: number;      // L/s per m²
  defaultDensityPer100m2: number;
}

const RATES: Record<OccupancyCategory, CategoryRates> = {
  office:     { rpLsPerson: 2.5, raLpsM2: 0.3, defaultDensityPer100m2: 5 },
  classroom:  { rpLsPerson: 5.0, raLpsM2: 0.6, defaultDensityPer100m2: 35 },
  retail:     { rpLsPerson: 3.8, raLpsM2: 0.6, defaultDensityPer100m2: 15 },
  conference: { rpLsPerson: 2.5, raLpsM2: 0.3, defaultDensityPer100m2: 50 },
  lobby:      { rpLsPerson: 2.5, raLpsM2: 0.3, defaultDensityPer100m2: 10 },
  gym:        { rpLsPerson: 10,  raLpsM2: 0.3, defaultDensityPer100m2: 7 },
  lab:        { rpLsPerson: 5.0, raLpsM2: 0.9, defaultDensityPer100m2: 25 },
};

export interface VentilationRateInput {
  category: OccupancyCategory;
  floorAreaM2: number;
  occupants?: number;          // if omitted, use default density
  zoneAirDistEffEz?: number;   // default 1.0 (ceiling supply/return)
  systemVentEffEv?: number;    // default 1.0 (single zone)
  supplyFlowLps?: number;      // for OA fraction
}

export interface VentilationRateResult {
  occupants: number;
  breathingZoneOALps: number;  // Vbz
  zoneOALps: number;           // Voz
  systemOALps: number;         // Vot
  systemOAM3H: number;
  oaFractionOfSupply: number | null;
  warnings: string[];
}

export function compute(input: VentilationRateInput): VentilationRateResult {
  const warnings: string[] = [];
  const rates = RATES[input.category];
  if (!rates) warnings.push(`Unknown category "${input.category}".`);
  const r = rates ?? RATES.office;
  if (input.floorAreaM2 <= 0) warnings.push('Floor area must be positive.');

  const occupants = input.occupants ?? Math.ceil((r.defaultDensityPer100m2 / 100) * input.floorAreaM2);
  const Vbz = r.rpLsPerson * occupants + r.raLpsM2 * input.floorAreaM2;

  const Ez = input.zoneAirDistEffEz ?? 1.0;
  const Voz = Ez > 0 ? Vbz / Ez : Vbz;
  const Ev = input.systemVentEffEv ?? 1.0;
  const Vot = Ev > 0 ? Voz / Ev : Voz;

  const oaFraction = (input.supplyFlowLps && input.supplyFlowLps > 0) ? Vot / input.supplyFlowLps : null;
  if (oaFraction != null && oaFraction > 1) warnings.push('Required OA exceeds supply flow — increase supply or use DOAS.');

  return {
    occupants,
    breathingZoneOALps: Vbz,
    zoneOALps: Voz,
    systemOALps: Vot,
    systemOAM3H: Vot * 3.6,
    oaFractionOfSupply: oaFraction,
    warnings,
  };
}

/** Air changes per hour from OA rate + room volume. */
export function airChangesPerHour(systemOALps: number, roomVolumeM3: number): number {
  if (roomVolumeM3 <= 0) return 0;
  return (systemOALps * 3.6) / roomVolumeM3;
}

export function summarize(r: VentilationRateResult): { systemOALps: number; systemOAM3H: number; occupants: number } {
  return { systemOALps: r.systemOALps, systemOAM3H: r.systemOAM3H, occupants: r.occupants };
}
