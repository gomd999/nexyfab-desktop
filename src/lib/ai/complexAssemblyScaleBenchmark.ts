import { createHash } from 'node:crypto';
import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/), nonNegative = z.number().finite().min(0), positive = z.number().finite().positive();
const safeName = z.string().min(1).max(240).refine(value => !/[\\/]/.test(value) && value !== '.' && value !== '..');
const counts = [20, 100, 500, 1000] as const;
const metricSchema = z.object({ importMs: nonNegative, firstUsableRenderMs: nonNegative, firstEditableMs: nonNegative, mateSolveMs: nonNegative, broadInterferenceMs: nonNegative, exactInterferenceMs: nonNegative, motionVerificationMs: nonNegative, partialRecomputeMs: nonNegative, saveResumeMs: nonNegative, stepExportMs: nonNegative, stepImportMs: nonNegative, peakMemoryBytes: positive, workerQueuePeak: z.number().int().min(0), timeoutCount: z.number().int().min(0), errorCount: z.number().int().min(0) }).strict();
const slaSchema = z.object({ p95FirstUsableRenderMs: positive, p95FirstEditableMs: positive, p95PartialRecomputeMs: positive, p95ExactInterferenceMs: positive, maximumPeakMemoryBytes: positive, maximumWorkerQueuePeak: z.number().int().positive() }).strict();
const hashesSchema = z.object({ hierarchy: sha, occurrences: sha, transforms: sha, bom: sha, saveResume: sha, stepRoundtrip: sha }).strict();
const correctnessSchema = z.object({ mateSolvePassed: z.literal(true), exactInterferenceComplete: z.literal(true), motionVerified: z.literal(true), saveResumeMatched: z.literal(true), stepStructurePreserved: z.literal(true), deterministicHashMatched: z.literal(true) }).strict();
const runSchema = z.object({ runId: z.string().min(1).max(160), executionMode: z.enum(['cold', 'warm']), repeat: z.number().int().min(1).max(3), occurrenceCount: z.union(counts.map(value => z.literal(value)) as [z.ZodLiteral<20>, z.ZodLiteral<100>, z.ZodLiteral<500>, z.ZodLiteral<1000>]), metrics: metricSchema, hashes: hashesSchema, correctness: correctnessSchema, evidenceArtifactNames: z.array(safeName).min(1) }).strict();
const tierSchema = z.object({ occurrenceCount: z.union(counts.map(value => z.literal(value)) as [z.ZodLiteral<20>, z.ZodLiteral<100>, z.ZodLiteral<500>, z.ZodLiteral<1000>]), workflow: z.enum(['interactive_edit', 'batch_partial_edit', 'review_streaming']), approvedSla: slaSchema, runs: z.array(runSchema).length(6) }).strict();
const benchmarkSchema = z.object({
  schema: z.literal('nexyfab.complex-assembly-scale-benchmark.v1'), benchmarkId: z.string().min(1).max(160), generatedAt: z.string().datetime({ offset: true }),
  environment: z.object({ sourceCommit: z.string().regex(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/), buildId: z.string().min(1).max(160), kernelId: z.string().min(1).max(160), workerId: z.string().min(1).max(160), cpuModel: z.string().min(1).max(240), logicalCores: z.number().int().positive(), memoryBytes: positive, os: z.string().min(1).max(240), nodeVersion: z.string().min(1).max(80), browser: z.string().min(1).max(160), concurrency: z.number().int().positive() }).strict(),
  source: z.object({ artifactName: safeName, sha256: sha, deterministicSeed: z.string().min(1).max(160) }).strict(),
  artifacts: z.array(z.object({ name: safeName, sha256: sha, kind: z.enum(['source', 'raw-timing', 'trace', 'screenshot', 'sla-profile']), authority: z.enum(['benchmark-runner', 'reviewer-approved']) }).strict()).min(2),
  tiers: z.array(tierSchema).length(4),
  slaApproval: z.object({ profileArtifactName: safeName, approvedBy: z.string().min(1).max(160), approvedAt: z.string().datetime({ offset: true }) }).strict(),
}).strict();

