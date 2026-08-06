import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CadProductBundleManifest } from '../../src/lib/reference/cadCorpusProductBundle';
import { buildCadProductEvidenceSummary, resolveEvidenceOutput, type CadEvidenceRunStatus, type CadProductEvidenceStage } from '../../src/lib/reference/cadProductEvidencePipeline';
import { validateCadNativeAssemblyEvidence, type CadNativeAssemblyEvidence } from '../../src/lib/reference/cadNativeAssemblyEvidence';

const args = process.argv.slice(2), rootText = args.find(arg => !arg.startsWith('--'));
const lineage = args.find(arg => arg.startsWith('--lineage='))?.slice(10), caseText = args.find(arg => arg.startsWith('--case='))?.slice(7);
const outputRootText = args.find(arg => arg.startsWith('--output-root='))?.slice(14) ?? 'docs/evidence';
const bodyCountText = args.find(arg => arg.startsWith('--body-count='))?.slice(13), nativeEvidenceText = args.find(arg => arg.startsWith('--native-evidence='))?.slice(18);
if (!rootText || !lineage || !caseText) throw new Error('Usage: <corpus-root> --lineage=PATH --case=ID [--output-root=DIR] [--body-count=N] [--native-evidence=FILE]');
const corpusRoot = path.resolve(rootText), caseId = caseText, outputDirectory = resolveEvidenceOutput(outputRootText, caseId);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url)), tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs');
const reports = { bundle: path.join(outputDirectory, 'bundle.json'), mesh: path.join(outputDirectory, 'mesh-occurrences.json'), native: path.join(outputDirectory, 'native-assembly.json'), fusion: path.join(outputDirectory, 'fusion.json'), summary: path.join(outputDirectory, 'summary.json') };

async function runScript(script: string, scriptArgs: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, path.join(scriptDirectory, script), ...scriptArgs], { stdio: ['ignore', 'inherit', 'inherit'] });
    child.once('error', reject); child.once('exit', code => resolve(code ?? 1));
  });
}
const statusOf = (value: unknown): CadEvidenceRunStatus => value === 'fail' ? 'fail' : value === 'pass' ? 'pass' : 'not_run';
async function json(file: string): Promise<Record<string, unknown>> { return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>; }

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const stages: CadProductEvidenceStage[] = [];
  const bundleExit = await runScript('build-cad-product-bundle.ts', [corpusRoot, `--lineage=${lineage}`, `--output=${reports.bundle}`]);
  if (bundleExit !== 0) throw new Error(`bundle_stage_failed:${bundleExit}`);
  const bundle = await json(reports.bundle) as unknown as CadProductBundleManifest & { totalBytes?: number; excluded?: unknown[] };
  stages.push({ id: 'bundle', status: 'pass', report: 'bundle.json', summary: { members: bundle.members.length, totalBytes: bundle.totalBytes ?? null, excluded: bundle.excluded?.length ?? 0, roles: bundle.roles } });
  const meshExit = await runScript('measure-cad-product-mesh-occurrences.ts', [reports.bundle, `--root=${corpusRoot}`, `--output=${reports.mesh}`]);
  const mesh = await json(reports.mesh);
  stages.push({ id: 'mesh', status: statusOf(mesh.status), report: 'mesh-occurrences.json', summary: mesh.summary as Record<string, unknown> });
  if (![0, 4, 5].includes(meshExit)) throw new Error(`mesh_stage_failed:${meshExit}`);
  const nativeEvidence = nativeEvidenceText ? JSON.parse(await readFile(path.resolve(nativeEvidenceText), 'utf8')) as CadNativeAssemblyEvidence : undefined;
  const native = validateCadNativeAssemblyEvidence(bundle, nativeEvidence);
  await writeFile(reports.native, `${JSON.stringify(native, null, 2)}\n`);
  stages.push({ id: 'native', status: native.status, report: 'native-assembly.json', summary: { releaseReady: native.releaseReady, errors: native.errors, warnings: native.warnings } });
  const fusionArgs = [reports.bundle, `--mesh-evidence=${reports.mesh}`, `--output=${reports.fusion}`, ...(bodyCountText ? [`--body-count=${bodyCountText}`] : []), ...(nativeEvidenceText ? [`--native-evidence=${path.resolve(nativeEvidenceText)}`] : [])];
  const fusionExit = await runScript('fuse-cad-product-assembly.ts', fusionArgs), fusion = await json(reports.fusion);
  stages.push({ id: 'fusion', status: statusOf(fusion.status), report: 'fusion.json', summary: { definitions: Array.isArray(fusion.definitions) ? fusion.definitions.length : 0, occurrences: Array.isArray(fusion.occurrences) ? fusion.occurrences.length : 0, nativeOccurrenceCount: fusion.nativeOccurrenceCount ?? 0, nativeJointCount: fusion.nativeJointCount ?? 0, errors: fusion.errors, warnings: fusion.warnings } });
  if (![0, 4, 5].includes(fusionExit)) throw new Error(`fusion_stage_failed:${fusionExit}`);
  const summary = buildCadProductEvidenceSummary({ caseId, lineageId: bundle.lineageId, stages });
  await writeFile(reports.summary, `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ caseId: summary.caseId, status: summary.status, output: outputDirectory, stages: stages.map(stage => ({ id: stage.id, status: stage.status })) })}\n`);
  process.exitCode = summary.status === 'fail' ? 5 : summary.status === 'not_run' ? 4 : 0;
}
main().catch(error => { process.stderr.write(`CAD product evidence run failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
