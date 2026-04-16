import { describe, it, expect } from 'vitest';
import { sanitizeText, sanitizeObject, escapeHtml } from '../sanitize';

describe('sanitizeText', () => {
  it('returns empty string for non-string input', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
    expect(sanitizeText(123)).toBe('');
    expect(sanitizeText({})).toBe('');
  });

  it('trims whitespace', () => {
    expect(sanitizeText('  hello  ')).toBe('hello');
  });

  it('returns plain text unchanged', () => {
    expect(sanitizeText('Hello World')).toBe('Hello World');
  });

  it('strips <script> tags and content', () => {
    expect(sanitizeText('<script>alert("xss")</script>')).toBe('');
    expect(sanitizeText('before<script>evil()</script>after')).toBe('beforeafter');
  });

  it('strips <iframe> tags', () => {
    const result = sanitizeText('<iframe src="evil.com"></iframe>');
    expect(result).not.toContain('<iframe');
    expect(result).not.toContain('evil.com');
  });

  it('strips javascript: protocol', () => {
    expect(sanitizeText('javascript:alert(1)')).toBe('alert(1)');
  });

  it('strips event handler attributes', () => {
    expect(sanitizeText('<div onclick=alert(1)>hi</div>')).toBe('hi');
  });

  it('strips encoded HTML entities that reveal tags', () => {
    const result = sanitizeText('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('</script');
  });

  it('strips data:text/html payloads', () => {
    expect(sanitizeText('data:text/html,<h1>xss</h1>')).toBe(',xss');
  });

  it('handles empty string', () => {
    expect(sanitizeText('')).toBe('');
  });

  it('strips nested/mixed dangerous tags', () => {
    const input = '<object><embed src="x"></embed></object>';
    const result = sanitizeText(input);
    expect(result).not.toContain('<object');
    expect(result).not.toContain('<embed');
  });
});

describe('sanitizeObject', () => {
  it('sanitizes string fields in an object', () => {
    const obj = { name: '<script>x</script>hello', count: 5 };
    const result = sanitizeObject(obj);
    expect(result.name).toBe('hello');
    expect(result.count).toBe(5);
  });

  it('leaves non-string fields unchanged', () => {
    const obj = { flag: true, num: 42, arr: [1, 2] };
    const result = sanitizeObject(obj as any);
    expect(result.flag).toBe(true);
    expect(result.num).toBe(42);
    expect(result.arr).toEqual([1, 2]);
  });

  it('does not mutate the original object', () => {
    const obj = { name: '<b>bold</b>' };
    const result = sanitizeObject(obj);
    expect(obj.name).toBe('<b>bold</b>');
    expect(result.name).toBe('bold');
  });
});

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes quotes', () => {
    expect(escapeHtml('"hello" & \'world\'')).toBe('&quot;hello&quot; &amp; &#x27;world&#x27;');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('plain text')).toBe('plain text');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});
