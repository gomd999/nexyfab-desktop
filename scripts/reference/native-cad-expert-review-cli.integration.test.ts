import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { nativeCadSignoffPayload, type NativeCadExpertSignoff } from '../../src/lib/reference/nativeCadExpertReview';
import { serializeNativeCadUnsignedSignoff } from '../../src/lib/reference/nativeCadReviewClient';
import type { NativeCadExpertReviewPacket } from '../../src/lib/reference/nativeCadExpertReviewPacket';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const runTsx = (script: string, args: string[], env?: Record<string, string>) => spawnSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve(script), ...args], { cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8' });

describe('native CAD expert review CLI', () => {
  it('creates a non-approving immutable packet and validates two offline signatures', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-native-review-')); roots.push(root);
    const claimPath = path.join(root, 'claim.json'), inputPath = path.join(root, 'verification.json'), packetDir = path.join(root, 'packets');
    fs.writeFileSync(claimPath, JSON.stringify({ provenance: 'native-cad', semanticsComplete: true, sourceHash: 'a'.repeat(64), artifactHashes: ['b'.repeat(64)], jointDefinitionHash: 'c'.repeat(64), revision: 1 }));
    fs.writeFileSync(inputPath, JSON.stringify({ state: { parts: [{ id: 'part-1' }], mates: [] }, animation: { tracks: [] }, localBoxes: {}, featureTrees: {} }));
    const built = runTsx('scripts/reference/build-native-cad-expert-review-packet.ts', [claimPath, inputPath, packetDir]);
    expect(built.status, built.stderr).toBe(0);
    const builtResult = JSON.parse(built.stdout.trim()) as { packet: string; approvalGranted: boolean };
    expect(builtResult.approvalGranted).toBe(false);
    const packet = JSON.parse(fs.readFileSync(path.join(packetDir, builtResult.packet), 'utf8')) as NativeCadExpertReviewPacket;
    const reviewers = ['domain', 'independent'].map(reviewerId => ({ reviewerId, ...generateKeyPairSync('ed25519') }));
    const responseDir = path.join(root, 'responses');
    const signoffs = reviewers.map((item, index) => {
      const role = (index ? 'independent-reviewer' : 'domain-reviewer') as NativeCadExpertSignoff['role'];
      const unsigned = { role, reviewerId: item.reviewerId, decision: 'approved' as const, reviewedAt: '2026-08-01T00:00:00.000Z', targetHash: packet.targetHash };
      const payloadPath = path.join(root, `${role}.payload.json`), signaturePath = path.join(root, `${role}.signature.txt`);
      fs.writeFileSync(payloadPath, serializeNativeCadUnsignedSignoff(unsigned));
      fs.writeFileSync(signaturePath, sign(null, Buffer.from(nativeCadSignoffPayload(unsigned)), item.privateKey).toString('base64'));
      const wrapped = runTsx('scripts/reference/wrap-native-cad-signature-response.ts', [payloadPath, signaturePath, responseDir]);
      expect(wrapped.status, wrapped.stderr).toBe(0);
      const wrappedResult = JSON.parse(wrapped.stdout.trim()) as { response: string; cryptographicallyVerified: boolean };
      expect(wrappedResult.cryptographicallyVerified).toBe(false);
      return (JSON.parse(fs.readFileSync(path.join(responseDir, wrappedResult.response), 'utf8')) as { signoff: NativeCadExpertSignoff }).signoff;
    });
    const reviewPath = path.join(root, 'review.json'), validationPath = path.join(root, 'validation.json');
    fs.writeFileSync(reviewPath, JSON.stringify({ schema: 'nexyfab.native-cad-expert-review.v1', target: packet.target, signoffs }));
    const trusted = Object.fromEntries(reviewers.map((item, index) => [item.reviewerId, { publicKey: item.publicKey.export({ type: 'spki', format: 'pem' }).toString(), roles: [index ? 'independent-reviewer' : 'domain-reviewer'] }]));
    const validated = runTsx('scripts/reference/validate-native-cad-expert-review.ts', [path.join(packetDir, builtResult.packet), reviewPath, validationPath], { NEXYFAB_CAD_REVIEWER_KEYS: JSON.stringify(trusted) });
    expect(validated.status, validated.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(validationPath, 'utf8'))).toMatchObject({ schema: 'nexyfab.native-cad-expert-review-validation.v1', trustedReviewerKeyCount: 2, approved: true, errors: [] });
  });
  it('refuses to wrap a reformatted payload whose signed bytes would differ', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-native-review-noncanonical-')); roots.push(root);
    const payload = { decision: 'approved', reviewedAt: '2026-08-01T00:00:00.000Z', reviewerId: 'domain', role: 'domain-reviewer', targetHash: 'a'.repeat(64) };
    const payloadPath = path.join(root, 'payload.json'), signaturePath = path.join(root, 'signature.txt');
    fs.writeFileSync(payloadPath, JSON.stringify(payload, null, 2)); fs.writeFileSync(signaturePath, `${'A'.repeat(86)}==`);
    const wrapped = runTsx('scripts/reference/wrap-native-cad-signature-response.ts', [payloadPath, signaturePath, path.join(root, 'responses')]);
    expect(wrapped.status).not.toBe(0); expect(wrapped.stderr).toContain('signing_payload_not_canonical_exact_bytes');
  });
});
