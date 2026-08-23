import { describe, expect, it } from 'vitest';
import { verifyMepConnections } from '../mepConnectionVerification';

const rules = { maximumConnectionDistanceMm: 50, minimumDrainSlopePercent: 1, requireMatchingConnector: true };
describe('explicit MEP port network', () => {
  it('passes compatible nearby ports and governed drain slope', () => {
    const result = verifyMepConnections([{ id: 'sink-drain', ownerObjectId: 'sink', system: 'drain', connector: 'DN40', positionMm: [0, 0, 500], required: true }], [{ id: 'drain-node', system: 'drain', connector: 'DN40', positionMm: [20, 0, 500] }, { id: 'drain-end', system: 'drain', connector: 'DN40', positionMm: [1020, 0, 480] }], [{ id: 'connect', portId: 'sink-drain', nodeId: 'drain-node' }], [{ id: 'run', system: 'drain', fromNodeId: 'drain-node', toNodeId: 'drain-end', lengthMm: 1000, elevationDropMm: 20, diameterMm: 40 }], rules);
    expect(result.status).toBe('passed');
  });
  it('reports unconnected, incompatible, distant, and low-slope systems independently', () => {
    const result = verifyMepConnections([{ id: 'power', ownerObjectId: 'desk', system: 'electrical', connector: '220V', positionMm: [0, 0, 0], required: true }, { id: 'drain-port', ownerObjectId: 'sink', system: 'drain', connector: 'DN40', positionMm: [0, 0, 0], required: true }], [{ id: 'data-node', system: 'data', connector: 'RJ45', positionMm: [500, 0, 0] }, { id: 'd1', system: 'drain', connector: 'DN40', positionMm: [0, 0, 0] }, { id: 'd2', system: 'drain', connector: 'DN40', positionMm: [1000, 0, 0] }], [{ id: 'bad', portId: 'power', nodeId: 'data-node' }], [{ id: 'flat', system: 'drain', fromNodeId: 'd1', toNodeId: 'd2', lengthMm: 1000, elevationDropMm: 2 }], rules);
    expect(result.failures.map(item => item.code)).toEqual(expect.arrayContaining(['REQUIRED_PORT_UNCONNECTED', 'SYSTEM_MISMATCH', 'CONNECTOR_MISMATCH', 'CONNECTION_TOO_FAR', 'DRAIN_SLOPE_LOW']));
  });
  it('does not pass without governed connection rules', () => expect(verifyMepConnections([], [], [], []).status).toBe('not_run'));

  it('does not turn an empty strict network into a vacuous release pass', () => {
    const result = verifyMepConnections([], [], [], [], { ...rules, requirePhysicalRouteGeometry: true });
    expect(result).toMatchObject({ status: 'failed', releaseReady: false });
    expect(result.failures).toContainEqual({ objectId: 'network', code: 'PHYSICAL_NETWORK_EMPTY' });
  });

  it('strict PT100 network passes only with typed ports and measured continuous route geometry', () => {
    const result = verifyMepConnections(
      [{ id: 'pt100-process', ownerObjectId: 'pt100-thermowell', system: 'hot_water', connector: 'DN25', positionMm: [0, 0, 0], required: true, direction: 'bidirectional', nominalDiameterMm: 25, axis: [1, 0, 0], insertionDepthMm: 1 }],
      [{ id: 'process-node', system: 'hot_water', connector: 'DN25', positionMm: [0, 0, 0], nominalDiameterMm: 25 }, { id: 'tank-node', system: 'hot_water', connector: 'DN25', positionMm: [100, 0, 0], nominalDiameterMm: 25 }],
      [{ id: 'pt100-connection', portId: 'pt100-process', nodeId: 'process-node' }],
      [{ id: 'process-run', system: 'hot_water', fromNodeId: 'process-node', toNodeId: 'tank-node', lengthMm: 100, diameterMm: 25, pathMm: [[0, 0, 0], [50, 0, 0], [100, 0, 0]], representation: 'physical_solid' }],
      { ...rules, requirePhysicalRouteGeometry: true, requireRunFromConnectedPort: true, requireDiameterMatch: true, endpointToleranceMm: 0.1, lengthToleranceMm: 0.1 },
    );
    expect(result).toMatchObject({ status: 'passed', releaseReady: true, measurements: { physicalRoutes: 1, pathSegments: 2 } });
  });

  it('blocks fake route endpoints, declared-length mismatch, wrong axis and missing typed diameter', () => {
    const result = verifyMepConnections(
      [{ id: 'pt100-process', ownerObjectId: 'pt100', system: 'hot_water', connector: 'DN25', positionMm: [0, 0, 0], required: true, direction: 'inlet', axis: [0, 1, 0] }],
      [{ id: 'n0', system: 'hot_water', connector: 'DN25', positionMm: [0, 0, 0] }, { id: 'n1', system: 'hot_water', connector: 'DN25', positionMm: [100, 0, 0] }],
      [{ id: 'c0', portId: 'pt100-process', nodeId: 'n0' }],
      [{ id: 'fake', system: 'hot_water', fromNodeId: 'n0', toNodeId: 'n1', lengthMm: 100, diameterMm: 20, pathMm: [[0, 0, 0], [0, 0, 0], [80, 0, 0]] }],
      { ...rules, requirePhysicalRouteGeometry: true, requireRunFromConnectedPort: true, requireDiameterMatch: true, endpointToleranceMm: 0.1, lengthToleranceMm: 0.1 },
    );
    expect(result.releaseReady).toBe(false);
    expect(result.failures.map(item => item.code)).toEqual(expect.arrayContaining(['TYPED_PORT_INCOMPLETE', 'ZERO_LENGTH_SEGMENT', 'ROUTE_ENDPOINT_MISMATCH', 'ROUTE_LENGTH_MISMATCH', 'PORT_AXIS_MISMATCH']));
  });

  it('enforces port-to-run connectivity and fluid run diameter even when caller flags try to disable them', () => {
    const disconnected = verifyMepConnections(
      [{ id: 'p', ownerObjectId: 'sensor', system: 'electrical', connector: 'M12', positionMm: [0, 0, 0], required: true, direction: 'outlet', axis: [1, 0, 0] }],
      [{ id: 'n0', system: 'electrical', connector: 'M12', positionMm: [0, 0, 0] }, { id: 'n1', system: 'electrical', connector: 'M12', positionMm: [100, 0, 0] }],
      [{ id: 'c', portId: 'p', nodeId: 'n0' }],
      [{ id: 'elsewhere', system: 'electrical', fromNodeId: 'n1', toNodeId: 'n1', lengthMm: 100, pathMm: [[100, 0, 0], [200, 0, 0]] }],
      { ...rules, requirePhysicalRouteGeometry: true, requireRunFromConnectedPort: false },
    );
    expect(disconnected.failures.map(item => item.code)).toContain('ROUTE_NOT_CONNECTED_TO_REQUIRED_PORT');

    const diameterless = verifyMepConnections([], [
      { id: 'f0', system: 'hot_water', connector: 'DN25', positionMm: [0, 0, 0] },
      { id: 'f1', system: 'hot_water', connector: 'DN25', positionMm: [100, 0, 0] },
    ], [], [{ id: 'fluid', system: 'hot_water', fromNodeId: 'f0', toNodeId: 'f1', lengthMm: 100, pathMm: [[0, 0, 0], [100, 0, 0]] }], { ...rules, requirePhysicalRouteGeometry: true, requireDiameterMatch: false });
    expect(diameterless.failures.map(item => item.code)).toContain('TYPED_RUN_INCOMPLETE');
  });

  it('keeps analysis-only internal flow out of collision solids and rejects duplicate physical flow bodies', () => {
    const result = verifyMepConnections([], [
      { id: 'a', system: 'hot_water', connector: 'DN25', positionMm: [0, 0, 0] },
      { id: 'b', system: 'hot_water', connector: 'DN25', positionMm: [100, 0, 0] },
    ], [], [
      { id: 'wall-a', system: 'hot_water', fromNodeId: 'a', toNodeId: 'b', lengthMm: 100, pathMm: [[0, 0, 0], [100, 0, 0]], representation: 'physical_solid', internalFlowPathId: 'flow-1' },
      { id: 'wall-b', system: 'hot_water', fromNodeId: 'a', toNodeId: 'b', lengthMm: 100, pathMm: [[0, 0, 0], [100, 0, 0]], representation: 'physical_solid', internalFlowPathId: 'flow-1' },
      { id: 'flow-axis', system: 'hot_water', fromNodeId: 'a', toNodeId: 'b', lengthMm: 100, pathMm: [[0, 0, 0], [100, 0, 0]], representation: 'analysis_only_internal_flow', internalFlowPathId: 'flow-1', collisionEligible: true },
    ], { ...rules, requirePhysicalRouteGeometry: true });
    expect(result.releaseReady).toBe(false);
    expect(result.failures.map(item => item.code)).toEqual(expect.arrayContaining(['DUPLICATE_INTERNAL_FLOW_SOLID', 'INTERNAL_FLOW_COLLISION_SOLID']));
  });
});
