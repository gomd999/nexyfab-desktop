import { describe, it, expect, beforeEach, vi } from 'vitest';

class MemStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
}

const memStorage = new MemStorage();
vi.stubGlobal('sessionStorage', memStorage);
vi.stubGlobal('window', { sessionStorage: memStorage, location: { href: '' } });

import { captureUtmFromUrl, getUtm, clearUtm } from '../utm-tracker';

describe('utm-tracker', () => {
  beforeEach(() => { memStorage.clear(); });

  it('captures and persists utm_source/medium/campaign', () => {
    const r = captureUtmFromUrl('https://nexyfab.com/?utm_source=google&utm_medium=cpc&utm_campaign=launch');
    expect(r).toMatchObject({ source: 'google', medium: 'cpc', campaign: 'launch' });
    expect(getUtm()).toMatchObject({ source: 'google', medium: 'cpc', campaign: 'launch' });
  });

  it('first-touch wins — second URL with different UTM is ignored', () => {
    captureUtmFromUrl('https://nexyfab.com/?utm_source=google');
    captureUtmFromUrl('https://nexyfab.com/?utm_source=naver');
    expect(getUtm()?.source).toBe('google');
  });

  it('returns existing record when current URL has no UTM', () => {
    captureUtmFromUrl('https://nexyfab.com/?utm_source=facebook');
    const r = captureUtmFromUrl('https://nexyfab.com/dashboard');
    expect(r?.source).toBe('facebook');
  });

  it('returns null when no UTM ever captured and URL has none', () => {
    const r = captureUtmFromUrl('https://nexyfab.com/');
    expect(r).toBeNull();
    expect(getUtm()).toBeNull();
  });

  it('caps overlong values at 200 chars', () => {
    const big = 'x'.repeat(500);
    captureUtmFromUrl(`https://nexyfab.com/?utm_source=${big}`);
    expect(getUtm()?.source?.length).toBe(200);
  });

  it('rejects malformed URLs without crashing', () => {
    expect(captureUtmFromUrl('not-a-url')).toBeNull();
    expect(getUtm()).toBeNull();
  });

  it('clearUtm removes the stored record', () => {
    captureUtmFromUrl('https://nexyfab.com/?utm_source=google');
    clearUtm();
    expect(getUtm()).toBeNull();
  });

  it('captures all 5 UTM keys when present', () => {
    captureUtmFromUrl('https://nexyfab.com/?utm_source=g&utm_medium=cpc&utm_campaign=c1&utm_term=cnc&utm_content=ad-a');
    const r = getUtm();
    expect(r).toMatchObject({ source: 'g', medium: 'cpc', campaign: 'c1', term: 'cnc', content: 'ad-a' });
  });

  it('preserves spaces and hyphens (campaign IDs use them)', () => {
    captureUtmFromUrl('https://nexyfab.com/?utm_campaign=launch-2026');
    expect(getUtm()?.campaign).toBe('launch-2026');
  });
});
