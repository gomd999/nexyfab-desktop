/** Independent strict parser for the internal irrigation schedule artifact. */

const SHA256 = /^[a-f0-9]{64}$/;
const CAPABILITY_ID = 'landscape.irrigation.schedule.internal';
const fail = (reason) => { throw new Error(`LANDSCAPE_IRRIGATION_SCHEDULE_PARSE_INVALID:${reason}`); };
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value); return encoded === undefined ? 'null' : encoded;
};
const same = (left, right) => canonical(left) === canonical(right);

function array(value, name) { if (!Array.isArray(value)) fail(`${name}_MISSING`); return value; }
function stable(items, kind) {
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object' || !nonEmpty(item.id)) fail(`${kind}_MALFORMED`);
    if (ids.has(item.id)) fail(`DUPLICATE_ID:${item.id}`);
    ids.add(item.id);
  }
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

/** Parse and validate exact counts, rows, IDs, revision binding, and content. */
export function parseLandscapeIrrigationSchedule(text, expected = {}) {
  if (typeof text !== 'string' || text.length === 0) fail('EMPTY');
  let artifact;
  try { artifact = JSON.parse(text); } catch { fail('MALFORMED_JSON'); }
  if (canonical(artifact) !== text) fail('NON_CANONICAL');
  if (!artifact || typeof artifact !== 'object' || artifact.schema !== 'nexyfab.landscape-irrigation-schedule.v1' || artifact.capabilityId !== CAPABILITY_ID || artifact.format !== 'schedule') fail('HEADER');
  if (!nonEmpty(artifact.workspaceRevisionId) || !SHA256.test(artifact.workspaceContentHash)) fail('REVISION_BINDING');
  if (expected.workspaceRevisionId !== undefined && artifact.workspaceRevisionId !== expected.workspaceRevisionId) fail('REVISION_MISMATCH');
  if (expected.workspaceContentHash !== undefined && artifact.workspaceContentHash !== expected.workspaceContentHash) fail('CONTENT_HASH_MISMATCH');
  if (!Number.isSafeInteger(artifact.sourceDocumentRevision) || artifact.sourceDocumentRevision < 0) fail('SOURCE_REVISION');
  const nodes = stable(array(artifact.nodes, 'NODES'), 'NODE');
  const pipes = stable(array(artifact.pipes, 'PIPES'), 'PIPE');
  const zones = stable(array(artifact.zones, 'ZONES'), 'ZONE');
  const allIds = new Set();
  for (const [kind, items] of [['node', nodes], ['pipe', pipes], ['zone', zones]]) {
    for (const item of items) {
      if (allIds.has(item.id)) fail(`DUPLICATE_ID:${item.id}`);
      allIds.add(item.id);
      const nodeMalformed = !['source', 'valve', 'emitter'].includes(item.kind)
        || !Array.isArray(item.positionM) || item.positionM.length !== 3 || !item.positionM.every(finite)
        || (item.pressureKpa !== undefined && !positive(item.pressureKpa))
        || (item.flowLpm !== undefined && !positive(item.flowLpm))
        || (item.kind === 'source' && (!positive(item.pressureKpa) || !positive(item.flowLpm)));
      const pipeMalformed = !nonEmpty(item.fromNodeId) || !nonEmpty(item.toNodeId) || item.fromNodeId === item.toNodeId || !positive(item.diameterMm) || !positive(item.lengthM);
      const zoneMalformed = !nonEmpty(item.valveNodeId) || !Array.isArray(item.emitterNodeIds) || item.emitterNodeIds.length === 0 || !Array.isArray(item.plantingZoneIds) || item.plantingZoneIds.some((id) => !nonEmpty(id)) || !positive(item.designFlowLpm);
      if (kind === 'node' && nodeMalformed) fail(`NODE_MALFORMED:${item.id}`);
      if (kind === 'pipe' && pipeMalformed) fail(`PIPE_MALFORMED:${item.id}`);
      if (kind === 'zone' && zoneMalformed) fail(`ZONE_MALFORMED:${item.id}`);
    }
  }
  const nodeById = new Map(nodes.map((item) => [item.id, item]));
  for (const pipe of pipes) {
    if (!nodeById.has(pipe.fromNodeId) || !nodeById.has(pipe.toNodeId)) fail(`PIPE_ENDPOINT_MISMATCH:${pipe.id}`);
  }
  const valveIds = new Set(nodes.filter((node) => node.kind === 'valve').map((node) => node.id));
  const emitterIds = new Set(nodes.filter((node) => node.kind === 'emitter').map((node) => node.id));
  for (const zone of zones) {
    if (!valveIds.has(zone.valveNodeId) || zone.emitterNodeIds.some((id) => !emitterIds.has(id))) fail(`ZONE_REFERENCE_MISMATCH:${zone.id}`);
    if (new Set(zone.emitterNodeIds).size !== zone.emitterNodeIds.length || new Set(zone.plantingZoneIds).size !== zone.plantingZoneIds.length) fail(`ZONE_DUPLICATE_MEMBER:${zone.id}`);
  }
  const rows = array(artifact.rows, 'ROWS');
  const rowIds = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !nonEmpty(row.id) || !['irrigationNode', 'irrigationPipe', 'irrigationZone'].includes(row.objectType) || !row.value || row.value.id !== row.id) fail('ROW_MALFORMED');
    const key = `${row.objectType}:${row.id}`;
    if (rowIds.has(key)) fail(`DUPLICATE_ROW_ID:${key}`);
    rowIds.add(key);
  }
  const expectedRows = [
    ...nodes.map((value) => ({ objectType: 'irrigationNode', id: value.id, value })),
    ...pipes.map((value) => ({ objectType: 'irrigationPipe', id: value.id, value })),
    ...zones.map((value) => ({ objectType: 'irrigationZone', id: value.id, value })),
  ];
  if (!same(rows, expectedRows)) fail('ROWS_CONTENT_MISMATCH');
  const expectedStableIds = { nodes: nodes.map((item) => item.id), pipes: pipes.map((item) => item.id), zones: zones.map((item) => item.id), rows: rows.map((item) => `${item.objectType}:${item.id}`) };
  if (!same(artifact.stableIds, expectedStableIds)) fail('STABLE_IDS_MISMATCH');
  const expectedCounts = { nodeCount: nodes.length, pipeCount: pipes.length, zoneCount: zones.length, rowCount: rows.length, objectCount: rows.length };
  if (!same(artifact.counts, expectedCounts)) fail('COUNTS_MISMATCH');
  if (artifact.hydraulicEvidence !== 'NOT_RUN' || artifact.externalInteroperability !== 'HOLD' || artifact.fieldEvidence !== 'NOT_RUN' || artifact.releaseReady !== false) fail('RELEASE_TRUTH');
  return { artifact, parsedRowCount: rows.length, parsedObjectCount: rows.length, stableIds: expectedStableIds };
}

export { CAPABILITY_ID };
