import { describe, expect, it } from 'vitest';
import { resolveBuildIdentity } from './buildIdentity';

describe('resolveBuildIdentity', () => {
  it('uses an explicit local-upload commit identity for server and client', () => {
    expect(resolveBuildIdentity({ NEXYFAB_BUILD_ID: '0123456789abcdef' }, false)).toEqual({
      buildId: '0123456789abcdef',
      publicRelease: '01234567',
    });
  });

  it('prefers Railway Git identity when no explicit identity is supplied', () => {
    expect(resolveBuildIdentity({ RAILWAY_GIT_COMMIT_SHA: 'abcdef0123456789' }, false)).toEqual({
      buildId: 'abcdef012345',
      publicRelease: 'abcdef01',
    });
  });

  it('fails closed instead of presenting a timestamp as production identity', () => {
    expect(resolveBuildIdentity({}, false)).toEqual({ buildId: 'unknown', publicRelease: 'unknown' });
  });

  it('uses an explicit development marker locally', () => {
    expect(resolveBuildIdentity({}, true)).toEqual({ buildId: 'dev', publicRelease: 'dev' });
  });
});
