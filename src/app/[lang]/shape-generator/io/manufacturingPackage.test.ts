import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

const downloaded: Array<{ name: string; blob: Blob }> = [];
vi.mock('@/lib/platform', () => ({ downloadBlob: vi.fn(async (name: string, blob: Blob) => { downloaded.push({ name, blob }); }) }));
import { unzipSync, strFromU8 } from 'fflate';
import { exportManufacturingZipBundle } from './manufacturingPackage';

describe('immutable manufacturing package v3', () => {
  it('hashes every pre-manifest artifact and binds release evidence', async () => {
    downloaded.length = 0;
    const sha = 'a'.repeat(64);
    await exportManufacturingZipBundle(new THREE.BoxGeometry(10, 10, 10), 'part', {
      partLabel: 'Part', bbox: { w: 10, h: 10, d: 10 }, volume_cm3: 1, surface_area_cm2: 6,
      unitSystem: 'mm', generatedAt: '2026-08-09T00:00:00.000Z',
      releaseEvidence: {
        revisionManifestSha256: sha, kernelStackIdentitySha256: sha, kernelEvidenceSha256: sha,
        drawingStatus: 'pass', pmiStatus: 'verified', workflowStatus: 'manufacturing_or_construction_approved',
        deliverableDecision: {
          status: 'pass', purpose: 'manufacturing_or_construction', workflowStatus: 'manufacturing_or_construction_approved',
          roundtripEvidenceSha256: sha, validReviewerIds: ['domain-expert', 'independent-expert'], blockers: [],
        },
      },
    }, undefined, 'ISO-10303-21;\nEND-ISO-10303-21;');
    const zip = unzipSync(new Uint8Array(await downloaded[0]!.blob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(zip['part-manufacturing.json']!));
    expect(manifest.nexyfabManufacturingManifestVersion).toBe(3);
    expect(manifest.releaseDecision).toEqual({ status: 'pass', purpose: 'manufacturing_or_construction', workflowStatus: 'manufacturing_or_construction_approved', blockers: [] });
    expect(manifest.packageContentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.immutableArtifacts).toHaveLength(3);
    expect(manifest.immutableArtifacts.every((item: { sha256: string }) => /^[a-f0-9]{64}$/.test(item.sha256))).toBe(true);
  });

  it('blocks a handoff without release evidence before any download', async () => {
    downloaded.length = 0;
    await expect(exportManufacturingZipBundle(new THREE.BoxGeometry(1, 1, 1), 'legacy', {
      partLabel: 'Legacy', bbox: { w: 1, h: 1, d: 1 }, volume_cm3: 0.001, surface_area_cm2: 0.06, unitSystem: 'mm', generatedAt: '2026-08-09T00:00:00.000Z',
    }, undefined, 'ISO-10303-21;\nEND-ISO-10303-21;', {})).rejects.toThrow('MANUFACTURING_EXPORT_BLOCKED:release-evidence-missing-or-invalid');
    expect(downloaded).toHaveLength(0);
  });

  it('rejects zip traversal and reserved artifact replacement', async () => {
    const meta = { partLabel: 'P', bbox: { w: 1, h: 1, d: 1 }, volume_cm3: 1, surface_area_cm2: 1, unitSystem: 'mm' as const, generatedAt: '2026-08-09T00:00:00.000Z' };
    await expect(exportManufacturingZipBundle(new THREE.BoxGeometry(1, 1, 1), 'part', meta, undefined, 'STEP', { '../escape.json': new Uint8Array([1]) })).rejects.toThrow('MANUFACTURING_PACKAGE_ARTIFACT_NAME_INVALID');
    await expect(exportManufacturingZipBundle(new THREE.BoxGeometry(1, 1, 1), 'part', meta, undefined, 'STEP', { 'part.step': new Uint8Array([1]) })).rejects.toThrow('MANUFACTURING_PACKAGE_ARTIFACT_RESERVED');
  });
});
