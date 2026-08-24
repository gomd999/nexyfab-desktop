import {
  DESIGN_INTENT_INPUT_KINDS,
  createDesignIntentCheckpoint,
  mergeDesignIntentCheckpoints,
  type DesignIntentAuthority,
  type DesignIntentCheckpointV1,
  type DesignIntentField,
  type DesignIntentFieldCategory,
  type DesignIntentInputKind,
  type DesignIntentRights,
  type DesignIntentSource,
} from './designIntentCheckpoint';

export const AI_DESIGN_MAX_SOURCE_BYTES = 50 * 1024 * 1024;
export const AI_DESIGN_MAX_FIELDS = 500;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SECRET_KEY = /(secret|password|passwd|token|api[_-]?key|private[_-]?key|credential|authorization)/i;
const RAW_KEY = /^(bytes|buffer|arraybuffer|raw(image|geometry|data)?|geometryBytes)$/i;
const MAX_VALUE_STRING = 4_096;
const MAX_VALUE_DEPTH = 8;
const MAX_VALUE_ARRAY = AI_DESIGN_MAX_FIELDS;
const MAX_VALUE_KEYS = 64;
const UNIT_MAP: Record<string, { unit: string; scale: number }> = {
  mm: { unit: 'mm', scale: 1 }, millimeter: { unit: 'mm', scale: 1 }, millimeters: { unit: 'mm', scale: 1 },
  cm: { unit: 'mm', scale: 10 }, m: { unit: 'mm', scale: 1_000 }, in: { unit: 'mm', scale: 25.4 }, inch: { unit: 'mm', scale: 25.4 },
  deg: { unit: 'deg', scale: 1 }, degree: { unit: 'deg', scale: 1 }, degrees: { unit: 'deg', scale: 1 }, rad: { unit: 'deg', scale: 180 / Math.PI },
  unitless: { unit: 'unitless', scale: 1 }, none: { unit: 'unitless', scale: 1 },
};

export interface AiDesignInputEvent {
  projectId: string;
  revision: number;
  sourceId: string;
  sourceHash: string;
  /** Hash of the project revision that every source fragment must share. */
  projectContentHash?: string;
  kind: DesignIntentInputKind;
  mimeType: string;
  sizeBytes: number;
  /** UI/import metadata. Raw bytes are intentionally not accepted. */
  payload?: unknown;
  fields?: unknown;
  authority?: DesignIntentAuthority;
  provenance: {
    rights: DesignIntentRights | 'prohibited';
    origin: string;
    author?: string;
    license?: string;
    rightsEvidence?: string;
    aiUseAllowed?: boolean;
    derivativeUseAllowed?: boolean;
    attribution?: string;
  };
  label?: string;
  /** True when values came from OCR, vision, or a drawing parser. */
  extracted?: boolean;
  extractionKind?: 'ocr' | 'vision' | 'drawing' | 'import' | 'user';
}

export interface AiDesignInputFragment {
  source: DesignIntentSource;
  fields: DesignIntentField[];
  blockers: string[];
  questions: string[];
  conflicts: string[];
  readiness: { ready: boolean; blockers: string[]; questions: string[]; conflicts: string[] };
}

