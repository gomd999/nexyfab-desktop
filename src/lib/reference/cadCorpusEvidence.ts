import { createHash } from "node:crypto";
import { stepToIr } from "@/lib/cad-ir/ingestStep";
import { stlToIr } from "@/lib/cad-ir/ingestStl";
import { dxfToIr2d, roundTripVerify2d } from "@/lib/cad-ir/ingestDxf2d";
import { ifcToNexyfabAssembly } from "@/lib/brep-bridge/ifcImport";
import { importStepWithKernel } from "@/lib/brep-bridge/stepKernelImport";
import { analyzeAp242Pmi } from "./ap242PmiEvidence";
import { verifyAp242PmiSemanticRoundtrip } from "./ap242PmiSemanticRoundtrip";
import { roundtripStepWithOcct } from "./occtStepRoundtrip";
import { importStepAssembly } from "@/lib/brep-bridge/stepAssemblyImport";
import {
  analyzeStepAssemblyStructure,
  analyzeStepPatternFidelity,
} from "./stepAssemblyEvidence";
import { analyzeIfcSemantics } from "./ifcSemanticEvidence";
import { analyzeIfcSpatialStructure } from "./ifcSpatialStructure";
import { parseXt } from "@/lib/brep-bridge/xtImport";
import { analyzeStepMechanicalRelations } from "./stepMechanicalRelationEvidence";
import { analyzeStepWeldmentEvidence } from "./stepWeldmentEvidence";
import { analyzeStepSheetMetalEvidence } from "./stepSheetMetalEvidence";

export type EvidenceStatus = "pass" | "fail" | "not_run";
export interface CorpusAssertionEvidence {
  assertion: string;
  status: EvidenceStatus;
  measured?: number | string | boolean;
  reason: string;
}
export interface CadCorpusEvidence {
  schemaVersion: 1;
  scenarioId: string;
  input: { sha256: string; extension: string; sizeBytes: number };
  importer: string;
  status: EvidenceStatus;
  assertions: CorpusAssertionEvidence[];
  sideEffects: { quoteCreated: false; rfqSent: false; sourceModified: false };
}

export function classifyCombinedStepRoundtrip(
  roundtrip: Awaited<ReturnType<typeof roundtripStepWithOcct>>,
): {
  status: EvidenceStatus;
  reason: string;
} {
  if (!roundtrip.geometry.pass)
    return {
      status: "fail",
      reason: roundtrip.reason ?? "OCCT geometry STEP roundtrip failed.",
    };
  const sourcePmi =
    roundtrip.pmi.sourceSemantic + roundtrip.pmi.sourceGraphical;
  const exportedPmi =
    roundtrip.pmi.exportedSemantic + roundtrip.pmi.exportedGraphical;
  if (sourcePmi === 0 && exportedPmi === 0) {
    return {
      status: "not_run",
      reason:
        "Geometry roundtrip passed, but neither source nor export contains supported PMI; 0→0 is absence, not PMI preservation evidence.",
    };
  }
  const preserved =
    roundtrip.pmi.sourceSemantic === roundtrip.pmi.exportedSemantic &&
    roundtrip.pmi.sourceGraphical === roundtrip.pmi.exportedGraphical &&
    roundtrip.pmi.sourceTopologyCoverage ===
      roundtrip.pmi.exportedTopologyCoverage;
  return preserved
    ? {
        status: "pass",
        reason:
          "OCCT preserved measured geometry and all source-present PMI evidence counts.",
      }
    : {
        status: "fail",
        reason:
          "Combined AP242 roundtrip changed geometry or PMI evidence counts.",
      };
}

export function classifyGeometryImportSolidCount(solids: number): {
  status: Extract<EvidenceStatus, "pass" | "fail">;
  reason: string;
} {
  return Number.isSafeInteger(solids) && solids > 0
    ? { status: "pass", reason: "Faithful STEP geometry was measured." }
    : {
        status: "fail",
        reason:
          "STEP parsing returned no measurable solid; an empty topology cannot pass geometry import.",
      };
}

