import { describe, it, expect } from 'vitest';
import {
  detectSpikes,
  applySmoothing,
  severity,
  summarize,
  type MeshData,
} from './meshSpikeDetector';

// Flat hexagonal patch: centre + 6 surrounding vertices at unit distance.
function hexPatch(centreZ: number): MeshData {
  const vertices = [
    { x: 0, y: 0, z: centreZ }, // 0 = centre
    { x: 1, y: 0, z: 0 },
    { x: 0.5, y: 0.866, z: 0 },
    { x: -0.5, y: 0.866, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: -0.5, y: -0.866, z: 0 },
    { x: 0.5, y: -0.866, z: 0 },
  ];
  const triangles = [
    { id: 't1', v0: 0, v1: 1, v2: 2 },
    { id: 't2', v0: 0, v1: 2, v2: 3 },
    { id: 't3', v0: 0, v1: 3, v2: 4 },
    { id: 't4', v0: 0, v1: 4, v2: 5 },
    { id: 't5', v0: 0, v1: 5, v2: 6 },
    { id: 't6', v0: 0, v1: 6, v2: 1 },
  ];
  return { vertices, triangles };
}

describe('detectSpikes', () => {
  it('empty mesh → no spikes', () => {
    expect(detectSpikes({ vertices: [], triangles: [] }).spikes).toEqual([]);
  });

  it('flat patch (centre on plane) → no spikes', () => {
    const r = detectSpikes(hexPatch(0));
    expect(r.spikes).toHaveLength(0);
  });

  it('centre spiked up → flagged', () => {
    const r = detectSpikes(hexPatch(10));
    expect(r.spikes.length).toBeGreaterThan(0);
    expect(r.spikes[0]!.vertexIndex).toBe(0);
  });

  it('protrusion is distance to centroid', () => {
    const r = detectSpikes(hexPatch(5));
    expect(r.spikes[0]!.protrusionMm).toBeCloseTo(5, 1);
  });

  it('action = delete for very high spikiness', () => {
    const r = detectSpikes(hexPatch(50), { spikinessThreshold: 2, minNeighbours: 3 });
    expect(r.spikes[0]!.suggestedAction).toBe('delete');
  });

  it('action = smooth for moderate spikiness', () => {
    const r = detectSpikes(hexPatch(3), { spikinessThreshold: 2, minNeighbours: 3 });
    expect(r.spikes[0]!.suggestedAction).toBe('smooth');
  });

  it('threshold filters borderline cases', () => {
    const r = detectSpikes(hexPatch(1.5), { spikinessThreshold: 5, minNeighbours: 3 });
    expect(r.spikes).toHaveLength(0);
  });

  it('minNeighbours skips low-connectivity vertices', () => {
    const mesh: MeshData = {
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
      triangles: [],
    };
    const r = detectSpikes(mesh, { spikinessThreshold: 1, minNeighbours: 3 });
    expect(r.spikes).toHaveLength(0);
  });

  it('scannedVertexCount reflects qualifying vertices', () => {
    const r = detectSpikes(hexPatch(0));
    expect(r.scannedVertexCount).toBeGreaterThan(0);
  });
});

describe('applySmoothing', () => {
  it('moves spike vertex to neighbour centroid', () => {
    const mesh = hexPatch(10);
    const r = detectSpikes(mesh);
    const spike = r.spikes[0]!;
    const smoothed = applySmoothing(mesh, spike);
    expect(smoothed.vertices[spike.vertexIndex]!.z).toBeCloseTo(0, 5);
  });

  it('does not modify original mesh', () => {
    const mesh = hexPatch(10);
    const r = detectSpikes(mesh);
    applySmoothing(mesh, r.spikes[0]!);
    expect(mesh.vertices[0]!.z).toBe(10);
  });
});

describe('severity', () => {
  it('ratio > 5 → critical', () => {
    expect(severity({ vertexIndex: 0, position: { x: 0, y: 0, z: 0 }, neighbourCentroid: { x: 0, y: 0, z: 0 }, protrusionMm: 0, spikinessRatio: 6, suggestedAction: 'delete' })).toBe('critical');
  });

  it('ratio 3-5 → major', () => {
    expect(severity({ vertexIndex: 0, position: { x: 0, y: 0, z: 0 }, neighbourCentroid: { x: 0, y: 0, z: 0 }, protrusionMm: 0, spikinessRatio: 4, suggestedAction: 'smooth' })).toBe('major');
  });

  it('ratio < 3 → minor', () => {
    expect(severity({ vertexIndex: 0, position: { x: 0, y: 0, z: 0 }, neighbourCentroid: { x: 0, y: 0, z: 0 }, protrusionMm: 0, spikinessRatio: 2.5, suggestedAction: 'smooth' })).toBe('minor');
  });
});

describe('summarize', () => {
  it('reports spike fraction', () => {
    const mesh = hexPatch(10);
    const r = detectSpikes(mesh);
    const s = summarize(mesh, r);
    expect(s.spikeCount).toBe(r.spikes.length);
    expect(s.spikeFraction).toBeGreaterThan(0);
  });

  it('flat mesh → fraction 0', () => {
    const mesh = hexPatch(0);
    const r = detectSpikes(mesh);
    expect(summarize(mesh, r).spikeFraction).toBe(0);
  });
});
