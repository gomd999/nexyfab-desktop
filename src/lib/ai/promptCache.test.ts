import { describe, it, expect } from 'vitest';
import { PromptCache, normalizePrompt, buildCacheKey } from './promptCache';

describe('normalizePrompt', () => {
  it('lowercases + collapses whitespace', () => {
    expect(normalizePrompt('  Hello   WORLD  ')).toBe('hello world');
  });
});

describe('buildCacheKey', () => {
  it('groups equivalent prompts under the same key', () => {
    const a = buildCacheKey({ prompt: '50mm cube', provider: 'p', model: 'm', temperature: 0.5 });
    const b = buildCacheKey({ prompt: '50MM CUBE', provider: 'p', model: 'm', temperature: 0.5 });
    expect(a).toBe(b);
  });

  it('separates by provider', () => {
    const a = buildCacheKey({ prompt: 'x', provider: 'p1', model: 'm', temperature: 0 });
    const b = buildCacheKey({ prompt: 'x', provider: 'p2', model: 'm', temperature: 0 });
    expect(a).not.toBe(b);
  });

  it('rounds temperature to 2 decimals', () => {
    const a = buildCacheKey({ prompt: 'x', provider: 'p', model: 'm', temperature: 0.50001 });
    const b = buildCacheKey({ prompt: 'x', provider: 'p', model: 'm', temperature: 0.5 });
    expect(a).toBe(b);
  });
});

describe('PromptCache', () => {
  it('stores + retrieves a value', () => {
    const c = new PromptCache<string>();
    c.set('k1', 'v1');
    expect(c.get('k1')).toBe('v1');
  });

  it('returns null on miss', () => {
    const c = new PromptCache<string>();
    expect(c.get('missing')).toBeNull();
  });

  it('increments hits on retrieval', () => {
    const c = new PromptCache<string>();
    c.set('k1', 'v1');
    c.get('k1');
    c.get('k1');
    const top = c.topEntries(1);
    expect(top[0]!.hits).toBe(2);
  });

  it('evicts oldest when maxEntries exceeded', () => {
    const c = new PromptCache<string>({ maxEntries: 2 });
    c.set('a', '1');
    c.set('b', '2');
    c.set('c', '3'); // evicts a
    expect(c.get('a')).toBeNull();
    expect(c.get('b')).toBe('2');
    expect(c.get('c')).toBe('3');
  });

  it('LRU: accessing entry moves it to most-recently-used', () => {
    const c = new PromptCache<string>({ maxEntries: 2 });
    c.set('a', '1');
    c.set('b', '2');
    c.get('a');     // bumps a to MRU
    c.set('c', '3'); // should evict b, not a
    expect(c.get('a')).toBe('1');
    expect(c.get('b')).toBeNull();
  });

  it('evicts on byte budget overrun', () => {
    const c = new PromptCache<string>({ maxBytes: 20 });
    c.set('a', 'x'.repeat(8)); // ~16 bytes
    c.set('b', 'y'.repeat(8)); // ~16 bytes — evicts a
    expect(c.get('a')).toBeNull();
  });

  it('overwriting same key updates bytes correctly', () => {
    const c = new PromptCache<string>();
    c.set('k', 'short');
    c.set('k', 'longer string');
    expect(c.size()).toBe(1);
    expect(c.get('k')).toBe('longer string');
  });

  it('clear() empties cache', () => {
    const c = new PromptCache<string>();
    c.set('a', '1');
    c.set('b', '2');
    c.clear();
    expect(c.size()).toBe(0);
    expect(c.totalBytes()).toBe(0);
  });

  it('delete returns false for unknown key', () => {
    const c = new PromptCache<string>();
    expect(c.delete('phantom')).toBe(false);
  });
});
