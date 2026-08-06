import { importStep } from "@/lib/brep-bridge/stepImport";
import {
  extractFaceDataFromSolid,
  type FaceData,
} from "@/lib/brep-bridge/stepAssemblyMateInference";
export type StepBox = {
  entityId: string;
  min: [number, number, number];
  max: [number, number, number];
};
export interface StepWeldmentMemberEvidence {
  entityId: string;
  axis: "x" | "y" | "z";
  length: number;
  profile: [number, number];
  slenderness: number;
  endCuts?: StepMemberEndCuts;
}
export interface StepMemberEndCut {
  faceId: string;
  axisPosition: number;
  cutAngleDeg: number;
}
export interface StepMemberEndCuts {
  status: "resolved";
  centerlineLength: number;
  ends: [StepMemberEndCut, StepMemberEndCut];
}
export interface StepWeldmentEvidence {
  status: "pass" | "fail" | "not_run";
  members: StepWeldmentMemberEvidence[];
  cutList: Array<{
    profile: [number, number];
    length: number;
    quantity: number;
    memberIds: string[];
  }>;
  miter: {
    status: "pass" | "not_run";
    resolvedMembers: number;
    reason?: string;
  };
  unresolved: { mass: string };
  warnings: string[];
}
const component = (
  value: { x: number; y: number; z: number },
  axis: "x" | "y" | "z",
) => value[axis];
/** Intersect every eligible STEP end plane with the member AABB centreline.
 * The two extreme, oppositely facing intersections are the authoritative
 * end cuts. Side faces are excluded by the minimum axial normal component. */
export function resolveMemberEndCuts(
  box: StepBox,
  axis: "x" | "y" | "z",
  faces: FaceData[],
  minimumAxialNormal = 0.05,
): StepMemberEndCuts | undefined {
  if (
    !Number.isFinite(minimumAxialNormal) ||
    minimumAxialNormal <= 0 ||
    minimumAxialNormal > 1
  )
    throw new Error("minimumAxialNormal must be in (0, 1]");
  const center = {
      x: (box.min[0] + box.max[0]) / 2,
      y: (box.min[1] + box.max[1]) / 2,
      z: (box.min[2] + box.max[2]) / 2,
    },
    axisVector = {
      x: axis === "x" ? 1 : 0,
      y: axis === "y" ? 1 : 0,
      z: axis === "z" ? 1 : 0,
    },
    intersections = faces
      .flatMap((face) => {
        const denominator = component(face.normal, axis);
        if (Math.abs(denominator) < minimumAxialNormal) return [];
        const delta = {
          x: face.origin.x - center.x,
          y: face.origin.y - center.y,
          z: face.origin.z - center.z,
        };
        const t =
          (face.normal.x * delta.x +
            face.normal.y * delta.y +
            face.normal.z * delta.z) /
          denominator;
        if (!Number.isFinite(t)) return [];
        return [
          {
            faceId: face.id,
            axisPosition: t,
            cutAngleDeg:
              (Math.acos(
                Math.min(
                  1,
                  Math.abs(
                    face.normal.x * axisVector.x +
                      face.normal.y * axisVector.y +
                      face.normal.z * axisVector.z,
                  ),
                ),
              ) *
                180) /
              Math.PI,
            facing: Math.sign(denominator),
          },
        ];
      })
      .sort((a, b) => a.axisPosition - b.axisPosition);
  if (intersections.length < 2) return undefined;
  const first = intersections[0]!,
    last = intersections.at(-1)!;
  if (
    first.facing === last.facing ||
    last.axisPosition - first.axisPosition <= 1e-8
  )
    return undefined;
  return {
    status: "resolved",
    centerlineLength: last.axisPosition - first.axisPosition,
    ends: [
      {
        faceId: first.faceId,
        axisPosition: first.axisPosition,
        cutAngleDeg: first.cutAngleDeg,
      },
      {
        faceId: last.faceId,
        axisPosition: last.axisPosition,
        cutAngleDeg: last.cutAngleDeg,
      },
    ],
  };
}
export function classifyStepWeldmentMembers(
  boxes: StepBox[],
  minimumSlenderness = 3,
): StepWeldmentMemberEvidence[] {
  if (!Number.isFinite(minimumSlenderness) || minimumSlenderness <= 1)
    throw new Error("minimumSlenderness must exceed one");
  return boxes.flatMap((box) => {
    const sizes = box.max.map((value, index) => value - box.min[index]!) as [
      number,
      number,
      number,
    ];
    if (sizes.some((value) => !Number.isFinite(value) || value <= 0)) return [];
    const axisIndex = sizes.indexOf(Math.max(...sizes)),
      cross = sizes
        .filter((_, index) => index !== axisIndex)
        .sort((a, b) => a - b) as [number, number],
      length = sizes[axisIndex]!,
      slenderness = length / cross[1];
    return slenderness >= minimumSlenderness
      ? [
          {
            entityId: box.entityId,
            axis: (["x", "y", "z"] as const)[axisIndex]!,
            length,
            profile: cross,
            slenderness,
          },
        ]
      : [];
  });
}
export function analyzeStepWeldmentEvidence(
  source: string,
  minimumSlenderness = 3,
): StepWeldmentEvidence {
  const imported = importStep(source),
    boxes: StepBox[] = imported.placements.flatMap((placement) =>
      placement.worldBBox
        ? [
            {
              entityId: placement.sourceEntityId
                ? `#${placement.sourceEntityId}`
                : "unknown_solid",
              min: placement.worldBBox.min,
              max: placement.worldBBox.max,
            },
          ]
        : [],
    ),
    members = classifyStepWeldmentMembers(boxes, minimumSlenderness).map(
      (member) => {
        const placement = imported.placements.find(
            (candidate) => `#${candidate.sourceEntityId}` === member.entityId,
          ),
          box = boxes.find(
            (candidate) => candidate.entityId === member.entityId,
          ),
          faces = placement?.sourceEntityId
            ? extractFaceDataFromSolid(source, placement.sourceEntityId)
            : [];
        return box
          ? {
              ...member,
              endCuts: resolveMemberEndCuts(box, member.axis, faces),
            }
          : member;
      },
    ),
    groups = new Map<string, StepWeldmentEvidence["cutList"][number]>();
  for (const member of members) {
    const key = [...member.profile, member.length]
        .map((value) => value.toPrecision(12))
        .join("/"),
      existing = groups.get(key);
    if (existing) {
      existing.quantity++;
      existing.memberIds.push(member.entityId);
    } else
      groups.set(key, {
        profile: member.profile,
        length: member.length,
        quantity: 1,
        memberIds: [member.entityId],
      });
  }
  return {
    status: members.length >= 2 ? "pass" : boxes.length ? "fail" : "not_run",
    members,
    cutList: [...groups.values()],
    miter: members.some((member) => member.endCuts)
      ? {
          status: "pass",
          resolvedMembers: members.filter((member) => member.endCuts).length,
        }
      : {
          status: "not_run",
          resolvedMembers: 0,
          reason:
            "No member has two authoritative, oppositely facing STEP end planes.",
        },
    unresolved: {
      mass: "not_run: source material density is not authoritatively bound to each member",
    },
    warnings: imported.warnings,
  };
}
