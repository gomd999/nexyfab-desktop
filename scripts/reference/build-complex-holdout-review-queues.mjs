#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const rootArg = arg('root') || process.env.NEXYFAB_REFERENCE_CORPUS_ROOT;
if (!rootArg) throw new Error('reference_corpus_root_required');
const root = path.resolve(rootArg);
const output = path.resolve(arg('output') || 'docs/evidence/complex-holdout-review-260806');
const limit = Number(arg('limit') || 20);
if (!Number.isInteger(limit) || limit < 1) throw new Error('holdout_review_limit_invalid');
const FAMILY_RULES = [
  ['robot', /\b(robot|robotic|manipulator|mech(?:anical)?[-_ ]?arm|robot[-_ ]?arm|cobot|dof|gripper|pick[-_ ]?and[-_ ]?place|scara|quadruped|self[-_ ]?balancing)\b/i],
  ['gearbox', /\b(gearbox|gear[-_ ]?box|gear[-_ ]?reducer|worm[-_ ]?gear|planetary[-_ ]?gear|differential|transmission)\b/i],
  ['pressure_vessel', /\b(pressure[-_ ]?vessel|asme|boiler|autoclave|air[-_ ]?receiver|heat[-_ ]?exchanger|(?:storage|water|fuel|lpg|propane|spherical)[-_ ]?tank|reactor[-_ ]?vessel|separator[-_ ]?vessel|water[-_ ]?tanker)\b/i],
  ['turbomachinery', /\b(turbine|turbocharger|turbopump|compressor|impeller|blower|pump|jet[-_ ]?engine|propeller|fan)\b/i],
  ['factory_equipment', /\b(conveyor|machine|machining[-_ ]?center|tool[-_ ]?magazine|packaging|packing|sorting|factory[-_ ]?equipment|production[-_ ]?line|transfer[-_ ]?equipment|loader|excavator|cement[-_ ]?mill|feed[-_ ]?mill|mixer|crusher|dryer|filling|palletizer|roll[-_ ]?forming|cnc|tower[-_ ]?crane)\b/i],
  ['interior', /\b(interior|bed[-_ ]?room|bath[-_ ]?room|living[-_ ]?room|office[-_ ]?room|house|apartment|residential[-_ ]?building|commercial[-_ ]?building|hotel|villa)\b/i],
];
const PRODUCT_EXTENSIONS = new Set(['.zip', '.step', '.stp', '.iges', '.igs', '.ifc', '.x_t', '.x_b', '.sldasm', '.sldprt', '.iam', '.ipt', '.catproduct', '.catpart', '.asm', '.prt', '.dwg', '.rvt']);
const priority = new Map([['.step', 0], ['.stp', 0], ['.x_t', 1], ['.x_b', 1], ['.iges', 1], ['.igs', 1], ['.ifc', 1], ['.sldasm', 2], ['.iam', 2], ['.catproduct', 2], ['.asm', 2], ['.zip', 3], ['.sldprt', 4], ['.ipt', 4], ['.catpart', 4], ['.prt', 4], ['.dwg', 5], ['.rvt', 5]]);
const maximumArchiveBytes = 128 * 1024 * 1024;
async function walk(directory, out = []) { for (const entry of await readdir(directory, { withFileTypes: true })) { const absolute = path.join(directory, entry.name); if (entry.isDirectory()) { if (entry.name !== 'result' && !entry.name.startsWith('.')) await walk(absolute, out); } else out.push(absolute); } return out; }
const normalizeLineage = value => {
  const name = path.basename(value).replace(/\.zip$/i, '');
  const snapshotStripped = name.replace(/\.snapshot\.\d+(?:\s*\(\d+\))?$/i, '');
  const base = snapshotStripped === name ? path.basename(name, path.extname(name)) : snapshotStripped;
  return base.toLowerCase().replace(/[-_ ]+(assembly|model|design)$/i, '').replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '');
};
// ZIP 원본과 그 압축 해제 디렉터리/내부 CAD는 같은 제품 lineage다.
// 가장 바깥쪽 *.snapshot.N 경로 세그먼트를 사용해 holdout 누수를 막는다.
const lineage = relativePath => {
  const segments = relativePath.replaceAll('\\', '/').split('/');
  const snapshot = segments.find(segment => /\.snapshot\.\d+(?:\s*\(\d+\))?(?:\.zip)?$/i.test(segment));
  return normalizeLineage(snapshot ?? relativePath);
};
const classificationText = relativePath => {
  const segments = relativePath.replaceAll('\\', '/').split('/');
  return segments.find(segment => /\.snapshot\.\d+(?:\s*\(\d+\))?(?:\.zip)?$/i.test(segment)) ?? relativePath;
};
const digest = file => new Promise((resolve, reject) => { const hash = createHash('sha256'); createReadStream(file).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject); });
async function archiveHasProductCad(item) { if (item.bytes > maximumArchiveBytes) return false; const archive = await JSZip.loadAsync(await readFile(item.absolutePath)); const supported = item.family === 'interior' ? new Set(['.ifc', '.rvt', '.dwg', '.step', '.stp']) : new Set(['.sldasm', '.sldprt', '.iam', '.ipt', '.catproduct', '.catpart', '.asm', '.prt', '.step', '.stp', '.iges', '.igs', '.x_t', '.x_b']); return Object.keys(archive.files).some(name => supported.has(path.extname(name).toLowerCase())); }

