import { analyzeStepMechanicalRelations } from "@/lib/reference/stepMechanicalRelationEvidence";

export const STEP_MANUFACTURING_REQUIREMENTS = [
  "flat_pattern",
  "bend_table",
  "member_identity",
  "miter_lengths",
  "cut_list",
] as const;
export type StepManufacturingRequirement =
  (typeof STEP_MANUFACTURING_REQUIREMENTS)[number];
export interface StepManufacturingCheck {
  requirement: StepManufacturingRequirement;
  status: "passed" | "failed" | "not_run";
  measured: number;
  reason: string;
  remediation?: string;
}
export interface StepManufacturingEvidenceReport {
  passed: boolean;
  checks: StepManufacturingCheck[];
  sourceSideEffects: false;
}

/** Server-side bridge from exported/imported STEP to the AI generation gate.
 * Requirements are explicit: unrelated evidence cannot accidentally release
 * a part, and a missing source remains not_run rather than becoming pass. */
export function evaluateStepManufacturingEvidence(
  source: string,
  requirements: readonly StepManufacturingRequirement[],
): StepManufacturingEvidenceReport {
  if (!source.trim())
    return {
      passed: false,
      checks: requirements.map((requirement) => ({
        requirement,
        status: "not_run",
        measured: 0,
        reason: "STEP source is missing.",
        remediation:
          "Export the affected part to STEP and retry only manufacturing verification.",
      })),
      sourceSideEffects: false,
    };
  const unique = [...new Set(requirements)];
  let evidence: ReturnType<typeof analyzeStepMechanicalRelations>;
  try {
    evidence = analyzeStepMechanicalRelations(source);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "STEP analysis failed.";
    return {
      passed: false,
      checks: unique.map((requirement) => ({
        requirement,
        status: "not_run",
        measured: 0,
        reason,
        remediation:
          "Heal or re-export the affected STEP artifact, then retry this part only.",
      })),
      sourceSideEffects: false,
    };
  }
  const checks = unique.map((requirement): StepManufacturingCheck => {
    if (requirement === "flat_pattern")
      return {
        requirement,
        status:
          evidence.sheetMetal.flatPattern.status === "pass"
            ? "passed"
            : "not_run",
        measured: evidence.sheetMetal.flatPattern.patterns.length,
        reason:
          evidence.sheetMetal.flatPattern.reason ??
          `${evidence.sheetMetal.flatPattern.patterns.length} exact flat pattern(s) recovered.`,
        remediation:
          evidence.sheetMetal.flatPattern.unresolved
            .map((item) => `${item.partId}: ${item.remediation}`)
            .join("; ") || undefined,
      };
    if (requirement === "bend_table")
      return {
        requirement,
        status:
          evidence.sheetMetal.bendTable.status === "pass"
            ? "passed"
            : "not_run",
        measured: evidence.sheetMetal.bendTable.rows.length,
        reason:
          evidence.sheetMetal.bendTable.reason ??
          `${evidence.sheetMetal.bendTable.rows.length} exact bend row(s) recovered.`,
        remediation:
          evidence.sheetMetal.bendTable.status === "pass"
            ? undefined
            : "Recover coaxial inner/outer bend surfaces and trimmed angular bounds.",
      };
    if (requirement === "member_identity")
      return {
        requirement,
        status:
          evidence.weldment.status === "pass"
            ? "passed"
            : evidence.weldment.status === "fail"
              ? "failed"
              : "not_run",
        measured: evidence.weldment.members.length,
        reason: `${evidence.weldment.members.length} structural member(s) recovered.`,
        remediation:
          evidence.weldment.status === "pass"
            ? undefined
            : "Recover exact solid bounds and member axes.",
      };
    if (requirement === "cut_list")
      return {
        requirement,
        status:
          evidence.weldment.status === "pass"
            ? "passed"
            : evidence.weldment.status === "fail"
              ? "failed"
              : "not_run",
        measured: evidence.weldment.cutList.length,
        reason: `${evidence.weldment.cutList.length} deterministic cut-list group(s) recovered.`,
        remediation:
          evidence.weldment.status === "pass"
            ? undefined
            : "Resolve member profile and length evidence first.",
      };
    return {
      requirement,
      status: evidence.weldment.miter.status === "pass" ? "passed" : "not_run",
      measured: evidence.weldment.miter.resolvedMembers,
      reason:
        evidence.weldment.miter.reason ??
        `${evidence.weldment.miter.resolvedMembers} member end-cut pair(s) recovered.`,
      remediation:
        evidence.weldment.miter.status === "pass"
          ? undefined
          : "Recover two oppositely facing STEP end planes for each member.",
    };
  });
  return {
    passed:
      checks.length > 0 && checks.every((check) => check.status === "passed"),
    checks,
    sourceSideEffects: false,
  };
}
