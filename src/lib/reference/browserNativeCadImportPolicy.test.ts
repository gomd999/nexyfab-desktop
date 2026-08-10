import { describe, expect, it } from 'vitest';
import { browserNativeCadImportPolicy } from './browserNativeCadImportPolicy';

describe('browser native CAD import policy', () => {
  it('blocks licensed native formats before the browser reads their bytes', () => {
    expect(browserNativeCadImportPolicy('gearbox.SLDASM')).toMatchObject({
      action: 'block-before-read', extension: 'sldasm', workerKind: 'solidworks-native',
    });
    expect(browserNativeCadImportPolicy('cabinet.IAM')).toMatchObject({
      action: 'block-before-read', workerKind: 'inventor-native',
    });
  });

  it('allows locally handled exchange formats to continue', () => {
    expect(browserNativeCadImportPolicy('assembly.step')).toEqual({ action: 'continue' });
    expect(browserNativeCadImportPolicy('building.ifc')).toEqual({ action: 'continue' });
    expect(browserNativeCadImportPolicy('body.x_t')).toEqual({ action: 'continue-approximate', extension: 'x_t' });
  });
});
