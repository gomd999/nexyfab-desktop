import fs from "node:fs";
import path from "node:path";

const reviewRoot = path.resolve(
  process.argv[2] ?? "docs/evidence/complex-holdout-review-260806",
);
const output = path.resolve(
  process.argv[3] ??
    "docs/evidence/external-step-structure-coverage-260806/run-1.json",
);
const resultBatchPath = path.resolve(
  process.argv[4] ?? path.join(reviewRoot, "freecad-all-results.json"),
);
const families = [
  "robot",
  "gearbox",
  "pressure_vessel",
  "turbomachinery",
  "factory_equipment",
  "interior",
] as const;
type ReviewItem = {
  caseId: string;
  family: string;
  groundTruthApproved: boolean;
};
const reviewItems = families.flatMap((family) => {
  const value = JSON.parse(
    fs.readFileSync(path.join(reviewRoot, `${family}.review.json`), "utf8"),
  ) as { items: ReviewItem[] };
  return value.items;
});
const familyByCase = new Map(
  reviewItems.map((item) => [item.caseId, item.family]),
);
const batch = JSON.parse(
  fs.readFileSync(resultBatchPath, "utf8"),
) as {
  results: Array<{
    caseId: string;
    sourceHash: string;
    definitions: Array<{ id: string; kind: string; name: string; bodyCount?: number; bodyCountSource?: string }>;
    occurrences: Array<{
      id: string;
      definitionId: string;
      parentOccurrenceId: string | null;
      localToParent: number[];
    }>;
    joints: unknown[];
    jointSemanticsComplete: boolean;
  }>;
};

const results = batch.results.map((item) => {
  const codes: string[] = [];
  const definitions = new Set(
    item.definitions.map((definition) => definition.id),
  );
  const occurrences = new Map(
    item.occurrences.map((occurrence) => [occurrence.id, occurrence]),
  );
  if (!definitions.size) codes.push("EXTERNAL_STEP_DEFINITIONS_EMPTY");
  if (!occurrences.size) codes.push("EXTERNAL_STEP_OCCURRENCES_EMPTY");
  const parts = item.definitions.filter((definition) => definition.kind === "part");
  const bodyMembershipAvailable = parts.length > 0 && parts.every((definition) => definition.bodyCount !== undefined);
  if (bodyMembershipAvailable) for (const definition of parts) {
    if (!Number.isInteger(definition.bodyCount) || definition.bodyCount! < 1 || definition.bodyCountSource !== "native_shape_solids") codes.push(`EXTERNAL_STEP_BODY_MEMBERSHIP_INVALID:${definition.id}`);
  }
  for (const occurrence of item.occurrences) {
    if (!definitions.has(occurrence.definitionId))
      codes.push(`EXTERNAL_STEP_DEFINITION_REF_MISSING:${occurrence.id}`);
    if (
      occurrence.parentOccurrenceId !== null &&
      !occurrences.has(occurrence.parentOccurrenceId)
    )
      codes.push(`EXTERNAL_STEP_PARENT_REF_MISSING:${occurrence.id}`);
    if (
      occurrence.localToParent.length !== 16 ||
      !occurrence.localToParent.every(Number.isFinite)
    )
      codes.push(`EXTERNAL_STEP_TRANSFORM_INVALID:${occurrence.id}`);
  }
  const roots = item.occurrences.filter(
    (occurrence) => occurrence.parentOccurrenceId === null,
  ).length;
  if (roots < 1) codes.push("EXTERNAL_STEP_ROOT_MISSING");
  for (const occurrence of item.occurrences) {
    const visited = new Set<string>();
    let cursor: typeof occurrence | undefined = occurrence;
    while (cursor?.parentOccurrenceId) {
      if (visited.has(cursor.id)) {
        codes.push(`EXTERNAL_STEP_HIERARCHY_CYCLE:${occurrence.id}`);
        break;
      }
      visited.add(cursor.id);
      cursor = occurrences.get(cursor.parentOccurrenceId);
    }
  }
  return {
    caseId: item.caseId,
    family: familyByCase.get(item.caseId) ?? "unknown",
    sourceHash: item.sourceHash,
    status: codes.length ? "fail" : "pass",
    codes: [...new Set(codes)].sort(),
    measured: {
      definitions: item.definitions.length,
      occurrences: item.occurrences.length,
      roots,
      transforms: item.occurrences.length,
      parts: parts.length,
      bodies: bodyMembershipAvailable ? parts.reduce((sum, definition) => sum + definition.bodyCount!, 0) : null,
    },
    axes: {
      hierarchy: codes.some(
        (code) =>
          code.includes("HIERARCHY") ||
          code.includes("ROOT") ||
          code.includes("PARENT"),
      )
        ? "fail"
        : "pass",
      transforms: codes.some((code) => code.includes("TRANSFORM"))
        ? "fail"
        : "pass",
      bodyMembership: !bodyMembershipAvailable ? "not_run" : codes.some((code) => code.includes("BODY_MEMBERSHIP")) ? "fail" : "pass",
      joints: item.jointSemanticsComplete ? "pass" : "not_run",
    },
  };
});
const byFamily = Object.fromEntries(
  families.map((family) => {
    const selected = reviewItems.filter(
      (item) => item.family === family,
    ).length;
    const executed = results.filter((item) => item.family === family);
    return [
      family,
      {
        selected,
        executed: executed.length,
        executionCoverage: selected ? executed.length / selected : 0,
        structuralPass: executed.filter((item) => item.status === "pass")
          .length,
        structuralPassRate: executed.length
          ? executed.filter((item) => item.status === "pass").length /
            executed.length
          : null,
      },
    ];
  }),
);
const artifact = {
  schema: "nexyfab.external-step-structure-coverage.v1",
  generatedAt: new Date().toISOString(),
  status: results.some((item) => item.status === "fail") ? "fail" : "pass",
  scoreEligible: false,
  groundTruthApprovedCases: reviewItems.filter(
    (item) => item.groundTruthApproved,
  ).length,
  scope:
    "Read-only structure coverage over existing external FreeCAD extraction metadata; no source bytes copied and not an accuracy claim.",
  summary: {
    selected: reviewItems.length,
    executed: results.length,
    executionCoverage: reviewItems.length
      ? results.length / reviewItems.length
      : 0,
    structuralPass: results.filter((item) => item.status === "pass").length,
    structuralFail: results.filter((item) => item.status === "fail").length,
    bodyMembershipNotRun: results.filter(
      (item) => item.axes.bodyMembership === "not_run",
    ).length,
    bodyMembershipPass: results.filter(
      (item) => item.axes.bodyMembership === "pass",
    ).length,
    jointsNotRun: results.filter((item) => item.axes.joints === "not_run")
      .length,
  },
  byFamily,
  results,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify({
    output: path.relative(process.cwd(), output),
    ...artifact.summary,
  }),
);
if (artifact.status === "fail") process.exitCode = 1;
