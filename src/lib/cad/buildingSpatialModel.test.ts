import { describe, expect, it } from 'vitest';
import { validateArchitectureDocument } from '@/lib/ai/architectureInteriorDocuments';
import { verifyArchitectureTopology } from '@/lib/ai/architectureTopologyVerification';
import { buildBuildingArchitectureDocument, buildingViewerParts, normalizeBuildingSpatialParameters } from './buildingSpatialModel';

const params = normalizeBuildingSpatialParameters({ width: 12_000, depth: 8000, storeyCount: 2, storeyHeight: 3200, wallThickness: 200, slabThickness: 200, entranceWidth: 1200, windowWidth: 1800, windowCountPerStorey: 1, windowHeight: 1400, windowSill: 900 });

describe('buildingSpatialModel', () => {
  it('builds a valid multi-storey semantic document with closed topology', () => {
    const document = buildBuildingArchitectureDocument(params);
    expect(validateArchitectureDocument(document)).toEqual([]);
    expect(verifyArchitectureTopology(document)).toMatchObject({ releaseReady: true });
    expect(document.storeys).toHaveLength(2);
    expect(document.openings.some(opening => opening.isExit)).toBe(true);
  });

  it('uses the semantic openings to leave door and window voids in the viewer', () => {
    const document = buildBuildingArchitectureDocument(params);
    const parts = buildingViewerParts(document);
    expect(parts.some(part => part.id.includes('entrance'))).toBe(false);
    expect(parts.filter(part => part.id.startsWith('wall-front-l1')).length).toBeGreaterThan(3);
    expect(parts.some(part => part.at.tz > 3200)).toBe(true);
  });

  it('normalizes unsafe dimensions without granting verification state', () => {
    const normalized = normalizeBuildingSpatialParameters({ ...params, storeyCount: 99, wallThickness: -1, width: Number.NaN });
    expect(normalized).toMatchObject({ width: 12_000, storeyCount: 20, wallThickness: 80 });
  });
});
