type V3 = [number, number, number];
export type MepSystem = 'electrical' | 'data' | 'cold_water' | 'hot_water' | 'drain' | 'supply_air' | 'return_air';
export interface EquipmentPort {
  id: string;
  ownerObjectId: string;
  system: MepSystem;
  connector: string;
  positionMm: V3;
  required: boolean;
  direction?: 'inlet' | 'outlet' | 'bidirectional';
  nominalDiameterMm?: number;
  axis?: V3;
  insertionDepthMm?: number;
}
export interface MepNode { id: string; system: MepSystem; connector: string; positionMm: V3; nominalDiameterMm?: number }
export interface MepConnection { id: string; portId: string; nodeId: string }
export interface MepRun {
  id: string;
  system: MepSystem;
  fromNodeId: string;
  toNodeId: string;
  lengthMm: number;
  elevationDropMm?: number;
  diameterMm?: number;
  /** Measured centerline points. Strict/commercial verification requires this geometry. */
  pathMm?: V3[];
  representation?: 'physical_solid' | 'analysis_only_internal_flow';
  /** Stable id shared by representations of the same internal fluid passage. */
  internalFlowPathId?: string;
  /** Analysis-only flow paths must never enter collision-solid inventories. */
  collisionEligible?: boolean;
}
export interface MepConnectionRules {
  maximumConnectionDistanceMm: number;
  minimumDrainSlopePercent: number;
  requireMatchingConnector: boolean;
  requirePhysicalRouteGeometry?: boolean;
  endpointToleranceMm?: number;
  lengthToleranceMm?: number;
  minimumAxisAlignmentCos?: number;
  requireDiameterMatch?: boolean;
  requireRunFromConnectedPort?: boolean;
}
export interface PhysicalNetworkModel {
  id: string;
  ports: EquipmentPort[];
  nodes: MepNode[];
  connections: MepConnection[];
  runs: MepRun[];
  rules: MepConnectionRules;
}
export type MepConnectionFailureCode =
  | 'REQUIRED_PORT_UNCONNECTED' | 'UNKNOWN_ENDPOINT' | 'SYSTEM_MISMATCH' | 'CONNECTOR_MISMATCH'
  | 'CONNECTION_TOO_FAR' | 'INVALID_RUN' | 'DRAIN_SLOPE_LOW' | 'DUPLICATE_ID'
  | 'DUPLICATE_PORT_CONNECTION' | 'TYPED_PORT_INCOMPLETE' | 'DIAMETER_MISMATCH'
  | 'TYPED_RUN_INCOMPLETE'
  | 'ROUTE_GEOMETRY_MISSING' | 'ROUTE_ENDPOINT_MISMATCH' | 'ROUTE_LENGTH_MISMATCH'
  | 'ZERO_LENGTH_SEGMENT' | 'PORT_AXIS_MISMATCH' | 'ROUTE_NOT_CONNECTED_TO_REQUIRED_PORT'
  | 'INTERNAL_FLOW_COLLISION_SOLID' | 'DUPLICATE_INTERNAL_FLOW_SOLID' | 'PHYSICAL_NETWORK_EMPTY';
export interface MepConnectionResult {
  status: 'passed' | 'failed' | 'not_run';
  releaseReady: boolean;
  failures: Array<{ objectId: string; code: MepConnectionFailureCode; measured?: number; required?: number }>;
  method: 'explicit_port_network';
  measurements: { physicalRoutes: number; analysisOnlyRoutes: number; pathSegments: number };
}

