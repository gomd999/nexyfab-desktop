import { describe, it, expect } from 'vitest';
import { emitGcode } from './gcodeEmitter';
import type { ToolpathSegment } from './pocketToolpath';

const sample: ToolpathSegment[] = [
  { kind: 'rapid',  start: [0, 0, 5], end: [10, 0, 5] },
  { kind: 'plunge', start: [10, 0, 5], end: [10, 0, -2] },
  { kind: 'feed',   start: [10, 0, -2], end: [20, 0, -2] },
  { kind: 'rapid',  start: [20, 0, -2], end: [20, 0, 5] },
];

describe('emitGcode · header + footer', () => {
  it('starts with G17 / G21 / G90 / G94 (or G20 in inch mode)', () => {
    const code = emitGcode(sample);
    expect(code).toContain('G17');
    expect(code).toContain('G21');
    expect(code).toContain('G90');
    expect(code).toContain('G94');
  });

  it('switches to G20 in inch mode', () => {
    const code = emitGcode(sample, { units: 'inch' });
    expect(code).toContain('G20');
    expect(code).not.toContain('G21');
  });

  it('ends with M5 + M30', () => {
    const code = emitGcode(sample);
    const tail = code.trim().split('\n').slice(-2);
    expect(tail).toEqual(['M5', 'M30']);
  });
});

describe('emitGcode · motion codes', () => {
  it('emits G0 for rapid moves', () => {
    const code = emitGcode(sample);
    expect(code).toMatch(/G0 X10\.000 Y0\.000 Z5\.000/);
  });

  it('emits G1 for feed and plunge moves', () => {
    const code = emitGcode(sample);
    expect(code).toMatch(/G1 X10\.000 Y0\.000 Z-2\.000/);
    expect(code).toMatch(/G1 X20\.000 Y0\.000 Z-2\.000/);
  });

  it('emits F word on first feed motion', () => {
    const code = emitGcode(sample, { cutFeedMmPerMin: 1500 });
    expect(code).toMatch(/F\d+/);
  });
});

describe('emitGcode · header values', () => {
  it('uses supplied spindle RPM in S word', () => {
    const code = emitGcode(sample, { spindleRpm: 12000 });
    expect(code).toContain('S12000 M3');
  });

  it('uses supplied tool number', () => {
    const code = emitGcode(sample, { toolNumber: 7 });
    expect(code).toContain('T7 M6');
  });

  it('respects precision option', () => {
    const code = emitGcode(sample, { precision: 1 });
    expect(code).toMatch(/X10\.0 Y0\.0 Z5\.0/);
  });
});

describe('emitGcode · safety + provenance', () => {
  it('includes the NexyFab preview banner comment', () => {
    const code = emitGcode(sample);
    expect(code).toContain('NexyFab CAM preview');
    expect(code).toContain('Preview-grade');
  });
});
