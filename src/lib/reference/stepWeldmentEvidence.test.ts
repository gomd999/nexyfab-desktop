import { describe, expect, it } from "vitest";
import {
  classifyStepWeldmentMembers,
  resolveMemberEndCuts,
} from "./stepWeldmentEvidence";
describe("STEP weldment evidence", () => {
  it("recognizes elongated solid members and preserves axis/profile/length", () => {
    const members = classifyStepWeldmentMembers([
      { entityId: "a", min: [0, 0, 0], max: [1000, 40, 40] },
      { entityId: "b", min: [0, 0, 0], max: [40, 500, 40] },
      { entityId: "plate", min: [0, 0, 0], max: [100, 80, 5] },
    ]);
    expect(members).toEqual([
      {
        entityId: "a",
        axis: "x",
        length: 1000,
        profile: [40, 40],
        slenderness: 25,
      },
      {
        entityId: "b",
        axis: "y",
        length: 500,
        profile: [40, 40],
        slenderness: 12.5,
      },
    ]);
  });
  it("rejects invalid tolerance and degenerate boxes", () => {
    expect(() => classifyStepWeldmentMembers([], 1)).toThrow();
    expect(
      classifyStepWeldmentMembers([
        { entityId: "x", min: [0, 0, 0], max: [0, 1, 10] },
      ]),
    ).toEqual([]);
  });
  it("resolves square and mitered end planes on the member centreline", () => {
    const result = resolveMemberEndCuts(
      { entityId: "#1", min: [0, 0, 0], max: [100, 10, 10] },
      "x",
      [
        {
          id: "left",
          origin: { x: 0, y: 0, z: 0 },
          normal: { x: -1, y: 0, z: 0 },
        },
        {
          id: "right",
          origin: { x: 100, y: 0, z: 0 },
          normal: { x: Math.SQRT1_2, y: Math.SQRT1_2, z: 0 },
        },
        {
          id: "side",
          origin: { x: 0, y: 0, z: 0 },
          normal: { x: 0, y: 1, z: 0 },
        },
      ],
    );
    // The AABB centreline is y=5; x+y=100 therefore intersects at x=95.
    expect(result?.centerlineLength).toBe(95);
    expect(result?.ends[0].cutAngleDeg).toBe(0);
    expect(result?.ends[1].cutAngleDeg).toBeCloseTo(45);
  });
  it("fails closed when opposite end planes cannot be proven", () => {
    expect(
      resolveMemberEndCuts(
        { entityId: "#1", min: [0, 0, 0], max: [100, 10, 10] },
        "x",
        [
          {
            id: "one",
            origin: { x: 0, y: 0, z: 0 },
            normal: { x: 1, y: 0, z: 0 },
          },
        ],
      ),
    ).toBeUndefined();
    expect(() =>
      resolveMemberEndCuts(
        { entityId: "#1", min: [0, 0, 0], max: [100, 10, 10] },
        "x",
        [],
        0,
      ),
    ).toThrow();
  });
});
