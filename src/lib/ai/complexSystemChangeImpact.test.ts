import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildComplexSystemGraphFixture } from './complexSystemGraph.testFixture';
import { analyzeComplexSystemChangeImpactBytes } from './complexSystemChangeImpact';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('Complex System Graph change impact', () => {
  it('reuses unchanged evidence for a revision-only update', () => {
    const base = buildComplexSystemGraphFixture(), target = structuredClone(base.graph); target.revision++;
    expect(analyzeComplexSystemChangeImpactBytes(base.graphBytes, encode(target), base.artifacts, base.artifacts)).toMatchObject({ status: 'passed', impactPlanReady: true, scope: 'none', revalidationRequired: false, invalidatedEvidenceIds: [], reusableEvidenceIds: ['system-review'], releaseReady: false });
  });

  it('invalidates only the dependency cone for a part change', () => {
    const base = buildComplexSystemGraphFixture(), target = structuredClone(base.graph); target.revision++; target.nodes.find(node => node.id === 'part-made')!.attributes.massKg = 4.5;
    const report = analyzeComplexSystemChangeImpactBytes(base.graphBytes, encode(target), base.artifacts, base.artifacts);
    expect(report).toMatchObject({ status: 'passed', impactPlanReady: true, scope: 'partial', revalidationRequired: true, directlyChangedNodeIds: ['part-made'], invalidatedEvidenceIds: ['system-review'], reusableEvidenceIds: [], releaseReady: false });
    expect(report.affectedNodeIds).toEqual(expect.arrayContaining(['part-made', 'assembly', 'function', 'req']));
    expect(report.affectedNodeIds).not.toContain('hazard');
  });

  it('expands a shared source artifact change to full revalidation', () => {
    const base = buildComplexSystemGraphFixture(), target = structuredClone(base.graph), bytes = encode('new authoritative source'); target.revision++; target.artifacts[0]!.sha256 = createHash('sha256').update(bytes).digest('hex');
    const report = analyzeComplexSystemChangeImpactBytes(base.graphBytes, encode(target), base.artifacts, new Map([['system-source.json', bytes]]));
    expect(report).toMatchObject({ status: 'passed', scope: 'full', revalidationRequired: true, invalidatedEvidenceIds: ['system-review'] });
    expect(report.changes.artifacts.modified).toEqual(['system-source.json']);
  });

  it('rejects cross-system, skipped-revision and unverified graphs', () => {
    const base = buildComplexSystemGraphFixture(), target = structuredClone(base.graph); target.systemId = 'other'; target.revision += 2;
    const invalid = analyzeComplexSystemChangeImpactBytes(base.graphBytes, encode(target), base.artifacts, base.artifacts);
    expect(invalid.errors).toEqual(expect.arrayContaining(['system_id_mismatch', 'target_revision_must_increment_by_one']));
    expect(invalid).toMatchObject({ status: 'failed', impactPlanReady: false, scope: null, releaseReady: false });
    const malformed = analyzeComplexSystemChangeImpactBytes(encode('{'), encode(target), new Map(), base.artifacts);
    expect(malformed.errors).toContain('base_graph_not_ready');
  });
});
