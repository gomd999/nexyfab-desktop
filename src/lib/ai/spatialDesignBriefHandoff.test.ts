// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SPATIAL_DESIGN_BRIEF_HANDOFF_KEY,
  SPATIAL_DESIGN_BRIEF_HANDOFF_V2_KEY,
  SPATIAL_DESIGN_CANDIDATE_RETURN_V2_KEY,
  formatSpatialDesignBriefPrompt,
  saveSpatialDesignCandidateReturnV2,
  saveSpatialDesignBriefHandoff,
  saveSpatialDesignBriefHandoffV2,
  takeSpatialDesignBriefHandoffAny,
  takeSpatialDesignBriefHandoff,
  takeSpatialDesignCandidateReturnV2,
} from './spatialDesignBriefHandoff';
import { createSpatialAiCandidate } from './spatialAiCandidate';

const draft = {
  domain: 'civil' as const,
  unit: 'm' as const,
  parameters: { epsg: 5186, lengthM: 120, corridorWidthM: 7 },
  missingAuthority: ['approved survey and TIN', 'vertical datum'],
  verification: 'PREVIEW' as const,
};

describe('spatialDesignBriefHandoff', () => {
  beforeEach(() => sessionStorage.clear());

  it('stores and consumes a domain-bound draft once', () => {
    saveSpatialDesignBriefHandoff(sessionStorage, draft);
    expect(takeSpatialDesignBriefHandoff(sessionStorage, 'civil')).toMatchObject(draft);
    expect(takeSpatialDesignBriefHandoff(sessionStorage, 'civil')).toBeNull();
  });

  it('does not consume a valid handoff for the wrong domain', () => {
    saveSpatialDesignBriefHandoff(sessionStorage, draft);
    expect(takeSpatialDesignBriefHandoff(sessionStorage, 'building')).toBeNull();
    expect(takeSpatialDesignBriefHandoff(sessionStorage, 'civil')).not.toBeNull();
  });

  it('rejects expired and non-finite payloads', () => {
    sessionStorage.setItem(SPATIAL_DESIGN_BRIEF_HANDOFF_KEY, JSON.stringify({ schema: 'nexyfab.spatial-design-brief-handoff.v1', createdAt: 0, ...draft }));
    expect(takeSpatialDesignBriefHandoff(sessionStorage, 'civil')).toBeNull();
    expect(() => saveSpatialDesignBriefHandoff(sessionStorage, { ...draft, parameters: { lengthM: Number.NaN } })).toThrow('Invalid spatial design brief handoff');
  });

  it('formats an explicit no-auto-approval prompt', () => {
    saveSpatialDesignBriefHandoff(sessionStorage, draft);
    const value = takeSpatialDesignBriefHandoff(sessionStorage, 'civil');
    expect(value).not.toBeNull();
    const prompt = formatSpatialDesignBriefPrompt(value!, 'en');
    expect(prompt).toContain('workspace drafts, not approved authority data');
    expect(prompt).toContain('epsg: 5186');
    expect(prompt).toContain('approved survey and TIN');
    expect(prompt).toContain('do not apply it to Precision CAD before user confirmation');
  });

  it('reads a revision-bound v2 handoff before the legacy v1 key', () => {
    saveSpatialDesignBriefHandoffV2(sessionStorage, {
      ...draft,
      baseDocumentRevision: 4,
      contentHash: 'a'.repeat(64),
      documentId: 'civil-doc-1',
      parameterPaths: ['lengthM'],
      locks: [{ id: 'lock-length', target: { kind: 'parameter', objectId: 'civil-doc-1', field: 'lengthM' } }],
      mode: 'request_only_edit',
    });
    expect(takeSpatialDesignBriefHandoffAny(sessionStorage, 'civil')).toMatchObject({
      baseDocumentRevision: 4,
      documentId: 'civil-doc-1',
      mode: 'request_only_edit',
    });
    expect(sessionStorage.getItem(SPATIAL_DESIGN_BRIEF_HANDOFF_V2_KEY)).toBeNull();
  });

  it('keeps the legacy v1 handoff readable through the compatible reader', () => {
    saveSpatialDesignBriefHandoff(sessionStorage, draft);
    expect(takeSpatialDesignBriefHandoffAny(sessionStorage, 'civil')).toMatchObject({
      schema: 'nexyfab.spatial-design-brief-handoff.v1',
      domain: 'civil',
      parameters: draft.parameters,
    });
  });

  it('returns a reviewed candidate once and clears paired fallback drafts', () => {
    const handoff = {
      schema: 'nexyfab.spatial-design-brief-handoff.v2' as const,
      createdAt: Date.now(),
      domain: 'building' as const,
      unit: 'mm' as const,
      parameters: { width: 1000 },
      missingAuthority: [],
      verification: 'NOT_RUN' as const,
      baseDocumentRevision: 2,
      contentHash: 'a'.repeat(64),
      documentId: 'building-doc',
      parameterPaths: ['width'],
      locks: [],
      mode: 'request_only_edit' as const,
    };
    const candidate = createSpatialAiCandidate({ handoff, operation: { kind: 'set_parameter', path: 'width', value: 1200 }, id: 'return-1', summary: 'resize' });
    saveSpatialDesignBriefHandoff(sessionStorage, { ...draft, domain: 'building', unit: 'mm' });
    saveSpatialDesignBriefHandoffV2(sessionStorage, handoff);
    saveSpatialDesignCandidateReturnV2(sessionStorage, { handoff, candidate });

    expect(takeSpatialDesignCandidateReturnV2(sessionStorage, 'civil')).toBeNull();
    expect(sessionStorage.getItem(SPATIAL_DESIGN_CANDIDATE_RETURN_V2_KEY)).not.toBeNull();
    expect(takeSpatialDesignCandidateReturnV2(sessionStorage, 'building')).toMatchObject({ candidate: { id: 'return-1' } });
    expect(sessionStorage.getItem(SPATIAL_DESIGN_CANDIDATE_RETURN_V2_KEY)).toBeNull();
    expect(sessionStorage.getItem(SPATIAL_DESIGN_BRIEF_HANDOFF_V2_KEY)).toBeNull();
    expect(sessionStorage.getItem(SPATIAL_DESIGN_BRIEF_HANDOFF_KEY)).toBeNull();
    expect(takeSpatialDesignCandidateReturnV2(sessionStorage, 'building')).toBeNull();
  });
});
