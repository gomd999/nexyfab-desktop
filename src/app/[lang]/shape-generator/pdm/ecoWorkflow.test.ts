import { describe, it, expect } from 'vitest';
import {
  createEco,
  canTransition,
  transitionEco,
  signEco,
  hasMetApprovals,
  hasAnyRejection,
  isEffectiveFor,
  summarizeEco,
} from './ecoWorkflow';

function makeBasic() {
  return createEco({
    id: 'ECO-001',
    title: 'Update hole spacing',
    description: 'Customer requested 0.5mm shift',
    createdBy: 'alice',
    reasonCode: 'customer-request',
    affectedItems: [
      { itemId: 'P100', itemName: 'Plate', fromRevision: 'A', toRevision: 'B', changeType: 'minor' },
    ],
    effectivity: { kind: 'immediate' },
  });
}

describe('canTransition', () => {
  it('draft → review allowed', () => {
    expect(canTransition('draft', 'review')).toBe(true);
  });

  it('draft → released NOT allowed (skip)', () => {
    expect(canTransition('draft', 'released')).toBe(false);
  });

  it('obsolete is terminal', () => {
    expect(canTransition('obsolete', 'draft')).toBe(false);
    expect(canTransition('obsolete', 'released')).toBe(false);
  });
});

describe('createEco', () => {
  it('starts in draft state with history entry', () => {
    const eco = makeBasic();
    expect(eco.state).toBe('draft');
    expect(eco.history).toHaveLength(1);
    expect(eco.history[0]!.action).toBe('create');
  });

  it('defaults to engineering + quality approval', () => {
    const eco = makeBasic();
    expect(eco.currentApprovalRequirements).toHaveLength(2);
  });
});

describe('signEco', () => {
  it('can sign during review state', () => {
    const eco = makeBasic();
    eco.state = 'review';
    const r = signEco(eco, {
      approverId: 'u1', approverName: 'Bob', role: 'engineering', decision: 'approve',
    });
    expect(r.success).toBe(true);
    expect(eco.signatures).toHaveLength(1);
  });

  it('rejects double signing by same approver', () => {
    const eco = makeBasic();
    eco.state = 'review';
    signEco(eco, { approverId: 'u1', approverName: 'Bob', role: 'engineering', decision: 'approve' });
    const r = signEco(eco, { approverId: 'u1', approverName: 'Bob', role: 'engineering', decision: 'approve' });
    expect(r.success).toBe(false);
  });

  it('rejects signing in draft', () => {
    const eco = makeBasic();
    const r = signEco(eco, { approverId: 'u1', approverName: 'Bob', role: 'engineering', decision: 'approve' });
    expect(r.success).toBe(false);
  });

  it('rejection signature blocks forward progression', () => {
    const eco = makeBasic();
    eco.state = 'review';
    signEco(eco, { approverId: 'u1', approverName: 'Bob', role: 'engineering', decision: 'reject' });
    expect(hasAnyRejection(eco)).toBe(true);
  });
});

describe('hasMetApprovals', () => {
  it('false when no signatures', () => {
    expect(hasMetApprovals(makeBasic())).toBe(false);
  });

  it('true when all required approvals collected', () => {
    const eco = makeBasic();
    eco.state = 'review';
    signEco(eco, { approverId: 'e1', approverName: 'X', role: 'engineering', decision: 'approve' });
    signEco(eco, { approverId: 'q1', approverName: 'Y', role: 'quality', decision: 'approve' });
    expect(hasMetApprovals(eco)).toBe(true);
  });
});

