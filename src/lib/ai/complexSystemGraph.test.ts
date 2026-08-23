import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildComplexSystemGraphFixture } from './complexSystemGraph.testFixture';
import { verifyComplexSystemGraphBytes } from './complexSystemGraph';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('Complex System Graph v2', () => {
  it('binds hierarchy, function, flow, safety, manufacturing, inspection and maintenance to exact artifact bytes', () => {
    const fixture = buildComplexSystemGraphFixture(), report = verifyComplexSystemGraphBytes(fixture.graphBytes, fixture.artifacts);
    expect(report).toMatchObject({ status: 'passed', graphReady: true, family: 'gearbox', errors: [], unresolved: [], coverage: { artifactByteCoverage: 1, nodeSourceCoverage: 1, edgeSourceCoverage: 1, evidenceSubjectCoverage: 1 }, familyContractRequired: true, physicalValidationRequired: true, releaseReady: false, sideEffects: { persisted: false, cadModified: false, quoteCreated: false, rfqSent: false } });
    expect(report.graphHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects changed or undeclared artifact bytes', () => {
    const fixture = buildComplexSystemGraphFixture();
    fixture.artifacts.set('system-source.json', encode({ tampered: true }));
    fixture.artifacts.set('extra.bin', encode('extra'));
    const report = verifyComplexSystemGraphBytes(fixture.graphBytes, fixture.artifacts);
    expect(report.errors).toEqual(expect.arrayContaining(['artifact_hash_mismatch:system-source.json', 'artifact_undeclared:extra.bin']));
    expect(report.graphReady).toBe(false);
  });

  it('rejects declared and uploaded artifacts that no graph subject or evidence uses', () => {
    const fixture = buildComplexSystemGraphFixture(), unused = encode('unused');
    fixture.graph.artifacts.push({ name: 'unused.bin', sha256: createHash('sha256').update(unused).digest('hex'), authority: 'customer', mediaType: 'application/octet-stream' });
    fixture.artifacts.set('unused.bin', unused);
    expect(verifyComplexSystemGraphBytes(encode(fixture.graph), fixture.artifacts).errors).toContain('artifact_unreferenced:unused.bin');
  });

  it('rejects unallocated requirements, missing part authority and invalid relation endpoints', () => {
    const fixture = buildComplexSystemGraphFixture();
    fixture.graph.edges = fixture.graph.edges.filter(item => !['allocate', 'make'].includes(item.id));
    fixture.graph.edges.find(item => item.id === 'mitigate')!.to = 'part-made';
    const report = verifyComplexSystemGraphBytes(encode(fixture.graph), fixture.artifacts);
    expect(report.errors).toEqual(expect.arrayContaining(['requirement_unallocated:req', 'part_source_count_invalid:part-made:0', 'edge_kind_invalid:mitigate:hazard:mitigated_by:part']));
  });

  it('keeps unresolved nodes and uncovered evidence subjects out of pass', () => {
    const fixture = buildComplexSystemGraphFixture();
    fixture.graph.nodes.find(item => item.id === 'service-envelope')!.status = 'unresolved';
    fixture.graph.evidence[0]!.supportingEdgeIds = fixture.graph.evidence[0]!.supportingEdgeIds.filter(id => id !== 'service');
    const report = verifyComplexSystemGraphBytes(encode(fixture.graph), fixture.artifacts);
    expect(report.status).toBe('not_run');
    expect(report.unresolved).toEqual(expect.arrayContaining(['node_unresolved:service-envelope', 'evidence_subject_uncovered:service']));
  });

  it('rejects containment cycles and malformed JSON without side effects', () => {
    const fixture = buildComplexSystemGraphFixture();
    fixture.graph.edges.push({ id: 'cycle', kind: 'contains', from: 'assembly', to: 'assembly', status: 'confirmed', sourceArtifactNames: ['system-source.json'] });
    expect(verifyComplexSystemGraphBytes(encode(fixture.graph), fixture.artifacts).status).toBe('failed');
    expect(verifyComplexSystemGraphBytes(encode('{'), new Map())).toMatchObject({ status: 'failed', graphReady: false, releaseReady: false, sideEffects: { persisted: false, cadModified: false } });
  });
});
