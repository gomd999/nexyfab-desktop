import type { RobotEvidenceSummary, RobotInterferenceQueueItem } from './robotEvidenceBundle';

export type RobotRemediationStatus = 'resolved_reverified' | 'improved_reverified' | 'unchanged_reverified' | 'regressed_reverified' | 'new_interference';
export type RobotRemediationTransition = {
  pairKey: string;
  partA: string;
  partB: string;
  status: RobotRemediationStatus;
  beforePenetrationMm: number | null;
  afterPenetrationMm: number | null;
};

/** Compare two independently hash-bound precise-interference reports. */
export function compareRobotEvidenceRevisions(baseline: RobotEvidenceSummary, revised: RobotEvidenceSummary): RobotRemediationTransition[] {
  if (baseline.programHash === revised.programHash) throw new Error('reverification requires a different editable program hash');
  if (baseline.reportHash === revised.reportHash) throw new Error('reverification requires a different report hash');
  if (baseline.lineageId !== revised.lineageId) throw new Error('reverification must stay within the same design lineage');
  if (revised.revision <= baseline.revision) throw new Error('reverification revision must increase');
  const revisedByPair = new Map(revised.interferenceQueue.map(item => [item.pairKey, item]));
  const baselineKeys = new Set(baseline.interferenceQueue.map(item => item.pairKey));
  const transitions = baseline.interferenceQueue.map(before => {
    const after = revisedByPair.get(before.pairKey);
    if (!after) return transition(before, null, 'resolved_reverified');
    const beforeDepth = before.penetrationMm;
    const afterDepth = after.penetrationMm;
    const status = beforeDepth === null || afterDepth === null || beforeDepth === afterDepth
      ? 'unchanged_reverified'
      : afterDepth < beforeDepth ? 'improved_reverified' : 'regressed_reverified';
    return transition(before, after, status);
  });
  for (const item of revised.interferenceQueue) {
    if (!baselineKeys.has(item.pairKey)) transitions.push(transition(null, item, 'new_interference'));
  }
  return transitions.sort((a, b) => statusOrder(a.status) - statusOrder(b.status) || a.pairKey.localeCompare(b.pairKey));
}

function transition(before: RobotInterferenceQueueItem | null, after: RobotInterferenceQueueItem | null, status: RobotRemediationStatus): RobotRemediationTransition {
  const item = after ?? before!;
  return { pairKey: item.pairKey, partA: item.partA, partB: item.partB, status, beforePenetrationMm: before?.penetrationMm ?? null, afterPenetrationMm: after?.penetrationMm ?? null };
}
function statusOrder(status: RobotRemediationStatus) {
  return ({ regressed_reverified: 0, new_interference: 1, unchanged_reverified: 2, improved_reverified: 3, resolved_reverified: 4 } as const)[status];
}
