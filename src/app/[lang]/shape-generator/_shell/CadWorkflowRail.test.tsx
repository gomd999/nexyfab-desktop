import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CadWorkflowRail } from './CadWorkflowRail';

describe('CadWorkflowRail', () => {
  it('shows AI product completion with conditional precise CAD and evidence-gated release', () => {
    const html = renderToStaticMarkup(
      <CadWorkflowRail
        lang="ko"
        hasModel
        dfmWarningCount={0}
        onAiDesign={vi.fn()}
        onPreciseCad={vi.fn()}
        onVerify={vi.fn()}
        onExportEvidencePackage={vi.fn()}
      />,
    );
    expect(html).toContain('AI 기계·제품 구현');
    expect(html).toContain('정밀 CAD 엔진');
    expect(html).toContain('일반 사용자는 AI 자동 처리 · 전문가는 필요할 때 직접 편집');
    expect(html).toContain('부품·조립·동작·제조 범위를 구현');
    expect(html).toContain('DFM 통과 · 정밀 릴리스 증거 확인 필요');
    expect(html).toContain('증거 없이는 제조 승인 안 됨');
    expect(html).toContain('외부 CAD 설치 불필요');
    expect(html).not.toContain('제조 승인 완료');
  });

  it('highlights precise CAD only when governed execution evidence requires it', () => {
    const html = renderToStaticMarkup(<CadWorkflowRail lang="ko" hasModel dfmWarningCount={1} executionPlan={{
      schema: 'nexyfab.adaptive-complex-product-execution.v1', objective: 'complete_manufacturing_product', status: 'precision_cad_required', activeStage: 'assembly_solve', designComplete: false, releaseReady: false, aiCanContinue: true, nextAction: 'run_ai_managed_precision_cad', achievedStages: ['intent'], pendingStages: ['assembly_solve'], affectedPartIds: ['arm'], reasonCodes: ['PRECISE_INTERFERENCE_PRESENT'], precisionCad: { required: true, entryStage: 'assembly_solve', reasonCodes: ['PRECISE_INTERFERENCE_PRESENT'], scope: 'assembly_or_product', executionMode: 'ai_managed', generalUserActionRequired: false, expertWorkspaceAvailable: true, expertWorkspaceRequired: false }, audienceSupport: { generalUser: { supported: true, workflow: 'ai_guided' }, expertUser: { supported: true, workflow: 'ai_or_manual_precision' } }, manualDesign: { availableDuringAiWorkflow: true, exactParameterEntry: true, userValueLocksOverrideAi: true, preservedToExpertHandoff: true, expertDirectEditingAvailable: true }, generationAccuracy: { modelReportedConfidenceIsSufficient: false, serverValidatedProductPlan: true, requirementToPartTraceRequired: true, authoritativeInputsRequiredBeforeExactGeometry: true, assemblyMateConnectivityRequired: true, repeatedDefinitionsMustRemainIdentical: true, inventedEvidenceReferencesRejected: true }, externalCadInstallationRequired: false,
    }} onAiDesign={vi.fn()} onPreciseCad={vi.fn()} onVerify={vi.fn()} onExportEvidencePackage={vi.fn()} />);
    expect(html).toContain('AI가 지정 범위를 정밀 CAD로 자동 처리 중 · 전문가 편집 선택 가능');
    expect(html).toContain('data-testid="cad-workflow-local-repair"');
    expect(html).toContain('영향 부품 1개');
    expect(html).toContain('PRECISE_INTERFERENCE_PRESENT');
  });

  it('uses discipline language instead of mechanical product and DFM wording outside mechanical', () => {
    const html = renderToStaticMarkup(
      <CadWorkflowRail
        lang="ko"
        domain="interior"
        hasModel
        dfmWarningCount={2}
        onAiDesign={vi.fn()}
        onPreciseCad={vi.fn()}
        onVerify={vi.fn()}
        onExportEvidencePackage={vi.fn()}
      />,
    );
    expect(html).toContain('AI 인테리어 구현');
    expect(html).toContain('실측·동선·가구·천장·마감 범위를 구현');
    expect(html).toContain('형상·분야 이슈 2건');
    expect(html).not.toContain('복잡 제품을 부품·조립');
    expect(html).not.toContain('DFM 이슈 2건');
  });
});