const files = (await walk(root)).filter(file => PRODUCT_EXTENSIONS.has(path.extname(file).toLowerCase()));
const classified = [];
for (const file of files) { const relativePath = path.relative(root, file).replaceAll('\\', '/'), productName = classificationText(relativePath), match = FAMILY_RULES.find(([, rule]) => rule.test(productName)); if (!match) continue; if (match[0] === 'turbomachinery' && /\b(pump[-_ ]?room|fire[-_ ]?pump|fanuc)\b/i.test(productName)) continue; const info = await stat(file); classified.push({ family: match[0], absolutePath: file, relativePath, extension: path.extname(file).toLowerCase().slice(1), bytes: info.size, lineageGroup: `${match[0]}:${lineage(relativePath)}` }); }
const byLineage = new Map();
for (const item of classified) { const prior = byLineage.get(item.lineageGroup); const rank = priority.get(`.${item.extension}`) ?? 99; if (!prior || rank < (priority.get(`.${prior.extension}`) ?? 99) || (rank === (priority.get(`.${prior.extension}`) ?? 99) && item.bytes > prior.bytes)) byLineage.set(item.lineageGroup, item); }
const unique = [...byLineage.values()].sort((a, b) => a.family.localeCompare(b.family) || a.lineageGroup.localeCompare(b.lineageGroup));
await mkdir(output, { recursive: true });
const queues = {};
for (const [family] of FAMILY_RULES) {
  const familyItems = unique.filter(item => item.family === family), selected = [], structurallyRejected = [];
  for (const item of familyItems) { if (selected.length >= limit) break; if (item.extension === 'zip' && !(await archiveHasProductCad(item))) { structurallyRejected.push({ lineageGroup: item.lineageGroup, relativePath: item.relativePath, reason: item.bytes > maximumArchiveBytes ? 'archive_preflight_budget_exceeded' : 'supported_product_cad_missing' }); continue; } selected.push({ caseId: `${family}-review-${String(selected.length + 1).padStart(2, '0')}`, family, tierCandidate: item.extension === 'zip' ? 'T3' : ['sldasm', 'iam', 'catproduct', 'asm'].includes(item.extension) ? 'T2' : 'T1', holdoutGroup: item.lineageGroup, sourceHash: await digest(item.absolutePath), bytes: item.bytes, extension: item.extension, localLocator: item.relativePath, split: 'holdout_candidate', groundTruthApproved: false, scoreEligible: false, reviewChecklist: ['provenance_and_commercial_license', 'lineage_independence', 'native_definition_occurrence_counts', 'units_and_coordinate_system', 'assertion_graph_and_tolerance', 'prompt_and_holdout_isolation'] }); }
  queues[family] = { candidates: familyItems.length, selected: selected.length, shortfall: Math.max(0, limit - selected.length), structurallyRejected, items: selected };
  await writeFile(path.join(output, `${family}.review.json`), `${JSON.stringify({ schema: 'nexyfab.complex-holdout-review.v1', family, policy: { selectedDoesNotMeanApproved: true, scoreEligible: false, oneCasePerLineage: true, requiredApprovedCases: limit }, ...queues[family] }, null, 2)}\n`);
}
const counts = Object.fromEntries(Object.entries(queues).map(([family, queue]) => [family, { candidates: queue.candidates, selected: queue.selected, shortfall: queue.shortfall }]));
await writeFile(path.join(output, 'summary.json'), `${JSON.stringify({ schema: 'nexyfab.complex-holdout-review-summary.v1', root, policy: { sourceBytesCopied: false, selectedDoesNotMeanApproved: true, scoreEligible: false, requiredApprovedCasesPerFamily: limit }, counts }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, filesScanned: files.length, classified: classified.length, uniqueLineages: unique.length, counts })}\n`);
