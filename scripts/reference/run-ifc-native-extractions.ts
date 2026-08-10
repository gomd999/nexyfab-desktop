import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { ifcToNexyfabAssembly } from '../../src/lib/brep-bridge/ifcImport';
import type { ComplexNativeExtractionRequest, ComplexNativeExtractionResult } from '../../src/lib/reference/complexNativeExtraction';

const reviewRoot = path.resolve(process.argv[2] ?? 'docs/evidence/complex-holdout-review-260806');
const corpusRootInput = process.argv[3] ?? process.env.NEXYFAB_REFERENCE_CORPUS_ROOT?.trim();
if (!corpusRootInput) throw new Error('reference_corpus_root_required');
const corpusRoot = path.resolve(corpusRootInput);
const output = path.resolve(process.argv[4] ?? path.join(reviewRoot, 'ifc-native-results.json'));
const repair = (value: string) => { if (!/[Ãìë]/.test(value)) return value; const decoded = Buffer.from(value, 'latin1').toString('utf8'); return decoded.includes('\uFFFD') ? value : decoded; };
const safePath = (root: string, locator: string) => { const absolute = path.resolve(root, repair(locator)); const relative = path.relative(root, absolute); if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`unsafe_locator:${locator}`); return absolute; };
const requests = JSON.parse(fs.readFileSync(path.join(reviewRoot, 'native-extraction-requests.json'), 'utf8')) as { requests: ComplexNativeExtractionRequest[] };
const triagePath = process.argv[5] ?? 'docs/evidence/external-step-structure-coverage-260806/unsupported-archive-triage-run-1.json';
const triage = triagePath === 'none' ? { results: [] } : JSON.parse(fs.readFileSync(triagePath, 'utf8')) as { results: Array<{ caseId: string; route: string }> };
const selected = new Set(triage.results.filter(item => item.route === 'ifc-native-import').map(item => item.caseId));
async function main() {
const results: ComplexNativeExtractionResult[] = []; const failures: Array<{ caseId: string; reason: string }> = []; const measurements = [];
const selectedRequests = requests.requests.filter(item => item.format.toLowerCase() === 'ifc' || selected.has(item.caseId));
for (const request of selectedRequests) {
  try {
    const source = safePath(corpusRoot, request.localLocator);
    let bytes: Buffer;
    let member: string | undefined;
    if (request.format.toLowerCase() === 'ifc') {
      bytes = fs.readFileSync(source);
    } else {
      const archive = await JSZip.loadAsync(fs.readFileSync(source));
      member = Object.keys(archive.files).filter(name => !archive.files[name]!.dir && path.extname(name).toLowerCase() === '.ifc').sort()[0];
      if (!member) throw new Error('ifc_member_missing');
      bytes = await archive.files[member]!.async('nodebuffer');
    }
    const parsed = ifcToNexyfabAssembly(bytes.toString('utf8'), { name: request.caseId, maxParts: 20_000 }); if (!parsed.ok || !parsed.assembly || !parsed.stats) throw new Error(parsed.error ?? 'ifc_parse_failed');
    const rootDefinition = { id: `ifc-definition:${request.caseId}`, name: request.caseId, kind: 'assembly' as const }; const definitions = [rootDefinition, ...parsed.assembly.parts.map(item => ({ id: `ifc-definition:${item.id}`, name: item.id, kind: 'part' as const }))];
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; const occurrences = [{ id: `ifc-occurrence:${request.caseId}`, definitionId: rootDefinition.id, parentOccurrenceId: null, localToParent: identity, suppressed: false }, ...parsed.assembly.parts.map(item => { const radians = (item.at.rz ?? 0) * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians); return { id: `ifc-occurrence:${item.id}`, definitionId: `ifc-definition:${item.id}`, parentOccurrenceId: `ifc-occurrence:${request.caseId}`, localToParent: [c, -s, 0, item.at.tx, s, c, 0, item.at.ty, 0, 0, 1, item.at.tz, 0, 0, 0, 1], suppressed: false }; })];
    const raw = JSON.stringify({ caseId: request.caseId, sourceHash: request.sourceHash, member, definitions, occurrences, stats: parsed.stats }); results.push({ schema: 'nexyfab.complex-native-extraction-result.v1', caseId: request.caseId, sourceHash: request.sourceHash, artifactHash: createHash('sha256').update(raw).digest('hex'), ...(member ? { sourceMember: { path: member.replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex') } } : {}), extractor: { name: 'nexyfab-ifc-spf-product-parser', version: '2', cadSystem: 'IFC SPF' }, units: { length: 'mm', angle: 'deg' }, definitions, occurrences, joints: [], jointSemanticsComplete: false });
    const countClasses = (evidence: 'exact_mesh_volume_aabb_display' | 'exact_surface_mesh' | 'aabb_only') => parsed.assembly!.parts.filter(item => item.geometryEvidence === evidence).reduce((out, item) => { const key = item.sourceClass ?? 'UNKNOWN'; out[key] = (out[key] ?? 0) + 1; return out; }, {} as Record<string, number>);
    const aabbOnlyByRepresentation = parsed.assembly.parts.filter(item => item.geometryEvidence === 'aabb_only').reduce((out, item) => { const key = item.representationKinds?.join('+') || 'UNCLASSIFIED'; out[key] = (out[key] ?? 0) + 1; return out; }, {} as Record<string, number>);
    const closureParts = parsed.assembly.parts.filter(item => item.closureEvidence);
    measurements.push({ caseId: request.caseId, imported: parsed.stats.imported, skipped: parsed.stats.skipped, exact: parsed.stats.exact, approx: parsed.stats.approx, exactMeshVolume: parsed.assembly.parts.filter(item => item.meshVolumeExact).length, exactDisplayMesh: parsed.assembly.parts.filter(item => item.geometryEvidence === 'exact_surface_mesh').length, openSurfaceMesh: closureParts.filter(item => !item.closureEvidence!.watertight).length, openSurfaceMeshByClass: closureParts.filter(item => !item.closureEvidence!.watertight).reduce((out, item) => { const key = item.sourceClass ?? 'UNKNOWN'; out[key] = (out[key] ?? 0) + 1; return out; }, {} as Record<string, number>), topologyPromotedClosedMesh: closureParts.filter(item => item.closureEvidence!.sourceDeclaredOpenSurface && item.closureEvidence!.watertight).length, degenerateRepairParts: closureParts.filter(item => item.closureEvidence!.degenerateRepairApplied).length, removedDegenerateFaces: closureParts.reduce((sum, item) => sum + item.closureEvidence!.removedDegenerateFaces, 0), boundaryEdges: closureParts.reduce((sum, item) => sum + item.closureEvidence!.boundaryEdges, 0), boundaryComponents: closureParts.reduce((sum, item) => sum + item.closureEvidence!.boundaryComponents, 0), closedBoundaryLoops: closureParts.reduce((sum, item) => sum + item.closureEvidence!.closedBoundaryLoops, 0), openBoundaryChains: closureParts.reduce((sum, item) => sum + item.closureEvidence!.openBoundaryChains, 0), branchedBoundaryComponents: closureParts.reduce((sum, item) => sum + item.closureEvidence!.branchedBoundaryComponents, 0), planarClosedBoundaryLoops: closureParts.reduce((sum, item) => sum + item.closureEvidence!.planarClosedBoundaryLoops, 0), microGapCandidates: closureParts.reduce((sum, item) => sum + item.closureEvidence!.microGapCandidates, 0), totalBoundaryLengthMm: closureParts.reduce((sum, item) => sum + item.closureEvidence!.totalBoundaryLengthMm, 0), nonManifoldEdges: closureParts.reduce((sum, item) => sum + item.closureEvidence!.nonManifoldEdges, 0), degenerateFaces: closureParts.reduce((sum, item) => sum + item.closureEvidence!.degenerateFaces, 0), aabbOnly: parsed.assembly.parts.filter(item => item.geometryEvidence === 'aabb_only').length, exactMeshVolumeByClass: parsed.assembly.parts.filter(item => item.meshVolumeExact).reduce((out, item) => { const key = item.sourceClass ?? 'UNKNOWN'; out[key] = (out[key] ?? 0) + 1; return out; }, {} as Record<string, number>), exactDisplayMeshByClass: countClasses('exact_surface_mesh'), aabbOnlyByClass: countClasses('aabb_only'), aabbOnlyByRepresentation, representative: parsed.stats.representative ?? false, byClass: parsed.stats.byClass, skipByClass: parsed.stats.skipByClass ?? {} });
  } catch (error) { failures.push({ caseId: request.caseId, reason: error instanceof Error ? error.message : String(error) }); }
}
const report = { schema: 'nexyfab.complex-native-extraction-result-batch.v1', extractorCapability: { formats: ['ifc', 'zip-contained-ifc'], bodyMembershipComplete: false, jointSemanticsComplete: false }, results, failures, measurements };
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); console.log(JSON.stringify({ output: path.relative(process.cwd(), output), requested: selectedRequests.length, completed: results.length, failures: failures.length, measurements })); if (failures.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
