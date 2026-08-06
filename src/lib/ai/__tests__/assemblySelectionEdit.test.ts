import { describe, expect, it } from "vitest";
import { IDENTITY_QUAT } from "@/lib/assembly/assemblyState";
import { replayTree } from "@/lib/cad/featureTree";
import {
  assertAssemblySelectionEditCurrent,
  planAssemblySelectionEdit,
  planAssemblySelectionEdits,
} from "../assemblySelectionEdit";
const state = {
  parts: [
    {
      id: "p",
      name: "Plate",
      partTemplateId: "p",
      position: { x: 0, y: 0, z: 0 },
      orientation: IDENTITY_QUAT,
      fixed: true,
    },
  ],
  mates: [],
};
const trees = {
  p: {
    nodes: [
      {
        id: "e",
        name: "Base",
        dependencies: [],
        payload: {
          kind: "extrude" as const,
          loop: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
          depth: 5,
          direction: "one_sided" as const,
          mode: "add" as const,
        },
      },
      {
        id: "h",
        name: "Hole",
        dependencies: [],
        payload: {
          kind: "hole" as const,
          center: { x: 5, y: 5 },
          holeType: "drilled" as const,
          diameter: 4,
          depth: 5,
        },
      },
    ],
  },
};
describe("assembly selection edit transaction", () => {
  it("previews a hole diameter without mutating input", () => {
    const p = planAssemblySelectionEdit({
      state,
      featureTrees: trees,
      selection: [{ partId: "p", refId: "hole_axis_0", refKind: "axis" }],
      command: "홀 직경 8mm",
    });
    expect(p.nextFeatureTrees.p!.nodes[1]!.payload).toMatchObject({
      diameter: 8,
    });
    expect(trees.p.nodes[1]!.payload).toMatchObject({ diameter: 4 });
    assertAssemblySelectionEditCurrent(p, state, trees);
  });
  it("blocks stale apply", () => {
    const p = planAssemblySelectionEdit({
      state,
      featureTrees: trees,
      selection: [{ partId: "p", refId: "f.cap.top", refKind: "plane" }],
      command: "깊이 12mm",
    });
    expect(() =>
      assertAssemblySelectionEditCurrent(
        p,
        { ...state, parts: [{ ...state.parts[0]!, name: "changed" }] },
        trees,
      ),
    ).toThrow(/stale/);
  });
  it("requires occurrence-level selection for movement", () => {
    expect(() =>
      planAssemblySelectionEdit({
        state,
        featureTrees: trees,
        selection: [{ partId: "p", refId: "mesh-face:x", refKind: "face" }],
        command: "X축 9mm 이동",
      }),
    ).toThrow(/part occurrence selection/);
  });
  it("moves only an explicitly selected part occurrence", () => {
    const p = planAssemblySelectionEdit({
      state,
      featureTrees: trees,
      selection: [{ partId: "p", refId: "p", refKind: "part" }],
      command: "move X 9mm",
    });
    expect(p.nextState.parts[0]!.position.x).toBe(9);
    expect(p.nextFeatureTrees).toEqual(trees);
    assertAssemblySelectionEditCurrent(p, state, trees);
  });
});

