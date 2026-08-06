import type { ComplexProductArchitecture } from "./complexProductArchitecture";

export interface StepBodyMembershipEvidence {
  authoritative: boolean;
  definitions: Array<{ definitionId: string; bodyCount: number }>;
  occurrenceCounts: Array<{ definitionId: string; count: number }>;
}

export interface StepBodyMembershipReport {
  status: "pass" | "fail" | "not_run";
  codes: string[];
  affectedDefinitionIds: string[];
}

export interface ImportedStepProductStructure {
  definitions: Array<{
    definitionId: string;
    name: string;
    bodyCount: number;
    container: boolean;
  }>;
  occurrences: Array<{ occurrenceId: string; definitionId: string }>;
  relationships?: Array<{
    relationshipId: string;
    parentDefinitionId: string;
    childDefinitionId: string;
    localToParent: number[];
  }>;
}

/** Maps native PD ids only when product names are unique on both sides. */
export function deriveStepBodyMembershipEvidence(
  architecture: ComplexProductArchitecture,
  imported: ImportedStepProductStructure,
): StepBodyMembershipEvidence {
  const architectureNames = new Map<string, string[]>();
  for (const definition of architecture.definitions.filter(
    (item) => item.kind === "part",
  )) {
    const ids = architectureNames.get(definition.name) ?? [];
    ids.push(definition.id);
    architectureNames.set(definition.name, ids);
  }
  const importedNames = new Map<
    string,
    ImportedStepProductStructure["definitions"]
  >();
  for (const definition of imported.definitions.filter(
    (item) => !item.container,
  )) {
    const values = importedNames.get(definition.name) ?? [];
    values.push(definition);
    importedNames.set(definition.name, values);
  }
  const rawToNormalized = new Map<string, string>();
  const definitions = imported.definitions
    .filter((item) => !item.container)
    .map((item) => {
      const architectureIds = architectureNames.get(item.name) ?? [];
      const importedWithName = importedNames.get(item.name) ?? [];
      const definitionId =
        architectureIds.length === 1 && importedWithName.length === 1
          ? architectureIds[0]!
          : `unmapped:${item.definitionId}`;
      rawToNormalized.set(item.definitionId, definitionId);
      return { definitionId, bodyCount: item.bodyCount };
    });
  const counts = new Map<string, number>();
  for (const occurrence of imported.occurrences) {
    const definitionId =
      rawToNormalized.get(occurrence.definitionId) ??
      `unmapped:${occurrence.definitionId}`;
    counts.set(definitionId, (counts.get(definitionId) ?? 0) + 1);
  }
  return {
    authoritative: true,
    definitions,
    occurrenceCounts: [...counts.entries()].map(([definitionId, count]) => ({
      definitionId,
      count,
    })),
  };
}

/** Verifies definition-owned bodies separately from occurrence reuse. */
export function verifyStepBodyMembership(
  architecture: ComplexProductArchitecture,
  evidence?: StepBodyMembershipEvidence,
): StepBodyMembershipReport {
  if (!evidence?.authoritative)
    return {
      status: "not_run",
      codes: ["STEP_BODY_MEMBERSHIP_EVIDENCE_MISSING"],
      affectedDefinitionIds: [],
    };
  const codes: string[] = [];
  const affected = new Set<string>();
  const definitions = new Map<string, number>();
  const occurrences = new Map<string, number>();
  for (const item of evidence.definitions) {
    if (definitions.has(item.definitionId)) {
      codes.push(`STEP_BODY_DEFINITION_DUPLICATE:${item.definitionId}`);
      affected.add(item.definitionId);
    }
    definitions.set(item.definitionId, item.bodyCount);
  }
  for (const item of evidence.occurrenceCounts) {
    if (occurrences.has(item.definitionId)) {
      codes.push(`STEP_BODY_OCCURRENCE_COUNT_DUPLICATE:${item.definitionId}`);
      affected.add(item.definitionId);
    }
    occurrences.set(item.definitionId, item.count);
  }
  const parts = architecture.definitions.filter((item) => item.kind === "part");
  const expectedIds = new Set(parts.map((item) => item.id));
  for (const definition of parts) {
    const bodyCount = definitions.get(definition.id);
    if (bodyCount === undefined) {
      codes.push(`STEP_BODY_DEFINITION_MISSING:${definition.id}`);
      affected.add(definition.id);
    } else {
      const expected = definition.bodyIntent.expectedBodies;
      const matches =
        definition.bodyIntent.policy === "single_body"
          ? bodyCount === 1
          : expected === null
            ? bodyCount >= 2
            : bodyCount === expected;
      if (!matches) {
        codes.push(`STEP_BODY_COUNT_MISMATCH:${definition.id}:${bodyCount}`);
        affected.add(definition.id);
      }
    }
    const expectedOccurrences = architecture.occurrences.filter(
      (item) => item.definitionId === definition.id,
    ).length;
    const actualOccurrences = occurrences.get(definition.id);
    if (actualOccurrences === undefined) {
      codes.push(`STEP_BODY_OCCURRENCES_MISSING:${definition.id}`);
      affected.add(definition.id);
    } else if (actualOccurrences !== expectedOccurrences) {
      codes.push(
        `STEP_BODY_OCCURRENCE_COUNT_MISMATCH:${definition.id}:${expectedOccurrences}->${actualOccurrences}`,
      );
      affected.add(definition.id);
    }
  }
  for (const definitionId of definitions.keys()) {
    if (!expectedIds.has(definitionId)) {
      codes.push(`STEP_BODY_UNEXPECTED_PART_DEFINITION:${definitionId}`);
      affected.add(definitionId);
    }
  }
  return {
    status: codes.length ? "fail" : "pass",
    codes: [...new Set(codes)].sort(),
    affectedDefinitionIds: [...affected].sort(),
  };
}
