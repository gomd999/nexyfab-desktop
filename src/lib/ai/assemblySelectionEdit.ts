import type { AssemblyState } from "@/lib/assembly/assemblyState";
import type { FeatureTree } from "@/lib/cad/featureTree";
import { validateTree } from "@/lib/cad/featureTree";
import {
  buildCadEditImpact,
  evaluateAiEditTransaction,
  type AiEditTransaction,
  type CadEditImpact,
  type CadEditOperation,
} from "./aiEditTransaction";
import {
  modelContentRevision,
  type SelectionContext,
} from "./selectionContext";
import {
  buildFilletFeatureRef,
  type FilletEdgeSelection,
} from "@/lib/cad/filletProfile";
import {
  buildChamferFeatureRef,
  type ChamferEdgeSelection,
} from "@/lib/cad/chamferProfile";
import type { ExtrudeFeature } from "@/lib/cad/extrudeProfile";
import { validateMate } from "@/lib/assembly/mate";
import { buildShellFeatureRef } from "@/lib/cad/shellProfile";
import { computeStats, type Bbox } from "@/lib/cad/featureTreeStats";
import { offsetExtrudeSide } from "@/lib/cad/offsetExtrudeSide";
import { offsetRevolveSide } from "@/lib/cad/offsetRevolveSide";
import type { RevolveFeature } from "@/lib/cad/revolveProfile";
import { diffTrees } from "@/lib/cad/featureTreeEdit";

export type AssemblySelectionEditEvidence = {
  method: "feature-tree-estimate" | "exact-brep";
  partId: string;
  changedFeatureIds: string[];
  addedFeatureIds: string[];
  removedFeatureIds: string[];
  before: {
    volumeMm3: number;
    bbox: Bbox;
    solidCount?: number;
    faceCount?: number;
    edgeCount?: number;
    valid?: boolean;
  };
  after: {
    volumeMm3: number;
    bbox: Bbox;
    solidCount?: number;
    faceCount?: number;
    edgeCount?: number;
    valid?: boolean;
  };
  deltaVolumeMm3: number;
  topologyValidation: "not_run" | "passed" | "failed";
  kernelError?: string;
};
export type AssemblySelectionEditPreview = {
  transaction: AiEditTransaction;
  impact: CadEditImpact;
  nextState: AssemblyState;
  nextFeatureTrees: Record<string, FeatureTree>;
  summary: string;
  evidence?: AssemblySelectionEditEvidence;
};
export type AssemblySelectionRef = {
  partId: string;
  refId: string;
  refKind: "part" | "face" | "edge" | "axis" | "plane" | "point";
};

