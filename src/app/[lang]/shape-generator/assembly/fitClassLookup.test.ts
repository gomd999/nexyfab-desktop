import { describe, it, expect } from 'vitest';
import {
  evaluateFit,
  recommendFit,
  toleranceBudget,
  summarize,
  FIT_TABLE,
} from './fitClassLookup';

describe('FIT_TABLE', () => {
  it('H7/g6 is clearance', () => {
    expect(FIT_TABLE['H7/g6'].category).toBe('clearance');
  });

  it('H7/p6 is interference', () => {
    expect(FIT_TABLE['H7/p6'].category).toBe('interference');
  });

  it('H7/k6 is transition', () => {
    expect(FIT_TABLE['H7/k6'].category).toBe('transition');
  });
});

describe('evaluateFit', () => {
  it('H7/g6 clearance fit produces positive min/max', () => {
    const r = evaluateFit(25, 'H7/g6');
    expect(r.minClearance).toBeGreaterThan(0);
    expect(r.maxClearance).toBeGreaterThan(r.minClearance);
  });

  it('H7/p6 interference fit has negative min clearance', () => {
    const r = evaluateFit(25, 'H7/p6');
    expect(r.minClearance).toBeLessThan(0);
  });

  it('hole min ≤ hole max', () => {
    const r = evaluateFit(25, 'H7/g6');
    expect(r.holeDiameter.min).toBeLessThanOrEqual(r.holeDiameter.max);
  });

  it('shaft min ≤ shaft max', () => {
    const r = evaluateFit(25, 'H7/g6');
    expect(r.shaftDiameter.min).toBeLessThanOrEqual(r.shaftDiameter.max);
  });

  it('larger nominal → both dia increase', () => {
    /**
     * ⚠ 260801d: ⌀10 과 ⌀100 을 쓰고 있었다 — 둘 다 표(⌀18~30) **밖**이다.
     * 그때는 표를 어떤 지름에도 그대로 적용해서 통과했지만, 그게 바로 결함이었다
     * (ISO 286 편차는 치수 구간마다 다르다). 불변식 자체는 구간 안에서 그대로 성립한다.
     */
    const a = evaluateFit(20, 'H7/g6');
    const b = evaluateFit(30, 'H7/g6');
    expect(b.holeDiameter.min).toBeGreaterThan(a.holeDiameter.min);
  });

  it('clearance fit shafts always smaller than hole', () => {
    const r = evaluateFit(25, 'H7/f7');
    expect(r.shaftDiameter.max).toBeLessThan(r.holeDiameter.min);
  });

  it('application string non-empty', () => {
    expect(evaluateFit(25, 'H7/g6').application.length).toBeGreaterThan(0);
  });
});

describe('recommendFit', () => {
  it('spindle → H7/g6', () => {
    expect(recommendFit('spindle')).toBe('H7/g6');
  });

  it('press-fit → H7/p6', () => {
    expect(recommendFit('press-fit')).toBe('H7/p6');
  });

  it('shrink → H7/s6', () => {
    expect(recommendFit('shrink')).toBe('H7/s6');
  });

  it('sliding → H7/h6', () => {
    expect(recommendFit('sliding')).toBe('H7/h6');
  });
});

describe('toleranceBudget', () => {
  it('returns positive hole + shaft tolerances', () => {
    const b = toleranceBudget('H7/g6');
    expect(b.hole).toBeGreaterThan(0);
    expect(b.shaft).toBeGreaterThan(0);
  });

  it('total = hole + shaft', () => {
    const b = toleranceBudget('H7/p6');
    expect(b.total).toBe(b.hole + b.shaft);
  });
});

describe('summarize', () => {
  it('reports clearance bounds', () => {
    const r = evaluateFit(25, 'H7/g6');
    const s = summarize(r);
    expect(s.category).toBe('clearance');
    expect(s.minClearance).toBe(r.minClearance);
  });
});
