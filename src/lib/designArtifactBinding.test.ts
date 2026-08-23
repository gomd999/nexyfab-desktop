import { describe, expect, it } from 'vitest';
import {
  buildDesignArtifactManifest,
  designRevisionSha256,
} from './designArtifactBinding';

const bytes = (value: string) => new TextEncoder().encode(value);

describe('design artifact revision binding', () => {
  it('canonicalizes revision objects and artifact ordering', () => {
    expect(designRevisionSha256({ b: 2, a: { d: 4, c: 3 } })).toBe(
      designRevisionSha256({ a: { c: 3, d: 4 }, b: 2 }),
    );
    const left = buildDesignArtifactManifest({
      revisionId: 'r1',
      revisionValue: { b: 2, a: 1 },
      artifacts: [
        { name: 'model.step', mime: 'application/step', bytes: bytes('step') },
        { name: 'bom.csv', mime: 'text/csv', bytes: bytes('bom') },
      ],
    });
    const right = buildDesignArtifactManifest({
      revisionId: 'r1',
      revisionValue: { a: 1, b: 2 },
      artifacts: [
        { name: 'bom.csv', mime: 'text/csv', bytes: bytes('bom') },
        { name: 'model.step', mime: 'application/step', bytes: bytes('step') },
      ],
    });
    expect(left).toEqual(right);
  });

  it('changes the manifest digest when exact artifact bytes change', () => {
    const make = (step: string) => buildDesignArtifactManifest({
      revisionId: 'r1',
      revisionValue: { size: 10 },
      artifacts: [{ name: 'model.step', mime: 'application/step', bytes: bytes(step) }],
    });
    expect(make('STEP-A').manifest.revisionSha256).toBe(make('STEP-B').manifest.revisionSha256);
    expect(make('STEP-A').manifestSha256).not.toBe(make('STEP-B').manifestSha256);
  });

  it('remains fail-closed about manufacturing release', () => {
    const { manifest } = buildDesignArtifactManifest({
      revisionId: 'r1',
      revisionValue: { size: 10 },
      artifacts: [{ name: 'model.step', mime: 'application/step', bytes: bytes('step') }],
    });
    expect(manifest).toMatchObject({
      releaseStatus: 'review_required',
      manufacturingAllowed: false,
    });
  });
});
