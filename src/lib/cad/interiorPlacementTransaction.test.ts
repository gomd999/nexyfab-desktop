import { describe, expect, it } from 'vitest';
import { createInteriorPlacementDocument, placementObjectsFromFurniture, validateInteriorPlacementDocument, type InteriorPlacementObject } from './interiorPlacementDocument';
import { commitInteriorPlacementOperation, hashInteriorPlacementDocument, previewInteriorPlacementMove, redoInteriorPlacement, undoInteriorPlacement, type InteriorPlacementHistory } from './interiorPlacementTransaction';

const object = (id: string, x = 0): InteriorPlacementObject => ({ id, catalogType: 'table4', spaceId: 'room-1', pose: { positionMm: [x, 0, 0], rotationDeg: [0, 0, 0] }, dimensionsMm: [1000, 600, 750], clearanceMm: [50, 50, 0] });
const base = () => createInteriorPlacementDocument({ documentId: 'placement-1', roomDocumentId: 'room-1', roomSizeMm: [10_000, 8_000, 3_000], objects: [object('table-1')] });

describe('interior placement pure transaction', () => {
  it('commits add, move, delete and reset as one revision each', () => {
    let document = base(); let history: InteriorPlacementHistory = { past: [], future: [] };
    for (const operation of [
      { kind: 'add_object', object: object('table-2', 1000) } as const,
      { kind: 'move_object', objectId: 'table-2', positionMm: [1500, 0, 0] as const } as const,
      { kind: 'delete_object', objectId: 'table-2' } as const,
      { kind: 'reset_layout', objects: [object('table-3', -1000)] } as const,
    ]) {
      const result = commitInteriorPlacementOperation(document, operation, history);
      expect(result.committed).toBe(true);
      if (!result.committed) return;
      document = result.document; history = result.history;
    }
    expect(document.revision).toBe(4);
    expect(document.objects.map(item => item.id)).toEqual(['table-3']);
  });

  it('commits human update_object dimensions and clearance once, while AI remains patch-only', () => {
    const document = base();
    const updated = commitInteriorPlacementOperation(document, { kind: 'update_object', objectId: 'table-1', changes: { dimensionsMm: [1200, 700, 750], clearanceMm: [100, 100, 0] } });
    expect(updated).toMatchObject({ committed: true, document: { revision: 1 } });
    if (updated.committed) expect(updated.document.objects[0]).toMatchObject({ dimensionsMm: [1200, 700, 750], clearanceMm: [100, 100, 0] });
    expect(commitInteriorPlacementOperation(document, { kind: 'update_object', objectId: 'table-1', changes: { dimensionsMm: [1200, 700, 750] } }, undefined, { baseRevision: 0, baseContentHash: hashInteriorPlacementDocument(document), currentContentHash: hashInteriorPlacementDocument(document), locks: [] })).toMatchObject({ committed: false, issues: ['human_update_scope_only'] });
  });

  it('fails with original identity for duplicate, bounds and max-object violations', () => {
    const duplicate = base();
    const duplicateResult = commitInteriorPlacementOperation(duplicate, { kind: 'add_object', object: object('table-1') });
    expect(duplicateResult.committed).toBe(false); expect(duplicateResult.document).toBe(duplicate);
    const outside = commitInteriorPlacementOperation(duplicate, { kind: 'add_object', object: object('outside', 4999) });
    expect(outside.committed).toBe(false); expect(outside.document).toBe(duplicate);
    const full = createInteriorPlacementDocument({ documentId: 'placement-full', roomDocumentId: 'room-1', roomSizeMm: [100_000, 100_000, 3_000], objects: Array.from({ length: 40 }, (_, index) => object(`o-${index}`, index * 1000)) });
    const tooMany = commitInteriorPlacementOperation(full, { kind: 'add_object', object: object('o-40', 41_000) });
    expect(tooMany.committed).toBe(false); expect(tooMany.document).toBe(full);
  });

  it('keeps drag preview at the same revision and commits pointer-up once', () => {
    const document = base();
    const preview = previewInteriorPlacementMove(document, 'table-1', [1000, 500, 0]);
    expect(preview.revision).toBe(0); expect(preview.objects[0].pose.positionMm).toEqual([1000, 500, 0]);
    const committed = commitInteriorPlacementOperation(document, { kind: 'move_object', objectId: 'table-1', positionMm: [1000, 500, 0] });
    expect(committed).toMatchObject({ committed: true, document: { revision: 1 } });
  });

  it('undoes and redoes complete snapshots including IDs and poses', () => {
    const first = base(); const result = commitInteriorPlacementOperation(first, { kind: 'add_object', object: object('table-2', 1000) });
    if (!result.committed) throw new Error('expected commit');
    const undone = undoInteriorPlacement(result.document, result.history);
    expect(undone.document.objects.map(item => item.id)).toEqual(['table-1']);
    expect(undone.document.revision).toBe(2);
    const redone = redoInteriorPlacement(undone.document, undone.history);
    expect(redone.document.objects.find(item => item.id === 'table-2')?.pose.positionMm).toEqual([1000, 0, 0]);
    expect(redone.document.revision).toBe(3);
  });

  it('fails AI patch closed for stale hash, wrong selection, scope and lock', () => {
    const document = base(); const guards = { baseRevision: 0, baseContentHash: hashInteriorPlacementDocument(document), currentContentHash: hashInteriorPlacementDocument(document), selectedObjectId: 'table-1', parameterPaths: ['pose.positionMm'], locks: [] };
    const operation = { kind: 'patch_selected_object', objectId: 'table-1', changes: { pose: { positionMm: [200, 0, 0] as const, rotationDeg: [0, 0, 0] as const } } } as const;
    expect(commitInteriorPlacementOperation(document, operation, undefined, { ...guards, currentContentHash: 'f'.repeat(64) })).toMatchObject({ committed: false, issues: ['stale_revision_or_hash'] });
    expect(commitInteriorPlacementOperation(document, operation, undefined, { ...guards, selectedObjectId: 'table-2' })).toMatchObject({ committed: false, issues: ['selected_object_scope_required'] });
    expect(commitInteriorPlacementOperation(document, operation, undefined, { ...guards, parameterPaths: ['catalogType'] })).toMatchObject({ committed: false, issues: ['invalid_parameter_scope'] });
    expect(commitInteriorPlacementOperation(document, operation, undefined, { ...guards, locks: [{ id: 'l1', target: { kind: 'parameter', objectId: 'table-1', field: 'pose' } }] })).toMatchObject({ committed: false, issues: ['protected_object'] });
  });

  it('uses rotated three-dimensional extents for room bounds', () => {
    const rotated = { ...object('wide'), pose: { positionMm: [0, 0, 0] as const, rotationDeg: [0, 0, 90] as const }, dimensionsMm: [3000, 1000, 750] as const, clearanceMm: [0, 0, 0] as const };
    expect(() => createInteriorPlacementDocument({ documentId: 'rotated', roomDocumentId: 'room-1', roomSizeMm: [2000, 4000, 3000], objects: [rotated] })).not.toThrow();
    expect(() => createInteriorPlacementDocument({ documentId: 'unrotated', roomDocumentId: 'room-1', roomSizeMm: [2000, 4000, 3000], objects: [{ ...rotated, pose: { ...rotated.pose, rotationDeg: [0, 0, 0] } }] })).toThrow('invalid_interior_placement_document');
  });

  it('fails malformed arrays and no-op mutations closed without changing identity or history', () => {
    expect(() => validateInteriorPlacementDocument({ schema: 'nexyfab.interior-placement-document.v1', documentId: 'p', roomDocumentId: 'r', revision: 0, units: 'mm', roomSizeMm: [1, 1, 1], objects: {} })).not.toThrow();
    expect(validateInteriorPlacementDocument({ schema: 'nexyfab.interior-placement-document.v1', documentId: 'p', roomDocumentId: 'r', revision: 0, units: 'mm', roomSizeMm: [1, 1, 1], objects: {} })).toContain('invalid_objects');
    const document = base(); const history: InteriorPlacementHistory = { past: [], future: [] };
    const result = commitInteriorPlacementOperation(document, { kind: 'move_object', objectId: 'table-1', positionMm: [0, 0, 0] }, history);
    expect(result).toMatchObject({ committed: false, issues: ['no_effect'], document: { revision: 0 }, history: { past: [], future: [] } });
    expect(result.document).toBe(document);
  });

  it('requires live AI guards, exact changed fields and matching leaf locks', () => {
    const document = base(); const hash = hashInteriorPlacementDocument(document);
    const operation = { kind: 'patch_selected_object', objectId: 'table-1', changes: { pose: { positionMm: [200, 0, 0] as const, rotationDeg: [0, 0, 90] as const } } } as const;
    expect(commitInteriorPlacementOperation(document, operation)).toMatchObject({ committed: false, issues: ['ai_guards_required'] });
    const guards = { baseRevision: 0, baseContentHash: hash, currentContentHash: hash, selectedObjectId: 'table-1', parameterPaths: ['pose.positionMm'], locks: [] };
    expect(commitInteriorPlacementOperation(document, operation, undefined, guards)).toMatchObject({ committed: false, issues: ['invalid_parameter_scope'] });
    expect(commitInteriorPlacementOperation(document, { ...operation, changes: { pose: { ...operation.changes.pose, rotationDeg: [0, 0, 0] } } }, undefined, { ...guards, locks: [{ id: 'leaf', target: { kind: 'parameter', objectId: 'table-1', field: 'pose.positionMm' } }] })).toMatchObject({ committed: false, issues: ['protected_object'] });
  });

  it('keeps hashes canonical and requires caller-provided stable adapter IDs', () => {
    const document = base();
    const reordered = { objects: structuredClone(document.objects), units: document.units, revision: document.revision, roomSizeMm: document.roomSizeMm, roomDocumentId: document.roomDocumentId, documentId: document.documentId, schema: document.schema };
    expect(hashInteriorPlacementDocument(reordered)).toBe(hashInteriorPlacementDocument(document));
    expect(placementObjectsFromFurniture([{ kind: 'sofa', x: 1, y: 2 }], ['stable-sofa-id'], 'room-1', [10_000, 8_000, 3_000])[0]?.id).toBe('stable-sofa-id');
    expect(() => placementObjectsFromFurniture([{ kind: 'sofa', x: 1, y: 2 }], [], 'room-1', [10_000, 8_000, 3_000])).toThrow('stable_placement_object_ids_required');
  });
});
