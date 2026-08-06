import fs from "node:fs";
import path from "node:path";

const reviewRoot = path.resolve(process.argv[2] ?? "docs/evidence/complex-holdout-review-260806");
const output = path.resolve(process.argv[3] ?? "docs/evidence/external-step-structure-coverage-260806/remediation-run-1.json");
type Job = { caseId: string; executor: string; capability: string; reason: string; freecadStructureCompleted: boolean; status: string };
const jobs = JSON.parse(fs.readFileSync(path.join(reviewRoot, "native-extractor-jobs.json"), "utf8")) as { partitions: Record<string, Job[]> };
const batch = JSON.parse(fs.readFileSync(path.join(reviewRoot, "external-native-all-results.json"), "utf8")) as { results: Array<{ caseId: string }>; skipped?: Array<{ caseId: string; reason: string }>; failures?: Array<{ caseId: string; reason: string }> };
const completed = new Set(batch.results.map(item => item.caseId));
const family = (caseId: string) => caseId.replace(/-review-\d+$/, "");
const flattened = Object.entries(jobs.partitions).flatMap(([executor, items]) => items.map(item => ({ ...item, executor })));
const pending = flattened.filter(item => !completed.has(item.caseId));
const countBy = (items: typeof pending, key: (item: typeof pending[number]) => string) => Object.fromEntries([...new Set(items.map(key))].sort().map(value => [value, items.filter(item => key(item) === value).length]));
const artifact = {
  schema: "nexyfab.native-extraction-remediation.v1",
  generatedAt: new Date().toISOString(),
  scoreEligible: false,
  policy: { noSyntheticApproval: true, noInferredJoints: true, sourceBytesEmbedded: false },
  summary: {
    selected: flattened.length,
    freecadStructureAndBodyCompleted: completed.size,
    pending: pending.length,
    executionFailures: batch.failures?.length ?? 0,
    pendingByFamily: countBy(pending, item => family(item.caseId)),
    pendingByExecutor: countBy(pending, item => item.executor),
  },
  routes: {
    nativeCadAutomation: pending.filter(item => ["inventor-com", "solidworks-com", "parasolid-cad-exchanger", "creo-or-solid-edge-native", "catia-com-or-cad-exchanger"].includes(item.executor)).map(item => item.caseId),
    sourceTriage: pending.filter(item => item.executor === "unsupported-native-review").map(item => item.caseId),
    manualJointGroundTruth: flattened.filter(item => item.executor === "manual-interface-review").map(item => item.caseId),
  },
  skipped: batch.skipped ?? [],
  failures: batch.failures ?? [],
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary }));
if (batch.failures?.length) process.exitCode = 1;
