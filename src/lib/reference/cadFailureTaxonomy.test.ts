import { describe, expect, it } from 'vitest';
import { cadFailureDisposition, classifyCadImportFailure } from './cadFailureTaxonomy';

describe('CAD failure taxonomy', () => {
  it.each([
    ['no transferable roots in STEP', 'NO_TRANSFERABLE_ROOTS'],
    ['no solids recognised', 'ZERO_SOLID'],
    ['schema header missing', 'HEADER_INVALID'],
    ['unsupported entity', 'UNSUPPORTED_ENTITY'],
    ['could not be parsed as B-rep', 'INVALID_BREP'],
  ])('classifies %s', (message, code) => expect(classifyCadImportFailure(message).code).toBe(code));

  it('keeps unknown failures release-blocking and non-retryable', () => {
    expect(classifyCadImportFailure('private adapter detail')).toEqual(cadFailureDisposition('UNKNOWN_IMPORT_FAILURE'));
    expect(classifyCadImportFailure(undefined).releaseBlocking).toBe(true);
  });

  it('keeps partial geometry release-blocking but retryable by a complete adapter', () => {
    expect(cadFailureDisposition('GEOMETRY_INCOMPLETE')).toMatchObject({ retryable: true, releaseBlocking: true });
  });

  it('routes unresolved rotational motion and missing narrow-phase geometry to collision refinement', () => {
    expect(cadFailureDisposition('ROTATIONAL_CCD_UNRESOLVED')).toMatchObject({ retryable: true, automaticRepair: 'collision-refine', releaseBlocking: true });
    expect(cadFailureDisposition('LINEAR_CCD_UNRESOLVED')).toMatchObject({ retryable: true, automaticRepair: 'collision-refine', releaseBlocking: true });
    expect(cadFailureDisposition('COLLISION_GEOMETRY_MISSING')).toMatchObject({ retryable: true, automaticRepair: 'collision-refine', releaseBlocking: true });
    expect(cadFailureDisposition('PRECISE_CCD_BUDGET_EXCEEDED')).toMatchObject({ retryable: true, automaticRepair: 'collision-refine', releaseBlocking: true });
  });
});
