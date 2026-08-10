import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const part = (id: string, x: number, fixed = false, y = 0) => ({
  id, name: id, partTemplateId: id,
  position: { x, y, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, fixed,
});

const extrudeTree = (id: string, loop: Array<{ x: number; y: number }>, depth = 2) => ({
  nodes: [{
    id, name: id, dependencies: [],
    payload: { kind: 'extrude', loop, depth, direction: 'one_sided', mode: 'add' },
  }],
});

describe('CAD v1 assembly verify', () => {
  it('combines solver DoF and conservative interference in one verdict', async () => {
    const req = new NextRequest('http://localhost/api/cad/v1/assembly/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        state: { parts: [part('a', 0, true), part('b', 5)], mates: [] },
        localBoxes: {
          a: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
          b: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
        },
      }),
    });
    const response = await POST(req);
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.dof).toBe(6);
    expect(payload.interferences).toHaveLength(1);
    expect(payload.designOk).toBe(false);
    expect(payload.interferenceMethod).toBe('aabb-spatial-conservative');
  });

  it('reports when interference was not run instead of claiming clearance', async () => {
    const req = new NextRequest('http://localhost/api/cad/v1/assembly/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: { parts: [part('a', 0, true)], mates: [] } }),
    });
    const payload = await (await POST(req)).json();
    expect(payload.interferenceMethod).toBe('not-run-no-local-boxes');
    expect(payload.designOk).toBe(false);
    expect(payload.verificationUnavailable).toHaveLength(1);
  });

  it('promotes conservative overlaps to an explicit precise-review queue', async () => {
    const req = new NextRequest('http://localhost/api/cad/v1/assembly/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        state: { parts: [part('a', 0, true), part('b', 5)], mates: [] },
        localBoxes: {
          a: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
          b: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
        },
        preciseInterference: true,
      }),
    });
    const payload = await (await POST(req)).json();
    expect(payload.preciseInterference).toMatchObject({
      status: 'unavailable-no-tessellated-part-geometry',
      candidates: ['a::b'],
      conservativeVerdictRetained: true,
    });
  });

  it('clears an AABB false positive using FeatureTree triangle geometry', async () => {
    const lProfile = [
      { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 },
      { x: 10, y: 10 }, { x: 10, y: 30 }, { x: 0, y: 30 },
    ];
    const peg = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const lTree = extrudeTree('l-body', lProfile, 10);
    const req = new NextRequest('http://localhost/api/cad/v1/assembly/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        state: { parts: [part('a', 0, true), part('b', 15, false, 15)], mates: [] },
        featureTrees: { a: lTree, b: extrudeTree('peg', peg, 10) },
        localBoxes: {
          a: { min: { x: 0, y: 0, z: 0 }, max: { x: 30, y: 30, z: 10 } },
          b: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
        },
        preciseInterference: true,
      }),
    });
    const payload = await (await POST(req)).json();
    expect(payload.interferences).toHaveLength(1);
    expect(payload.flaggedInterferences).toHaveLength(0);
    expect(payload.preciseInterference.status).toBe('completed');
    expect(payload.preciseInterference.cleared).toHaveLength(1);
    expect(payload.previewOk).toBe(true);
    expect(payload.designOk).toBe(false);
    expect(payload.releaseReady).toBe(false);
  });

  it('requires real solving, accepted DoF and precise evidence for release', async () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const req = new NextRequest('http://localhost/api/cad/v1/assembly/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        state: { parts: [part('a', 0, true)], mates: [] }, featureTrees: { a: extrudeTree('a', square, 10) },
        localBoxes: { a: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } } }, preciseInterference: true,
      }),
    });
    const payload = await (await POST(req)).json();
    expect(payload.assemblyCertificate).toMatchObject({ solver: 'pass', dofAccepted: true, rankDoF: 0, interference: 'precise' });
    expect(payload.assemblyCertificate.exactCad).toBe('pass');
    expect(payload.exactCadEvidence.a).toMatchObject({
      schema: 'nexyfab.feature-tree-exact-cad.v1', valid: true, solidCount: 1,
      freeBoundaryEdgeCount: 0, nonManifoldEdgeCount: 0,
      stepRoundTripFreeBoundaryEdgeCount: 0, stepRoundTripNonManifoldEdgeCount: 0,
    });
    expect(payload.exactCadEvidence.a.stepSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.designOk).toBe(true);
    expect(payload.releaseReady).toBe(true);
  });

  it('confirms a real solid collision using FeatureTree triangle geometry', async () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const req = new NextRequest('http://localhost/api/cad/v1/assembly/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        state: { parts: [part('a', 0, true), part('b', 5)], mates: [] },
        featureTrees: { a: extrudeTree('box-a', square, 10), b: extrudeTree('box-b', square, 10) },
        localBoxes: {
          a: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
          b: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 10 } },
        },
        preciseInterference: true,
      }),
    });
    const payload = await (await POST(req)).json();
    expect(payload.flaggedInterferences).toHaveLength(1);
    expect(payload.preciseInterference.status).toBe('completed');
    expect(payload.preciseInterference.confirmed[0].triPairsIntersecting).toBeGreaterThan(0);
    expect(payload.designOk).toBe(false);
  });

  it('ignores undersized caller AABBs and derives broad-phase bounds from exact OCCT solids', async () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const tiny = { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
    const req = new NextRequest('http://localhost/api/cad/v1/assembly/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        state: { parts: [part('a', 0, true), part('b', 5)], mates: [] },
        featureTrees: { a: extrudeTree('a-body', square, 10), b: extrudeTree('b-body', square, 10) },
        localBoxes: { a: tiny, b: tiny },
        preciseInterference: true,
      }),
    });
    const payload = await (await POST(req)).json();
    expect(payload.interferenceMethod).toBe('occt-derived-aabb-plus-precise-mesh');
    expect(payload.interferences).toHaveLength(1);
    expect(payload.flaggedInterferences).toHaveLength(1);
    expect(payload.releaseReady).toBe(false);
  });

  it('refuses release when a part has multiple unjoined terminal bodies', async () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const tree = { nodes: [
      ...extrudeTree('body-a', square, 10).nodes,
      ...extrudeTree('body-b', square.map(point => ({ x: point.x + 20, y: point.y })), 10).nodes,
    ] };
    const req = new NextRequest('http://localhost/api/cad/v1/assembly/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        state: { parts: [part('a', 0, true)], mates: [] }, featureTrees: { a: tree },
        localBoxes: { a: { min: { x: 0, y: 0, z: 0 }, max: { x: 30, y: 10, z: 10 } } }, preciseInterference: true,
      }),
    });
    const payload = await (await POST(req)).json();
    expect(payload.releaseReady).toBe(false);
    expect(payload.assemblyCertificate.exactCad).toBe('fail');
    expect(payload.verificationUnavailable.join(' ')).toContain('one explicit terminal solid');
  });

  it('requires a governed motion sweep when allowed DoF is greater than zero', async () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const req = new NextRequest('http://localhost/api/cad/v1/assembly/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        state: { parts: [part('a', 0, true), part('b', 20)], mates: [] },
        featureTrees: { a: extrudeTree('a-body', square, 10), b: extrudeTree('b-body', square, 10) },
        preciseInterference: true,
        allowedDoF: 6,
      }),
    });
    const payload = await (await POST(req)).json();
    expect(payload.assemblyCertificate).toMatchObject({ dofAccepted: true, motionRequired: true, motion: 'not_run', jointEvidence: 'fail', exactCad: 'pass' });
    expect(payload.releaseReady).toBe(false);
    expect(payload.verificationUnavailable).toContain('motion: allowedDoF > 0 requires a governed motion sweep');
    expect(payload.jointEvidenceGate).toMatchObject({ status: 'not_run', manufacturingReleaseEligible: false, errors: ['joint_evidence_missing'] });
    expect(payload.verificationInputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.verificationUnavailable.join(' ')).toContain('joint_evidence_missing');
  });
});
