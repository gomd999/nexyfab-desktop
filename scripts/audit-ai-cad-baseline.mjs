#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const outputArg =
  process.argv
    .find((value) => value.startsWith("--output="))
    ?.slice("--output=".length) ??
  "docs/evidence/integrated-ai-cad-baseline-260806/manifest.json";
const root = process.cwd();
const artifacts = [
  "validation-reports/scad-agent-2026-08-06T09-10-47-repaired-3.json",
  "docs/evidence/scad-canonical-features-260806/run-6.json",
  "docs/evidence/scad-definition-geometry-260806/run-5.json",
  "docs/evidence/scad-analytic-brep-260806/run-12.json",
  "docs/evidence/scad-native-step-assembly-260806/run-5.json",
  "docs/evidence/scad-native-flow-260806/run-3.json",
  "docs/evidence/scad-interface-evidence-260806/run-6.json",
  "docs/evidence/topology-survival-260806/run-8.json",
  "docs/evidence/topology-consumer-rebind-260806/run-1.json",
  "docs/evidence/step-body-membership-260806/run-1.json",
  "docs/evidence/step-body-membership-260806/fixtures/native-multibody-weldment.step",
  "docs/evidence/step-body-membership-260806/fixtures/native-three-level-hierarchy.step",
  "docs/evidence/step-body-membership-260806/fixtures/native-four-level-branching-reuse.step",
  "docs/evidence/external-step-structure-coverage-260806/run-3.json",
  "docs/evidence/external-step-structure-coverage-260806/remediation-run-1.json",
  "docs/evidence/external-step-structure-coverage-260806/native-cad-preflight-run-1.json",
  "docs/evidence/external-step-structure-coverage-260806/unsupported-archive-triage-run-1.json",
  "docs/evidence/external-step-structure-coverage-260806/ifc-fidelity-run-1.json",
  "docs/evidence/external-step-structure-coverage-260806/ifc-collision-capability-run-1.json",
  "docs/evidence/complex-holdout-review-260806/dwg-import-results.json",
  "docs/evidence/external-step-structure-coverage-260806/dwg-revit-capability-preflight-run-1.json",
  "docs/evidence/complex-holdout-review-260806/exact-cad-worker-queue.json",
  "docs/evidence/complex-holdout-review-260806/exact-cad-worker-results.json",
  "docs/evidence/complex-holdout-review-260806/exact-worker-promoted-native-results.json",
  "docs/evidence/complex-holdout-review-260806/ground-truth-approval-queue.json",
  "docs/evidence/complex-holdout-review-260806/ground-truth-approval-records.json",
  "docs/evidence/complex-holdout-review-260806/ground-truth-approval-validation.json",
  "docs/evidence/complex-holdout-review-260806/ground-truth-review-priority.json",
  "docs/evidence/complex-corpus-v2-approved/cases.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/summary.json",
  "docs/evidence/complex-corpus-v2-lineage-v2-260807/cases.json",
  "docs/evidence/complex-corpus-v2-lineage-v2-260807/assertion-graph.json",
  "docs/evidence/complex-corpus-v2-lineage-v2-260807/review-summary.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/preflight.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/structure-evidence.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/native-extraction-requests.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/ground-truth-approval-queue.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/ground-truth-review-priority.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/ground-truth-approval-validation.json",
  "docs/evidence/complex-corpus-v2-lineage-v2-approved/cases.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/shortfall-acquisition-queue.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/freecad-step-results.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/freecad-stp-results.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/freecad-ifc-results.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/freecad-iges-results.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/freecad-igs-results.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/freecad-direct-results-merged.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/freecad-direct-validation.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/freecad-zip-results.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/ifc-native-results.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/native-direct-results-merged.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/native-direct-validation.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/native-worker-routing-manifest.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/native-worker-execution-results.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/native-worker-host-preflight.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/native-worker-health-probe.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/native-worker-canary-gate.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/native-worker-canary-dry-run.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/freecad-remediation-pressure-vessel-01.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/freecad-remediation-factory-equipment-03.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/native-extraction-remediation-report.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/phase-b-review-packets.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/phase-b-review-packets-validation.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/phase-b-review-forms/index.json",
  "docs/evidence/complex-holdout-lineage-v2-260807/phase-b-review-submission-validation.json",
  "docs/strategy/phase-b-human-review-runbook-260807.md",
  "docs/evidence/complex-holdout-lineage-v2-260807/joint-evidence-boundary-report.json",
  "docs/strategy/native-cad-worker-host-deployment-260807.md",
  "docs/strategy/current-status-and-next-execution-plan-260807-v2.md",
  "docs/evidence/complex-holdout-lineage-v2-260807/zip-member-triage.json",
];
const implementation = [
  "src/lib/ai/scadAssemblyBridge.ts",
  "src/lib/ai/scadCanonicalFeatureProgram.ts",
  "src/lib/ai/scadCanonicalBrep.ts",
  "src/lib/ai/scadDeterministicRepair.ts",
  "src/lib/ai/scadInterfaceEvidence.ts",
  "src/lib/ai/partGenerationCertificate.ts",
  "src/lib/ai/productAssemblyCertificate.ts",
  "src/lib/ai/manufacturingGates.ts",
  "src/lib/ai/stepRoundtripVerification.ts",
  "src/lib/ai/stepBodyMembershipCertificate.ts",
  "src/lib/ai/advanceGenerationRun.ts",
  "src/lib/ai/generationCanonicalResponse.ts",
  "src/lib/ai/selectionContext.ts",
  "src/lib/ai/aiEditTransaction.ts",
  "src/lib/ai/assemblySelectionEdit.ts",
  "src/lib/cad/topologySurvivalEvidence.ts",
  "src/lib/cad/holeTopologySnapshots.ts",
  "src/lib/cad/patternTopologySnapshots.ts",
  "scripts/build-topology-survival-evidence.ts",
  "src/lib/cad/topologyReferencePropagation.ts",
  "src/lib/brep-bridge/stepAssemblyImport.ts",
  "src/lib/brep-bridge/stepWrite.ts",
  "scripts/build-topology-consumer-rebind-evidence.ts",
  "scripts/build-step-body-membership-evidence.ts",
  "scripts/build-external-step-structure-coverage.ts",
  "scripts/build-native-extraction-remediation.ts",
  "scripts/reference/freecad-extract-step.py",
  "scripts/reference/run-freecad-native-extractions.ts",
  "scripts/reference/triage-unsupported-native-archives.ts",
  "scripts/reference/triage-lineage-v2-zip-members.ts",
  "scripts/reference/run-ifc-native-extractions.ts",
  "scripts/reference/run-dwg-native-extractions.ts",
  "src/lib/brep-bridge/dwgImport.ts",
  "src/lib/reference/dwgRevitCapability.ts",
  "scripts/build-dwg-revit-capability-preflight.ts",
  "src/lib/reference/exactCadWorkerContract.ts",
  "scripts/reference/build-exact-cad-worker-queue.ts",
  "scripts/reference/run-exact-cad-workers.ts",
  "src/lib/reference/promoteExactCadWorkerResult.ts",
  "scripts/reference/promote-exact-cad-worker-results.ts",
  "src/lib/ai/complexGroundTruthApproval.ts",
  "scripts/reference/build-ground-truth-approval-queue.ts",
  "scripts/reference/build-complex-holdout-review-queues.mjs",
  "scripts/reference/build-complex-assertion-seed-from-review.mjs",
  "scripts/reference/migrate-complex-assertion-corpus.ts",
  "scripts/reference/preflight-complex-holdout-review.mjs",
  "scripts/reference/extract-complex-holdout-structure.mjs",
  "scripts/reference/build-complex-native-extraction-requests.mjs",
  "scripts/reference/build-complex-review-worklist.mjs",
  "scripts/reference/build-holdout-shortfall-acquisition.ts",
  "src/lib/reference/nativeWorkerRouting.ts",
  "scripts/reference/build-native-worker-routing-manifest.ts",
  "src/lib/reference/nativeWorkerExecution.ts",
  "scripts/reference/run-native-worker-routing-jobs.ts",
  "src/lib/reference/nativeWorkerHostContract.ts",
  "scripts/reference/build-native-worker-host-preflight.ts",
  "scripts/reference/probe-native-worker-hosts.ts",
  "scripts/reference/build-native-worker-canary-gate.ts",
  "scripts/reference/build-native-extraction-remediation-report.ts",
  "scripts/reference/build-phase-b-review-packets.ts",
  "scripts/reference/validate-phase-b-review-packets.ts",
  "scripts/reference/build-phase-b-review-forms.ts",
  "scripts/reference/validate-phase-b-review-submissions.ts",
  "src/lib/reference/jointEvidenceReleaseGate.ts",
  "scripts/reference/build-joint-evidence-boundary-report.ts",
  "scripts/create-workspace-checkpoint.mjs",
  "scripts/reference/build-ground-truth-review-priority.ts",
  "scripts/reference/validate-ground-truth-approvals.ts",
  "src/lib/reference/complexNativeExtraction.ts",
  "src/lib/reference/nativeCadCapability.ts",
  "src/lib/brep-bridge/ifcImport.ts",
  "src/lib/brep-bridge/indexedMeshClosure.ts",
  "scripts/build-ifc-fidelity-evidence.ts",
  "src/lib/reference/indexedMeshCollision.ts",
  "src/lib/ai/design-driver/interferencePrecise.ts",
  "scripts/build-ifc-collision-capability-evidence.ts",
  "src/app/api/cad/v1/generation/advance/route.ts",
  "src/app/api/cad/v1/generation/finalize/route.ts",
  "src/app/[lang]/shape-generator/ai/generationSessionClient.ts",
  "scripts/cli/nexyfab.mjs",
  "scripts/drawing-to-3d/mcp-server.mjs",
  "scripts/build-scad-native-flow-evidence.mjs",
  "scripts/build-scad-native-step-assemblies.mjs",
];

