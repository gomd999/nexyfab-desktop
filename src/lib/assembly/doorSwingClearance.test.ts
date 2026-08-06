import { describe, expect, it } from 'vitest';
import { verifyDoorSwingClearance } from './doorSwingClearance';

const box = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

describe('continuous door swing clearance', () => {
  it('detects an obstacle inside the swept sector between animation frames', () => {
    const result = verifyDoorSwingClearance({ pivot: { x: 0, y: 0 }, closedAngleDeg: 0, openAngleDeg: 90, widthMm: 900, thicknessMm: 40, obstacles: [{ id: 'chair', polygon: box(620, 350, 630, 360) }] });
    expect(result).toMatchObject({ clear: false, collidingObstacleIds: ['chair'], method: 'continuous_sector_capsule' });
  });

  it('applies finite leaf thickness and required clearance outside the centerline sector', () => {
    const result = verifyDoorSwingClearance({ pivot: { x: 0, y: 0 }, closedAngleDeg: 0, openAngleDeg: 0, widthMm: 900, thicknessMm: 40, requiredClearanceMm: 10, obstacles: [{ id: 'trim', polygon: box(400, 25, 410, 26) }] });
    expect(result.clear).toBe(false);
    expect(result.requiredEnvelopeDistanceMm).toBe(30);
  });

  it('passes a genuinely separated obstacle', () => {
    const result = verifyDoorSwingClearance({ pivot: { x: 0, y: 0 }, closedAngleDeg: 0, openAngleDeg: 90, widthMm: 900, thicknessMm: 40, obstacles: [{ id: 'far', polygon: box(1000, 1000, 1100, 1100) }] });
    expect(result.clear).toBe(true);
    expect(result.minimumEnvelopeDistanceMm).toBeGreaterThan(result.requiredEnvelopeDistanceMm);
  });
});
