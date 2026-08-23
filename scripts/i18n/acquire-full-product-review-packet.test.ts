import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildI18nFullProductReviewPacket,
  I18N_FULL_PRODUCT_ARTIFACTS,
  I18N_FULL_PRODUCT_LOCALES,
} from './acquire-full-product-review-packet.mjs';

type ReviewPacket = {
  status: string; releaseEligible: boolean; signatureStatus: string;
  receiptSha256: string | null; receiptHmacSha256: string | null;
  blockers: string[];
  artifacts: Record<string, { status: string; artifactBytes: number | null; evidenceBytes: number | null; artifactSha256: string | null; evidenceSha256: string | null; reviewStatus: string }>;
};
type PacketBuilder = (options: { evidenceRoot: string; manifest?: ReturnType<typeof completeManifest>; buildId: string; head: string }) => ReviewPacket;
const buildPacket = buildI18nFullProductReviewPacket as unknown as PacketBuilder;

function completeManifest(root: string) {
  const artifacts = Object.fromEntries(I18N_FULL_PRODUCT_ARTIFACTS.map(kind => {
    const artifactPath = `${kind}/${kind}.artifact`;
    const evidencePath = `${kind}/${kind}.evidence.json`;
    const artifactBytes = Buffer.from(`${kind}-artifact-real`);
    const evidenceBytes = Buffer.from(JSON.stringify({ kind, executed: true, locales: I18N_FULL_PRODUCT_LOCALES }));
    mkdirSync(path.join(root, kind), { recursive: true });
    writeFileSync(path.join(root, artifactPath), artifactBytes);
    writeFileSync(path.join(root, evidencePath), evidenceBytes);
    return [kind, {
      status: 'PASS', synthetic: false, buildId: 'build-1', head: 'a'.repeat(40), locales: I18N_FULL_PRODUCT_LOCALES,
      artifactPath, evidencePath,
      execution: { status: 'PASS', executed: true, exitCode: 0 },
    }];
  }));
  return { buildId: 'build-1', head: 'a'.repeat(40), artifacts };
}

describe('i18n full-product artifact acquisition packet', () => {
  it('keeps all five surfaces NOT_RUN and the unsigned packet HOLD without a manifest', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-i18n-packet-'));
    const packet = buildPacket({ evidenceRoot: root, buildId: 'build-1', head: 'a'.repeat(40) });
    expect(packet).toMatchObject({ status: 'HOLD', releaseEligible: false, signatureStatus: 'UNSIGNED', receiptSha256: null, receiptHmacSha256: null });
    for (const kind of I18N_FULL_PRODUCT_ARTIFACTS) expect(packet.artifacts[kind].status).toBe('NOT_RUN');
    expect(packet.blockers).toContain('review_packet_unsigned');
  });

  it('binds real artifact/evidence bytes and SHA-256 but never self-issues approval or HMAC', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-i18n-packet-'));
    const packet = buildPacket({ evidenceRoot: root, manifest: completeManifest(root), buildId: 'build-1', head: 'a'.repeat(40) });
    expect(packet.status).toBe('HOLD');
    expect(packet.releaseEligible).toBe(false);
    for (const kind of I18N_FULL_PRODUCT_ARTIFACTS) {
      const item = packet.artifacts[kind];
      expect(item.status).toBe('PASS');
      expect(item.artifactBytes).toBeGreaterThan(0);
      expect(item.evidenceBytes).toBeGreaterThan(0);
      expect(item.artifactSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(item.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(item.reviewStatus).toBe('UNSIGNED');
    }
    expect(packet.receiptSha256).toBeNull();
    expect(packet.receiptHmacSha256).toBeNull();
    expect(packet.blockers).toContain('review_packet_unsigned');
  });

  it('rejects synthetic or unexecuted declarations as HOLD', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'nexyfab-i18n-packet-'));
    const manifest = completeManifest(root);
    manifest.artifacts.visual.synthetic = true;
    manifest.artifacts.email.execution = { status: 'NOT_RUN', executed: false, exitCode: -1 };
    const packet = buildPacket({ evidenceRoot: root, manifest, buildId: 'build-1', head: 'a'.repeat(40) });
    expect(packet.artifacts.visual.status).toBe('HOLD');
    expect(packet.artifacts.email.status).toBe('HOLD');
    expect(packet.status).toBe('HOLD');
  });
});
