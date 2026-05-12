import { describe, it, expect } from 'vitest';
import { searchBosl2, bosl2EntryCount } from '../bosl2Index';

describe('BOSL2 index', () => {
  it('contains 20+ entries', () => {
    expect(bosl2EntryCount()).toBeGreaterThanOrEqual(20);
  });

  it('exact name match scores highest', () => {
    const hits = searchBosl2('spur_gear', 1);
    expect(hits[0]?.name).toBe('spur_gear');
  });

  it('keyword match returns the related entry', () => {
    const hits = searchBosl2('thread', 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map(h => h.name).join(',')).toMatch(/thread/i);
  });

  it('no match returns empty', () => {
    expect(searchBosl2('xyznonexistent12345')).toEqual([]);
  });

  it('respects limit', () => {
    const hits = searchBosl2('gear', 1);
    expect(hits.length).toBe(1);
  });

  it('multi-token query OR-combines', () => {
    const hits = searchBosl2('hex nut', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some(h => h.name === 'threaded_nut')).toBe(true);
  });
});