describe("category and pattern selection edits", () => {
  it("stores an exact persistent edge and requires OCCT rather than widening the edit", () => {
    const preview = planAssemblySelectionEdit({
      state,
      featureTrees: trees,
      selection: [{ partId: "p", refId: "e.vert.0", refKind: "edge" }],
      command: "필렛 1mm",
    });
    expect(preview.nextFeatureTrees.p!.nodes.at(-1)!.payload).toMatchObject({
      kind: "fillet",
      edgeRefs: ["e.vert.0"],
    });
    expect(preview.transaction.operations[0]).toMatchObject({
      kind: "add_fillet",
      edgeRefs: ["e.vert.0"],
    });
    expect(() => replayTree(preview.nextFeatureTrees.p!)).toThrow(
      /requires OCCT/,
    );
  });

  it("adds a deterministic category fillet feature", () => {
    const preview = planAssemblySelectionEdit({
      state,
      featureTrees: trees,
      selection: [{ partId: "p", refId: "e.vert.0", refKind: "edge" }],
      command: "수직 모서리 모두 필렛 1mm",
    });
    expect(preview.nextFeatureTrees.p!.nodes.at(-1)).toMatchObject({
      id: "fillet-1",
      dependencies: ["e"],
      payload: {
        kind: "fillet",
        childId: "e",
        radius: 1,
        edgeSelection: "vertical",
      },
    });
    expect(preview.transaction.operations[0]).toMatchObject({
      kind: "add_fillet",
      edgeRefs: ["category:vertical"],
      radiusMm: 1,
    });
    expect(preview.transaction.affected.features).toEqual(["fillet-1"]);
  });

  it("updates linear pattern count and spacing", () => {
    const patternTrees = {
      p: {
        nodes: [
          trees.p.nodes[0]!,
          {
            id: "lp",
            name: "Array",
            dependencies: ["e"],
            payload: {
              kind: "linear_pattern" as const,
              childId: "e",
              childScad: "",
              count: 3,
              direction: { x: 1, y: 0, z: 0 },
              spacing: 10,
            },
          },
        ],
      },
    };
    const countPreview = planAssemblySelectionEdit({
      state,
      featureTrees: patternTrees,
      selection: [{ partId: "p", refId: "f.cap.top", refKind: "face" }],
      command: "패턴 개수 6개",
    });
    expect(countPreview.nextFeatureTrees.p!.nodes[1]!.payload).toMatchObject({
      count: 6,
      spacing: 10,
    });
    const spacingPreview = planAssemblySelectionEdit({
      state,
      featureTrees: patternTrees,
      selection: [{ partId: "p", refId: "f.cap.top", refKind: "face" }],
      command: "패턴 간격 14mm",
    });
    expect(spacingPreview.nextFeatureTrees.p!.nodes[1]!.payload).toMatchObject({
      count: 3,
      spacing: 14,
    });
  });
});

