import { describe, expect, it } from 'vitest';
import { buildLiveHealthPayload, resolveBuildTag } from '../../../../../apps/core-api/src/health/live';

describe('core-api live health slice', () => {
  it('prefers explicit build identity and produces stable JSON', () => {
    expect(buildLiveHealthPayload(
      { NODE_ENV: 'test', NEXYFAB_BUILD_ID: 'commit-123', RAILWAY_GIT_COMMIT_SHA: 'railway-456' },
      new Date('2026-08-23T00:00:00.000Z'),
    )).toEqual({ status: 'ok', timestamp: '2026-08-23T00:00:00.000Z', build: 'commit-123' });
  });

  it('falls back without exposing unrelated secrets', () => {
    expect(resolveBuildTag({ NODE_ENV: 'test', RAILWAY_GIT_COMMIT_SHA: 'railway-456789' })).toBe('railway-4567');
    expect(resolveBuildTag({ NODE_ENV: 'test', NEXYFAB_BUILD_TAG: 'tag-1' })).toBe('tag-1');
    expect(resolveBuildTag({ NODE_ENV: 'test', DATABASE_URL: 'postgres://secret@example.test' })).toBe('unknown');
  });
});
