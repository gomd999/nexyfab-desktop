import { describe, expect, it } from 'vitest';
import { verifyEgressRoutes, type EgressRouteInput } from './egressRouteVerification';

const base = (): EgressRouteInput => ({
  nodes: [{ id: 'room', point: { x: 0, y: 0 } }, { id: 'hall', point: { x: 3000, y: 0 } }, { id: 'exit', point: { x: 6000, y: 0 } }],
  edges: [{ id: 'door', from: 'room', to: 'hall', clearWidthMm: 900 }, { id: 'corridor', from: 'hall', to: 'exit', clearWidthMm: 1200 }],
  originNodeIds: ['room'], exitNodeIds: ['exit'], maximumTravelDistanceMm: 7000, minimumClearWidthMm: 800,
});
describe('governed egress route verification', () => {
  it('returns the measured shortest path and bottleneck width', () => {
    expect(verifyEgressRoutes(base())).toMatchObject({ passed: true, reachableExitCount: 1, originResults: [{ travelDistanceMm: 6000, bottleneckWidthMm: 900, pathEdgeIds: ['door', 'corridor'] }], conservative: true });
  });
  it('does not route through an edge below governed clear width', () => {
    const input = base(); input.edges[0]!.clearWidthMm = 750;
    const result = verifyEgressRoutes(input);
    expect(result.passed).toBe(false); expect(result.failures).toContain('NO_ROUTE');
  });
  it('distinguishes excessive travel and insufficient independent exits', () => {
    const input = base(); input.maximumTravelDistanceMm = 5000; input.minimumIndependentExits = 2;
    const result = verifyEgressRoutes(input);
    expect(result.failures).toContain('TRAVEL_DISTANCE_EXCEEDED'); expect(result.failures).toContain('INSUFFICIENT_EXITS');
  });
});
