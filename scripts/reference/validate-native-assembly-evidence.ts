import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CadProductBundleManifest } from '../../src/lib/reference/cadCorpusProductBundle';
import { validateCadNativeAssemblyEvidence, type CadNativeAssemblyEvidence } from '../../src/lib/reference/cadNativeAssemblyEvidence';
const [bundlePath, evidencePath] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
if (!bundlePath) throw new Error('Usage: <bundle.json> [evidence.json]');
async function main() { const bundle = JSON.parse(await readFile(path.resolve(bundlePath!), 'utf8')) as CadProductBundleManifest; const evidence = evidencePath ? JSON.parse(await readFile(path.resolve(evidencePath), 'utf8')) as CadNativeAssemblyEvidence : undefined; const result = validateCadNativeAssemblyEvidence(bundle, evidence); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); process.exitCode = result.status === 'fail' ? 5 : result.status === 'not_run' ? 4 : 0; }
main().catch(error => { process.stderr.write(`native assembly evidence validation failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
