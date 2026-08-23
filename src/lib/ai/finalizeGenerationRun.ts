import {
  evaluateManufacturingGates,
  type ManufacturingGateInput,
  type ManufacturingGateReport,
} from "./manufacturingGates";
import {
  compareStepRoundtrip,
  type BodyIntentPolicy,
  type BrepMeasurement,
  type StepRoundtripComparison,
} from "./stepRoundtripVerification";
import {
  recordGenerationStage,
  type GenerationRunState,
} from "./generationRunState";
import {
  evaluateStepManufacturingEvidence,
  type StepManufacturingEvidenceReport,
  type StepManufacturingRequirement,
} from "./stepManufacturingEvidence";
import {
  verifyAgenticCommercialQualificationReceipt,
  type AgenticCommercialQualificationReceipt,
  type AgenticCommercialQualificationVerification,
  type AgenticCommercialQualificationVerificationContext,
} from './agenticCommercialQualificationReceipt';

export interface PartFinalizationEvidence {
  partId: string;
  bodyIntent?: BodyIntentPolicy;
  manufacturing: Omit<ManufacturingGateInput, "stepRoundtrip">;
  roundtrip?: {
    before: BrepMeasurement;
    after: BrepMeasurement;
    toleranceMm?: number;
    volumeTolerance?: number;
  };
  /** Optional domain contract. When supplied, the server re-analyzes this
   * exact STEP source; client-provided pass/fail claims are never trusted. */
  referenceStep?: {
    source: string;
    requirements: StepManufacturingRequirement[];
  };
}
export interface MotionFinalizationEvidence {
  required: boolean;
  verification?: {
    ok?: boolean;
    releaseReady?: boolean;
    precise?: unknown;
    broad?: unknown;
    code?: string;
    message?: string;
  };
}
export interface FinalizeGenerationInput {
  motion: MotionFinalizationEvidence;
  parts: PartFinalizationEvidence[];
  commercialReceipt?: AgenticCommercialQualificationReceipt;
  commercialReceiptRef?: { receiptId: string; receiptSha256: string };
  commercialReceiptContext?: AgenticCommercialQualificationVerificationContext;
  expectedPartIds?: readonly string[];
}
export interface FinalizeGenerationResult {
  state: GenerationRunState;
  stoppedAt: "motion" | "manufacturing" | "roundtrip" | "release" | "complete";
  manufacturingReports: Record<string, ManufacturingGateReport>;
  roundtripComparisons: Record<string, StepRoundtripComparison>;
  stepManufacturingReports: Record<string, StepManufacturingEvidenceReport>;
  commercialReleaseReady: boolean;
  commercialReceiptVerification: AgenticCommercialQualificationVerification;
}

const gateFailures = (
  report: ManufacturingGateReport,
  ids: readonly string[],
) =>
  report.gates
    .filter((gate) => ids.includes(gate.id) && gate.status !== "passed")
    .flatMap((gate) =>
      gate.failures.map((failure) => `${gate.id}: ${failure}`),
    );

