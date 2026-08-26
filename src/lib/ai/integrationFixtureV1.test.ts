import { describe, expect, it } from 'vitest';
import { createIntegrationFixtureV1, INTEGRATION_FIXTURE_KINDS_V1, INTEGRATION_FIXTURES_V1, validateIntegrationFixtureV1 } from './integrationFixtureV1';

describe('IntegrationFixtureV1', () => {
  it('provides every bounded renderer-neutral integration state', () => {
    expect(INTEGRATION_FIXTURES_V1).toHaveLength(10);
    expect(INTEGRATION_FIXTURES_V1.map(fixture => fixture.kind)).toEqual(INTEGRATION_FIXTURE_KINDS_V1);
    for (const fixture of INTEGRATION_FIXTURES_V1) expect(validateIntegrationFixtureV1(fixture)).toEqual([]);
  });

  it('keeps state-specific branches explicit', () => {
    expect(createIntegrationFixtureV1('needs-question').workspace.chat.stage).toBe('understanding');
    expect(createIntegrationFixtureV1('generating').workspace.chat.stage).toBe('generation');
    expect(createIntegrationFixtureV1('three-candidate-review').workspace.cards[0]?.references.candidateId).toBe('candidate-1');
    expect(createIntegrationFixtureV1('three-candidate-review').workspace.cards[0]?.kind).toBe('comparison');
    expect(createIntegrationFixtureV1('gauge-preview').workspace.cards[0]?.kind).toBe('change_preview');
    expect(createIntegrationFixtureV1('offline-mobile').workspace.recovery.state).toBe('offline');
    expect(createIntegrationFixtureV1('model-fallback').workspace.model.publicModelId).toBe('fallback-model-v1');
  });

  it('marks Precision PASS as server-signed fixture-only and non-release', () => {
    const fixture = createIntegrationFixtureV1('precision-pass-receipt');
    expect(fixture.precision.status).toBe('PASS');
    expect(fixture.precisionReceipt).toMatchObject({ signer: 'precision-cad-server', fixtureOnly: true, nonRelease: true, browserAuthored: false });
    expect(fixture.workspace.authority.manufacturingReleaseReady).toBe(false);
  });
});
