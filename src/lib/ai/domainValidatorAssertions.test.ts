import { describe, expect, it } from 'vitest';
import { verifyCrossDomainDesign } from './crossDomainVerification';
import { assessComplexProductAccuracy } from './complexProductAccuracy';
import {
  assertionsFromComplexProduct,
  assertionsFromCrossDomain,
  assertionsFromExplicitGates,
} from './domainValidatorAssertions';

describe('domain validator assertion adapters', () => {
  it('converts real cross-domain interior gates without claiming unmeasured axes', () => {
    const result = verifyCrossDomainDesign({
      structure: { valid: true },
      placement: { required: 3, resolved: 3, invalid: 0 },
      interior: {
        applicable: true,
        spaceBoundary: { ran: true, openBoundaries: 0, conservative: true },
        egress: { ran: true, passed: true, conservative: true },
        doorSwing: { ran: true, clear: true, conservative: true },
        mepInterference: { ran: true, collisions: 0, missingGeometry: 0, conservative: true },
      },
    });
    const assertions = assertionsFromCrossDomain('interior', result);
    expect(assertions.find(item => item.axis === 'hierarchy')?.status).toBe('pass');
    expect(assertions.find(item => item.axis === 'motion')?.status).toBe('pass');
    expect(assertions.find(item => item.axis === 'collision_clearance')?.status).toBe('pass');
    expect(assertions.find(item => item.axis === 'dimensions')).toMatchObject({ status: 'not_run' });
  });

  it('keeps incomplete precise geometry as not_run', () => {
    const result = verifyCrossDomainDesign({
      structure: { valid: true },
      placement: { required: 2, resolved: 2, invalid: 0 },
      assembly: { applicable: true, authoritativeDof: { ran: true, accepted: true }, preciseInterference: { ran: true, collisions: 0, missingGeometry: 1 } },
    });
    expect(assertionsFromCrossDomain('mechanical', result).find(item => item.axis === 'collision_clearance')).toMatchObject({ status: 'not_run' });
  });

  it('converts real complex-product gates and fails the affected axis', () => {
    const result = assessComplexProductAccuracy({
      definitions: 3, instances: 3, maxAssemblyDepth: 2,
      interfacesRequired: 2, interfacesVerified: 1,
      exactPartsVerified: 3, expectedStepOccurrences: 3, measuredStepOccurrences: 3,
      movingInstances: 1,
    });
    const assertions = assertionsFromComplexProduct('mechanical', result);
    expect(assertions.find(item => item.axis === 'joints')).toMatchObject({ status: 'fail' });
    expect(assertions.find(item => item.axis === 'features')).toMatchObject({ status: 'pass' });
    expect(assertions.find(item => item.axis === 'dimensions')).toMatchObject({ status: 'not_run' });
  });

  it('merges multiple gates on one axis using fail > not_run > pass', () => {
    const assertions = assertionsFromExplicitGates('civil', [
      { id: 'wall-ratio', axis: 'dimensions', status: 'passed', reason: 'measured' },
      { id: 'soil-input', axis: 'dimensions', status: 'not_run', reason: 'soil missing' },
      { id: 'bearing', axis: 'dimensions', status: 'failed', reason: 'outside tolerance' },
    ]);
    expect(assertions.find(item => item.axis === 'dimensions')).toMatchObject({
      status: 'fail',
      reason: expect.stringContaining('soil-input'),
    });
  });
});

