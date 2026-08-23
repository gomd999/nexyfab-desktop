import { describe, expect, it } from 'vitest';
import { applySpatialAiCandidate, createSpatialAiCandidate, guardSpatialAiCandidate } from './spatialAiCandidate';
import type { SpatialDesignBriefHandoffV2 } from './spatialDesignBriefHandoff';
import { saveSpatialDesignCandidateReturnV2, takeSpatialDesignCandidateReturnV2 } from './spatialDesignBriefHandoff';
import { createSpatialCadDocument } from '@/lib/cad/spatialCadCommand';

const handoff = (mode: SpatialDesignBriefHandoffV2['mode'] = 'request_only_edit'): SpatialDesignBriefHandoffV2 => ({
  schema: 'nexyfab.spatial-design-brief-handoff.v2', createdAt: Date.now(), domain: 'building', unit: 'mm',
  parameters: { width: 1000 }, missingAuthority: [], verification: 'NOT_RUN', baseDocumentRevision: 0,
  contentHash: 'a'.repeat(64), documentId: 'building-doc', parameterPaths: ['width'], locks: [], mode,
});

describe('spatialAiCandidate', () => {
  it('fails closed for request-only object or array edits', () => {
    const candidate = createSpatialAiCandidate({ handoff: handoff(), operation: { kind: 'set_parameter', path: 'width', value: { nested: true } }, id: 'c1', summary: 'bad' });
    expect(candidate.canonical.state).toBe('BLOCKED');
    expect(candidate.canonical.issues).toContain('object_or_array_parameter_blocked');
  });

  it('allows only one explicit scalar request parameter', () => {
    const candidate = createSpatialAiCandidate({ handoff: handoff(), operation: { kind: 'set_parameter', path: 'width', value: 1200 }, id: 'c1', summary: 'resize' });
    const document = createSpatialCadDocument('building', { width: 1000 });
    const guarded = guardSpatialAiCandidate({ candidate, currentDocument: document, currentDocumentId: 'building-doc', currentContentHash: 'a'.repeat(64) });
    expect(guarded.allowed).toBe(true);
    const applied = applySpatialAiCandidate({ candidate, document, currentDocumentId: 'building-doc', currentContentHash: 'a'.repeat(64), commandId: 'cmd-1' });
    expect(applied.applied).toBe(true);
    expect(applied.document.parameters.width).toBe(1200);
    expect(applied.transaction?.document.revision).toBe(1);
  });

  it('requires replace_parameters for a new design and protects stale hash', () => {
    const candidate = createSpatialAiCandidate({ handoff: handoff('new_design'), operation: { kind: 'replace_parameters', parameters: { width: 1500 } }, id: 'c2', summary: 'new' });
    const document = createSpatialCadDocument('building', { width: 1000 });
    expect(guardSpatialAiCandidate({ candidate, currentDocument: document, currentDocumentId: 'building-doc', currentContentHash: 'b'.repeat(64) }).issues).toContain('stale_spatial_document_hash');
    expect(applySpatialAiCandidate({ candidate, document, currentDocumentId: 'building-doc', currentContentHash: 'b'.repeat(64), commandId: 'cmd-2' }).document.parameters.width).toBe(1000);
  });

  it('rechecks document identity and explicit scope immediately before apply', () => {
    const candidate = createSpatialAiCandidate({ handoff: handoff(), operation: { kind: 'set_parameter', path: 'width', value: 1200 }, id: 'c3', summary: 'resize' });
    const document = createSpatialCadDocument('building', { width: 1000 });
    expect(guardSpatialAiCandidate({ candidate, currentDocument: document, currentDocumentId: 'other-doc', currentContentHash: 'a'.repeat(64) }).issues).toContain('spatial_candidate_document_mismatch');
    candidate.operation = { kind: 'set_parameter', path: 'unlocked', value: 1 };
    expect(applySpatialAiCandidate({ candidate, document, currentDocumentId: 'building-doc', currentContentHash: 'a'.repeat(64), commandId: 'cmd-3' }).applied).toBe(false);
    expect(document.parameters.width).toBe(1000);
  });

  it('rejects a same-scope operation changed after review', () => {
    const candidate = createSpatialAiCandidate({ handoff: handoff(), operation: { kind: 'set_parameter', path: 'width', value: 1200 }, id: 'c4', summary: 'resize' });
    const document = createSpatialCadDocument('building', { width: 1000 });
    candidate.operation = { kind: 'set_parameter', path: 'width', value: 1400 };
    expect(applySpatialAiCandidate({ candidate, document, currentDocumentId: 'building-doc', currentContentHash: 'a'.repeat(64), commandId: 'cmd-4' })).toMatchObject({
      applied: false,
      document,
      issues: expect.arrayContaining(['spatial_candidate_changed_after_review', 'spatial_candidate_canonical_binding_mismatch']),
    });
  });

  it('rechecks current locks rather than relying on the handoff lock snapshot', () => {
    const candidate = createSpatialAiCandidate({ handoff: handoff(), operation: { kind: 'set_parameter', path: 'width', value: 1200 }, id: 'c5', summary: 'resize' });
    const document = createSpatialCadDocument('building', { width: 1000 });
    const guarded = guardSpatialAiCandidate({
      candidate,
      currentDocument: document,
      currentDocumentId: 'building-doc',
      currentContentHash: 'a'.repeat(64),
      currentLocks: [{ id: 'live-width-lock', target: { kind: 'parameter', objectId: 'building-doc', field: 'width' } }],
    });
    expect(guarded.allowed).toBe(false);
    expect(guarded.issues).toContain('protected_user_or_authority_value');
    expect(guarded.blockedLockIds).toContain('live-width-lock');
  });

  it('round-trips a reviewed candidate once and rejects tampering', () => {
    const proposal = createSpatialAiCandidate({ handoff: handoff(), operation: { kind: 'set_parameter', path: 'width', value: 1200 }, id: 'c6', summary: 'resize' });
    saveSpatialDesignCandidateReturnV2(sessionStorage, { handoff: handoff(), candidate: proposal });
    expect(takeSpatialDesignCandidateReturnV2(sessionStorage, 'building')?.candidate.id).toBe('c6');
    expect(takeSpatialDesignCandidateReturnV2(sessionStorage, 'building')).toBeNull();
    saveSpatialDesignCandidateReturnV2(sessionStorage, { handoff: handoff(), candidate: proposal });
    const tampered = JSON.parse(sessionStorage.getItem('nexyfab:spatial-design-candidate-return:v2')!) as { candidate: { operation: { path: string } } };
    tampered.candidate.operation.path = 'outside';
    sessionStorage.setItem('nexyfab:spatial-design-candidate-return:v2', JSON.stringify(tampered));
    expect(takeSpatialDesignCandidateReturnV2(sessionStorage, 'building')).toBeNull();
  });

  it('accepts workspace unit-labelled keys and rejects prototype keys', () => {
    const labelled = { ...handoff(), parameters: { 'building width (mm)': 1000 }, parameterPaths: ['building width (mm)'] };
    expect(createSpatialAiCandidate({ handoff: labelled, operation: { kind: 'set_parameter', path: 'building width (mm)', value: 1200 }, id: 'labelled', summary: 'resize' }).canonical.state).toBe('PREVIEW');
    const poisoned = { ...handoff(), parameterPaths: ['__proto__'] };
    expect(createSpatialAiCandidate({ handoff: poisoned, operation: { kind: 'set_parameter', path: '__proto__', value: 1200 }, id: 'poisoned', summary: 'bad' }).canonical.state).toBe('BLOCKED');
  });
});
