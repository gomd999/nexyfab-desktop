// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { saveSpatialCadDraftHandoff, spatialCadContentHash } from './spatialDesignBriefBuilder';
import { SPATIAL_DESIGN_BRIEF_HANDOFF_V2_KEY } from './spatialDesignBriefHandoff';

describe('spatialDesignBriefBuilder selection scope', () => {
  beforeEach(() => sessionStorage.clear());

  it('fails closed for request-only handoff without a selected parameter', async () => {
    const result = await saveSpatialCadDraftHandoff({ domain: 'building', unit: 'mm', verification: 'NOT_RUN', parameters: { width: 1000 }, missingAuthority: [], baseDocumentRevision: 0, documentId: 'building-doc' });
    expect(result).toBeNull();
    expect(sessionStorage.getItem(SPATIAL_DESIGN_BRIEF_HANDOFF_V2_KEY)).toBeNull();
  });

  it('writes exactly the selected parameter path', async () => {
    const result = await saveSpatialCadDraftHandoff({ domain: 'building', unit: 'mm', verification: 'NOT_RUN', parameters: { width: 1000, depth: 800 }, missingAuthority: [], baseDocumentRevision: 0, documentId: 'building-doc', selectedParameterPath: 'width' });
    expect(result?.parameterPaths).toEqual(['width']);
  });

  it('allows an explicit new design without an edit selection', async () => {
    const result = await saveSpatialCadDraftHandoff({ domain: 'building', unit: 'mm', verification: 'NOT_RUN', parameters: { width: 1000, depth: 800 }, missingAuthority: [], baseDocumentRevision: 0, documentId: 'building-doc', mode: 'new_design' });
    expect(result).toMatchObject({ mode: 'new_design', parameterPaths: ['depth', 'width'] });
  });

  it('hashes canonical CAD content independently of key order and actor provenance', async () => {
    const first = { schema: 'nexyfab.spatial-cad-document.v1' as const, domain: 'interior' as const, revision: 2, parameters: { width: 8000, depth: 6000 }, verification: 'NOT_RUN' as const, updatedBy: 'human' as const };
    const second = { ...first, parameters: { depth: 6000, width: 8000 }, updatedBy: 'ai' as const };
    await expect(spatialCadContentHash(first)).resolves.toBe(await spatialCadContentHash(second));
  });
});
