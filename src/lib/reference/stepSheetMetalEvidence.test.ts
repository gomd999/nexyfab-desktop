import { describe, expect, it } from "vitest";
import {
  classifyStepBends,
  classifyStepPanels,
} from "./stepSheetMetalEvidence";
describe("STEP sheet-metal evidence", () => {
  it("recognizes independent constant-thickness panels and through cylinders", () => {
    expect(
      classifyStepPanels([
        {
          partId: "door",
          partName: "Door",
          size: [3, 600, 800],
          cylinderDirections: [
            [1, 0, 0],
            [0, 0, 1],
          ],
        },
      ]),
    ).toEqual([
      {
        partId: "door",
        partName: "Door",
        thicknessAxis: "x",
        thickness: 3,
        inPlane: [600, 800],
        throughCylinderCount: 1,
        bends: [],
      },
    ]);
  });
  it("accepts only a coaxial inner/outer cylinder pair separated by thickness", () => {
    const bends = classifyStepBends("bracket", 2, 2, [
      {
        entityId: 10,
        origin: [0, 0, 0],
        direction: [0, 1, 0],
        radius: 5,
        angularSpanDeg: 90,
      },
      {
        entityId: 11,
        origin: [0, 0, 0],
        direction: [0, 1, 0],
        radius: 7,
        angularSpanDeg: 90,
      },
      { entityId: 12, origin: [20, 0, 0], direction: [0, 1, 0], radius: 9 },
    ]);
    expect(bends).toHaveLength(1);
    expect(bends[0]).toMatchObject({
      innerSurfaceId: 10,
      outerSurfaceId: 11,
      innerRadius: 5,
      outerRadius: 7,
      thickness: 2,
      angleDeg: 90,
    });
  });
  it("does not relabel a through-hole or unequal-radius round as a bend", () => {
    expect(
      classifyStepBends("panel", 2, 2, [
        { entityId: 1, origin: [0, 0, 0], direction: [0, 0, 1], radius: 5 },
        { entityId: 2, origin: [0, 0, 0], direction: [0, 0, 1], radius: 7 },
      ]),
    ).toEqual([]);
    expect(
      classifyStepBends("panel", 2, 2, [
        { entityId: 1, origin: [0, 0, 0], direction: [1, 0, 0], radius: 5 },
        { entityId: 2, origin: [0, 0, 0], direction: [1, 0, 0], radius: 8 },
      ]),
    ).toEqual([]);
  });
  it("rejects bars, degenerate bounds, and invalid policy", () => {
    expect(
      classifyStepPanels([
        { partId: "bar", partName: "Bar", size: [5, 10, 100] },
      ]),
    ).toEqual([]);
    expect(
      classifyStepPanels([
        { partId: "bad", partName: "Bad", size: [0, 100, 100] },
      ]),
    ).toEqual([]);
    expect(() => classifyStepPanels([], { maximumThickness: 0 })).toThrow();
  });
});
