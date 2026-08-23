/** Deterministic internal JSON exporter for architecture/interior finish rows. */
import { createHash } from 'node:crypto';
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CAPABILITY_ID = 'interior.finish.schedule';
const fail = (reason) => { throw new Error(`INTERIOR_FINISH_SCHEDULE_EXPORT_INVALID:${reason}`); };
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value); return encoded === undefined ? 'null' : encoded;
};
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const array = (value, name) => { if (!Array.isArray(value)) fail(`${name}_MISSING`); return value; };
const object = (value, name) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name}_MALFORMED`); return value; };
const register = (set, value, name) => { if (!nonEmpty(value) || !ID.test(value)) fail(`${name}_ID`); if (set.has(value)) fail(`DUPLICATE_ID:${value}`); set.add(value); };

function validateWorkspace(workspace, options) {
  const architecture = object(workspace?.architecture, 'ARCHITECTURE');
  const interior = object(workspace?.interior, 'INTERIOR');
  if (architecture.schema !== 'nexyfab.architecture.v1' || !Number.isSafeInteger(architecture.revision) || architecture.revision < 0) fail('ARCHITECTURE_HEADER');
  if (interior.schema !== 'nexyfab.interior.v1' || !Number.isSafeInteger(interior.revision) || interior.revision < 0 || !nonEmpty(interior.architectureDocumentId)) fail('INTERIOR_HEADER');
  if (!nonEmpty(options?.workspaceRevisionId) || !SHA256.test(options?.workspaceContentHash ?? '') || !SHA256.test(options?.architectureContentHash ?? '') || !SHA256.test(options?.interiorContentHash ?? '')) fail('REVISION_BINDING');
  if (options.architectureRevision !== architecture.revision || options.interiorRevision !== interior.revision) fail('REVISION_MISMATCH');
  if (options.architectureContentHash !== sha256(canonicalJson(architecture)) || options.interiorContentHash !== sha256(canonicalJson(interior)) || options.workspaceContentHash !== sha256(canonicalJson({ workspaceRevisionId: options.workspaceRevisionId, architecture, interior }))) fail('CONTENT_HASH_MISMATCH');
  const spaces = array(architecture.spaces, 'SPACES');
  const walls = array(architecture.walls, 'WALLS');
  const slabs = array(architecture.slabs, 'SLABS');
  const ceilings = array(architecture.ceilings, 'CEILINGS');
  const finishes = array(interior.finishes, 'FINISHES');
  const spaceIds = new Set();
  const wallIds = new Set();
  const slabIds = new Set();
  const ceilingIds = new Set();
  for (const wall of walls) register(wallIds, wall?.id, 'WALL');
  for (const slab of slabs) { register(slabIds, slab?.id, 'SLAB'); if (!nonEmpty(slab.spaceId)) fail(`SLAB_SPACE:${slab?.id ?? ''}`); }
  for (const ceiling of ceilings) { register(ceilingIds, ceiling?.id, 'CEILING'); if (!nonEmpty(ceiling.spaceId)) fail(`CEILING_SPACE:${ceiling?.id ?? ''}`); }
  const spaceById = new Map();
  for (const space of spaces) {
    register(spaceIds, space?.id, 'SPACE');
    if (!Array.isArray(space.wallIds) || !nonEmpty(space.slabId) || !nonEmpty(space.ceilingId)) fail(`SPACE_HOSTS:${space.id}`);
    if (space.wallIds.some((id) => !ID.test(id) || !wallIds.has(id)) || !slabIds.has(space.slabId) || !ceilingIds.has(space.ceilingId)) fail(`SPACE_HOST_REFERENCE:${space.id}`);
    const slab = slabs.find((item) => item.id === space.slabId);
    const ceiling = ceilings.find((item) => item.id === space.ceilingId);
    if (slab?.spaceId !== space.id || ceiling?.spaceId !== space.id) fail(`SPACE_HOST_ASSOCIATION:${space.id}`);
    spaceById.set(space.id, space);
  }
  const finishIds = new Set();
  for (const finish of finishes) {
    register(finishIds, finish?.id, 'FINISH');
    if (!spaceById.has(finish.spaceId) || !ID.test(finish.hostId ?? '') || !['floor', 'wall', 'ceiling'].includes(finish.surface) || !nonEmpty(finish.material)) fail(`FINISH_MALFORMED:${finish.id}`);
    const space = spaceById.get(finish.spaceId);
    const hostExists = finish.surface === 'floor' ? space.slabId === finish.hostId && slabIds.has(finish.hostId)
      : finish.surface === 'ceiling' ? space.ceilingId === finish.hostId && ceilingIds.has(finish.hostId)
        : space.wallIds.includes(finish.hostId) && wallIds.has(finish.hostId);
    if (!hostExists) fail(`FINISH_HOST_ASSOCIATION:${finish.id}`);
  }
  return { architecture, interior, spaces, finishes, spaceIds, finishIds };
}

export function exportInteriorFinishSchedule(workspace, options) {
  const { architecture, interior, spaces, finishes, spaceIds, finishIds } = validateWorkspace(workspace, options);
  const sorted = (items) => items.map((item) => structuredClone(item)).sort((a, b) => a.id.localeCompare(b.id));
  const normalized = sorted(finishes).map((finish) => ({ id: finish.id, spaceId: finish.spaceId, hostId: finish.hostId, finishKind: finish.surface, surface: finish.surface, material: finish.material, quantity: 1 }));
  const rows = normalized.map((value) => structuredClone(value));
  return canonicalJson({
    schema: 'nexyfab.interior-finish-schedule.v1', capabilityId: CAPABILITY_ID, format: 'schedule',
    workspaceRevisionId: options.workspaceRevisionId, workspaceContentHash: options.workspaceContentHash,
    architectureRevision: architecture.revision, architectureContentHash: options.architectureContentHash,
    interiorRevision: interior.revision, interiorContentHash: options.interiorContentHash,
    spaces: sorted(spaces).map((space) => ({ id: space.id, wallIds: [...space.wallIds].sort((a, b) => a.localeCompare(b)), slabId: space.slabId, ceilingId: space.ceilingId })), finishes: normalized, rows,
    counts: { spaceCount: spaces.length, finishCount: normalized.length, rowCount: rows.length, objectCount: rows.length },
    stableIds: { spaces: [...spaceIds].sort((a, b) => a.localeCompare(b)), finishes: [...finishIds].sort((a, b) => a.localeCompare(b)), rows: rows.map((row) => row.id) },
    nativeInteroperability: 'HOLD', externalCatalogProvenance: 'HOLD', boqEvidence: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false,
  });
}

export { CAPABILITY_ID, canonicalJson };
