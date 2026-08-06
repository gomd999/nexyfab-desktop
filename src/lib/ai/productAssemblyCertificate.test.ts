import { describe, expect, it } from "vitest";
import type { ComplexProductArchitecture } from "./complexProductArchitecture";
import { buildPartGenerationCertificate } from "./partGenerationCertificate";
import { buildProductAssemblyCertificate } from "./productAssemblyCertificate";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const architecture = (): ComplexProductArchitecture => ({
  schema: "nexyfab.complex-product-architecture.v1",
  requirements: [
    {
      id: "r",
      kind: "motion",
      text: "shaft rotates",
      status: "confirmed",
      sourceRefs: ["prompt:1"],
    },
  ],
  definitions: [
    {
      id: "product",
      name: "Gearbox",
      kind: "product",
      sourcing: "make",
      independentlyReplaceable: false,
      bodyIntent: { policy: "multi_body", expectedBodies: null },
      requirementIds: ["r"],
    },
    {
      id: "shaft",
      name: "Shaft",
      kind: "part",
      sourcing: "make",
      independentlyReplaceable: true,
      bodyIntent: { policy: "single_body", expectedBodies: 1 },
      requirementIds: ["r"],
    },
  ],
  occurrences: [
    {
      id: "root",
      definitionId: "product",
      parentOccurrenceId: null,
      quantityIndex: 1,
    },
    {
      id: "shaft-1",
      definitionId: "shaft",
      parentOccurrenceId: "root",
      quantityIndex: 1,
    },
  ],
  interfaces: [
    {
      id: "bearing-axis",
      occurrenceA: "root",
      occurrenceB: "shaft-1",
      type: "revolute",
      datumA: "axis:a",
      datumB: "axis:b",
      requirementIds: ["r"],
    },
  ],
});
const part = () =>
  buildPartGenerationCertificate(
    {
      partId: "shaft",
      intent: "turned",
      bodyPolicy: "single_body",
      expectedBodies: 1,
      dimensions: [],
      features: [],
    },
    {
      kernel: {
        available: true,
        valid: true,
        source: "native_brep",
        artifactHash: "a".repeat(64),
      },
      topology: {
        solidCount: 1,
        watertight: true,
        nonManifoldEdges: 0,
        degenerateFaces: 0,
      },
    },
  );
const membership = () => ({
  authoritative: true as const,
  definitions: [{ definitionId: "shaft", bodyCount: 1 }],
  occurrenceCounts: [{ definitionId: "shaft", count: 1 }],
});

