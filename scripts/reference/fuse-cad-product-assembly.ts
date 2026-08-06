import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCadProductAssemblyFusion, type CadMeshOccurrenceEvidence } from '../../src/lib/reference/cadProductAssemblyFusion';
import type { CadProductBundleManifest } from '../../src/lib/reference/cadCorpusProductBundle';
import type { CadNativeAssemblyEvidence } from '../../src/lib/reference/cadNativeAssemblyEvidence';

const args = process.argv.slice(2), input = args.find(arg => !arg.startsWith('--')), output = args.find(arg => arg.startsWith('--output='))?.slice(9), bodyCountText = args.find(arg => arg.startsWith('--body-count='))?.slice(13), meshEvidencePath = args.find(arg => arg.startsWith('--mesh-evidence='))?.slice(16), nativeEvidencePath = args.find(arg => arg.startsWith('--native-evidence='))?.slice(18);
if (!input || !output) throw new Error('Usage: <bundle.json> --output=<fusion.json> [--body-count=N] [--mesh-evidence=FILE] [--native-evidence=FILE]');
const bodyCount = bodyCountText === undefined ? undefined : Number(bodyCountText);
async function main() {
  const raw = JSON.parse(await readFile(path.resolve(input!), 'utf8')) as CadProductBundleManifest;
  const meshEvidence = meshEvidencePath ? JSON.parse(await readFile(path.resolve(meshEvidencePath), 'utf8')) as CadMeshOccurrenceEvidence : undefined;
  const nativeAssemblyEvidence = nativeEvidencePath ? JSON.parse(await readFile(path.resolve(nativeEvidencePath), 'utf8')) as CadNativeAssemblyEvidence : undefined;
  const result = buildCadProductAssemblyFusion({ bundle: raw, ...(bodyCount === undefined ? {} : { authoritativeBodyCount: bodyCount }), ...(meshEvidence ? { meshEvidence } : {}), ...(nativeAssemblyEvidence ? { nativeAssemblyEvidence } : {}) });
  await writeFile(path.resolve(output!), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: path.resolve(output!), status: result.status, definitions: result.definitions.length, occurrences: result.occurrences.length, unmatchedBodies: result.unmatchedAuthoritativeBodyCount, errors: result.errors })}\n`);
  process.exitCode = result.status === 'fail' ? 5 : result.status === 'not_run' ? 4 : 0;
}
main().catch(error => { process.stderr.write(`assembly fusion failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
