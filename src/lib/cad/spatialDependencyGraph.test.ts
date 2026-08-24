import { describe, expect, it } from 'vitest';
import { evaluateSpatialDependencyGraph, invalidateSpatialDependents, SPATIAL_DEPENDENCY_GRAPH_SCHEMA, type SpatialDependencyArtifact, type SpatialDependencyGraph } from './spatialDependencyGraph';

const sha = (digit: string) => digit.repeat(64);
const artifact = (artifactId: string, domain: SpatialDependencyArtifact['domain'], kind: string, digit: string, upstreamBindings: SpatialDependencyArtifact['upstreamBindings'] = []): SpatialDependencyArtifact => ({
  artifactId, domain, kind, sourceRevision: `${artifactId}-r1`, contentSha256: sha(digit), status: 'CURRENT', upstreamBindings,
});
const bind = (value: SpatialDependencyArtifact) => ({ artifactId: value.artifactId, sourceRevision: value.sourceRevision, contentSha256: value.contentSha256 });

function graph(): SpatialDependencyGraph {
  const survey = artifact('survey', 'civil', 'approved-survey', '1');
  const surface = artifact('civil-surface', 'civil', 'proposed-surface', '2', [bind(survey)]);
  const building = artifact('building-host', 'building', 'bim-host', '3', [bind(survey)]);
  const landscape = artifact('landscape-grading', 'landscape', 'grading', '4', [bind(surface)]);
  const irrigation = artifact('irrigation', 'landscape', 'irrigation', '5', [bind(landscape)]);
  const interior = artifact('interior-layout', 'interior', 'layout', '6', [bind(building)]);
  const machine = artifact('equipment-envelope', 'mechanical', 'equipment-envelope', '7');
  const opening = artifact('service-opening', 'building', 'service-opening', '8', [bind(machine), bind(building)]);
  return { schema: SPATIAL_DEPENDENCY_GRAPH_SCHEMA, projectId: 'connected-project', artifacts: [survey, surface, building, landscape, irrigation, interior, machine, opening] };
}

describe('spatial dependency graph', () => {
  it('passes an explicit allowed cross-domain authority graph', () => {
    expect(evaluateSpatialDependencyGraph(graph())).toMatchObject({ status: 'PASS', issues: [], canonicalSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it('cascades civil, building, and mechanical revision invalidation only to their dependents', () => {
    const civil = invalidateSpatialDependents(graph(), [{ artifactId: 'civil-surface', sourceRevision: 'civil-surface-r2', contentSha256: sha('9') }]);
    expect(civil.invalidatedArtifactIds).toEqual(['irrigation', 'landscape-grading']);
    expect(civil.invalidatedArtifactIds).not.toContain('interior-layout');
    const building = invalidateSpatialDependents(graph(), [{ artifactId: 'building-host', sourceRevision: 'building-host-r2', contentSha256: sha('a') }]);
    expect(building.invalidatedArtifactIds).toEqual(['interior-layout', 'service-opening']);
    const mechanical = invalidateSpatialDependents(graph(), [{ artifactId: 'equipment-envelope', sourceRevision: 'equipment-envelope-r2', contentSha256: sha('b') }]);
    expect(mechanical.invalidatedArtifactIds).toEqual(['service-opening']);
  });

  it('rejects dangling, forbidden, stale, and cyclic dependencies', () => {
    const value = graph();
    value.artifacts[0]!.upstreamBindings = [bind(value.artifacts[5]!)];
    value.artifacts[1]!.upstreamBindings[0]!.contentSha256 = sha('0');
    value.artifacts[2]!.upstreamBindings.push({ artifactId: 'missing', sourceRevision: 'x', contentSha256: sha('1') });
    const result = evaluateSpatialDependencyGraph(value);
    expect(result.status).toBe('HOLD');
    expect(result.issues).toEqual(expect.arrayContaining([
      'dependency_domain_forbidden:interior:civil',
      'dependency_stale:civil-surface:survey',
      'dependency_missing:building-host:missing',
      'dependency_cycle:survey',
    ]));
  });
});
