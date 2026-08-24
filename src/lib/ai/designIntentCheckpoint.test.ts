import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createDesignIntentCheckpoint,
  getNextDesignIntentQuestions,
  mergeDesignIntentCheckpoints,
  type DesignIntentSource,
  validateDesignIntentCheckpoint,
} from './designIntentCheckpoint';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const policy = { rights: 'user_owned' as const, aiUseAllowed: true, derivativeUseAllowed: true };

function source(id: string, kind: 'text' | 'image' | 'sketch' | 'drawing_2d' | 'selection_3d', fields: any[], authority: 'user_confirmed' | 'imported_authority' | 'ai_assumption' = 'user_confirmed'): DesignIntentSource {
  return { id, kind, projectId: 'project-1', revision: 4, sourceHash: hash(id), authority, provenance: policy, fields };
}

describe('DesignIntentCheckpointV1', () => {
  it('normalizes all five intake kinds and keeps authority buckets separate', () => {
    const checkpoint = createDesignIntentCheckpoint({
      checkpointId: 'checkpoint-1', projectId: 'project-1', revision: 4, projectContentHash: hash('project-4'),
      sources: [
        source('text-1', 'text', [{ key: 'purpose', value: 'mounting bracket' }]),
        source('image-1', 'image', [{ key: 'material', value: 'steel' }], 'imported_authority'),
        source('sketch-1', 'sketch', [{ key: 'datum', value: 'origin' }]),
        source('drawing-1', 'drawing_2d', [{ key: 'overall', category: 'dimension', value: { value: 120, unit: 'mm' } }]),
        source('selection-1', 'selection_3d', [{ key: 'selectedFace', value: 'face-2' }], 'ai_assumption'),
      ],
    });
    expect(checkpoint.userConfirmedFacts.map(item => item.key)).toEqual(['purpose', 'datum', 'overall']);
    expect(checkpoint.importedAuthority.map(item => item.key)).toEqual(['material']);
    expect(checkpoint.aiAssumptions.map(item => item.key)).toEqual(['selectedFace']);
    expect(checkpoint.dimensions).toEqual([{ key: 'overall', value: 120, unit: 'mm', sourceIds: ['drawing-1'], authoritative: true }]);
    expect(validateDesignIntentCheckpoint(checkpoint)).toEqual([]);
  });

  it('does not choose between conflicting values and exposes a question', () => {
    const checkpoint = createDesignIntentCheckpoint({
      checkpointId: 'checkpoint-2', projectId: 'project-1', revision: 4, projectContentHash: hash('project-4'),
      sources: [source('a', 'text', [{ key: 'material', value: 'steel' }]), source('b', 'drawing_2d', [{ key: 'material', value: 'aluminium' }])],
    });
    expect(checkpoint.conflicts[0]?.key).toBe('material');
    expect(checkpoint.readiness.ready).toBe(false);
    expect(getNextDesignIntentQuestions(checkpoint).some(item => item.key === 'material')).toBe(true);
  });

  it('requires explicit permission for unknown or restricted sources', () => {
    const restricted = source('reference', 'image', [{ key: 'shape', value: 'reference' }], 'imported_authority');
    restricted.provenance = { rights: 'unknown', aiUseAllowed: false, derivativeUseAllowed: false };
    const checkpoint = createDesignIntentCheckpoint({ checkpointId: 'checkpoint-3', projectId: 'project-1', revision: 4, projectContentHash: hash('project-4'), sources: [restricted] });
    expect(checkpoint.copyrightPolicy.usable).toBe(false);
    expect(checkpoint.missingFields.some(item => item.reason === 'provenance_blocked')).toBe(true);
    expect(checkpoint.readiness.ready).toBe(false);
  });

  it('merges independent inputs without dropping authority or silently accepting stale bindings', () => {
    const common = { projectId: 'project-1', revision: 4, projectContentHash: hash('project-4') };
    const left = createDesignIntentCheckpoint({ checkpointId: 'left', ...common, sources: [source('text', 'text', [{ key: 'purpose', value: 'bracket' }])] });
    const right = createDesignIntentCheckpoint({ checkpointId: 'right', ...common, sources: [source('drawing', 'drawing_2d', [{ key: 'overall', category: 'dimension', value: { value: 120, unit: 'mm' } }])] });
    const merged = mergeDesignIntentCheckpoints(left, right);
    expect(merged.userConfirmedFacts.map(item => item.key)).toEqual(['purpose', 'overall']);
    expect(merged.sources.map(item => item.id)).toEqual(['text', 'drawing']);
    expect(merged.readiness.ready).toBe(true);
    expect(validateDesignIntentCheckpoint(merged)).toEqual([]);

    const stale = createDesignIntentCheckpoint({ checkpointId: 'stale', projectId: 'project-1', revision: 5, projectContentHash: hash('project-5'), sources: [source('new', 'selection_3d', [{ key: 'face', value: 'face-1' }])] });
    const guarded = mergeDesignIntentCheckpoints(left, stale);
    expect(guarded.conflicts.some(item => item.reason === 'project_binding_mismatch')).toBe(true);
    expect(guarded.readiness.ready).toBe(false);
  });

  it('fails closed when serialized derived state or binding is tampered with', () => {
    const checkpoint = createDesignIntentCheckpoint({ checkpointId: 'checkpoint-4', projectId: 'project-1', revision: 4, projectContentHash: hash('project-4'), sources: [source('text', 'text', [{ key: 'purpose', value: 'bracket' }])] });
    const tampered = structuredClone(checkpoint);
    tampered.readiness.ready = false;
    expect(validateDesignIntentCheckpoint(tampered)).toContain('readiness_not_fail_closed');
    const wrongHash = structuredClone(checkpoint);
    wrongHash.sources[0]!.sourceHash = hash('different');
    expect(validateDesignIntentCheckpoint(wrongHash)).toContain('derived_values_not_recomputed');
  });

  it('returns issues instead of throwing for malformed untrusted payloads', () => {
    expect(validateDesignIntentCheckpoint({
      schema: 'nexyfab.design-intent-checkpoint.v1', checkpointId: 'x', projectId: 'project-1', revision: 0,
      projectContentHash: hash('project'), sources: [{ id: 'bad', projectId: 'project-1', revision: 0, sourceHash: hash('x') }],
    })).toContain('source_invalid:bad');
  });
});
