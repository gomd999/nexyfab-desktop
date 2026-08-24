/**
 * Unified intake contract for AI Design.
 *
 * Every design entry point (text, image, sketch, 2D drawing and a 3D
 * selection) is represented as a source in the same revision-bound envelope.
 * This is intentionally a data contract, not a parser.  Parsers may add
 * fields, but cannot make an untrusted value authoritative.
 */

export const DESIGN_INTENT_CHECKPOINT_SCHEMA = 'nexyfab.design-intent-checkpoint.v1' as const;
export const DESIGN_INTENT_INPUT_KINDS = ['text', 'image', 'sketch', 'drawing_2d', 'selection_3d'] as const;
export const DESIGN_INTENT_AUTHORITIES = ['user_confirmed', 'imported_authority', 'ai_assumption'] as const;
export const DESIGN_INTENT_FIELD_CATEGORIES = ['fact', 'unit', 'dimension', 'component', 'manufacturing', 'requirement'] as const;

export type DesignIntentInputKind = (typeof DESIGN_INTENT_INPUT_KINDS)[number];
export type DesignIntentAuthority = (typeof DESIGN_INTENT_AUTHORITIES)[number];
export type DesignIntentFieldCategory = (typeof DESIGN_INTENT_FIELD_CATEGORIES)[number];
export type DesignIntentRights = 'user_owned' | 'licensed' | 'public_domain' | 'unknown' | 'restricted';

export interface DesignIntentProvenancePolicy {
  rights: DesignIntentRights;
  /** A human-readable attribution or licence identifier when one is required. */
  attribution?: string;
  /** Explicit permission to use this source as an AI input. */
  aiUseAllowed: boolean;
  /** Explicit permission to create a derivative design from this source. */
  derivativeUseAllowed: boolean;
}

export interface DesignIntentSource {
  id: string;
  kind: DesignIntentInputKind;
  projectId: string;
  revision: number;
  /** SHA-256 of the immutable source bytes or canonical source payload. */
  sourceHash: string;
  /** Optional hash of the extracted/normalised payload. */
  contentHash?: string;
  authority: DesignIntentAuthority;
  label?: string;
  provenance: DesignIntentProvenancePolicy;
  fields: DesignIntentField[];
}

export interface DesignIntentField {
  key: string;
  value: unknown;
  category?: DesignIntentFieldCategory;
  unit?: string;
  sourceId?: string;
  /** A parser may explain how a value was extracted; it does not grant authority. */
  extractionNote?: string;
}

export interface DesignIntentFact {
  key: string;
  value: unknown;
  category: DesignIntentFieldCategory;
  unit?: string;
  sourceIds: string[];
  sourceHashes: string[];
  authority: Exclude<DesignIntentAuthority, 'ai_assumption'>;
}

export interface DesignIntentAssumption extends Omit<DesignIntentFact, 'authority'> {
  authority: 'ai_assumption';
  rationale?: string;
  requiresConfirmation: true;
}

type AnyDesignIntentFact = DesignIntentFact | DesignIntentAssumption;

export interface DesignIntentMissingField {
  key: string;
  label: string;
  category: DesignIntentFieldCategory;
  reason: 'required' | 'unresolved_conflict' | 'invalid_source' | 'provenance_blocked';
  question: string;
}

export interface DesignIntentConflict {
  key: string;
  category: DesignIntentFieldCategory;
  values: Array<{ value: unknown; authority: DesignIntentAuthority; sourceIds: string[]; sourceHashes: string[] }>;
  reason: 'authority_disagreement' | 'project_binding_mismatch' | 'duplicate_source_mismatch';
  resolutionQuestion: string;
}

export interface DesignIntentUnits {
  length: string;
  angle: string;
  mass?: string;
  coordinateSystem?: string;
}

export interface DesignIntentDimension {
  key: string;
  value: number | string;
  unit: string;
  tolerance?: number | string;
  sourceIds: string[];
  authoritative: boolean;
}

