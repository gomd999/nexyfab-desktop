import type { DesignIntentInputKind } from './designIntentCheckpoint';
import {
  createAiDesignUnifiedWorkspaceV9,
  type AiDesignUnifiedRecoveryV9,
  type AiDesignUnifiedWorkspaceSourceV9,
  type AiDesignUnifiedWorkspaceV9,
} from './aiDesignUnifiedWorkspaceV9';

export const INTEGRATION_FIXTURE_V1_SCHEMA = 'nexyfab.integration-fixture.v1' as const;

export type IntegrationFixtureKindV1 =
  | 'empty'
  | 'needs-question'
  | 'generating'
  | 'three-candidate-review'
  | 'gauge-preview'
  | 'stale'
  | 'offline-mobile'
  | 'model-fallback'
  | 'precision-pending'
  | 'precision-pass-receipt';

export interface IntegrationFixturePrecisionReceiptV1 {
  receiptId: string;
  status: 'PASS';
  signer: 'precision-cad-server';
  signatureStatus: 'server-signed-fixture-only';
  fixtureOnly: true;
  nonRelease: true;
  browserAuthored: false;
}

export interface IntegrationFixtureV1 {
  schema: typeof INTEGRATION_FIXTURE_V1_SCHEMA;
  fixtureId: `integration-v1:${IntegrationFixtureKindV1}`;
  kind: IntegrationFixtureKindV1;
  deterministic: true;
  rendererNeutral: true;
  bounded: true;
  containsUserContent: false;
  containsRawGeometry: false;
  containsSecrets: false;
  browserAuthoredPass: false;
  nonRelease: true;
  precision: { status: 'NOT_RUN' | 'PASS' | 'FAIL' | 'STALE'; requestId: string | null; receiptId: string | null };
  workspace: AiDesignUnifiedWorkspaceV9;
  precisionReceipt: IntegrationFixturePrecisionReceiptV1 | null;
}

const ONLINE: AiDesignUnifiedRecoveryV9 = {
  state: 'online', blocking: false, title: 'online', message: 'synchronized', safeActions: [], mutationEnabled: true,
};
const STALE: AiDesignUnifiedRecoveryV9 = {
  state: 'stale_revision', blocking: true, title: 'stale_revision', message: 'refresh_required', safeActions: ['REFRESH_SERVER_STATE'], mutationEnabled: false,
};
const OFFLINE: AiDesignUnifiedRecoveryV9 = {
  state: 'offline', blocking: true, title: 'offline', message: 'resume_when_online', safeActions: ['REFRESH_SERVER_STATE'], mutationEnabled: false,
};

type Region = AiDesignUnifiedWorkspaceSourceV9['workspace']['base']['layout']['primaryRegion'];

export function createIntegrationFixtureSourceV1(kind: IntegrationFixtureKindV1): AiDesignUnifiedWorkspaceSourceV9 {
  const mobile = kind === 'offline-mobile';
  const region: Region = kind === 'empty' ? 'understanding'
    : kind === 'needs-question' ? 'understanding'
      : kind === 'generating' ? 'generation'
        : kind === 'three-candidate-review' ? 'comparison'
          : kind === 'gauge-preview' ? 'editing'
            : kind === 'precision-pending' || kind === 'precision-pass-receipt' ? 'precision'
              : kind === 'stale' || kind === 'offline-mobile' ? 'recovery' : 'comparison';
  const hasInput = kind !== 'empty';
  const candidates = kind === 'three-candidate-review'
    ? [{ candidateId: 'candidate-1', status: 'READY', conceptReviewReady: true }, { candidateId: 'candidate-2', status: 'READY', conceptReviewReady: true }, { candidateId: 'candidate-3', status: 'READY', conceptReviewReady: true }]
    : [{ candidateId: 'candidate-1', status: kind === 'generating' ? 'RUNNING' : 'READY', conceptReviewReady: kind !== 'generating' }];
  const candidateId = kind === 'empty' || kind === 'needs-question' || kind === 'generating' || kind === 'stale' || kind === 'offline-mobile' ? null : 'candidate-1';
  const precisionStatus = kind === 'precision-pass-receipt' ? 'PASS' : kind === 'stale' ? 'STALE' : 'NOT_RUN';
  const recovery = kind === 'stale' ? STALE : kind === 'offline-mobile' ? OFFLINE : ONLINE;
  const inputKinds: readonly DesignIntentInputKind[] = hasInput ? ['text'] : [];
  return {
    projectId: 'fixture-project-v1', sessionId: 'fixture-session-v1', runtimeRevision: 1, complexRevision: 1,
    staleAgainstRuntime: kind === 'stale', inputKinds,
    workspace: {
      base: {
        layout: { mode: mobile ? 'mobile' : 'desktop', primaryRegion: region, mobileSheet: mobile ? 'recovery' : null, stickyPrimaryAction: mobile },
        model: { publicModelId: kind === 'model-fallback' ? 'fallback-model-v1' : 'bounded-model-v1', selectionStatus: 'selected', explanation: kind === 'model-fallback' ? ['fallback_active', 'primary_provider_unavailable'] : ['bounded_fixture_model'], exactGeometryAuthority: false },
        // A bounded token preserves the V9 shape without carrying a user-authored prompt.
        intent: { questions: kind === 'needs-question' ? [{ id: 'question-parameter-v1', prompt: 'question_required' }] : [] },
        generation: { status: kind === 'generating' ? 'RUNNING' : 'CANDIDATE_READY', currentStage: kind === 'generating' ? 'candidate-generation' : null, failure: null },
        candidates: { visible: kind !== 'empty' && kind !== 'needs-question' && kind !== 'generating', selectedCandidateId: candidateId },
        gauges: [{ gaugeId: 'gauge-parameter-v1', label: 'parameter', targetValue: kind === 'gauge-preview' ? 42 : 40, unit: 'unit', requiresConfirmation: true }],
        primaryAction: { command: 'FIXTURE_ACTION', label: 'fixture_action', enabled: recovery.mutationEnabled, reason: recovery.mutationEnabled ? null : 'recovery_required' },
        trust: { conceptOnly: true, precisionVerification: precisionStatus, manufacturingReleaseReady: false },
      },
      assemblyGauges: [{ gaugeId: 'gauge-parameter-v1', parameterId: 'parameter-v1', label: 'parameter', targetValue: kind === 'gauge-preview' ? 42 : 40, unit: 'unit' }],
      candidateEvaluations: candidates,
    },
    precision: { status: precisionStatus, requestIds: kind === 'precision-pending' || kind === 'precision-pass-receipt' ? ['precision-request-v1'] : [], receiptIds: kind === 'precision-pass-receipt' ? ['precision-receipt-v1'] : [], manufacturingReleaseReady: false },
  };
}

