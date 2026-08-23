import { describe, expect, it } from 'vitest';
import type { ArchitectureDocument, InteriorDocument } from './architectureInteriorDocuments';
import { ARCHITECTURE_INTERIOR_SELECTION_SCHEMA, createArchitectureInteriorSelection, resolveArchitectureInteriorSelection, type ArchitectureInteriorSelectionSource } from './architectureInteriorSelection';

const source = (): ArchitectureInteriorSelectionSource => {
  const architecture: ArchitectureDocument = {
    schema: 'nexyfab.architecture.v1', revision: 7,
    storeys: [{ id: 'storey-1', name: 'Ground', elevationMm: 0, heightMm: 3000 }],
    spaces: [{ id: 'space-1', storeyId: 'storey-1', name: 'Room', usage: 'office', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], wallIds: ['wall-1', 'wall-2', 'wall-3', 'wall-4'], slabId: 'slab-1', ceilingId: 'ceiling-1' }],
    walls: [
      { id: 'wall-1', kind: 'line', storeyId: 'storey-1', startMm: [0, 0], endMm: [4000, 0], thicknessMm: 200, heightMm: 3000 },
      { id: 'wall-2', kind: 'line', storeyId: 'storey-1', startMm: [4000, 0], endMm: [4000, 3000], thicknessMm: 200, heightMm: 3000 },
      { id: 'wall-3', kind: 'line', storeyId: 'storey-1', startMm: [4000, 3000], endMm: [0, 3000], thicknessMm: 200, heightMm: 3000 },
      { id: 'wall-4', kind: 'line', storeyId: 'storey-1', startMm: [0, 3000], endMm: [0, 0], thicknessMm: 200, heightMm: 3000 },
    ],
    slabs: [{ id: 'slab-1', storeyId: 'storey-1', spaceId: 'space-1', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], thicknessMm: 180 }],
    ceilings: [{ id: 'ceiling-1', storeyId: 'storey-1', spaceId: 'space-1', boundaryMm: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]], elevationMm: 2700, thicknessMm: 100 }],
    openings: [{ id: 'opening-1', kind: 'door', hostWallId: 'wall-1', offsetMm: 500, widthMm: 900, heightMm: 2100, sillMm: 0, positionMm: [500, 0, 0] }],
  };
  const interior: InteriorDocument = {
    schema: 'nexyfab.interior.v1', revision: 7, architectureDocumentId: 'architecture-1',
    lights: [{ id: 'light-1', spaceId: 'space-1', hostCeilingId: 'ceiling-1', positionMm: [2000, 1500, 2600], suspensionMm: 100, lumens: 3000, cctK: 4000 }],
    furniture: [{ id: 'furniture-1', spaceId: 'space-1', positionMm: [2000, 1500, 0], sizeMm: [1200, 600, 750], clearanceMm: 300, rotationDeg: 0 }],
    finishes: [{ id: 'finish-1', spaceId: 'space-1', hostId: 'slab-1', surface: 'floor', material: 'oak' }],
    millwork: [{ id: 'millwork-1', spaceId: 'space-1', hostWallId: 'wall-2', positionMm: [3900, 800, 0], sizeMm: [100, 1200, 900], material: 'plywood', clearanceMm: 100 }],
    ceilingSystems: [{ id: 'ceiling-system-1', spaceId: 'space-1', hostCeilingId: 'ceiling-1', kind: 'grid', elevationMm: 2600, moduleMm: [600, 600] }],
  };
  return { projectId: 'project-1', architectureDocumentId: 'architecture-1', interiorDocumentId: 'interior-1', architecture, interior };
};

