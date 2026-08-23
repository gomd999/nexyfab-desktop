/** Independent strict parser for the internal architecture/interior finish schedule. */
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CAPABILITY_ID = 'interior.finish.schedule';
const fail = (reason) => { throw new Error(`INTERIOR_FINISH_SCHEDULE_PARSE_INVALID:${reason}`); };
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value); return encoded === undefined ? 'null' : encoded;
};
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const keys = (value, expected, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name}_MALFORMED`);
  const actual = Object.keys(value).sort(), wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(`${name}_UNKNOWN_KEY`);
};
const array = (value, name) => { if (!Array.isArray(value)) fail(`${name}_MISSING`); return value; };
const safeId = (value, name) => { if (!nonEmpty(value) || !ID.test(value)) fail(`${name}_ID`); };
const same = (a, b) => canonical(a) === canonical(b);
const decode = (input) => {
  if (typeof input === 'string') return input;
  if (!(input instanceof Uint8Array)) fail('INPUT_TYPE');
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(input); } catch { fail('UTF8_INVALID'); }
  const bytes = new TextEncoder().encode(text);
  if (bytes.length !== input.length || bytes.some((item, index) => item !== input[index])) fail('UTF8_NON_CANONICAL');
  return text;
};
const stable = (items, kind) => {
  const ids = new Set();
  for (const item of items) { keys(item, kind === 'SPACE' ? ['id', 'wallIds', 'slabId', 'ceilingId'] : ['id', 'spaceId', 'hostId', 'finishKind', 'surface', 'material', 'quantity'], kind); safeId(item.id, kind); if (ids.has(item.id)) fail(`DUPLICATE_ID:${item.id}`); ids.add(item.id); }
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
};
const validateSpace = (space) => {
  keys(space, ['id', 'wallIds', 'slabId', 'ceilingId'], 'SPACE'); safeId(space.id, 'SPACE');
  if (!Array.isArray(space.wallIds) || space.wallIds.length === 0 || space.wallIds.some((id) => !ID.test(id)) || new Set(space.wallIds).size !== space.wallIds.length) fail(`SPACE_HOSTS:${space.id}`);
  safeId(space.slabId, 'SPACE_SLAB'); safeId(space.ceilingId, 'SPACE_CEILING');
};
const validateFinish = (finish) => {
  safeId(finish.spaceId, 'FINISH_SPACE'); safeId(finish.hostId, 'FINISH_HOST');
  if (!['floor', 'wall', 'ceiling'].includes(finish.surface) || finish.finishKind !== finish.surface || !nonEmpty(finish.material) || !Number.isSafeInteger(finish.quantity) || finish.quantity <= 0) fail(`FINISH_MALFORMED:${finish.id}`);
};

export function parseInteriorFinishSchedule(input, expected = {}) {
  const text = decode(input); if (!text) fail('EMPTY');
  let artifact; try { artifact = JSON.parse(text); } catch { fail('MALFORMED_JSON'); }
  if (canonical(artifact) !== text) fail('NON_CANONICAL');
  keys(artifact, ['schema', 'capabilityId', 'format', 'workspaceRevisionId', 'workspaceContentHash', 'architectureRevision', 'architectureContentHash', 'interiorRevision', 'interiorContentHash', 'spaces', 'finishes', 'rows', 'counts', 'stableIds', 'nativeInteroperability', 'externalCatalogProvenance', 'boqEvidence', 'fieldEvidence', 'releaseReady'], 'ARTIFACT');
  if (artifact.schema !== 'nexyfab.interior-finish-schedule.v1' || artifact.capabilityId !== CAPABILITY_ID || artifact.format !== 'schedule' || !nonEmpty(artifact.workspaceRevisionId) || !SHA256.test(artifact.workspaceContentHash) || !SHA256.test(artifact.architectureContentHash) || !SHA256.test(artifact.interiorContentHash) || !Number.isSafeInteger(artifact.architectureRevision) || artifact.architectureRevision < 0 || !Number.isSafeInteger(artifact.interiorRevision) || artifact.interiorRevision < 0) fail('HEADER');
  if (expected.workspaceRevisionId !== undefined && artifact.workspaceRevisionId !== expected.workspaceRevisionId) fail('REVISION_MISMATCH');
  if (expected.workspaceContentHash !== undefined && artifact.workspaceContentHash !== expected.workspaceContentHash) fail('CONTENT_HASH_MISMATCH');
  if (expected.architectureRevision !== undefined && artifact.architectureRevision !== expected.architectureRevision) fail('ARCHITECTURE_REVISION_MISMATCH');
  if (expected.architectureContentHash !== undefined && artifact.architectureContentHash !== expected.architectureContentHash) fail('ARCHITECTURE_CONTENT_HASH_MISMATCH');
  if (expected.interiorRevision !== undefined && artifact.interiorRevision !== expected.interiorRevision) fail('INTERIOR_REVISION_MISMATCH');
  if (expected.interiorContentHash !== undefined && artifact.interiorContentHash !== expected.interiorContentHash) fail('INTERIOR_CONTENT_HASH_MISMATCH');
  const spaces = stable(array(artifact.spaces, 'SPACES'), 'SPACE');
  const finishes = stable(array(artifact.finishes, 'FINISHES'), 'FINISH');
  const rows = array(artifact.rows, 'ROWS');
  spaces.forEach(validateSpace);
  const spaceIds = spaces.map((item) => item.id), finishIds = finishes.map((item) => item.id);
  for (const finish of finishes) validateFinish(finish);
  for (const finish of finishes) {
    const space = spaces.find((item) => item.id === finish.spaceId);
    if (!space) fail(`MISSING_HOST_SPACE:${finish.id}`);
    const hostMatches = finish.surface === 'floor' ? finish.hostId === space.slabId : finish.surface === 'ceiling' ? finish.hostId === space.ceilingId : space.wallIds.includes(finish.hostId);
    if (!hostMatches) fail(`FINISH_HOST_ASSOCIATION:${finish.id}`);
  }
  if (!same(rows, finishes)) fail('ROWS_CONTENT_MISMATCH');
  const stableIds = { spaces: spaceIds, finishes: finishIds, rows: rows.map((item) => item.id) };
  keys(artifact.stableIds, ['spaces', 'finishes', 'rows'], 'STABLE_IDS');
  if (!same(artifact.stableIds, stableIds) || new Set(stableIds.spaces).size !== stableIds.spaces.length || new Set(stableIds.finishes).size !== stableIds.finishes.length || new Set(stableIds.rows).size !== stableIds.rows.length || stableIds.rows.length !== rows.length) fail('STABLE_IDS_MISMATCH');
  const counts = { spaceCount: spaces.length, finishCount: finishes.length, rowCount: rows.length, objectCount: rows.length };
  keys(artifact.counts, ['spaceCount', 'finishCount', 'rowCount', 'objectCount'], 'COUNTS');
  if (!same(artifact.counts, counts) || ![artifact.counts.spaceCount, artifact.counts.finishCount, artifact.counts.rowCount, artifact.counts.objectCount].every((value) => Number.isSafeInteger(value) && value >= 0)) fail('COUNTS_MISMATCH');
  if (artifact.nativeInteroperability !== 'HOLD' || artifact.externalCatalogProvenance !== 'HOLD' || artifact.boqEvidence !== 'HOLD' || artifact.fieldEvidence !== 'NOT_RUN' || artifact.releaseReady !== false) fail('RELEASE_TRUTH');
  return { artifact, parsedRowCount: rows.length, parsedObjectCount: rows.length, stableIds };
}

export { CAPABILITY_ID, canonical };
