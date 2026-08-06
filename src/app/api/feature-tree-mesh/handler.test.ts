import { describe, expect, it, vi } from 'vitest';
import { handleFeatureTreeMesh } from './handler';

const tree = { nodes: [{ id: 'base', name: 'Base', dependencies: [], payload: { kind: 'extrude' as const, loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], depth: 5, direction: 'one_sided' as const, mode: 'add' as const } }] };

describe('feature-tree mesh handler', () => {
  it('replays a validated tree and returns binary STL as base64', async () => {
    const render = vi.fn(async (_scad: string) => ({ ok: true as const, bytes: Buffer.from([1, 2, 3]) }));
    const result = await handleFeatureTreeMesh(tree, render);
    expect(result.status).toBe(200);
    expect(result.payload.stl).toBe('AQID');
    expect(render.mock.calls[0]?.[0]).toContain('linear_extrude');
  });

  it('rejects a dangling dependency before rendering', async () => {
    const invalid = { nodes: [{ ...tree.nodes[0]!, dependencies: ['missing'] }] };
    const render = vi.fn();
    const result = await handleFeatureTreeMesh(invalid, render);
    expect(result.status).toBe(422);
    expect(result.payload.code).toBe('INVALID_TREE');
    expect(render).not.toHaveBeenCalled();
  });
});
