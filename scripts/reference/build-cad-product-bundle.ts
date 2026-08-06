import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCadProductBundleManifest, cadProductLineageId, classifyCadProductBundleRole } from '../../src/lib/reference/cadCorpusProductBundle';

const args = process.argv.slice(2);
const root = path.resolve(args.find(arg => !arg.startsWith('--')) ?? '.');
const requestedLineage = args.find(arg => arg.startsWith('--lineage='))?.slice(10).replaceAll('\\', '/').toLowerCase();
const output = args.find(arg => arg.startsWith('--output='))?.slice(9);
const maxFileBytes = Number(args.find(arg => arg.startsWith('--max-file-bytes='))?.slice(17) ?? 64 * 1024 * 1024);
const maxTotalBytes = Number(args.find(arg => arg.startsWith('--max-total-bytes='))?.slice(18) ?? 512 * 1024 * 1024);
if (!requestedLineage || !output || !Number.isFinite(maxFileBytes) || maxFileBytes <= 0 || !Number.isFinite(maxTotalBytes) || maxTotalBytes <= 0) throw new Error('Usage: <root> --lineage=<relative snapshot lineage> --output=<json> [--max-file-bytes=N] [--max-total-bytes=N]');
const outputPath = path.resolve(output);

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'result' || entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function main() {
  const candidates = (await walk(root)).map(file => ({ file, relativePath: path.relative(root, file).replaceAll('\\', '/') })).filter(item => cadProductLineageId(item.relativePath) === requestedLineage && classifyCadProductBundleRole(item.relativePath) !== 'unknown');
  if (!candidates.length) throw new Error(`No governed files found for lineage ${requestedLineage}.`);
  let total = 0;
  const sources = [];
  const excluded: Array<{ relativePath: string; reason: string; sizeBytes: number }> = [];
  for (const candidate of candidates.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
    const info = await stat(candidate.file);
    if (info.size > maxFileBytes || total + info.size > maxTotalBytes) { excluded.push({ relativePath: candidate.relativePath, reason: info.size > maxFileBytes ? 'file_budget_exceeded' : 'bundle_budget_exceeded', sizeBytes: info.size }); continue; }
    sources.push({ relativePath: candidate.relativePath, bytes: await readFile(candidate.file) });
    total += info.size;
  }
  const manifest = buildCadProductBundleManifest(sources);
  await writeFile(outputPath, `${JSON.stringify({ ...manifest, excluded, totalBytes: total }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: outputPath, lineageId: manifest.lineageId, members: manifest.members.length, totalBytes: total, excluded: excluded.length, roles: manifest.roles })}\n`);
}

main().catch(error => { process.stderr.write(`product bundle failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
