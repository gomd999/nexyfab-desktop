import { describe, expect, it } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { buildAssembly } from './assembly.mjs';
import { ensureReplicad, intentToStep } from './to-step.mjs';

describe('machine line STEP roundtrip regression', () => {
  it('never emits non-finite safety-fence coordinates and reimports the exact assembly', async () => {
    const assembly = buildAssemblyTemplate('mech', 'machine_line', {
      stations: 3.2,
      stationPitch: 1200,
      conveyorW: 400,
      frameH: 720,
      guard: 'yes',
    });
    for (const part of assembly.parts) {
      expect([part.at?.tx, part.at?.ty, part.at?.tz].every(Number.isFinite)).toBe(true);
    }

    const built = buildAssembly(assembly);
    expect(built.ok).toBe(true);
    const exported = await intentToStep(built.composeIntent);
    expect(exported.fuseReport.dropped).toEqual([]);
    expect(exported.step).not.toMatch(/\b(?:NAN|INF)\b/i);

    const replicad = await ensureReplicad();
    const shape = await replicad.importSTEP(new Blob([exported.step]));
    const mesh = shape.mesh({ tolerance: 0.5, angularTolerance: 15 });
    expect(mesh.vertices.length).toBeGreaterThan(0);
    expect(mesh.triangles.length).toBeGreaterThan(0);
    expect([...mesh.vertices].every(Number.isFinite)).toBe(true);
  }, 60_000);
});
