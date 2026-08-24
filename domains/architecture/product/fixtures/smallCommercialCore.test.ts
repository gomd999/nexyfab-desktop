import { describe, expect, it } from 'vitest';
import { smallCommercialCoreFixture as fixture } from './smallCommercialCore';

describe('small commercial core original fixture', () => {
  it('is rights-cleared synthetic data and carries no commercial approval', () => {
    expect(fixture.provenance).toMatchObject({ origin: 'ORIGINAL_SYNTHETIC', rightsStatus: 'RIGHTS_CLEARED', externalSourcesUsed: [] });
    expect(fixture.coordinateFrame.surveyStatus).toBe('NOT_RUN');
    expect(fixture.constructionApproval.approved).toBe(false);
    expect(Object.values(fixture.verificationStatus).every(status => status === 'NOT_RUN')).toBe(true);
  });

  it('uses stable, unique object IDs and resolvable level/host references', () => {
    const idGroups = [fixture.levels, fixture.grids, fixture.spaces, fixture.walls, fixture.slabs, fixture.envelopeLayers, fixture.openings, fixture.serviceOpenings];
    const ids: string[] = [
      ...idGroups.flatMap(group => group.map(item => item.id as string)),
      fixture.site.id, fixture.roof.id, fixture.stair.id,
      ...fixture.egress.nodes.map(node => node.id), ...fixture.egress.edges.map(edge => edge.id),
      fixture.upstream.structural.id, fixture.upstream.mep.id, fixture.upstream.mechanical.id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
    const levels = new Set(fixture.levels.map(level => level.id));
    const walls = new Set(fixture.walls.map(wall => wall.id));
    expect(fixture.spaces.every(space => levels.has(space.levelRef))).toBe(true);
    expect(fixture.walls.every(wall => levels.has(wall.levelRef))).toBe(true);
    expect(fixture.openings.every(opening => levels.has(opening.levelRef) && walls.has(opening.hostRef))).toBe(true);
    expect(levels.has(fixture.stair.fromLevelRef) && levels.has(fixture.stair.toLevelRef)).toBe(true);
  });

  it('keeps every polygon explicitly closed and all external gates visible', () => {
    for (const polygon of [fixture.site.boundary, ...fixture.spaces.map(space => space.boundary)]) {
      expect(polygon[0]).toEqual(polygon[polygon.length - 1]);
    }
    expect(fixture.openings.every(opening => opening.catalogStatus === 'NOT_RUN')).toBe(true);
    expect(fixture.upstream.structural.revisionStatus).toBe('NOT_RUN');
    expect(fixture.upstream.mep.revisionStatus).toBe('NOT_RUN');
    expect(fixture.upstream.mechanical.revisionStatus).toBe('NOT_RUN');
  });
});
