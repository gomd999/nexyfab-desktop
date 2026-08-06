import { describe, expect, it } from 'vitest';
import { planBuildingInteriorChatEdit } from '../buildingInteriorChatEdit';
import type { BuildingInteriorModel } from '../buildingInteriorDesign';

const model: BuildingInteriorModel = { schema: 'nexyfab.building-interior.v1', units: 'mm', revision: 0, objects: [
  { id: 'corridor-1', kind: 'corridor', name: '복도', positionMm: [0, 0, 0], pathMm: [[0, 0, 0], [5000, 0, 0]], widthMm: 1500, clearHeightMm: 2400 },
  { id: 'light-1', kind: 'light', name: '등', positionMm: [0, 0, 2400], roomId: 'room-1', lumens: 2000, cctK: 4000, mountingHeightMm: 2400 },
  { id: 'room-1', kind: 'room', name: '방', positionMm: [0, 0, 0], sizeMm: [4000, 3000, 2600], usage: 'bedroom' },
] };

describe('building/interior chat edit planning', () => {
  it('plans Korean property and XYZ move commands', () => {
    expect(planBuildingInteriorChatEdit(model, 'corridor-1', '복도 폭 1800')).toMatchObject({ kind: 'set_property', property: 'widthMm', value: 1800 });
    expect(planBuildingInteriorChatEdit(model, 'light-1', '이동 100, 200, 2300')).toMatchObject({ kind: 'move', positionMm: [100, 200, 2300] });
    expect(planBuildingInteriorChatEdit(model, 'room-1', '깊이 3600')).toMatchObject({ kind: 'set_property', property: 'sizeMm.1', value: 3600 });
  });
  it('fails closed instead of guessing an ambiguous design change', () => {
    expect(() => planBuildingInteriorChatEdit(model, 'room-1', '방을 더 좋게 해줘')).toThrow('명확한');
  });
});
