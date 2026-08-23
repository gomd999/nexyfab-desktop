import { describe, expect, it } from 'vitest';
import { buildCivilConceptDocument, civilConceptIssues, civilViewerParts, normalizeCivilSpatialParameters, type CivilSpatialParameters } from './civilSpatialModel';
const defaults: CivilSpatialParameters = { epsg: 0, lengthM: 120, corridorWidthM: 7, surfaceWidthM: 24, startElevationM: 10, endElevationM: 11.2, crossSlopePercent: 2, drainDiameterMm: 450, drainInletCount: 1 };
describe('civilSpatialModel', () => {
  it('refuses local consistency without an explicit EPSG', () => { expect(civilConceptIssues(buildCivilConceptDocument(defaults)).join(' ')).toContain('Civil CRS requires'); });
  it('builds valid TIN, alignment, profile, corridor and drainage after explicit CRS input', () => { const doc=buildCivilConceptDocument({ ...defaults, epsg: 5186 }); expect(civilConceptIssues(doc)).toEqual([]); expect(doc.surveyControls).toEqual([]); expect(doc.sourceEvidence[0]?.sourceRef).toContain('not-connected'); });
  it('derives terrain, corridor and drainage viewer geometry', () => { expect(civilViewerParts(defaults).map(part=>part.id)).toEqual(['concept-surface','corridor-a','drain-1']); });
  it('normalizes unsafe dimensions without inventing EPSG', () => { expect(normalizeCivilSpatialParameters({ ...defaults, lengthM: 1, epsg: -1 })).toMatchObject({ lengthM: 10, epsg: 0 }); });
});
