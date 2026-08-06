import { describe, expect, it } from "vitest";
import { evaluateStepManufacturingEvidence } from "./stepManufacturingEvidence";

describe("AI STEP manufacturing evidence", () => {
  it("fails closed without an exported STEP source", () => {
    const report = evaluateStepManufacturingEvidence("", ["flat_pattern"]);
    expect(report.passed).toBe(false);
    expect(report.checks[0]).toMatchObject({ status: "not_run", measured: 0 });
  });

  it("does not let an unrelated or empty requirement set release a part", () => {
    const report = evaluateStepManufacturingEvidence(
      "ISO-10303-21;DATA;ENDSEC;END-ISO-10303-21;",
      [],
    );
    expect(report).toMatchObject({
      passed: false,
      checks: [],
      sourceSideEffects: false,
    });
  });
});
