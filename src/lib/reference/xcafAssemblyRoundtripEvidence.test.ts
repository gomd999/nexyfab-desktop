import { beforeAll, describe, expect, it } from 'vitest';
import { verifyXcafAssemblyRoundtrip } from './xcafAssemblyRoundtripEvidence';

import { ensureReplicad, exportOccurrenceAssemblySTEP } from '../../../scripts/drawing-to-3d/to-step.mjs';

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
const T = (x: number, y: number, z: number) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1] as const;

let fixture: Awaited<ReturnType<typeof buildFixture>>;

async function buildFixture() {
  const rc = await ensureReplicad();
  const definitions = [
    { id: 'plate', name: 'PLATE', color: '#3366cc', shape: rc.makeBaseBox(40, 20, 4) },
    { id: 'bolt', name: 'BOLT', color: '#cc6633', shape: rc.makeCylinder(3, 12) },
  ];
  const occurrences = [
    { id: 'plate-1', definitionId: 'plate', matrix: I },
    { id: 'bolt-1', definitionId: 'bolt', matrix: T(8, 5, 4) },
    { id: 'bolt-2', definitionId: 'bolt', matrix: T(32, 5, 4) },
  ];
  const exported = await exportOccurrenceAssemblySTEP(definitions, occurrences, { unit: 'MM', name: 'FIXTURE' });
  return { definitions, occurrences, exported };
}

beforeAll(async () => { fixture = await buildFixture(); }, 60_000);

describe('XCAF assembly evidence is separate from shape round-trip', () => {
  it('preserves AP242 occurrences, reused definition, placements, names, colours and mm units', () => {
    const evidence = verifyXcafAssemblyRoundtrip({
      step: fixture.exported.step,
      definitions: fixture.definitions,
      occurrences: fixture.occurrences,
      unit: 'mm',
    });
    expect(evidence.status).toBe('pass');
    expect(evidence.placementEvidence.sourceOccurrenceCount).toBe(3);
    expect(evidence.structureEvidence.repeatedDefinitions).toBe(1);
  });

  it('fails closed when an expected occurrence transform differs', () => {
    const changed = fixture.occurrences.map((item, index) => index === 2 ? { ...item, matrix: T(31, 5, 4) } : item);
    const evidence = verifyXcafAssemblyRoundtrip({
      step: fixture.exported.step,
      definitions: fixture.definitions,
      occurrences: changed,
    });
    expect(evidence.status).toBe('fail');
    expect(evidence.checks.find(item => item.id === 'occurrence-transforms')?.pass).toBe(false);
  });
});
