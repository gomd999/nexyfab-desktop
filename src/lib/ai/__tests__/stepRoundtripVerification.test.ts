import { describe, expect, it } from "vitest";
import {
  compareStepRoundtrip,
  type BrepMeasurement,
} from "../stepRoundtripVerification";

const box: BrepMeasurement = {
  shapeType: "Solid",
  isNull: false,
  bbox: { width: 100, height: 80, depth: 8 },
  volumeMm3: 64_000,
  faceCount: 6,
  solidCount: 1,
};

describe("STEP roundtrip comparison", () => {
  it("passes a topology- and dimension-preserving roundtrip", () => {
    expect(
      compareStepRoundtrip(box, {
        ...box,
        bbox: { width: 100.001, height: 80, depth: 8 },
      }),
    ).toMatchObject({
      passed: true,
      topologyMatched: true,
      dimensionsMatched: true,
    });
  });

  it("fails on a topology change even when the bounding box matches", () => {
    const result = compareStepRoundtrip(box, { ...box, faceCount: 5 });
    expect(result.passed).toBe(false);
    expect(result.topologyMatched).toBe(false);
    expect(result.errors).toContain("Face count changed: 6 -> 5.");
  });

  it("allows Compound to Solid wrapper normalization when one solid is preserved", () => {
    expect(
      compareStepRoundtrip(
        { ...box, shapeType: "Compound" },
        { ...box, shapeType: "Solid" },
      ).passed,
    ).toBe(true);
  });

  it("fails on excessive dimensional or volume drift", () => {
    const result = compareStepRoundtrip(box, {
      ...box,
      bbox: { width: 99, height: 80, depth: 8 },
      volumeMm3: 60_000,
    });
    expect(result.dimensionsMatched).toBe(false);
    expect(
      result.errors.some((error) => error.includes("Bounding-box error")),
    ).toBe(true);
    expect(
      result.errors.some((error) => error.includes("Volume relative error")),
    ).toBe(true);
  });

  it("preserves an explicitly governed multi-body part without promoting its bodies to parts", () => {
    const multi = {
      ...box,
      shapeType: "Compound",
      solidCount: 3,
      faceCount: 18,
    };
    expect(
      compareStepRoundtrip(multi, multi, 0.05, 1e-4, {
        policy: "multi_body",
        expectedBodies: 3,
      }),
    ).toMatchObject({ passed: true, topologyMatched: true });
  });

  it("fails closed when a multi-body part is fused or loses a body", () => {
    const before = {
      ...box,
      shapeType: "Compound",
      solidCount: 3,
      faceCount: 18,
    };
    const fused = {
      ...before,
      shapeType: "Solid",
      solidCount: 1,
      faceCount: 16,
    };
    const result = compareStepRoundtrip(before, fused, 0.05, 1e-4, {
      policy: "multi_body",
      expectedBodies: 3,
    });
    expect(result.passed).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Solid count changed: 3 -> 1.",
        "Body intent requires exactly 3 solids; measured 3 -> 1.",
      ]),
    );
  });

  it("does not accept a multi-body artifact under the default single-body policy", () => {
    const multi = {
      ...box,
      shapeType: "Compound",
      solidCount: 2,
      faceCount: 12,
    };
    expect(compareStepRoundtrip(multi, multi).errors).toContain(
      "Body intent requires exactly one solid; measured 2 -> 2.",
    );
  });
});
