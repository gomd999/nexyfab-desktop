/**
 * toleranceLadderNote.ts — Generate the "tolerance ladder" general
 * note block that lists default tolerances by dimension size range.
 *
 * Standard ladder format (ASME Y14.5):
 *
 *   UNLESS OTHERWISE SPECIFIED, ALL TOLERANCES ARE:
 *       ANGULAR:           ±1°
 *       0    – 6 mm:       ±0.10
 *       6    – 30 mm:      ±0.20
 *       30   – 120 mm:     ±0.30
 *       120  – 400 mm:     ±0.50
 *       400+ mm:           ±1.00
 *
 * Module:
 *   - Accepts customer-specific ladder steps.
 *   - Picks the right tolerance from a measured value.
 *   - Formats the note block string with column alignment.
 */

export interface LadderStep {
  /** Lower bound of size range (mm). */
  minMm: number;
  /** Upper bound (mm); Infinity for "and above". */
  maxMm: number;
  /** Bilateral tolerance ±. */
  toleranceMm: number;
}

export const DEFAULT_LADDER: LadderStep[] = [
  { minMm: 0, maxMm: 6, toleranceMm: 0.10 },
  { minMm: 6, maxMm: 30, toleranceMm: 0.20 },
  { minMm: 30, maxMm: 120, toleranceMm: 0.30 },
  { minMm: 120, maxMm: 400, toleranceMm: 0.50 },
  { minMm: 400, maxMm: Infinity, toleranceMm: 1.00 },
];

export interface NoteOptions {
  /** Angular default tolerance (deg). */
  angularDeg: number;
  /** Whether to include surface finish line. */
  includeRa: boolean;
  /** Default Ra (μm). */
  defaultRaMicron: number;
  /** Custom prefix line. */
  prefixLine?: string;
}

export const DEFAULT_OPTIONS: NoteOptions = {
  angularDeg: 1,
  includeRa: false,
  defaultRaMicron: 3.2,
};

export interface NoteResult {
  text: string;
  lineCount: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function buildLadderNote(ladder: LadderStep[] = DEFAULT_LADDER, options: Partial<NoteOptions> = {}): NoteResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: string[] = [];
  lines.push(opts.prefixLine ?? 'UNLESS OTHERWISE SPECIFIED, ALL TOLERANCES ARE:');
  lines.push(`    ANGULAR: ±${opts.angularDeg.toFixed(1)}°`);

  // Tolerance steps aligned.
  const maxLabel = ladder.reduce((max, s) => Math.max(max, formatRange(s).length), 0);
  for (const step of ladder) {
    const range = formatRange(step).padEnd(maxLabel + 2);
    lines.push(`    ${range}±${step.toleranceMm.toFixed(2)}`);
  }
  if (opts.includeRa) {
    lines.push(`    SURFACE FINISH: Ra ${opts.defaultRaMicron.toFixed(1)} μm`);
  }
  return { text: lines.join('\n'), lineCount: lines.length };
}

function formatRange(step: LadderStep): string {
  if (step.maxMm === Infinity) return `${step.minMm}+ mm:`;
  return `${step.minMm} – ${step.maxMm} mm:`;
}

// ── Lookup tolerance for a given dimension ───────────────────

export function tolerance(value: number, ladder: LadderStep[] = DEFAULT_LADDER): number {
  const v = Math.abs(value);
  for (const step of ladder) {
    if (v >= step.minMm && v < step.maxMm) return step.toleranceMm;
  }
  // Above last upper bound — use last step.
  return ladder.length > 0 ? ladder[ladder.length - 1]!.toleranceMm : 0;
}

// ── Apply ladder to a dimension list ─────────────────────────

export interface DimensionWithTol {
  id: string;
  nominalMm: number;
  toleranceMm: number;
}

export function applyLadderToDimensions(dimensions: { id: string; nominalMm: number }[], ladder: LadderStep[] = DEFAULT_LADDER): DimensionWithTol[] {
  return dimensions.map(d => ({ ...d, toleranceMm: tolerance(d.nominalMm, ladder) }));
}

// ── Validation ───────────────────────────────────────────────

export interface LadderIssue {
  message: string;
}

export function validateLadder(ladder: LadderStep[]): LadderIssue[] {
  const issues: LadderIssue[] = [];
  if (ladder.length === 0) {
    issues.push({ message: 'Empty ladder.' });
    return issues;
  }
  // Steps must be in increasing order.
  for (let i = 1; i < ladder.length; i++) {
    if (ladder[i]!.minMm < ladder[i - 1]!.maxMm) {
      issues.push({ message: `Step ${i} overlaps previous step.` });
    }
    if (ladder[i]!.minMm > ladder[i - 1]!.maxMm) {
      issues.push({ message: `Gap between steps ${i - 1} and ${i}.` });
    }
    if (ladder[i]!.toleranceMm < ladder[i - 1]!.toleranceMm) {
      issues.push({ message: `Tolerance decreases at step ${i}; non-monotone.` });
    }
  }
  return issues;
}

// ── Summary ────────────────────────────────────────────────────

export interface NoteSummary {
  lineCount: number;
  stepCount: number;
  largestToleranceMm: number;
}

export function summarize(result: NoteResult, ladder: LadderStep[]): NoteSummary {
  let max = 0;
  for (const s of ladder) if (s.toleranceMm > max) max = s.toleranceMm;
  return { lineCount: result.lineCount, stepCount: ladder.length, largestToleranceMm: max };
}
