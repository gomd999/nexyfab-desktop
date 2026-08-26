import { buildDesignArtifactManifest, designRevisionSha256 } from '@/lib/designArtifactBinding';

export type RenderSpec = { intent: unknown } | { assembly: unknown };

export function buildRenderHtmlArtifactReceipt(spec: RenderSpec, html: string) {
  const kind = 'assembly' in spec ? 'assembly' : 'intent';
  const artifactBinding = buildDesignArtifactManifest({
    revisionId: `${kind}-${designRevisionSha256(spec).slice(0, 12)}`,
    revisionValue: spec,
    artifacts: [{ name: 'GA_3D.html', mime: 'text/html', bytes: Buffer.from(html, 'utf8') }],
  });
  return {
    revisionId: artifactBinding.manifest.revisionId,
    revisionSha256: artifactBinding.manifest.revisionSha256,
    artifactSha256: artifactBinding.manifest.artifacts[0]!.sha256,
    artifactManifestSha256: artifactBinding.manifestSha256,
    artifactManifest: artifactBinding.manifest,
    releaseStatus: artifactBinding.manifest.releaseStatus,
    manufacturingAllowed: artifactBinding.manifest.manufacturingAllowed,
  };
}
