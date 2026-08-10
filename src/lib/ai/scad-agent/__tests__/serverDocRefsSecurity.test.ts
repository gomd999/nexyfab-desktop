import { describe, expect, it, vi } from 'vitest';
import { serverDocRefAdapter } from '../serverDocRefs';

describe('server document reference boundary', () => {
  it('does not fetch model-controlled URLs', async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    try {
      const result = await serverDocRefAdapter.resolve({ source: 'http://169.254.169.254/latest/meta-data/' });
      expect(result.ok).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not read model-controlled local paths', async () => {
    const result = await serverDocRefAdapter.resolve({ source: 'C:\\Windows\\System32\\drivers\\etc\\hosts' });
    expect(result.ok).toBe(false);
  });
});