const load = (relative) =>
  JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const digest = (relative) => {
  const bytes = fs.readFileSync(path.join(root, relative));
  return {
    path: relative,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};
const checks = [];
const check = (id, actual, expected) =>
  checks.push({
    id,
    status: Object.is(actual, expected) ? "pass" : "fail",
    actual,
    expected,
  });

for (const relative of [...artifacts, ...implementation])
  check(`file:${relative}`, fs.existsSync(path.join(root, relative)), true);
if (checks.some((item) => item.status === "fail")) {
  console.error(
    JSON.stringify(
      {
        status: "fail",
        checks: checks.filter((item) => item.status === "fail"),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const geometry = load(artifacts[2]),
  analytic = load(artifacts[3]),
  assembly = load(artifacts[4]),
  flow = load(artifacts[5]),
  interfaces = load(artifacts[6]),
  topology = load(artifacts[7]),
  topologyRebind = load(artifacts[8]),
  bodyMembership = load(artifacts[9]),
  externalStructure = load(artifacts[13]),
  ifcFidelity = load(artifacts[17]),
  ifcCollision = load(artifacts[18]),
  dwgImport = load(artifacts[19]),
  dwgRevitPreflight = load(artifacts[20]),
  exactCadQueue = load(artifacts[21]),
  exactCadResults = load(artifacts[22]),
  exactCadPromoted = load(artifacts[23]),
  groundTruthQueue = load(artifacts[24]),
  groundTruthRecords = load(artifacts[25]),
  groundTruthValidation = load(artifacts[26]),
  groundTruthPriority = load(artifacts[27]),
  approvedCases = load(artifacts[28]),
  lineageV2 = load(artifacts[29]),
  lineageCases = load(artifacts[30]),
  lineageGraph = load(artifacts[31]),
  lineageReview = load(artifacts[32]),
  lineagePreflight = load(artifacts[33]),
  lineageStructure = load(artifacts[34]),
  lineageRequests = load(artifacts[35]),
  lineageApprovalQueue = load(artifacts[36]),
  lineagePriority = load(artifacts[37]),
  lineageApprovalValidation = load(artifacts[38]),
  lineageApprovedCases = load(artifacts[39]),
  lineageShortfall = load(artifacts[40]);
check("mesh.scenarios", geometry.summary?.total, 4);
check("mesh.pass", geometry.summary?.pass, 4);
check("mesh.fail", geometry.summary?.fail, 0);
check("analytic.definitions", analytic.summary?.definitions, 12);
check("analytic.pass", analytic.summary?.analyticPass, 12);
check("analytic.fail", analytic.summary?.fail, 0);
check("analytic.not_run", analytic.summary?.notRun, 0);
check("analytic.mesh_cross_check", analytic.summary?.crossCheckPass, 12);
check("analytic.step_roundtrip", analytic.summary?.stepRoundtripPass, 12);
check("analytic.native_topology", analytic.summary?.nativeTopologyPass, 12);
check("analytic.part_certificate", analytic.summary?.partCertificatePass, 12);
check("assembly.scenarios", assembly.summary?.scenarios, 4);
check("assembly.pass", assembly.summary?.pass, 4);
check("assembly.fail", assembly.summary?.fail, 0);
check("assembly.definitions", assembly.summary?.definitions, 12);
check("assembly.occurrences", assembly.summary?.occurrences, 30);
check("interfaces.pass", interfaces.summary?.pass, 4);
check("interfaces.fail", interfaces.summary?.fail, 0);
check("interfaces.not_run", interfaces.summary?.notRun, 0);
const pipe = flow.results?.find((item) => item.scenarioId === "sc8_pipe_joint");
check("pipe.status", pipe?.status, "pass");
check("pipe.connected_components", pipe?.connectedComponentCount, 1);
check("pipe.blocked_junctions", pipe?.blockedJunctionCount, 0);
check(
  "manufacturing.release_ready",
  assembly.summary?.manufacturingReleaseReady,
  0,
);
check("topology.scope_status", topology.aggregate?.status, "passed");
check("topology.fixture_count", topology.fixtureCount, 180);
check("topology.samples", topology.aggregate?.sampleCount, 3400);
check("topology.survival_rate", topology.aggregate?.survivalRate, 1);
check("topology.ambiguous", topology.aggregate?.ambiguousCount, 0);
check("topology.broken", topology.aggregate?.brokenCount, 0);
check(
  "topology.extrude_status",
  topology.families?.extrude_depth?.status,
  "passed",
);
check(
  "topology.revolve_status",
  topology.families?.revolve_profile?.status,
  "passed",
);
check(
  "topology.boolean_status",
  topology.families?.boolean_split_merge?.status,
  "passed",
);
check(
  "topology.boolean_samples",
  topology.families?.boolean_split_merge?.sampleCount,
  80,
);
check(
  "topology.hole_intent_status",
  topology.families?.hole?.report?.status,
  "passed",
);
check(
  "topology.hole_intent_samples",
  topology.families?.hole?.report?.sampleCount,
  80,
);
check(
  "topology.hole_native_status",
  topology.families?.hole?.native_result_faces?.status,
  "passed",
);
check(
  "topology.hole_native_samples",
  topology.families?.hole?.native_result_faces?.sampleCount,
  120,
);
check(
  "topology.fillet_status",
  topology.families?.fillet_chamfer?.native_fillet_faces?.status,
  "passed",
);
check(
  "topology.fillet_samples",
  topology.families?.fillet_chamfer?.native_fillet_faces?.sampleCount,
  120,
);
check(
  "topology.chamfer_status",
  topology.families?.fillet_chamfer?.native_chamfer_faces?.status,
  "passed",
);
check(
  "topology.chamfer_samples",
  topology.families?.fillet_chamfer?.native_chamfer_faces?.sampleCount,
  120,
);
check(
  "topology.pattern_status",
  topology.families?.pattern?.report?.status,
  "passed",
);
check(
  "topology.pattern_samples",
  topology.families?.pattern?.report?.sampleCount,
  1800,
);
check(
  "topology.pattern_native_status",
  topology.families?.pattern?.native_brep_occurrences?.status,
  "passed",
);
check(
  "topology.pattern_native_samples",
  topology.families?.pattern?.native_brep_occurrences?.sampleCount,
  600,
);
check("topology_rebind.status", topologyRebind.status, "passed");
check("topology_rebind.fixtures", topologyRebind.summary?.fixtures, 20);
check("topology_rebind.pass", topologyRebind.summary?.pass, 20);
check("topology_rebind.fail", topologyRebind.summary?.fail, 0);
check(
  "topology_rebind.safe_solve_calls",
  topologyRebind.summary?.safeSolveCalls,
  20,
);
check(
  "topology_rebind.blocked_solve_calls",
  topologyRebind.summary?.blockedSolveCalls,
  0,
);
check("step_body_membership.scenarios", bodyMembership.summary?.scenarios, 7);
check("step_body_membership.pass", bodyMembership.summary?.pass, 7);
check("step_body_membership.fail", bodyMembership.summary?.fail, 0);
check("step_body_membership.not_run", bodyMembership.summary?.notRun, 0);
check(
  "step_body_membership.car_occurrence_reuse",
  bodyMembership.results?.find((item) => item.scenarioId === "sc9_simple_car")
    ?.imported?.occurrences,
  6,
);
check(
  "step_body_membership.bracket_occurrence_reuse",
  bodyMembership.results?.find(
    (item) => item.scenarioId === "sc10_brackets_grid",
  )?.imported?.occurrences,
  16,
);
check(
  "step_body_membership.native_multibody_positive",
  bodyMembership.results?.find(
    (item) => item.scenarioId === "native_multibody_weldment",
  )?.imported?.bodies,
  3,
);
const hierarchyFixture = bodyMembership.results?.find(
  (item) => item.scenarioId === "native_three_level_hierarchy",
);
check("step_hierarchy.path_depth", hierarchyFixture?.imported?.pathDepth, 3);
check(
  "step_hierarchy.relationships",
  hierarchyFixture?.imported?.relationships,
  2,
);
check(
  "step_hierarchy.world_translation_x",
  hierarchyFixture?.imported?.worldTranslation?.[0],
  80,
);
check(
  "step_hierarchy.world_rotation_xx",
  hierarchyFixture?.imported?.worldRotationDiagonal?.[0],
  -1,
);
check(
  "step_hierarchy.world_rotation_yy",
  hierarchyFixture?.imported?.worldRotationDiagonal?.[1],
  -1,
);
const branchingFixture = bodyMembership.results?.find(
  (item) => item.scenarioId === "native_four_level_branching_reuse",
);
check("step_branching.path_depth", branchingFixture?.imported?.pathDepth, 4);
check(
  "step_branching.relationships",
  branchingFixture?.imported?.relationships,
  5,
);
check("step_branching.occurrences", branchingFixture?.imported?.occurrences, 2);
check(
  "step_branching.reused_definition_count",
  branchingFixture?.imported?.reusedDefinitionCount,
  1,
);
check(
  "step_branching.branch_a_x",
  branchingFixture?.imported?.worldTranslations?.[0]?.[0],
  10,
);
check(
  "step_branching.branch_a_y",
  branchingFixture?.imported?.worldTranslations?.[0]?.[1],
  25,
);
check(
  "step_branching.branch_b_x",
  branchingFixture?.imported?.worldTranslations?.[1]?.[0],
  15,
);
check(
  "step_branching.branch_b_y",
  branchingFixture?.imported?.worldTranslations?.[1]?.[1],
  -20,
);
check("external_structure.selected", externalStructure.summary?.selected, 115);
check("external_structure.executed", externalStructure.summary?.executed, 38);
check(
  "external_structure.structural_pass",
  externalStructure.summary?.structuralPass,
  38,
);
check(
  "external_structure.structural_fail",
  externalStructure.summary?.structuralFail,
  0,
);
check(
  "external_structure.body_membership_not_run",
  externalStructure.summary?.bodyMembershipNotRun,
  3,
);
check(
  "external_structure.body_membership_pass",
  externalStructure.summary?.bodyMembershipPass,
  35,
);
check(
  "external_structure.joints_not_run",
  externalStructure.summary?.jointsNotRun,
  38,
);
check(
  "external_structure.approved_ground_truth",
  externalStructure.groundTruthApprovedCases,
  0,
);
check(
  "external_structure.score_eligible",
  externalStructure.scoreEligible,
  false,
);
check("ifc_fidelity.imported", ifcFidelity.summary?.totals?.imported, 1690);
check("ifc_fidelity.exact_display_mesh", ifcFidelity.summary?.totals?.exactDisplayMesh, 1690);
check("ifc_fidelity.aabb_only", ifcFidelity.summary?.totals?.aabbOnly, 0);
check("ifc_fidelity.open_surface_mesh", ifcFidelity.summary?.totals?.openSurfaceMesh, 967);
check("ifc_fidelity.exact_volume", ifcFidelity.summary?.totals?.exactMeshVolume, 723);
check("ifc_fidelity.boundary_edges", ifcFidelity.summary?.totals?.boundaryEdges, 197936);
check("ifc_fidelity.non_manifold_edges", ifcFidelity.summary?.totals?.nonManifoldEdges, 416);
check("ifc_fidelity.degenerate_repair_parts", ifcFidelity.summary?.totals?.degenerateRepairParts, 497);
check("ifc_fidelity.removed_degenerate_faces", ifcFidelity.summary?.totals?.removedDegenerateFaces, 6039);
check("ifc_fidelity.degenerate_faces", ifcFidelity.summary?.totals?.degenerateFaces, 0);
check("ifc_fidelity.boundary_components", ifcFidelity.summary?.totals?.boundaryComponents, 29851);
check("ifc_fidelity.closed_boundary_loops", ifcFidelity.summary?.totals?.closedBoundaryLoops, 29213);
check("ifc_fidelity.open_boundary_chains", ifcFidelity.summary?.totals?.openBoundaryChains, 0);
check("ifc_fidelity.branched_boundary_components", ifcFidelity.summary?.totals?.branchedBoundaryComponents, 638);
check("ifc_fidelity.planar_closed_boundary_loops", ifcFidelity.summary?.totals?.planarClosedBoundaryLoops, 26540);
check("ifc_fidelity.micro_gap_candidates", ifcFidelity.summary?.totals?.microGapCandidates, 0);
check("ifc_collision.surface_eligible", ifcCollision.summary?.surfaceIntersectionEligible, 1690);
check("ifc_collision.complete_eligible", ifcCollision.summary?.closedMeshCompleteEligible, 723);
check("ifc_collision.confirmation_only", ifcCollision.summary?.confirmationOnlyOpenMeshes, 967);
check("ifc_collision.confirmation_gate", ifcCollision.gates?.collisionConfirmation, "pass");
check("ifc_collision.clearance_gate", ifcCollision.gates?.completeCollisionAndClearance, "not_run");
check("ifc_fidelity.release_ready", ifcFidelity.releaseReady, false);
check("dwg_import.requested", dwgImport.summary?.requested, 16);
check("dwg_import.completed", dwgImport.summary?.completed, 16);
check("dwg_import.not_run", dwgImport.summary?.notRun, 0);
check("dwg_import.exact_3d", dwgImport.summary?.exact3d, 0);
check("dwg_import.2d_drawings", dwgImport.summary?.classifications?.["2d-drawing"], 8);
check("dwg_import.aabb_approximations", dwgImport.summary?.classifications?.["aabb-approximation"], 8);
check("dwg_import.score_eligible", dwgImport.scoreEligible, false);
check("dwg_import.release_ready", dwgImport.releaseReady, false);
check("dwg_import.no_native_assembly_claim", dwgImport.accuracyBoundary?.nativeAssemblySemanticsRecovered, false);
check("dwg_import.no_body_membership_claim", dwgImport.accuracyBoundary?.bodyMembershipAsserted, false);
check("dwg_import.no_revit_native_claim", dwgImport.accuracyBoundary?.revitFallbackCountsAsRevitNative, false);
check("dwg_revit_preflight.ready_executors", dwgRevitPreflight.summary?.readyExecutors, 0);
check("dwg_revit_preflight.not_run_executors", dwgRevitPreflight.summary?.notRunExecutors, 3);
check("dwg_revit_preflight.exact_dwg_queue", dwgRevitPreflight.summary?.exactDwgRecoveryCases, 8);
check("dwg_revit_preflight.revit_native_queue", dwgRevitPreflight.summary?.revitNativeCases, 5);
check("dwg_revit_preflight.score_eligible", dwgRevitPreflight.scoreEligible, false);
check("exact_cad_queue.jobs", exactCadQueue.summary?.jobs, 13);
check("exact_cad_queue.dwg", exactCadQueue.summary?.dwgExact, 8);
check("exact_cad_queue.revit", exactCadQueue.summary?.revitNative, 5);
check("exact_cad_queue.no_source_bytes", exactCadQueue.sourceBytesEmbedded, false);
check("exact_cad_queue.score_eligible", exactCadQueue.scoreEligible, false);
check("exact_cad_queue.unique_job_ids", new Set(exactCadQueue.jobs?.map((item) => item.jobId)).size, 13);
check("exact_cad_queue.revit_members", exactCadQueue.jobs?.filter((item) => item.workerKind === "revit-native").every((item) => item.sourceMember?.path?.toLowerCase().endsWith(".rvt")), true);
check("exact_cad_queue.dwg_members", exactCadQueue.jobs?.filter((item) => item.workerKind === "dwg-exact").every((item) => item.sourceMember?.path?.toLowerCase().endsWith(".dwg")), true);
check("exact_cad_results.requested", exactCadResults.summary?.requested, 13);
check("exact_cad_results.accepted", exactCadResults.summary?.accepted, 0);
check("exact_cad_results.not_run", exactCadResults.summary?.notRun, 13);
check("exact_cad_results.failed", exactCadResults.summary?.failed, 0);
check("exact_cad_results.score_eligible", exactCadResults.scoreEligible, false);
check("exact_cad_results.release_ready", exactCadResults.releaseReady, false);
check("exact_cad_results.no_source_bytes", exactCadResults.sourceBytesEmbedded, false);
check("exact_cad_promoted.results", exactCadPromoted.results?.length, 0);
check("exact_cad_promoted.withheld", exactCadPromoted.withheld, 0);
check("exact_cad_promoted.source", exactCadPromoted.promotedFrom, "exact-cad-worker-results.json");
check("ground_truth_queue.cases", groundTruthQueue.summary?.cases, 115);
check("ground_truth_queue.approved", groundTruthQueue.summary?.approved, 0);
check("ground_truth_queue.pending", groundTruthQueue.summary?.pending, 115);
check("ground_truth_queue.score_eligible", groundTruthQueue.summary?.scoreEligible, 0);
check("ground_truth_queue.no_automatic_approval", groundTruthQueue.policy?.automaticEvidenceGrantsApproval, false);
check("ground_truth_queue.dual_signoff", groundTruthQueue.policy?.dualIndependentSignoffRequired, true);
check("ground_truth_queue.mutation_invalidates", groundTruthQueue.policy?.artifactMutationInvalidatesApproval, true);
check("ground_truth_queue.no_source_bytes", groundTruthQueue.policy?.sourceBytesEmbedded, false);
check("ground_truth_records.empty", groundTruthRecords.records?.length, 0);
check("ground_truth_validation.cases", groundTruthValidation.summary?.cases, 115);
check("ground_truth_validation.approved", groundTruthValidation.summary?.approved, 0);
check("ground_truth_validation.pending", groundTruthValidation.summary?.pending, 115);
check("ground_truth_validation.invalid", groundTruthValidation.summary?.invalid, 0);
check("ground_truth_priority.selected", groundTruthPriority.summary?.selected, 30);
check("ground_truth_priority.per_family", groundTruthPriority.summary?.perFamily, 5);
check("ground_truth_priority.turbomachinery_deficit", groundTruthPriority.summary?.deficitsTo20?.turbomachinery, 5);
check("approved_campaign_cases", approvedCases.length, 0);
check("lineage_v2.required_per_family", lineageV2.policy?.requiredApprovedCasesPerFamily, 20);
check("lineage_v2.robot_selected", lineageV2.counts?.robot?.selected, 9);
check("lineage_v2.gearbox_selected", lineageV2.counts?.gearbox?.selected, 17);
check("lineage_v2.pressure_vessel_selected", lineageV2.counts?.pressure_vessel?.selected, 11);
check("lineage_v2.turbomachinery_selected", lineageV2.counts?.turbomachinery?.selected, 11);
check("lineage_v2.factory_equipment_selected", lineageV2.counts?.factory_equipment?.selected, 20);
check("lineage_v2.interior_selected", lineageV2.counts?.interior?.selected, 20);
check("lineage_v2.total_unique_selected", Object.values(lineageV2.counts ?? {}).reduce((sum, item) => sum + (item.selected ?? 0), 0), 88);
check("lineage_v2.total_shortfall", Object.values(lineageV2.counts ?? {}).reduce((sum, item) => sum + (item.shortfall ?? 0), 0), 32);
check("lineage_corpus.cases", lineageCases.length, 88);
check("lineage_corpus.graph_cases", lineageGraph.cases?.length, 88);
check("lineage_corpus.assertions", lineageReview.assertions, 862);
check("lineage_corpus.approved_assertions", lineageReview.approved?.length, 0);
check("lineage_preflight.cases", lineagePreflight.results?.length, 88);
check("lineage_preflight.source_hash_pass", lineagePreflight.results?.filter((item) => item.checks?.some((entry) => entry.id === "source-hash" && entry.status === "pass")).length, 88);
check("lineage_preflight.fail", lineagePreflight.results?.filter((item) => item.status === "fail").length, 0);
check("lineage_structure.cases", lineageStructure.cases, 88);
check("lineage_structure.part_definition_pass", lineageStructure.axisCounts?.part_definitions?.pass, 44);
check("lineage_structure.occurrence_pass", lineageStructure.axisCounts?.occurrences?.pass, 28);
check("lineage_structure.hierarchy_pass", lineageStructure.axisCounts?.hierarchy?.pass, 28);
check("lineage_native_requests", lineageRequests.requests?.length, 88);
check("lineage_approval_queue.pending", lineageApprovalQueue.summary?.pending, 88);
check("lineage_priority.selected", lineagePriority.summary?.selected, 30);
check("lineage_approval_validation.pending", lineageApprovalValidation.summary?.pending, 88);
check("lineage_approval_validation.invalid", lineageApprovalValidation.summary?.invalid, 0);
check("lineage_approved_cases", lineageApprovedCases.length, 0);
check("lineage_shortfall.required", lineageShortfall.summary?.required, 32);
check("lineage_shortfall.remaining", lineageShortfall.summary?.remaining, 32);
check("lineage_shortfall.robot", lineageShortfall.summary?.byFamily?.robot, 11);
check("lineage_shortfall.gearbox", lineageShortfall.summary?.byFamily?.gearbox, 3);
check("lineage_shortfall.pressure_vessel", lineageShortfall.summary?.byFamily?.pressure_vessel, 9);
check("lineage_shortfall.turbomachinery", lineageShortfall.summary?.byFamily?.turbomachinery, 9);
check("lineage_shortfall.not_cases", lineageShortfall.policy?.placeholdersAreNotCases, true);
check("lineage_shortfall.no_cross_family_reuse", lineageShortfall.policy?.crossFamilyReuseForbidden, true);
check(
  "step_body_membership.local_transforms_complete",
  bodyMembership.results?.every(
    (item) =>
      item.imported?.finiteLocalTransforms === item.imported?.relationships,
  ),
  true,
);
check(
  "step_body_membership.world_transforms_complete",
  bodyMembership.results?.every(
    (item) =>
      item.imported?.finiteWorldTransforms === item.imported?.occurrences,
  ),
  true,
);
const zipTriage = load(
  "docs/evidence/complex-holdout-lineage-v2-260807/zip-member-triage.json",
);
const nativeRoutingManifest = load(
  "docs/evidence/complex-holdout-lineage-v2-260807/native-worker-routing-manifest.json",
);
check("zip_triage.cases", zipTriage.summary?.zipCases, 28);
check("zip_triage.routed", zipTriage.summary?.routed, 28);
check("zip_triage.fail", zipTriage.summary?.fail, 0);
check("zip_triage.source_hash_mismatch", zipTriage.summary?.sourceHashMismatch, 0);
// 정직 경계: ZIP 28건 안에 로컬 추출기(FreeCAD/IFC)가 소화할 멤버는 없다 —
// 전부 외부 워커 라우트. 이 값이 올라가면 로컬 재추출 기회가 생겼다는 뜻.
check("zip_triage.local_executor_available", zipTriage.summary?.localExecutorAvailable, 0);
check("zip_triage.score_eligible", zipTriage.scoreEligible, false);
check("zip_triage.no_source_bytes", zipTriage.sourceBytesEmbedded, false);
check("native_routing.request_cases", nativeRoutingManifest.summary?.requestCases, 88);
check("native_routing.routed_cases", nativeRoutingManifest.summary?.routedCases, 88);
check("native_routing.unrouted_cases", nativeRoutingManifest.summary?.unroutedCases, 0);
check("native_routing.jobs", nativeRoutingManifest.summary?.jobs, 141);
check(
  "native_routing.zip_member_hash_bound",
  nativeRoutingManifest.jobs
    ?.filter((item) => item.source?.kind === "zip-member")
    .every((item) => typeof item.source?.sha256 === "string" && item.source.sha256.length === 64),
  true,
);
const canonicalSource = fs.readFileSync(
  path.join(root, "src/lib/ai/generationCanonicalResponse.ts"),
  "utf8",
);
const advanceRouteSource = fs.readFileSync(
  path.join(root, "src/app/api/cad/v1/generation/advance/route.ts"),
  "utf8",
);
const webSessionSource = fs.readFileSync(
  path.join(
    root,
    "src/app/[lang]/shape-generator/ai/generationSessionClient.ts",
  ),
  "utf8",
);
check(
  "canonical.stage_scoped_unresolved",
  canonicalSource.includes("unresolvedByStage"),
  true,
);
check(
  "canonical.affected_parts",
  canonicalSource.includes("affectedPartIds"),
  true,
);
check(
  "api.advance_canonical",
  advanceRouteSource.includes("buildGenerationCanonicalResponse(result)"),
  true,
);
check(
  "web.advance_canonical_persistence",
  webSessionSource.includes(
    'persistCanonical(storage, json.canonical, "Generation advancement")',
  ),
  true,
);
const manufacturingSource = fs.readFileSync(
  path.join(root, "src/lib/ai/manufacturingGates.ts"),
  "utf8",
);
const roundtripSource = fs.readFileSync(
  path.join(root, "src/lib/ai/stepRoundtripVerification.ts"),
  "utf8",
);
const membershipSource = fs.readFileSync(
  path.join(root, "src/lib/ai/stepBodyMembershipCertificate.ts"),
  "utf8",
);
check(
  "body_intent.manufacturing_gate",
  manufacturingSource.includes("bodyIntent"),
  true,
);
check(
  "body_intent.roundtrip_gate",
  roundtripSource.includes("bodyIntentMatched"),
  true,
);
check(
  "body_membership.native_definition_bodies",
  membershipSource.includes("STEP_BODY_COUNT_MISMATCH"),
  true,
);
check(
  "body_membership.occurrence_reuse",
  membershipSource.includes("STEP_BODY_OCCURRENCE_COUNT_MISMATCH"),
  true,
);
check(
  "body_membership.no_implicit_name_guess",
  membershipSource.includes("unmapped:"),
  true,
);

const files = [...artifacts, ...implementation].map(digest);
const artifactSetSha256 = createHash("sha256")
  .update(files.map((item) => `${item.path}:${item.sha256}`).join("\n"))
  .digest("hex");
const manifest = {
  schema: "nexyfab.integrated-ai-cad-baseline.v1",
  generatedAt: new Date().toISOString(),
  status: checks.some((item) => item.status === "fail") ? "fail" : "pass",
  scope:
    "Four calibrated SCAD assembly scenarios plus 160 topology fixtures through occurrence-qualified patterns; not a general 95% accuracy claim.",
  artifactSetSha256,
  checks,
  files,
  knownBlockers: [
    "Material/process assignments remain unresolved; manufacturing release is false.",
    "The 115-case approval queue is entirely pending and the 1,800-run AI campaign is not complete.",
    "Strict lineage-v2 selects 88 independent product roots; robot lacks 11, gearbox 3, pressure vessel 9, and turbomachinery 9 before a 120-case campaign can start.",
    "External native structure extraction covers only 38/115 selected cases; DWG classification adds 16 inspected archives but does not add native assembly evidence.",
    "All 8 detected DWG 3D cases are AABB approximations because the available LibreDWG WASM path does not expose polyface face indices; exact DWG 3D count is 0.",
    "AutoCAD COM, an ODA converter command, and a Revit native worker are not configured in this environment; exact DWG and native Revit recovery remain not_run.",
    "Thirteen source-bound exact-worker jobs are queued, but no external worker result has been accepted yet.",
    "External body membership passes for 35 STEP cases and remains not_run for 3 approximate IFC cases; joint semantics remain not_run for all 38 and no ground-truth case is reviewer-approved.",
    "Production AI-provider connectivity requires a credential-safe deployment smoke test.",
  ],
  regeneration: [
    "npx tsx scripts/bridge-scad-validation-assemblies.ts validation-reports/scad-agent-2026-08-06T09-10-47-repaired-3.json docs/evidence/scad-assembly-bridge-260806/run-6.json",
    "npx tsx scripts/build-scad-canonical-feature-evidence.ts validation-reports/scad-agent-2026-08-06T09-10-47-repaired-3.json docs/evidence/scad-canonical-features-260806/run-6.json",
    "npx tsx scripts/build-scad-definition-geometry-evidence.ts validation-reports/scad-agent-2026-08-06T09-10-47-repaired-3.json docs/evidence/scad-definition-geometry-260806/run-5.json",
    "npx tsx scripts/build-scad-analytic-brep-evidence.mjs docs/evidence/scad-canonical-features-260806/run-6.json docs/evidence/scad-definition-geometry-260806/run-5.json docs/evidence/scad-analytic-brep-260806/run-12.json",
    "npx tsx scripts/build-scad-native-flow-evidence.mjs docs/evidence/scad-assembly-bridge-260806/run-6.json docs/evidence/scad-canonical-features-260806/run-6.json docs/evidence/scad-native-flow-260806/run-4.json",
    "npx tsx scripts/build-scad-native-step-assemblies.mjs docs/evidence/scad-assembly-bridge-260806/run-6.json docs/evidence/scad-analytic-brep-260806/run-12.json docs/evidence/scad-native-step-assembly-260806/run-5.json",
    "npx tsx scripts/build-scad-interface-evidence.ts docs/evidence/scad-assembly-bridge-260806/run-6.json docs/evidence/scad-canonical-features-260806/run-6.json docs/evidence/scad-analytic-brep-260806/run-12.json docs/evidence/scad-interface-evidence-260806/run-6.json docs/evidence/scad-native-flow-260806/run-3.json",
    "npm run evidence:topology-survival",
    "npm run evidence:topology-rebind",
    "npm run evidence:step-body-membership",
    "npm run evidence:external-step-structure",
    "npm run evidence:native-extraction-remediation",
    "npm run evidence:native-cad-preflight",
    "npm run evidence:archive-triage",
    "npm run evidence:ifc-native",
    "npm run evidence:ifc-fidelity",
    "npm run evidence:ifc-collision",
  ],
};
const output = path.resolve(outputArg);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify({
    status: manifest.status,
    checks: checks.length,
    pass: checks.filter((item) => item.status === "pass").length,
    fail: checks.filter((item) => item.status === "fail").length,
    artifactSetSha256,
  }),
);
if (manifest.status !== "pass") process.exitCode = 1;
