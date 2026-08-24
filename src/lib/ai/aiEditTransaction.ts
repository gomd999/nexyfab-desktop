import type { SelectionContext } from "./selectionContext";
import { selectionRequiresConfirmation } from "./selectionContext";

export type CadEditOperation =
  | {
      kind: "set_feature_parameter";
      partId: string;
      featureId: string;
      parameter: string;
      value: number;
      unit: "mm" | "deg" | "1";
    }
  | { kind: "add_fillet"; partId: string; edgeRefs: string[]; radiusMm: number }
  | {
      kind: "add_chamfer";
      partId: string;
      edgeRefs: string[];
      distanceMm: number;
    }
  | {
      kind: "add_shell";
      partId: string;
      featureId: string;
      thicknessMm: number;
      openTopFace: boolean;
      openBottomFace: boolean;
    }
  | {
      kind: "set_sketch_dimension";
      partId: string;
      sketchId: string;
      entityIds: string[];
      value: number;
      unit: "mm" | "deg";
    }
  | {
      kind: "set_sketch_constraint";
      partId: string;
      sketchId: string;
      entityIds: string[];
      constraint:
        | "horizontal"
        | "vertical"
        | "parallel"
        | "perpendicular"
        | "coincident"
        | "concentric";
    }
  | {
      kind: "transform_part";
      partId: string;
      translationMm?: [number, number, number];
      rotationDeg?: [number, number, number];
    }
  | {
      kind: "transform_part_delta";
      partId: string;
      translationDeltaMm?: [number, number, number];
      rotationDeltaDeg?: [number, number, number];
    }
  | {
      kind: "offset_faces";
      partId: string;
      faceRefs: string[];
      distanceMm: number;
    }
  | {
      kind: "draft_faces";
      partId: string;
      faceRefs: string[];
      angleDeg: number;
      pullDirection: [number, number, number];
    }
  | { kind: "set_part_suppressed"; partId: string; suppressed: boolean }
  | {
      kind: "set_mate_parameter";
      mateId: string;
      parameter: "distance" | "angle";
      value: number;
      unit: "mm" | "deg";
    }
  | { kind: "add_mate"; mate: unknown }
  | { kind: "remove_mate"; mateId: string };

export type EditRuleCheck = {
  code: string;
  status: "passed" | "failed" | "needs_confirmation";
  message: string;
};

export type AiEditTransaction = {
  version: 1;
  id: string;
  baseRevision: string;
  userCommand: string;
  selection: SelectionContext;
  observations: string[];
  assumptions: string[];
  unresolved: string[];
  operations: CadEditOperation[];
  affected: {
    parts: string[];
    features: string[];
    mates: string[];
    drawings: string[];
  };
  preconditions: EditRuleCheck[];
  rollbackSnapshot: string;
};

export type EditTransactionVerdict = {
  applicable: boolean;
  requiresConfirmation: boolean;
  issues: string[];
};

export type CadEditMutationScope =
  | "definition_geometry"
  | "occurrence_transform"
  | "assembly_constraint"
  | "product_structure";

export type CadEditImpact = {
  scope: CadEditMutationScope;
  affectedPartIds: string[];
  invalidatedStages: Array<
    | "decomposition"
    | "kernel"
    | "topology"
    | "assembly_solve"
    | "motion"
    | "manufacturing"
    | "roundtrip"
    | "release"
  >;
  preservesDefinitionGeometry: boolean;
};

export function cadEditMutationScope(
  operation: CadEditOperation,
): CadEditMutationScope {
  if (
    operation.kind === "transform_part" ||
    operation.kind === "transform_part_delta"
  )
    return "occurrence_transform";
  if (
    operation.kind === "set_mate_parameter" ||
    operation.kind === "add_mate" ||
    operation.kind === "remove_mate"
  )
    return "assembly_constraint";
  if (operation.kind === "set_part_suppressed") return "product_structure";
  return "definition_geometry";
}

const operationPartId = (operation: CadEditOperation): string | null =>
  "partId" in operation ? operation.partId : null;

const finiteTuple = (value: readonly number[] | undefined): boolean =>
  value !== undefined && value.length > 0 && value.every(Number.isFinite);

function validateOperationNumbers(operation: CadEditOperation): string[] {
  const issue = (field: string) => [`invalid numeric edit value: ${operation.kind}.${field}`];
  switch (operation.kind) {
    case "set_feature_parameter":
    case "set_sketch_dimension":
    case "set_mate_parameter":
      return Number.isFinite(operation.value) ? [] : issue("value");
    case "add_fillet":
      return Number.isFinite(operation.radiusMm) && operation.radiusMm > 0 ? [] : issue("radiusMm");
    case "add_chamfer":
      return Number.isFinite(operation.distanceMm) && operation.distanceMm > 0 ? [] : issue("distanceMm");
    case "add_shell":
      return Number.isFinite(operation.thicknessMm) && operation.thicknessMm > 0 ? [] : issue("thicknessMm");
    case "offset_faces":
      return Number.isFinite(operation.distanceMm) ? [] : issue("distanceMm");
    case "draft_faces":
      if (!Number.isFinite(operation.angleDeg)) return issue("angleDeg");
      return finiteTuple(operation.pullDirection) ? [] : issue("pullDirection");
    case "transform_part":
      if (operation.translationMm === undefined && operation.rotationDeg === undefined) return issue("transform");
      if (operation.translationMm !== undefined && !finiteTuple(operation.translationMm)) return issue("translationMm");
      return operation.rotationDeg === undefined || finiteTuple(operation.rotationDeg) ? [] : issue("rotationDeg");
    case "transform_part_delta":
      if (operation.translationDeltaMm === undefined && operation.rotationDeltaDeg === undefined) return issue("transformDelta");
      if (operation.translationDeltaMm !== undefined && !finiteTuple(operation.translationDeltaMm)) return issue("translationDeltaMm");
      return operation.rotationDeltaDeg === undefined || finiteTuple(operation.rotationDeltaDeg) ? [] : issue("rotationDeltaDeg");
    default:
      return [];
  }
}