describe("face parameter and mate value edits", () => {
  it("offsets the selected top cap by changing total depth", () => {
    const preview = planAssemblySelectionEdit({
      state,
      featureTrees: trees,
      selection: [{ partId: "p", refId: "f.cap.top", refKind: "face" }],
      command: "선택 면 오프셋 -2mm",
    });
    expect(preview.nextFeatureTrees.p!.nodes[0]!.payload).toMatchObject({
      depth: 3,
    });
    expect(preview.transaction.operations[0]).toMatchObject({
      kind: "set_feature_parameter",
      parameter: "depth",
      value: 3,
      unit: "mm",
    });
  });

  it("rejects a top-cap offset that collapses the solid", () => {
    expect(() =>
      planAssemblySelectionEdit({
        state,
        featureTrees: trees,
        selection: [{ partId: "p", refId: "f.cap.top", refKind: "face" }],
        command: "면 오프셋 -5mm",
      }),
    ).toThrow(/collapse|invert/);
  });

  it("offsets one exact side face by editing its source profile edge", () => {
    const preview = planAssemblySelectionEdit({
      state,
      featureTrees: trees,
      selection: [{ partId: "p", refId: "f.side.1", refKind: "face" }],
      command: "face offset 2mm",
    });
    expect(preview.nextFeatureTrees.p!.nodes[0]!.payload).toMatchObject({
      loop: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 10 },
        { x: 0, y: 10 },
      ],
    });
    expect(preview.transaction.operations[0]).toMatchObject({
      kind: "set_feature_parameter",
      parameter: "side.1.offset",
      value: 2,
      unit: "mm",
    });
    expect(preview.evidence).toMatchObject({
      deltaVolumeMm3: 100,
      topologyValidation: "not_run",
    });
  });

  it("offsets the bottom cap while holding the top cap fixed", () => {
    const preview = planAssemblySelectionEdit({
      state,
      featureTrees: trees,
      selection: [{ partId: "p", refId: "f.cap.bottom", refKind: "face" }],
      command: "face offset 2mm",
    });
    expect(preview.nextFeatureTrees.p!.nodes[0]!.payload).toMatchObject({
      depth: 3,
      profileOffsetZ: 2,
    });
    expect(preview.transaction.operations[0]).toMatchObject({
      parameter: "bottom.offset",
      value: 2,
      unit: "mm",
    });
    expect(preview.evidence).toMatchObject({ deltaVolumeMm3: -200 });
  });

  it("sets draft from a selected extrude side face", () => {
    const preview = planAssemblySelectionEdit({
      state,
      featureTrees: trees,
      selection: [{ partId: "p", refId: "f.side.0", refKind: "face" }],
      command: "드래프트 각도 7도",
    });
    expect(preview.nextFeatureTrees.p!.nodes[0]!.payload).toMatchObject({
      draftDegrees: 7,
    });
    expect(preview.transaction.operations[0]).toMatchObject({
      parameter: "draftDegrees",
      value: 7,
      unit: "deg",
    });
  });

  it("edits exactly one selected distance mate without topology selection", () => {
    const mateState = {
      ...state,
      parts: [
        ...state.parts,
        {
          id: "q",
          name: "Pin",
          partTemplateId: "q",
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
        },
      ],
      mates: [
        {
          id: "gap",
          kind: "distance" as const,
          a: { partId: "p", refKind: "plane" as const, refId: "f.cap.top" },
          b: { partId: "q", refKind: "plane" as const, refId: "f.cap.bottom" },
          value: 4,
        },
      ],
    };
    const preview = planAssemblySelectionEdit({
      state: mateState,
      featureTrees: trees,
      selection: [],
      selectedMateIds: ["gap"],
      command: "메이트 거리 12mm",
    });
    expect(preview.nextState.mates[0]).toMatchObject({ id: "gap", value: 12 });
    expect(preview.transaction.operations[0]).toMatchObject({
      kind: "set_mate_parameter",
      mateId: "gap",
      parameter: "distance",
      value: 12,
      unit: "mm",
    });
    expect(preview.transaction.affected.mates).toEqual(["gap"]);
  });

  it("edits a selected angle mate in degrees", () => {
    const mateState = {
      ...state,
      parts: [
        ...state.parts,
        {
          id: "q",
          name: "Arm",
          partTemplateId: "q",
          position: { x: 0, y: 0, z: 0 },
          orientation: IDENTITY_QUAT,
        },
      ],
      mates: [
        {
          id: "tilt",
          kind: "angle" as const,
          a: { partId: "p", refKind: "face" as const, refId: "f.cap.top" },
          b: { partId: "q", refKind: "face" as const, refId: "f.cap.bottom" },
          value: 0,
        },
      ],
    };
    const preview = planAssemblySelectionEdit({
      state: mateState,
      featureTrees: trees,
      selection: [],
      selectedMateIds: ["tilt"],
      command: "메이트 각도 -35도",
    });
    expect(preview.nextState.mates[0]).toMatchObject({
      id: "tilt",
      value: -35,
    });
    expect(preview.transaction.operations[0]).toMatchObject({
      parameter: "angle",
      value: -35,
      unit: "deg",
    });
  });

  it("adds and then edits a reference-aware shell", () => {
    const created = planAssemblySelectionEdit({
      state,
      featureTrees: trees,
      selection: [{ partId: "p", refId: "f.cap.top", refKind: "face" }],
      command: "위쪽 면을 열고 쉘 두께 1mm",
    });
    expect(created.nextFeatureTrees.p!.nodes.at(-1)).toMatchObject({
      id: "shell-1",
      dependencies: ["e"],
      payload: { kind: "shell", childId: "e", thickness: 1, openTopFace: true },
    });
    expect(created.transaction.operations[0]).toMatchObject({
      kind: "add_shell",
      featureId: "shell-1",
      thicknessMm: 1,
      openTopFace: true,
    });
    const edited = planAssemblySelectionEdit({
      state,
      featureTrees: created.nextFeatureTrees,
      selection: [{ partId: "p", refId: "f.cap.top", refKind: "face" }],
      command: "쉘 두께 2mm",
    });
    expect(edited.nextFeatureTrees.p!.nodes.at(-1)!.payload).toMatchObject({
      kind: "shell",
      thickness: 2,
      openTopFace: true,
    });
    expect(edited.transaction.operations[0]).toMatchObject({
      kind: "set_feature_parameter",
      featureId: "shell-1",
      parameter: "thickness",
      value: 2,
    });
  });
});

