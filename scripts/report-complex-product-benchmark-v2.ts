import { readFile } from 'node:fs/promises';
import type { ComplexBenchmarkFamily } from '../src/lib/ai/complexProductBenchmark';
import { buildComplexBenchmarkReportV2, DEFAULT_COMPLEX_BENCHMARK_POLICY_V2, type ComplexBenchmarkCaseV2, type ComplexBenchmarkRunV2 } from '../src/lib/ai/complexProductBenchmarkV2';
const value = (name: string) => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
async function load<T>(file: string | undefined): Promise<T[]> { return file ? JSON.parse(await readFile(file, 'utf8')) as T[] : []; }
async function main() { const requiredFamilies = value('families')?.split(',').map(item => item.trim()).filter(Boolean) as ComplexBenchmarkFamily[] | undefined; const report = buildComplexBenchmarkReportV2(await load<ComplexBenchmarkCaseV2>(value('cases')), await load<ComplexBenchmarkRunV2>(value('runs')), { ...DEFAULT_COMPLEX_BENCHMARK_POLICY_V2, requiredFamilies }); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (!report.eligible) process.exitCode = 4; }
main().catch(error => { process.stderr.write(`complex benchmark v2 failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
