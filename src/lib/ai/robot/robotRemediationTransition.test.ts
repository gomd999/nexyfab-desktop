import { describe, expect, it } from 'vitest';
import type { RobotEvidenceSummary, RobotInterferenceQueueItem } from './robotEvidenceBundle';
import { compareRobotEvidenceRevisions } from './robotRemediationTransition';

const pair = (partA: string, partB: string, penetrationMm: number): RobotInterferenceQueueItem => ({
  id: `${partA}-${partB}`, pairKey: [partA, partB].sort().join('\u0000'), partA, partB, penetrationMm,
  category: 'drive-structural', priority: 'high', recommendedAction: 'resize_or_reselect_drive',
});
const summary = (programHash: string, reportHash: string, interferenceQueue: RobotInterferenceQueueItem[], revision = 1, lineageId = 'robot-lineage'): RobotEvidenceSummary => ({
  programHash, reportHash, lineageId, revision, programArtifact: `editable-program-${programHash}.json`, editableParts: 3, mates: 2,
  rankDoF: 1, allowedDoF: 1, flaggedInterferences: interferenceQueue.length, collisionFrames: 0, motionFrames: 1,
  catalogStatus: 'not_run', housingStatus: 'not_run', claimedReleaseReady: false, effectiveReleaseReady: false,
  blockers: ['expert_approval_not_granted'], interferenceQueue,
});

describe('robot remediation evidence transition', () => {
  it('derives only reverified statuses from two different evidence revisions', () => {
    const before = summary('a'.repeat(64), 'b'.repeat(64), [pair('motor', 'arm', 12), pair('bearing', 'arm', 4), pair('motor', 'bearing', 3)]);
    const after = summary('c'.repeat(64), 'd'.repeat(64), [pair('motor', 'arm', 5), pair('bearing', 'arm', 7), pair('new', 'arm', 2)], 2);
    const transitions = compareRobotEvidenceRevisions(before, after);
    expect(transitions.map(item => item.status)).toEqual(['regressed_reverified', 'new_interference', 'improved_reverified', 'resolved_reverified']);
  });

  it('refuses to call the same program a reverified edit', () => {
    const before = summary('a'.repeat(64), 'b'.repeat(64), [pair('motor', 'arm', 12)]);
    expect(() => compareRobotEvidenceRevisions(before, { ...before, reportHash: 'c'.repeat(64), revision: 2, interferenceQueue: [] })).toThrow('different editable program hash');
  });

  it('refuses a reused report even if a caller substitutes a program hash', () => {
    const before = summary('a'.repeat(64), 'b'.repeat(64), []);
    expect(() => compareRobotEvidenceRevisions(before, { ...before, programHash: 'c'.repeat(64), revision: 2 })).toThrow('different report hash');
  });

  it('refuses a different design lineage and a non-increasing revision', () => {
    const before = summary('a'.repeat(64), 'b'.repeat(64), []);
    expect(() => compareRobotEvidenceRevisions(before, summary('c'.repeat(64), 'd'.repeat(64), [], 2, 'other-lineage'))).toThrow('same design lineage');
    expect(() => compareRobotEvidenceRevisions(before, summary('c'.repeat(64), 'd'.repeat(64), [], 1))).toThrow('revision must increase');
  });
});
