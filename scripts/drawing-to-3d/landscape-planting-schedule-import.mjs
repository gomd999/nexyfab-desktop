/** Independent strict parser for the internal landscape planting schedule. */

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CAPABILITY_ID = 'landscape.planting.schedule.internal';
const fail = (reason) => { throw new Error(`LANDSCAPE_PLANTING_SCHEDULE_PARSE_INVALID:${reason}`); };
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value); return encoded === undefined ? 'null' : encoded;
};
const same = (left, right) => canonical(left) === canonical(right);
const keys = (value, expected, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name}_MALFORMED`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) fail(`${name}_UNKNOWN_KEY`);
};
const array = (value, name) => { if (!Array.isArray(value)) fail(`${name}_MISSING`); return value; };
const point = (value, length, name) => { if (!Array.isArray(value) || value.length !== length || !value.every(finite)) fail(`${name}_GEOMETRY`); };
const boundary = (value, name) => {
  if (!Array.isArray(value) || value.length < 3) fail(`${name}_BOUNDARY`);
  value.forEach((item) => point(item, 2, name));
  const area2 = value.reduce((sum, item, index) => { const next = value[(index + 1) % value.length]; return sum + item[0] * next[1] - next[0] * item[1]; }, 0);
  if (Math.abs(area2) <= 1e-12) fail(`${name}_BOUNDARY_DEGENERATE`);
};
const decode = (input) => {
  if (typeof input === 'string') { if (input.includes('\uFFFD')) fail('UTF8_INVALID'); return input; }
  if (!(input instanceof Uint8Array)) fail('INPUT_TYPE');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(input); } catch { fail('UTF8_INVALID'); }
  const roundtrip = new TextEncoder().encode(text);
  if (roundtrip.length !== input.length || roundtrip.some((value, index) => value !== input[index])) fail('UTF8_NON_CANONICAL');
  return text;
};

function stable(items, kind) {
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !ID.test(item.id)) fail(`${kind}_ID`);
    if (ids.has(item.id)) fail(`DUPLICATE_ID:${item.id}`);
    ids.add(item.id);
  }
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function validatePlant(plant) {
  keys(plant, ['id', 'speciesCode', 'positionM', 'installedHeightM', 'matureCanopyDiameterM', 'rootZoneDiameterM', 'spacingM', 'evidenceIds', 'quantity'], 'PLANT');
  if (!nonEmpty(plant.speciesCode) || !Number.isSafeInteger(plant.quantity) || plant.quantity <= 0 || !Array.isArray(plant.evidenceIds) || plant.evidenceIds.some((id) => typeof id !== 'string' || !ID.test(id)) || new Set(plant.evidenceIds).size !== plant.evidenceIds.length) fail(`PLANT_MALFORMED:${plant.id}`);
  point(plant.positionM, 3, `PLANT:${plant.id}`);
  for (const [field, value] of [['installedHeightM', plant.installedHeightM], ['matureCanopyDiameterM', plant.matureCanopyDiameterM], ['rootZoneDiameterM', plant.rootZoneDiameterM], ['spacingM', plant.spacingM]]) if (!positive(value)) fail(`PLANT_${field.toUpperCase()}:${plant.id}`);
}
function validateZone(zone) {
  keys(zone, ['id', 'boundaryM', 'plantIds', 'soilVolumeId', 'targetCoveragePercent'], 'PLANTING_ZONE');
  boundary(zone.boundaryM, `PLANTING_ZONE:${zone.id}`);
  if (!Array.isArray(zone.plantIds) || zone.plantIds.length === 0 || zone.plantIds.some((id) => typeof id !== 'string' || !ID.test(id)) || new Set(zone.plantIds).size !== zone.plantIds.length || typeof zone.soilVolumeId !== 'string' || !ID.test(zone.soilVolumeId) || !finite(zone.targetCoveragePercent) || zone.targetCoveragePercent < 0 || zone.targetCoveragePercent > 100) fail(`PLANTING_ZONE_MALFORMED:${zone.id}`);
}
function validateSoil(soil) {
  keys(soil, ['id', 'boundaryM', 'depthM', 'soilType', 'drainageClass'], 'SOIL');
  boundary(soil.boundaryM, `SOIL:${soil.id}`);
  if (!positive(soil.depthM) || !nonEmpty(soil.soilType) || !nonEmpty(soil.drainageClass)) fail(`SOIL_MALFORMED:${soil.id}`);
}

export function parseLandscapePlantingSchedule(input, expected = {}) {
  const text = decode(input);
  if (text.length === 0) fail('EMPTY');
  let artifact;
  try { artifact = JSON.parse(text); } catch { fail('MALFORMED_JSON'); }
  if (canonical(artifact) !== text) fail('NON_CANONICAL');
  keys(artifact, ['schema', 'capabilityId', 'format', 'workspaceRevisionId', 'workspaceContentHash', 'sourceDocumentRevision', 'coordinateSystemId', 'plants', 'plantingZones', 'soilVolumes', 'rows', 'counts', 'stableIds', 'plantCatalogProvenance', 'nativeRoundtrip', 'externalInteroperability', 'fieldEvidence', 'releaseReady'], 'ARTIFACT');
  if (artifact.schema !== 'nexyfab.landscape-planting-schedule.v1' || artifact.capabilityId !== CAPABILITY_ID || artifact.format !== 'schedule') fail('HEADER');
  if (!nonEmpty(artifact.workspaceRevisionId) || !SHA256.test(artifact.workspaceContentHash) || !nonEmpty(artifact.coordinateSystemId)) fail('REVISION_BINDING');
  if (expected.workspaceRevisionId !== undefined && artifact.workspaceRevisionId !== expected.workspaceRevisionId) fail('REVISION_MISMATCH');
  if (expected.workspaceContentHash !== undefined && artifact.workspaceContentHash !== expected.workspaceContentHash) fail('CONTENT_HASH_MISMATCH');
  if (!Number.isSafeInteger(artifact.sourceDocumentRevision) || artifact.sourceDocumentRevision < 0) fail('SOURCE_REVISION');
  const plants = stable(array(artifact.plants, 'PLANTS'), 'PLANT');
  const plantingZones = stable(array(artifact.plantingZones, 'PLANTING_ZONES'), 'PLANTING_ZONE');
  const soilVolumes = stable(array(artifact.soilVolumes, 'SOILS'), 'SOIL');
  const globalIds = new Set();
  for (const [items, validator] of [[plants, validatePlant], [plantingZones, validateZone], [soilVolumes, validateSoil]]) {
    for (const item of items) { if (globalIds.has(item.id)) fail(`DUPLICATE_ID:${item.id}`); globalIds.add(item.id); validator(item); }
  }
  const plantIds = new Set(plants.map((item) => item.id));
  const soilIds = new Set(soilVolumes.map((item) => item.id));
  for (const zone of plantingZones) if (zone.plantIds.some((id) => !plantIds.has(id)) || !soilIds.has(zone.soilVolumeId)) fail(`PLANTING_ZONE_REFERENCE:${zone.id}`);
  const rows = array(artifact.rows, 'ROWS');
  const rowIds = new Set();
  for (const row of rows) {
    keys(row, ['objectType', 'id', 'value'], 'ROW');
    if (!['plant', 'plantingZone', 'soilVolume'].includes(row.objectType) || typeof row.id !== 'string' || !ID.test(row.id) || !row.value || row.value.id !== row.id) fail('ROW_MALFORMED');
    const key = `${row.objectType}:${row.id}`;
    if (rowIds.has(key)) fail(`DUPLICATE_ROW_ID:${key}`);
    rowIds.add(key);
  }
  const expectedRows = [...plants.map((value) => ({ objectType: 'plant', id: value.id, value })), ...plantingZones.map((value) => ({ objectType: 'plantingZone', id: value.id, value })), ...soilVolumes.map((value) => ({ objectType: 'soilVolume', id: value.id, value }))];
  if (!same(rows, expectedRows)) fail('ROWS_CONTENT_MISMATCH');
  const stableIds = { plants: plants.map((item) => item.id), plantingZones: plantingZones.map((item) => item.id), soilVolumes: soilVolumes.map((item) => item.id), rows: rows.map((item) => `${item.objectType}:${item.id}`) };
  if (!same(artifact.stableIds, stableIds)) fail('STABLE_IDS_MISMATCH');
  const counts = { plantCount: plants.length, plantingZoneCount: plantingZones.length, soilVolumeCount: soilVolumes.length, rowCount: rows.length, objectCount: rows.length };
  if (!same(artifact.counts, counts)) fail('COUNTS_MISMATCH');
  if (artifact.plantCatalogProvenance !== 'HOLD' || artifact.nativeRoundtrip !== 'HOLD' || artifact.externalInteroperability !== 'HOLD' || artifact.fieldEvidence !== 'NOT_RUN' || artifact.releaseReady !== false) fail('RELEASE_TRUTH');
  return { artifact, parsedRowCount: rows.length, parsedObjectCount: rows.length, stableIds };
}

export { CAPABILITY_ID, canonical };
