/**
 * ecoWorkflow.ts — Engineering Change Order (ECO/ECN) approval workflow.
 *
 * Stage 1 PDM (`versionBranch.ts`, `permissions.ts`, `historyView.ts`)
 * handles version history + ACLs. Stage 2 (here) adds the *governance*
 * layer that real manufacturing companies require:
 *
 *   - **ECO state machine**: Draft → Review → CCB → Approved →
 *     Released → Obsolete. (CCB = Change Control Board.)
 *   - **Multi-stage signoff** — each transition requires N approvers
 *     from a named role group (Engineering, Quality, Operations,
 *     Finance).
 *   - **Effectivity** — when does the change actually take effect?
 *     Options: immediate, by date, by serial number, by lot.
 *   - **Affected items** — list of part numbers + drawings + assemblies
 *     impacted; locks them during review.
 *   - **Cost impact** — estimated cost of the change (tooling re-cut,
 *     re-work existing inventory).
 *   - **Disposition of existing stock** — use as-is / rework / scrap /
 *     return to supplier.
 *
 * Audit trail records every state transition with timestamp +
 * actor. This is the basis of ISO 9001 / IATF 16949 / AS9100 change
 * control compliance.
 */

export type EcoState = 'draft' | 'review' | 'ccb' | 'approved' | 'released' | 'obsolete' | 'cancelled';

export type EffectivityKind = 'immediate' | 'date' | 'serial' | 'lot';

export interface Effectivity {
  kind: EffectivityKind;
  /** ISO date string for 'date' effectivity. */
  effectiveAt?: string;
  /** Serial number prefix or range for 'serial'. */
  serialFrom?: string;
  serialTo?: string;
  /** Lot id for 'lot'. */
  lotId?: string;
}

export type DispositionKind = 'use-as-is' | 'rework' | 'scrap' | 'return-to-supplier';

export interface StockDisposition {
  itemId: string;
  itemRevision: string;
  quantity: number;
  disposition: DispositionKind;
  notes?: string;
}

export type ApproverRole = 'engineering' | 'quality' | 'operations' | 'finance' | 'ccb-chair';

export interface ApprovalRequirement {
  /** Required role for this signoff. */
  role: ApproverRole;
  /** Required number of approvers from that role. */
  count: number;
}

export interface ApprovalSignature {
  approverId: string;
  approverName: string;
  role: ApproverRole;
  signedAt: string;
  /** Approval, rejection, or abstention. */
  decision: 'approve' | 'reject' | 'abstain';
  comment?: string;
}

export interface AffectedItem {
  itemId: string;
  itemName: string;
  fromRevision: string;
  toRevision: string;
  changeType: 'minor' | 'major' | 'form-fit-function';
}

export interface EcoRecord {
  id: string;
  title: string;
  description: string;
  state: EcoState;
  /** Reason code per ISO 9001 (defect, design improvement, supplier change, etc). */
  reasonCode: string;
  createdAt: string;
  createdBy: string;
  affectedItems: AffectedItem[];
  effectivity: Effectivity;
  /** Cost impact (USD). */
  costImpactUsd?: number;
  /** Approval requirements for the CURRENT transition. */
  currentApprovalRequirements: ApprovalRequirement[];
  /** All signatures gathered so far. */
  signatures: ApprovalSignature[];
  /** Stock disposition plan. */
  stockDispositions: StockDisposition[];
  /** Audit trail. */
  history: Array<{
    timestamp: string;
    fromState: EcoState | null;
    toState: EcoState;
    actor: string;
    action: 'create' | 'transition' | 'sign' | 'reject' | 'comment';
    detail?: string;
  }>;
}

// ── Transition graph ─────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<EcoState, EcoState[]> = {
  draft: ['review', 'cancelled'],
  review: ['draft', 'ccb', 'cancelled'],
  ccb: ['review', 'approved', 'cancelled'],
  approved: ['released', 'cancelled'],
  released: ['obsolete'],
  obsolete: [],
  cancelled: [],
};

