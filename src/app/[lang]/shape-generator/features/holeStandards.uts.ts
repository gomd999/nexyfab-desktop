/**
 * ANSI / Unified Thread Standard (UTS) hole rows.
 *
 * UNC (Unified Coarse) + UNF (Unified Fine) per ASME B1.1 (thread spec) and
 * ASME B18.3 (socket cap screw companion dimensions). Diameters are stored in
 * millimetres since the feature pipeline operates in mm; the original imperial
 * name is preserved in `name` for engineer familiarity, and `tpi` (threads
 * per inch) is stored for drawing annotations.
 *
 * Fit-class clearance offsets follow the ASME B18.2.8 "normal / close / loose"
 * convention rather than ISO 273 — the values differ slightly by size and are
 * tabulated per-row.
 */

import type { HoleStandardSpec } from './holeStandards';

/** ANSI/ASME socket-cap-screw companion holes — coarse pitch (UNC). */
export const UNC_INCH: HoleStandardSpec[] = [
  { standard: 'ANSI', name: '#0-80',  unit: 'in', nominal: 1.524, tpi: 80, clearance: 1.85, tapDrill: 1.25, counterboreDia: 3.18, counterboreDepth: 1.70, countersinkDia: 3.05, countersinkAngle: 82, fits: { close: 1.70, normal: 1.85, loose: 2.05 } },
  { standard: 'ANSI', name: '#2-56',  unit: 'in', nominal: 2.184, tpi: 56, clearance: 2.50, tapDrill: 1.80, counterboreDia: 4.37, counterboreDepth: 2.39, countersinkDia: 4.42, countersinkAngle: 82, fits: { close: 2.35, normal: 2.50, loose: 2.78 } },
  { standard: 'ANSI', name: '#4-40',  unit: 'in', nominal: 2.845, tpi: 40, clearance: 3.20, tapDrill: 2.26, counterboreDia: 5.94, counterboreDepth: 3.18, countersinkDia: 5.79, countersinkAngle: 82, fits: { close: 3.05, normal: 3.20, loose: 3.53 } },
  { standard: 'ANSI', name: '#6-32',  unit: 'in', nominal: 3.505, tpi: 32, clearance: 3.97, tapDrill: 2.69, counterboreDia: 6.88, counterboreDepth: 3.78, countersinkDia: 7.14, countersinkAngle: 82, fits: { close: 3.78, normal: 3.97, loose: 4.34 } },
  { standard: 'ANSI', name: '#8-32',  unit: 'in', nominal: 4.166, tpi: 32, clearance: 4.76, tapDrill: 3.40, counterboreDia: 7.94, counterboreDepth: 4.42, countersinkDia: 8.53, countersinkAngle: 82, fits: { close: 4.50, normal: 4.76, loose: 5.16 } },
  { standard: 'ANSI', name: '#10-24', unit: 'in', nominal: 4.826, tpi: 24, clearance: 5.56, tapDrill: 3.80, counterboreDia: 9.53, counterboreDepth: 5.13, countersinkDia: 9.91, countersinkAngle: 82, fits: { close: 5.16, normal: 5.56, loose: 6.00 } },
  { standard: 'ANSI', name: '1/4-20', unit: 'in', nominal: 6.35,  tpi: 20, clearance: 7.14, tapDrill: 5.11, counterboreDia: 12.70, counterboreDepth: 6.76, countersinkDia: 13.08, countersinkAngle: 82, fits: { close: 6.76, normal: 7.14, loose: 7.94 } },
  { standard: 'ANSI', name: '5/16-18',unit: 'in', nominal: 7.94,  tpi: 18, clearance: 8.73, tapDrill: 6.53, counterboreDia: 15.88, counterboreDepth: 8.46, countersinkDia: 16.26, countersinkAngle: 82, fits: { close: 8.33, normal: 8.73, loose: 9.53 } },
  { standard: 'ANSI', name: '3/8-16', unit: 'in', nominal: 9.525, tpi: 16, clearance: 10.32,tapDrill: 7.94, counterboreDia: 19.05, counterboreDepth: 10.16, countersinkDia: 19.46, countersinkAngle: 82, fits: { close: 9.93, normal: 10.32, loose: 11.13 } },
  { standard: 'ANSI', name: '7/16-14',unit: 'in', nominal: 11.11, tpi: 14, clearance: 11.91,tapDrill: 9.40, counterboreDia: 22.23, counterboreDepth: 11.91, countersinkDia: 22.62, countersinkAngle: 82, fits: { close: 11.51, normal: 11.91, loose: 12.70 } },
  { standard: 'ANSI', name: '1/2-13', unit: 'in', nominal: 12.7,  tpi: 13, clearance: 13.49,tapDrill: 10.72,counterboreDia: 25.40, counterboreDepth: 13.49, countersinkDia: 25.86, countersinkAngle: 82, fits: { close: 13.10, normal: 13.49, loose: 14.29 } },
];

