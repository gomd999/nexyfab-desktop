import type { ManufacturingGateId, ManufacturingGateReport } from './manufacturingGates';

export type RepairDisposition = 'auto_retry' | 'user_input' | 'manual_review' | 'stop';
export type RepairActionType =
  | 'regenerate_program_from_ir'
  | 'rebuild_same_program'
  | 'heal_topology'
  | 'rebuild_from_confirmed_dimensions'
  | 'replay_missing_features'
  | 'reexport_and_reimport_step';

export interface ManufacturingRepairAction {
  type: RepairActionType;
  gate: ManufacturingGateId;
  instruction: string;
  immutableFields: string[];
  prohibitedChanges: string[];
}

export interface ManufacturingRepairPlan {
  disposition: RepairDisposition;
  gate: ManufacturingGateId | null;
  fingerprint: string;
  attempt: number;
  maxAttempts: number;
  actions: ManufacturingRepairAction[];
  message: string;
}

export interface RepairHistoryEntry {
  fingerprint: string;
  gate: ManufacturingGateId | null;
  at: number;
}

export interface ManufacturingRepairPolicyInput {
  report: ManufacturingGateReport;
  history?: RepairHistoryEntry[];
  maxAttempts?: number;
  /** Confirmed IR keys that no repair is allowed to edit. */
  confirmedDimensionKeys?: string[];
}

function fingerprintOf(report: ManufacturingGateReport): string {
  const gate = report.gates.find(item => item.id === report.firstBlockingGate);
  const normalized = (gate?.failures ?? [])
    .map(value => value.replace(/-?\d+(?:\.\d+)?/g, '#').replace(/\s+/g, ' ').trim())
    .sort();
  return `${report.firstBlockingGate ?? 'PASS'}::${normalized.join('|')}`;
}

const actionFor = (gate: ManufacturingGateId, immutableFields: string[]): ManufacturingRepairAction | null => {
  const common = {
    gate,
    immutableFields,
    prohibitedChanges: ['confirmed dimensions', 'units', 'part count', 'manufacturing process', 'material'],
  };
  switch (gate) {
    case 'G2': return { ...common, type: 'regenerate_program_from_ir', instruction: 'Regenerate only the invalid feature-program structure from the confirmed IR.' };
    case 'G3': return { ...common, type: 'rebuild_same_program', instruction: 'Rebuild the exact same validated program in the analytic kernel.' };
    case 'G4': return { ...common, type: 'heal_topology', instruction: 'Apply kernel topology healing to the same geometry; do not resize the part.' };
    case 'G5': return { ...common, type: 'rebuild_from_confirmed_dimensions', instruction: 'Rebuild geometry from confirmed IR dimensions; never alter the expected dimensions to match the result.' };
    case 'G6': return { ...common, type: 'replay_missing_features', instruction: 'Replay only requested missing features with their confirmed parameters.' };
    case 'G8': return { ...common, type: 'reexport_and_reimport_step', instruction: 'Re-export the same artifact and re-import it for comparison; do not substitute mesh STEP.' };
    default: return null;
  }
};

/** Convert the first blocking gate into a bounded, non-destructive repair plan. */
export function planManufacturingRepair(input: ManufacturingRepairPolicyInput): ManufacturingRepairPlan {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3);
  const fingerprint = fingerprintOf(input.report);
  if (input.report.passed) {
    return { disposition: 'stop', gate: null, fingerprint, attempt: 0, maxAttempts, actions: [], message: 'All manufacturing gates passed; no repair is needed.' };
  }
  const gate = input.report.firstBlockingGate;
  if (!gate) {
    return { disposition: 'stop', gate: null, fingerprint, attempt: 0, maxAttempts, actions: [], message: 'No actionable blocking gate was reported.' };
  }
  const repeats = (input.history ?? []).filter(entry => entry.fingerprint === fingerprint).length;
  const attempt = repeats + 1;
  if (attempt > maxAttempts) {
    return { disposition: 'stop', gate, fingerprint, attempt, maxAttempts, actions: [], message: `Stopped after ${maxAttempts} identical repair failures at ${gate}.` };
  }
  if (gate === 'G0' || gate === 'G1') {
    return { disposition: 'user_input', gate, fingerprint, attempt, maxAttempts, actions: [], message: gate === 'G0'
      ? 'Input provenance or privacy consent must be resolved by the user.'
      : 'Missing or conflicting design intent must be resolved by the user.' };
  }
  if (gate === 'G7' || gate === 'G9') {
    return { disposition: 'manual_review', gate, fingerprint, attempt, maxAttempts, actions: [], message: gate === 'G7'
      ? 'DFM violations require an engineer-approved design or process decision.'
      : 'The exact artifact requires explicit manufacturing release authorization.' };
  }
  const action = actionFor(gate, input.confirmedDimensionKeys ?? []);
  if (!action) {
    return { disposition: 'stop', gate, fingerprint, attempt, maxAttempts, actions: [], message: `No safe automatic repair exists for ${gate}.` };
  }
  return { disposition: 'auto_retry', gate, fingerprint, attempt, maxAttempts, actions: [action], message: action.instruction };
}

/** Safe feedback adapter for the existing SCAD repair loop. */
export function manufacturingRepairFeedback(plan: ManufacturingRepairPlan): string {
  if (plan.disposition !== 'auto_retry') return plan.message;
  const action = plan.actions[0];
  return [
    `Manufacturing repair ${plan.attempt}/${plan.maxAttempts} at ${plan.gate}.`,
    action.instruction,
    `Immutable confirmed fields: ${action.immutableFields.join(', ') || '(all confirmed IR dimensions)'}.`,
    `Forbidden changes: ${action.prohibitedChanges.join(', ')}.`,
    'Return the complete repaired feature program and preserve every value not named by this repair.',
  ].join('\n');
}

export interface ManufacturingPolicyVerdict {
  passed: boolean;
  feedback: string;
  retryable: boolean;
  score: number;
}

/** Adapter consumed structurally by scad-agent's existing GateVerdict contract. */
export function manufacturingReportVerdict(
  report: ManufacturingGateReport,
  options: Omit<ManufacturingRepairPolicyInput, 'report'> = {},
): { verdict: ManufacturingPolicyVerdict; plan: ManufacturingRepairPlan } {
  const plan = planManufacturingRepair({ ...options, report });
  return {
    plan,
    verdict: {
      passed: report.passed,
      feedback: manufacturingRepairFeedback(plan),
      retryable: !report.passed && plan.disposition === 'auto_retry',
      score: report.gates.filter(gate => gate.status === 'passed').length / report.gates.length,
    },
  };
}
