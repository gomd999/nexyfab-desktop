import { describe, expect, it } from 'vitest';
import { validateNativeWorkerHealth, type NativeWorkerHealth } from './nativeWorkerHostContract';

const healthy: NativeWorkerHealth = { schema: 'nexyfab.native-worker-health.v1', workerKind: 'solidworks-native', worker: { name: 'sw-worker', version: '1', cadSystem: 'SOLIDWORKS 2026' }, protocol: { executionResultSchema: 'nexyfab.native-worker-execution-result.v1.1' }, host: { os: 'windows', architecture: 'x64' }, license: { status: 'valid' }, capabilities: { exactGeometry: true, nativeHierarchy: true, nativeConstraints: true, nativeParameters: true }, ready: true };

describe('native worker host health', () => {
  it('accepts a licensed native host with required semantics', () => expect(validateNativeWorkerHealth('solidworks-native', healthy)).toEqual({ status: 'pass', ready: true, errors: [] }));
  it('rejects an unlicensed host', () => expect(validateNativeWorkerHealth('solidworks-native', { ...healthy, license: { status: 'missing' }, ready: false }).errors).toContain('license_missing'));
  it('rejects false ready declarations', () => expect(validateNativeWorkerHealth('solidworks-native', { ...healthy, capabilities: { ...healthy.capabilities, exactGeometry: false } }).errors).toContain('ready_flag_inconsistent'));
  it('requires Windows for desktop CAD automation', () => expect(validateNativeWorkerHealth('solidworks-native', { ...healthy, host: { os: 'linux', architecture: 'x64' }, ready: false }).errors).toContain('host_os_unsupported'));
  it('rejects workers that do not declare the governed v1.1 result protocol', () => {
    const legacy = { ...healthy, protocol: { executionResultSchema: 'nexyfab.native-worker-execution-result.v1' }, ready: true } as unknown as NativeWorkerHealth;
    expect(validateNativeWorkerHealth('solidworks-native', legacy)).toMatchObject({ ready: false, errors: expect.arrayContaining(['execution_result_protocol_unsupported', 'ready_flag_inconsistent']) });
  });
});