export interface DesignIntentComponent {
  id: string;
  name: string;
  quantity?: number;
  makeOrBuy?: 'make' | 'buy' | 'unknown';
  sourceIds: string[];
}

export interface DesignIntentManufacturingConstraint {
  key: string;
  value: unknown;
  sourceIds: string[];
  authoritative: boolean;
}

export interface DesignIntentReadiness {
  ready: boolean;
  blockers: string[];
  nextQuestions: DesignIntentMissingField[];
  /** Useful to UI consumers without treating assumptions as facts. */
  confirmedFactCount: number;
  importedAuthorityCount: number;
  assumptionCount: number;
}

export interface DesignIntentCheckpointV1 {
  schema: typeof DESIGN_INTENT_CHECKPOINT_SCHEMA;
  checkpointId: string;
  projectId: string;
  revision: number;
  projectContentHash: string;
  sources: DesignIntentSource[];
  userConfirmedFacts: DesignIntentFact[];
  importedAuthority: DesignIntentFact[];
  aiAssumptions: DesignIntentAssumption[];
  missingFields: DesignIntentMissingField[];
  conflicts: DesignIntentConflict[];
  units: DesignIntentUnits;
  dimensions: DesignIntentDimension[];
  components: DesignIntentComponent[];
  manufacturingConstraints: DesignIntentManufacturingConstraint[];
  copyrightPolicy: {
    usable: boolean;
    blockedSourceIds: string[];
    attributionRequiredSourceIds: string[];
  };
  readiness: DesignIntentReadiness;
}

export interface CreateDesignIntentCheckpointInput {
  checkpointId: string;
  projectId: string;
  revision: number;
  projectContentHash: string;
  sources: DesignIntentSource[];
  /** Required fields are explicit so an empty parser result cannot look ready. */
  requiredFields?: Array<Pick<DesignIntentMissingField, 'key' | 'label' | 'category' | 'question'>>;
  units?: Partial<DesignIntentUnits>;
}

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SAFE_UNIT = /^[A-Za-z0-9][A-Za-z0-9°/_ .-]{0,31}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

function authorityRank(value: DesignIntentAuthority): number {
  return value === 'user_confirmed' ? 3 : value === 'imported_authority' ? 2 : 1;
}

function sourceHashFor(source: DesignIntentSource): string { return source.sourceHash; }

function factFromField(source: DesignIntentSource, field: DesignIntentField, authority: DesignIntentAuthority): DesignIntentFact | DesignIntentAssumption {
  const fact = {
    key: field.key,
    value: field.value,
    category: field.category ?? 'fact',
    ...(field.unit ? { unit: field.unit } : {}),
    sourceIds: [source.id],
    sourceHashes: [sourceHashFor(source)],
    authority,
  } as DesignIntentFact | DesignIntentAssumption;
  if (authority === 'ai_assumption') return { ...fact, requiresConfirmation: true } as DesignIntentAssumption;
  return fact;
}

function uniqueFacts<T extends AnyDesignIntentFact>(facts: T[]): T[] {
  const result: T[] = [];
  for (const fact of facts) {
    const existing = result.find(item => item.key === fact.key && sameValue(item.value, fact.value) && item.authority === fact.authority);
    if (!existing) result.push({ ...fact, sourceIds: [...new Set(fact.sourceIds)], sourceHashes: [...new Set(fact.sourceHashes)] });
    else {
      existing.sourceIds = [...new Set([...existing.sourceIds, ...fact.sourceIds])];
      existing.sourceHashes = [...new Set([...existing.sourceHashes, ...fact.sourceHashes])];
    }
  }
  return result;
}

function makeConflict(key: string, facts: AnyDesignIntentFact[]): DesignIntentConflict {
  const values = facts.map(fact => ({ value: fact.value, authority: fact.authority, sourceIds: fact.sourceIds, sourceHashes: fact.sourceHashes }));
  const authorities = new Set(facts.map(fact => fact.authority));
  return {
    key,
    category: facts[0]?.category ?? 'fact',
    values,
    reason: authorities.size > 1 ? 'authority_disagreement' : 'duplicate_source_mismatch',
    resolutionQuestion: `Confirm one value for ${key}; conflicting source values are never selected automatically.`,
  };
}