describe('transitionEco', () => {
  it('forward transition blocked without approvals', () => {
    const eco = makeBasic();
    transitionEco(eco, 'review', 'alice');
    // Try to advance to CCB without signoffs.
    const r = transitionEco(eco, 'ccb', 'alice');
    expect(r.success).toBe(false);
  });

  it('forward transition succeeds with approvals', () => {
    const eco = makeBasic();
    transitionEco(eco, 'review', 'alice');
    signEco(eco, { approverId: 'e1', approverName: 'X', role: 'engineering', decision: 'approve' });
    signEco(eco, { approverId: 'q1', approverName: 'Y', role: 'quality', decision: 'approve' });
    const r = transitionEco(eco, 'ccb', 'alice');
    expect(r.success).toBe(true);
    expect(eco.state).toBe('ccb');
  });

  it('backward transition clears signatures', () => {
    const eco = makeBasic();
    transitionEco(eco, 'review', 'alice');
    signEco(eco, { approverId: 'e1', approverName: 'X', role: 'engineering', decision: 'approve' });
    transitionEco(eco, 'draft', 'alice'); // backward
    expect(eco.signatures).toHaveLength(0);
  });

  it('history entry added on transition', () => {
    const eco = makeBasic();
    const before = eco.history.length;
    transitionEco(eco, 'review', 'alice');
    expect(eco.history.length).toBe(before + 1);
  });

  it('rejection blocks forward even with approvals met', () => {
    const eco = makeBasic();
    transitionEco(eco, 'review', 'alice');
    signEco(eco, { approverId: 'e1', approverName: 'X', role: 'engineering', decision: 'approve' });
    signEco(eco, { approverId: 'q1', approverName: 'Y', role: 'quality', decision: 'reject' });
    const r = transitionEco(eco, 'ccb', 'alice');
    expect(r.success).toBe(false);
  });
});

describe('isEffectiveFor', () => {
  it('immediate: always effective', () => {
    expect(isEffectiveFor({ kind: 'immediate' }, {})).toBe(true);
  });

  it('date: only after effectiveAt', () => {
    const ef = { kind: 'date' as const, effectiveAt: '2026-06-01' };
    expect(isEffectiveFor(ef, { date: '2026-05-01' })).toBe(false);
    expect(isEffectiveFor(ef, { date: '2026-07-01' })).toBe(true);
  });

  it('serial: within range', () => {
    const ef = { kind: 'serial' as const, serialFrom: 'SN100', serialTo: 'SN200' };
    expect(isEffectiveFor(ef, { serial: 'SN150' })).toBe(true);
    expect(isEffectiveFor(ef, { serial: 'SN050' })).toBe(false);
    expect(isEffectiveFor(ef, { serial: 'SN300' })).toBe(false);
  });

  it('lot: exact match', () => {
    const ef = { kind: 'lot' as const, lotId: 'LOT-A' };
    expect(isEffectiveFor(ef, { lotId: 'LOT-A' })).toBe(true);
    expect(isEffectiveFor(ef, { lotId: 'LOT-B' })).toBe(false);
  });
});

describe('summarizeEco', () => {
  it('emits approval progress per role', () => {
    const eco = makeBasic();
    eco.state = 'review';
    signEco(eco, { approverId: 'e1', approverName: 'X', role: 'engineering', decision: 'approve' });
    const s = summarizeEco(eco);
    expect(s.approvalProgress.find(p => p.role === 'engineering')?.got).toBe(1);
    expect(s.approvalProgress.find(p => p.role === 'quality')?.got).toBe(0);
  });

  it('blockedReason when not all approvals', () => {
    const eco = makeBasic();
    eco.state = 'review';
    const s = summarizeEco(eco);
    expect(s.blockedReason).toBe('approvals not met');
  });

  it('hasRejection flag', () => {
    const eco = makeBasic();
    eco.state = 'review';
    signEco(eco, { approverId: 'e1', approverName: 'X', role: 'engineering', decision: 'reject' });
    expect(summarizeEco(eco).hasRejection).toBe(true);
  });

  it('daysSinceCreated computed', () => {
    const eco = makeBasic();
    eco.createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const s = summarizeEco(eco);
    expect(s.daysSinceCreated).toBe(3);
  });
});