function uniqueFeatureId(tree: FeatureTree, prefix: string): string {
  const used = new Set(tree.nodes.map((node) => node.id));
  let suffix = 1;
  while (used.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
}

export function planAssemblySelectionEdit(input: {
  state: AssemblyState;
  featureTrees: Record<string, FeatureTree>;
  selection: readonly AssemblySelectionRef[];
  selectedMateIds?: readonly string[];
  command: string;
}): AssemblySelectionEditPreview {
  const command = input.command.trim();
  if (!command) throw new Error("Edit command is required.");
  const mateEdit = /메이트|mate/i.test(command);
  const selectedMateIds = [...new Set(input.selectedMateIds ?? [])];
  const partIds = [...new Set(input.selection.map((ref) => ref.partId))];
  if (mateEdit) {
    if (selectedMateIds.length !== 1)
      throw new Error("Select exactly one mate to edit its value.");
  } else if (partIds.length !== 1)
    throw new Error("Select references from exactly one part.");
  const selectedMate = mateEdit
    ? input.state.mates.find((item) => item.id === selectedMateIds[0])
    : undefined;
  if (mateEdit && !selectedMate)
    throw new Error(`Selected mate ${selectedMateIds[0]} does not exist.`);
  const partId = partIds[0] ?? selectedMate!.a.partId,
    part = input.state.parts.find((item) => item.id === partId);
  if (!part) throw new Error(`Selected part ${partId} does not exist.`);
  const valueMatch = command.match(/(-?\d+(?:\.\d+)?)\s*mm\b/i);
  const value = valueMatch ? Number(valueMatch[1]) : NaN;
  const revision = modelContentRevision({
      state: input.state,
      featureTrees: input.featureTrees,
    }),
    operations: CadEditOperation[] = [];
  let nextState = input.state,
    nextFeatureTrees = { ...input.featureTrees },
    summary = "";
  const axis = command.match(/(?:^|\s)([xyz])\s*(?:축)?(?=\s|\d|-|$)/i);
  if (mateEdit) {
    const mate = selectedMate!;
    const angleValueMatch = command.match(
      /(-?\d+(?:\.\d+)?)\s*(?:°|도|deg(?:ree)?s?\b)/i,
    );
    if (mate.kind === "distance") {
      if (!Number.isFinite(value) || value < 0)
        throw new Error("Distance mate requires a non-negative value in mm.");
      const nextMate = { ...mate, value };
      validateMate(nextMate);
      nextState = {
        ...input.state,
        mates: input.state.mates.map((item) =>
          item.id === mate.id ? nextMate : item,
        ),
      };
      operations.push({
        kind: "set_mate_parameter",
        mateId: mate.id,
        parameter: "distance",
        value,
        unit: "mm",
      });
      summary = `Mate ${mate.id} · distance = ${value} mm`;
    } else if (mate.kind === "angle") {
      const angleValue = angleValueMatch ? Number(angleValueMatch[1]) : NaN;
      if (!Number.isFinite(angleValue) || angleValue < -180 || angleValue > 180)
        throw new Error(
          "Angle mate requires a value from -180 to 180 degrees.",
        );
      const nextMate = { ...mate, value: angleValue };
      validateMate(nextMate);
      nextState = {
        ...input.state,
        mates: input.state.mates.map((item) =>
          item.id === mate.id ? nextMate : item,
        ),
      };
      operations.push({
        kind: "set_mate_parameter",
        mateId: mate.id,
        parameter: "angle",
        value: angleValue,
        unit: "deg",
      });
      summary = `Mate ${mate.id} · angle = ${angleValue} deg`;
    } else
      throw new Error(`Mate ${mate.id} has no directly editable scalar value.`);
  } else if (/이동|move|translate/i.test(command) && axis) {
    if (!input.selection.some((ref) => ref.refKind === "part"))
      throw new Error(
        "Move command requires an explicit part occurrence selection.",
      );
    if (
      input.selection.some(
        (ref) => ref.refKind === "face" || ref.refKind === "edge",
      )
    )
      throw new Error(
        "Move the part occurrence, or issue a separate face/edge geometry edit.",
      );
    if (!Number.isFinite(value))
      throw new Error("Move command requires one value in mm.");
    const key = axis[1]!.toLowerCase() as "x" | "y" | "z";
    const delta = { x: 0, y: 0, z: 0 };
    delta[key] = value;
    nextState = {
      ...input.state,
      parts: input.state.parts.map((item) =>
        item.id === partId
          ? {
              ...item,
              position: {
                x: item.position.x + delta.x,
                y: item.position.y + delta.y,
                z: item.position.z + delta.z,
              },
            }
          : item,
      ),
    };
    operations.push({
      kind: "transform_part",
      partId,
      translationMm: [delta.x, delta.y, delta.z],
    });
    summary = `${part.name} ${key.toUpperCase()} ${value} mm`;
  } else {
    const tree = input.featureTrees[partId];
    if (!tree) throw new Error(`Part ${partId} has no editable FeatureTree.`);
    const edgeRef = input.selection
      .map((ref) => ref.refId)
      .find((ref) => ref.startsWith("e."));
    const roundKind = /필렛|fillet/i.test(command)
      ? "fillet"
      : /모따기|챔퍼|chamfer/i.test(command)
        ? "chamfer"
        : null;
    if (roundKind) {
      if (!edgeRef)
        throw new Error(`Select an extrude edge before adding ${roundKind}.`);
      if (!Number.isFinite(value) || value <= 0)
        throw new Error(`${roundKind} requires a positive value in mm.`);
      const baseNode = [...tree.nodes]
        .reverse()
        .find((node) => node.payload.kind === "extrude");
      if (!baseNode)
        throw new Error(`${roundKind} currently requires an extrude body.`);
      const category = (
        edgeRef.startsWith("e.vert.")
          ? "vertical"
          : edgeRef.startsWith("e.top.")
            ? "top"
            : edgeRef.startsWith("e.bottom.")
              ? "bottom"
              : null
      ) as FilletEdgeSelection | null;
      if (!category)
        throw new Error(`Edge ${edgeRef} is not supported by ${roundKind}.`);
      const categoryWide = /모두|all/i.test(command);
      const built =
        roundKind === "fillet"
          ? buildFilletFeatureRef(
              baseNode.id,
              baseNode.payload as ExtrudeFeature,
              value,
              category,
            )
          : buildChamferFeatureRef(
              baseNode.id,
              baseNode.payload as ExtrudeFeature,
              value,
              category as ChamferEdgeSelection,
            );
      const payload = categoryWide ? built : { ...built, edgeRefs: [edgeRef] };
      const featureId = uniqueFeatureId(tree, roundKind),
        nextTree = {
          ...tree,
          nodes: [
            ...tree.nodes,
            {
              id: featureId,
              name: `${roundKind === "fillet" ? "Fillet" : "Chamfer"} ${value} mm (${categoryWide ? category : edgeRef})`,
              dependencies: [baseNode.id],
              payload,
            },
          ],
        };
      validateTree(nextTree);
      nextFeatureTrees = { ...input.featureTrees, [partId]: nextTree };
      const operationRefs = categoryWide ? [`category:${category}`] : [edgeRef];
      operations.push(
        roundKind === "fillet"
          ? {
              kind: "add_fillet",
              partId,
              edgeRefs: operationRefs,
              radiusMm: value,
            }
          : {
              kind: "add_chamfer",
              partId,
              edgeRefs: operationRefs,
              distanceMm: value,
            },
      );
      summary = categoryWide
        ? `${part.name} · ${category} edges all · ${roundKind} ${value} mm`
        : `${part.name} · exact edge ${edgeRef} · ${roundKind} ${value} mm · OCCT required`;
    } else if (/쉘|shell/i.test(command)) {
      if (!Number.isFinite(value) || value <= 0)
        throw new Error("Shell thickness requires a positive value in mm.");
      const baseNode = [...tree.nodes]
        .reverse()
        .find((node) => node.payload.kind === "extrude");
      if (!baseNode)
        throw new Error("Shell currently requires an extrude body.");
      const selectedCap = input.selection.find(
          (ref) => ref.refId === "f.cap.top" || ref.refId === "f.cap.bottom",
        ),
        wantsOpen = /열|open|제거|remove/i.test(command);
      const shellIndex =
        tree.nodes
          .map((node, index) => ({ node, index }))
          .reverse()
          .find((item) => item.node.payload.kind === "shell")?.index ?? -1;
      const previous = shellIndex >= 0 ? tree.nodes[shellIndex]!.payload : null;
      const openTopFace =
        (previous?.kind === "shell" && !!previous.openTopFace) ||
        (wantsOpen && selectedCap?.refId === "f.cap.top");
      const openBottomFace =
        (previous?.kind === "shell" && !!previous.openBottomFace) ||
        (wantsOpen && selectedCap?.refId === "f.cap.bottom");
      const payload = buildShellFeatureRef(
        baseNode.id,
        baseNode.payload as ExtrudeFeature,
        value,
        { openTopFace, openBottomFace },
      );
      if (shellIndex >= 0) {
        const node = tree.nodes[shellIndex]!,
          nextNode = { ...node, payload, name: `Shell ${value} mm` },
          nextTree = {
            ...tree,
            nodes: tree.nodes.map((item, index) =>
              index === shellIndex ? nextNode : item,
            ),
          } as FeatureTree;
        validateTree(nextTree);
        nextFeatureTrees = { ...input.featureTrees, [partId]: nextTree };
        operations.push({
          kind: "set_feature_parameter",
          partId,
          featureId: node.id,
          parameter: "thickness",
          value,
          unit: "mm",
        });
        summary = `${part.name} · shell thickness = ${value} mm${openTopFace ? " · top open" : ""}${openBottomFace ? " · bottom open" : ""}`;
      } else {
        const featureId = uniqueFeatureId(tree, "shell"),
          nextTree = {
            ...tree,
            nodes: [
              ...tree.nodes,
              {
                id: featureId,
                name: `Shell ${value} mm`,
                dependencies: [baseNode.id],
                payload,
              },
            ],
          };
        validateTree(nextTree);
        nextFeatureTrees = { ...input.featureTrees, [partId]: nextTree };
        operations.push({
          kind: "add_shell",
          partId,
          featureId,
          thicknessMm: value,
          openTopFace,
          openBottomFace,
        });
        summary = `${part.name} · shell ${value} mm${openTopFace ? " · top open" : ""}${openBottomFace ? " · bottom open" : ""}`;
      }
    } else if (/드래프트|구배|draft/i.test(command)) {
      if (!input.selection.some((ref) => /^f\.side\./.test(ref.refId)))
        throw new Error("Select an extrude side face before editing draft.");
      const angleMatch = command.match(
          /(-?\d+(?:\.\d+)?)\s*(?:°|도|deg(?:ree)?s?\b)/i,
        ),
        angle = angleMatch ? Number(angleMatch[1]) : NaN;
      if (!Number.isFinite(angle) || Math.abs(angle) > 30)
        throw new Error("Draft angle must be from -30 to 30 degrees.");
      const targetIndex = tree.nodes.findIndex(
        (node) => node.payload.kind === "extrude",
      );
      if (targetIndex < 0)
        throw new Error("Selected face has no editable extrude provenance.");
      const node = tree.nodes[targetIndex]!,
        nextNode = {
          ...node,
          payload: { ...node.payload, draftDegrees: angle },
        },
        nextTree = {
          ...tree,
          nodes: tree.nodes.map((item, index) =>
            index === targetIndex ? nextNode : item,
          ),
        } as FeatureTree;
      validateTree(nextTree);
      nextFeatureTrees = { ...input.featureTrees, [partId]: nextTree };
      operations.push({
        kind: "set_feature_parameter",
        partId,
        featureId: node.id,
        parameter: "draftDegrees",
        value: angle,
        unit: "deg",
      });
      summary = `${part.name} · ${node.name} · draft = ${angle} deg`;
    } else if (/오프셋|offset/i.test(command)) {
      const selectedFace = input.selection.find(
        (ref) => ref.refId.includes("f.cap.") || ref.refId.includes("f.side."),
      );
      if (!selectedFace)
        throw new Error(
          "Select an extrude cap or side face before offsetting it.",
        );
      const refSegments = selectedFace.refId.split("/"),
        localAt = refSegments.findIndex(
          (segment) =>
            segment.startsWith("f.cap.") || segment.startsWith("f.side."),
        );
      if (localAt < 0)
        throw new Error(
          `Selected face ${selectedFace.refId} has no generative face suffix.`,
        );
      const face = { ...selectedFace, refId: refSegments[localAt]! };
      const ownerId = [...refSegments.slice(0, localAt)]
        .reverse()
        .find((segment) => tree.nodes.some((node) => node.id === segment));
      if (!Number.isFinite(value) || value === 0)
        throw new Error("Face offset requires a non-zero signed value in mm.");
      const extrudeIndex = tree.nodes.findIndex(
        (node) =>
          node.payload.kind === "extrude" && (!ownerId || node.id === ownerId),
      );
      const revolveIndex = tree.nodes.findIndex(
        (node) =>
          node.payload.kind === "revolve" && (!ownerId || node.id === ownerId),
      );
      const targetIndex =
        face.refId.startsWith("f.side.") && extrudeIndex < 0
          ? revolveIndex
          : extrudeIndex;
      if (targetIndex < 0)
        throw new Error(
          "Selected face has no editable extrude or revolve provenance.",
        );
      const node = tree.nodes[targetIndex]!;
      if (node.payload.kind === "revolve") {
        const sideIndex = Number(face.refId.slice("f.side.".length));
        const payload = offsetRevolveSide(
          node.payload as RevolveFeature,
          sideIndex,
          value,
        );
        const nextNode = { ...node, payload },
          nextTree = {
            ...tree,
            nodes: tree.nodes.map((item, index) =>
              index === targetIndex ? nextNode : item,
            ),
          } as FeatureTree;
        validateTree(nextTree);
        nextFeatureTrees = { ...input.featureTrees, [partId]: nextTree };
        operations.push({
          kind: "set_feature_parameter",
          partId,
          featureId: node.id,
          parameter: `revolve.side.${sideIndex}.offset`,
          value,
          unit: "mm",
        });
        summary = `${part.name} · exact revolve ${selectedFace.refId} offset ${value} mm · profile updated`;
      } else {
        const extrude = node.payload as ExtrudeFeature;
        let payload: ExtrudeFeature, parameter: string, nextValue: number;
        if (face.refId === "f.cap.top") {
          const depth = extrude.depth + value;
          if (depth <= 0)
            throw new Error(
              "Face offset would collapse or invert the extrude depth.",
            );
          payload = { ...extrude, depth };
          parameter = "depth";
          nextValue = depth;
          summary = `${part.name} · top face offset ${value} mm · depth = ${depth} mm`;
        } else if (face.refId === "f.cap.bottom") {
          if (extrude.direction !== "one_sided")
            throw new Error(
              "Bottom-cap offset currently requires a one-sided extrude.",
            );
          const depth = extrude.depth - value;
          if (depth <= 0)
            throw new Error(
              "Bottom face offset would collapse or invert the extrude depth.",
            );
          payload = {
            ...extrude,
            depth,
            profileOffsetZ: (extrude.profileOffsetZ ?? 0) + value,
          };
          parameter = "bottom.offset";
          nextValue = value;
          summary = `${part.name} · bottom face offset ${value} mm · profile Z = ${payload.profileOffsetZ} mm · depth = ${depth} mm`;
        } else {
          const sideIndex = Number(face.refId.slice("f.side.".length));
          payload = {
            ...extrude,
            loop: offsetExtrudeSide(extrude.loop, sideIndex, value),
          };
          parameter = `side.${sideIndex}.offset`;
          nextValue = value;
          summary = `${part.name} · exact ${selectedFace.refId} offset ${value} mm · profile updated`;
        }
        const nextNode = { ...node, payload },
          nextTree = {
            ...tree,
            nodes: tree.nodes.map((item, index) =>
              index === targetIndex ? nextNode : item,
            ),
          } as FeatureTree;
        validateTree(nextTree);
        nextFeatureTrees = { ...input.featureTrees, [partId]: nextTree };
        operations.push({
          kind: "set_feature_parameter",
          partId,
          featureId: node.id,
          parameter,
          value: nextValue,
          unit: "mm",
        });
      }
    } else if (/패턴|pattern/i.test(command)) {
      const targetIndex =
        tree.nodes
          .map((node, index) => ({ node, index }))
          .reverse()
          .find(
            (item) =>
              item.node.payload.kind === "linear_pattern" ||
              item.node.payload.kind === "circular_pattern",
          )?.index ?? -1;
      if (targetIndex < 0)
        throw new Error("Part has no editable pattern feature.");
      const node = tree.nodes[targetIndex]!,
        countMatch = command.match(
          /(?:수량|개수|count)\s*(?:을|를|=|:)?\s*(\d+)|(?<!\d)(\d+)\s*개/i,
        );
      let parameter: "count" | "spacing", nextValue: number;
      if (countMatch) {
        parameter = "count";
        nextValue = Number(countMatch[1] ?? countMatch[2]);
        if (!Number.isInteger(nextValue) || nextValue < 1 || nextValue > 1000)
          throw new Error("Pattern count must be an integer from 1 to 1000.");
      } else {
        if (
          node.payload.kind !== "linear_pattern" ||
          !/간격|spacing/i.test(command) ||
          !Number.isFinite(value) ||
          value <= 0
        )
          throw new Error(
            "Specify pattern count, or linear-pattern spacing in mm.",
          );
        parameter = "spacing";
        nextValue = value;
      }
      const nextNode = {
          ...node,
          payload: { ...node.payload, [parameter]: nextValue },
        },
        nextTree = {
          ...tree,
          nodes: tree.nodes.map((item, index) =>
            index === targetIndex ? nextNode : item,
          ),
        } as FeatureTree;
      validateTree(nextTree);
      nextFeatureTrees = { ...input.featureTrees, [partId]: nextTree };
      operations.push({
        kind: "set_feature_parameter",
        partId,
        featureId: node.id,
        parameter,
        value: nextValue,
        unit: parameter === "count" ? "1" : "mm",
      });
      summary = `${part.name} · ${node.name} · ${parameter} = ${nextValue}${parameter === "spacing" ? " mm" : ""}`;
    } else {
      const holeRef = input.selection
        .map((ref) => ref.refId)
        .find((ref) => /^hole_axis_\d+$/.test(ref));
      let targetIndex = -1,
        parameter: "diameter" | "depth";
      if (holeRef) {
        const ordinal = Number(holeRef.split("_").at(-1)),
          holes = tree.nodes
            .map((node, index) => ({ node, index }))
            .filter((item) => item.node.payload.kind === "hole");
        targetIndex = holes[ordinal]?.index ?? -1;
        if (targetIndex < 0)
          throw new Error(`Selected hole reference ${holeRef} is stale.`);
        parameter = /직경|지름|diameter/i.test(command)
          ? "diameter"
          : /깊이|depth/i.test(command)
            ? "depth"
            : (() => {
                throw new Error("Hole edit must specify diameter or depth.");
              })();
      } else {
        if (
          !input.selection.some((ref) => /^f\.(?:cap|side)\./.test(ref.refId))
        )
          throw new Error("Select an extrude face or a hole cylindrical face.");
        targetIndex = tree.nodes.findIndex(
          (node) => node.payload.kind === "extrude",
        );
        if (targetIndex < 0)
          throw new Error("Selected face has no editable extrude provenance.");
        if (!/깊이|높이|depth|height/i.test(command))
          throw new Error("Extrude edit must specify depth or height.");
        parameter = "depth";
      }
      if (!Number.isFinite(value) || value <= 0)
        throw new Error(`${parameter} requires a positive value in mm.`);
      const node = tree.nodes[targetIndex]!,
        nextNode = {
          ...node,
          payload: { ...node.payload, [parameter]: value },
        };
      const nextTree = {
        ...tree,
        nodes: tree.nodes.map((item, index) =>
          index === targetIndex ? nextNode : item,
        ),
      } as FeatureTree;
      validateTree(nextTree);
      nextFeatureTrees = { ...input.featureTrees, [partId]: nextTree };
      operations.push({
        kind: "set_feature_parameter",
        partId,
        featureId: node.id,
        parameter,
        value,
        unit: "mm",
      });
      summary = `${part.name} · ${node.name} · ${parameter} = ${value} mm`;
    }
  }
  const topology = input.selection.flatMap((ref) => {
    const kind =
      ref.refKind === "point"
        ? ("vertex" as const)
        : ref.refKind === "face"
          ? ("face" as const)
          : ref.refKind === "edge"
            ? ("edge" as const)
            : null;
    return kind
      ? [
          {
            kind,
            persistentRef: ref.refId,
            referenceQuality: ref.refId.startsWith("mesh-face:")
              ? ("derived" as const)
              : ("persistent" as const),
            geometrySignature: `assembly:${ref.partId}:${ref.refId}`,
          },
        ]
      : [];
  });
  const selectedFeatureId = operations.find(
    (
      operation,
    ): operation is Extract<
      CadEditOperation,
      { kind: "set_feature_parameter" | "add_shell" }
    > =>
      operation.kind === "set_feature_parameter" ||
      operation.kind === "add_shell",
  )?.featureId;
  const selection: SelectionContext = {
    version: 1,
    projectRevision: revision,
    assemblyPath: [],
    partInstanceId: partId,
    ...(selectedFeatureId ? { featureId: selectedFeatureId } : {}),
    topology,
    sketchEntityIds: [],
    mateIds: [],
    coordinateFrame: "world",
    units: "mm",
  };
  const transaction: AiEditTransaction = {
    version: 1,
    id: `edit-${revision}-${operations[0]!.kind}`,
    baseRevision: revision,
    userCommand: command,
    selection,
    observations: [
      `${input.selection.length} selected reference(s)`,
      `${selectedMateIds.length} selected mate(s)`,
    ],
    assumptions: [],
    unresolved: [],
    operations,
    affected: {
      parts: [partId],
      features: operations.flatMap((op) =>
        op.kind === "set_feature_parameter" || op.kind === "add_shell"
          ? [op.featureId]
          : op.kind === "add_fillet" || op.kind === "add_chamfer"
            ? [nextFeatureTrees[partId]!.nodes.at(-1)!.id]
            : [],
      ),
      mates: operations.flatMap((op) =>
        op.kind === "set_mate_parameter" ? [op.mateId] : [],
      ),
      drawings: [],
    },
    preconditions: [
      {
        code: mateEdit ? "SELECTION_SINGLE_MATE" : "SELECTION_SINGLE_PART",
        status: "passed",
        message: mateEdit
          ? "Exactly one mate is selected."
          : "Selection belongs to one part.",
      },
    ],
    rollbackSnapshot: JSON.stringify({
      state: input.state,
      featureTrees: input.featureTrees,
    }),
  };
  const verdict = evaluateAiEditTransaction(transaction, revision);
  if (!verdict.applicable) throw new Error(verdict.issues.join(" "));
  const beforeTree = input.featureTrees[partId],
    afterTree = nextFeatureTrees[partId];
  let evidence: AssemblySelectionEditEvidence | undefined;
  if (beforeTree && afterTree) {
    const before = computeStats(beforeTree),
      after = computeStats(afterTree),
      diff = diffTrees(beforeTree, afterTree);
    evidence = {
      method: "feature-tree-estimate",
      partId,
      changedFeatureIds: [...diff.changedIds],
      addedFeatureIds: [...diff.addedIds],
      removedFeatureIds: [...diff.removedIds],
      before: { volumeMm3: before.volume, bbox: before.bbox },
      after: { volumeMm3: after.volume, bbox: after.bbox },
      deltaVolumeMm3: after.volume - before.volume,
      topologyValidation: "not_run",
    };
  }
  return {
    transaction,
    impact: buildCadEditImpact(transaction),
    nextState,
    nextFeatureTrees,
    summary,
    evidence,
  };
}

export function planAssemblySelectionEdits(input: {
  state: AssemblyState;
  featureTrees: Record<string, FeatureTree>;
  selection: readonly AssemblySelectionRef[];
  selectedMateIds?: readonly string[];
  command: string;
}): AssemblySelectionEditPreview {
  const commands = input.command
    .split(/\s+(?:그리고|and then|then)\s+|[;\n]+/i)
    .map((item) => item.trim())
    .filter(Boolean);
  if (commands.length <= 1) return planAssemblySelectionEdit(input);
  let state = input.state,
    featureTrees = input.featureTrees;
  const previews: AssemblySelectionEditPreview[] = [];
  for (const command of commands) {
    const preview = planAssemblySelectionEdit({
      ...input,
      state,
      featureTrees,
      command,
    });
    previews.push(preview);
    state = preview.nextState;
    featureTrees = preview.nextFeatureTrees;
  }
  const first = previews[0]!,
    last = previews.at(-1)!;
  const transaction: AiEditTransaction = {
    ...first.transaction,
    id: `edit-${first.transaction.baseRevision}-batch-${previews.length}`,
    userCommand: input.command,
    operations: previews.flatMap((item) => item.transaction.operations),
    observations: [
      `${previews.length} atomic edit intent(s)`,
      ...previews.flatMap((item) => item.transaction.observations),
    ],
    affected: {
      parts: [
        ...new Set(previews.flatMap((item) => item.transaction.affected.parts)),
      ],
      features: [
        ...new Set(
          previews.flatMap((item) => item.transaction.affected.features),
        ),
      ],
      mates: [
        ...new Set(previews.flatMap((item) => item.transaction.affected.mates)),
      ],
      drawings: [
        ...new Set(
          previews.flatMap((item) => item.transaction.affected.drawings),
        ),
      ],
    },
    preconditions: previews.flatMap((item) => item.transaction.preconditions),
    rollbackSnapshot: JSON.stringify({
      state: input.state,
      featureTrees: input.featureTrees,
    }),
  };
  const verdict = evaluateAiEditTransaction(
    transaction,
    first.transaction.baseRevision,
  );
  if (!verdict.applicable) throw new Error(verdict.issues.join(" "));
  const partId = transaction.affected.parts[0],
    beforeTree = partId ? input.featureTrees[partId] : undefined,
    afterTree = partId ? featureTrees[partId] : undefined;
  let evidence = last.evidence;
  if (partId && beforeTree && afterTree) {
    const before = computeStats(beforeTree),
      after = computeStats(afterTree),
      diff = diffTrees(beforeTree, afterTree);
    evidence = {
      method: "feature-tree-estimate",
      partId,
      changedFeatureIds: [...diff.changedIds],
      addedFeatureIds: [...diff.addedIds],
      removedFeatureIds: [...diff.removedIds],
      before: { volumeMm3: before.volume, bbox: before.bbox },
      after: { volumeMm3: after.volume, bbox: after.bbox },
      deltaVolumeMm3: after.volume - before.volume,
      topologyValidation: "not_run",
    };
  }
  return {
    transaction,
    impact: buildCadEditImpact(transaction),
    nextState: state,
    nextFeatureTrees: featureTrees,
    summary: previews.map((item) => item.summary).join(" → "),
    evidence,
  };
}

export function assertAssemblySelectionEditCurrent(
  preview: AssemblySelectionEditPreview,
  state: AssemblyState,
  featureTrees: Record<string, FeatureTree>,
  options: { confirmDerived?: boolean } = {},
): void {
  const current = modelContentRevision({ state, featureTrees });
  const verdict = evaluateAiEditTransaction(preview.transaction, current);
  if (!verdict.applicable) throw new Error(verdict.issues.join(" "));
  if (verdict.requiresConfirmation && !options.confirmDerived)
    throw new Error(
      "Derived topology reference requires explicit confirmation.",
    );
}
