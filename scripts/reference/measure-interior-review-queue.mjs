#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(arg('root') || 'C:/Users/gomd9/Downloads/참고파일들');
const queuePath = path.resolve(arg('queue') || 'C:/tmp/nexyfab-interior-review-queue.json');
const output = path.resolve(arg('output') || 'C:/tmp/nexyfab-interior-measurements.json');
const count = (text, expression) => (text.match(expression) ?? []).length;
const queue = JSON.parse(await readFile(queuePath, 'utf8')), records = [];
for (const item of queue.selected ?? []) {
  const bytes = await readFile(path.resolve(root, item.localLocator));
  const sourceHash = createHash('sha256').update(bytes).digest('hex');
  if (sourceHash !== item.sourceHash) { records.push({ caseId: item.caseId, status: 'failed', code: 'SOURCE_CHANGED' }); continue; }
  const text = bytes.toString('latin1');
  if (item.extension === 'ifc') {
    const schema = text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1] ?? null;
    const measured = {
      schema, projects: count(text, /=\s*IFCPROJECT\s*\(/gi), sites: count(text, /=\s*IFCSITE\s*\(/gi),
      buildings: count(text, /=\s*IFCBUILDING\s*\(/gi), storeys: count(text, /=\s*IFCBUILDINGSTOREY\s*\(/gi),
      spaces: count(text, /=\s*IFCSPACE\s*\(/gi), walls: count(text, /=\s*IFCWALL(?:STANDARDCASE)?\s*\(/gi),
      doors: count(text, /=\s*IFCDOOR\s*\(/gi), windows: count(text, /=\s*IFCWINDOW\s*\(/gi),
      localPlacements: count(text, /=\s*IFCLOCALPLACEMENT\s*\(/gi), aggregates: count(text, /=\s*IFCRELAGGREGATES\s*\(/gi),
      containment: count(text, /=\s*IFCRELCONTAINEDINSPATIALSTRUCTURE\s*\(/gi), elements: count(text, /=\s*IFC[A-Z0-9_]*ELEMENT[A-Z0-9_]*\s*\(/gi),
    };
    const completeSpatialRoot = measured.projects > 0 && measured.buildings > 0 && measured.storeys > 0 && measured.localPlacements > 0 && measured.aggregates > 0;
    records.push({ caseId: item.caseId, status: completeSpatialRoot ? 'candidate_measured' : 'review_required', format: 'ifc', sourceHash, bytes: bytes.byteLength, measured, completeness: { spatialRoot: completeSpatialRoot, spaceSemantics: measured.spaces > 0, openings: measured.doors + measured.windows > 0 }, groundTruthApproved: false, scoreEligible: false });
  } else {
    const measured = { productDefinitions: count(text, /=\s*PRODUCT_DEFINITION\s*\(/gi), occurrences: count(text, /=\s*NEXT_ASSEMBLY_USAGE_OCCURRENCE\s*\(/gi), manifoldSolids: count(text, /=\s*MANIFOLD_SOLID_BREP\s*\(/gi), mappedItems: count(text, /=\s*MAPPED_ITEM\s*\(/gi) };
    records.push({ caseId: item.caseId, status: measured.manifoldSolids > 0 ? 'candidate_measured' : 'review_required', format: 'step', sourceHash, bytes: bytes.byteLength, measured, completeness: { assemblyGraph: measured.occurrences > 0, solids: measured.manifoldSolids > 0, spatialSemantics: false }, groundTruthApproved: false, scoreEligible: false });
  }
}
const summary = { selected: records.length, candidateMeasured: records.filter(item => item.status === 'candidate_measured').length, reviewRequired: records.filter(item => item.status === 'review_required').length, failed: records.filter(item => item.status === 'failed').length, ifc: records.filter(item => item.format === 'ifc').length, step: records.filter(item => item.format === 'step').length, ifcWithSpaces: records.filter(item => item.format === 'ifc' && item.completeness.spaceSemantics).length, ifcWithOpenings: records.filter(item => item.format === 'ifc' && item.completeness.openings).length };
await writeFile(output, `${JSON.stringify({ schema: 'nexyfab.interior-ground-truth-candidate.v1', generatedAt: new Date().toISOString(), policy: { regexCountsAreCandidateEvidenceOnly: true, manualReviewRequired: true, scoreEligible: false }, summary, records }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, ...summary })}\n`);
