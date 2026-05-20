/**
 * toleranceFrameComposer.ts — Compose a GD&T feature control frame
 * (FCF) string from structured components per ASME Y14.5 / ISO 1101.
 *
 * An FCF consists of compartments:
 *
 *   [SYM] [TOLERANCE] [MOD] [DATUM-A] [DATUM-B] [DATUM-C]
 *
 * Example: ⌖ Ø0.1 Ⓜ A B Ⓜ C
 *
 * Module:
 *   - Builds the text string from parts.
 *   - Validates required datums per symbol (e.g., position requires
 *     ≥ 1 datum).
 *   - Renders Unicode symbols / ASCII fallback.
 */

export type GdtSymbol =
  | 'position' | 'concentricity' | 'symmetry' | 'circularity' | 'cylindricity'
  | 'flatness' | 'straightness' | 'parallelism' | 'perpendicularity' | 'angularity'
  | 'circular-runout' | 'total-runout' | 'profile-line' | 'profile-surface';

export type MaterialModifier = 'M' | 'L' | 'S' | 'F' | undefined;

export interface DatumReference {
  letter: string;
  modifier?: MaterialModifier;
}

export interface ToleranceFrame {
  symbol: GdtSymbol;
  /** Tolerance value (without diameter symbol). */
  toleranceValue: number;
  /** Apply Ø (diameter) before tolerance value. */
  diameter: boolean;
  /** Material modifier on the tolerance itself. */
  materialModifier?: MaterialModifier;
  datums: DatumReference[];
}

export interface ComposeOptions {
  /** Use Unicode symbols (true) or ASCII fallback (false). */
  unicode: boolean;
  /** Separator between compartments. */
  separator: string;
}

export const DEFAULT_OPTIONS: ComposeOptions = {
  unicode: true,
  separator: ' | ',
};

export const UNICODE_SYMBOLS: Record<GdtSymbol, string> = {
  position: '⌖',
  concentricity: '◎',
  symmetry: '⌭',
  circularity: '○',
  cylindricity: '⌭',
  flatness: '▱',
  straightness: '—',
  parallelism: '//',
  perpendicularity: '⊥',
  angularity: '∠',
  'circular-runout': '↗',
  'total-runout': '⌰',
  'profile-line': '⌒',
  'profile-surface': '⌓',
};

export const ASCII_FALLBACK: Record<GdtSymbol, string> = {
  position: 'POS',
  concentricity: 'CCT',
  symmetry: 'SYM',
  circularity: 'CIR',
  cylindricity: 'CYL',
  flatness: 'FLT',
  straightness: 'STR',
  parallelism: 'PAR',
  perpendicularity: 'PERP',
  angularity: 'ANG',
  'circular-runout': 'CRO',
  'total-runout': 'TRO',
  'profile-line': 'PROFL',
  'profile-surface': 'PROFS',
};

export interface ComposeResult {
  text: string;
  warnings: string[];
  /** Datum reference frame fully defined. */
  hasFullDrf: boolean;
}

// ── Top-level entry ────────────────────────────────────────────

export function composeFrame(frame: ToleranceFrame, options: Partial<ComposeOptions> = {}): ComposeResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];

  // Symbol.
  const sym = opts.unicode ? UNICODE_SYMBOLS[frame.symbol] : ASCII_FALLBACK[frame.symbol];

  // Tolerance.
  let tol = frame.toleranceValue.toString();
  if (frame.diameter) tol = `Ø${tol}`;
  if (frame.materialModifier && frame.materialModifier !== 'S') {
    tol += renderModifier(frame.materialModifier, opts.unicode);
  }

  // Datum references.
  const datums: string[] = [];
  for (const d of frame.datums) {
    let s = d.letter;
    if (d.modifier && d.modifier !== 'S') s += renderModifier(d.modifier, opts.unicode);
    datums.push(s);
  }

  // Validate required datums per symbol.
  const requireDatum = requiresDatum(frame.symbol);
  if (requireDatum && datums.length === 0) {
    warnings.push(`${frame.symbol} requires at least one datum.`);
  }
  if (frame.diameter && !canBeDiameter(frame.symbol)) {
    warnings.push(`Ø not standard for ${frame.symbol}.`);
  }
  if (frame.symbol === 'position' && datums.length < 3) {
    warnings.push('Position FCF should have full DRF (3 datums) for unambiguous control.');
  }

  const parts = [sym, tol, ...datums];
  const text = parts.join(opts.separator);
  return { text, warnings, hasFullDrf: datums.length === 3 };
}

function renderModifier(mod: MaterialModifier, unicode: boolean): string {
  if (mod === undefined) return '';
  if (unicode) {
    return mod === 'M' ? 'Ⓜ' : mod === 'L' ? 'Ⓛ' : mod === 'F' ? 'Ⓕ' : '';
  }
  return mod === 'M' ? '(M)' : mod === 'L' ? '(L)' : mod === 'F' ? '(F)' : '';
}

function requiresDatum(sym: GdtSymbol): boolean {
  return ['position', 'concentricity', 'symmetry', 'parallelism', 'perpendicularity', 'angularity', 'circular-runout', 'total-runout'].includes(sym);
}

function canBeDiameter(sym: GdtSymbol): boolean {
  return ['position', 'concentricity', 'circularity', 'cylindricity', 'circular-runout', 'total-runout'].includes(sym);
}

// ── Compose batch ────────────────────────────────────────────

export function composeBatch(frames: ToleranceFrame[], options: Partial<ComposeOptions> = {}): ComposeResult[] {
  return frames.map(f => composeFrame(f, options));
}

// ── Round-trip parse (basic) ─────────────────────────────────

export function parseFrame(text: string): ToleranceFrame | null {
  const parts = text.split('|').map(p => p.trim());
  if (parts.length < 2) return null;
  const symEntry = (Object.entries(UNICODE_SYMBOLS) as [GdtSymbol, string][]).find(([, v]) => v === parts[0]);
  if (!symEntry) return null;
  const tolPart = parts[1]!;
  const diameter = tolPart.startsWith('Ø');
  const value = parseFloat(diameter ? tolPart.slice(1) : tolPart);
  if (isNaN(value)) return null;
  const datums = parts.slice(2).map(d => ({ letter: d.charAt(0) }));
  return { symbol: symEntry[0], toleranceValue: value, diameter, datums };
}

// ── Summary ────────────────────────────────────────────────────

export interface FrameSummary {
  text: string;
  hasFullDrf: boolean;
  warningCount: number;
}

export function summarize(result: ComposeResult): FrameSummary {
  return { text: result.text, hasFullDrf: result.hasFullDrf, warningCount: result.warnings.length };
}
