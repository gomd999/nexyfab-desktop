import { describe, expect, it } from 'vitest';
import { smallSiteAccessRoadFixture as fixture } from './smallSiteAccessRoad';

describe('small site access road original fixture', () => {
  it('is rights-cleared synthetic input with every external gate left NOT_RUN', () => {
    expect(fixture.provenance).toMatchObject({ origin: 'ORIGINAL_SYNTHETIC', rightsStatus: 'RIGHTS_CLEARED', externalSourcesUsed: [] });
    expect(fixture.coordinateAuthority.surveyApproval).toBe(false);
    expect(Object.values(fixture.verificationStatus).every(status => status === 'NOT_RUN')).toBe(true);
    expect(fixture.constructionApproval.approved).toBe(false);
  });

  it('keeps TIN and breakline references resolvable without claiming an approved surface', () => {
    const points = new Set(fixture.points.map(point => point.id));
    const breaklines = new Set(fixture.breaklines.map(line => line.id));
    expect(fixture.breaklines.every(line => line.pointRefs.every(ref => points.has(ref)))).toBe(true);
    for (const surface of fixture.surfaces) {
      expect(surface.authorityStatus).toBe('NOT_RUN');
      expect(surface.triangleRefs.every(triangle => triangle.pointRefs.length === 3 && new Set(triangle.pointRefs).size === 3 && triangle.pointRefs.every(ref => points.has(ref)))).toBe(true);
      expect(surface.breaklineRefs.every(ref => breaklines.has(ref))).toBe(true);
    }
  });

  it('has monotonic stations, connected drainage, and an acyclic construction sequence', () => {
    const stations = fixture.crossSections.map(section => section.station);
    expect(stations).toEqual([...stations].sort((a, b) => a - b));
    const nodes = new Set(fixture.drainage.nodes.map(node => node.id));
    expect(fixture.drainage.links.every(link => nodes.has(link.fromRef) && nodes.has(link.toRef) && link.hydraulicStatus === 'NOT_RUN')).toBe(true);
    const stages = new Set<string>(fixture.constructionStages.map(stage => stage.id));
    expect(fixture.constructionStages.every(stage => stage.dependsOn.every(ref => stages.has(ref) && ref !== stage.id))).toBe(true);
  });
});
