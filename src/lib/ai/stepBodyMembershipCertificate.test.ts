import { describe, expect, it } from "vitest";
import type { ComplexProductArchitecture } from "./complexProductArchitecture";
import {
  deriveStepBodyMembershipEvidence,
  verifyStepBodyMembership,
} from "./stepBodyMembershipCertificate";

const architecture = (): ComplexProductArchitecture => ({
  schema: "nexyfab.complex-product-architecture.v1",
  requirements: [],
  definitions: [
    {
      id: "root",
      name: "Robot",
      kind: "product",
      sourcing: "make",
      independentlyReplaceable: false,
      bodyIntent: { policy: "multi_body", expectedBodies: null },
      requirementIds: [],
    },
    {
      id: "frame",
      name: "Frame",
      kind: "part",
      sourcing: "make",
      independentlyReplaceable: true,
      bodyIntent: { policy: "multi_body", expectedBodies: 3 },
      requirementIds: [],
    },
    {
      id: "bolt",
      name: "Bolt",
      kind: "part",
      sourcing: "standard",
      independentlyReplaceable: true,
      bodyIntent: { policy: "single_body", expectedBodies: 1 },
      requirementIds: [],
    },
  ],
  occurrences: [
    {
      id: "root",
      definitionId: "root",
      parentOccurrenceId: null,
      quantityIndex: 1,
    },
    {
      id: "frame-1",
      definitionId: "frame",
      parentOccurrenceId: "root",
      quantityIndex: 1,
    },
    {
      id: "bolt-1",
      definitionId: "bolt",
      parentOccurrenceId: "root",
      quantityIndex: 1,
    },
    {
      id: "bolt-2",
      definitionId: "bolt",
      parentOccurrenceId: "root",
      quantityIndex: 2,
    },
  ],
  interfaces: [],
  interfaceExpectation: "none",
});

describe("STEP body membership certificate", () => {
  it("keeps three frame bodies in one definition and two bolt occurrences on one body definition", () => {
    expect(
      verifyStepBodyMembership(architecture(), {
        authoritative: true,
        definitions: [
          { definitionId: "frame", bodyCount: 3 },
          { definitionId: "bolt", bodyCount: 1 },
        ],
        occurrenceCounts: [
          { definitionId: "frame", count: 1 },
          { definitionId: "bolt", count: 2 },
        ],
      }),
    ).toMatchObject({ status: "pass", codes: [] });
  });

  it("fails a destructive fuse, occurrence loss and body-to-part promotion", () => {
    const report = verifyStepBodyMembership(architecture(), {
      authoritative: true,
      definitions: [
        { definitionId: "frame", bodyCount: 1 },
        { definitionId: "bolt", bodyCount: 1 },
        { definitionId: "frame-body-2", bodyCount: 1 },
      ],
      occurrenceCounts: [
        { definitionId: "frame", count: 1 },
        { definitionId: "bolt", count: 1 },
      ],
    });
    expect(report.status).toBe("fail");
    expect(report.codes).toEqual(
      expect.arrayContaining([
        "STEP_BODY_COUNT_MISMATCH:frame:1",
        "STEP_BODY_OCCURRENCE_COUNT_MISMATCH:bolt:2->1",
        "STEP_BODY_UNEXPECTED_PART_DEFINITION:frame-body-2",
      ]),
    );
  });

  it("reports missing native evidence as not_run", () => {
    expect(verifyStepBodyMembership(architecture())).toMatchObject({
      status: "not_run",
    });
  });

  it("normalizes unique native product names but refuses ambiguous names", () => {
    const value = architecture();
    const imported = {
      definitions: [
        { definitionId: "pd_10", name: "Robot", bodyCount: 0, container: true },
        {
          definitionId: "pd_20",
          name: "Frame",
          bodyCount: 3,
          container: false,
        },
        { definitionId: "pd_30", name: "Bolt", bodyCount: 1, container: false },
      ],
      occurrences: [
        { occurrenceId: "frame", definitionId: "pd_20" },
        { occurrenceId: "bolt-a", definitionId: "pd_30" },
        { occurrenceId: "bolt-b", definitionId: "pd_30" },
      ],
    };
    expect(
      verifyStepBodyMembership(
        value,
        deriveStepBodyMembershipEvidence(value, imported),
      ),
    ).toMatchObject({ status: "pass" });
    imported.definitions.push({
      definitionId: "pd_31",
      name: "Bolt",
      bodyCount: 1,
      container: false,
    });
    const ambiguous = verifyStepBodyMembership(
      value,
      deriveStepBodyMembershipEvidence(value, imported),
    );
    expect(ambiguous.status).toBe("fail");
    expect(
      ambiguous.codes.some((code) => code.includes("unmapped:pd_30")),
    ).toBe(true);
  });
});