const FLUID_SYSTEMS = new Set<MepSystem>(['cold_water', 'hot_water', 'drain', 'supply_air', 'return_air']);
const finiteV3 = (point: V3) => point.length === 3 && point.every(Number.isFinite);
const distance = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const magnitude = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const direction = (a: V3, b: V3): V3 => {
  const length = distance(a, b);
  return length > 0 ? [(b[0] - a[0]) / length, (b[1] - a[1]) / length, (b[2] - a[2]) / length] : [0, 0, 0];
};
const alignment = (a: V3, b: V3) => {
  const divisor = magnitude(a) * magnitude(b);
  return divisor > 0 ? Math.abs((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / divisor) : 0;
};

function duplicateIds(items: ReadonlyArray<{ id: string }>): string[] {
  const seen = new Set<string>(), duplicates = new Set<string>();
  for (const item of items) { if (seen.has(item.id)) duplicates.add(item.id); seen.add(item.id); }
  return [...duplicates].sort();
}

export function verifyMepConnections(ports: EquipmentPort[], nodes: MepNode[], connections: MepConnection[], runs: MepRun[], rules?: MepConnectionRules): MepConnectionResult {
  const emptyMeasurements = { physicalRoutes: 0, analysisOnlyRoutes: 0, pathSegments: 0 };
  if (!rules) return { status: 'not_run', releaseReady: false, failures: [], method: 'explicit_port_network', measurements: emptyMeasurements };
  const endpointTolerance = rules.endpointToleranceMm ?? 1;
  const lengthTolerance = rules.lengthToleranceMm ?? 1;
  const minimumAxisAlignment = rules.minimumAxisAlignmentCos ?? Math.cos(15 * Math.PI / 180);
  if (!(rules.maximumConnectionDistanceMm >= 0) || !(rules.minimumDrainSlopePercent >= 0)
    || !(endpointTolerance >= 0) || !(lengthTolerance >= 0) || !(minimumAxisAlignment >= 0 && minimumAxisAlignment <= 1)
    || ![rules.maximumConnectionDistanceMm, rules.minimumDrainSlopePercent, endpointTolerance, lengthTolerance, minimumAxisAlignment].every(Number.isFinite)) {
    throw new Error('MEP connection rules are invalid.');
  }

  const failures: MepConnectionResult['failures'] = [];
  if (rules.requirePhysicalRouteGeometry && (!ports.some(port => port.required) || nodes.length < 2 || runs.length < 1)) failures.push({ objectId: 'network', code: 'PHYSICAL_NETWORK_EMPTY' });
  const portMap = new Map(ports.map(item => [item.id, item])), nodeMap = new Map(nodes.map(item => [item.id, item]));
  const runMapByNode = new Map<string, MepRun[]>();
  for (const run of runs) {
    runMapByNode.set(run.fromNodeId, [...(runMapByNode.get(run.fromNodeId) ?? []), run]);
    runMapByNode.set(run.toNodeId, [...(runMapByNode.get(run.toNodeId) ?? []), run]);
  }
  for (const id of [...duplicateIds(ports), ...duplicateIds(nodes), ...duplicateIds(connections), ...duplicateIds(runs)]) failures.push({ objectId: id, code: 'DUPLICATE_ID' });

  for (const port of ports) {
    if (!finiteV3(port.positionMm) || !port.id.trim() || !port.ownerObjectId.trim() || !port.connector.trim()) failures.push({ objectId: port.id, code: 'UNKNOWN_ENDPOINT' });
    if (port.required && !connections.some(item => item.portId === port.id)) failures.push({ objectId: port.id, code: 'REQUIRED_PORT_UNCONNECTED' });
    if (rules.requirePhysicalRouteGeometry) {
      const diameterMissing = FLUID_SYSTEMS.has(port.system) && !(Number.isFinite(port.nominalDiameterMm) && port.nominalDiameterMm! > 0);
      if (!port.direction || !port.axis || !finiteV3(port.axis) || magnitude(port.axis) === 0 || diameterMissing) failures.push({ objectId: port.id, code: 'TYPED_PORT_INCOMPLETE' });
    }
  }

  const connectionsByPort = new Map<string, MepConnection[]>();
  for (const connection of connections) {
    connectionsByPort.set(connection.portId, [...(connectionsByPort.get(connection.portId) ?? []), connection]);
    const port = portMap.get(connection.portId), node = nodeMap.get(connection.nodeId);
    if (!port || !node || !finiteV3(node.positionMm)) { failures.push({ objectId: connection.id, code: 'UNKNOWN_ENDPOINT' }); continue; }
    if (port.system !== node.system) failures.push({ objectId: connection.id, code: 'SYSTEM_MISMATCH' });
    if (rules.requireMatchingConnector && port.connector !== node.connector) failures.push({ objectId: connection.id, code: 'CONNECTOR_MISMATCH' });
    const measuredDistance = distance(port.positionMm, node.positionMm);
    const allowedDistance = port.insertionDepthMm === undefined ? rules.maximumConnectionDistanceMm : Math.min(rules.maximumConnectionDistanceMm, port.insertionDepthMm);
    if (measuredDistance > allowedDistance) failures.push({ objectId: connection.id, code: 'CONNECTION_TOO_FAR', measured: measuredDistance, required: allowedDistance });
    if ((rules.requirePhysicalRouteGeometry || rules.requireRunFromConnectedPort) && port.required && !(runMapByNode.get(node.id)?.length)) failures.push({ objectId: port.id, code: 'ROUTE_NOT_CONNECTED_TO_REQUIRED_PORT' });
  }
  for (const [portId, declared] of connectionsByPort) if (declared.length > 1) failures.push({ objectId: portId, code: 'DUPLICATE_PORT_CONNECTION', measured: declared.length, required: 1 });

  let physicalRoutes = 0, analysisOnlyRoutes = 0, pathSegments = 0;
  const physicalByInternalPath = new Map<string, string[]>();
  for (const run of runs) {
    const from = nodeMap.get(run.fromNodeId), to = nodeMap.get(run.toNodeId);
    const representation = run.representation ?? 'physical_solid';
    if (representation === 'physical_solid') physicalRoutes++; else analysisOnlyRoutes++;
    if (representation === 'analysis_only_internal_flow' && run.collisionEligible === true) failures.push({ objectId: run.id, code: 'INTERNAL_FLOW_COLLISION_SOLID' });
    if (representation === 'physical_solid' && run.internalFlowPathId) physicalByInternalPath.set(run.internalFlowPathId, [...(physicalByInternalPath.get(run.internalFlowPathId) ?? []), run.id]);
    if (!from || !to || from.system !== run.system || to.system !== run.system || !(run.lengthMm > 0) || !Number.isFinite(run.lengthMm) || (run.diameterMm !== undefined && !(run.diameterMm > 0))) {
      failures.push({ objectId: run.id, code: 'INVALID_RUN' }); continue;
    }
    if (rules.requirePhysicalRouteGeometry && FLUID_SYSTEMS.has(run.system) && !(Number.isFinite(run.diameterMm) && run.diameterMm! > 0)) failures.push({ objectId: run.id, code: 'TYPED_RUN_INCOMPLETE' });
    if (run.system === 'drain') {
      if (!Number.isFinite(run.elevationDropMm)) failures.push({ objectId: run.id, code: 'INVALID_RUN' });
      else {
        const slope = Math.abs(run.elevationDropMm!) / run.lengthMm * 100;
        if (slope < rules.minimumDrainSlopePercent) failures.push({ objectId: run.id, code: 'DRAIN_SLOPE_LOW', measured: slope, required: rules.minimumDrainSlopePercent });
      }
    }
    const path = run.pathMm;
    if (!path || path.length < 2) {
      if (rules.requirePhysicalRouteGeometry) failures.push({ objectId: run.id, code: 'ROUTE_GEOMETRY_MISSING' });
      continue;
    }
    if (path.some(point => !finiteV3(point))) { failures.push({ objectId: run.id, code: 'INVALID_RUN' }); continue; }
    const segmentLengths = path.slice(1).map((point, index) => distance(path[index]!, point));
    pathSegments += segmentLengths.length;
    if (segmentLengths.some(length => length <= endpointTolerance)) failures.push({ objectId: run.id, code: 'ZERO_LENGTH_SEGMENT' });
    const measuredLength = segmentLengths.reduce((sum, length) => sum + length, 0);
    if (distance(path[0]!, from.positionMm) > endpointTolerance || distance(path.at(-1)!, to.positionMm) > endpointTolerance) failures.push({ objectId: run.id, code: 'ROUTE_ENDPOINT_MISMATCH' });
    if (Math.abs(measuredLength - run.lengthMm) > lengthTolerance) failures.push({ objectId: run.id, code: 'ROUTE_LENGTH_MISMATCH', measured: measuredLength, required: run.lengthMm });

    const endpointConnections = connections.filter(connection => connection.nodeId === from.id || connection.nodeId === to.id);
    for (const connection of endpointConnections) {
      const port = portMap.get(connection.portId);
      if (!port) continue;
      if ((rules.requirePhysicalRouteGeometry || rules.requireDiameterMatch) && FLUID_SYSTEMS.has(run.system) && Number.isFinite(port.nominalDiameterMm) && Number.isFinite(run.diameterMm) && Math.abs(port.nominalDiameterMm! - run.diameterMm!) > endpointTolerance) failures.push({ objectId: connection.id, code: 'DIAMETER_MISMATCH', measured: run.diameterMm, required: port.nominalDiameterMm });
      if (port.axis && finiteV3(port.axis)) {
        const routeAxis = connection.nodeId === from.id ? direction(path[0]!, path[1]!) : direction(path.at(-1)!, path.at(-2)!);
        const measuredAlignment = alignment(port.axis, routeAxis);
        if (measuredAlignment < minimumAxisAlignment) failures.push({ objectId: connection.id, code: 'PORT_AXIS_MISMATCH', measured: measuredAlignment, required: minimumAxisAlignment });
      }
    }
  }
  for (const [internalPathId, ids] of physicalByInternalPath) if (ids.length > 1) failures.push({ objectId: internalPathId, code: 'DUPLICATE_INTERNAL_FLOW_SOLID', measured: ids.length, required: 1 });

  const status = failures.length ? 'failed' : 'passed';
  return {
    status,
    releaseReady: status === 'passed' && rules.requirePhysicalRouteGeometry === true,
    failures,
    method: 'explicit_port_network',
    measurements: { physicalRoutes, analysisOnlyRoutes, pathSegments },
  };
}
