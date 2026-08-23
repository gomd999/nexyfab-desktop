import { describe, expect, it } from 'vitest';
import {
  clampInteriorClearanceMm,
  clampInteriorPlacementPositionMm,
  clampInteriorRotationDeg,
  roomCenteredToTopLeftMm,
  topLeftToRoomCenteredMm,
} from './interiorPlacementDocument';

describe('interior placement coordinate truth', () => {
  const room: readonly [number, number, number] = [10_000, 8_000, 3_000];
  const dimensions: readonly [number, number, number] = [1_000, 600, 750];

  it('round-trips top-left UI coordinates through room-centred physical coordinates', () => {
    const topLeft: readonly [number, number] = [1_250, 2_100];
    const centred = topLeftToRoomCenteredMm(topLeft, room, dimensions);
    expect(roomCenteredToTopLeftMm(centred, room, dimensions)).toEqual(topLeft);
  });

  it('keeps physical coordinates unchanged for RTL', () => {
    const left = topLeftToRoomCenteredMm([1_250, 2_100], room, dimensions);
    const rtl = topLeftToRoomCenteredMm([1_250, 2_100], room, dimensions);
    expect(rtl).toEqual(left);
  });

  it('uses rotated extents in the inverse conversion', () => {
    const rotation: readonly [number, number, number] = [0, 0, 90];
    const centred = topLeftToRoomCenteredMm([0, 0], room, dimensions, rotation);
    expect(roomCenteredToTopLeftMm(centred, room, dimensions, rotation)).toEqual([0, 0]);
  });

  it('clamps rotation and non-negative clearance', () => {
    expect(clampInteriorRotationDeg([540, -540, 181])).toEqual([180, 180, -179]);
    expect(clampInteriorClearanceMm([-1, 20_000, 20])).toEqual([0, 10_000, 20]);
  });

  it('clamps room-centred positions using rotated dimensional extents', () => {
    expect(clampInteriorPlacementPositionMm([9_000, 9_000, 0], room, dimensions, [0, 0, 90])).toEqual([4_700, 3_500, 0]);
  });
});