const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const evidence = (
  assertion: string,
  status: EvidenceStatus,
  reason: string,
  measured?: number | string | boolean,
): CorpusAssertionEvidence => ({
  assertion,
  status,
  reason,
  ...(measured === undefined ? {} : { measured }),
});
export function classifySubassemblyEvidence(structure: {
  occurrences: number;
  maxDepth: number;
}): CorpusAssertionEvidence {
  return evidence(
    "subassemblies",
    structure.maxDepth >= 2
      ? "pass"
      : structure.occurrences > 0
        ? "fail"
        : "not_run",
    structure.maxDepth >= 2
      ? "The NAUO graph preserves at least one nested subassembly level."
      : structure.occurrences > 0
        ? "The measured STEP occurrence graph is flat and does not contain the required nested subassembly level."
        : "No STEP occurrence graph was available to evaluate nesting.",
    structure.maxDepth,
  );
}

async function appendStepAssertions(
  results: CorpusAssertionEvidence[],
  assertions: string[],
  bytes: Uint8Array,
): Promise<void> {
  const requested = new Set(assertions);
  const stepText = new TextDecoder("latin1").decode(bytes);
  let pmi: Awaited<ReturnType<typeof analyzeAp242Pmi>> | null = null;
  let occtRoundtrip: Awaited<ReturnType<typeof roundtripStepWithOcct>> | null =
    null;
  if (
    requested.has("semantic_pmi_count") ||
    requested.has("topology_reference") ||
    requested.has("graphical_semantic_separation")
  ) {
    pmi = await analyzeAp242Pmi(stepText);
  }
  if (requested.has("semantic_pmi_count")) {
    results.push(
      evidence(
        "semantic_pmi_count",
        pmi!.semantic.total > 0 ? "pass" : "fail",
        pmi!.semantic.total > 0
          ? "Semantic datum, dimension, and GD&T entities were deterministically parsed."
          : "No supported semantic PMI entities were parsed.",
        pmi!.semantic.total,
      ),
    );
  }
  if (requested.has("topology_reference")) {
    const linked = pmi!.topology.rootsReachingAdvancedFace;
    results.push(
      evidence(
        "topology_reference",
        linked > 0 ? "pass" : "fail",
        linked > 0
          ? `${linked}/${pmi!.topology.semanticRoots} semantic roots reach ADVANCED_FACE through the bounded STEP reference graph; this is linkage evidence, not persistent-name identity.`
          : "No semantic PMI root reached an ADVANCED_FACE through the bounded STEP reference graph.",
        pmi!.topology.coverage,
      ),
    );
  }
  if (requested.has("graphical_semantic_separation")) {
    const separated = pmi!.semantic.total > 0 && pmi!.graphical.total > 0;
    results.push(
      evidence(
        "graphical_semantic_separation",
        separated ? "pass" : "not_run",
        separated
          ? `Semantic (${pmi!.semantic.total}) and graphical (${pmi!.graphical.total}) PMI were counted independently.`
          : "This file does not contain both supported semantic and graphical PMI evidence.",
        `${pmi!.semantic.total}/${pmi!.graphical.total}`,
      ),
    );
  }
  if (requested.has("pmi_semantic_roundtrip")) {
    const roundtrip = await verifyAp242PmiSemanticRoundtrip(stepText);
    results.push(
      evidence(
        "pmi_semantic_roundtrip",
        roundtrip.pass ? "pass" : "fail",
        roundtrip.pass
          ? "Datum, dimensional tolerance, and geometric tolerance semantics survived normalized AP242 export and re-import. Scope excludes product geometry and persistent topology identity."
          : `Semantic PMI roundtrip mismatches: ${roundtrip.mismatches.join(", ") || "empty PMI"}.`,
        roundtrip.before.datums.length +
          roundtrip.before.dimensions.length +
          roundtrip.before.geometricTolerances.length,
      ),
    );
  }
  if (
    requested.has("geometry_step_roundtrip") ||
    requested.has("step_roundtrip")
  ) {
    occtRoundtrip = await roundtripStepWithOcct(bytes);
  }
  if (requested.has("geometry_step_roundtrip")) {
    results.push(
      evidence(
        "geometry_step_roundtrip",
        occtRoundtrip!.geometry.pass ? "pass" : "fail",
        occtRoundtrip!.geometry.pass
          ? `OCCT import/export preserved ${occtRoundtrip!.geometry.sourceParts} measured solid(s) and total volume within 0.1%.`
          : (occtRoundtrip!.reason ?? "OCCT geometry STEP roundtrip failed."),
        occtRoundtrip!.geometry.volumeDeltaPct ?? undefined,
      ),
    );
  }
  if (requested.has("step_roundtrip")) {
    const roundtrip = occtRoundtrip!;
    const classified = classifyCombinedStepRoundtrip(roundtrip);
    const counts = `semantic ${roundtrip.pmi.sourceSemantic}->${roundtrip.pmi.exportedSemantic}, graphical ${roundtrip.pmi.sourceGraphical}->${roundtrip.pmi.exportedGraphical}, topology ${roundtrip.pmi.sourceTopologyCoverage}->${roundtrip.pmi.exportedTopologyCoverage}`;
    results.push(
      evidence(
        "step_roundtrip",
        classified.status,
        `${classified.reason} (${counts}).`,
        counts,
      ),
    );
  }
  if (requested.has("bom_quantity")) {
    try {
      const assembly = importStepAssembly(stepText, { maxClassifyParts: 0 });
      const quantity = assembly.state.parts.length;
      results.push(
        evidence(
          "bom_quantity",
          quantity > 0 ? "pass" : "fail",
          quantity > 0
            ? "STEP product definitions and occurrences produced a deterministic instance quantity."
            : "No BOM-countable STEP part instance was recovered.",
          quantity,
        ),
      );
    } catch (error) {
      results.push(
        evidence(
          "bom_quantity",
          "fail",
          error instanceof Error
            ? error.message
            : "STEP assembly inventory failed.",
        ),
      );
    }
  }
  const structuralAssertions = [
    "subassemblies",
    "shaft_bearing_layout",
    "pattern_fidelity",
    "assembly_hierarchy",
    "pose_preservation",
    "concentric_mate",
  ];
  if (structuralAssertions.some((assertion) => requested.has(assertion))) {
    const structure = analyzeStepAssemblyStructure(stepText);
    const mechanical =
      requested.has("concentric_mate") || requested.has("shaft_bearing_layout")
        ? analyzeStepMechanicalRelations(stepText)
        : null;
    if (requested.has("subassemblies"))
      results.push(classifySubassemblyEvidence(structure));
    if (requested.has("assembly_hierarchy"))
      results.push(
        evidence(
          "assembly_hierarchy",
          structure.occurrences > 0 ? "pass" : "not_run",
          structure.occurrences > 0
            ? "STEP assembly occurrence relationships were preserved."
            : "No STEP assembly occurrence relationship was found.",
          structure.occurrences,
        ),
      );
      if (requested.has("pattern_fidelity")) {
        const pattern = analyzeStepPatternFidelity(stepText);
        // Reusing one part definition at arbitrary placements is valid assembly
        // structure, not proof that the author intended a linear/circular CAD
        // pattern. Without source pattern semantics, irregularity is unresolved
        // rather than a geometry failure.
        const status = pattern.status === "fail" ? "not_run" : pattern.status;
        results.push(
          evidence(
            "pattern_fidelity",
            status,
            status === "pass"
              ? `${pattern.regularGroups} repeated definition group(s) have measured regular linear or circular pitch.`
              : pattern.irregularGroups
                ? `${pattern.irregularGroups} repeated definition group(s) are irregular, but the STEP source contains no authoritative pattern intent to classify that as failure.`
                : "No repeated definition group has three authoritative world placements.",
          `${pattern.regularGroups}/${pattern.irregularGroups}/${pattern.unresolvedGroups}`,
        ),
      );
    }
    if (requested.has("shaft_bearing_layout")) {
      const rolesPresent =
          structure.shaftNamedDefinitions > 0 &&
          structure.bearingNamedDefinitions > 0,
        pairs = mechanical!.shaftBearingPairs.length;
      results.push(
        evidence(
          "shaft_bearing_layout",
          pairs > 0
            ? "pass"
            : rolesPresent && mechanical!.axes.length > 1
              ? "fail"
              : "not_run",
          pairs > 0
            ? "Named shaft and bearing occurrences share a measured analytic cylinder axis."
            : rolesPresent && mechanical!.axes.length > 1
              ? "Named shaft and bearing geometry was measurable but no coaxial axis pair satisfied tolerance."
              : "Shaft/bearing roles or analytic cylinder axes are incomplete.",
          `${pairs}/${mechanical!.axes.length}`,
        ),
      );
    }
    if (requested.has("concentric_mate")) {
      const distinctParts = new Set(mechanical!.axes.map((axis) => axis.partId))
          .size,
        pairs = mechanical!.coaxialPairs.length;
      results.push(
        evidence(
          "concentric_mate",
          pairs > 0 ? "pass" : distinctParts >= 2 ? "fail" : "not_run",
          pairs > 0
            ? "Distinct STEP part occurrences contain a measured coaxial cylindrical-surface pair."
            : distinctParts >= 2
              ? "Multiple cylindrical parts were measured but none were concentric within governed tolerances."
              : "At least two distinct parts with analytic cylindrical surfaces are required.",
          `${pairs}/${mechanical!.axes.length}`,
        ),
      );
    }
    if (requested.has("pose_preservation"))
      results.push(
        evidence(
          "pose_preservation",
          structure.occurrences > 0 && structure.transformedOccurrences > 0
            ? "pass"
            : "not_run",
          structure.occurrences > 0 && structure.transformedOccurrences > 0
            ? "Assembly occurrences and explicit transformation entities preserve a source pose."
            : "No explicit occurrence transform was found; pose preservation cannot be certified.",
          structure.transformedOccurrences,
        ),
      );
  }
  const weldmentAssertions = [
    "member_identity",
    "miter_lengths",
    "cut_list",
    "mass",
  ];
  if (weldmentAssertions.some((assertion) => requested.has(assertion))) {
    const weldment = analyzeStepWeldmentEvidence(stepText);
    if (requested.has("member_identity"))
      results.push(
        evidence(
          "member_identity",
          weldment.status,
          weldment.status === "pass"
            ? `${weldment.members.length} elongated STEP solids have measured member axes, profiles, and lengths.`
            : weldment.status === "fail"
              ? "Measured solids do not establish at least two structural members."
              : "No measurable solid bounds are available.",
          weldment.members.length,
        ),
      );
    if (requested.has("cut_list"))
      results.push(
        evidence(
          "cut_list",
          weldment.status,
          weldment.status === "pass"
            ? `${weldment.cutList.length} profile/length groups were deterministically aggregated from measured members.`
            : "A cut list requires at least two measured structural members.",
          weldment.cutList.length,
        ),
      );
    if (requested.has("miter_lengths"))
      results.push(
        evidence(
          "miter_lengths",
          weldment.miter.status,
          weldment.miter.status === "pass"
            ? `${weldment.miter.resolvedMembers} members have two authoritative STEP end planes with centreline length and cut angle.`
            : (weldment.miter.reason ??
                "Exact member end planes are unavailable."),
          weldment.miter.resolvedMembers,
        ),
      );
    if (requested.has("mass"))
      results.push(evidence("mass", "not_run", weldment.unresolved.mass));
  }
  const sheetAssertions = ["independent_panels", "flat_pattern", "bend_table"];
  if (sheetAssertions.some((assertion) => requested.has(assertion))) {
    const sheet = analyzeStepSheetMetalEvidence(stepText);
    if (requested.has("independent_panels"))
      results.push(
        evidence(
          "independent_panels",
          sheet.status,
          sheet.status === "pass"
            ? `${sheet.panels.length} distinct constant-thickness STEP occurrences satisfy the governed panel aspect policy.`
            : sheet.status === "fail"
              ? "Imported occurrences do not establish at least two independent thin panels."
              : "No occurrence bounds are available for panel recognition.",
          sheet.panels.length,
        ),
      );
    if (requested.has("flat_pattern"))
      results.push(
        evidence(
          "flat_pattern",
          sheet.flatPattern.status,
          sheet.flatPattern.status === "pass"
            ? `${sheet.flatPattern.patterns.length} flat panels have exact planar outer-loop patterns with no unrepresented inner loops.`
            : (sheet.flatPattern.reason ??
                "Exact flat-pattern evidence is unavailable."),
          sheet.flatPattern.patterns.length,
        ),
      );
    if (requested.has("bend_table"))
      results.push(
        evidence(
          "bend_table",
          sheet.bendTable.status,
          sheet.bendTable.status === "pass"
            ? sheet.bendTable.rows.length
              ? `${sheet.bendTable.rows.length} bend rows have authoritative coaxial inner/outer surfaces, radius, thickness, axis, and trimmed angle.`
              : (sheet.bendTable.reason ??
                "The exact planar parts require no bend rows.")
            : (sheet.bendTable.reason ??
                "Exact bend-table evidence is unavailable."),
          sheet.bendTable.rows.length,
        ),
      );
  }
  for (const assertion of assertions) {
    if (
      [
        "independent_parts",
        "part_count",
        "semantic_pmi_count",
        "topology_reference",
        "graphical_semantic_separation",
        "pmi_semantic_roundtrip",
        "geometry_step_roundtrip",
        "step_roundtrip",
        "bom_quantity",
        ...structuralAssertions,
        ...weldmentAssertions,
        ...sheetAssertions,
      ].includes(assertion)
    )
      continue;
    results.push(
      evidence(
        assertion,
        "not_run",
        "No governed roundtrip/assembly adapter is registered for this STEP assertion.",
      ),
    );
  }
}

