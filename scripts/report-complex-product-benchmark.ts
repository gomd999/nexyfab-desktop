import { readFile } from 'node:fs/promises';
import { buildComplexBenchmarkReport, type ComplexBenchmarkCase, type ComplexBenchmarkRun } from '../src/lib/ai/complexProductBenchmark';

const value = (name: string) => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
async function load<T>(path: string | undefined, fallback: T): Promise<T> { return path ? JSON.parse(await readFile(path, 'utf8')) as T : fallback; }

async function main() {
  const cases = await load<ComplexBenchmarkCase[]>(value('cases'), []), runs = await load<ComplexBenchmarkRun[]>(value('runs'), []);
  const report = buildComplexBenchmarkReport(cases, runs);
  process.stdout.write(`${JSON.stringify({ schema: 'nexyfab.complex-product-benchmark.v1', policy: { minimumIndependentHoldouts: 20, repeatsPerCase: 5, minimumAccuracy: 0.95, requiredGatePassRate: 1, maximumFalseVerified: 0 }, ...report }, null, 2)}\n`);
  if (!report.allFamiliesEligible) process.exitCode = 4;
}
main().catch(error => { process.stderr.write(`complex benchmark failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