export function createIntegrationFixtureV1(kind: IntegrationFixtureKindV1): IntegrationFixtureV1 {
  const workspace = createAiDesignUnifiedWorkspaceV9(createIntegrationFixtureSourceV1(kind), { recovery: kind === 'stale' ? STALE : kind === 'offline-mobile' ? OFFLINE : ONLINE, locale: 'en', activeCanvasMode: kind === 'offline-mobile' ? '3d' : undefined });
  const precisionReceipt = kind === 'precision-pass-receipt' ? { receiptId: 'precision-receipt-v1', status: 'PASS' as const, signer: 'precision-cad-server' as const, signatureStatus: 'server-signed-fixture-only' as const, fixtureOnly: true as const, nonRelease: true as const, browserAuthored: false as const } : null;
  return Object.freeze({ schema: INTEGRATION_FIXTURE_V1_SCHEMA, fixtureId: `integration-v1:${kind}`, kind, deterministic: true, rendererNeutral: true, bounded: true, containsUserContent: false, containsRawGeometry: false, containsSecrets: false, browserAuthoredPass: false, nonRelease: true, precision: { status: createIntegrationFixtureSourceV1(kind).precision.status, requestId: kind === 'precision-pending' || kind === 'precision-pass-receipt' ? 'precision-request-v1' : null, receiptId: kind === 'precision-pass-receipt' ? 'precision-receipt-v1' : null }, workspace, precisionReceipt });
}

export const INTEGRATION_FIXTURE_KINDS_V1: readonly IntegrationFixtureKindV1[] = ['empty', 'needs-question', 'generating', 'three-candidate-review', 'gauge-preview', 'stale', 'offline-mobile', 'model-fallback', 'precision-pending', 'precision-pass-receipt'];
export const INTEGRATION_FIXTURES_V1: readonly IntegrationFixtureV1[] = INTEGRATION_FIXTURE_KINDS_V1.map(createIntegrationFixtureV1);

export function validateIntegrationFixtureV1(fixture: IntegrationFixtureV1): string[] {
  const issues: string[] = [];
  if (fixture.schema !== INTEGRATION_FIXTURE_V1_SCHEMA || fixture.fixtureId !== `integration-v1:${fixture.kind}`) issues.push('fixture_identity_invalid');
  if (!fixture.deterministic || !fixture.rendererNeutral || !fixture.bounded || fixture.containsUserContent || fixture.containsRawGeometry || fixture.containsSecrets) issues.push('fixture_safety_invalid');
  if (fixture.workspace.authority.manufacturingReleaseReady || fixture.workspace.sync.commitAllowed || fixture.browserAuthoredPass) issues.push('fixture_authority_invalid');
  if (fixture.kind === 'precision-pass-receipt' && fixture.precision.status !== 'PASS') issues.push('fixture_precision_status_invalid');
  if (fixture.kind === 'precision-pass-receipt' && (!fixture.precisionReceipt || !fixture.precisionReceipt.fixtureOnly || !fixture.precisionReceipt.nonRelease || fixture.precisionReceipt.browserAuthored)) issues.push('fixture_precision_pass_boundary_invalid');
  if (fixture.kind !== 'precision-pass-receipt' && fixture.precisionReceipt) issues.push('fixture_unexpected_receipt');
  return issues;
}