describe('architecture/interior stable selection and Inspector contract', () => {
  it('does not expose a space polygon as a scalar vector field', () => {
    const current = source();
    const selected = createArchitectureInteriorSelection(current, 'space', 'space-1', 'architecture');
    expect(selected.ok).toBe(true);
    if (selected.ok) expect(selected.value.editableFields.map(item => item.key)).toEqual(['name', 'usage']);
  });

  it('resolves every Wave 2 object kind with stable identity and owning hosts', () => {
    const current = source();
    const cases = [
      ['storey', 'storey-1', 'architecture'], ['space', 'space-1', 'architecture'], ['wall', 'wall-1', 'architecture'], ['opening', 'opening-1', 'architecture'], ['ceiling', 'ceiling-1', 'architecture'],
      ['furniture', 'furniture-1', 'interior'], ['finish', 'finish-1', 'interior'], ['millwork', 'millwork-1', 'interior'], ['light', 'light-1', 'interior'], ['ceiling', 'ceiling-system-1', 'interior'],
    ] as const;
    for (const [kind, objectId, document] of cases) {
      const result = createArchitectureInteriorSelection(current, kind, objectId, document);
      expect(result.ok, `${document}:${kind}:${objectId}`).toBe(true);
      if (!result.ok) continue;
      expect(result.value.selection.selectionKey).toBe(`${document}:${kind}:${objectId}`);
      expect(result.value.selection.revision).toBe(7);
      expect(result.value.hostIds.length).toBeGreaterThanOrEqual(kind === 'storey' ? 0 : 1);
      expect(result.value.editableFields.length).toBeGreaterThan(0);
    }
  });

  it('does not expose identity or host bindings as editable fields', () => {
    const current = source();
    for (const [kind, objectId, document] of [['wall', 'wall-1', 'architecture'], ['furniture', 'furniture-1', 'interior'], ['finish', 'finish-1', 'interior'], ['light', 'light-1', 'interior'], ['millwork', 'millwork-1', 'interior']] as const) {
      const result = createArchitectureInteriorSelection(current, kind, objectId, document);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const keys = result.value.editableFields.map(item => item.key);
      expect(keys).not.toContain('id');
      expect(keys).not.toContain('spaceId');
      expect(keys).not.toContain('storeyId');
      expect(keys).not.toContain('hostWallId');
      expect(keys).not.toContain('hostCeilingId');
    }
  });

  it('survives JSON reload and fails closed for stale, missing, or mismatched context', () => {
    const current = source();
    const created = createArchitectureInteriorSelection(current, 'opening', 'opening-1', 'architecture');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const reloaded = JSON.parse(JSON.stringify(created.value.selection)) as unknown;
    expect(resolveArchitectureInteriorSelection(reloaded, source())).toMatchObject({ ok: true });

    const newer = source(); newer.architecture.revision = 8; newer.interior.revision = 8;
    expect(resolveArchitectureInteriorSelection(reloaded, newer)).toEqual({ ok: false, code: 'STALE_REVISION' });
    const missing = source(); missing.architecture.openings = [];
    expect(resolveArchitectureInteriorSelection(reloaded, missing)).toEqual({ ok: false, code: 'MISSING_OBJECT' });
    const wrongProject = source(); wrongProject.projectId = 'other-project';
    expect(resolveArchitectureInteriorSelection(reloaded, wrongProject)).toEqual({ ok: false, code: 'PROJECT_MISMATCH' });
  });

  it('rejects a selection whose host relation is missing or inconsistent', () => {
    const invalid = source(); invalid.architecture.spaces[0]!.ceilingId = 'missing-ceiling';
    expect(createArchitectureInteriorSelection(invalid, 'space', 'space-1', 'architecture')).toEqual({ ok: false, code: 'INVALID_HOST' });
    const badFinish = source(); badFinish.interior.finishes[0]!.hostId = 'wall-3'; badFinish.interior.finishes[0]!.surface = 'floor';
    expect(createArchitectureInteriorSelection(badFinish, 'finish', 'finish-1', 'interior')).toEqual({ ok: false, code: 'INVALID_HOST' });
  });

  it('fails closed for a mismatched interior architecture binding and unknown runtime tags', () => {
    const mismatched = source(); mismatched.interior.architectureDocumentId = 'other-architecture';
    expect(createArchitectureInteriorSelection(mismatched, 'furniture', 'furniture-1', 'interior')).toEqual({ ok: false, code: 'INVALID_SELECTION' });

    const created = createArchitectureInteriorSelection(source(), 'wall', 'wall-1', 'architecture');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const unknownKind = { ...created.value.selection, kind: 'future-object' };
    const unknownDocument = { ...created.value.selection, document: 'future-document' };
    expect(resolveArchitectureInteriorSelection(unknownKind, source())).toEqual({ ok: false, code: 'INVALID_SELECTION' });
    expect(resolveArchitectureInteriorSelection(unknownDocument, source())).toEqual({ ok: false, code: 'INVALID_SELECTION' });
  });

  it('fails closed instead of throwing when reconnect source data is malformed', () => {
    const malformed = { ...source(), architecture: { ...source().architecture, walls: undefined } } as unknown as ArchitectureInteriorSelectionSource;
    expect(createArchitectureInteriorSelection(malformed, 'wall', 'wall-1', 'architecture')).toEqual({ ok: false, code: 'INVALID_SELECTION' });
    expect(resolveArchitectureInteriorSelection({ schema: ARCHITECTURE_INTERIOR_SELECTION_SCHEMA, projectId: 'project-1' }, malformed)).toEqual({ ok: false, code: 'INVALID_SELECTION' });
  });
});
