import { createHash } from 'node:crypto';
import { buildCadNativeStlLocalGeometry } from '../reference/cadNativeStlLocalGeometry';
import type { ScadAssemblyBridgeResult } from './scadAssemblyBridge';

export interface ScadDefinitionRenderResult {
  ok: boolean;
  bytes?: Uint8Array;
  error?: string;
}

export interface ScadDefinitionGeometryEvidence {
  definitionId: string;
  moduleName: string;
  status: 'pass' | 'fail';
  sha256: string | null;
  bytes: number;
  triangles: number | null;
  watertight: boolean | null;
  volumeMm3: number | null;
  bbox: { min: [number, number, number]; max: [number, number, number] } | null;
  codes: string[];
}

export interface ScadOccurrenceGeometryReference {
  occurrenceId: string;
  definitionId: string;
  definitionSha256: string;
  localToWorld: number[];
}

export interface ScadDefinitionGeometryBundle {
  schema: 'nexyfab.scad-definition-geometry-evidence.v1';
  status: 'pass' | 'fail';
  releaseReady: false;
  definitions: ScadDefinitionGeometryEvidence[];
  occurrences: ScadOccurrenceGeometryReference[];
  codes: string[];
  limitations: string[];
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export async function buildScadDefinitionGeometryEvidence(input: {
  modules: Record<string, string>;
  bridge: ScadAssemblyBridgeResult;
  render: (source: string, moduleName: string) => Promise<ScadDefinitionRenderResult>;
}): Promise<ScadDefinitionGeometryBundle> {
  const codes: string[] = [];
  if (input.bridge.status !== 'pass' || !input.bridge.architecture) {
    return { schema: 'nexyfab.scad-definition-geometry-evidence.v1', status: 'fail', releaseReady: false, definitions: [], occurrences: [], codes: ['SCAD_DEFINITION_BRIDGE_NOT_READY'], limitations: ['native_brep_not_available', 'joint_semantics_not_certified'] };
  }
  const definitions: ScadDefinitionGeometryEvidence[] = [];
  const hashes = new Map<string, string>();
  for (const [moduleName, moduleSource] of Object.entries(input.modules)) {
    const definitionId = `scad:def:${moduleName}`;
    const rendered = await input.render(`${moduleSource}\n\n${moduleName}();\n`, moduleName);
    if (!rendered.ok || !rendered.bytes?.length) {
      const code = `SCAD_DEFINITION_RENDER_FAILED:${definitionId}`;
      codes.push(code);
      definitions.push({ definitionId, moduleName, status: 'fail', sha256: null, bytes: 0, triangles: null, watertight: null, volumeMm3: null, bbox: null, codes: [code, ...(rendered.error ? [rendered.error] : [])] });
      continue;
    }
    const sha256 = createHash('sha256').update(rendered.bytes).digest('hex');
    const local = buildCadNativeStlLocalGeometry([{ occurrenceId: `definition-check:${definitionId}`, definitionId, bytes: rendered.bytes, sha256, localToWorld: IDENTITY, unitScaleMm: 1 }]);
    if (local.status !== 'pass' || !local.geometries[0]) {
      const localCodes = [...local.errors, ...local.unresolved];
      codes.push(...localCodes);
      definitions.push({ definitionId, moduleName, status: 'fail', sha256, bytes: rendered.bytes.length, triangles: null, watertight: null, volumeMm3: null, bbox: null, codes: localCodes });
      continue;
    }
    const measurement = local.geometries[0].measurement;
    hashes.set(definitionId, sha256);
    definitions.push({
      definitionId, moduleName, status: 'pass', sha256, bytes: rendered.bytes.length,
      triangles: measurement.triangles, watertight: measurement.watertight,
      volumeMm3: measurement.volume,
      bbox: measurement.bboxMin && measurement.bboxMax
        ? { min: measurement.bboxMin, max: measurement.bboxMax }
        : null,
      codes: [],
    });
  }
  const transformByOccurrence = new Map(input.bridge.transforms.map(item => [item.occurrenceId, item.matrix]));
  const occurrences: ScadOccurrenceGeometryReference[] = [];
  for (const occurrence of input.bridge.architecture.occurrences.filter(item => item.definitionId !== 'scad:def:product')) {
    const hash = hashes.get(occurrence.definitionId);
    const transform = transformByOccurrence.get(occurrence.id);
    if (!hash) { codes.push(`SCAD_OCCURRENCE_DEFINITION_GEOMETRY_MISSING:${occurrence.id}`); continue; }
    if (!transform) { codes.push(`SCAD_OCCURRENCE_TRANSFORM_MISSING:${occurrence.id}`); continue; }
    occurrences.push({ occurrenceId: occurrence.id, definitionId: occurrence.definitionId, definitionSha256: hash, localToWorld: [...transform] });
  }
  const expectedOccurrences = input.bridge.architecture.occurrences.length - 1;
  if (occurrences.length !== expectedOccurrences) codes.push(`SCAD_OCCURRENCE_GEOMETRY_COUNT_MISMATCH:${occurrences.length}:${expectedOccurrences}`);
  return {
    schema: 'nexyfab.scad-definition-geometry-evidence.v1',
    status: codes.length ? 'fail' : 'pass',
    releaseReady: false,
    definitions,
    occurrences,
    codes,
    limitations: ['native_brep_not_available', 'feature_history_not_available', 'joint_semantics_not_certified', 'step_roundtrip_not_certified'],
  };
}
