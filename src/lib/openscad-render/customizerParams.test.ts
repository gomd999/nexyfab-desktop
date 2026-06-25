import { describe, it, expect } from 'vitest';
import { parseCustomizerParams, applyCustomizerValue } from './customizerParams';

// A representative slice of the CADAM car output (real free-form OpenSCAD).
const CAR = `include <BOSL2/std.scad>

/* [Car Dimensions] */
// Total length of the car body
car_length = 130;      // [100:5:200]
// Width of the car body
car_width = 60;        // [40:2:100]
ride_height = 8;       // [2:1:20]

/* [Options] */
// Add a rear spoiler
has_spoiler = true;

/* [Colors] */
body_color = "Tomato";
window_color = "#151515";

$fn = 48;

module car() {
    cuboid([car_length, car_width, 20]);
}
car();`;

describe('parseCustomizerParams', () => {
  it('parses [min:step:max] sliders with group + description', () => {
    const ps = parseCustomizerParams(CAR);
    const len = ps.find(p => p.name === 'car_length')!;
    expect(len.kind).toBe('slider');
    expect(len.value).toBe(130);
    expect(len.min).toBe(100);
    expect(len.step).toBe(5);
    expect(len.max).toBe(200);
    expect(len.group).toBe('Car Dimensions');
    expect(len.description).toBe('Total length of the car body');
  });

  it('parses a boolean as a checkbox', () => {
    const ps = parseCustomizerParams(CAR);
    const sp = ps.find(p => p.name === 'has_spoiler')!;
    expect(sp.kind).toBe('bool');
    expect(sp.value).toBe(true);
    expect(sp.group).toBe('Options');
  });

  it('parses string/colour params', () => {
    const ps = parseCustomizerParams(CAR);
    const col = ps.find(p => p.name === 'body_color')!;
    expect(col.kind).toBe('string');
    expect(col.value).toBe('Tomato');
    expect(col.group).toBe('Colors');
  });

  it('skips $fn and stops at module code (no geometry vars leak in)', () => {
    const ps = parseCustomizerParams(CAR);
    expect(ps.some(p => p.name === '$fn')).toBe(false);
    expect(ps.map(p => p.name)).toEqual(['car_length', 'car_width', 'ride_height', 'has_spoiler', 'body_color', 'window_color']);
  });

  it('parses a 2-value [min:max] range (step defaults to 1)', () => {
    const ps = parseCustomizerParams('x = 10; // [0:50]');
    expect(ps[0]).toMatchObject({ kind: 'slider', min: 0, max: 50, step: 1, value: 10 });
  });

  it('parses a dropdown', () => {
    const ps = parseCustomizerParams('mat = "steel"; // [steel, alu, brass]');
    expect(ps[0]!.kind).toBe('dropdown');
    expect(ps[0]!.options).toEqual(['steel', 'alu', 'brass']);
  });

  it('gives unannotated numbers a heuristic slider so they stay adjustable', () => {
    const ps = parseCustomizerParams('thickness = 4;\nmodule m(){}');
    expect(ps[0]).toMatchObject({ name: 'thickness', kind: 'slider', value: 4 });
    expect(ps[0]!.max).toBeGreaterThan(4);
  });
});

describe('applyCustomizerValue', () => {
  it('rewrites a number, preserving the annotation comment', () => {
    const out = applyCustomizerValue(CAR, 'car_length', 155);
    expect(out).toMatch(/car_length\s*=\s*155;\s*\/\/ \[100:5:200\]/);
    // unrelated lines untouched
    expect(out).toMatch(/car_width\s*=\s*60;/);
  });

  it('rewrites a boolean', () => {
    const out = applyCustomizerValue(CAR, 'has_spoiler', false);
    expect(out).toMatch(/has_spoiler\s*=\s*false;/);
  });

  it('rewrites a string with quotes', () => {
    const out = applyCustomizerValue(CAR, 'body_color', 'SteelBlue');
    expect(out).toMatch(/body_color\s*=\s*"SteelBlue";/);
  });

  it('round-trips: parse → change → re-parse reflects the new value', () => {
    const changed = applyCustomizerValue(CAR, 'car_length', 180);
    const reparsed = parseCustomizerParams(changed);
    expect(reparsed.find(p => p.name === 'car_length')!.value).toBe(180);
  });

  it('leaves SCAD unchanged when the name is absent', () => {
    expect(applyCustomizerValue(CAR, 'nonexistent', 5)).toBe(CAR);
  });
});
