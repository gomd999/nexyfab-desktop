/**
 * fastenerSchema.ts — ISO / DIN / ANSI fastener canonical entries.
 *
 * NexyFab's assembly browser lets users insert standard parts —
 * bolts, screws, washers, nuts — by designation rather than CAD
 * modeling. The canonical schema lives here so:
 *   - the BOM emitter shows ISO/DIN identifiers verbatim
 *   - the partner-RFQ tags the part with its catalog code (so the
 *     fab can quote against actual stock)
 *   - the 3-D parametric model regenerates from the designation
 *     alone (no per-instance geometry stored)
 */

export type FastenerStandard = 'ISO' | 'DIN' | 'ANSI';

export type FastenerKind =
  | 'hex-bolt'       // ISO 4014 (partial thread), ISO 4017 (full)
  | 'socket-head-cap'// ISO 4762
  | 'button-head'    // ISO 7380
  | 'flat-head'      // ISO 10642
  | 'set-screw'      // ISO 4026/4028
  | 'hex-nut'        // ISO 4032
  | 'lock-nut'       // ISO 7040 (nylon-insert)
  | 'flat-washer'    // ISO 7089
  | 'spring-washer'  // DIN 127
  | 'tooth-washer';  // DIN 6798

export interface ThreadSpec {
  /** Major diameter (mm). */
  diameterMm: number;
  /** Pitch (mm). Coarse for M3=0.5, M6=1.0, M10=1.5, etc. */
  pitchMm: number;
}

export interface FastenerSpec {
  standard: FastenerStandard;
  kind: FastenerKind;
  designation: string;     // e.g. "ISO 4014 M6 × 25"
  thread: ThreadSpec;
  /** Overall length under-head (mm) for bolts/screws; thickness for nuts/washers. */
  lengthMm: number;
  /** Material code. */
  material?: 'steel-8.8' | 'steel-10.9' | 'steel-12.9' | 'a2-stainless' | 'a4-stainless' | 'brass';
  /** Surface finish (zinc, plain, black-oxide, ...). */
  finish?: string;
}

/** Common metric coarse pitches. */
const PITCH_TABLE: Record<number, number> = {
  3: 0.5, 4: 0.7, 5: 0.8, 6: 1.0, 8: 1.25, 10: 1.5, 12: 1.75, 16: 2.0, 20: 2.5,
};

/** Coarse pitch for a metric diameter. Throws on unsupported diameter. */
export function coarsePitch(diameterMm: number): number {
  const p = PITCH_TABLE[diameterMm];
  if (p === undefined) throw new Error(`No coarse pitch in table for M${diameterMm}`);
  return p;
}

/** Build a canonical designation string for the given fastener spec. */
export function fastenerDesignation(spec: Partial<FastenerSpec> & {
  standard: FastenerStandard;
  kind: FastenerKind;
  thread: ThreadSpec;
  lengthMm: number;
}): string {
  const std = spec.standard;
  const tag = STANDARD_TAGS[spec.kind] ?? spec.kind;
  const sizeStr = `M${spec.thread.diameterMm}`;
  const pitchStr = spec.thread.pitchMm && Math.abs(spec.thread.pitchMm - coarsePitchSafe(spec.thread.diameterMm)) > 1e-6
    ? `×${spec.thread.pitchMm}`
    : '';
  return `${std} ${tag} ${sizeStr}${pitchStr} × ${spec.lengthMm}`;
}

function coarsePitchSafe(d: number): number {
  try { return coarsePitch(d); } catch { return 0; }
}

const STANDARD_TAGS: Partial<Record<FastenerKind, string>> = {
  'hex-bolt':         '4014',
  'socket-head-cap':  '4762',
  'button-head':      '7380',
  'flat-head':        '10642',
  'set-screw':        '4026',
  'hex-nut':          '4032',
  'lock-nut':         '7040',
  'flat-washer':      '7089',
  'spring-washer':    'DIN 127',
  'tooth-washer':     'DIN 6798',
};

/** Build a fully-populated FastenerSpec from a short input. */
export function buildFastener(input: {
  standard?: FastenerStandard;
  kind: FastenerKind;
  diameterMm: number;
  lengthMm: number;
  pitchMm?: number;
  material?: FastenerSpec['material'];
  finish?: string;
}): FastenerSpec {
  const standard = input.standard ?? 'ISO';
  const pitch = input.pitchMm ?? coarsePitch(input.diameterMm);
  const thread = { diameterMm: input.diameterMm, pitchMm: pitch };
  const designation = fastenerDesignation({
    standard,
    kind: input.kind,
    thread,
    lengthMm: input.lengthMm,
  });
  return {
    standard,
    kind: input.kind,
    designation,
    thread,
    lengthMm: input.lengthMm,
    material: input.material ?? 'steel-8.8',
    finish: input.finish,
  };
}

/** Sanity-validate a fastener — used by the assembly inserter UI to
 *  warn before a malformed spec hits BOM. */
export function validateFastener(spec: FastenerSpec): string[] {
  const errors: string[] = [];
  if (spec.thread.diameterMm <= 0) errors.push('thread diameter must be > 0');
  if (spec.thread.pitchMm <= 0) errors.push('thread pitch must be > 0');
  if (spec.lengthMm <= 0) errors.push('length must be > 0');
  // Heuristic: bolt length should be at least 1× diameter (otherwise it's a stud).
  if (spec.kind === 'hex-bolt' && spec.lengthMm < spec.thread.diameterMm) {
    errors.push(`bolt length ${spec.lengthMm} < diameter ${spec.thread.diameterMm} — consider a stud`);
  }
  return errors;
}
