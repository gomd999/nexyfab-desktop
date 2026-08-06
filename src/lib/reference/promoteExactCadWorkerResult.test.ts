import { describe, expect, it } from 'vitest';
import { validateComplexNativeExtraction, type ComplexNativeExtractionRequest } from './complexNativeExtraction';
import type { ExactCadWorkerRequest, ExactCadWorkerResult } from './exactCadWorkerContract';
import { promoteExactCadWorkerResult } from './promoteExactCadWorkerResult';
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], sourceHash = 'a'.repeat(64), memberHash = 'b'.repeat(64);
const request: ExactCadWorkerRequest = { schema: 'nexyfab.exact-cad-worker-request.v1', jobId: 'j', caseId: 'c', sourceHash, sourceMember: { path: 'm.rvt', sha256: memberHash }, workerKind: 'revit-native', required: { exactGeometry: true, nativeSemantics: true } };
const result: ExactCadWorkerResult = { schema: 'nexyfab.exact-cad-worker-result.v1', jobId: 'j', caseId: 'c', sourceHash, sourceMember: request.sourceMember, worker: { name: 'revit-worker', version: '1', cadSystem: 'Revit' }, units: { length: 'mm', angle: 'deg' }, definitions: [{ id: 'a', kind: 'assembly' }, { id: 'p', kind: 'part', bodyCount: 2, geometry: { evidence: 'native-brep', faceCount: 20, volumeMm3: 500 } }], occurrences: [{ id: 'ao', definitionId: 'a', parentOccurrenceId: null, localToParent: identity }, { id: 'po', definitionId: 'p', parentOccurrenceId: 'ao', localToParent: identity }], nativeSemantics: { complete: true, definitionOccurrenceSeparated: true, hierarchyRecovered: true, parametersRecovered: true, constraintsRecovered: true } };
describe('exact worker native promotion', () => {
  it('promotes complete Revit native structure and keeps joints unclaimed', () => {
    const promoted = promoteExactCadWorkerResult(request, result)!;
    const nativeRequest: ComplexNativeExtractionRequest = { schema: 'nexyfab.complex-native-extraction-request.v1', caseId: 'c', sourceHash, format: 'rvt', localLocator: 'x', requiredAxes: ['part_definitions', 'body_membership', 'occurrences', 'hierarchy', 'transforms', 'joints', 'units'] };
    expect(promoted.definitions[1]).toMatchObject({ bodyCount: 2, bodyCountSource: 'native_shape_solids' });
    expect(validateComplexNativeExtraction(nativeRequest, promoted).axes.find(item => item.axis === 'joints')?.status).toBe('not_run');
  });
  it('does not promote exact DWG geometry without native semantics', () => expect(promoteExactCadWorkerResult({ ...request, workerKind: 'dwg-exact', required: { exactGeometry: true, nativeSemantics: false } }, { ...result, nativeSemantics: { ...result.nativeSemantics, complete: false } })).toBeNull());
  it('does not claim body membership for closed mesh evidence', () => {
    const promoted = promoteExactCadWorkerResult(request, { ...result, definitions: [result.definitions[0]!, { ...result.definitions[1]!, geometry: { evidence: 'indexed-closed-mesh', faceCount: 20, volumeMm3: 500, watertight: true } }] })!;
    expect(promoted.definitions[1]?.bodyCount).toBeUndefined();
  });
});
