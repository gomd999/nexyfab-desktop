import type { AiAssemblyProgram } from './aiAssemblyProgram';
import { validateAiAssemblyProgram } from './aiAssemblyProgram';
import { serverEvidenceSha256 } from './serverEvidence';

export interface RepairScopeVerification {
  schema: 'nexyfab.repair-scope-verification.v1';
  passed: boolean;
  beforeProgramSha256: string;
  afterProgramSha256: string;
  permittedPartIds: string[];
  permittedMateIds: string[];
  changedPartIds: string[];
  changedMateIds: string[];
  errors: string[];
}

const issued = new WeakSet<RepairScopeVerification>();
const hash = (value: unknown) => serverEvidenceSha256(value);
const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
const sameSet = (a: Iterable<string>, b: Iterable<string>) => hash(sorted(a)) === hash(sorted(b));

/**
 * Deterministically compares the complete before/after program. A local repair may change
 * only explicitly permitted part FeatureTrees/placements and explicitly permitted mates.
 * Identity, metadata, inventory, hierarchy and global product intent remain immutable.
 */
export function verifyRepairScope(input: {
  before: AiAssemblyProgram;
  after: AiAssemblyProgram;
  permittedPartIds: readonly string[];
  permittedMateIds?: readonly string[];
}): RepairScopeVerification {
  const permittedPartIds = sorted(input.permittedPartIds);
  const permittedMateIds = sorted(input.permittedMateIds ?? []);
  const permittedParts = new Set(permittedPartIds);
  const permittedMates = new Set(permittedMateIds);
  const errors: string[] = [];
  if (!permittedPartIds.length && !permittedMateIds.length) errors.push('Repair scope must explicitly permit at least one part or mate.');
  for (const issue of validateAiAssemblyProgram(input.before)) errors.push(`before.${issue.path}: ${issue.message}`);
  for (const issue of validateAiAssemblyProgram(input.after)) errors.push(`after.${issue.path}: ${issue.message}`);

  const beforeParts = new Map(input.before.parts.map(part => [part.instanceId, part]));
  const afterParts = new Map(input.after.parts.map(part => [part.instanceId, part]));
  const beforeAssemblyParts = new Map(input.before.assembly.parts.map(part => [part.id, part]));
  const afterAssemblyParts = new Map(input.after.assembly.parts.map(part => [part.id, part]));
  if (!sameSet(beforeParts.keys(), afterParts.keys()) || !sameSet(beforeAssemblyParts.keys(), afterAssemblyParts.keys())) errors.push('Part inventory changed during a local repair.');
  for (const id of permittedPartIds) if (!beforeParts.has(id) || !beforeAssemblyParts.has(id)) errors.push(`Permitted part '${id}' does not exist in the baseline program.`);

  const changedPartIds: string[] = [];
  for (const [id, beforePart] of beforeParts) {
    const afterPart = afterParts.get(id);
    const beforePlacement = beforeAssemblyParts.get(id);
    const afterPlacement = afterAssemblyParts.get(id);
    if (!afterPart || !beforePlacement || !afterPlacement) continue;
    const changed = hash({ part: beforePart, placement: beforePlacement }) !== hash({ part: afterPart, placement: afterPlacement });
    if (changed) changedPartIds.push(id);
    if (changed && !permittedParts.has(id)) errors.push(`Unpermitted part changed: ${id}.`);
    if (permittedParts.has(id)) {
      const { featureTree: _beforeTree, ...beforeIdentity } = beforePart;
      const { featureTree: _afterTree, ...afterIdentity } = afterPart;
      if (hash(beforeIdentity) !== hash(afterIdentity)) errors.push(`Repair changed immutable identity or manufacturing metadata for part ${id}.`);
      const { position: _beforePosition, orientation: _beforeOrientation, ...beforeAssemblyIdentity } = beforePlacement;
      const { position: _afterPosition, orientation: _afterOrientation, ...afterAssemblyIdentity } = afterPlacement;
      if (hash(beforeAssemblyIdentity) !== hash(afterAssemblyIdentity)) errors.push(`Repair changed immutable assembly identity for part ${id}.`);
    }
  }

  const beforeMates = new Map(input.before.assembly.mates.map(mate => [mate.id, mate]));
  const afterMates = new Map(input.after.assembly.mates.map(mate => [mate.id, mate]));
  if (!sameSet(beforeMates.keys(), afterMates.keys())) errors.push('Mate inventory changed during a local repair.');
  for (const id of permittedMateIds) if (!beforeMates.has(id)) errors.push(`Permitted mate '${id}' does not exist in the baseline program.`);
  const changedMateIds: string[] = [];
  for (const [id, beforeMate] of beforeMates) {
    const afterMate = afterMates.get(id);
    if (!afterMate) continue;
    if (hash(beforeMate) !== hash(afterMate)) {
      changedMateIds.push(id);
      if (!permittedMates.has(id)) errors.push(`Unpermitted mate changed: ${id}.`);
    }
  }

  const beforeAssemblyRest = { ...input.before.assembly, parts: undefined, mates: undefined };
  const afterAssemblyRest = { ...input.after.assembly, parts: undefined, mates: undefined };
  if (hash(beforeAssemblyRest) !== hash(afterAssemblyRest)) errors.push('Assembly properties outside parts and mates changed during repair.');
  const beforeGlobal = { version: input.before.version, units: input.before.units, classification: input.before.classification, name: input.before.name, structure: input.before.structure ?? [], physicalNetworks: input.before.physicalNetworks ?? [], unresolved: input.before.unresolved };
  const afterGlobal = { version: input.after.version, units: input.after.units, classification: input.after.classification, name: input.after.name, structure: input.after.structure ?? [], physicalNetworks: input.after.physicalNetworks ?? [], unresolved: input.after.unresolved };
  if (hash(beforeGlobal) !== hash(afterGlobal)) errors.push('Global product intent, hierarchy, classification, or unresolved inventory changed during repair.');

  const result: RepairScopeVerification = {
    schema: 'nexyfab.repair-scope-verification.v1',
    passed: errors.length === 0,
    beforeProgramSha256: hash(input.before),
    afterProgramSha256: hash(input.after),
    permittedPartIds,
    permittedMateIds,
    changedPartIds: sorted(changedPartIds),
    changedMateIds: sorted(changedMateIds),
    errors,
  };
  issued.add(result);
  return result;
}

/** Caller-authored booleans or deserialized lookalikes are not trusted as verifier output. */
export function isRuntimeIssuedRepairScopeVerification(value: unknown): value is RepairScopeVerification {
  return Boolean(value && typeof value === 'object' && issued.has(value as RepairScopeVerification));
}