/** Finalizes only from server-evaluated evidence; missing optional input never becomes an implicit pass. */
export function finalizeGenerationRun(
  initial: GenerationRunState,
  input: FinalizeGenerationInput,
): FinalizeGenerationResult {
  if (initial.stages.assembly_solve.status !== "passed")
    throw new Error("assembly_solve must pass before finalization.");
  if (input.expectedPartIds) { const expected = [...input.expectedPartIds].sort(); const actual = input.parts.map(part => part.partId).sort(); if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) throw new Error('FINALIZE_PART_EXACT_SET_MISMATCH'); }
  const commercialReceiptVerification = input.commercialReceiptContext
    ? verifyAgenticCommercialQualificationReceipt(input.commercialReceipt, input.commercialReceiptContext)
    : { ok: false, releaseReady: false, status: 'HOLD' as const, targetSha256: '', issues: ['commercial_receipt_context_missing'] };
  let state = initial;
  const motionPassed =
    input.motion.required === false ||
    input.motion.verification?.releaseReady === true;
  state = recordGenerationStage(state, {
    stage: "motion",
    input: { required: input.motion.required },
    output: input.motion.verification ?? { required: false },
    status: motionPassed
      ? "passed"
      : input.motion.verification
        ? "failed"
        : "not_run",
    errorCodes: motionPassed
      ? []
      : [input.motion.verification?.code ?? "MOTION_EVIDENCE_MISSING"],
    unresolved: motionPassed
      ? []
      : [
          input.motion.verification?.message ??
            "Required motion verification was not run or did not pass.",
        ],
  });
  if (!motionPassed)
    return {
      state,
      stoppedAt: "motion",
      manufacturingReports: {},
      roundtripComparisons: {},
      stepManufacturingReports: {},
      commercialReleaseReady: false,
      commercialReceiptVerification,
    };

  const comparisons: Record<string, StepRoundtripComparison> = {};
  const reports: Record<string, ManufacturingGateReport> = {};
  const stepManufacturingReports: Record<
    string,
    StepManufacturingEvidenceReport
  > = {};
  for (const part of input.parts) {
    const comparison = part.roundtrip
      ? compareStepRoundtrip(
          part.roundtrip.before,
          part.roundtrip.after,
          part.roundtrip.toleranceMm,
          part.roundtrip.volumeTolerance,
          part.bodyIntent,
        )
      : undefined;
    if (comparison) comparisons[part.partId] = comparison;
    reports[part.partId] = evaluateManufacturingGates({
      ...part.manufacturing,
      bodyIntent: part.bodyIntent,
      stepRoundtrip: comparison
        ? {
            reimported: true,
            topologyMatched: comparison.topologyMatched,
            dimensionsMatched: comparison.dimensionsMatched,
            errors: comparison.errors,
          }
        : undefined,
    });
    if (part.referenceStep)
      stepManufacturingReports[part.partId] = evaluateStepManufacturingEvidence(
        part.referenceStep.source,
        part.referenceStep.requirements,
      );
  }
  const duplicateIds = input.parts
    .map((part) => part.partId)
    .filter((id, index, all) => !id.trim() || all.indexOf(id) !== index);
  const gateManufacturingErrors = [
    ...(input.parts.length
      ? []
      : ["No part manufacturing evidence was supplied."]),
    ...duplicateIds.map(
      (id) => `Duplicate or empty partId: ${id || "(empty)"}`,
    ),
    ...Object.entries(reports).flatMap(([partId, report]) =>
      gateFailures(report, [
        "G0",
        "G1",
        "G2",
        "G3",
        "G4",
        "G5",
        "G6",
        "G7",
      ]).map((error) => `${partId}: ${error}`),
    ),
  ];
  const stepManufacturingErrors = Object.entries(
    stepManufacturingReports,
  ).flatMap(([partId, report]) =>
    report.passed
      ? []
      : report.checks
          .filter((check) => check.status !== "passed")
          .map(
            (check) =>
              `${partId}: STEP ${check.requirement} ${check.status}: ${check.reason}${check.remediation ? ` Repair: ${check.remediation}` : ""}`,
          ),
  );
  const manufacturingErrors = [
    ...gateManufacturingErrors,
    ...stepManufacturingErrors,
  ];
  state = recordGenerationStage(state, {
    stage: "manufacturing",
    input: input.parts.map((part) => ({
      partId: part.partId,
      evidence: part.manufacturing,
      referenceRequirements: part.referenceStep?.requirements,
    })),
    output: { gates: reports, step: stepManufacturingReports },
    status: manufacturingErrors.length ? "failed" : "passed",
    errorCodes: manufacturingErrors.length
      ? [
          ...(gateManufacturingErrors.length
            ? ["MANUFACTURING_G0_G7_FAILED"]
            : []),
          ...(stepManufacturingErrors.length
            ? ["REFERENCE_STEP_EVIDENCE_FAILED"]
            : []),
        ]
      : [],
    unresolved: manufacturingErrors,
    affectedPartIds: input.parts
      .filter(
        (part) =>
          gateFailures(reports[part.partId]!, [
            "G0",
            "G1",
            "G2",
            "G3",
            "G4",
            "G5",
            "G6",
            "G7",
          ]).length || stepManufacturingReports[part.partId]?.passed === false,
      )
      .map((part) => part.partId),
    metrics: { parts: input.parts.length },
  });
  if (manufacturingErrors.length)
    return {
      state,
      stoppedAt: "manufacturing",
      manufacturingReports: reports,
      roundtripComparisons: comparisons,
      stepManufacturingReports,
      commercialReleaseReady: false,
      commercialReceiptVerification,
    };

  const roundtripErrors = input.parts.flatMap((part) => {
    const comparison = comparisons[part.partId];
    return comparison?.passed
      ? []
      : [
          `${part.partId}: ${comparison?.errors.join(" ") || "STEP export/re-import measurements are missing."}`,
        ];
  });
  state = recordGenerationStage(state, {
    stage: "roundtrip",
    input: input.parts.map((part) => ({
      partId: part.partId,
      roundtrip: part.roundtrip,
    })),
    output: comparisons,
    status: roundtripErrors.length ? "failed" : "passed",
    errorCodes: roundtripErrors.length ? ["STEP_ROUNDTRIP_FAILED"] : [],
    unresolved: roundtripErrors,
    affectedPartIds: input.parts
      .filter((part) => !comparisons[part.partId]?.passed)
      .map((part) => part.partId),
  });
  if (roundtripErrors.length)
    return {
      state,
      stoppedAt: "roundtrip",
      manufacturingReports: reports,
      roundtripComparisons: comparisons,
      stepManufacturingReports,
      commercialReleaseReady: false,
      commercialReceiptVerification,
    };

  const releaseErrors = [
    ...Object.entries(reports).flatMap(([partId, report]) =>
    gateFailures(report, ["G9"]).map((error) => `${partId}: ${error}`),
    ),
    ...(commercialReceiptVerification.releaseReady ? [] : ['Commercial qualification receipt is missing, untrusted, stale, or mismatched.']),
  ];
  state = recordGenerationStage(state, {
    stage: "release",
    input: input.parts.map((part) => ({
      partId: part.partId,
      release: part.manufacturing.release,
    })),
    output: { authorizedParts: input.parts.length - releaseErrors.length, commercialReceiptVerification },
    status: releaseErrors.length ? "blocked" : "passed",
    errorCodes: releaseErrors.length
      ? ["EXACT_ARTIFACT_AUTHORIZATION_REQUIRED"]
      : [],
    unresolved: releaseErrors,
    affectedPartIds: input.parts
      .filter((part) => gateFailures(reports[part.partId]!, ["G9"]).length)
      .map((part) => part.partId),
    metrics: { parts: input.parts.length },
  });
  if (!releaseErrors.length && commercialReceiptVerification.releaseReady && input.commercialReceipt) {
    state = {
      ...state,
      commercialHashes: {
        generationProgramSha256: input.commercialReceipt.generationProgramSha256,
        targetSha256: input.commercialReceipt.targetSha256,
        receiptSha256: input.commercialReceipt.receiptSha256,
        artifactManifestSha256: input.commercialReceipt.artifactManifestSha256,
        parserReceiptSha256: input.commercialReceipt.parser.receiptSha256,
        executionJournalSha256: input.commercialReceipt.executionJournal.sha256,
        persistenceReceiptSha256: input.commercialReceipt.persistenceReceipt.sha256,
        verificationReceiptSha256: input.commercialReceipt.verificationReceipt.sha256,
        ...(input.commercialReceiptRef ? { finalEnvelopeSha256: input.commercialReceiptRef.receiptSha256 } : {}),
      },
      revision: state.revision + 1,
    };
  }
  return {
    state,
    stoppedAt: releaseErrors.length ? "release" : "complete",
    manufacturingReports: reports,
    roundtripComparisons: comparisons,
    stepManufacturingReports,
    commercialReleaseReady: releaseErrors.length === 0 && commercialReceiptVerification.releaseReady,
    commercialReceiptVerification,
  };
}
