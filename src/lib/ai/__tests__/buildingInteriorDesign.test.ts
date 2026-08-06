import { describe, expect, it } from 'vitest';
import { applyBuildingInteriorEdits, validateBuildingInteriorModel, type BuildingInteriorModel } from '../buildingInteriorDesign';
const model: BuildingInteriorModel = { schema: 'nexyfab.building-interior.v1', units: 'mm', revision: 0, objects: [
  { id: 'room-1', kind: 'room', name: 'Living', positionMm: [0, 0, 0], sizeMm: [5000, 4000, 2700], usage: 'living' },
  { id: 'window-1', kind: 'window', name: 'South window', positionMm: [1000, 0, 900], hostId: 'room-1', widthMm: 1800, heightMm: 1200, sillMm: 900 },
  { id: 'light-1', kind: 'light', name: 'Ceiling light', positionMm: [2500, 2000, 2500], roomId: 'room-1', lumens: 3000, cctK: 4000, mountingHeightMm: 2500 },
  { id: 'corridor-1', kind: 'corridor', name: 'Hall', positionMm: [0, 0, 0], pathMm: [[0, 0, 0], [8000, 0, 0]], widthMm: 1500, clearHeightMm: 2400 },
] };
describe('building/interior semantic editing', () => {
  it('moves and resizes only selected objects and invalidates affected verification', () => { const result = applyBuildingInteriorEdits(model, [{ kind: 'set_property', objectId: 'room-1', property: 'sizeMm.0', value: 6000 }, { kind: 'move', objectId: 'light-1', positionMm: [3000, 2000, 2500] }]); expect(result.model.objects.find(x => x.id === 'room-1')).toMatchObject({ sizeMm: [6000, 4000, 2700] }); expect(result.model.objects.find(x => x.id === 'window-1')).toEqual(model.objects[1]); expect(result.invalidatedChecks).toEqual(expect.arrayContaining(['space_boundary', 'egress', 'lighting'])); });
  it('prevents deleting a room while windows or lights reference it', () => expect(() => applyBuildingInteriorEdits(model, [{ kind: 'remove', objectId: 'room-1' }])).toThrow(/referenced/));
  it('rejects inconsistent stair geometry and invalid curved facade angles', () => { const bad = structuredClone(model); bad.objects.push({ id: 'stair-1', kind: 'stair', name: 'Stair', positionMm: [0,0,0], widthMm: 1200, totalRiseMm: 3000, treadMm: 280, riserMm: 170, steps: 10, flights: 1 }); bad.objects.push({ id: 'curve-1', kind: 'curved_facade', name: 'Curve', positionMm: [0,0,0], radiusMm: 10000, angleDeg: 400, heightMm: 9000, thicknessMm: 200 }); expect(validateBuildingInteriorModel(bad).length).toBeGreaterThanOrEqual(2); });
});