describe("atomic multi-intent edits and evidence", () => {
  it("applies multiple intents to a temporary tree and emits one rollback transaction", () => {
    const preview = planAssemblySelectionEdits({
      state,
      featureTrees: trees,
      selection: [{ partId: "p", refId: "f.side.0", refKind: "face" }],
      command: "깊이 8mm 그리고 드래프트 4도",
    });
    expect(preview.nextFeatureTrees.p!.nodes[0]!.payload).toMatchObject({
      depth: 8,
      draftDegrees: 4,
    });
    expect(preview.transaction.operations).toHaveLength(2);
    expect(preview.transaction.rollbackSnapshot).toBe(
      JSON.stringify({ state, featureTrees: trees }),
    );
    expect(preview.evidence).toMatchObject({
      method: "feature-tree-estimate",
      partId: "p",
      deltaVolumeMm3: 300,
      topologyValidation: "not_run",
    });
    assertAssemblySelectionEditCurrent(preview, state, trees);
  });

  it("returns no partial result when a later intent fails", () => {
    expect(() =>
      planAssemblySelectionEdits({
        state,
        featureTrees: trees,
        selection: [{ partId: "p", refId: "f.side.0", refKind: "face" }],
        command: "깊이 8mm 그리고 쉘 두께 9mm",
      }),
    ).toThrow(/shell thickness/i);
    expect(trees.p.nodes[0]!.payload).toMatchObject({ depth: 5 });
  });
});

describe("revolve face edits", () => {
  it("offsets an exact cylindrical side through its source profile", () => {
    const revolveTrees = {
      p: {
        nodes: [
          {
            id: "r",
            name: "Cylinder",
            dependencies: [],
            payload: {
              kind: "revolve" as const,
              loop: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 20 },
                { x: 0, y: 20 },
              ],
              angleDegrees: 360,
              mode: "add" as const,
            },
          },
        ],
      },
    };
    const preview = planAssemblySelectionEdit({
      state,
      featureTrees: revolveTrees,
      selection: [{ partId: "p", refId: "f.side.1", refKind: "face" }],
      command: "face offset 2mm",
    });
    expect(preview.nextFeatureTrees.p!.nodes[0]!.payload).toMatchObject({
      kind: "revolve",
      loop: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 20 },
        { x: 0, y: 20 },
      ],
    });
    expect(preview.transaction.operations[0]).toMatchObject({
      parameter: "revolve.side.1.offset",
      value: 2,
    });
  });
});

describe("boolean provenance face edits", () => {
  it("edits the named source feature behind a composed boolean face", () => {
    const booleanTrees = {
      p: {
        nodes: [
          {
            id: "base",
            name: "Base",
            dependencies: [],
            payload: {
              kind: "extrude" as const,
              loop: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 },
              ],
              depth: 5,
              direction: "one_sided" as const,
              mode: "add" as const,
            },
          },
          {
            id: "tool",
            name: "Tool",
            dependencies: [],
            payload: {
              kind: "extrude" as const,
              loop: [
                { x: 2, y: 2 },
                { x: 4, y: 2 },
                { x: 4, y: 4 },
                { x: 2, y: 4 },
              ],
              depth: 7,
              direction: "one_sided" as const,
              mode: "add" as const,
            },
          },
          {
            id: "cut",
            name: "Cut",
            dependencies: ["base", "tool"],
            payload: {
              kind: "boolean" as const,
              op: "difference" as const,
              bodies: ["base", "tool"],
            },
          },
        ],
      },
    };
    const preview = planAssemblySelectionEdit({
      state,
      featureTrees: booleanTrees,
      selection: [{ partId: "p", refId: "base/f.side.1", refKind: "face" }],
      command: "face offset 2mm",
    });
    expect(preview.nextFeatureTrees.p!.nodes[0]!.payload).toMatchObject({
      loop: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 10 },
        { x: 0, y: 10 },
      ],
    });
    expect(preview.nextFeatureTrees.p!.nodes[1]!.payload).toEqual(
      booleanTrees.p.nodes[1]!.payload,
    );
  });
});
