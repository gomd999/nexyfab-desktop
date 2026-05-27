import { describe, it, expect } from 'vitest';
import { classifyError } from './errorClassifier';

describe('classifyError', () => {
  it('classifies network errors as transient + autoRetry', () => {
    const r = classifyError(new Error('Network request failed'));
    expect(r.severity).toBe('transient');
    expect(r.autoRetry).toBe(true);
  });

  it('classifies timeout as transient', () => {
    const r = classifyError(new Error('Operation timeout'));
    expect(r.severity).toBe('transient');
  });

  it('classifies HTTP 5xx as transient', () => {
    const r = classifyError(new Error('HTTP 503 Service Unavailable'));
    expect(r.severity).toBe('transient');
  });

  it('classifies WASM crashes as recoverable + wasm surface', () => {
    const r = classifyError(new Error('OCCT wasm memory access out of bounds'));
    expect(r.severity).toBe('recoverable');
    expect(r.surface).toBe('wasm');
  });

  it('classifies AI provider errors as recoverable + ai surface', () => {
    const r = classifyError(new Error('Anthropic rate limit exceeded'));
    expect(r.severity).toBe('recoverable');
    expect(r.surface).toBe('ai');
  });

  it('classifies unknown errors as fatal', () => {
    const r = classifyError(new Error('Something exotic broke'));
    expect(r.severity).toBe('fatal');
  });

  it('honors surface hint for panel errors', () => {
    const r = classifyError(new Error('Render exception'), { surface: 'panel' });
    expect(r.severity).toBe('recoverable');
    expect(r.surface).toBe('panel');
  });

  it('handles string errors', () => {
    const r = classifyError('some random failure');
    expect(r.surface).toBe('unknown');
  });

  it('handles non-Error values without throwing', () => {
    const r = classifyError({ weird: 'object' });
    expect(r.severity).toBeDefined();
  });

  it('sentryTag includes surface', () => {
    const r = classifyError(new Error('network down'));
    expect(r.sentryTag).toMatch(/^error\.transient\./);
  });

  it('auto-retry only for transient', () => {
    expect(classifyError(new Error('network')).autoRetry).toBe(true);
    expect(classifyError(new Error('wasm bad')).autoRetry).toBe(false);
  });
});