/** ANSI/ASME socket-cap-screw companion holes — fine pitch (UNF). */
export const UNF_INCH: HoleStandardSpec[] = [
  { standard: 'ANSI', name: '#0-80',   unit: 'in', nominal: 1.524, tpi: 80, clearance: 1.85, tapDrill: 1.25, counterboreDia: 3.18, counterboreDepth: 1.70, countersinkDia: 3.05, countersinkAngle: 82, fits: { close: 1.70, normal: 1.85, loose: 2.05 } },
  { standard: 'ANSI', name: '#2-64',   unit: 'in', nominal: 2.184, tpi: 64, clearance: 2.50, tapDrill: 1.85, counterboreDia: 4.37, counterboreDepth: 2.39, countersinkDia: 4.42, countersinkAngle: 82, fits: { close: 2.35, normal: 2.50, loose: 2.78 } },
  { standard: 'ANSI', name: '#4-48',   unit: 'in', nominal: 2.845, tpi: 48, clearance: 3.20, tapDrill: 2.40, counterboreDia: 5.94, counterboreDepth: 3.18, countersinkDia: 5.79, countersinkAngle: 82, fits: { close: 3.05, normal: 3.20, loose: 3.53 } },
  { standard: 'ANSI', name: '#6-40',   unit: 'in', nominal: 3.505, tpi: 40, clearance: 3.97, tapDrill: 2.85, counterboreDia: 6.88, counterboreDepth: 3.78, countersinkDia: 7.14, countersinkAngle: 82, fits: { close: 3.78, normal: 3.97, loose: 4.34 } },
  { standard: 'ANSI', name: '#8-36',   unit: 'in', nominal: 4.166, tpi: 36, clearance: 4.76, tapDrill: 3.50, counterboreDia: 7.94, counterboreDepth: 4.42, countersinkDia: 8.53, countersinkAngle: 82, fits: { close: 4.50, normal: 4.76, loose: 5.16 } },
  { standard: 'ANSI', name: '#10-32',  unit: 'in', nominal: 4.826, tpi: 32, clearance: 5.56, tapDrill: 4.22, counterboreDia: 9.53, counterboreDepth: 5.13, countersinkDia: 9.91, countersinkAngle: 82, fits: { close: 5.16, normal: 5.56, loose: 6.00 } },
  { standard: 'ANSI', name: '1/4-28',  unit: 'in', nominal: 6.35,  tpi: 28, clearance: 7.14, tapDrill: 5.50, counterboreDia: 12.70, counterboreDepth: 6.76, countersinkDia: 13.08, countersinkAngle: 82, fits: { close: 6.76, normal: 7.14, loose: 7.94 } },
  { standard: 'ANSI', name: '5/16-24', unit: 'in', nominal: 7.94,  tpi: 24, clearance: 8.73, tapDrill: 6.90, counterboreDia: 15.88, counterboreDepth: 8.46, countersinkDia: 16.26, countersinkAngle: 82, fits: { close: 8.33, normal: 8.73, loose: 9.53 } },
  { standard: 'ANSI', name: '3/8-24',  unit: 'in', nominal: 9.525, tpi: 24, clearance: 10.32,tapDrill: 8.50, counterboreDia: 19.05, counterboreDepth: 10.16, countersinkDia: 19.46, countersinkAngle: 82, fits: { close: 9.93, normal: 10.32, loose: 11.13 } },
  { standard: 'ANSI', name: '7/16-20', unit: 'in', nominal: 11.11, tpi: 20, clearance: 11.91,tapDrill: 9.90, counterboreDia: 22.23, counterboreDepth: 11.91, countersinkDia: 22.62, countersinkAngle: 82, fits: { close: 11.51, normal: 11.91, loose: 12.70 } },
  { standard: 'ANSI', name: '1/2-20',  unit: 'in', nominal: 12.7,  tpi: 20, clearance: 13.49,tapDrill: 11.50,counterboreDia: 25.40, counterboreDepth: 13.49, countersinkDia: 25.86, countersinkAngle: 82, fits: { close: 13.10, normal: 13.49, loose: 14.29 } },
];

/**
 * Legacy ANSI_IMPERIAL list — kept for backward-compatibility with existing
 * imports (HoleWizardModal, smartFastener). Contents are the previous Wave 1
 * subset (coarse pitch + #10-32 fine), now sourced from UNC + the one UNF row
 * that was originally present.
 */
export const ANSI_IMPERIAL: HoleStandardSpec[] = [
  ...UNC_INCH.filter((r) => ['#4-40', '#6-32', '#8-32', '#10-24', '1/4-20', '5/16-18', '3/8-16', '1/2-13'].includes(r.name)),
  ...UNF_INCH.filter((r) => r.name === '#10-32'),
];
