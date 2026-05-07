// Unit tests for XSS sanitization
import { describe, it, expect } from 'vitest';
import { sanitizeText, escapeHtml, sanitizeObject } from './sanitize';

describe('sanitizeText', () => {
  it('removes script tags', () => {
    expect(sanitizeText('<script>alert(1)</script>')).not.toContain('script');
    expect(sanitizeText('<script>alert(1)</script>')).not.toContain('alert');
  });

  it('removes onclick handlers', () => {
    expect(sanitizeText('<div onclick="evil()">text</div>')).not.toContain('onclick');
  });

  it('removes javascript: protocol', () => {
    expect(sanitizeText('javascript:alert(1)')).not.toContain('javascript:');
  });

  it('handles encoded XSS', () => {
    const encoded = '&lt;script&gt;alert(1)&lt;/script&gt;';
    expect(sanitizeText(encoded)).not.toContain('script');
  });

  it('preserves normal text', () => {
    expect(sanitizeText('Hello World')).toBe('Hello World');
    expect(sanitizeText('Project Alpha-1')).toBe('Project Alpha-1');
    expect(sanitizeText('Steel 304 (2mm)')).toBe('Steel 304 (2mm)');
  });

  it('handles non-string input', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
    expect(sanitizeText(123)).toBe('');
  });

  it('trims whitespace', () => {
    expect(sanitizeText('  hello  ')).toBe('hello');
  });
});

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;');
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(escapeHtml("it's")).toBe("it&#x27;s");
  });
});

describe('sanitizeObject', () => {
  it('sanitizes string values in object', () => {
    const input = { name: '<script>evil</script>Project', count: 5, active: true };
    const result = sanitizeObject(input);
    expect(result.name).not.toContain('script');
    expect(result.count).toBe(5);
    expect(result.active).toBe(true);
  });
});
