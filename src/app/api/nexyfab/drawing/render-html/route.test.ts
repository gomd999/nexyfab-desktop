import { describe, expect, it } from 'vitest';
import { buildRenderHtmlArtifactReceipt } from './artifactReceipt';

describe('render-html artifact receipt', () => {
  it('binds the exact GA_3D.html bytes to the canonical intent revision', () => {
    const first = buildRenderHtmlArtifactReceipt({ intent: { features: [{ kind: 'box', x: 10 }] } }, '<html>α</html>');
    const reordered = buildRenderHtmlArtifactReceipt({ intent: { features: [{ x: 10, kind: 'box' }] } }, '<html>α</html>');

    expect(first.revisionId).toMatch(/^intent-[a-f0-9]{12}$/);
    expect(first.revisionSha256).toBe(reordered.revisionSha256);
    expect(first.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.artifactManifest.artifacts).toEqual([
      expect.objectContaining({ name: 'GA_3D.html', mime: 'text/html', bytes: Buffer.byteLength('<html>α</html>', 'utf8') }),
    ]);
    expect(first.releaseStatus).toBe('review_required');
    expect(first.manufacturingAllowed).toBe(false);
  });

  it('changes the artifact hash when the rendered bytes change', () => {
    const left = buildRenderHtmlArtifactReceipt({ assembly: { parts: [] } }, '<html>A</html>');
    const right = buildRenderHtmlArtifactReceipt({ assembly: { parts: [] } }, '<html>B</html>');

    expect(left.revisionId).toBe(right.revisionId);
    expect(left.artifactSha256).not.toBe(right.artifactSha256);
    expect(left.artifactManifestSha256).not.toBe(right.artifactManifestSha256);
  });
});
