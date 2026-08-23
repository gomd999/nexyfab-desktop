import { describe, expect, it } from 'vitest';
import { buildLandscapeConceptDocument, landscapeConceptIssues, landscapeViewerParts, normalizeLandscapeSpatialParameters, type LandscapeSpatialParameters } from './landscapeSpatialModel';

const defaults: LandscapeSpatialParameters = { widthM: 30, depthM: 24, pathWidthM: 2.4, treeRows: 3, treeColumns: 4, canopyDiameterM: 4, installedHeightM: 3, soilDepthM: 1.2, gradePercent: 1.5 };

describe('landscapeSpatialModel', () => {
  it('derives a valid semantic concept document without claiming site authority', () => {
    const document = buildLandscapeConceptDocument(defaults);
    expect(landscapeConceptIssues(document)).toEqual([]);
    expect(document.plants).toHaveLength(12);
    expect(document.terrain.surfaceId).toBe('SURFACE_NOT_CONNECTED');
    expect(document.sourceEvidence[0]?.sourceRef).toContain('unverified');
    expect(document.irrigationZones).toEqual([]);
  });

  it('derives terrain, path, trunk and canopy geometry from the same document', () => {
    const document = buildLandscapeConceptDocument(defaults);
    const parts = landscapeViewerParts(document, defaults);
    expect(parts.some(part => part.id === 'concept-terrain' && part.type === 'mesh')).toBe(true);
    expect(parts.some(part => part.id === 'central-path')).toBe(true);
    expect(parts.filter(part => part.role === 'plant-canopy')).toHaveLength(document.plants.length);
  });

  it('normalizes unsafe concept dimensions without granting evidence', () => {
    const value = normalizeLandscapeSpatialParameters({ ...defaults, widthM: 1, treeRows: 100, gradePercent: -5 });
    expect(value).toMatchObject({ widthM: 6, treeRows: 20, gradePercent: 0.2 });
  });
});
