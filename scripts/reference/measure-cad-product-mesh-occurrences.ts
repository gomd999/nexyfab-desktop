import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stlToNexyfabAssembly } from '../../src/lib/brep-bridge/meshIgesImport';
import type { CadProductBundleManifest } from '../../src/lib/reference/cadCorpusProductBundle';

const args = process.argv.slice(2), manifestPath = args.find(arg => !arg.startsWith('--')), rootText = args.find(arg => arg.startsWith('--root='))?.slice(7), outputText = args.find(arg => arg.startsWith('--output='))?.slice(9);
if (!manifestPath || !rootText || !outputText) throw new Error('Usage: <bundle.json> --root=<corpus-root> --output=<evidence.json>');
const root = path.resolve(rootText), output = path.resolve(outputText);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const manifest = JSON.parse(await readFile(path.resolve(manifestPath!), 'utf8')) as CadProductBundleManifest;
  const records = [];
  for (const member of manifest.members.filter(item => item.role === 'mesh_part')) {
    const full = path.resolve(root, member.relativePath);
    if (!full.startsWith(`${root}${path.sep}`)) throw new Error(`path_escape:${member.relativePath}`);
    const bytes = await readFile(full), actualHash = sha256(bytes);
    if (actualHash !== member.sha256) { records.push({ relativePath: member.relativePath, status: 'fail', error: 'source_hash_mismatch' }); continue; }
    const imported = stlToNexyfabAssembly(bytes, { name: path.basename(member.relativePath) });
    if (!imported.ok || !imported.assembly?.parts[0]) { records.push({ relativePath: member.relativePath, status: 'fail', error: imported.error ?? 'stl_measurement_failed' }); continue; }
    const part = imported.assembly.parts[0], params = part.params as unknown as { volumeMm3: number; areaMm2: number; triCount: number; aabb: { min: number[]; max: number[] }; cg: number[] };
    records.push({ relativePath: member.relativePath, sourceSha256: actualHash, status: part.fidelity === 'mesh-exact' ? 'pass' : 'not_run', fidelity: part.fidelity, triangleCount: params.triCount, volumeMm3: params.volumeMm3, areaMm2: params.areaMm2, aabbMm: params.aabb, centroidMm: params.cg });
  }
  const summary = { total: records.length, pass: records.filter(item => item.status === 'pass').length, fail: records.filter(item => item.status === 'fail').length, notRun: records.filter(item => item.status === 'not_run').length };
  const status = summary.fail ? 'fail' : summary.notRun ? 'not_run' : summary.pass === summary.total && summary.total > 0 ? 'pass' : 'not_run';
  await writeFile(output, `${JSON.stringify({ schema: 'nexyfab.cad-mesh-occurrence-evidence.v1', lineageId: manifest.lineageId, status, summary, records }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, status, summary })}\n`);
  process.exitCode = status === 'fail' ? 5 : status === 'not_run' ? 4 : 0;
}
main().catch(error => { process.stderr.write(`mesh occurrence measurement failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