export function buildCadEditImpact(
  transaction: AiEditTransaction,
): CadEditImpact {
  const scopes = [...new Set(transaction.operations.map(cadEditMutationScope))];
  if (scopes.length !== 1)
    throw new Error(
      "A deterministic impact plan requires exactly one mutation scope.",
    );
  const scope = scopes[0]!;
  const tails = {
    definition_geometry: [
      "kernel",
      "topology",
      "assembly_solve",
      "motion",
      "manufacturing",
      "roundtrip",
      "release",
    ],
    occurrence_transform: [
      "assembly_solve",
      "motion",
      "manufacturing",
      "roundtrip",
      "release",
    ],
    assembly_constraint: [
      "assembly_solve",
      "motion",
      "manufacturing",
      "roundtrip",
      "release",
    ],
    product_structure: [
      "decomposition",
      "kernel",
      "topology",
      "assembly_solve",
      "motion",
      "manufacturing",
      "roundtrip",
      "release",
    ],
  } satisfies Record<CadEditMutationScope, CadEditImpact["invalidatedStages"]>;
  return {
    scope,
    affectedPartIds: [...new Set(transaction.affected.parts)].sort(),
    invalidatedStages: [...tails[scope]],
    preservesDefinitionGeometry:
      scope === "occurrence_transform" || scope === "assembly_constraint",
  };
}

export function evaluateAiEditTransaction(
  transaction: AiEditTransaction,
  currentRevision: string,
): EditTransactionVerdict {
  const issues: string[] = [];
  if (transaction.version !== 1) issues.push("unsupported transaction version");
  if (!transaction.id.trim()) issues.push("transaction id is required");
  if (!transaction.userCommand.trim()) issues.push("user command is required");
  if (!transaction.rollbackSnapshot)
    issues.push("rollback snapshot is required");
  if (transaction.operations.length === 0)
    issues.push("at least one edit operation is required");
  for (const operation of transaction.operations)
    issues.push(...validateOperationNumbers(operation));
  if (transaction.baseRevision !== currentRevision)
    issues.push("base revision is stale");
  if (transaction.selection.projectRevision !== transaction.baseRevision) {
    issues.push("selection revision does not match transaction base revision");
  }
  if (transaction.unresolved.length > 0)
    issues.push("unresolved design inputs remain");
  const scopes = new Set(transaction.operations.map(cadEditMutationScope));
  if (scopes.size > 1)
    issues.push(
      `mixed mutation scopes are forbidden: ${[...scopes].sort().join(",")}`,
    );
  const affectedParts = new Set(transaction.affected.parts);
  const operationParts = [
    ...new Set(
      transaction.operations
        .map(operationPartId)
        .filter((partId): partId is string => partId !== null),
    ),
  ];
  for (const partId of operationParts)
    if (!affectedParts.has(partId))
      issues.push(`operation target is outside affected parts: ${partId}`);
  if (operationParts.length > 1)
    issues.push("one edit transaction may target only one part occurrence");
  const selectedPart =
    transaction.selection.partInstanceId ?? transaction.selection.bodyId;
  if (selectedPart && operationParts.some((partId) => partId !== selectedPart))
    issues.push(
      `operation target does not match selected part: ${selectedPart}`,
    );
  if (
    scopes.has("definition_geometry") &&
    !transaction.selection.featureId &&
    transaction.selection.topology.length === 0 &&
    transaction.selection.sketchEntityIds.length === 0
  )
    issues.push(
      "definition geometry edit requires a feature, topology, or sketch selection",
    );
  if (
    scopes.has("occurrence_transform") &&
    transaction.selection.topology.length > 0
  )
    issues.push(
      "occurrence transform must target the part occurrence, not a face or edge",
    );
  for (const check of transaction.preconditions) {
    if (check.status === "failed")
      issues.push(`${check.code}: ${check.message}`);
  }

  const derivedSelection = selectionRequiresConfirmation(transaction.selection);
  const explicitConfirmation = transaction.preconditions.some(
    (check) => check.status === "needs_confirmation",
  );
  const requiresConfirmation =
    derivedSelection ||
    transaction.assumptions.length > 0 ||
    explicitConfirmation;
  return { applicable: issues.length === 0, requiresConfirmation, issues };
}