export type ComplexAssemblyScaleBenchmark = z.infer<typeof benchmarkSchema>;
export type ComplexAssemblyScaleBenchmarkReport = { schema: 'nexyfab.complex-assembly-scale-benchmark-report.v1'; status: 'passed' | 'failed' | 'not_run'; benchmarkExecutionReady: boolean; benchmarkId: string | null; environmentHash: string | null; benchmarkHash: string | null; tierSummaries: Array<{ occurrenceCount: number; workflow: string; coldRuns: number; warmRuns: number; p95: { firstUsableRenderMs: number; firstEditableMs: number; partialRecomputeMs: number; exactInterferenceMs: number; peakMemoryBytes: number; workerQueuePeak: number }; slaPassed: boolean }>; checks: { tierCoverage: boolean; workflowPolicy: boolean; environment: boolean; artifactBytes: boolean; repetitions: boolean; zeroErrors: boolean; deterministicFidelity: boolean; correctness: boolean; sla: boolean }; errors: string[]; blockers: string[]; independentBenchmarkApprovalComplete: false; releaseReady: false; sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false } };

export function verifyComplexAssemblyScaleBenchmarkBytes(bytes: Uint8Array, uploaded: ReadonlyMap<string, Uint8Array>): ComplexAssemblyScaleBenchmarkReport {
  const errors: string[] = []; let raw: unknown = null;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { errors.push('benchmark must be valid UTF-8 JSON'); }
  const parsed = benchmarkSchema.safeParse(raw);
  if (!parsed.success) errors.push(...parsed.error.issues.map(issue => `benchmark.${issue.path.join('.') || '$'}: ${issue.message}`));
  const checks = { tierCoverage: false, workflowPolicy: false, environment: false, artifactBytes: false, repetitions: false, zeroErrors: false, deterministicFidelity: false, correctness: false, sla: false };
  if (!parsed.success) return report(null, null, null, [], checks, errors);
  const value = parsed.data, declared = new Map<string, typeof value.artifacts[number]>();
  for (const artifact of value.artifacts) { if (declared.has(artifact.name)) errors.push(`artifact_duplicate:${artifact.name}`); declared.set(artifact.name, artifact); }
  for (const [name, artifactBytes] of uploaded) { const item = declared.get(name); if (!item) errors.push(`artifact_undeclared:${name}`); else if (digest(artifactBytes) !== item.sha256) errors.push(`artifact_hash_mismatch:${name}`); }
  for (const artifact of value.artifacts) if (!uploaded.has(artifact.name)) errors.push(`artifact_missing:${artifact.name}`);
  checks.artifactBytes = errors.every(error => !error.startsWith('artifact_'));
  const source = declared.get(value.source.artifactName), slaProfile = declared.get(value.slaApproval.profileArtifactName);
  if (!source || source.kind !== 'source' || source.sha256 !== value.source.sha256) errors.push('source_artifact_binding_invalid');
  if (!slaProfile || slaProfile.kind !== 'sla-profile' || slaProfile.authority !== 'reviewer-approved') errors.push('sla_profile_approval_binding_invalid');
  checks.environment = value.environment.logicalCores >= value.environment.concurrency && value.environment.memoryBytes > 0 && Date.parse(value.slaApproval.approvedAt) <= Date.parse(value.generatedAt);
  if (!checks.environment) errors.push('benchmark_environment_invalid');
  const tierByCount = new Map(value.tiers.map(tier => [tier.occurrenceCount, tier]));
  checks.tierCoverage = counts.every(count => tierByCount.has(count)) && tierByCount.size === counts.length;
  if (!checks.tierCoverage) errors.push('benchmark_tier_coverage_invalid');
  checks.workflowPolicy = value.tiers.every(tier => tier.workflow === (tier.occurrenceCount <= 100 ? 'interactive_edit' : tier.occurrenceCount === 500 ? 'batch_partial_edit' : 'review_streaming'));
  if (!checks.workflowPolicy) errors.push('benchmark_workflow_policy_invalid');
  const runIds = new Set<string>(), summaries: ComplexAssemblyScaleBenchmarkReport['tierSummaries'] = [];
  let repetitions = true, zeroErrors = true, deterministic = true, correctness = true, allSla = true;
  for (const tier of value.tiers) {
    const cold = tier.runs.filter(run => run.executionMode === 'cold'), warm = tier.runs.filter(run => run.executionMode === 'warm');
    if (cold.length !== 3 || warm.length !== 3 || new Set(cold.map(run => run.repeat)).size !== 3 || new Set(warm.map(run => run.repeat)).size !== 3 || tier.runs.some(run => run.occurrenceCount !== tier.occurrenceCount)) repetitions = false;
    for (const run of tier.runs) { if (runIds.has(run.runId)) repetitions = false; runIds.add(run.runId); if (run.metrics.errorCount || run.metrics.timeoutCount || run.metrics.peakMemoryBytes > value.environment.memoryBytes) zeroErrors = false; if (!Object.values(run.correctness).every(Boolean)) correctness = false; const runArtifacts = run.evidenceArtifactNames.map(name => declared.get(name)); if (runArtifacts.some(item => !item || !uploaded.has(item.name)) || !runArtifacts.some(item => item?.kind === 'raw-timing' || item?.kind === 'trace')) correctness = false; }
    for (const key of Object.keys(tier.runs[0]!.hashes) as Array<keyof typeof tier.runs[number]['hashes']>) if (new Set(tier.runs.map(run => run.hashes[key])).size !== 1) deterministic = false;
    const p95 = { firstUsableRenderMs: percentile(tier.runs.map(run => run.metrics.firstUsableRenderMs), 0.95), firstEditableMs: percentile(tier.runs.map(run => run.metrics.firstEditableMs), 0.95), partialRecomputeMs: percentile(tier.runs.map(run => run.metrics.partialRecomputeMs), 0.95), exactInterferenceMs: percentile(tier.runs.map(run => run.metrics.exactInterferenceMs), 0.95), peakMemoryBytes: percentile(tier.runs.map(run => run.metrics.peakMemoryBytes), 0.95), workerQueuePeak: percentile(tier.runs.map(run => run.metrics.workerQueuePeak), 0.95) };
    const slaPassed = p95.firstUsableRenderMs <= tier.approvedSla.p95FirstUsableRenderMs && p95.firstEditableMs <= tier.approvedSla.p95FirstEditableMs && p95.partialRecomputeMs <= tier.approvedSla.p95PartialRecomputeMs && p95.exactInterferenceMs <= tier.approvedSla.p95ExactInterferenceMs && p95.peakMemoryBytes <= tier.approvedSla.maximumPeakMemoryBytes && p95.workerQueuePeak <= tier.approvedSla.maximumWorkerQueuePeak;
    if (!slaPassed) allSla = false;
    summaries.push({ occurrenceCount: tier.occurrenceCount, workflow: tier.workflow, coldRuns: cold.length, warmRuns: warm.length, p95, slaPassed });
  }
  checks.repetitions = repetitions; checks.zeroErrors = zeroErrors; checks.deterministicFidelity = deterministic; checks.correctness = correctness; checks.sla = allSla;
  for (const [name, passed] of Object.entries(checks)) if (!passed) errors.push(`scale_benchmark_check_failed:${name}`);
  const environmentHash = digest(new TextEncoder().encode(canonical(value.environment))), benchmarkHash = digest(new TextEncoder().encode(canonical(value)));
  return report(value.benchmarkId, environmentHash, benchmarkHash, summaries.sort((a, b) => a.occurrenceCount - b.occurrenceCount), checks, errors);
}

