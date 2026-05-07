import { describe, it, expect } from 'vitest';
import { flattenFeaturePipelineContext } from '../featurePipelineTelemetry';

describe('flattenFeaturePipelineContext', () => {
  it('extracts M2 fields for audit / Sentry', () => {
    expect(
      flattenFeaturePipelineContext({
        diagnosticCode: 'emptyOutput',
        featureId: 'feat_1',
        featureType: 'fillet',
        stage: 'shape_generator_worker',
        enabledFeatureCount: 3,
        params: { radius: 5 },
      }),
    ).toEqual({
      diagnosticCode: 'emptyOutput',
      featureId: 'feat_1',
      featureType: 'fillet',
      stage: 'shape_generator_worker',
      enabledFeatureCount: 3,
    });
  });

  it('returns empty when context missing or non-object', () => {
    expect(flattenFeaturePipelineContext(undefined)).toEqual({});
    expect(flattenFeaturePipelineContext(null)).toEqual({});
  });
});
