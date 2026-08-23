/** Deterministic internal landscape planting schedule exporter. */

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CAPABILITY_ID = 'landscape.planting.schedule.internal';
const fail = (reason) => { throw new Error(`LANDSCAPE_PLANTING_SCHEDULE_EXPORT_INVALID:${reason}`); };
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value); return encoded === undefined ? 'null' : encoded;
};
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const array = (value, name) => { if (!Array.isArray(value)) fail(`${name}_MISSING`); return value; };
const keys = (value, expected, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name}_MALFORMED`);
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== [...expected].sort()[index])) fail(`${name}_UNKNOWN_KEY`);
};
const point = (value, length, name) => {
  if (!Array.isArray(value) || value.length !== length || !value.every(finite)) fail(`${name}_GEOMETRY`);
};
const boundary = (value, name) => {
  if (!Array.isArray(value) || value.length < 3) fail(`${name}_BOUNDARY`);
  value.forEach((item) => point(item, 2, name));
  const area2 = value.reduce((sum, item, index) => { const next = value[(index + 1) % value.length]; return sum + item[0] * next[1] - next[0] * item[1]; }, 0);
  if (Math.abs(area2) <= 1e-12) fail(`${name}_BOUNDARY_DEGENERATE`);
};

function validateDocument(document, options) {
  if (!document || typeof document !== 'object' || document.schema !== 'nexyfab.landscape.v1') fail('DOCUMENT_SCHEMA');
  if (!Number.isSafeInteger(document.revision) || document.revision < 0) fail('DOCUMENT_REVISION');
  if (!nonEmpty(document.coordinateSystemId)) fail('COORDINATE_SYSTEM');
  if (!nonEmpty(options?.workspaceRevisionId)) fail('WORKSPACE_REVISION_ID');
  if (!SHA256.test(options?.workspaceContentHash ?? '')) fail('WORKSPACE_CONTENT_HASH');
  const plants = array(document.plants, 'PLANTS');
  const plantingZones = array(document.plantingZones, 'PLANTING_ZONES');
  const soilVolumes = array(document.soilVolumes, 'SOIL_VOLUMES');
  const allIds = new Set();
  const register = (item, kind) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !ID.test(item.id)) fail(`${kind}_ID`);
    if (allIds.has(item.id)) fail(`DUPLICATE_ID:${item.id}`);
    allIds.add(item.id);
  };
  plants.forEach((plant) => {
    keys(plant, ['id', 'speciesCode', 'positionM', 'installedHeightM', 'matureCanopyDiameterM', 'rootZoneDiameterM', 'spacingM', 'evidenceIds'], 'PLANT');
    register(plant, 'PLANT');
    if (!nonEmpty(plant.speciesCode) || !Array.isArray(plant.evidenceIds) || plant.evidenceIds.some((id) => typeof id !== 'string' || !nonEmpty(id) || !ID.test(id)) || new Set(plant.evidenceIds).size !== plant.evidenceIds.length) fail(`PLANT_MALFORMED:${plant.id}`);
    point(plant.positionM, 3, `PLANT:${plant.id}`);
    for (const [field, value] of [['installedHeightM', plant.installedHeightM], ['matureCanopyDiameterM', plant.matureCanopyDiameterM], ['rootZoneDiameterM', plant.rootZoneDiameterM], ['spacingM', plant.spacingM]]) if (!positive(value)) fail(`PLANT_${field.toUpperCase()}:${plant.id}`);
  });
  plantingZones.forEach((zone) => {
    keys(zone, ['id', 'boundaryM', 'plantIds', 'soilVolumeId', 'targetCoveragePercent'], 'PLANTING_ZONE');
    register(zone, 'PLANTING_ZONE');
    boundary(zone.boundaryM, `PLANTING_ZONE:${zone.id}`);
    if (!Array.isArray(zone.plantIds) || zone.plantIds.length === 0 || zone.plantIds.some((id) => typeof id !== 'string' || !ID.test(id)) || new Set(zone.plantIds).size !== zone.plantIds.length || typeof zone.soilVolumeId !== 'string' || !ID.test(zone.soilVolumeId) || !finite(zone.targetCoveragePercent) || zone.targetCoveragePercent < 0 || zone.targetCoveragePercent > 100) fail(`PLANTING_ZONE_MALFORMED:${zone.id}`);
  });
  soilVolumes.forEach((soil) => {
    keys(soil, ['id', 'boundaryM', 'depthM', 'soilType', 'drainageClass'], 'SOIL');
    register(soil, 'SOIL');
    boundary(soil.boundaryM, `SOIL:${soil.id}`);
    if (!positive(soil.depthM) || !nonEmpty(soil.soilType) || !nonEmpty(soil.drainageClass)) fail(`SOIL_MALFORMED:${soil.id}`);
  });
  const plantIds = new Set(plants.map((item) => item.id));
  const soilIds = new Set(soilVolumes.map((item) => item.id));
  plantingZones.forEach((zone) => {
    if (zone.plantIds.some((id) => !plantIds.has(id)) || !soilIds.has(zone.soilVolumeId)) fail(`PLANTING_ZONE_REFERENCE:${zone.id}`);
  });
  return { plants, plantingZones, soilVolumes };
}

export function exportLandscapePlantingSchedule(document, options) {
  const { plants, plantingZones, soilVolumes } = validateDocument(document, options);
  const sorted = (items) => items.map((item) => structuredClone(item)).sort((a, b) => a.id.localeCompare(b.id));
  const normalizedPlants = sorted(plants).map((plant) => ({ ...plant, quantity: 1 }));
  const normalizedZones = sorted(plantingZones);
  const normalizedSoils = sorted(soilVolumes);
  const rows = [
    ...normalizedPlants.map((value) => ({ objectType: 'plant', id: value.id, value })),
    ...normalizedZones.map((value) => ({ objectType: 'plantingZone', id: value.id, value })),
    ...normalizedSoils.map((value) => ({ objectType: 'soilVolume', id: value.id, value })),
  ];
  return canonicalJson({
    schema: 'nexyfab.landscape-planting-schedule.v1', capabilityId: CAPABILITY_ID, format: 'schedule',
    workspaceRevisionId: options.workspaceRevisionId, workspaceContentHash: options.workspaceContentHash,
    sourceDocumentRevision: document.revision, coordinateSystemId: document.coordinateSystemId,
    plants: normalizedPlants, plantingZones: normalizedZones, soilVolumes: normalizedSoils, rows,
    counts: { plantCount: normalizedPlants.length, plantingZoneCount: normalizedZones.length, soilVolumeCount: normalizedSoils.length, rowCount: rows.length, objectCount: rows.length },
    stableIds: { plants: normalizedPlants.map((item) => item.id), plantingZones: normalizedZones.map((item) => item.id), soilVolumes: normalizedSoils.map((item) => item.id), rows: rows.map((item) => `${item.objectType}:${item.id}`) },
    plantCatalogProvenance: 'HOLD', nativeRoundtrip: 'HOLD', externalInteroperability: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false,
  });
}

export { CAPABILITY_ID, canonicalJson };
