import type { NativeWorkerKind } from './nativeWorkerRouting';

export type ExternalNativeWorkerKind = Exclude<NativeWorkerKind, 'freecad-exchange' | 'ifc-native'>;

export interface NativeWorkerHealth {
  schema: 'nexyfab.native-worker-health.v1';
  workerKind: ExternalNativeWorkerKind;
  worker: { name: string; version: string; cadSystem: string };
  protocol: { executionResultSchema: 'nexyfab.native-worker-execution-result.v1.1' };
  host: { os: 'windows' | 'linux'; architecture: 'x64' | 'arm64' };
  license: { status: 'valid' | 'missing' | 'expired' | 'unreachable'; expiresAt?: string };
  capabilities: { exactGeometry: boolean; nativeHierarchy: boolean; nativeConstraints: boolean; nativeParameters: boolean };
  ready: boolean;
}

export const NATIVE_WORKER_HOST_REQUIREMENTS: Record<ExternalNativeWorkerKind, { environment: string; hostOs: 'windows' | 'windows-or-linux'; licenseRequired: boolean; nativeApplication: string }> = {
  'solidworks-native': { environment: 'NEXYFAB_SOLIDWORKS_WORKER_COMMAND', hostOs: 'windows', licenseRequired: true, nativeApplication: 'SOLIDWORKS' },
  'inventor-native': { environment: 'NEXYFAB_INVENTOR_WORKER_COMMAND', hostOs: 'windows', licenseRequired: true, nativeApplication: 'Autodesk Inventor' },
  'catia-native': { environment: 'NEXYFAB_CATIA_WORKER_COMMAND', hostOs: 'windows', licenseRequired: true, nativeApplication: 'CATIA' },
  'creo-native': { environment: 'NEXYFAB_CREO_WORKER_COMMAND', hostOs: 'windows', licenseRequired: true, nativeApplication: 'PTC Creo' },
  'parasolid-native': { environment: 'NEXYFAB_PARASOLID_WORKER_COMMAND', hostOs: 'windows-or-linux', licenseRequired: true, nativeApplication: 'Parasolid-enabled translator' },
  'dwg-exact': { environment: 'NEXYFAB_DWG_WORKER_COMMAND', hostOs: 'windows-or-linux', licenseRequired: true, nativeApplication: 'ODA/AutoCAD-compatible exact DWG engine' },
  'revit-native': { environment: 'NEXYFAB_REVIT_WORKER_COMMAND', hostOs: 'windows', licenseRequired: true, nativeApplication: 'Autodesk Revit' },
};

export function validateNativeWorkerHealth(expected: ExternalNativeWorkerKind, health: NativeWorkerHealth) {
  const errors: string[] = [];
  if (health.schema !== 'nexyfab.native-worker-health.v1') errors.push('health_schema_invalid');
  if (health.workerKind !== expected) errors.push('worker_kind_mismatch');
  if (![health.worker?.name, health.worker?.version, health.worker?.cadSystem].every(value => typeof value === 'string' && value.trim())) errors.push('worker_identity_missing');
  if (health.protocol?.executionResultSchema !== 'nexyfab.native-worker-execution-result.v1.1') errors.push('execution_result_protocol_unsupported');
  const requirement = NATIVE_WORKER_HOST_REQUIREMENTS[expected];
  if (requirement.hostOs === 'windows' && health.host?.os !== 'windows') errors.push('host_os_unsupported');
  if (health.license?.status !== 'valid') errors.push(`license_${health.license?.status ?? 'missing'}`);
  if (!health.capabilities?.exactGeometry) errors.push('exact_geometry_capability_missing');
  if (['solidworks-native', 'inventor-native', 'catia-native', 'creo-native', 'revit-native'].includes(expected)
      && (!health.capabilities?.nativeHierarchy || !health.capabilities?.nativeConstraints)) errors.push('native_semantics_capability_missing');
  if (health.ready !== (errors.length === 0)) errors.push('ready_flag_inconsistent');
  return { status: errors.length ? 'fail' as const : 'pass' as const, ready: errors.length === 0, errors };
}
