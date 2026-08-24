export const AI_DESIGN_USABILITY_EVENT_SCHEMA = 'nexyfab.ai-design-usability-event.v1' as const;
export const AI_DESIGN_USABILITY_SUMMARY_SCHEMA = 'nexyfab.ai-design-usability-summary.v1' as const;

export const AI_DESIGN_USABILITY_EVENT_TYPES = [
  'WORKSPACE_OPENED',
  'STARTER_SELECTED',
  'FIRST_INPUT_SUBMITTED',
  'CANVAS_OPENED',
  'VIEW_MODE_CHANGED',
  'HELP_OPENED',
  'INVALID_ACTION',
  'PREVIEW_CREATED',
  'CONCEPT_CHANGE_APPLIED',
  'RECOVERY_STARTED',
  'RECOVERY_COMPLETED',
  'PRECISION_REQUESTED',
  'SCENARIO_COMPLETED',
] as const;

export type AiDesignUsabilityEventType = (typeof AI_DESIGN_USABILITY_EVENT_TYPES)[number];

export interface AiDesignUsabilityEventV1 {
  schema: typeof AI_DESIGN_USABILITY_EVENT_SCHEMA;
  eventId: string;
  scenarioId: string;
  type: AiDesignUsabilityEventType;
  elapsedMs: number;
  device: 'desktop' | 'mobile';
  inputKind: 'none' | 'text' | 'drawing_2d' | 'image_or_sketch' | 'existing_3d';
  viewMode: 'chat' | '2d' | '3d' | 'split';
  result: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN';
  reasonCode: string | null;
  containsUserContent: false;
  containsGeometry: false;
  containsPersonalData: false;
}

export interface AiDesignUsabilitySummaryV1 {
  schema: typeof AI_DESIGN_USABILITY_SUMMARY_SCHEMA;
  scenarioId: string;
  device: 'desktop' | 'mobile';
  eventCount: number;
  timeToFirstInputMs: number | null;
  timeToCompletionMs: number | null;
  helpOpenCount: number;
  invalidActionCount: number;
  recoveryCount: number;
  completed: boolean;
  heuristic: {
    firstActionWithoutInstruction: 'PASS' | 'FAIL' | 'NOT_RUN';
    lowAssistance: 'PASS' | 'FAIL';
    lowError: 'PASS' | 'FAIL';
    note: 'heuristic_only_not_release_evidence';
  };
  privacy: {
    userContentCollected: false;
    geometryCollected: false;
    personalDataCollected: false;
  };
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FIRST_ACTION_TARGET_MS = 45_000;

export function createAiDesignUsabilityEvent(input: Omit<AiDesignUsabilityEventV1, 'schema' | 'containsUserContent' | 'containsGeometry' | 'containsPersonalData'>): AiDesignUsabilityEventV1 {
  if (!SAFE_ID.test(input.eventId) || !SAFE_ID.test(input.scenarioId)) throw new Error('usability_event_identity_invalid');
  if (!AI_DESIGN_USABILITY_EVENT_TYPES.includes(input.type) || !Number.isSafeInteger(input.elapsedMs) || input.elapsedMs < 0 || input.elapsedMs > 24 * 60 * 60 * 1_000) throw new Error('usability_event_contract_invalid');
  if (input.reasonCode !== null && !SAFE_CODE.test(input.reasonCode)) throw new Error('usability_event_reason_invalid');
  const event: AiDesignUsabilityEventV1 = {
    ...input,
    schema: AI_DESIGN_USABILITY_EVENT_SCHEMA,
    containsUserContent: false,
    containsGeometry: false,
    containsPersonalData: false,
  };
  return Object.freeze(event);
}

/** Aggregates bounded interaction evidence without prompts, drawing bytes, geometry, or identity. */
export function summarizeAiDesignUsability(events: readonly AiDesignUsabilityEventV1[]): AiDesignUsabilitySummaryV1 {
  if (!events.length) throw new Error('usability_events_required');
  const scenarioId = events[0]!.scenarioId;
  const device = events[0]!.device;
  if (events.some(event => event.schema !== AI_DESIGN_USABILITY_EVENT_SCHEMA || event.scenarioId !== scenarioId || event.device !== device)) throw new Error('usability_event_binding_mismatch');
  if (new Set(events.map(event => event.eventId)).size !== events.length) throw new Error('usability_event_duplicate');
  for (let index = 1; index < events.length; index += 1) {
    if (events[index]!.elapsedMs < events[index - 1]!.elapsedMs) throw new Error('usability_event_order_invalid');
  }
  const ordered = [...events];
  const firstInput = ordered.find(event => event.type === 'FIRST_INPUT_SUBMITTED' && event.result === 'PASS') ?? null;
  const completion = [...ordered].reverse().find(event => event.type === 'SCENARIO_COMPLETED' && event.result === 'PASS') ?? null;
  const helpOpenCount = ordered.filter(event => event.type === 'HELP_OPENED').length;
  const invalidActionCount = ordered.filter(event => event.type === 'INVALID_ACTION').length;
  const summary: AiDesignUsabilitySummaryV1 = {
    schema: AI_DESIGN_USABILITY_SUMMARY_SCHEMA,
    scenarioId,
    device,
    eventCount: ordered.length,
    timeToFirstInputMs: firstInput?.elapsedMs ?? null,
    timeToCompletionMs: completion?.elapsedMs ?? null,
    helpOpenCount,
    invalidActionCount,
    recoveryCount: ordered.filter(event => event.type === 'RECOVERY_STARTED').length,
    completed: completion !== null,
    heuristic: {
      firstActionWithoutInstruction: firstInput === null ? 'NOT_RUN' : firstInput.elapsedMs <= FIRST_ACTION_TARGET_MS ? 'PASS' : 'FAIL',
      lowAssistance: helpOpenCount <= 1 ? 'PASS' : 'FAIL',
      lowError: invalidActionCount <= 1 ? 'PASS' : 'FAIL',
      note: 'heuristic_only_not_release_evidence' as const,
    },
    privacy: { userContentCollected: false as const, geometryCollected: false as const, personalDataCollected: false as const },
  };
  return Object.freeze(summary);
}
