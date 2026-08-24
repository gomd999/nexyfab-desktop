import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { listAiDesignComplexScenarioDefinitions, runAiDesignComplexProductScenario } from './aiDesignComplexProductScenarios';

const secret = 'complex-scenario-signing-secret-at-least-32-bytes';

describe('AI Design complex product golden scenarios', () => {
  it('covers machine, tooling, and electromechanical products', () => {
    expect(listAiDesignComplexScenarioDefinitions().map(item => item.scenarioId)).toEqual(['machine-assembly', 'mold-tooling', 'electromechanical-enclosure']);
  });

  for (const scenarioId of ['machine-assembly', 'mold-tooling', 'electromechanical-enclosure'] as const) {
    it(`runs ${scenarioId} through structure, constraints, partitions, critics, V4 commands, and responsive UX`, async () => {
      const report = await runAiDesignComplexProductScenario(scenarioId, secret);
      expect(report).toMatchObject({
        status: 'PASS', partitions: { coverage: 'complete', issues: [] }, critics: { bundles: 2, conceptReviewReady: 2, failed: 0 },
        ux: { assemblyGauges: 1, minimumTouchTargetPx: 44 }, precisionCadRequired: true,
        commandPath: { status: 'PASS', complexRevision: 4, precisionRequestCreated: true },
        exactCadVerificationStatus: 'NOT_RUN', manufacturingReleaseReady: false, issues: [],
      });
      expect(report.structure.nodes).toBeGreaterThanOrEqual(7);
      expect(report.structure.interfaces).toBeGreaterThanOrEqual(4);
      expect(report.constraints.domains).toBeGreaterThanOrEqual(5);
      expect(report.ux.mobileSheets).toBeGreaterThanOrEqual(7);
    });
  }
});