function report(benchmarkId: string | null, environmentHash: string | null, benchmarkHash: string | null, tierSummaries: ComplexAssemblyScaleBenchmarkReport['tierSummaries'], checks: ComplexAssemblyScaleBenchmarkReport['checks'], errors: string[]): ComplexAssemblyScaleBenchmarkReport { const unique = [...new Set(errors)], ready = unique.length === 0 && Object.values(checks).every(Boolean); return { schema: 'nexyfab.complex-assembly-scale-benchmark-report.v1', status: ready ? 'passed' : 'failed', benchmarkExecutionReady: ready, benchmarkId, environmentHash, benchmarkHash, tierSummaries, checks, errors: unique, blockers: ready ? ['independent_benchmark_approval_required', 'family_physical_validation_required', 'final_expert_review_required'] : ['scale_benchmark_incomplete', 'independent_benchmark_approval_required', 'family_physical_validation_required', 'final_expert_review_required'], independentBenchmarkApprovalComplete: false, releaseReady: false, sideEffects: { persisted: false, cadModified: false, quoteCreated: false, rfqSent: false } }; }
function percentile(values: number[], ratio: number) { const ordered = [...values].sort((a, b) => a - b); return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)]!; }
function digest(value: Uint8Array) { return createHash('sha256').update(value).digest('hex'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
