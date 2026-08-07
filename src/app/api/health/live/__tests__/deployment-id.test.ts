import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '../route';

const original = {
  generated: process.env.NEXYFAB_BUILD_ID,
  railway: process.env.RAILWAY_GIT_COMMIT_SHA,
  tag: process.env.NEXYFAB_BUILD_TAG,
  publicRelease: process.env.NEXT_PUBLIC_RELEASE,
};

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restore('NEXYFAB_BUILD_ID', original.generated);
  restore('RAILWAY_GIT_COMMIT_SHA', original.railway);
  restore('NEXYFAB_BUILD_TAG', original.tag);
  restore('NEXT_PUBLIC_RELEASE', original.publicRelease);
});

describe('live health deployment identifier', () => {
  it('prefers the Railway commit SHA and returns a compact value', async () => {
    delete process.env.NEXYFAB_BUILD_ID;
    process.env.RAILWAY_GIT_COMMIT_SHA = '1234567890abcdef';
    process.env.NEXYFAB_BUILD_TAG = 'manual-tag';
    const body = (await (await GET()).json()) as { build: string };
    expect(body.build).toBe('1234567890ab');
  });

  it('falls back to the build tag, then the public release', async () => {
    delete process.env.NEXYFAB_BUILD_ID;
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    process.env.NEXYFAB_BUILD_TAG = 'build-tag';
    process.env.NEXT_PUBLIC_RELEASE = 'public-release';
    expect(((await (await GET()).json()) as { build: string }).build).toBe('build-tag');

    delete process.env.NEXYFAB_BUILD_TAG;
    expect(((await (await GET()).json()) as { build: string }).build).toBe('public-release');
  });

  it('prefers the build-time generated ID for local upload deployments', async () => {
    process.env.NEXYFAB_BUILD_ID = '20260807050123';
    process.env.RAILWAY_GIT_COMMIT_SHA = '1234567890abcdef';
    const body = (await (await GET()).json()) as { build: string };
    expect(body.build).toBe('20260807050123');
  });
});
