import { describe, expect, it } from 'vitest';
import { verifyDoorSwingClearance } from '@/lib/assembly/doorSwingClearance';
import { verifyEgressRoutes } from '@/lib/assembly/egressRouteVerification';
import { verifyMepInterference } from '@/lib/assembly/mepInterferenceVerification';
import { verifySpaceBoundaryClosure } from '@/lib/assembly/spaceBoundaryClosure';
import { verifyCrossDomainDesign } from '../crossDomainVerification';

describe('interior golden release evidence', () => {
  it('derives every interior gate from geometry instead of declared booleans', () => {
    const boundary = verifySpaceBoundaryClosure({ segments: [
      { id: 'south', start: { x: 0, y: 0 }, end: { x: 6000, y: 0 } }, { id: 'east', start: { x: 6000, y: 0 }, end: { x: 6000, y: 4000 } },
      { id: 'north', start: { x: 6000, y: 4000 }, end: { x: 0, y: 4000 } }, { id: 'west', start: { x: 0, y: 4000 }, end: { x: 0, y: 0 } },
    ] });
    const egress = verifyEgressRoutes({
      nodes: [{ id: 'desk', point: { x: 1000, y: 2000 } }, { id: 'door', point: { x: 6000, y: 2000 } }], edges: [{ id: 'aisle', from: 'desk', to: 'door', clearWidthMm: 1200 }],
      originNodeIds: ['desk'], exitNodeIds: ['door'], maximumTravelDistanceMm: 6000, minimumClearWidthMm: 900,
    });
    const door = verifyDoorSwingClearance({ pivot: { x: 6000, y: 1550 }, closedAngleDeg: 90, openAngleDeg: 180, widthMm: 900, thicknessMm: 40, obstacles: [{ id: 'desk', polygon: [{ x: 1000, y: 1000 }, { x: 2000, y: 1000 }, { x: 2000, y: 1800 }, { x: 1000, y: 1800 }] }] });
    const mep = verifyMepInterference({ runs: [{ id: 'supply', system: 'supply-air', centerline: [{ x: 500, y: 3500, z: 2700 }, { x: 5500, y: 3500, z: 2700 }], outerDiameterMm: 200 }], obstacles: [], defaultClearanceMm: 50 });
    const release = verifyCrossDomainDesign({
      structure: { valid: true }, placement: { required: 5, resolved: 5, invalid: 0 },
      interior: { applicable: true,
        spaceBoundary: { ran: true, openBoundaries: boundary.openBoundaries, conservative: boundary.conservative },
        egress: { ran: true, passed: egress.passed, conservative: egress.conservative }, doorSwing: { ran: true, clear: door.clear, conservative: door.conservative },
        mepInterference: { ran: true, collisions: mep.collisions.length, missingGeometry: mep.missingGeometryIds.length, conservative: mep.conservative },
      },
    });
    expect({ boundary, egress, door, mep }).toMatchObject({ boundary: { closed: true }, egress: { passed: true }, door: { clear: true }, mep: { clear: true } });
    expect(release.releaseReady).toBe(true); expect(release.gates.every(gate => gate.status === 'passed')).toBe(true);
  });
});
