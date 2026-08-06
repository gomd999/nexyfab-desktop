import { describe, expect, it } from "vitest";
import type { Mate } from "@/lib/assembly/mate";
import type { Dimension, GdtCallout } from "@/lib/drawing/dimension";
import {
  assertTopologySafeForAssemblySolve,
  propagateTopologyReferences,
  runTopologySafeAssemblySolve,
} from "./topologyReferencePropagation";

const mate: Mate = {
  id: "m1",
  kind: "coincident",
  a: { partId: "a", refId: "old-top", refKind: "face" },
  b: { partId: "b", refId: "fixed-top", refKind: "face" },
};
const dimension: Dimension = {
  id: "d1",
  viewportId: "v1",
  kind: "linear",
  refs: ["old-top", "fixed-top"],
};
const gdt: GdtCallout = {
  id: "g1",
  viewportId: "v1",
  kind: "flatness",
  targetRef: "old-top",
  toleranceValue: 0.1,
};
const pmi = { id: "p1", topoHashes: ["old-top"], label: "Ra 1.6" };

describe("topology reference propagation", () => {
  it("renames safe references across mates, dimensions, GD&T and PMI", () => {
    const result = propagateTopologyReferences({
      remaps: [
        {
          previousRef: "old-top",
          mappedRef: "new-top",
          quality: "derived",
          score: 0.95,
          reason: "matched",
        },
      ],
      mates: [mate],
      dimensions: [dimension],
      gdt: [gdt],
      pmi: [pmi],
    });
    expect(result.mates[0]?.a.refId).toBe("new-top");
    expect(result.mates[0]?.suppressed).not.toBe(true);
    expect(result.activeDimensions[0]?.refs[0]).toBe("new-top");
    expect(result.activeGdt[0]?.targetRef).toBe("new-top");
    expect(result.activePmi[0]?.topoHashes[0]).toBe("new-top");
    expect(result.renameMap.get("old-top")).toBe("new-top");
    expect(result.assemblySolveReady).toBe(true);
    expect(result.confirmationRequiredIds).toContain("mate:m1");
  });

  it("suppresses a mate and quarantines manufacturing annotations when ambiguous", () => {
    const result = propagateTopologyReferences({
      remaps: [
        {
          previousRef: "old-top",
          quality: "ambiguous",
          score: 0.9,
          runnerUpScore: 0.88,
          reason: "two split faces",
        },
      ],
      mates: [mate],
      dimensions: [dimension],
      gdt: [gdt],
      pmi: [pmi],
    });
    expect(result.mates[0]?.suppressed).toBe(true);
    expect(result.reviewDimensions).toHaveLength(1);
    expect(result.reviewGdt).toHaveLength(1);
    expect(result.reviewPmi).toHaveLength(1);
    expect(result.review.map((item) => item.consumer).sort()).toEqual([
      "dimension",
      "gdt",
      "mate",
      "pmi",
    ]);
    expect(result).toMatchObject({
      assemblySolveReady: false,
      blockingMateIds: ["m1"],
    });
    expect(() => assertTopologySafeForAssemblySolve(result)).toThrow(
      /mates=\[m1\]/,
    );
    let called = false;
    expect(() =>
      runTopologySafeAssemblySolve(result, () => {
        called = true;
      }),
    ).toThrow(/assembly solve blocked/);
    expect(called).toBe(false);
  });

  it("supports part-scoped mate remaps without renaming another part's same local ref", () => {
    const result = propagateTopologyReferences({
      remaps: [
        {
          previousRef: "a:old-top",
          mappedRef: "a-new-top",
          quality: "derived",
          score: 0.9,
          reason: "scoped",
        },
      ],
      mates: [mate],
    });
    expect(result.mates[0]?.a.refId).toBe("a-new-top");
    expect(result.mates[0]?.b.refId).toBe("fixed-top");
  });

  it("rebinds safe interface datums and quarantines a broken interface before solve", () => {
    const interfaces = [
      {
        id: "joint-ok",
        occurrenceA: "a",
        occurrenceB: "b",
        datumA: "axis-old",
        datumB: "axis-fixed",
        type: "revolute",
      },
      {
        id: "joint-broken",
        occurrenceA: "a",
        occurrenceB: "b",
        datumA: "face-gone",
        datumB: "face-fixed",
        type: "fixed",
      },
    ];
    const result = propagateTopologyReferences({
      remaps: [
        {
          previousRef: "a:axis-old",
          mappedRef: "axis-new",
          quality: "persistent",
          score: 1,
          reason: "history",
        },
        {
          previousRef: "a:face-gone",
          quality: "broken",
          score: 0,
          reason: "deleted",
        },
      ],
      interfaces,
    });
    expect(result.activeInterfaces).toEqual([
      { ...interfaces[0], datumA: "axis-new" },
    ]);
    expect(result.reviewInterfaces).toEqual([interfaces[1]]);
    expect(result).toMatchObject({
      assemblySolveReady: false,
      blockingInterfaceIds: ["joint-broken"],
    });
    expect(result.review).toContainEqual(
      expect.objectContaining({
        consumer: "interface",
        id: "joint-broken",
        quality: "broken",
      }),
    );
  });
});
