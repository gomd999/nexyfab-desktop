import { describe, expect, it } from 'vitest';
import { smallPlazaCourtyardFixture as fixture } from './smallPlazaCourtyard';

describe('small plaza courtyard original fixture', () => {
  it('is original synthetic data and cannot represent field approval', () => {
    expect(fixture.provenance).toMatchObject({ origin: 'ORIGINAL_SYNTHETIC', rightsStatus: 'RIGHTS_CLEARED', externalSourcesUsed: [] });
    expect(fixture.coordinateFrame.approvedTerrainStatus).toBe('NOT_RUN');
    expect(Object.values(fixture.verificationStatus).every(status => status === 'NOT_RUN')).toBe(true);
    expect(fixture.constructionApproval.approved).toBe(false);
  });

  it('keeps planting, soil, irrigation, and maintenance references resolvable', () => {
    const soil = new Set(fixture.soilZones.map(zone => zone.id));
    const planting = new Set(fixture.plantingZones.map(zone => zone.id));
    const plants = new Set(fixture.plants.map(plant => plant.id));
    const valves = new Set(fixture.irrigation.valves.map(valve => valve.id));
    const irrigationZones = new Set(fixture.irrigation.zones.map(zone => zone.id));
    const maintenanceZones = new Set(fixture.maintenance.zones.map(zone => zone.id));
    expect(fixture.plantingZones.every(zone => soil.has(zone.soilZoneRef))).toBe(true);
    expect(fixture.plants.every(plant => planting.has(plant.plantingZoneRef) && plant.catalogStatus === 'NOT_RUN')).toBe(true);
    expect(fixture.irrigation.valves.every(valve => irrigationZones.has(valve.zoneRef))).toBe(true);
    expect(fixture.irrigation.emitters.every(emitter => valves.has(emitter.valveRef) && emitter.plantRefs.every(ref => plants.has(ref)))).toBe(true);
    expect(fixture.maintenance.tasks.every(task => maintenanceZones.has(task.zoneRef))).toBe(true);
  });

  it('keeps every authored area closed and all hydraulic/catalog claims NOT_RUN', () => {
    const polygons = [fixture.siteBoundary, ...fixture.hardscape.map(item => item.boundary), ...fixture.soilZones.map(item => item.boundary), ...fixture.plantingZones.map(item => item.boundary)];
    expect(polygons.every(polygon => JSON.stringify(polygon[0]) === JSON.stringify(polygon[polygon.length - 1]))).toBe(true);
    expect(fixture.irrigation.source.authorityStatus).toBe('NOT_RUN');
    expect(fixture.irrigation.zones.every(zone => zone.hydraulicStatus === 'NOT_RUN')).toBe(true);
    expect(fixture.irrigation.pipes.every(pipe => pipe.catalogStatus === 'NOT_RUN')).toBe(true);
  });
});
