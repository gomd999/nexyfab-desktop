import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateComplexNativeExtraction, type ComplexNativeExtractionRequest, type ComplexNativeExtractionResult } from '../../src/lib/reference/complexNativeExtraction';
interface RequestBatch { schema: 'nexyfab.complex-native-extraction-request-batch.v1'; requests: ComplexNativeExtractionRequest[]; }
interface ResultBatch { schema: 'nexyfab.complex-native-extraction-result-batch.v1'; results: ComplexNativeExtractionResult[]; }
const value = (name: string) => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
async function load<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')) as T; }
async function main() {
  const requestsPath = value('requests'), resultsPath = value('results'), outputPath = path.resolve(value('output') ?? 'docs/evidence/complex-holdout-review-260806/native-extraction-validation.json');
  if (!requestsPath || !resultsPath) throw new Error('Usage: --requests=requests.json --results=results.json [--output=report.json]');
  const requests = await load<RequestBatch>(path.resolve(requestsPath)), results = await load<ResultBatch>(path.resolve(resultsPath));
  if (requests.schema !== 'nexyfab.complex-native-extraction-request-batch.v1' || results.schema !== 'nexyfab.complex-native-extraction-result-batch.v1') throw new Error('native_extraction_batch_schema_invalid');
  const byCase = new Map<string, ComplexNativeExtractionResult>(), duplicates: string[] = [];
  for (const result of results.results) { if (byCase.has(result.caseId)) duplicates.push(result.caseId); else byCase.set(result.caseId, result); }
  const requestIds = new Set(requests.requests.map(item => item.caseId)), unknown = [...byCase.keys()].filter(caseId => !requestIds.has(caseId));
  const cases = requests.requests.map(request => ({ caseId: request.caseId, ...validateComplexNativeExtraction(request, byCase.get(request.caseId)) }));
  const counts = cases.reduce((out, item) => ({ ...out, [item.status]: (out[item.status] ?? 0) + 1 }), {} as Record<string, number>), axisCounts = cases.flatMap(item => item.axes).reduce((out, item) => { const axis = out[item.axis] ?? {}; axis[item.status] = (axis[item.status] ?? 0) + 1; out[item.axis] = axis; return out; }, {} as Record<string, Record<string, number>>);
  const report = { schema: 'nexyfab.complex-native-extraction-validation.v1', requestCount: requests.requests.length, resultCount: results.results.length, duplicates, unknown, counts, axisCounts, releaseReady: duplicates.length === 0 && unknown.length === 0 && cases.every(item => item.releaseReady), cases };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`); process.stdout.write(`${JSON.stringify({ output: outputPath, requestCount: report.requestCount, resultCount: report.resultCount, counts, duplicates: duplicates.length, unknown: unknown.length, releaseReady: report.releaseReady })}\n`);
  if (!report.releaseReady) process.exitCode = 4;
}
main().catch(error => { process.stderr.write(`native extraction validation failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