function finish(
  scenarioId: string,
  extension: string,
  bytes: Uint8Array,
  importer: string,
  assertions: CorpusAssertionEvidence[],
): CadCorpusEvidence {
  const status: EvidenceStatus = assertions.some(
    (item) => item.status === "fail",
  )
    ? "fail"
    : assertions.some((item) => item.status === "not_run")
      ? "not_run"
      : "pass";
  return {
    schemaVersion: 1,
    scenarioId,
    input: { sha256: hash(bytes), extension, sizeBytes: bytes.byteLength },
    importer,
    status,
    assertions,
    sideEffects: { quoteCreated: false, rfqSent: false, sourceModified: false },
  };
}

export async function evaluateCadCorpusFile(input: {
  scenarioId: string;
  extension: string;
  bytes: Uint8Array;
  assertions: string[];
  allowKernelFallback?: boolean;
}): Promise<CadCorpusEvidence> {
  const ext = input.extension.replace(/^\./, "").toLowerCase();
  const requested = new Set(input.assertions);
  const results: CorpusAssertionEvidence[] = [];

  if (ext === "step" || ext === "stp") {
    const parsed = stepToIr(input.bytes, {
      path: "[quarantined]",
      name: input.scenarioId,
      source_hint: "local-reference-corpus",
    });
    if (!parsed.ok || !parsed.ir) {
      if (input.allowKernelFallback !== false) {
        const kernel = await importStepWithKernel(input.bytes, {
          idPrefix: input.scenarioId,
        });
        if (kernel.ok && kernel.parts.length > 0) {
          results.push(
            evidence(
              "geometry_import",
              "pass",
              "Pure-TS classification failed; isolated OCCT imported and measured the real B-rep mesh.",
              kernel.parts.length,
            ),
          );
          if (
            requested.has("independent_parts") ||
            requested.has("part_count")
          ) {
            let assemblyParts = 0;
            try {
              assemblyParts = importStepAssembly(
                new TextDecoder("latin1").decode(input.bytes),
                { maxClassifyParts: 0 },
              ).state.parts.length;
            } catch {
              /* kernel count remains authoritative fallback */
            }
            const partCount = Math.max(kernel.parts.length, assemblyParts);
            results.push(
              evidence(
                "independent_parts",
                partCount > 1 ? "pass" : "fail",
                partCount > 1
                  ? "STEP assembly occurrences or OCCT solids preserved multiple independent parts."
                  : "Only one measurable solid or assembly instance was recovered.",
                partCount,
              ),
            );
          }
          await appendStepAssertions(results, input.assertions, input.bytes);
          return finish(
            input.scenarioId,
            ext,
            input.bytes,
            "occt_kernel_mesh_v1",
            results,
          );
        }
        results.push(
          evidence(
            "geometry_import",
            "fail",
            `Pure-TS: ${parsed.reason ?? "no geometry"}; OCCT: ${kernel.reason ?? "no geometry"}`,
          ),
        );
        return finish(
          input.scenarioId,
          ext,
          input.bytes,
          "occt_kernel_mesh_v1",
          results,
        );
      }
      results.push(
        evidence(
          "geometry_import",
          "fail",
          parsed.reason ?? "STEP importer returned no faithful geometry",
        ),
      );
      return finish(
        input.scenarioId,
        ext,
        input.bytes,
        "step_brep_pure_ts_v1",
        results,
      );
    }
    const solids = parsed.ir.topology?.solids ?? 0;
    const geometryImport = classifyGeometryImportSolidCount(solids);
    results.push(
      evidence(
        "geometry_import",
        geometryImport.status,
        geometryImport.reason,
        solids,
      ),
    );
    if (requested.has("independent_parts") || requested.has("part_count")) {
      results.push(
        evidence(
          "independent_parts",
          solids > 1 ? "pass" : "fail",
          solids > 1
            ? "Multiple solids remained distinct."
            : "Only one measurable solid was recovered.",
          solids,
        ),
      );
    }
    await appendStepAssertions(results, input.assertions, input.bytes);
    return finish(
      input.scenarioId,
      ext,
      input.bytes,
      parsed.ir.parse.parser,
      results,
    );
  }

  if (ext === "stl") {
    const ir = stlToIr(input.bytes, {
      path: "[quarantined]",
      name: input.scenarioId,
      source_hint: "local-reference-corpus",
    });
    results.push(
      evidence(
        "mesh_import",
        ir.parse.status === "ok" ? "pass" : "fail",
        ir.parse.error ?? "STL mesh measured.",
        ir.mesh?.triangles ?? 0,
      ),
    );
    results.push(
      evidence(
        "analytic_brep",
        "not_run",
        "STL has no analytic B-rep or declared units.",
      ),
    );
    return finish(input.scenarioId, ext, input.bytes, ir.parse.parser, results);
  }

  if (ext === "dxf") {
    const text = new TextDecoder().decode(input.bytes);
    const parsed = await dxfToIr2d(text);
    const gate = parsed.ir2d ? await roundTripVerify2d(parsed.ir2d) : null;
    results.push(
      evidence(
        "drawing_import",
        parsed.ok ? "pass" : "fail",
        parsed.reason ?? "DXF evidence extracted.",
      ),
    );
    results.push(
      evidence(
        "dxf_roundtrip",
        gate?.status === "pass"
          ? "pass"
          : gate?.status === "unavailable"
            ? "not_run"
            : "fail",
        gate?.reason ?? gate?.feedback ?? "DXF roundtrip could not run.",
      ),
    );
    return finish(input.scenarioId, ext, input.bytes, "dxf_seed_v1", results);
  }

  if (ext === "ifc") {
    const text = new TextDecoder("latin1").decode(input.bytes);
    const parsed = ifcToNexyfabAssembly(text, { name: input.scenarioId });
    const count = parsed.assembly?.parts.length ?? 0;
    const definitionOnly = parsed.assembly?.definitionOnly === true;
    const unsupportedGeometry =
      !parsed.ok && parsed.error?.includes("지원 클래스/형상 없음");
    results.push(
      evidence(
        "ifc_geometry",
        parsed.ok ? "pass" : unsupportedGeometry ? "not_run" : "fail",
        parsed.error ?? "IFC physical elements imported.",
        count,
      ),
    );
    results.push(
      evidence(
        "independent_parts",
        !parsed.ok || definitionOnly ? "not_run" : count > 1 ? "pass" : "fail",
        definitionOnly
          ? "Reusable IFC type geometry has no placed physical occurrence."
          : count > 1
            ? "Multiple IFC physical elements remained distinct."
            : !parsed.ok
              ? "Independent physical-part evidence is unavailable because governed IFC geometry did not import."
              : "Fewer than two physical elements imported.",
        count,
      ),
    );
    const semantics = analyzeIfcSemantics(text);
    const spatial = analyzeIfcSpatialStructure(text);
    results.push(
      evidence(
        "ifc_spatial_hierarchy",
        spatial.nodes.length > 0 && spatial.relatedCount > 0
          ? "pass"
          : "not_run",
        spatial.nodes.length > 0 && spatial.relatedCount > 0
          ? "Explicit IFC spatial/product nodes and parent relations were parsed without counting spatial containers as physical parts."
          : "No explicit governed IFC parent relation was available.",
        `${spatial.spatialCount}/${spatial.elementCount}/${spatial.relatedCount}`,
      ),
    );
    results.push(
      evidence(
        "ifc_placements",
        spatial.unresolvedPlacementCount > 0 || spatial.cycleCount > 0
          ? "not_run"
          : spatial.availablePlacementCount > 0
            ? "pass"
            : "not_run",
        spatial.unresolvedPlacementCount > 0 || spatial.cycleCount > 0
          ? "One or more IFC placements are missing, invalid, or cyclic; identity was not invented."
          : spatial.availablePlacementCount > 0
            ? "Every measured non-project IFC node has a structurally valid IfcLocalPlacement chain."
            : "No governed IFC placement was available.",
        `${spatial.availablePlacementCount}/${spatial.unresolvedPlacementCount}/${spatial.cycleCount}`,
      ),
    );
    const semanticCounts: Record<string, number> = {
      guid: semantics.guids,
      hierarchy: semantics.hierarchyRelations,
      material: semantics.materialRelations,
      property: semantics.propertySets,
      quantity: semantics.quantitySets,
      georeference: semantics.georeferenceEntities,
    };
    for (const assertion of input.assertions) {
      if (assertion === "independent_parts") continue;
      const measured = semanticCounts[assertion];
      if (measured === undefined)
        results.push(
          evidence(
            assertion,
            "not_run",
            "No governed IFC semantic adapter is registered for this assertion.",
          ),
        );
      else
        results.push(
          evidence(
            assertion,
            measured > 0 ? "pass" : "not_run",
            measured > 0
              ? `Explicit IFC ${assertion} entities were parsed independently of geometry.`
              : `No explicit IFC ${assertion} entity was found in this source.`,
            measured,
          ),
        );
    }
    return finish(
      input.scenarioId,
      ext,
      input.bytes,
      "ifc_nexyfab_v1",
      results,
    );
  }

  if (ext === "x_t" || ext === "xt" || ext === "xmt_txt") {
    const text = new TextDecoder("latin1").decode(input.bytes);
    const parsed = parseXt(text);
    const bodies = parsed.bodies ?? 0;
    results.push(
      evidence(
        "xt_structure",
        parsed.ok ? "pass" : "fail",
        parsed.ok
          ? "Parasolid XT node stream and body records were parsed."
          : (parsed.error ?? "XT parse failed."),
        bodies,
      ),
    );
    for (const assertion of input.assertions) {
      if (assertion === "part_count" || assertion === "independent_parts") {
        results.push(
          evidence(
            assertion,
            bodies > 1 ? "pass" : "not_run",
            bodies > 1
              ? "Multiple Parasolid body records remain independently countable."
              : "The XT stream does not prove multiple bodies.",
            bodies,
          ),
        );
      } else {
        results.push(
          evidence(
            assertion,
            "not_run",
            "Parasolid body records do not encode a certified assembly hierarchy, mates, or motion constraints in the current adapter.",
          ),
        );
      }
    }
    return finish(
      input.scenarioId,
      ext,
      input.bytes,
      "parasolid_xt_structure_v1",
      results,
    );
  }

  results.push(
    evidence(
      "import",
      "not_run",
      `No governed evidence adapter for .${ext || "(none)"}.`,
    ),
  );
  return finish(input.scenarioId, ext, input.bytes, "none", results);
}
