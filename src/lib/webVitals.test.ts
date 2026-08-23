import { describe, expect, it } from 'vitest';
import { normalizeWebVitalRoute, parseWebVitalPayload } from './webVitals';

describe('web vital payload privacy boundary', () => {
  it('removes query strings and redacts dynamic route identifiers', () => {
    expect(normalizeWebVitalRoute('/kr/nexyfab/projects/550e8400-e29b-41d4-a716-446655440000?token=secret'))
      .toBe('/kr/nexyfab/projects/:id');
    expect(normalizeWebVitalRoute('/view/customer@example.com#details')).toBe('/view/:id');
  });

  it('accepts only bounded Core Web Vitals fields', () => {
    expect(parseWebVitalPayload({
      name: 'LCP', value: 2100, delta: 2100, rating: 'good', route: '/kr/', device: 'mobile',
      navigationType: 'navigate', prompt: 'must not survive',
    })).toEqual({
      name: 'LCP', value: 2100, delta: 2100, rating: 'good', route: '/kr', device: 'mobile',
      navigationType: 'navigate',
    });
    expect(parseWebVitalPayload({ name: 'TTFB', value: 10, delta: 10, rating: 'good', route: '/', device: 'desktop' })).toBeNull();
    expect(parseWebVitalPayload({ name: 'CLS', value: 99, delta: 1, rating: 'poor', route: '/', device: 'desktop' })).toBeNull();
  });

  it('keeps very slow but valid duration samples inside the abuse boundary', () => {
    expect(parseWebVitalPayload({
      name: 'LCP', value: 124_464, delta: 124_464, rating: 'poor', route: '/en/shape-generator/', device: 'desktop',
    })).toMatchObject({ name: 'LCP', value: 124_464, delta: 124_464, rating: 'poor' });
    expect(parseWebVitalPayload({
      name: 'LCP', value: 600_001, delta: 600_001, rating: 'poor', route: '/', device: 'desktop',
    })).toBeNull();
  });
});