function fieldsFromFacts(facts: DesignIntentFact[], category: DesignIntentFieldCategory): DesignIntentFact[] {
  return facts.filter(fact => fact.category === category);
}

function deriveCheckpoint(input: CreateDesignIntentCheckpointInput): DesignIntentCheckpointV1 {
  const sources = input.sources.map(source => ({ ...source, fields: source.fields.map(field => ({ ...field })) }));
  const sourceFacts = sources.flatMap(source => source.fields.map(field => factFromField(source, field, source.authority)));
  const confirmed = uniqueFacts(sourceFacts.filter((fact): fact is DesignIntentFact => fact.authority === 'user_confirmed'));
  const imported = uniqueFacts(sourceFacts.filter((fact): fact is DesignIntentFact => fact.authority === 'imported_authority'));
  const assumptions = uniqueFacts(sourceFacts.filter((fact): fact is DesignIntentAssumption => fact.authority === 'ai_assumption')) as DesignIntentAssumption[];
  const all = [...confirmed, ...imported, ...assumptions];
  const conflicts = [...new Set(all.map(fact => fact.key))].flatMap(key => {
    const values = all.filter(fact => fact.key === key);
    const distinct = values.filter((fact, index) => values.findIndex(other => sameValue(other.value, fact.value)) === index);
    return distinct.length > 1 ? [makeConflict(key, distinct)] : [];
  });
  const blockedSourceIds = sources.filter(source => !source.provenance.aiUseAllowed || !source.provenance.derivativeUseAllowed || source.provenance.rights === 'unknown' || source.provenance.rights === 'restricted').map(source => source.id);
  const attributionRequiredSourceIds = sources.filter(source => !!source.provenance.attribution || source.provenance.rights === 'licensed').map(source => source.id);
  const missingFields: DesignIntentMissingField[] = (input.requiredFields ?? []).filter(required => !all.some(fact => fact.key === required.key && fact.authority !== 'ai_assumption')).map(required => ({ ...required, reason: 'required' as const }));
  for (const conflict of conflicts) {
    if (!missingFields.some(field => field.key === conflict.key)) missingFields.push({ key: conflict.key, label: conflict.key, category: conflict.category, reason: 'unresolved_conflict', question: conflict.resolutionQuestion });
  }
  if (blockedSourceIds.length) for (const sourceId of blockedSourceIds) missingFields.push({ key: `provenance:${sourceId}`, label: 'Source permission', category: 'requirement', reason: 'provenance_blocked', question: `Confirm AI and derivative-use permission for source ${sourceId}.` });
  const authoritative = [...confirmed, ...imported];
  const dimensions = fieldsFromFacts(authoritative, 'dimension').flatMap(fact => typeof fact.value === 'object' && isRecord(fact.value) && typeof fact.value.value === 'number' && typeof fact.value.unit === 'string' ? [{ key: fact.key, value: fact.value.value, unit: fact.value.unit, ...(fact.value.tolerance !== undefined ? { tolerance: fact.value.tolerance as number | string } : {}), sourceIds: fact.sourceIds, authoritative: true }] : []);
  const components = fieldsFromFacts(authoritative, 'component').flatMap(fact => isRecord(fact.value) && typeof fact.value.id === 'string' && typeof fact.value.name === 'string' ? [{ id: fact.value.id, name: fact.value.name, ...(typeof fact.value.quantity === 'number' ? { quantity: fact.value.quantity } : {}), ...(fact.value.makeOrBuy === 'make' || fact.value.makeOrBuy === 'buy' ? { makeOrBuy: fact.value.makeOrBuy as 'make' | 'buy' } : {}), sourceIds: fact.sourceIds }] : []);
  const manufacturingConstraints = fieldsFromFacts(authoritative, 'manufacturing').map(fact => ({ key: fact.key, value: fact.value, sourceIds: fact.sourceIds, authoritative: true }));
  const readiness: DesignIntentReadiness = {
    ready: sources.length > 0 && missingFields.length === 0 && conflicts.length === 0 && blockedSourceIds.length === 0,
    blockers: [...missingFields.map(field => `${field.reason}:${field.key}`), ...conflicts.map(conflict => `conflict:${conflict.key}`)],
    nextQuestions: missingFields,
    confirmedFactCount: confirmed.length,
    importedAuthorityCount: imported.length,
    assumptionCount: assumptions.length,
  };
  return {
    schema: DESIGN_INTENT_CHECKPOINT_SCHEMA,
    checkpointId: input.checkpointId,
    projectId: input.projectId,
    revision: input.revision,
    projectContentHash: input.projectContentHash,
    sources,
    userConfirmedFacts: confirmed,
    importedAuthority: imported,
    aiAssumptions: assumptions,
    missingFields,
    conflicts,
    units: { length: input.units?.length ?? 'mm', angle: input.units?.angle ?? 'deg', ...(input.units?.mass ? { mass: input.units.mass } : {}), ...(input.units?.coordinateSystem ? { coordinateSystem: input.units.coordinateSystem } : {}) },
    dimensions,
    components,
    manufacturingConstraints,
    copyrightPolicy: { usable: blockedSourceIds.length === 0, blockedSourceIds, attributionRequiredSourceIds },
    readiness,
  };
}

