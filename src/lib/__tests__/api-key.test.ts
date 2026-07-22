import { describe, it, expect } from 'vitest';
import {
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
  API_KEY_PREFIX,
  API_KEY_DISPLAY_PREFIX_LEN,
} from '../api-key';

describe('api-key helpers', () => {
  it('generates an nf_live_ key whose stored hash matches a re-hash of the raw key', () => {
    const { raw, hash, prefix } = generateApiKey();
    expect(raw.startsWith(API_KEY_PREFIX)).toBe(true);
    // hash round-trip: authenticating side re-hashes the presented raw key
    expect(hashApiKey(raw)).toBe(hash);
    // prefix is the display-only leading slice, not the secret
    expect(prefix.length).toBe(API_KEY_DISPLAY_PREFIX_LEN);
    expect(raw.startsWith(prefix)).toBe(true);
  });

  it('never lets the stored artifacts reveal the secret', () => {
    const { raw, hash, prefix } = generateApiKey();
    // The stored hash must not contain / equal the raw secret
    expect(hash).not.toBe(raw);
    expect(hash).not.toContain(raw);
    // The prefix is short and cannot reconstruct the 64-hex-char body
    expect(prefix.length).toBeLessThan(raw.length);
    // sha256 hex is 64 chars, deterministic
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces unique keys and unique hashes across calls', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
    expect(a.prefix).not.toBe(b.prefix); // 8 random hex after nf_live_ => effectively unique
  });

  it('hashApiKey is stable for the same input (so revoke/lookup by hash works)', () => {
    const raw = 'nf_live_deadbeef';
    expect(hashApiKey(raw)).toBe(hashApiKey(raw));
  });

  it('looksLikeApiKey accepts live keys and rejects sessions/garbage', () => {
    const { raw } = generateApiKey();
    expect(looksLikeApiKey(raw)).toBe(true);
    expect(looksLikeApiKey('eyJhbGciOi.session.jwt')).toBe(false);
    expect(looksLikeApiKey('nf_live_')).toBe(false); // prefix only, too short
    expect(looksLikeApiKey(null)).toBe(false);
    expect(looksLikeApiKey(undefined)).toBe(false);
  });
});
