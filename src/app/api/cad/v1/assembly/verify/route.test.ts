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
    const barX = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 0, y: 10 }];
    const barY = [{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 30 }, { x: 0, y: 30 }];
    const peg = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const lTree = { nodes: [...extrudeTree('bar-x', barX, 10).nodes, ...extrudeTree('bar-y', barY, 10).nodes] };
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
});
