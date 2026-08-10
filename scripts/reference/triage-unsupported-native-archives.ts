import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const reviewRoot = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-review-260806');
const corpusRootInput = process.argv[3] ?? process.env.NEXYFAB_REFERENCE_CORPUS_ROOT?.trim();
if (!corpusRootInput) throw new Error('reference_corpus_root_required');
const corpusRoot = path.resolve(corpusRootInput);
const output = path.resolve(process.argv[4] ?? 'docs/evidence/external-step-structure-coverage-260806/unsupported-archive-triage-run-1.json');
const repairLegacyUtf8Locator = (locator: string) => { if (!/[Ãìë]/.test(locator)) return locator; const repaired = Buffer.from(locator, 'latin1').toString('utf8'); return repaired.includes('\uFFFD') ? locator : repaired; };
const safePath = (root: string, locator: string) => { const absolute = path.resolve(root, repairLegacyUtf8Locator(locator)); const relative = path.relative(root, absolute); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`unsafe_locator:${locator}`); return absolute; };
const jobs = JSON.parse(fs.readFileSync(path.join(reviewRoot, 'native-extractor-jobs.json'), 'utf8')) as { partitions: Record<string, Array<{ caseId: string; localLocator: string; sourceHash: string }>> };
const routePriority = ['ifc', 'rvt', 'rfa', 'dwg', 'dxf', 'skp', '3dm', 'max', '3ds', 'blend', 'obj', 'fbx', 'dae'] as const;
const routeFor = (extensions: Set<string>) => {
  if (extensions.has('ifc')) return 'ifc-native-import';
  if (extensions.has('rvt') || extensions.has('rfa')) return 'revit-api';
  if (extensions.has('dwg') || extensions.has('dxf')) return 'autocad-or-oda';
  if (extensions.has('skp')) return 'sketchup-api';
  if (extensions.has('3dm')) return 'rhino-api';
  if (['max', '3ds', 'blend', 'obj', 'fbx', 'dae'].some(item => extensions.has(item))) return 'mesh-scene-import';
  return 'manual-source-review';
};
async function main() {
const results: Array<{ caseId: string; status: 'pass' | 'not_run' | 'fail'; reason: string; archiveBytes: number; entries: number; extensionCounts: Record<string, number>; route: string; preferredExtensions?: readonly string[] }> = [];
for (const job of jobs.partitions['unsupported-native-review'] ?? []) {
  const source = safePath(corpusRoot, job.localLocator); const stat = fs.statSync(source);
  if (stat.size > 1024 * 1024 * 1024) { results.push({ caseId: job.caseId, status: 'not_run', reason: 'archive_byte_budget_exceeded', archiveBytes: stat.size, entries: 0, extensionCounts: {}, route: 'manual-source-review' }); continue; }
  try {
    const archive = await JSZip.loadAsync(fs.readFileSync(source)); const names = Object.values(archive.files).filter(item => !item.dir).map(item => item.name); const counts: Record<string, number> = {};
    for (const name of names) { const extension = path.extname(name).slice(1).toLowerCase() || '(none)'; counts[extension] = (counts[extension] ?? 0) + 1; }
    const extensions = new Set(Object.keys(counts)); const route = routeFor(extensions);
    results.push({ caseId: job.caseId, status: route === 'manual-source-review' ? 'not_run' : 'pass', reason: route === 'manual-source-review' ? 'supported_design_source_not_found' : 'archive_route_identified', archiveBytes: stat.size, entries: names.length, extensionCounts: Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))), preferredExtensions: routePriority.filter(item => extensions.has(item)), route });
  } catch (error) { results.push({ caseId: job.caseId, status: 'fail', reason: error instanceof Error ? error.message : String(error), archiveBytes: stat.size, entries: 0, extensionCounts: {}, route: 'archive-repair' }); }
}
const routes = Object.fromEntries([...new Set(results.map(item => item.route))].sort().map(route => [route, results.filter(item => item.route === route).length]));
const artifact = { schema: 'nexyfab.unsupported-archive-triage.v1', generatedAt: new Date().toISOString(), scoreEligible: false, sourceBytesEmbedded: false, summary: { selected: results.length, routed: results.filter(item => item.status === 'pass').length, notRun: results.filter(item => item.status === 'not_run').length, fail: results.filter(item => item.status === 'fail').length, routes }, results };
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8'); console.log(JSON.stringify({ output: path.relative(process.cwd(), output), ...artifact.summary })); if (artifact.summary.fail) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
