import type { StructuredBrief } from './brief-expander/types';

export type EvidenceKind =
  | 'user_text'
  | 'drawing_dimension'
  | 'dxf_entity'
  | 'photo_measurement'
  | 'standard_reference'
  | 'model_inference';

export interface DesignEvidence {
  id: string;
  kind: EvidenceKind;
  sourceRef: string;
  excerpt?: string;
  confidence: number;
}

export type DecisionStatus = 'confirmed' | 'assumed' | 'needs_input' | 'conflict';

export interface DesignDecision {
  id: string;
  componentId: string;
  key: string;
  value: number | string | null;
  unit: string | null;
  status: DecisionStatus;
  evidenceIds: string[];
  rationale?: string;
}

export interface DesignIntentIR {
  version: 1;
  title: string;
  domain: string;
  evidence: DesignEvidence[];
  decisions: DesignDecision[];
}

export interface IntentIRGateResult {
  ready: boolean;
  blockingDecisionIds: string[];
  reasons: string[];
}

function stableId(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-|-$/g, '') || 'item';
}

/** Preserve brief provenance instead of flattening every number into authoritative CAD params. */
export function structuredBriefToDesignIntentIR(brief: StructuredBrief): DesignIntentIR {
  const promptEvidenceId = 'evidence:user-prompt';
  const evidence: DesignEvidence[] = [{
    id: promptEvidenceId,
    kind: 'user_text',
    sourceRef: 'structured-brief.raw',
    excerpt: brief.raw,
    confidence: 1,
  }];
  const decisions: DesignDecision[] = [];

  brief.components.forEach((component, componentIndex) => {
    const componentId = `component:${stableId(component.name)}-${componentIndex + 1}`;
    component.params.forEach((param, paramIndex) => {
      const id = `${componentId}:param:${stableId(param.key)}-${paramIndex + 1}`;
      const status: DecisionStatus = param.source === 'given'
        ? 'confirmed'
        : param.source === 'assumption'
          ? 'assumed'
          : 'needs_input';
      decisions.push({
        id,
        componentId,
        key: param.key,
        value: param.value,
        unit: param.unit,
        status,
        evidenceIds: param.source === 'given' ? [promptEvidenceId] : [],
        rationale: param.note,
      });
    });
  });

  return { version: 1, title: brief.title, domain: brief.domain, evidence, decisions };
}

/** Add evidence without silently overwriting an existing design decision. */
export function addEvidenceDecision(
  ir: DesignIntentIR,
  evidence: DesignEvidence,
  decision: Omit<DesignDecision, 'status'>,
): DesignIntentIR {
  const matching = ir.decisions.filter(item =>
    item.componentId === decision.componentId && item.key === decision.key && item.value !== null,
  );
  const conflicts = matching.some(item => item.value !== decision.value || item.unit !== decision.unit);
  const nextStatus: DecisionStatus = conflicts ? 'conflict' : 'confirmed';
  const decisions = ir.decisions.map(item =>
    conflicts && item.componentId === decision.componentId && item.key === decision.key
      ? { ...item, status: 'conflict' as const }
      : item,
  );
  decisions.push({ ...decision, status: nextStatus });
  return { ...ir, evidence: [...ir.evidence, evidence], decisions };
}

/** Resolve one open/assumed decision with an explicit user answer. */
export function confirmDesignDecision(
  ir: DesignIntentIR,
  decisionId: string,
  value: number | string,
  userAnswer: string,
): DesignIntentIR {
  const target = ir.decisions.find(decision => decision.id === decisionId);
  if (!target) return ir;
  const evidenceId = `evidence:user-confirmation:${ir.evidence.length + 1}`;
  const evidence: DesignEvidence = {
    id: evidenceId,
    kind: 'user_text',
    sourceRef: `confirmation:${decisionId}`,
    excerpt: userAnswer,
    confidence: 1,
  };
  return {
    ...ir,
    evidence: [...ir.evidence, evidence],
    decisions: ir.decisions.map(decision => decision.id === decisionId ? {
      ...decision,
      value,
      status: 'confirmed',
      evidenceIds: [evidenceId],
      rationale: decision.status === 'assumed'
        ? `User confirmed prior assumption: ${decision.rationale ?? decision.key}`
        : decision.rationale,
    } : decision),
  };
}

/** Manufacturing compilation accepts only resolved, evidenced decisions. */
export function gateDesignIntentIR(ir: DesignIntentIR): IntentIRGateResult {
  const evidenceIds = new Set(ir.evidence.map(item => item.id));
  const blocking = ir.decisions.filter(decision => {
    if (decision.status === 'assumed' || decision.status === 'needs_input' || decision.status === 'conflict') return true;
    if (decision.value === null) return true;
    if (decision.status === 'confirmed') {
      return decision.evidenceIds.length === 0 || decision.evidenceIds.some(id => !evidenceIds.has(id));
    }
    return false;
  });
  const reasons = blocking.map(decision => {
    if (decision.status === 'conflict') return `${decision.key} has conflicting evidence.`;
    if (decision.status === 'needs_input' || decision.value === null) return `${decision.key} needs user input.`;
    if (decision.status === 'assumed') return `${decision.key} is still an unconfirmed assumption.`;
    return `${decision.key} has no traceable evidence.`;
  });
  return { ready: blocking.length === 0, blockingDecisionIds: blocking.map(item => item.id), reasons };
}

/** Only confirmed decisions become authoritative compiler parameters. */
export function authoritativeParams(
  ir: DesignIntentIR,
  componentId: string,
): Record<string, number | string> {
  const gate = gateDesignIntentIR(ir);
  if (!gate.ready) return {};
  return Object.fromEntries(ir.decisions
    .filter(item => item.componentId === componentId && item.status === 'confirmed' && item.value !== null)
    .map(item => [item.key, item.value as number | string]));
}
