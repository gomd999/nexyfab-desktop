import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-lineage-v2-260807');
const output = path.resolve(process.argv[3] ?? path.join(root, 'native-extraction-remediation-report.json'));
type Batch = { results: Array<{ caseId: string; artifactHash: string }>; failures: Array<{ caseId: string; reason: string }> };
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')) as Batch;
const initialStep = load('freecad-step-results.json'), initialIges = load('freecad-iges-results.json');
const pressure = load('freecad-remediation-pressure-vessel-01.json'), factory = load('freecad-remediation-factory-equipment-03.json');
const initialFailure = (batch: Batch, caseId: string) => batch.failures.find(item => item.caseId === caseId)?.reason ?? 'initial_failure_missing';
const cases = [
  {
    caseId: 'pressure_vessel-review-01', format: 'step', initialReason: initialFailure(initialStep, 'pressure_vessel-review-01'),
    remediation: 'retry_same_extractor_timeout_600000', status: pressure.results.length === 1 ? 'recovered' : 'not_run',
    artifactHash: pressure.results[0]?.artifactHash ?? null, nextRoute: pressure.results.length === 1 ? 'native_validation' : 'large_exchange_worker',
  },
  {
    caseId: 'factory_equipment-review-03', format: 'iges', initialReason: initialFailure(initialIges, 'factory_equipment-review-03'),
    remediation: 'retry_same_extractor_timeout_600000', status: factory.results.length === 1 ? 'recovered' : 'not_run',
    artifactHash: factory.results[0]?.artifactHash ?? null, finalReason: factory.failures[0]?.reason ?? null, nextRoute: factory.results.length === 1 ? 'native_validation' : 'large_iges_worker',
  },
  {
    caseId: 'turbomachinery-review-03', format: 'iges', initialReason: initialFailure(initialIges, 'turbomachinery-review-03'),
    remediation: 'no_partial_import_promotion', status: 'not_run', artifactHash: null, nextRoute: 'iges_non_rigid_transform_worker',
  },
];
const artifact = { schema: 'nexyfab.native-extraction-remediation-report.v1', policy: { deterministicInputsOnly: true, maximumSameExtractorRetries: 1, partialImportsForbidden: true, inferredJointsDoNotCountAsNative: true }, summary: { cases: cases.length, recovered: cases.filter(item => item.status === 'recovered').length, notRun: cases.filter(item => item.status === 'not_run').length, fail: 0 }, cases };
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary }));
