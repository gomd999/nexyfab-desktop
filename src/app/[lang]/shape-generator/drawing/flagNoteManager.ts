/**
 * flagNoteManager.ts — Flag note management for engineering drawings.
 *
 * Flag notes are numbered triangular call-outs placed next to features
 * on a drawing. They reference a general-notes table that lists the
 * full text. The system supports:
 *
 *   - Allocate unique flag numbers (1, 2, 3, …).
 *   - Anchor each flag to one or more drawing points / features.
 *   - Validate that every general note has at least one flag and
 *     every flag corresponds to a general note.
 *   - Renumber for revision (sequentially or stable).
 *   - Generate a "where used" cross reference.
 *
 * Convention: triangular flag, number inside, leader to feature.
 * Used widely in aerospace, defense, MIL-STD-100.
 */

export interface FlagAnchor {
  /** Feature / point identifier (entity id on the drawing). */
  featureId: string;
  /** Optional sheet number. */
  sheet?: number;
  /** Optional zone, e.g. "A4", "B2". */
  zone?: string;
}

export interface FlagNote {
  /** Sequential flag number. */
  number: number;
  /** Full text of the general note. */
  text: string;
  /** Anchors where this flag appears. */
  anchors: FlagAnchor[];
  /** Category for grouping (material, inspection, finish…). */
  category?: 'material' | 'inspection' | 'finish' | 'tolerance' | 'process' | 'general';
}

export interface FlagNoteSystem {
  notes: FlagNote[];
  /** Next number available for allocation. */
  nextNumber: number;
}

// ── Top-level entry: create empty system ──────────────────────

export function createFlagNoteSystem(): FlagNoteSystem {
  return { notes: [], nextNumber: 1 };
}

// ── Add / remove / lookup ─────────────────────────────────────

export function addFlagNote(
  system: FlagNoteSystem,
  text: string,
  category?: FlagNote['category'],
): FlagNote {
  const note: FlagNote = {
    number: system.nextNumber,
    text,
    anchors: [],
    ...(category !== undefined ? { category } : {}),
  };
  system.notes.push(note);
  system.nextNumber++;
  return note;
}

export function removeFlagNote(system: FlagNoteSystem, number: number): boolean {
  const idx = system.notes.findIndex(n => n.number === number);
  if (idx < 0) return false;
  system.notes.splice(idx, 1);
  return true;
}

export function getFlagNote(system: FlagNoteSystem, number: number): FlagNote | undefined {
  return system.notes.find(n => n.number === number);
}

export function anchorFlagNote(
  system: FlagNoteSystem,
  number: number,
  anchor: FlagAnchor,
): boolean {
  const note = getFlagNote(system, number);
  if (!note) return false;
  note.anchors.push(anchor);
  return true;
}

// ── Renumbering ────────────────────────────────────────────────

export interface RenumberOptions {
  /** Whether to keep stable existing numbers and only fill gaps, or restart from 1. */
  mode: 'sequential' | 'fill-gaps';
}

export function renumberFlags(system: FlagNoteSystem, opts: RenumberOptions): Map<number, number> {
  const mapping = new Map<number, number>();
  if (opts.mode === 'sequential') {
    system.notes.sort((a, b) => a.number - b.number);
    let n = 1;
    for (const note of system.notes) {
      if (note.number !== n) mapping.set(note.number, n);
      note.number = n;
      n++;
    }
    system.nextNumber = n;
  } else {
    // Fill gaps: keep existing, find lowest unused for `nextNumber`.
    system.notes.sort((a, b) => a.number - b.number);
    let n = 1;
    while (system.notes.some(note => note.number === n)) n++;
    system.nextNumber = n;
  }
  return mapping;
}

// ── Validation ─────────────────────────────────────────────────

export interface ValidationIssue {
  severity: 'error' | 'warn';
  message: string;
  flagNumber?: number;
}

export function validateFlagSystem(system: FlagNoteSystem): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<number>();
  for (const note of system.notes) {
    if (seen.has(note.number)) {
      issues.push({ severity: 'error', message: `Duplicate flag number ${note.number}`, flagNumber: note.number });
    }
    seen.add(note.number);
    if (!note.text || note.text.trim().length === 0) {
      issues.push({ severity: 'error', message: `Flag ${note.number} has empty text`, flagNumber: note.number });
    }
    if (note.anchors.length === 0) {
      issues.push({ severity: 'warn', message: `Flag ${note.number} has no anchors (unused)`, flagNumber: note.number });
    }
  }
  return issues;
}

// ── Where-used cross reference ────────────────────────────────

export interface WhereUsedEntry {
  flagNumber: number;
  text: string;
  sheets: number[];
  zones: string[];
  totalAnchors: number;
}

export function whereUsed(system: FlagNoteSystem): WhereUsedEntry[] {
  return system.notes.map(n => {
    const sheets = new Set<number>();
    const zones = new Set<string>();
    for (const a of n.anchors) {
      if (a.sheet !== undefined) sheets.add(a.sheet);
      if (a.zone !== undefined) zones.add(a.zone);
    }
    return {
      flagNumber: n.number,
      text: n.text,
      sheets: Array.from(sheets).sort((a, b) => a - b),
      zones: Array.from(zones).sort(),
      totalAnchors: n.anchors.length,
    };
  });
}

// ── Render hint (for downstream layout) ───────────────────────

export interface FlagRenderHint {
  number: number;
  /** Triangular flag size in mm on paper. */
  triangleSizeMm: number;
  /** Whether to draw leader line. */
  drawLeader: boolean;
  /** Text colour, ISO black default. */
  colour: string;
}

export function defaultRenderHint(note: FlagNote): FlagRenderHint {
  const isCritical = note.category === 'inspection' || note.category === 'tolerance';
  return {
    number: note.number,
    triangleSizeMm: isCritical ? 8 : 6,
    drawLeader: note.anchors.length > 0,
    colour: '#000000',
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface FlagSystemSummary {
  flagCount: number;
  totalAnchors: number;
  unusedFlags: number;
  byCategory: Record<string, number>;
}

export function summarize(system: FlagNoteSystem): FlagSystemSummary {
  const byCategory: Record<string, number> = {};
  let totalAnchors = 0;
  let unused = 0;
  for (const note of system.notes) {
    const cat = note.category ?? 'general';
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    totalAnchors += note.anchors.length;
    if (note.anchors.length === 0) unused++;
  }
  return {
    flagCount: system.notes.length,
    totalAnchors,
    unusedFlags: unused,
    byCategory,
  };
}
