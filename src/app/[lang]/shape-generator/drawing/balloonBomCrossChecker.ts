/**
 * balloonBomCrossChecker.ts — Cross-check drawing balloons against
 * the BOM table.
 *
 * Verifies:
 *
 *   1. Every balloon item-number references an existing BOM row.
 *   2. Every BOM row is referenced by at least one balloon (except
 *     phantom or info rows).
 *   3. Balloon quantity (where shown) matches BOM quantity.
 *   4. No duplicate item-numbers on the drawing.
 *
 * Returns structured issues + auto-fix suggestions (add missing
 * balloon, prune orphan row, renumber duplicates).
 */

export interface Balloon {
  id: string;
  itemNumber: number;
  /** Visible quantity badge, if drawing shows one. */
  shownQuantity?: number;
}

export interface BomRow {
  itemNumber: number;
  partNumber: string;
  quantity: number;
  /** Phantom/info rows don't need a balloon. */
  optional?: boolean;
}

export type IssueKind = 'balloon-unknown-row' | 'orphan-row' | 'qty-mismatch' | 'duplicate-balloon';

export interface CrossCheckIssue {
  kind: IssueKind;
  severity: 'error' | 'warn';
  message: string;
  itemNumber?: number;
  balloonId?: string;
  suggestedAction: string;
}

export interface CrossCheckResult {
  issues: CrossCheckIssue[];
  /** True when no errors found (warns may remain). */
  ok: boolean;
}

// ── Top-level entry ────────────────────────────────────────────

export function crossCheck(balloons: Balloon[], rows: BomRow[]): CrossCheckResult {
  const issues: CrossCheckIssue[] = [];
  const rowMap = new Map(rows.map(r => [r.itemNumber, r]));

  // Duplicate balloon detection.
  const seen = new Map<number, Balloon[]>();
  for (const b of balloons) {
    if (!seen.has(b.itemNumber)) seen.set(b.itemNumber, []);
    seen.get(b.itemNumber)!.push(b);
  }
  for (const [item, group] of seen) {
    if (group.length > 1) {
      for (const b of group) {
        issues.push({
          kind: 'duplicate-balloon',
          severity: 'error',
          message: `Balloon ${b.id} shares item #${item} with ${group.length - 1} others.`,
          itemNumber: item,
          balloonId: b.id,
          suggestedAction: 'Renumber duplicates or merge balloons.',
        });
      }
    }
  }

  // Balloon → row existence.
  for (const b of balloons) {
    const row = rowMap.get(b.itemNumber);
    if (!row) {
      issues.push({
        kind: 'balloon-unknown-row',
        severity: 'error',
        message: `Balloon ${b.id} references item #${b.itemNumber} not in BOM.`,
        itemNumber: b.itemNumber,
        balloonId: b.id,
        suggestedAction: 'Add BOM row or remove balloon.',
      });
      continue;
    }
    if (b.shownQuantity !== undefined && b.shownQuantity !== row.quantity) {
      issues.push({
        kind: 'qty-mismatch',
        severity: 'warn',
        message: `Balloon ${b.id} shows qty ${b.shownQuantity} but BOM lists ${row.quantity}.`,
        itemNumber: b.itemNumber,
        balloonId: b.id,
        suggestedAction: 'Sync balloon to BOM or update BOM.',
      });
    }
  }

  // Orphan rows.
  const referenced = new Set(balloons.map(b => b.itemNumber));
  for (const row of rows) {
    if (row.optional) continue;
    if (!referenced.has(row.itemNumber)) {
      issues.push({
        kind: 'orphan-row',
        severity: 'warn',
        message: `BOM item #${row.itemNumber} (${row.partNumber}) not balloon-referenced on drawing.`,
        itemNumber: row.itemNumber,
        suggestedAction: 'Add a balloon or mark row as optional.',
      });
    }
  }

  const errors = issues.filter(i => i.severity === 'error');
  return { issues, ok: errors.length === 0 };
}

// ── Fix application helpers ───────────────────────────────────

export interface FixOutput {
  rowsToAdd: BomRow[];
  rowsToRemove: number[];
  balloonsToRenumber: { id: string; newItem: number }[];
}

export function suggestFixes(result: CrossCheckResult, balloons: Balloon[], rows: BomRow[]): FixOutput {
  const fix: FixOutput = { rowsToAdd: [], rowsToRemove: [], balloonsToRenumber: [] };
  // For each balloon-unknown-row, propose adding an empty row.
  for (const issue of result.issues) {
    if (issue.kind === 'balloon-unknown-row' && issue.itemNumber !== undefined) {
      fix.rowsToAdd.push({ itemNumber: issue.itemNumber, partNumber: 'TBD', quantity: 1 });
    }
    if (issue.kind === 'orphan-row' && issue.itemNumber !== undefined) {
      fix.rowsToRemove.push(issue.itemNumber);
    }
  }
  // Duplicates: assign new sequential numbers above the max.
  const maxItem = Math.max(0, ...rows.map(r => r.itemNumber), ...balloons.map(b => b.itemNumber));
  let next = maxItem + 1;
  const dupGroups = new Map<number, Balloon[]>();
  for (const b of balloons) {
    if (!dupGroups.has(b.itemNumber)) dupGroups.set(b.itemNumber, []);
    dupGroups.get(b.itemNumber)!.push(b);
  }
  for (const [, group] of dupGroups) {
    if (group.length <= 1) continue;
    for (let i = 1; i < group.length; i++) {
      fix.balloonsToRenumber.push({ id: group[i]!.id, newItem: next++ });
    }
  }
  return fix;
}

// ── Bulk stats ────────────────────────────────────────────────

export interface CheckStats {
  balloonCount: number;
  rowCount: number;
  errorCount: number;
  warnCount: number;
  orphanRows: number;
  duplicateBalloons: number;
}

export function stats(result: CrossCheckResult, balloons: Balloon[], rows: BomRow[]): CheckStats {
  return {
    balloonCount: balloons.length,
    rowCount: rows.length,
    errorCount: result.issues.filter(i => i.severity === 'error').length,
    warnCount: result.issues.filter(i => i.severity === 'warn').length,
    orphanRows: result.issues.filter(i => i.kind === 'orphan-row').length,
    duplicateBalloons: result.issues.filter(i => i.kind === 'duplicate-balloon').length,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface CrossCheckSummary {
  ok: boolean;
  errorCount: number;
  warnCount: number;
  matchedCount: number;
}

export function summarize(result: CrossCheckResult, balloons: Balloon[]): CrossCheckSummary {
  const erroneousBalloons = new Set(result.issues.filter(i => i.severity === 'error').map(i => i.balloonId));
  const matched = balloons.filter(b => !erroneousBalloons.has(b.id)).length;
  return {
    ok: result.ok,
    errorCount: result.issues.filter(i => i.severity === 'error').length,
    warnCount: result.issues.filter(i => i.severity === 'warn').length,
    matchedCount: matched,
  };
}
