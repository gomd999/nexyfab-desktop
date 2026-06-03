/**
 * surfaceFinishSymbol — Phase 4.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * ISO 1302 surface finish (surface texture) symbol IR + formatter +
 * render hint. A SurfaceFinishSymbol annotates a Viewport by pointing at
 * SOURCE-model geometry (a face/edge id) and declaring the required
 * surface texture (Ra value(s), production method, sampling length, lay
 * direction) using one of the three ISO 1302 base symbols.
 *
 * Scope (Phase 4.2 minimal):
 *   - 3 base symbols (kinds):
 *       basic                — texture required, method unspecified
 *                              (open tick).
 *       machining_required   — material removal required (tick + bar).
 *       machining_prohibited — material removal prohibited (tick + circle).
 *   - Ra (arithmetic mean roughness) as single max, or min..max range.
 *   - Optional production method (e.g., 'milled', 'ground'), sampling
 *     length, and lay direction (= X M C R P).
 *   - all-around indicator (circle on the symbol leader) for a callout
 *     that applies to every surface of the represented profile.
 *
 * Out of scope (Phase 4.x+):
 *   - Rz / Rmr / waveform parameters beyond Ra.
 *   - Multiple stacked parameter requirements on one symbol.
 *   - DXF/DWG-specific surface-finish block encoding (Phase 4.4).
 *   - Visual leader routing / placement (renderer concern).
 */

// ─── IR ──────────────────────────────────────────────────────────────────

/** ISO 1302 base symbol family. */
export type SurfaceFinishKind = 'basic' | 'machining_required' | 'machining_prohibited';

/** Lay (direction of the dominant surface pattern) per ISO 1302. */
export type SurfaceLay = '=' | 'X' | 'M' | 'C' | 'R' | 'P';

export interface SurfaceFinishSymbol {
  id: string;
  viewportId: string;
  /** Source-model geometry id (face/edge id) this finish controls. */
  targetRef: string;
  kind: SurfaceFinishKind;
  /** Upper limit of Ra in micrometres (µm). Must be > 0 when present. */
  raMax?: number;
  /** Lower limit of Ra in µm. Must be ≤ raMax when both present. */
  raMin?: number;
  /** Production / manufacturing method, e.g. 'milled', 'ground'. */
  productionMethod?: string;
  /** Sampling (cut-off) length in mm. */
  samplingLength?: number;
  /** Lay direction symbol. */
  lay?: SurfaceLay;
  /** True when the callout applies to all surfaces of the profile. */
  allAround?: boolean;
}

const KNOWN_KINDS: ReadonlySet<SurfaceFinishKind> = new Set<SurfaceFinishKind>([
  'basic',
  'machining_required',
  'machining_prohibited',
]);

const KNOWN_LAYS: ReadonlySet<SurfaceLay> = new Set<SurfaceLay>([
  '=',
  'X',
  'M',
  'C',
  'R',
  'P',
]);

// ─── validation ──────────────────────────────────────────────────────────

export interface SurfaceFinishValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a surface finish symbol. Returns a typed result rather than
 * throwing so callers can surface every problem at once.
 */
export function validateSurfaceFinish(s: SurfaceFinishSymbol): SurfaceFinishValidation {
  const errors: string[] = [];

  if (!s.id) errors.push('surface finish id is empty');
  if (!s.viewportId) errors.push(`surface finish ${s.id || '?'}: viewportId is empty`);
  if (!s.targetRef) errors.push(`surface finish ${s.id || '?'}: targetRef is empty`);

  if (!KNOWN_KINDS.has(s.kind)) {
    errors.push(`surface finish ${s.id || '?'}: unknown kind '${s.kind}'`);
  }

  if (s.raMax !== undefined && !(s.raMax > 0)) {
    errors.push(`surface finish ${s.id || '?'}: raMax must be > 0, got ${s.raMax}`);
  }
  if (s.raMin !== undefined && !(s.raMin > 0)) {
    errors.push(`surface finish ${s.id || '?'}: raMin must be > 0, got ${s.raMin}`);
  }
  if (s.raMin !== undefined && s.raMax !== undefined && s.raMin > s.raMax) {
    errors.push(
      `surface finish ${s.id || '?'}: raMin ${s.raMin} > raMax ${s.raMax}`,
    );
  }
  if (s.raMin !== undefined && s.raMax === undefined) {
    errors.push(`surface finish ${s.id || '?'}: raMin given without raMax`);
  }

  if (s.samplingLength !== undefined && !(s.samplingLength > 0)) {
    errors.push(
      `surface finish ${s.id || '?'}: samplingLength must be > 0, got ${s.samplingLength}`,
    );
  }

  if (s.lay !== undefined && !KNOWN_LAYS.has(s.lay)) {
    errors.push(`surface finish ${s.id || '?'}: unknown lay '${s.lay}'`);
  }

  return { ok: errors.length === 0, errors };
}

// ─── format ──────────────────────────────────────────────────────────────

/**
 * Format the Ra requirement (value or range) for display. Returns ''
 * when no Ra is specified.
 */
function formatRa(s: SurfaceFinishSymbol): string {
  if (s.raMax === undefined) return '';
  if (s.raMin !== undefined) return `Ra ${s.raMin}..${s.raMax}`;
  return `Ra ${s.raMax}`;
}

/**
 * Readable single-line summary of a surface finish symbol, e.g.
 *   "Ra 3.2"
 *   "Ra 0.8..3.2 milled"
 *   "machining prohibited" (when material removal is forbidden)
 * Lay and all-around indicators are appended when present.
 */
export function formatSurfaceFinish(s: SurfaceFinishSymbol): string {
  const parts: string[] = [];

  const ra = formatRa(s);
  if (ra) parts.push(ra);

  if (s.kind === 'machining_prohibited') {
    parts.push('machining prohibited');
  } else if (s.kind === 'machining_required' && !ra) {
    parts.push('machining required');
  }

  if (s.productionMethod) parts.push(s.productionMethod);
  if (s.samplingLength !== undefined) parts.push(`L=${s.samplingLength}`);
  if (s.lay !== undefined) parts.push(`lay ${s.lay}`);
  if (s.allAround) parts.push('all-around');

  return parts.length > 0 ? parts.join(' ') : 'surface finish';
}

// ─── render hint ─────────────────────────────────────────────────────────

/** Glyph the renderer draws as the ISO 1302 base symbol. */
export type SurfaceFinishGlyph = 'basic' | 'machined' | 'prohibited';

export interface SurfaceFinishRenderHint {
  glyph: SurfaceFinishGlyph;
  /** Text lines the renderer stacks next to the tick symbol. */
  lines: string[];
}

function glyphForKind(kind: SurfaceFinishKind): SurfaceFinishGlyph {
  switch (kind) {
    case 'basic':
      return 'basic';
    case 'machining_required':
      return 'machined';
    case 'machining_prohibited':
      return 'prohibited';
  }
}

/**
 * Produce the renderer hint: the base glyph plus the ordered text lines a
 * renderer stacks around the tick symbol (production method above the bar,
 * Ra value to the right, sampling length / lay below).
 */
export function surfaceFinishRenderHint(s: SurfaceFinishSymbol): SurfaceFinishRenderHint {
  const lines: string[] = [];

  if (s.productionMethod) lines.push(s.productionMethod);

  const ra = formatRa(s);
  if (ra) lines.push(ra);

  if (s.samplingLength !== undefined) lines.push(`L=${s.samplingLength}`);
  if (s.lay !== undefined) lines.push(`lay ${s.lay}`);
  if (s.allAround) lines.push('all-around');

  return { glyph: glyphForKind(s.kind), lines };
}
