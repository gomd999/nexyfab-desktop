/**
 * Deterministic internal landscape irrigation schedule exporter.
 *
 * This deliberately serialises only the LandscapeDocument irrigation graph.
 * It is not a hydraulic solver and does not claim field or external-tool
 * interoperability.
 */

const SHA256 = /^[a-f0-9]{64}$/;
const CAPABILITY_ID = 'landscape.irrigation.schedule.internal';

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 'null' : encoded;
};

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const fail = (reason) => { throw new Error(`LANDSCAPE_IRRIGATION_SCHEDULE_EXPORT_INVALID:${reason}`); };

function requireArray(value, name) {
  if (!Array.isArray(value)) fail(`${name}_MISSING`);
  return value;
}

function validateDocument(document, options) {
  if (!document || typeof document !== 'object') fail('DOCUMENT_MISSING');
  if (document.schema !== 'nexyfab.landscape.v1') fail('DOCUMENT_SCHEMA');
  if (!Number.isSafeInteger(document.revision) || document.revision < 0) fail('DOCUMENT_REVISION');
  if (!nonEmpty(options?.workspaceRevisionId)) fail('WORKSPACE_REVISION_ID');
  if (!SHA256.test(options.workspaceContentHash)) fail('WORKSPACE_CONTENT_HASH');
  const nodes = requireArray(document.irrigationNodes, 'IRRIGATION_NODES');
  const pipes = requireArray(document.irrigationPipes, 'IRRIGATION_PIPES');
  const zones = requireArray(document.irrigationZones, 'IRRIGATION_ZONES');
  const ids = new Set();
  const register = (item, kind) => {
    if (!item || typeof item !== 'object' || !nonEmpty(item.id)) fail(`${kind}_MALFORMED`);
    if (ids.has(item.id)) fail(`DUPLICATE_ID:${item.id}`);
    ids.add(item.id);
  };
  nodes.forEach((node) => {
    register(node, 'NODE');
    if (!['source', 'valve', 'emitter'].includes(node.kind) || !Array.isArray(node.positionM) || node.positionM.length !== 3 || !node.positionM.every(finite)) fail(`NODE_MALFORMED:${node.id}`);
    if (node.pressureKpa !== undefined && !positive(node.pressureKpa)) fail(`NODE_PRESSURE:${node.id}`);
    if (node.flowLpm !== undefined && !positive(node.flowLpm)) fail(`NODE_FLOW:${node.id}`);
    if (node.kind === 'source' && (!positive(node.pressureKpa) || !positive(node.flowLpm))) fail(`SOURCE_CAPACITY:${node.id}`);
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  pipes.forEach((pipe) => {
    register(pipe, 'PIPE');
    if (!nonEmpty(pipe.fromNodeId) || !nonEmpty(pipe.toNodeId) || pipe.fromNodeId === pipe.toNodeId || !nodeIds.has(pipe.fromNodeId) || !nodeIds.has(pipe.toNodeId) || !positive(pipe.diameterMm) || !positive(pipe.lengthM)) fail(`PIPE_MALFORMED:${pipe.id}`);
  });
  const valves = new Set(nodes.filter((node) => node.kind === 'valve').map((node) => node.id));
  const emitters = new Set(nodes.filter((node) => node.kind === 'emitter').map((node) => node.id));
  zones.forEach((zone) => {
    register(zone, 'ZONE');
    if (!valves.has(zone.valveNodeId) || !Array.isArray(zone.emitterNodeIds) || zone.emitterNodeIds.length === 0 || zone.emitterNodeIds.some((id) => !emitters.has(id)) || !Array.isArray(zone.plantingZoneIds) || zone.plantingZoneIds.some((id) => !nonEmpty(id)) || !positive(zone.designFlowLpm)) fail(`ZONE_MALFORMED:${zone.id}`);
  });
  return { nodes, pipes, zones };
}

/** Export one canonical JSON artifact from a real LandscapeDocument shape. */
export function exportLandscapeIrrigationSchedule(document, options) {
  const { nodes, pipes, zones } = validateDocument(document, options);
  const sorted = (items) => items.map((item) => structuredClone(item)).sort((a, b) => a.id.localeCompare(b.id));
  const normalized = { nodes: sorted(nodes), pipes: sorted(pipes), zones: sorted(zones) };
  const rows = [
    ...normalized.nodes.map((value) => ({ objectType: 'irrigationNode', id: value.id, value })),
    ...normalized.pipes.map((value) => ({ objectType: 'irrigationPipe', id: value.id, value })),
    ...normalized.zones.map((value) => ({ objectType: 'irrigationZone', id: value.id, value })),
  ];
  const artifact = {
    schema: 'nexyfab.landscape-irrigation-schedule.v1',
    capabilityId: CAPABILITY_ID,
    format: 'schedule',
    workspaceRevisionId: options.workspaceRevisionId,
    workspaceContentHash: options.workspaceContentHash,
    sourceDocumentRevision: document.revision,
    coordinateSystemId: nonEmpty(document.coordinateSystemId) ? document.coordinateSystemId : null,
    nodes: normalized.nodes,
    pipes: normalized.pipes,
    zones: normalized.zones,
    rows,
    counts: { nodeCount: normalized.nodes.length, pipeCount: normalized.pipes.length, zoneCount: normalized.zones.length, rowCount: rows.length, objectCount: rows.length },
    stableIds: {
      nodes: normalized.nodes.map((item) => item.id),
      pipes: normalized.pipes.map((item) => item.id),
      zones: normalized.zones.map((item) => item.id),
      rows: rows.map((item) => `${item.objectType}:${item.id}`),
    },
    hydraulicEvidence: 'NOT_RUN',
    externalInteroperability: 'HOLD',
    fieldEvidence: 'NOT_RUN',
    releaseReady: false,
  };
  return canonicalJson(artifact);
}

export { CAPABILITY_ID, canonicalJson };