export function canTransition(from: EcoState, to: EcoState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// ── Approval bookkeeping ─────────────────────────────────────────

export function hasMetApprovals(eco: EcoRecord): boolean {
  for (const req of eco.currentApprovalRequirements) {
    const matchingApprovals = eco.signatures.filter(s =>
      s.role === req.role && s.decision === 'approve',
    ).length;
    if (matchingApprovals < req.count) return false;
  }
  return true;
}

export function hasAnyRejection(eco: EcoRecord): boolean {
  return eco.signatures.some(s => s.decision === 'reject');
}

// ── State machine driver ─────────────────────────────────────────

export interface TransitionResult {
  success: boolean;
  newState?: EcoState;
  reason?: string;
}

export function transitionEco(
  eco: EcoRecord,
  toState: EcoState,
  actor: string,
  detail?: string,
): TransitionResult {
  if (!canTransition(eco.state, toState)) {
    return { success: false, reason: `Cannot go from ${eco.state} to ${toState}` };
  }
  // Forward transitions (along the happy path) require approvals — but
  // the first hop from draft → review is a *submission* step that just
  // opens the ECO for review; approvals are gathered DURING review
  // before the next forward hop.
  const forwardChain: EcoState[] = ['draft', 'review', 'ccb', 'approved', 'released'];
  const isForward = forwardChain.indexOf(toState) > forwardChain.indexOf(eco.state);
  const isInitialSubmission = eco.state === 'draft' && toState === 'review';
  if (isForward && !isInitialSubmission && !hasMetApprovals(eco)) {
    return { success: false, reason: 'Approval requirements not met' };
  }
  if (isForward && hasAnyRejection(eco)) {
    return { success: false, reason: 'Rejection present — clear before advancing' };
  }
  eco.history.push({
    timestamp: new Date().toISOString(),
    fromState: eco.state, toState, actor, action: 'transition', detail,
  });
  eco.state = toState;
  // Clear signatures on backward transitions (they need re-signing).
  if (!isForward) eco.signatures = [];
  return { success: true, newState: toState };
}

export function signEco(
  eco: EcoRecord,
  signature: Omit<ApprovalSignature, 'signedAt'>,
): { success: boolean; reason?: string } {
  // Can only sign during review or CCB.
  if (eco.state !== 'review' && eco.state !== 'ccb') {
    return { success: false, reason: `Cannot sign in state ${eco.state}` };
  }
  // No duplicate signatures from the same approver.
  if (eco.signatures.some(s => s.approverId === signature.approverId)) {
    return { success: false, reason: 'Already signed by this approver' };
  }
  const full: ApprovalSignature = { ...signature, signedAt: new Date().toISOString() };
  eco.signatures.push(full);
  eco.history.push({
    timestamp: full.signedAt,
    fromState: eco.state, toState: eco.state,
    actor: signature.approverId,
    action: signature.decision === 'reject' ? 'reject' : 'sign',
    detail: signature.comment,
  });
  return { success: true };
}

// ── ECO factory ──────────────────────────────────────────────────

export function createEco(input: {
  id: string;
  title: string;
  description: string;
  createdBy: string;
  reasonCode: string;
  affectedItems: AffectedItem[];
  effectivity: Effectivity;
  approvalRequirements?: ApprovalRequirement[];
  costImpactUsd?: number;
}): EcoRecord {
  const now = new Date().toISOString();
  return {
    id: input.id,
    title: input.title,
    description: input.description,
    state: 'draft',
    reasonCode: input.reasonCode,
    createdAt: now,
    createdBy: input.createdBy,
    affectedItems: input.affectedItems,
    effectivity: input.effectivity,
    costImpactUsd: input.costImpactUsd,
    currentApprovalRequirements: input.approvalRequirements ?? [
      { role: 'engineering', count: 1 },
      { role: 'quality', count: 1 },
    ],
    signatures: [],
    stockDispositions: [],
    history: [{
      timestamp: now,
      fromState: null, toState: 'draft',
      actor: input.createdBy, action: 'create',
    }],
  };
}

// ── Effectivity check ────────────────────────────────────────────

/** True when the effectivity criterion is satisfied for this serial /
 *  date / lot. Used by manufacturing routings to decide which revision
 *  to manufacture. */
export function isEffectiveFor(
  effectivity: Effectivity,
  context: { serial?: string; date?: string; lotId?: string },
): boolean {
  switch (effectivity.kind) {
    case 'immediate':
      return true;
    case 'date':
      if (!effectivity.effectiveAt || !context.date) return false;
      return context.date >= effectivity.effectiveAt;
    case 'serial':
      if (!context.serial) return false;
      if (effectivity.serialFrom && context.serial < effectivity.serialFrom) return false;
      if (effectivity.serialTo && context.serial > effectivity.serialTo) return false;
      return true;
    case 'lot':
      return effectivity.lotId === context.lotId;
  }
}

// ── ECO summary ──────────────────────────────────────────────────

export interface EcoSummary {
  state: EcoState;
  approvalProgress: Array<{ role: ApproverRole; got: number; need: number }>;
  blockedReason?: string;
  affectedItemCount: number;
  totalSignatures: number;
  hasRejection: boolean;
  daysSinceCreated: number;
}

export function summarizeEco(eco: EcoRecord): EcoSummary {
  const progress = eco.currentApprovalRequirements.map(req => {
    const got = eco.signatures.filter(s => s.role === req.role && s.decision === 'approve').length;
    return { role: req.role, got, need: req.count };
  });
  const now = Date.now();
  const created = Date.parse(eco.createdAt);
  return {
    state: eco.state,
    approvalProgress: progress,
    blockedReason: hasAnyRejection(eco)
      ? 'has rejection'
      : !hasMetApprovals(eco)
        ? 'approvals not met'
        : undefined,
    affectedItemCount: eco.affectedItems.length,
    totalSignatures: eco.signatures.length,
    hasRejection: hasAnyRejection(eco),
    daysSinceCreated: Math.floor((now - created) / (1000 * 60 * 60 * 24)),
  };
}
