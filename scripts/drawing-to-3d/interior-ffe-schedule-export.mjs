/** Deterministic internal JSON exporter for architecture-hosted interior FF&E rows. */
import { createHash } from 'node:crypto';

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CAPABILITY_ID = 'interior.ffe.schedule';
const fail = (reason) => { throw new Error(`INTERIOR_FFE_SCHEDULE_EXPORT_INVALID:${reason}`); };
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value); return encoded === undefined ? 'null' : encoded;
};
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const object = (value, name) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name}_MALFORMED`); return value; };
const array = (value, name) => { if (!Array.isArray(value)) fail(`${name}_MISSING`); return value; };
const register = (set, value, name) => { if (!nonEmpty(value) || !ID.test(value)) fail(`${name}_ID`); if (set.has(value)) fail(`DUPLICATE_ID:${value}`); set.add(value); };
const finiteVector = (value, length, name) => {
  if (!Array.isArray(value) || value.length !== length || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) fail(`${name}_GEOMETRY`);
};

function validateWorkspace(workspace, options) {
  const architecture = object(workspace?.architecture, 'ARCHITECTURE');
  const interior = object(workspace?.interior, 'INTERIOR');
  if (architecture.schema !== 'nexyfab.architecture.v1' || !Number.isSafeInteger(architecture.revision) || architecture.revision < 0) fail('ARCHITECTURE_HEADER');
  if (interior.schema !== 'nexyfab.interior.v1' || !Number.isSafeInteger(interior.revision) || interior.revision < 0 || !nonEmpty(interior.architectureDocumentId)) fail('INTERIOR_HEADER');
  if (!nonEmpty(options?.workspaceRevisionId) || !SHA256.test(options?.workspaceContentHash ?? '') || !SHA256.test(options?.architectureContentHash ?? '') || !SHA256.test(options?.interiorContentHash ?? '')) fail('REVISION_BINDING');
  if (options.architectureRevision !== architecture.revision || options.interiorRevision !== interior.revision) fail('REVISION_MISMATCH');
  if (options.architectureContentHash !== sha256(canonicalJson(architecture)) || options.interiorContentHash !== sha256(canonicalJson(interior)) || options.workspaceContentHash !== sha256(canonicalJson({ workspaceRevisionId: options.workspaceRevisionId, architecture, interior }))) fail('CONTENT_HASH_MISMATCH');
  const spaces = array(architecture.spaces, 'SPACES');
  const spaceIds = new Set();
  for (const space of spaces) {
    register(spaceIds, space?.id, 'SPACE');
    if (!Array.isArray(space.wallIds) || !nonEmpty(space.slabId) || !nonEmpty(space.ceilingId)) fail(`SPACE_HOSTS:${space?.id ?? ''}`);
  }
  const furniture = array(interior.furniture, 'FURNITURE');
  const furnitureIds = new Set();
  for (const item of furniture) {
    register(furnitureIds, item?.id, 'FURNITURE');
    if (!spaceIds.has(item?.spaceId)) fail(`FURNITURE_HOST_SPACE:${item?.id ?? ''}`);
    finiteVector(item?.positionMm, 3, `FURNITURE_POSITION:${item.id}`);
    finiteVector(item?.sizeMm, 3, `FURNITURE_SIZE:${item.id}`);
    if (item.sizeMm.some((value) => value <= 0)) fail(`FURNITURE_SIZE_POSITIVE:${item.id}`);
    if (typeof item.clearanceMm !== 'number' || !Number.isFinite(item.clearanceMm) || item.clearanceMm < 0) fail(`FURNITURE_CLEARANCE:${item.id}`);
    if (typeof (item.rotationDeg ?? 0) !== 'number' || !Number.isFinite(item.rotationDeg ?? 0)) fail(`FURNITURE_ROTATION:${item.id}`);
  }
  return { architecture, interior, spaces, furniture, spaceIds, furnitureIds };
}

export function exportInteriorFfeSchedule(workspace, options) {
  const { architecture, interior, spaces, furniture, spaceIds, furnitureIds } = validateWorkspace(workspace, options);
  const sorted = (items) => items.map((item) => structuredClone(item)).sort((a, b) => a.id.localeCompare(b.id));
  const normalized = sorted(furniture).map((item) => ({ id: item.id, spaceId: item.spaceId, positionMm: [...item.positionMm], sizeMm: [...item.sizeMm], clearanceMm: item.clearanceMm, rotationDeg: item.rotationDeg ?? 0, quantity: 1 }));
  const rows = normalized.map((item) => structuredClone(item));
  return canonicalJson({
    schema: 'nexyfab.interior-ffe-schedule.v1', capabilityId: CAPABILITY_ID, format: 'schedule',
    workspaceRevisionId: options.workspaceRevisionId, workspaceContentHash: options.workspaceContentHash,
    architectureRevision: architecture.revision, architectureContentHash: options.architectureContentHash,
    interiorRevision: interior.revision, interiorContentHash: options.interiorContentHash,
    spaces: sorted(spaces).map((space) => ({ id: space.id })), furniture: normalized, rows,
    counts: { spaceCount: spaces.length, furnitureCount: normalized.length, rowCount: rows.length, objectCount: rows.length },
    stableIds: { spaces: [...spaceIds].sort((a, b) => a.localeCompare(b)), furniture: [...furnitureIds].sort((a, b) => a.localeCompare(b)), rows: rows.map((row) => row.id) },
    nativeInteroperability: 'HOLD', externalCatalogProvenance: 'HOLD', priceEvidence: 'HOLD', boqEvidence: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false,
  });
}

export { CAPABILITY_ID, canonicalJson };
