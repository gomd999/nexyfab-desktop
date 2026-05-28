/**
 * Pipe thread hole rows — NPT (tapered) + BSP (parallel).
 *
 * Sources:
 * - ANSI/ASME B1.20.1 (NPT — National Pipe Taper)
 * - ISO 228-1 (BSP — British Standard Pipe, also G-thread parallel)
 *
 * Notes:
 * - NPT is tapered (1:16 taper), so "tap drill" is the average drill size
 *   recommended for cutting the female thread; the exact dimensions vary
 *   along the taper length. We use the standard recommended drill from
 *   Machinery's Handbook.
 * - BSP rows here are PARALLEL (G-thread / Rp). BSPT (tapered) shares the
 *   same nominal sizes but is a separate spec; for Track C1 we ship BSP
 *   parallel which covers fluid-fitting and pressure-port use cases.
 * - `nominal` in this file is the trade-size O.D. equivalent in mm (NPT 1/8
 *   has a nominal O.D. ≈ 10.29 mm). It is NOT the major diameter of the
 *   thread — pipe threads use trade size as their identity.
 * - `clearance` for pipe threads is set equal to the recommended tap drill —
 *   you do NOT drill a pass-through clearance for a pipe thread; the hole
 *   IS the thread. We keep the field populated so the schema stays uniform.
 * - Fit class is intentionally a single value (close = normal = loose) since
 *   pipe-thread "fit" is governed by the L1 thread engagement spec, not by
 *   diameter offsets. We expose `fits` so the schema is uniform for tests.
 */

import type { HoleStandardSpec } from './holeStandards';

function pipeFits(tapDrillMm: number): { close: number; normal: number; loose: number } {
  // Pipe threads have a single recommended drill; "fit class" doesn't apply
  // in the ISO 273 sense. We expose a flat-but-monotonic-strict triple so
  // tests can still verify strict-monotonic ordering uniformly.
  return {
    close: +(tapDrillMm - 0.05).toFixed(2),
    normal: tapDrillMm,
    loose: +(tapDrillMm + 0.05).toFixed(2),
  };
}

/**
 * NPT — National Pipe Taper (ANSI/ASME B1.20.1).
 * Trade sizes 1/16 through 1/2; tap drill is the recommended drill for
 * cutting an internal NPT thread.
 */
export const NPT_PIPE: HoleStandardSpec[] = [
  // name  | trade O.D. (mm) | TPI | tap drill (mm)
  { standard: 'NPT', name: 'NPT 1/16', unit: 'in', nominal: 8.13,  pitch: 0,    tpi: 27, clearance: 6.35,  tapDrill: 6.35,  counterboreDia: 8.13,  counterboreDepth: 0, countersinkDia: 8.13,  countersinkAngle: 90, fits: pipeFits(6.35) },
  { standard: 'NPT', name: 'NPT 1/8',  unit: 'in', nominal: 10.29, pitch: 0,    tpi: 27, clearance: 8.74,  tapDrill: 8.74,  counterboreDia: 10.29, counterboreDepth: 0, countersinkDia: 10.29, countersinkAngle: 90, fits: pipeFits(8.74) },
  { standard: 'NPT', name: 'NPT 1/4',  unit: 'in', nominal: 13.72, pitch: 0,    tpi: 18, clearance: 11.51, tapDrill: 11.51, counterboreDia: 13.72, counterboreDepth: 0, countersinkDia: 13.72, countersinkAngle: 90, fits: pipeFits(11.51) },
  { standard: 'NPT', name: 'NPT 3/8',  unit: 'in', nominal: 17.15, pitch: 0,    tpi: 18, clearance: 14.91, tapDrill: 14.91, counterboreDia: 17.15, counterboreDepth: 0, countersinkDia: 17.15, countersinkAngle: 90, fits: pipeFits(14.91) },
  { standard: 'NPT', name: 'NPT 1/2',  unit: 'in', nominal: 21.34, pitch: 0,    tpi: 14, clearance: 18.65, tapDrill: 18.65, counterboreDia: 21.34, counterboreDepth: 0, countersinkDia: 21.34, countersinkAngle: 90, fits: pipeFits(18.65) },
];

/**
 * BSP — British Standard Pipe parallel (G-thread, ISO 228-1).
 * Trade sizes 1/16 through 1/2; tap drill is the recommended drill for
 * a parallel internal BSP thread (Rp / G).
 */
export const BSP_PIPE: HoleStandardSpec[] = [
  { standard: 'BSP', name: 'G 1/16',   unit: 'in', nominal: 7.72,  pitch: 0.907, tpi: 28, clearance: 6.80,  tapDrill: 6.80,  counterboreDia: 7.72,  counterboreDepth: 0, countersinkDia: 7.72,  countersinkAngle: 90, fits: pipeFits(6.80) },
  { standard: 'BSP', name: 'G 1/8',    unit: 'in', nominal: 9.73,  pitch: 0.907, tpi: 28, clearance: 8.80,  tapDrill: 8.80,  counterboreDia: 9.73,  counterboreDepth: 0, countersinkDia: 9.73,  countersinkAngle: 90, fits: pipeFits(8.80) },
  { standard: 'BSP', name: 'G 1/4',    unit: 'in', nominal: 13.16, pitch: 1.337, tpi: 19, clearance: 11.80, tapDrill: 11.80, counterboreDia: 13.16, counterboreDepth: 0, countersinkDia: 13.16, countersinkAngle: 90, fits: pipeFits(11.80) },
  { standard: 'BSP', name: 'G 3/8',    unit: 'in', nominal: 16.66, pitch: 1.337, tpi: 19, clearance: 15.25, tapDrill: 15.25, counterboreDia: 16.66, counterboreDepth: 0, countersinkDia: 16.66, countersinkAngle: 90, fits: pipeFits(15.25) },
  { standard: 'BSP', name: 'G 1/2',    unit: 'in', nominal: 20.96, pitch: 1.814, tpi: 14, clearance: 19.00, tapDrill: 19.00, counterboreDia: 20.96, counterboreDepth: 0, countersinkDia: 20.96, countersinkAngle: 90, fits: pipeFits(19.00) },
];
