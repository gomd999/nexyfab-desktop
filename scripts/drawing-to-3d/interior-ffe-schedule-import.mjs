/** Independent strict parser for the internal architecture/interior FF&E schedule. */
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CAPABILITY_ID = 'interior.ffe.schedule';
const fail = (reason) => { throw new Error(`INTERIOR_FFE_SCHEDULE_PARSE_INVALID:${reason}`); };
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
const sortedIds = (items, name) => {
  const ids = [];
  for (const item of items) { safeId(item.id, name); if (ids.includes(item.id)) fail(`DUPLICATE_ID:${item.id}`); ids.push(item.id); }
  if (ids.some((id, index) => index > 0 && ids[index - 1].localeCompare(id) > 0)) fail(`${name}_UNSORTED`);
  return ids;
};
const decode = (input) => {
  if (!(input instanceof Uint8Array)) fail('INPUT_TYPE');
  let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(input); } catch { fail('UTF8_INVALID'); }
  const bytes = new TextEncoder().encode(text);
  if (bytes.length !== input.length || bytes.some((item, index) => item !== input[index])) fail('UTF8_NON_CANONICAL');
  return text;
};
const vector = (value, name, positive) => {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item) || (positive && item <= 0))) fail(`${name}_GEOMETRY`);
};
const validateFurniture = (item) => {
  keys(item, ['id', 'spaceId', 'positionMm', 'sizeMm', 'clearanceMm', 'rotationDeg', 'quantity'], 'FURNITURE');
  safeId(item.spaceId, 'FURNITURE_SPACE'); vector(item.positionMm, 'FURNITURE_POSITION', false); vector(item.sizeMm, 'FURNITURE_SIZE', true);
  if (typeof item.clearanceMm !== 'number' || !Number.isFinite(item.clearanceMm) || item.clearanceMm < 0) fail(`FURNITURE_CLEARANCE:${item.id}`);
  if (typeof item.rotationDeg !== 'number' || !Number.isFinite(item.rotationDeg)) fail(`FURNITURE_ROTATION:${item.id}`);
  if (item.quantity !== 1) fail(`FURNITURE_QUANTITY:${item.id}`);
};

export function parseInteriorFfeSchedule(input, expected = {}) {
  const text = decode(input); if (!text) fail('EMPTY');
  let artifact; try { artifact = JSON.parse(text); } catch { fail('MALFORMED_JSON'); }
  if (canonical(artifact) !== text) fail('NON_CANONICAL');
  keys(artifact, ['schema', 'capabilityId', 'format', 'workspaceRevisionId', 'workspaceContentHash', 'architectureRevision', 'architectureContentHash', 'interiorRevision', 'interiorContentHash', 'spaces', 'furniture', 'rows', 'counts', 'stableIds', 'nativeInteroperability', 'externalCatalogProvenance', 'priceEvidence', 'boqEvidence', 'fieldEvidence', 'releaseReady'], 'ARTIFACT');
  if (artifact.schema !== 'nexyfab.interior-ffe-schedule.v1' || artifact.capabilityId !== CAPABILITY_ID || artifact.format !== 'schedule' || !nonEmpty(artifact.workspaceRevisionId) || !SHA256.test(artifact.workspaceContentHash) || !SHA256.test(artifact.architectureContentHash) || !SHA256.test(artifact.interiorContentHash) || !Number.isSafeInteger(artifact.architectureRevision) || artifact.architectureRevision < 0 || !Number.isSafeInteger(artifact.interiorRevision) || artifact.interiorRevision < 0) fail('HEADER');
  if (expected.workspaceRevisionId !== undefined && artifact.workspaceRevisionId !== expected.workspaceRevisionId) fail('REVISION_MISMATCH');
  if (expected.workspaceContentHash !== undefined && artifact.workspaceContentHash !== expected.workspaceContentHash) fail('CONTENT_HASH_MISMATCH');
  if (expected.architectureRevision !== undefined && artifact.architectureRevision !== expected.architectureRevision) fail('ARCHITECTURE_REVISION_MISMATCH');
  if (expected.architectureContentHash !== undefined && artifact.architectureContentHash !== expected.architectureContentHash) fail('ARCHITECTURE_CONTENT_HASH_MISMATCH');
  if (expected.interiorRevision !== undefined && artifact.interiorRevision !== expected.interiorRevision) fail('INTERIOR_REVISION_MISMATCH');
  if (expected.interiorContentHash !== undefined && artifact.interiorContentHash !== expected.interiorContentHash) fail('INTERIOR_CONTENT_HASH_MISMATCH');
  const spaces = array(artifact.spaces, 'SPACES');
  spaces.forEach((space) => keys(space, ['id'], 'SPACE'));
  const spaceIds = sortedIds(spaces, 'SPACE');
  const furniture = array(artifact.furniture, 'FURNITURE');
  const furnitureIds = sortedIds(furniture, 'FURNITURE');
  furniture.forEach(validateFurniture);
  for (const item of furniture) if (!spaceIds.includes(item.spaceId)) fail(`FURNITURE_HOST_SPACE:${item.id}`);
  const rows = array(artifact.rows, 'ROWS');
  if (!same(rows, furniture)) fail('ROWS_CONTENT_MISMATCH');
  const rowIds = sortedIds(rows, 'ROW');
  const stableIds = { spaces: spaceIds, furniture: furnitureIds, rows: rowIds };
  keys(artifact.stableIds, ['spaces', 'furniture', 'rows'], 'STABLE_IDS');
  if (!same(artifact.stableIds, stableIds) || rowIds.length !== furnitureIds.length) fail('STABLE_IDS_MISMATCH');
  const counts = { spaceCount: spaces.length, furnitureCount: furniture.length, rowCount: rows.length, objectCount: rows.length };
  keys(artifact.counts, ['spaceCount', 'furnitureCount', 'rowCount', 'objectCount'], 'COUNTS');
  if (!same(artifact.counts, counts) || Object.values(counts).some((value) => !Number.isSafeInteger(value) || value < 0)) fail('COUNTS_MISMATCH');
  if (artifact.nativeInteroperability !== 'HOLD' || artifact.externalCatalogProvenance !== 'HOLD' || artifact.priceEvidence !== 'HOLD' || artifact.boqEvidence !== 'HOLD' || artifact.fieldEvidence !== 'NOT_RUN' || artifact.releaseReady !== false) fail('RELEASE_TRUTH');
  return { artifact, parsedRowCount: rows.length, parsedObjectCount: rows.length, stableIds };
}

export { CAPABILITY_ID, canonical };
