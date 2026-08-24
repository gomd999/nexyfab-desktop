import { expect, test } from '@playwright/test';
import { createAiDesignUnifiedWorkspaceV9 } from '../src/lib/ai/aiDesignUnifiedWorkspaceV9';
import { createIntegrationFixtureSourceV1 } from '../src/lib/ai/integrationFixtureV1';

function serverPayload() {
  const source = createIntegrationFixtureSourceV1('gauge-preview');
  const model = {
    ...source,
    schema: 'nexyfab.ai-design-complex-workspace-read-model.v4',
    aggregateDigest: 'a'.repeat(64),
    availableActions: [],
    workspace: {
      ...source.workspace,
      assemblyTree: [
        { nodeId: 'assembly-frame', label: 'Assembly frame', kind: 'assembly', parentId: null, depth: 0, path: ['assembly-frame'], childCount: 1, expandable: true, selected: false, heat: 'none', reasons: [] },
        { nodeId: 'sensor-bracket', label: 'Sensor bracket', kind: 'part', parentId: 'assembly-frame', depth: 1, path: ['assembly-frame', 'sensor-bracket'], childCount: 0, expandable: false, selected: false, heat: 'attention', reasons: ['concept_change'] },
      ],
      interfaces: [],
      constraints: { activeConflictCount: 0, unresolvedCount: 0, resolvedCount: 0, affectedStructureNodeIds: [], domains: [], resolutionAction: { command: 'RESOLVE_INTENT_CONFLICT', enabled: false, requiresExplicitChoice: true, automaticResolution: false } },
      assemblyGauges: [{ bindingId: 'binding-1', gaugeId: 'gauge-parameter-v1', label: 'Bracket width', structureNodeId: 'sensor-bracket', structurePath: ['assembly-frame', 'sensor-bracket'], parameterId: 'parameter-v1', scope: 'component', interfaceId: null, targetValue: 40, unit: 'mm', fineStep: 1, coarseStep: 5, affectedNodeCount: 1, requiresConfirmation: true, touchTargetMinPx: 44 }],
      changeHeatmap: [],
      candidateEvaluations: source.workspace.candidateEvaluations.map(item => ({ ...item, status: 'NOT_RUN', failedCritics: [], pendingCritics: [], engineeringVerified: false, manufacturingReleaseReady: false })),
      inspector: { desktopTabs: ['assembly', 'interfaces', 'constraints', 'gauges', 'impact', 'evaluation'], mobileSheets: ['assembly', 'interfaces', 'constraints', 'gauges', 'impact', 'evaluation', 'recovery'], selectedNodeId: null, stickyActionBar: true, touchTargetMinPx: 44 },
      trust: { conceptOnly: true, structuralPlanningStatus: 'NOT_RUN', crossDomainPlanningStatus: 'NOT_RUN', engineeringVerificationStatus: 'NOT_RUN', exactCadVerificationStatus: 'NOT_RUN', manufacturingReleaseReady: false },
    },
  } as const;
  return { model, ux: {}, unified: createAiDesignUnifiedWorkspaceV9(model, { recovery: { state: 'online', blocking: false, title: 'Online', message: 'Synchronized', safeActions: [], mutationEnabled: true }, locale: 'en' }) };
}

test('V10 chat-first workspace links stable selection across real 2D and Three canvases', async ({ page }) => {
  await page.route('**/api/nexyfab/ai-design/workspace-session/complex-workspace?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(serverPayload()) }));
  await page.goto('/en/nexyfab/ai?projectId=fixture-project-v1&sessionId=fixture-session-v1', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('ai-design-v10-workspace')).toBeVisible();
  await expect(page.getByTestId('concept-2d-view')).toBeVisible();
  await expect(page.getByTestId('concept-3d-view')).toBeVisible();
  await expect(page.getByText('Exact CAD: Precision CAD · Release: false')).toBeVisible();
  await page.getByRole('button', { name: 'Sensor bracket' }).click();
  await expect(page.getByText('Linked selection: Sensor bracket')).toBeVisible();
  await expect(page.getByText('NEEDS_INPUT · Precision mapping required')).toBeVisible();

  const touchTargets = await page.getByTestId('ai-design-v10-workspace').locator('button:visible').evaluateAll(items => items.map(item => item.getBoundingClientRect().height));
  expect(Math.min(...touchTargets)).toBeGreaterThanOrEqual(44);
});
