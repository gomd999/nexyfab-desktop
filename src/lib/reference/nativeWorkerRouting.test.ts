import { describe, expect, it } from 'vitest';
import { routeNativeCadExtension, supportedNativeCadExtensions } from './nativeWorkerRouting';

describe('nativeWorkerRouting', () => {
  it('routes native assembly formats to their authoritative workers', () => {
    expect(routeNativeCadExtension('.SLDASM')).toEqual({ workerKind: 'solidworks-native', availability: 'external-required', nativeSemanticsRequired: true });
    expect(routeNativeCadExtension('iam')?.workerKind).toBe('inventor-native');
    expect(routeNativeCadExtension('CATProduct')?.workerKind).toBe('catia-native');
    expect(routeNativeCadExtension('asm')?.workerKind).toBe('creo-native');
  });

  it('keeps exchange geometry separate from native semantics', () => {
    expect(routeNativeCadExtension('step')).toEqual({ workerKind: 'freecad-exchange', availability: 'local', nativeSemanticsRequired: false });
    expect(routeNativeCadExtension('ifc')).toEqual({ workerKind: 'ifc-native', availability: 'local', nativeSemanticsRequired: true });
  });

  it('fails closed for unsupported extensions', () => {
    expect(routeNativeCadExtension('stl')).toBeNull();
    expect(supportedNativeCadExtensions()).toContain('x_t');
  });
});