/** Build a checkpoint and recompute every derived/readiness field. */
export function createDesignIntentCheckpoint(input: CreateDesignIntentCheckpointInput): DesignIntentCheckpointV1 {
  return deriveCheckpoint(input);
}

export const buildDesignIntentCheckpoint = createDesignIntentCheckpoint;

/** Merge sources from several intakes; conflicting values remain visible. */
export function mergeDesignIntentCheckpoints(...checkpoints: DesignIntentCheckpointV1[]): DesignIntentCheckpointV1 {
  if (checkpoints.length === 0) throw new Error('at_least_one_checkpoint_required');
  const first = checkpoints[0]!;
  const sources = checkpoints.flatMap(checkpoint => checkpoint.sources);
  const duplicateSourceIds = new Set<string>();
  const duplicateSourceMismatches = new Map<string, { prior: DesignIntentSource; incoming: DesignIntentSource }>();
  const uniqueSources: DesignIntentSource[] = [];
  for (const source of sources) {
    const prior = uniqueSources.find(item => item.id === source.id);
    if (!prior) uniqueSources.push(source);
    else if (prior.sourceHash !== source.sourceHash) {
      duplicateSourceIds.add(source.id);
      duplicateSourceMismatches.set(source.id, { prior, incoming: source });
    }
  }
  const requiredFields = checkpoints.flatMap(checkpoint => checkpoint.missingFields.filter(field => field.reason === 'required').map(({ key, label, category, question }) => ({ key, label, category, question })));
  const merged = deriveCheckpoint({ checkpointId: first.checkpointId, projectId: first.projectId, revision: first.revision, projectContentHash: first.projectContentHash, sources: uniqueSources, requiredFields });
  for (const sourceId of duplicateSourceIds) {
    const source = merged.sources.find(item => item.id === sourceId);
    const mismatch = duplicateSourceMismatches.get(sourceId);
    if (source && mismatch && !merged.conflicts.some(conflict => conflict.key === `source:${sourceId}`)) merged.conflicts.push({
      key: `source:${sourceId}`,
      category: 'requirement',
      values: [
        { value: mismatch.prior.sourceHash, authority: mismatch.prior.authority, sourceIds: [mismatch.prior.id], sourceHashes: [mismatch.prior.sourceHash] },
        { value: mismatch.incoming.sourceHash, authority: mismatch.incoming.authority, sourceIds: [mismatch.incoming.id], sourceHashes: [mismatch.incoming.sourceHash] },
      ],
      reason: 'duplicate_source_mismatch',
      resolutionQuestion: `Resolve duplicate source ${sourceId}; source hashes differ.`,
    });
  }
  const projectMismatch = checkpoints.some(checkpoint => checkpoint.projectId !== first.projectId || checkpoint.revision !== first.revision || checkpoint.projectContentHash !== first.projectContentHash);
  if (projectMismatch) merged.conflicts.push({ key: 'project.binding', category: 'requirement', values: checkpoints.map(checkpoint => ({ value: `${checkpoint.projectId}:${checkpoint.revision}`, authority: 'imported_authority', sourceIds: checkpoint.sources.map(source => source.id), sourceHashes: checkpoint.sources.map(source => source.sourceHash) })), reason: 'project_binding_mismatch', resolutionQuestion: 'Use one project revision and content hash before combining inputs.' });
  merged.missingFields = [...merged.missingFields, ...(projectMismatch ? [{ key: 'project.binding', label: 'Project revision', category: 'requirement' as const, reason: 'unresolved_conflict' as const, question: 'Use one project revision and content hash before combining inputs.' }] : [])];
  const mergeBlockers = [...merged.missingFields.map(field => `${field.reason}:${field.key}`), ...merged.conflicts.map(conflict => `conflict:${conflict.key}`)];
  merged.readiness = {
    ...merged.readiness,
    ready: merged.sources.length > 0 && merged.missingFields.length === 0 && merged.conflicts.length === 0 && merged.copyrightPolicy.usable,
    blockers: [...new Set(mergeBlockers)],
    nextQuestions: merged.missingFields,
  };
  return merged;
}

