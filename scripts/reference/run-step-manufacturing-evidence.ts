import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  evaluateStepManufacturingEvidence,
  STEP_MANUFACTURING_REQUIREMENTS,
  type StepManufacturingRequirement,
} from "../../src/lib/ai/stepManufacturingEvidence";

const values = new Map<string, string>();
for (const argument of process.argv.slice(2)) {
  const match = /^--([^=]+)=(.*)$/.exec(argument);
  if (match) values.set(match[1]!, match[2]!);
}
const file = values.get("file");
const output = values.get("output");
const requested = (values.get("requirements") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (!file || requested.length === 0) {
  throw new Error(
    "Usage: --file=<STEP> --requirements=flat_pattern,bend_table [--output=<json>]",
  );
}
const allowed = new Set<string>(STEP_MANUFACTURING_REQUIREMENTS);
const invalid = requested.filter((value) => !allowed.has(value));
if (invalid.length > 0)
  throw new Error(`Unknown requirement(s): ${invalid.join(", ")}`);

const raw = readFileSync(resolve(file));
const source = raw.toString("utf8");
const report = evaluateStepManufacturingEvidence(
  source,
  requested as StepManufacturingRequirement[],
);
const evidence = {
  schema: "nexyfab.ai-step-manufacturing-evidence.v1",
  generatedAt: new Date().toISOString(),
  input: {
    name: basename(file),
    bytes: raw.byteLength,
    sha256: createHash("sha256").update(raw).digest("hex"),
  },
  requirements: requested,
  report,
  releaseReady: report.passed,
  quoteOrRfqSideEffects: false,
};
const json = `${JSON.stringify(evidence, null, 2)}\n`;
if (output) writeFileSync(resolve(output), json, "utf8");
process.stdout.write(json);
process.exitCode = report.passed ? 0 : 4;
