#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const requestsPath = path.resolve(arg('requests') || 'docs/evidence/complex-holdout-review-260806/native-extraction-requests.json');
const structurePath = path.resolve(arg('structure') || 'docs/evidence/complex-holdout-review-260806/structure-evidence.json');
const completedPath = path.resolve(arg('completed') || 'docs/evidence/complex-holdout-review-260806/freecad-all-results.json');
const output = path.resolve(arg('output') || 'docs/evidence/complex-holdout-review-260806/native-extractor-jobs.json');
const requests = JSON.parse(await readFile(requestsPath, 'utf8')).requests, structure = JSON.parse(await readFile(structurePath, 'utf8')), completed = JSON.parse(await readFile(completedPath, 'utf8')).results, completedIds = new Set(completed.map(item => item.caseId)), structureById = new Map(structure.results.map(item => [item.caseId, item]));
function route(request) {
  const evidence = structureById.get(request.caseId), ext = request.format.toLowerCase(), extensions = evidence?.container?.byExtension ?? {};
  if (ext === 'sldasm' || extensions['.sldasm']) return { executor: 'solidworks-com', capability: 'definition-occurrence-transform-mate', reason: 'SolidWorks assembly source is available.' };
  if (ext === 'iam' || extensions['.iam']) return { executor: 'inventor-com', capability: 'definition-occurrence-transform-constraint', reason: 'Inventor assembly source is available.' };
  if (ext === 'catproduct' || extensions['.catproduct']) return { executor: 'catia-com-or-cad-exchanger', capability: 'definition-occurrence-transform-constraint', reason: 'CATIA product source is available.' };
  if (ext === 'asm' || extensions['.asm']) return { executor: 'creo-or-solid-edge-native', capability: 'definition-occurrence-transform-constraint', reason: 'Generic ASM requires vendor identification before extraction.' };
  if (ext === 'x_t' || extensions['.x_t']) return { executor: 'parasolid-cad-exchanger', capability: 'body-definition-structure', reason: 'Parasolid carries geometry but normally no vendor mate graph.' };
  if (completedIds.has(request.caseId)) return { executor: 'manual-interface-review', capability: 'joint-ground-truth', reason: 'FreeCAD extracted STEP structure; original mate semantics are absent from the available source.' };
  return { executor: 'unsupported-native-review', capability: 'source-triage', reason: `No supported native assembly source was detected for ${ext}.` };
}
const jobs = requests.map(request => ({ ...request, ...route(request), freecadStructureCompleted: completedIds.has(request.caseId), status: 'pending' }));
const partitions = jobs.reduce((out, job) => { const list = out[job.executor] ?? []; list.push(job); out[job.executor] = list; return out; }, {});
const counts = Object.fromEntries(Object.entries(partitions).map(([executor, items]) => [executor, items.length]));
await writeFile(output, `${JSON.stringify({ schema: 'nexyfab.complex-native-extractor-jobs.v1', policy: { jobsDoNotGrantApproval: true, sourceBytesEmbedded: false, freecadCannotInventMates: true }, counts, partitions }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, counts })}\n`);