describe("product assembly certificate", () => {
  it("passes only with architecture, released parts, transforms and solved joints", () => {
    expect(
      buildProductAssemblyCertificate(architecture(), {
        partCertificates: [part()],
        stepBodyMembership: membership(),
        transforms: [
          { occurrenceId: "root", matrix: identity, source: "native_assembly" },
          {
            occurrenceId: "shaft-1",
            matrix: identity,
            source: "native_assembly",
          },
        ],
        joints: [
          {
            interfaceId: "bearing-axis",
            occurrenceA: "root",
            occurrenceB: "shaft-1",
            type: "revolute",
            solved: true,
            residual: 0,
          },
        ],
      }),
    ).toMatchObject({ status: "pass", releaseReady: true });
  });
  it("keeps missing transform and joint measurements as not_run", () => {
    expect(
      buildProductAssemblyCertificate(architecture(), {
        partCertificates: [part()],
      }),
    ).toMatchObject({ status: "not_run", releaseReady: false });
  });
  it("fails an unreleased part or mismatched joint identity", () => {
    const failedPart = part();
    failedPart.status = "fail";
    failedPart.releaseReady = false;
    const certificate = buildProductAssemblyCertificate(architecture(), {
      partCertificates: [failedPart],
      stepBodyMembership: membership(),
      transforms: [
        { occurrenceId: "root", matrix: identity, source: "assembly_solver" },
        {
          occurrenceId: "shaft-1",
          matrix: identity,
          source: "assembly_solver",
        },
      ],
      joints: [
        {
          interfaceId: "bearing-axis",
          occurrenceA: "shaft-1",
          occurrenceB: "root",
          type: "fixed",
          solved: true,
          residual: 0,
        },
      ],
    });
    expect(certificate).toMatchObject({ status: "fail", releaseReady: false });
    expect(certificate.gates.flatMap((item) => item.codes)).toEqual(
      expect.arrayContaining([
        "ASSEMBLY_PART_NOT_RELEASE_READY:shaft",
        "ASSEMBLY_JOINT_IDENTITY_MISMATCH:bearing-axis",
      ]),
    );
  });
  it("preserves an unverified part as not_run instead of converting it to fail", () => {
    const unverifiedPart = buildPartGenerationCertificate(
      {
        partId: "shaft",
        intent: "turned",
        bodyPolicy: "single_body",
        expectedBodies: 1,
        dimensions: [],
        features: [],
      },
      {
        kernel: {
          available: true,
          valid: true,
          source: "native_mesh",
          artifactHash: "b".repeat(64),
        },
        topology: {
          solidCount: 1,
          watertight: true,
          nonManifoldEdges: 0,
          degenerateFaces: 0,
        },
      },
    );
    const certificate = buildProductAssemblyCertificate(architecture(), {
      partCertificates: [unverifiedPart],
      stepBodyMembership: membership(),
      transforms: [
        { occurrenceId: "root", matrix: identity, source: "assembly_solver" },
        {
          occurrenceId: "shaft-1",
          matrix: identity,
          source: "assembly_solver",
        },
      ],
      joints: [
        {
          interfaceId: "bearing-axis",
          occurrenceA: "root",
          occurrenceB: "shaft-1",
          type: "revolute",
          solved: true,
          residual: 0,
        },
      ],
    });
    expect(certificate).toMatchObject({
      status: "not_run",
      releaseReady: false,
    });
    expect(
      certificate.gates.find((item) => item.gate === "part_certificates")
        ?.codes,
    ).toContain("ASSEMBLY_PART_NOT_VERIFIED:shaft");
  });
  it("does not pass a multi-occurrence assembly when interface expectations are absent", () => {
    const value = architecture();
    value.interfaces = [];
    value.interfaceExpectation = undefined;
    value.occurrences.push({
      id: "shaft-2",
      definitionId: "shaft",
      parentOccurrenceId: "root",
      quantityIndex: 2,
    });
    const certificate = buildProductAssemblyCertificate(value, {
      partCertificates: [part()],
      stepBodyMembership: {
        ...membership(),
        occurrenceCounts: [{ definitionId: "shaft", count: 2 }],
      },
      transforms: [
        { occurrenceId: "root", matrix: identity, source: "assembly_solver" },
        {
          occurrenceId: "shaft-1",
          matrix: identity,
          source: "assembly_solver",
        },
        {
          occurrenceId: "shaft-2",
          matrix: identity,
          source: "assembly_solver",
        },
      ],
    });
    expect(certificate).toMatchObject({
      status: "not_run",
      releaseReady: false,
    });
    expect(
      certificate.gates.find((item) => item.gate === "joints")?.codes,
    ).toContain("ASSEMBLY_INTERFACE_EXPECTATION_MISSING");
  });
  it("allows an explicitly joint-free static occurrence set", () => {
    const value = architecture();
    value.interfaces = [];
    value.interfaceExpectation = "none";
    value.occurrences.push({
      id: "shaft-2",
      definitionId: "shaft",
      parentOccurrenceId: "root",
      quantityIndex: 2,
    });
    expect(
      buildProductAssemblyCertificate(value, {
        partCertificates: [part()],
        stepBodyMembership: {
          ...membership(),
          occurrenceCounts: [{ definitionId: "shaft", count: 2 }],
        },
        transforms: [
          { occurrenceId: "root", matrix: identity, source: "assembly_solver" },
          {
            occurrenceId: "shaft-1",
            matrix: identity,
            source: "assembly_solver",
          },
          {
            occurrenceId: "shaft-2",
            matrix: identity,
            source: "assembly_solver",
          },
        ],
      }),
    ).toMatchObject({ status: "pass", releaseReady: true });
  });
  it("fails interfaces that contradict an explicit none expectation", () => {
    const value = architecture();
    value.interfaceExpectation = "none";
    const certificate = buildProductAssemblyCertificate(value, {
      partCertificates: [part()],
      transforms: [
        { occurrenceId: "root", matrix: identity, source: "assembly_solver" },
        {
          occurrenceId: "shaft-1",
          matrix: identity,
          source: "assembly_solver",
        },
      ],
      joints: [],
    });
    expect(
      certificate.gates.find((item) => item.gate === "joints"),
    ).toMatchObject({
      status: "fail",
      codes: ["ASSEMBLY_UNEXPECTED_INTERFACES_PRESENT"],
    });
  });
  it("blocks release for topology review and unconfirmed derived references", () => {
    const certificate = buildProductAssemblyCertificate(architecture(), {
      partCertificates: [part()],
      transforms: [
        { occurrenceId: "root", matrix: identity, source: "assembly_solver" },
        {
          occurrenceId: "shaft-1",
          matrix: identity,
          source: "assembly_solver",
        },
      ],
      joints: [
        {
          interfaceId: "bearing-axis",
          occurrenceA: "root",
          occurrenceB: "shaft-1",
          type: "revolute",
          solved: true,
          residual: 0,
        },
      ],
      topologyRebind: {
        assemblySolveReady: false,
        blockingMateIds: ["m1"],
        blockingInterfaceIds: ["bearing-axis"],
        confirmationRequiredIds: ["interface:bearing-axis"],
        confirmedIds: [],
      },
    });
    expect(certificate).toMatchObject({ status: "fail", releaseReady: false });
    expect(
      certificate.gates.find((item) => item.gate === "topology_rebind")?.codes,
    ).toEqual(
      expect.arrayContaining([
        "ASSEMBLY_TOPOLOGY_MATE_BLOCKED:m1",
        "ASSEMBLY_TOPOLOGY_INTERFACE_BLOCKED:bearing-axis",
        "ASSEMBLY_DERIVED_TOPOLOGY_UNCONFIRMED:interface:bearing-axis",
      ]),
    );
  });

  it("passes topology rebind only after all derived references are confirmed", () => {
    const certificate = buildProductAssemblyCertificate(architecture(), {
      partCertificates: [part()],
      stepBodyMembership: membership(),
      transforms: [
        { occurrenceId: "root", matrix: identity, source: "assembly_solver" },
        {
          occurrenceId: "shaft-1",
          matrix: identity,
          source: "assembly_solver",
        },
      ],
      joints: [
        {
          interfaceId: "bearing-axis",
          occurrenceA: "root",
          occurrenceB: "shaft-1",
          type: "revolute",
          solved: true,
          residual: 0,
        },
      ],
      topologyRebind: {
        assemblySolveReady: true,
        blockingMateIds: [],
        blockingInterfaceIds: [],
        confirmationRequiredIds: ["interface:bearing-axis"],
        confirmedIds: ["interface:bearing-axis"],
      },
    });
    expect(certificate).toMatchObject({ status: "pass", releaseReady: true });
  });
});
