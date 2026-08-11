import { describe, expect, it } from 'vitest';
import { feaWorkerBuildId } from '../../services/fea-worker/server';

describe('FEA worker build identity', () => {
  it('exposes an explicit immutable deployment identity', () => {
    expect(feaWorkerBuildId({ NEXYFAB_WORKER_BUILD_ID: '  commit-sha  ' })).toBe('commit-sha');
  });

  it('fails visibly when no identity was configured', () => {
    expect(feaWorkerBuildId({})).toBe('unknown');
  });
});
