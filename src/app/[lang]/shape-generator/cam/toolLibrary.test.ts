import { describe, it, expect } from 'vitest';
import {
  TOOL_LIBRARY,
  findTool,
  listTools,
  recommendFeedSpeed,
} from './toolLibrary';

describe('TOOL_LIBRARY · catalogue shape', () => {
  it('ships at least 1 tool per family', () => {
    expect(listTools('endmill').length).toBeGreaterThan(0);
    expect(listTools('drill').length).toBeGreaterThan(0);
    expect(listTools('faceMill').length).toBeGreaterThan(0);
  });

  it('tool ids are unique', () => {
    const ids = TOOL_LIBRARY.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every tool has positive diameter + flute count', () => {
    for (const t of TOOL_LIBRARY) {
      expect(t.diameter).toBeGreaterThan(0);
      expect(t.flutes).toBeGreaterThan(0);
      expect(t.maxDepthOfCutMm).toBeGreaterThan(0);
    }
  });
});

describe('findTool', () => {
  it('returns the matching tool', () => {
    expect(findTool('em-6mm-2f')?.diameter).toBe(6);
  });

  it('returns null for unknown id', () => {
    expect(findTool('ghost')).toBeNull();
  });
});

describe('listTools', () => {
  it('returns the whole catalogue when no family given', () => {
    expect(listTools().length).toBe(TOOL_LIBRARY.length);
  });

  it('filters by family', () => {
    const drills = listTools('drill');
    expect(drills.length).toBeGreaterThan(0);
    expect(drills.every(t => t.family === 'drill')).toBe(true);
  });
});

describe('recommendFeedSpeed', () => {
  it('returns higher RPM for smaller tools (same material)', () => {
    const small = recommendFeedSpeed(findTool('em-1mm-2f')!, 'aluminum');
    const large = recommendFeedSpeed(findTool('em-10mm-4f')!, 'aluminum');
    expect(small.spindleRpm).toBeGreaterThan(large.spindleRpm);
  });

  it('returns higher RPM for soft materials (same tool)', () => {
    const tool = findTool('em-6mm-2f')!;
    const inAl = recommendFeedSpeed(tool, 'aluminum');
    const inSteel = recommendFeedSpeed(tool, 'mildSteel');
    expect(inAl.spindleRpm).toBeGreaterThan(inSteel.spindleRpm);
  });

  it('feed scales with flute count', () => {
    const t2f = findTool('em-6mm-2f')!;
    const t4f = findTool('em-6mm-4f')!;
    const f2 = recommendFeedSpeed(t2f, 'aluminum');
    const f4 = recommendFeedSpeed(t4f, 'aluminum');
    expect(f4.feedMmPerMin).toBeGreaterThan(f2.feedMmPerMin);
  });

  it('produces non-zero feed + RPM for every supported material', () => {
    const tool = findTool('em-3mm-2f')!;
    for (const m of ['aluminum', 'mildSteel', 'stainless304', 'abs', 'wood'] as const) {
      const r = recommendFeedSpeed(tool, m);
      expect(r.feedMmPerMin).toBeGreaterThan(0);
      expect(r.spindleRpm).toBeGreaterThan(0);
    }
  });
});
