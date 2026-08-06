import type { CadCorpusBatchItemResult, CadCorpusBatchSummary } from './cadCorpusBatchRunnerV2';
import type { EvidenceAssertionStatus } from './cadEvidenceIrV2';

export type BaselineFixtureStatus = EvidenceAssertionStatus | 'error' | 'missing';

export interface BaselineStatusTransition {
  fixtureId: string;
  from: BaselineFixtureStatus;
  to: BaselineFixtureStatus;
  changed: boolean;
}

export interface BaselineAssertionTransition {
  fixtureId: string;
  assertionId: string;
  from: EvidenceAssertionStatus | 'missing';
  to: EvidenceAssertionStatus | 'missing';
  changed: boolean;
}

export interface CadBaselineDeltaReport {
  schema: 'nexyfab.cad-corpus-delta.v1';
  baselineSignature: string;
  candidateSignature: string;
  fixtureStatusTransitions: BaselineStatusTransition[];
  assertionTransitions: BaselineAssertionTransition[];
  fixtureStatusDelta: { pass: number; fail: number; not_run: number; error: number };
  assertionStatusDelta: { pass: number; fail: number; not_run: number };
  regressions: Array<{
    kind: 'fixture_removed' | 'fixture_status' | 'assertion_removed' | 'assertion_status';
    fixtureId: string;
    assertionId?: string;
    from: BaselineFixtureStatus;
    to: BaselineFixtureStatus;
  }>;
  blockers: Array<{
    kind: 'regression' | 'candidate_not_releasable';
    fixtureId: string;
    assertionId?: string;
    status: BaselineFixtureStatus;
  }>;
  releaseBlocking: boolean;
}

const fixtureSeverity: Record<BaselineFixtureStatus, number> = { pass: 0, not_run: 1, fail: 2, error: 3, missing: 4 };
const assertionSeverity: Record<EvidenceAssertionStatus | 'missing', number> = { pass: 0, not_run: 1, fail: 2, missing: 3 };

function uniqueItems(summary: CadCorpusBatchSummary): Map<string, CadCorpusBatchItemResult> {
  if (summary.schema !== 'nexyfab.cad-corpus-run.v2' || !summary.signature.trim()) throw new TypeError('A signed CAD corpus run v2 is required.');
  const out = new Map<string, CadCorpusBatchItemResult>();
  for (const item of summary.results) {
    if (!item.fixtureId.trim() || out.has(item.fixtureId)) throw new TypeError('Fixture ids must be non-empty and unique.');
    out.set(item.fixtureId, item);
  }
  return out;
}

function assertions(item: CadCorpusBatchItemResult | undefined): Map<string, EvidenceAssertionStatus> {
  const out = new Map<string, EvidenceAssertionStatus>();
  if (!item?.evidence) return out;
  for (const assertion of item.evidence.assertions) {
    if (!assertion.id.trim() || out.has(assertion.id)) throw new TypeError(`Assertion ids must be unique within fixture ${item.fixtureId}.`);
    out.set(assertion.id, assertion.status);
  }
  return out;
}

function delta(candidate: number, baseline: number): number {
  return candidate - baseline;
}

/**
 * Compare two governed batch summaries without copying evidence payloads,
 * filesystem errors, artifact metadata, paths, or CAD source bytes.
 */
export function compareCadCorpusBaselines(
  baseline: CadCorpusBatchSummary,
  candidate: CadCorpusBatchSummary,
): CadBaselineDeltaReport {
  const before = uniqueItems(baseline);
  const after = uniqueItems(candidate);
  const fixtureIds = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a.localeCompare(b, 'en'));
  const fixtureStatusTransitions: BaselineStatusTransition[] = [];
  const assertionTransitions: BaselineAssertionTransition[] = [];
  const regressions: CadBaselineDeltaReport['regressions'] = [];
  const blockers: CadBaselineDeltaReport['blockers'] = [];

  for (const fixtureId of fixtureIds) {
    const oldItem = before.get(fixtureId); const newItem = after.get(fixtureId);
    const from: BaselineFixtureStatus = oldItem?.status ?? 'missing';
    const to: BaselineFixtureStatus = newItem?.status ?? 'missing';
    fixtureStatusTransitions.push({ fixtureId, from, to, changed: from !== to });
    if (oldItem && !newItem) regressions.push({ kind: 'fixture_removed', fixtureId, from, to });
    else if (oldItem && newItem && fixtureSeverity[to] > fixtureSeverity[from]) regressions.push({ kind: 'fixture_status', fixtureId, from, to });

    const oldAssertions = assertions(oldItem); const newAssertions = assertions(newItem);
    const assertionIds = [...new Set([...oldAssertions.keys(), ...newAssertions.keys()])].sort((a, b) => a.localeCompare(b, 'en'));
    for (const assertionId of assertionIds) {
      const assertionFrom = oldAssertions.get(assertionId) ?? 'missing';
      const assertionTo = newAssertions.get(assertionId) ?? 'missing';
      assertionTransitions.push({ fixtureId, assertionId, from: assertionFrom, to: assertionTo, changed: assertionFrom !== assertionTo });
      if (oldAssertions.has(assertionId) && !newAssertions.has(assertionId)) {
        regressions.push({ kind: 'assertion_removed', fixtureId, assertionId, from: assertionFrom, to: assertionTo });
      } else if (oldAssertions.has(assertionId) && newAssertions.has(assertionId) && assertionSeverity[assertionTo] > assertionSeverity[assertionFrom]) {
        regressions.push({ kind: 'assertion_status', fixtureId, assertionId, from: assertionFrom, to: assertionTo });
      }
    }
    if (newItem && newItem.status !== 'pass') blockers.push({ kind: 'candidate_not_releasable', fixtureId, status: newItem.status });
    if (!newItem && oldItem) blockers.push({ kind: 'candidate_not_releasable', fixtureId, status: 'missing' });
    for (const [assertionId, status] of newAssertions) {
      if (status !== 'pass') blockers.push({ kind: 'candidate_not_releasable', fixtureId, assertionId, status });
    }
  }
  for (const regression of regressions) {
    blockers.push({ kind: 'regression', fixtureId: regression.fixtureId, ...(regression.assertionId ? { assertionId: regression.assertionId } : {}), status: regression.to });
  }
  blockers.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId, 'en') || (a.assertionId ?? '').localeCompare(b.assertionId ?? '', 'en') || a.kind.localeCompare(b.kind));

  const oldAssertionCounts = { pass: 0, fail: 0, not_run: 0 };
  const newAssertionCounts = { pass: 0, fail: 0, not_run: 0 };
  for (const item of before.values()) for (const status of assertions(item).values()) oldAssertionCounts[status]++;
  for (const item of after.values()) for (const status of assertions(item).values()) newAssertionCounts[status]++;
  return {
    schema: 'nexyfab.cad-corpus-delta.v1', baselineSignature: baseline.signature, candidateSignature: candidate.signature,
    fixtureStatusTransitions, assertionTransitions,
    fixtureStatusDelta: {
      pass: delta(candidate.counts.pass, baseline.counts.pass), fail: delta(candidate.counts.fail, baseline.counts.fail),
      not_run: delta(candidate.counts.not_run, baseline.counts.not_run), error: delta(candidate.counts.error, baseline.counts.error),
    },
    assertionStatusDelta: {
      pass: delta(newAssertionCounts.pass, oldAssertionCounts.pass), fail: delta(newAssertionCounts.fail, oldAssertionCounts.fail),
      not_run: delta(newAssertionCounts.not_run, oldAssertionCounts.not_run),
    },
    regressions, blockers, releaseBlocking: blockers.length > 0,
  };
}
