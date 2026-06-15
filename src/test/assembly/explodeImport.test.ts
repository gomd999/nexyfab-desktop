/**
 * explodeImport — parse/validate + replay-rebuild tests (Phase 3.4).
 */
import { describe, it, expect } from 'vitest';
import {
  parseExplodeImport,
  explodedStateFromImport,
} from '@/lib/assembly/explodeImport';
import {
  IDENTITY_QUAT,
  partInstance,
  type AssemblyState,
  type PartInstance,
} from '@/lib/assembly/assemblyState';

function P(id: string, pos: [number, number, number]): PartInstance {
  return partInstance({
    id, name: id, partTemplateId: 't',
    position: { x: pos[0], y: pos[1], z: pos[2] }, orientation: IDENTITY_QUAT,
  });
}

const validJson = JSON.stringify({
  assembly: 'demo',
  heuristic: 'mate_axes',
  scale: 1.5,
  steps: [
    { partId: 'B', order: 0, axis: { x: 1, y: 0, z: 0 }, distance: 15, from: {}, to: {} },
    { partId: 'C', order: 1, axis: { x: 0, y: 1, z: 0 }, distance: 0 },
  ],
});

describe('parseExplodeImport', () => {
  it('parses a valid export (tolerating extra from/to keys)', () => {
    const res = parseExplodeImport(validJson);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.steps).toHaveLength(2);
    expect(res.value.steps[0]).toMatchObject({ partId: 'B', order: 0, distance: 15 });
    expect(res.value.assembly).toBe('demo');
    expect(res.value.scale).toBe(1.5);
  });

  it('rejects invalid JSON', () => {
    const res = parseExplodeImport('{not json');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/invalid JSON/);
  });

  it('rejects a missing steps array', () => {
    const res = parseExplodeImport(JSON.stringify({ assembly: 'x' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/steps/);
  });

  it('rejects a step with a bad axis', () => {
    const res = parseExplodeImport(JSON.stringify({ steps: [{ partId: 'B', order: 0, axis: { x: 1 }, distance: 1 }] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/axis/);
  });

  it('rejects a negative distance', () => {
    const res = parseExplodeImport(JSON.stringify({ steps: [{ partId: 'B', order: 0, axis: { x: 0, y: 0, z: 1 }, distance: -2 }] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/distance/);
  });

  it('rejects a step missing partId', () => {
    const res = parseExplodeImport(JSON.stringify({ steps: [{ order: 0, axis: { x: 0, y: 0, z: 1 }, distance: 1 }] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/partId/);
  });
});

describe('explodedStateFromImport', () => {
  const state = (): AssemblyState => ({
    parts: [P('A', [0, 0, 0]), P('B', [10, 0, 0]), P('C', [20, 0, 0])],
    mates: [],
  });

  it('displaces matching parts by axis × distance and leaves others put', () => {
    const res = parseExplodeImport(validJson);
    if (!res.ok) throw new Error('parse failed');
    const exploded = explodedStateFromImport(state(), res.value);
    const b = exploded.displacedState.parts.find((p) => p.id === 'B')!;
    expect(b.position).toEqual({ x: 25, y: 0, z: 0 }); // 10 + 1*15
    const a = exploded.displacedState.parts.find((p) => p.id === 'A')!;
    expect(a.position).toEqual({ x: 0, y: 0, z: 0 }); // no step
    // C has distance 0 → unmoved.
    const c = exploded.displacedState.parts.find((p) => p.id === 'C')!;
    expect(c.position).toEqual({ x: 20, y: 0, z: 0 });
  });

  it('ignores steps whose partId is absent from the assembly', () => {
    const imported = { steps: [{ partId: 'GHOST', order: 0, axis: { x: 0, y: 0, z: 1 }, distance: 5 }] };
    const exploded = explodedStateFromImport(state(), imported);
    expect(exploded.steps).toHaveLength(0); // GHOST filtered out
    // no part moved
    expect(exploded.displacedState.parts.map((p) => p.position)).toEqual(
      state().parts.map((p) => p.position),
    );
  });
});
