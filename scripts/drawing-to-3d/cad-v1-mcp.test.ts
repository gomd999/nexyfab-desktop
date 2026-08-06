import { afterEach, describe, expect, it, vi } from "vitest";
import { callTool, tools } from "./mcp-server.mjs";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.NEXYFAB_API_KEY;
});

describe("CAD v1 MCP tools", () => {
  it("publishes product decomposition and topology reconciliation tools", () => {
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("cad_capabilities");
    expect(names).toContain("product_decomposition");
    expect(names).toContain("reconcile_topology_references");
    expect(names).toContain("cad_feature_program");
    expect(names).toContain("feature_tree_mesh");
    expect(names).toContain("export_part_step");
    expect(names).toContain("verify_cad_assembly");
    expect(names).toContain("verify_cad_project");
    expect(names).toContain("verify_door_swing_clearance");
    expect(names).toContain("verify_space_boundary_closure");
    expect(names).toContain("verify_egress_routes");
    expect(names).toContain("verify_mep_interference");
    expect(names).toContain("verify_manufacturing_evidence");
    expect(names).toContain("verify_ai_generation");
    expect(names).toContain("transition_ai_generation_state");
    expect(names).toContain("advance_ai_generation");
    expect(names).toContain("finalize_ai_generation");
    expect(names).toContain("generate_robot_6axis");
    expect(names).toContain("apply_assembly_animation_command");
    expect(names).toContain("preview_assembly_selection_edit");
    expect(names).toContain("push_pull_step_face");
    expect(names).toContain("analyze_cad_reference");
    expect(names).toContain("verify_ifc_semantic_roundtrip");
    expect(names).toContain("build_ifc_domain_ir");
    expect(names).toContain("plan_ifc_geometry_recovery");
    const selectionEdit = tools.find(
      (tool) => tool.name === "preview_assembly_selection_edit",
    );
    expect(selectionEdit?.inputSchema.properties.verifyBrep).toMatchObject({
      type: "boolean",
      default: false,
    });
    expect(selectionEdit?.inputSchema.properties.generationState).toMatchObject(
      { type: "object" },
    );
  });

  it("routes reference analysis through CAD v1 and returns only sanitized evidence", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          evidence: {
            schemaVersion: 2,
            input: { sha256: "abc" },
            sideEffects: { quoteCreated: false, rfqSent: false },
          },
          tolerancePolicy: { version: "cad-tolerance/v1" },
          source: "SECRET STEP",
          filePath: "C:\\secret\\part.step",
          quote: { id: "must-not-leak" },
        }),
        { status: 200 },
      ),
    );
    const payload = {
      step: "SVNPLTEwMzAzLTIxOw==",
      encoding: "base64",
      format: "step",
      scenarioId: "golden-box",
      lengthUnit: { kind: "mm" },
      declaredSourceTolerance: { value: 0.001 },
    };
    const result = await callTool("analyze_cad_reference", payload);
    expect(result).toEqual({
      ok: true,
      evidence: {
        schemaVersion: 2,
        input: { sha256: "abc" },
        sideEffects: { quoteCreated: false, rfqSent: false },
      },
      tolerancePolicy: { version: "cad-tolerance/v1" },
      sourceReturned: false,
      quoteOrRfqSideEffects: false,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /SECRET|secret|part\.step|must-not-leak/,
    );
    expect(result).not.toHaveProperty("source");
    expect(result).not.toHaveProperty("filePath");
    expect(result).not.toHaveProperty("quote");
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/reference/analyze",
    );
    expect(
      JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
    ).toEqual(payload);
  });

  it("rejects reference paths, oversized source, and ambiguous units before remote I/O", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(
      await callTool("analyze_cad_reference", {
        step: "STEP",
        encoding: "utf8",
        format: "step",
        scenarioId: "x",
        lengthUnit: { kind: "mm" },
        file: "C:\\secret.step",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await callTool("analyze_cad_reference", {
        step: "x".repeat(20_000_001),
        encoding: "utf8",
        format: "step",
        scenarioId: "x",
        lengthUnit: { kind: "mm" },
      }),
    ).toMatchObject({ ok: false });
    expect(
      await callTool("analyze_cad_reference", {
        step: "STEP",
        encoding: "utf8",
        format: "step",
        scenarioId: "x",
        lengthUnit: { kind: "unknown" },
      }),
    ).toMatchObject({ ok: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("routes IFC semantic roundtrip and never returns IFC source", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          releaseReady: true,
          evidence: { passed: true },
          beforeIfc: "SECRET",
        }),
        { status: 200 },
      ),
    );
    const payload = {
      beforeIfc: "#1=IFCSITE('a',$);",
      afterIfc: "#9=IFCSITE('a',$);",
    };
    const result = await callTool("verify_ifc_semantic_roundtrip", payload);
    expect(result).toEqual({
      ok: true,
      releaseReady: true,
      evidence: { passed: true },
      sourceReturned: false,
      quoteOrRfqSideEffects: false,
    });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/ifc/semantic-roundtrip",
    );
  });
  it("routes STEP mechanical relation evidence without source echo", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          releaseReady: true,
          evidence: { axes: [1], coaxialPairs: [1] },
          step: "SECRET",
        }),
        { status: 200 },
      ),
    );
    const result = await callTool("analyze_step_mechanical_relations", {
      step: "ISO-10303-21;SECRET",
    });
    expect(result).toMatchObject({
      ok: true,
      releaseReady: true,
      sourceReturned: false,
      quoteOrRfqSideEffects: false,
    });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/step/mechanical-relations",
    );
  });
  it("routes IFC specialized domain IR without source echo", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          releaseReady: true,
          ir: { kind: "alignment", valid: true },
          ifc: "SECRET",
        }),
        { status: 200 },
      ),
    );
    const result = await callTool("build_ifc_domain_ir", {
      ifc: "#1=IFCALIGNMENT('a',$);",
      domain: "alignment",
    });
    expect(result).toEqual({
      ok: true,
      releaseReady: true,
      ir: { kind: "alignment", valid: true },
      sourceReturned: false,
      quoteOrRfqSideEffects: false,
    });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/ifc/domain-ir",
    );
  });
  it("routes occurrence-scoped IFC recovery requests without source echo", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          releaseReady: false,
          elements: 1,
          imported: 0,
          requests: [
            {
              globalId: "g",
              requiredInputs: ["profile_definition_or_physical_width_mm"],
            },
          ],
          errors: [],
          ifc: "SECRET",
        }),
        { status: 200 },
      ),
    );
    const result = await callTool("plan_ifc_geometry_recovery", {
      ifc: "#1=IFCRAILING('g',$);",
    });
    expect(result).toMatchObject({
      ok: true,
      releaseReady: false,
      requests: [{ globalId: "g" }],
      sourceReturned: false,
    });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/ifc/recovery-plan",
    );
  });
  it("routes authoritative IFC recovery and strips source echo", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          releaseReady: true,
          assembly: { parts: [{ id: "R" }] },
          applied: [{ globalId: "0DAlDmbNb6ZhcaPbmdsMGX", valueMm: 50 }],
          rejected: [],
          remainingRequests: [],
          errors: [],
          ifc: "SECRET",
        }),
        { status: 200 },
      ),
    );
    const args = {
      ifc: "#1=IFCRAILING('0DAlDmbNb6ZhcaPbmdsMGX',$);",
      authoritativeInputs: [
        {
          globalId: "0DAlDmbNb6ZhcaPbmdsMGX",
          physicalWidthMm: 50,
          provenance: "operator drawing A-12",
        },
      ],
    };
    const result = await callTool("recover_ifc_geometry", args);
    expect(result).toMatchObject({
      ok: true,
      releaseReady: true,
      applied: [{ valueMm: 50 }],
      sourceReturned: false,
      quoteOrRfqSideEffects: false,
    });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/ifc/recover-geometry",
    );
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual(args);
  });

  it("does not echo a server error containing a source or local path", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: "failed C:\\private\\model.step ISO-10303-21 SECRET",
        }),
        { status: 422 },
      ),
    );
    const result = await callTool("analyze_cad_reference", {
      step: "ISO-10303-21 SECRET",
      encoding: "utf8",
      format: "step",
      scenarioId: "x",
      lengthUnit: { kind: "mm" },
    });
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toMatch(
      /private|model\.step|ISO-10303-21|SECRET/,
    );
  });

  it("routes atomic assembly selection edit previews through CAD v1", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, deterministic: true, preview: {} }),
          { status: 200 },
        ),
      );
    const result = await callTool("preview_assembly_selection_edit", {
      state: { parts: [], mates: [] },
      featureTrees: {},
      selection: [],
      command: "쉘 두께 2mm",
    });
    expect(result).toMatchObject({ ok: true, deterministic: true });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/assembly/selection-edit",
    );
  });

  it("routes imported STEP planar-face push/pull without changing its exact payload", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          exact: { passed: true },
          step: "U1RFUA==",
        }),
        { status: 200 },
      ),
    );
    const payload = {
      step: "SU5QVVQ=",
      encoding: "base64",
      faceRef: "f.import.5",
      distanceMm: -1,
    };
    const result = await callTool("push_pull_step_face", payload);
    expect(result).toMatchObject({ ok: true, exact: { passed: true } });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/brep/push-pull",
    );
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual(payload);
  });

  it("routes deterministic animation commands through CAD v1", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          deterministic: true,
          animation: { tracks: [{}] },
        }),
        { status: 200 },
      ),
    );
    const result = await callTool("apply_assembly_animation_command", {
      state: { parts: [], mates: [] },
      animation: { version: 1, tracks: [] },
      command: "0~10 frames arm X 5mm",
    });
    expect(result).toMatchObject({ ok: true, deterministic: true });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/assembly/animation/command",
    );
  });
  it("forwards bounded precise TOI controls through the shared animation verifier", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            releaseReady: false,
            precise: {
              continuous: {
                timeOfImpact: [
                  {
                    status: "collision_bracket",
                    firstPossibleFrame: 2.4,
                    confirmedCollisionFrame: 2.5,
                  },
                ],
              },
            },
          }),
          { status: 200 },
        ),
      ),
      args = {
        state: { parts: [], mates: [] },
        animation: { version: 1, tracks: [] },
        localBoxes: {},
        featureTrees: {},
        toiMaxDepth: 20,
        toiFrameTolerance: 0.001,
        toiMaxEvaluations: 4096,
      };
    const result = await callTool("verify_assembly_animation", args);
    expect(result).toMatchObject({
      ok: true,
      releaseReady: false,
      precise: {
        continuous: { timeOfImpact: [{ status: "collision_bracket" }] },
      },
    });
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual(args);
  });

  it("routes fail-closed manufacturing evidence through CAD v1", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          designOk: false,
          report: { firstBlockingGate: "G0" },
        }),
        { status: 200 },
      ),
    );
    const result = await callTool("verify_manufacturing_evidence", {});
    expect(result).toMatchObject({
      ok: true,
      designOk: false,
      report: { firstBlockingGate: "G0" },
    });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/manufacturing/verify",
    );
  });

  it("routes assembly verification through CAD v1", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          designOk: false,
          releaseReady: false,
          verificationUnavailable: ["interference"],
        }),
        { status: 200 },
      ),
    );
    const request = {
      state: { parts: [], mates: [] },
      preciseInterference: true,
      featureTrees: {},
    };
    const result = await callTool("verify_cad_assembly", request);
    expect(result).toMatchObject({
      ok: true,
      designOk: false,
      releaseReady: false,
    });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/assembly/verify",
    );
    expect(
      JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
    ).toEqual(request);
  });

  it("routes common mechanical/interior project verification through CAD v1", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          releaseReady: false,
          gates: [{ id: "placement", status: "not_run" }],
        }),
        { status: 200 },
      ),
    );
    const request = {
      structure: { valid: true },
      placement: { required: 1, resolved: 0, invalid: 0 },
      interior: { applicable: true },
    };
    const result = await callTool("verify_cad_project", request);
    expect(result).toMatchObject({ ok: true, releaseReady: false });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/project/verify",
    );
    expect(
      JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
    ).toEqual(request);
  });

  it("routes continuous door swing verification through CAD v1 unchanged", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const response = {
      ok: true,
      result: {
        clear: true,
        conservative: true,
        method: "continuous_sector_capsule",
      },
      quoteOrRfqSideEffects: false,
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(response), { status: 200 }),
      );
    const request = {
      pivot: { x: 0, y: 0 },
      closedAngleDeg: 0,
      openAngleDeg: 90,
      widthMm: 900,
      thicknessMm: 40,
      obstacles: [],
    };
    expect(
      await callTool("verify_door_swing_clearance", request),
    ).toMatchObject(response);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/interior/door-swing/verify",
    );
    expect(
      JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
    ).toEqual(request);
  });

  it("routes measured space boundary closure through CAD v1 unchanged", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { closed: true, conservative: true },
        }),
        { status: 200 },
      ),
    );
    const request = {
      segments: [
        { id: "a", start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
        { id: "b", start: { x: 1, y: 0 }, end: { x: 0, y: 1 } },
        { id: "c", start: { x: 0, y: 1 }, end: { x: 0, y: 0 } },
      ],
    };
    expect(
      await callTool("verify_space_boundary_closure", request),
    ).toMatchObject({ ok: true, result: { closed: true } });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/interior/space-boundary/verify",
    );
    expect(
      JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
    ).toEqual(request);
  });

  it("routes governed egress verification through CAD v1 unchanged", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { passed: true, conservative: true },
        }),
        { status: 200 },
      ),
    );
    const request = {
      nodes: [
        { id: "o", point: { x: 0, y: 0 } },
        { id: "e", point: { x: 1, y: 0 } },
      ],
      edges: [{ id: "p", from: "o", to: "e", clearWidthMm: 900 }],
      originNodeIds: ["o"],
      exitNodeIds: ["e"],
      maximumTravelDistanceMm: 10,
      minimumClearWidthMm: 800,
    };
    expect(await callTool("verify_egress_routes", request)).toMatchObject({
      ok: true,
      result: { passed: true },
    });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/interior/egress/verify",
    );
    expect(
      JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
    ).toEqual(request);
  });

  it("routes continuous MEP interference through CAD v1 unchanged", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          result: { clear: true, conservative: true },
        }),
        { status: 200 },
      ),
    );
    const request = {
      runs: [
        {
          id: "p",
          system: "pipe",
          centerline: [
            { x: 0, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
          ],
          outerDiameterMm: 1,
        },
      ],
      obstacles: [],
    };
    expect(await callTool("verify_mep_interference", request)).toMatchObject({
      ok: true,
      result: { clear: true },
    });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/interior/mep-interference/verify",
    );
    expect(
      JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
    ).toEqual(request);
  });

  it("routes the complete AI generation certificate through CAD v1", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          releaseReady: false,
          decision: { stage: "assembly_solve" },
        }),
        { status: 200 },
      ),
    );
    const result = await callTool("verify_ai_generation", {
      intent: { unresolved: [], conflicts: [] },
      decomposition: { valid: true, independentPartCount: 1, errors: [] },
      parts: [],
    });
    expect(result).toMatchObject({ ok: true, releaseReady: false });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/generation/verify",
    );
  });

  it("routes generation state transitions without flattening checkpoint evidence", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          state: { schema: "nexyfab.generation-run.v1", revision: 0 },
        }),
        { status: 200 },
      ),
    );
    const request = { action: "initialize", runId: "mcp-run" };
    expect(
      await callTool("transition_ai_generation_state", request),
    ).toMatchObject({ ok: true, state: { revision: 0 } });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/generation/state",
    );
    expect(
      JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
    ).toEqual(request);
  });

  it("routes generation evidence advancement through the common API", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const canonical = {
      schema: "nexyfab.generation-canonical-response.v1",
      status: "fail",
      stoppedAt: "assembly_solve",
      codes: ["ASSEMBLY_TOPOLOGY_REVIEW_REQUIRED"],
      unresolvedCount: 1,
      unresolvedByStage: [{ stage: "assembly_solve", count: 1 }],
      affectedPartIds: ["p1"],
      contractHash: "d".repeat(64),
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          stoppedAt: "motion",
          state: { revision: 7 },
          canonical,
        }),
        { status: 200 },
      ),
    );
    const request = {
      state: { schema: "nexyfab.generation-run.v1" },
      program: { version: 1 },
    };
    expect(await callTool("advance_ai_generation", request)).toMatchObject({
      ok: true,
      stoppedAt: "motion",
      canonical,
    });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/generation/advance",
    );
    expect(
      JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
    ).toEqual(request);
  });

  it("routes generation finalization without flattening part evidence", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const canonical = {
      schema: "nexyfab.generation-canonical-response.v1",
      status: "pass",
      stoppedAt: "complete",
      releaseReady: true,
      contractHash: "b".repeat(64),
      quoteOrRfqSideEffects: false,
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, stoppedAt: "complete", canonical }),
        {
          status: 200,
        },
      ),
    );
    const request = {
      state: {},
      program: {},
      motion: { required: false },
      parts: [
        {
          partId: "p1",
          referenceStep: {
            source: "ISO-10303-21;DATA;ENDSEC;END-ISO-10303-21;",
            requirements: ["flat_pattern", "bend_table"],
          },
        },
      ],
    };
    expect(await callTool("finalize_ai_generation", request)).toMatchObject({
      ok: true,
      stoppedAt: "complete",
      canonical,
    });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/generation/finalize",
    );
    expect(
      JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit).body)),
    ).toEqual(request);
  });

  it("routes six-axis robot generation through the common API", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          releaseReady: false,
          program: { parts: [] },
        }),
        { status: 200 },
      ),
    );
    const result = await callTool("generate_robot_6axis", {
      spec: { payloadKg: 4, joints: [] },
    });
    expect(result).toMatchObject({ ok: true, releaseReady: false });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/robot/generate",
    );
  });

  it("queries capabilities without requiring an API key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          quoteOrRfqSideEffects: false,
          operations: [],
        }),
        { status: 200 },
      ),
    );
    expect(await callTool("cad_capabilities", {})).toMatchObject({
      ok: true,
      quoteOrRfqSideEffects: false,
    });
  });

  it("forwards selection-scoped feature edits without flattening the context", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ part: "bracket", features: [{}] }), {
        status: 200,
      }),
    );
    const selectionContext = {
      version: 1,
      topology: [{ kind: "face", persistentRef: "f.cap.top" }],
    };
    await callTool("cad_feature_program", {
      prompt: "make this face 5mm higher",
      selectionContext,
    });
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/feature-program",
    );
    expect(JSON.parse(String(init.body)).selectionContext).toEqual(
      selectionContext,
    );
  });

  it("routes product decomposition to the canonical API contract", async () => {
    process.env.NEXYFAB_API_KEY = "nf_test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, program: { parts: [] } }), {
        status: 200,
      }),
    );
    const result = await callTool("product_decomposition", { text: "clamp" });
    expect(result).toMatchObject({ ok: true });
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/cad/v1/product-decomposition",
    );
  });

  it("is honest when a remote CAD tool has no API key", async () => {
    const result = await callTool("reconcile_topology_references", {
      previous: [],
      current: [],
    });
    expect(result).toMatchObject({ ok: false, remoteOnly: true });
  });
});
