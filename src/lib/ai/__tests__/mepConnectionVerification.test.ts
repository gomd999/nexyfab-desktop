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
});