export interface AiDesignInputAdapterResult extends AiDesignInputFragment {
  checkpoint: DesignIntentCheckpointV1 | null;
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function containsForbidden(value: unknown, parent = ''): boolean {
  if (!record(value) && !Array.isArray(value)) return false;
  if (record(value)) for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key) || RAW_KEY.test(key)) return true;
    if (containsForbidden(child, `${parent}.${key}`)) return true;
  }
  else for (const child of value) if (containsForbidden(child, parent)) return true;
  return false;
}
function invalidPayloadValue(value: unknown, depth = 0): boolean {
  if (depth > MAX_VALUE_DEPTH || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
  if (value === null || typeof value === 'boolean') return false;
  if (typeof value === 'string') return value.length > MAX_VALUE_STRING;
  if (typeof value === 'number') return !Number.isFinite(value);
  if (Array.isArray(value)) return value.length > MAX_VALUE_ARRAY || value.some(item => invalidPayloadValue(item, depth + 1));
  if (record(value)) {
    const entries = Object.entries(value);
    return entries.length > MAX_VALUE_KEYS || entries.some(([, child]) => invalidPayloadValue(child, depth + 1));
  }
  return value !== undefined;
}
function normalizeUnit(unit: unknown): { unit: string; scale: number } | undefined {
  if (typeof unit !== 'string') return undefined;
  return UNIT_MAP[unit.trim().toLowerCase()];
}
function normalizeValue(value: unknown, unit: { unit: string; scale: number } | undefined): { value: unknown; unit?: string } {
  if (!unit) return { value };
  return { value: typeof value === 'number' ? value * unit.scale : value, unit: unit.unit };
}
function normalizeField(value: unknown, sourceId: string): DesignIntentField | null {
  if (!record(value) || typeof value.key !== 'string' || !value.key.trim() || value.value === undefined) return null;
  const category = ['fact', 'unit', 'dimension', 'component', 'manufacturing', 'requirement'].includes(String(value.category)) ? value.category as DesignIntentFieldCategory : 'fact';
  const rawUnit = record(value.value) && typeof value.value.unit === 'string' ? value.value.unit : value.unit;
  const unit = normalizeUnit(rawUnit);
  if (rawUnit !== undefined && !unit) return null;
  let fieldValue: unknown = value.value;
  if (record(value.value) && typeof value.value.value === 'number' && unit) fieldValue = {
    ...value.value,
    value: normalizeValue(value.value.value, unit).value,
    ...(typeof value.value.tolerance === 'number' ? { tolerance: value.value.tolerance * unit.scale } : {}),
    unit: unit.unit,
  };
  else if (unit) fieldValue = normalizeValue(value.value, unit).value;
  return { key: value.key.trim(), value: fieldValue, category, ...(unit ? { unit: unit.unit } : {}), sourceId, ...(typeof value.extractionNote === 'string' ? { extractionNote: value.extractionNote } : {}) };
}
function emptyResult(blockers: string[], questions: string[] = [], conflicts: string[] = []): AiDesignInputAdapterResult {
  return { checkpoint: null, source: undefined as never, fields: [], blockers, questions, conflicts, readiness: { ready: false, blockers, questions, conflicts } };
}

/** Convert one untrusted UI/import event into a revision-bound checkpoint source. */
export function adaptAiDesignInput(event: AiDesignInputEvent): AiDesignInputAdapterResult {
  const blockers: string[] = [];
  if (!record(event) || !SAFE_ID.test(event.projectId ?? '') || !SAFE_ID.test(event.sourceId ?? '') || !Number.isSafeInteger(event.revision) || event.revision < 0) blockers.push('project_binding_invalid');
  if (!SHA256.test(event.sourceHash ?? '')) blockers.push('source_hash_invalid');
  if (event.projectContentHash !== undefined && !SHA256.test(event.projectContentHash)) blockers.push('project_content_hash_invalid');
  if (!DESIGN_INTENT_INPUT_KINDS.includes(event.kind)) blockers.push('input_kind_invalid');
  if (typeof event.mimeType !== 'string' || !event.mimeType.trim() || !/^[\w.+-]+\/[\w.+-]+$/.test(event.mimeType)) blockers.push('mime_invalid');
  if (!Number.isSafeInteger(event.sizeBytes) || event.sizeBytes < 0 || event.sizeBytes > AI_DESIGN_MAX_SOURCE_BYTES) blockers.push('source_size_out_of_bounds');
  if (!event.provenance || typeof event.provenance.origin !== 'string' || !event.provenance.origin.trim()) blockers.push('provenance_origin_missing');
  if (containsForbidden(event.payload) || containsForbidden(event.fields)) blockers.push('raw_or_secret_payload_rejected');
  if (invalidPayloadValue(event.payload) || invalidPayloadValue(event.fields)) blockers.push('payload_out_of_bounds_or_nonserializable');
  const rights = event.provenance?.rights;
  if (rights === 'unknown' || rights === 'prohibited' || !['user_owned', 'licensed', 'public_domain'].includes(rights)) blockers.push('provenance_rights_blocked');
  if (rights === 'licensed' && !event.provenance.license && !event.provenance.rightsEvidence) blockers.push('license_evidence_missing');
  const fieldsInput = Array.isArray(event.fields) ? event.fields : (Array.isArray(event.payload) ? event.payload : record(event.payload) && Array.isArray(event.payload.fields) ? event.payload.fields : []);
  if (fieldsInput.length > AI_DESIGN_MAX_FIELDS) blockers.push('field_count_out_of_bounds');
  const fields = fieldsInput.map(value => normalizeField(value, event.sourceId)).filter((value): value is DesignIntentField => value !== null);
  if (fields.length !== fieldsInput.length) blockers.push('field_invalid_or_unit_invalid');
  const derived = event.extracted || ['ocr', 'vision', 'drawing'].includes(event.extractionKind ?? '');
  const authority: DesignIntentAuthority = event.authority === 'user_confirmed' && !derived ? 'user_confirmed' : derived ? 'ai_assumption' : (event.authority ?? 'imported_authority');
  const rightsAllowsUse = rights === 'user_owned' || rights === 'public_domain';
  const provenance = { rights: rights === 'prohibited' ? 'restricted' : (rights ?? 'unknown'), aiUseAllowed: event.provenance.aiUseAllowed ?? rightsAllowsUse, derivativeUseAllowed: event.provenance.derivativeUseAllowed ?? rightsAllowsUse, ...(event.provenance.attribution ? { attribution: event.provenance.attribution } : {}) } as DesignIntentSource['provenance'];
  const source: DesignIntentSource = { id: event.sourceId, kind: event.kind, projectId: event.projectId, revision: event.revision, sourceHash: event.sourceHash, authority, ...(event.label ? { label: event.label } : {}), provenance, fields: authority === 'ai_assumption' ? fields.map(field => ({ ...field, extractionNote: field.extractionNote ?? 'unverified extraction; confirmation required' })) : fields };
  if (blockers.length) return { ...emptyResult([...new Set(blockers)]), source, fields: source.fields };
  const checkpoint = createDesignIntentCheckpoint({ checkpointId: `${event.projectId}:${event.revision}:input`, projectId: event.projectId, revision: event.revision, projectContentHash: event.projectContentHash ?? event.sourceHash, sources: [source] });
  const conflicts = checkpoint.conflicts.map(conflict => conflict.key);
  const questions = checkpoint.missingFields.map(field => field.question);
  const readiness = { ready: checkpoint.readiness.ready, blockers: checkpoint.readiness.blockers, questions, conflicts };
  return { checkpoint, source, fields: source.fields, blockers: readiness.blockers, questions, conflicts, readiness };
}

/** Compose independently adapted fragments; project/revision/hash mismatches stay blocked. */
export function composeAiDesignCheckpoints(...checkpoints: DesignIntentCheckpointV1[]): DesignIntentCheckpointV1 {
  return mergeDesignIntentCheckpoints(...checkpoints);
}

export const adaptDesignIntentInput = adaptAiDesignInput;
export const composeDesignIntentCheckpoints = composeAiDesignCheckpoints;
