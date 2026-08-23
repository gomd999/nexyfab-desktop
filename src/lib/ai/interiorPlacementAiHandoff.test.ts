import { describe, expect, it } from 'vitest';
import { createInteriorPlacementDocument } from '@/lib/cad/interiorPlacementDocument';
import { createInteriorPlacementAiCandidate, isInteriorPlacementAiCandidate } from './interiorPlacementAiCandidate';
import { INTERIOR_PLACEMENT_AI_HANDOFF_KEY, INTERIOR_PLACEMENT_AI_HANDOFF_SCHEMA, saveInteriorPlacementAiHandoff, takeInteriorPlacementAiHandoff, validateInteriorPlacementAiHandoff, type InteriorPlacementAiHandoff } from './interiorPlacementAiHandoff';

function storage(): Storage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); }, clear: () => values.clear(), key: index => [...values.keys()][index] ?? null, get length() { return values.size; } };
}

const hash = 'a'.repeat(64);
const handoff = { projectId: 'project-1', placementDocumentId: 'placement-1', roomDocumentId: 'room-1', docRevision: 2, projectRevision: 4, contentHash: hash, selectedObjectId: 'object-1', parameterPaths: ['pose.positionMm'] as const, currentLocks: [{ id: 'lock-1', target: { kind: 'occurrence', objectId: 'object-1' } }] };
const validHandoff = { schema: INTERIOR_PLACEMENT_AI_HANDOFF_SCHEMA, createdAt: Date.now(), ...handoff } satisfies InteriorPlacementAiHandoff;

describe('interior placement AI sidecar', () => {
  it('is one-shot, TTL-bound, and isolated from scalar handoff keys', () => {
    const store = storage();
    saveInteriorPlacementAiHandoff(store, handoff);
    expect(store.getItem(INTERIOR_PLACEMENT_AI_HANDOFF_KEY)).toContain('placement-1');
    expect(takeInteriorPlacementAiHandoff(store)).toMatchObject({ projectId: 'project-1', selectedObjectId: 'object-1' });
    expect(takeInteriorPlacementAiHandoff(store)).toBeNull();
    saveInteriorPlacementAiHandoff(store, handoff);
    const raw = JSON.parse(store.getItem(INTERIOR_PLACEMENT_AI_HANDOFF_KEY)!); raw.createdAt = Date.now() - 16 * 60 * 1000; store.setItem(INTERIOR_PLACEMENT_AI_HANDOFF_KEY, JSON.stringify(raw));
    expect(takeInteriorPlacementAiHandoff(store)).toBeNull();
  });

  it('fails closed when selection, project, or hash is absent', () => {
    expect(validateInteriorPlacementAiHandoff({ ...handoff, selectedObjectId: '' })).toContain('placement_selection_required');
    expect(validateInteriorPlacementAiHandoff({ ...handoff, projectId: '' })).toContain('placement_ai_auth_required');
    expect(validateInteriorPlacementAiHandoff({ ...handoff, contentHash: 'bad' })).toContain('missing_placement_content_hash');
  });

  it('creates an exact selected-object patch and rejects immutable identity changes', () => {
    const document = createInteriorPlacementDocument({ documentId: 'placement-1', roomDocumentId: 'room-1', roomSizeMm: [10_000, 8_000, 3_000], objects: [{ id: 'object-1', catalogType: 'table4', spaceId: 'room-1', pose: { positionMm: [0, 0, 0], rotationDeg: [0, 0, 0] }, dimensionsMm: [1000, 600, 750], clearanceMm: [50, 50, 0] }] });
    const candidate = createInteriorPlacementAiCandidate({ handoff: validHandoff, currentObject: document.objects[0], proposedObject: { ...document.objects[0], pose: { ...document.objects[0].pose, positionMm: [100, 0, 0] } } });
    expect(isInteriorPlacementAiCandidate(candidate)).toBe(true);
    expect(candidate.parameterPaths).toEqual(['pose.positionMm']);
    expect(isInteriorPlacementAiCandidate({ ...candidate, selectedObjectId: 'other' })).toBe(false);
    expect(() => createInteriorPlacementAiCandidate({ handoff: validHandoff, currentObject: document.objects[0], proposedObject: { ...document.objects[0], catalogType: 'sofa' as never } })).toThrow('immutable_object_identity_changed');
  });
});
