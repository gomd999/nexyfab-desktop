import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ComplexNativeExtractionResult } from '../../src/lib/reference/complexNativeExtraction';
interface ResultBatch { schema: 'nexyfab.complex-native-extraction-result-batch.v1'; results: ComplexNativeExtractionResult[]; }
const value = (name: string) => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
async function main() {
  const inputs = (value('inputs') ?? '').split(',').filter(Boolean).map(file => path.resolve(file)), output = path.resolve(value('output') ?? 'docs/evidence/complex-holdout-review-260806/freecad-native-results-merged.json'); if (!inputs.length) throw new Error('Usage: --inputs=a.json,b.json [--output=merged.json]');
  const merged = new Map<string, ComplexNativeExtractionResult>();
  for (const file of inputs) { const batch = JSON.parse(await readFile(file, 'utf8')) as ResultBatch; if (batch.schema !== 'nexyfab.complex-native-extraction-result-batch.v1') throw new Error(`native_result_batch_schema_invalid:${file}`); for (const result of batch.results) { const prior = merged.get(result.caseId); if (prior && (prior.sourceHash !== result.sourceHash || prior.artifactHash !== result.artifactHash)) throw new Error(`native_result_merge_conflict:${result.caseId}`); merged.set(result.caseId, result); } }
  const results = [...merged.values()].sort((a, b) => a.caseId.localeCompare(b.caseId)); await writeFile(output, `${JSON.stringify({ schema: 'nexyfab.complex-native-extraction-result-batch.v1', mergedFrom: inputs.map(file => path.basename(file)), results }, null, 2)}\n`); process.stdout.write(`${JSON.stringify({ output, inputs: inputs.length, results: results.length })}\n`);
}
main().catch(error => { process.stderr.write(`native extraction merge failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
