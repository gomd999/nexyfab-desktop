import { generateKeyPairSync, createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadServerAgenticCommercialTrust } from './serverAgenticCommercialTrust';
function key() { return generateKeyPairSync('ed25519'); }
function entry(id: string, role: 'agent' | 'native_parser' | 'independent_verifier') { const pair = key(); const pem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(); return { identityId: id, role, publicKeyPem: pem, fingerprintSha256: createHash('sha256').update(pair.publicKey.export({ type: 'spki', format: 'der' })).digest('hex') }; }
describe('server agentic trust', () => {
  it('requires exactly three unique Ed25519 roles and ignores caller trust', () => {
    const original = process.env.NEXYFAB_AGENTIC_TRUST_REGISTRY_JSON;
    process.env.NEXYFAB_AGENTIC_TRUST_REGISTRY_JSON = JSON.stringify([entry('a', 'agent'), entry('p', 'native_parser'), entry('v', 'independent_verifier')]);
    const result = loadServerAgenticCommercialTrust();
    expect(result.ok).toBe(true); if (result.ok) expect(result.context.mode).toBe('runtime');
    process.env.NEXYFAB_AGENTIC_TRUST_REGISTRY_JSON = original;
  });
  it('fails closed for missing, duplicate, malformed and non-Ed25519 registry', () => {
    const original = process.env.NEXYFAB_AGENTIC_TRUST_REGISTRY_JSON;
    process.env.NEXYFAB_AGENTIC_TRUST_REGISTRY_JSON = JSON.stringify([entry('a', 'agent')]);
    expect(loadServerAgenticCommercialTrust().ok).toBe(false);
    process.env.NEXYFAB_AGENTIC_TRUST_REGISTRY_JSON = 'not-json';
    expect(loadServerAgenticCommercialTrust().ok).toBe(false);
    process.env.NEXYFAB_AGENTIC_TRUST_REGISTRY_JSON = original;
  });
  it('rejects private/unknown fields and oversized registries instead of retaining secret material', () => {
    const original = process.env.NEXYFAB_AGENTIC_TRUST_REGISTRY_JSON;
    process.env.NEXYFAB_AGENTIC_TRUST_REGISTRY_JSON = JSON.stringify([{ ...entry('a', 'agent'), privateKeyPem: 'secret' }, entry('p', 'native_parser'), entry('v', 'independent_verifier')]);
    expect(loadServerAgenticCommercialTrust()).toMatchObject({ ok: false });
    process.env.NEXYFAB_AGENTIC_TRUST_REGISTRY_JSON = ' '.repeat(70 * 1024);
    const oversized = loadServerAgenticCommercialTrust(); expect(oversized).toMatchObject({ ok: false });
    if (!oversized.ok) expect(oversized.issues).toContain('server_registry_size_exceeded');
    process.env.NEXYFAB_AGENTIC_TRUST_REGISTRY_JSON = original;
  });
});
