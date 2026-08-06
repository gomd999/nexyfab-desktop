import { describe, expect, it } from "vitest";
import {
  classifyCombinedStepRoundtrip,
  classifyGeometryImportSolidCount,
  classifySubassemblyEvidence,
  evaluateCadCorpusFile,
} from "./cadCorpusEvidence";
import type { OcctStepRoundtripResult } from "./occtStepRoundtrip";
import { CAD_GOLDEN_SCENARIOS } from "./cadCorpusManifest";

const enc = new TextEncoder();
describe("CAD corpus evidence", () => {
  it("keeps mechanical geometry roundtrip independent from absent PMI", () => {
    expect(
      CAD_GOLDEN_SCENARIOS.find((item) => item.id === "fastener-stack")
        ?.assertions,
    ).toContain("geometry_step_roundtrip");
    expect(
      CAD_GOLDEN_SCENARIOS.find((item) => item.id === "fastener-stack")
        ?.assertions,
    ).not.toContain("step_roundtrip");
  });
  it("treats an executed flat occurrence graph as subassembly fail rather than not_run", () => {
    expect(
      classifySubassemblyEvidence({ occurrences: 12, maxDepth: 1 }),
    ).toMatchObject({ status: "fail", measured: 1 });
    expect(
      classifySubassemblyEvidence({ occurrences: 0, maxDepth: 0 }),
    ).toMatchObject({ status: "not_run" });
  });
  it("uses source hierarchy fidelity for the governed flat gearbox export", () => {
    const scenario = CAD_GOLDEN_SCENARIOS.find((item) => item.id === "gearbox-assembly");
    expect(scenario?.assertions).toContain("assembly_hierarchy");
    expect(scenario?.assertions).not.toContain("subassemblies");
  });
  const roundtrip = (
    pmi: OcctStepRoundtripResult["pmi"],
    geometryPass = true,
  ): OcctStepRoundtripResult => ({
    ok: geometryPass,
    reason: geometryPass ? null : "geometry failed",
    exportedStep: "STEP",
    geometry: {
      pass: geometryPass,
      sourceParts: geometryPass ? 1 : 0,
      exportedParts: geometryPass ? 1 : 0,
      sourceVolumeMm3: geometryPass ? 1 : 0,
      exportedVolumeMm3: geometryPass ? 1 : 0,
      volumeDeltaPct: geometryPass ? 0 : null,
    },
    pmi,
  });

  it("does not call absent PMI 0→0 preservation", () => {
    const absent = {
      status: "not_run" as const,
      reason: "absent",
      sourceSemantic: 0,
      exportedSemantic: 0,
      sourceGraphical: 0,
      exportedGraphical: 0,
      sourceTopologyCoverage: 0,
      exportedTopologyCoverage: 0,
    };
    expect(classifyCombinedStepRoundtrip(roundtrip(absent))).toMatchObject({
      status: "not_run",
      reason: expect.stringContaining("absence"),
    });
  });

  it("requires at least one measured solid for geometry_import pass", () => {
    expect(classifyGeometryImportSolidCount(1).status).toBe("pass");
    expect(classifyGeometryImportSolidCount(0)).toMatchObject({
      status: "fail",
      reason: expect.stringContaining("no measurable solid"),
    });
  });

  it("passes source-present PMI preservation and fails mismatch or geometry failure", () => {
    const preserved = {
      status: "pass" as const,
      reason: "preserved",
      sourceSemantic: 3,
      exportedSemantic: 3,
      sourceGraphical: 0,
      exportedGraphical: 0,
      sourceTopologyCoverage: 1,
      exportedTopologyCoverage: 1,
    };
    expect(classifyCombinedStepRoundtrip(roundtrip(preserved)).status).toBe(
      "pass",
    );
    expect(
      classifyCombinedStepRoundtrip(
        roundtrip({ ...preserved, status: "fail", exportedSemantic: 2 }),
      ).status,
    ).toBe("fail");
    expect(
      classifyCombinedStepRoundtrip(roundtrip(preserved, false)).status,
    ).toBe("fail");
  });
  it("fails closed for an invalid STEP and keeps all external side effects disabled", async () => {
    const result = await evaluateCadCorpusFile({
      scenarioId: "bad-step",
      extension: "step",
      bytes: enc.encode("not step"),
      assertions: ["step_roundtrip"],
      allowKernelFallback: false,
    });
    expect(result.status).toBe("fail");
    expect(result.sideEffects).toEqual({
      quoteCreated: false,
      rfqSent: false,
      sourceModified: false,
    });
    expect(result.input.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reports unsupported native CAD as not_run rather than pass", async () => {
    const result = await evaluateCadCorpusFile({
      scenarioId: "native",
      extension: "sldasm",
      bytes: enc.encode("opaque"),
      assertions: ["assembly_hierarchy"],
    });
    expect(result.status).toBe("not_run");
    expect(result.assertions[0]?.status).toBe("not_run");
  });

  it("imports a minimal IFC honestly and does not claim unsupported semantics", async () => {
    const ifc = `ISO-10303-21;HEADER;FILE_SCHEMA(('IFC4'));ENDSEC;DATA;ENDSEC;END-ISO-10303-21;`;
    const result = await evaluateCadCorpusFile({
      scenarioId: "ifc",
      extension: "ifc",
      bytes: enc.encode(ifc),
      assertions: ["guid"],
    });
    expect(result.status).toBe("fail");
    expect(
      result.assertions.some(
        (item) => item.assertion === "guid" && item.status === "not_run",
      ),
    ).toBe(true);
  });
});
