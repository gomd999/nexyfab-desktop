import { describe, expect, it } from 'vitest';
import { evaluateNativeCadCapability } from './nativeCadCapability';

describe('native CAD capability', () => {
  it('requires Windows for COM automation', () => expect(evaluateNativeCadCapability('solidworks-com', { platform: 'linux', registeredProgIds: ['SldWorks.Application'], exchangerConfigured: false })).toMatchObject({ status: 'not_run', reason: 'native_cad_com_requires_windows' }));
  it('recognizes a registered application', () => expect(evaluateNativeCadCapability('inventor-com', { platform: 'win32', registeredProgIds: ['Inventor.Application'], exchangerConfigured: false })).toMatchObject({ status: 'ready', matchedProgId: 'Inventor.Application' }));
  it('fails closed when native CAD is absent', () => expect(evaluateNativeCadCapability('solidworks-com', { platform: 'win32', registeredProgIds: [], exchangerConfigured: false })).toMatchObject({ status: 'not_run', reason: 'native_cad_com_unregistered' }));
  it('allows an explicitly configured licensed exchanger', () => expect(evaluateNativeCadCapability('parasolid-cad-exchanger', { platform: 'win32', registeredProgIds: [], exchangerConfigured: true })).toMatchObject({ status: 'ready', reason: 'licensed_cad_exchanger_configured' }));
});
