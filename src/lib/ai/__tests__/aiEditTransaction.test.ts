import { describe, expect, it } from "vitest";
import type { AiEditTransaction } from "../aiEditTransaction";
import {
  buildCadEditImpact,
  evaluateAiEditTransaction,
} from "../aiEditTransaction";
import type { SelectionContext } from "../selectionContext";

const selection: SelectionContext = {
  version: 1,
  projectRevision: "rev-7",
  assemblyPath: ["main"],
  partInstanceId: "bracket-1",
  featureId: "extrude-1",
  topology: [
    {
      kind: "face",
      persistentRef: "face:extrude-1:top",
      referenceQuality: "persistent",
      semanticRole: "positive_z_face",
      geometrySignature: "face:n=0,0,1:p=0,0,5:a=100",
    },
  ],
  sketchEntityIds: [],
  mateIds: [],
  coordinateFrame: "world",
  units: "mm",
};

const transaction: AiEditTransaction = {
  version: 1,
  id: "edit-1",
  baseRevision: "rev-7",
  userCommand: "이 면을 10mm 늘려줘",
  selection,
  observations: ["selected face is produced by extrude-1"],
  assumptions: [],
  unresolved: [],
  operations: [
    {
      kind: "set_feature_parameter",
      partId: "bracket-1",
      featureId: "extrude-1",
      parameter: "depth",
      value: 15,
      unit: "mm",
    },
  ],
  affected: {
    parts: ["bracket-1"],
    features: ["extrude-1"],
    mates: [],
    drawings: ["drawing-1"],
  },
  preconditions: [
    {
      code: "REF-PERSISTENT",
      status: "passed",
      message: "face reference resolved",
    },
  ],
  rollbackSnapshot: "snapshot:rev-7",
};

describe("evaluateAiEditTransaction", () => {
  it("allows a revision-matched persistent local edit", () => {
    expect(evaluateAiEditTransaction(transaction, "rev-7")).toEqual({
      applicable: true,
      requiresConfirmation: false,
      issues: [],
    });
  });

  it("rejects a stale transaction instead of editing a newer model", () => {
    expect(evaluateAiEditTransaction(transaction, "rev-8").issues).toContain(
      "base revision is stale",
    );
  });

  it("blocks unresolved dimensions", () => {
    const result = evaluateAiEditTransaction(
      { ...transaction, unresolved: ["target depth"] },
      "rev-7",
    );
    expect(result.applicable).toBe(false);
    expect(result.issues).toContain("unresolved design inputs remain");
  });

  it("requires confirmation for a derived topology reference or AI assumption", () => {
    const derived: AiEditTransaction = {
      ...transaction,
      assumptions: ["user meant total depth, not offset"],
      selection: {
        ...selection,
        topology: [{ ...selection.topology[0]!, referenceQuality: "derived" }],
      },
    };
    const result = evaluateAiEditTransaction(derived, "rev-7");
    expect(result.applicable).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
  });

  it("forbids mixing definition geometry and occurrence movement in one transaction", () => {
    const result = evaluateAiEditTransaction(
      {
        ...transaction,
        operations: [
          ...transaction.operations,
          {
            kind: "transform_part",
            partId: "bracket-1",
            translationMm: [10, 0, 0],
          },
        ],
      },
      "rev-7",
    );
    expect(result.applicable).toBe(false);
    expect(result.issues[0]).toContain("mixed mutation scopes");
  });

  it("rejects an operation aimed at an unselected or undeclared part", () => {
    const result = evaluateAiEditTransaction(
      {
        ...transaction,
        operations: [
          {
            kind: "set_feature_parameter",
            partId: "bracket-2",
            featureId: "extrude-1",
            parameter: "depth",
            value: 15,
            unit: "mm",
          },
        ],
      },
      "rev-7",
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        "operation target is outside affected parts: bracket-2",
        "operation target does not match selected part: bracket-1",
      ]),
    );
  });

  it("requires occurrence-level selection for a part transform", () => {
    const result = evaluateAiEditTransaction(
      {
        ...transaction,
        operations: [
          {
            kind: "transform_part",
            partId: "bracket-1",
            translationMm: [10, 0, 0],
          },
        ],
      },
      "rev-7",
    );
    expect(result.issues).toContain(
      "occurrence transform must target the part occurrence, not a face or edge",
    );
  });

  it("invalidates kernel and topology only for definition edits", () => {
    expect(buildCadEditImpact(transaction)).toMatchObject({
      scope: "definition_geometry",
      affectedPartIds: ["bracket-1"],
      preservesDefinitionGeometry: false,
      invalidatedStages: [
        "kernel",
        "topology",
        "assembly_solve",
        "motion",
        "manufacturing",
        "roundtrip",
        "release",
      ],
    });
    const moved: AiEditTransaction = {
      ...transaction,
      selection: { ...selection, featureId: undefined, topology: [] },
      operations: [
        {
          kind: "transform_part",
          partId: "bracket-1",
          translationMm: [10, 0, 0],
        },
      ],
    };
    expect(buildCadEditImpact(moved)).toMatchObject({
      scope: "occurrence_transform",
      preservesDefinitionGeometry: true,
      invalidatedStages: [
        "assembly_solve",
        "motion",
        "manufacturing",
        "roundtrip",
        "release",
      ],
    });
  });

  it("refuses a deterministic impact plan for mixed scopes", () => {
    expect(() =>
      buildCadEditImpact({
        ...transaction,
        operations: [
          ...transaction.operations,
          { kind: "transform_part", partId: "bracket-1" },
        ],
      }),
    ).toThrow(/exactly one mutation scope/);
  });
});