export function getDesignIntentReadiness(checkpoint: DesignIntentCheckpointV1): DesignIntentReadiness {
  const issues = validateDesignIntentCheckpoint(checkpoint);
  const nextQuestions = checkpoint.missingFields;
  return { ...checkpoint.readiness, ready: issues.length === 0 && nextQuestions.length === 0, blockers: issues.length ? [...issues] : checkpoint.readiness.blockers, nextQuestions };
}

export const getNextDesignIntentQuestions = (checkpoint: DesignIntentCheckpointV1): DesignIntentMissingField[] => getDesignIntentReadiness(checkpoint).nextQuestions;

/** Strict structural and binding validation. Serialized readiness is never trusted. */
export function validateDesignIntentCheckpoint(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value) || value.schema !== DESIGN_INTENT_CHECKPOINT_SCHEMA) return ['invalid_design_intent_checkpoint_schema'];
  const checkpoint = value as unknown as DesignIntentCheckpointV1;
  if (!SAFE_ID.test(checkpoint.checkpointId ?? '') || !SAFE_ID.test(checkpoint.projectId ?? '') || !Number.isSafeInteger(checkpoint.revision) || checkpoint.revision < 0 || !SHA256.test(checkpoint.projectContentHash ?? '')) issues.push('project_binding_invalid');
  if (!Array.isArray(checkpoint.sources) || checkpoint.sources.length === 0) issues.push('sources_missing');
  const sourceIds = new Set<string>();
  for (const source of checkpoint.sources ?? []) {
    if (!isRecord(source) || !SAFE_ID.test(String(source.id ?? '')) || sourceIds.has(String(source.id)) || !DESIGN_INTENT_INPUT_KINDS.includes(source.kind as DesignIntentInputKind) || !SAFE_ID.test(String(source.projectId ?? '')) || source.projectId !== checkpoint.projectId || source.revision !== checkpoint.revision || !Number.isSafeInteger(source.revision) || source.revision < 0 || !SHA256.test(String(source.sourceHash ?? '')) || (source.contentHash !== undefined && !SHA256.test(String(source.contentHash))) || !DESIGN_INTENT_AUTHORITIES.includes(source.authority as DesignIntentAuthority) || !Array.isArray(source.fields) || !isRecord(source.provenance)) issues.push(`source_invalid:${String(source?.id ?? 'unknown')}`);
    sourceIds.add(String(source?.id ?? ''));
    if (source?.provenance && (!['user_owned', 'licensed', 'public_domain', 'unknown', 'restricted'].includes(String(source.provenance.rights)) || typeof source.provenance.aiUseAllowed !== 'boolean' || typeof source.provenance.derivativeUseAllowed !== 'boolean')) issues.push(`source_provenance_invalid:${String(source?.id ?? 'unknown')}`);
    for (const field of source?.fields ?? []) if (!isRecord(field) || typeof field.key !== 'string' || !field.key.trim() || field.value === undefined) issues.push(`source_field_invalid:${String(source?.id ?? 'unknown')}`);
  }
  if (!Array.isArray(checkpoint.userConfirmedFacts) || !Array.isArray(checkpoint.importedAuthority) || !Array.isArray(checkpoint.aiAssumptions) || !Array.isArray(checkpoint.missingFields) || !Array.isArray(checkpoint.conflicts) || !isRecord(checkpoint.units) || !Array.isArray(checkpoint.dimensions) || !Array.isArray(checkpoint.components) || !Array.isArray(checkpoint.manufacturingConstraints) || !isRecord(checkpoint.copyrightPolicy)) issues.push('derived_sections_invalid');
  if (!checkpoint.units || typeof checkpoint.units.length !== 'string' || !SAFE_UNIT.test(checkpoint.units.length) || typeof checkpoint.units.angle !== 'string' || !SAFE_UNIT.test(checkpoint.units.angle)) issues.push('units_invalid');
  if (checkpoint.copyrightPolicy && (typeof checkpoint.copyrightPolicy.usable !== 'boolean' || !Array.isArray(checkpoint.copyrightPolicy.blockedSourceIds) || !Array.isArray(checkpoint.copyrightPolicy.attributionRequiredSourceIds))) issues.push('copyright_policy_invalid');
  const blocked = new Set((checkpoint.sources ?? []).filter(source => !source.provenance?.aiUseAllowed || !source.provenance?.derivativeUseAllowed || source.provenance?.rights === 'unknown' || source.provenance?.rights === 'restricted').map(source => source.id));
  if (checkpoint.copyrightPolicy?.usable !== (blocked.size === 0) || JSON.stringify([...(checkpoint.copyrightPolicy?.blockedSourceIds ?? [])].sort()) !== JSON.stringify([...blocked].sort())) issues.push('copyright_policy_not_recomputed');
  try {
    const derived = deriveCheckpoint({ checkpointId: checkpoint.checkpointId, projectId: checkpoint.projectId, revision: checkpoint.revision, projectContentHash: checkpoint.projectContentHash, sources: checkpoint.sources ?? [], requiredFields: (checkpoint.missingFields ?? []).filter(field => field.reason === 'required').map(({ key, label, category, question }) => ({ key, label, category, question })), units: checkpoint.units });
    if (JSON.stringify(derived.userConfirmedFacts) !== JSON.stringify(checkpoint.userConfirmedFacts) || JSON.stringify(derived.importedAuthority) !== JSON.stringify(checkpoint.importedAuthority) || JSON.stringify(derived.aiAssumptions) !== JSON.stringify(checkpoint.aiAssumptions) || JSON.stringify(derived.conflicts) !== JSON.stringify(checkpoint.conflicts)) issues.push('derived_values_not_recomputed');
  } catch {
    // A malformed source must produce a validation result, never an exception.
    issues.push('derived_values_not_recomputed');
  }
  if (checkpoint.readiness?.ready !== (issues.length === 0 && (checkpoint.missingFields?.length ?? -1) === 0 && (checkpoint.conflicts?.length ?? -1) === 0)) issues.push('readiness_not_fail_closed');
  return [...new Set(issues)];
}

export function isDesignIntentCheckpointValid(value: unknown): value is DesignIntentCheckpointV1 {
  return validateDesignIntentCheckpoint(value).length === 0;
}
