import { describe, it, expect } from 'vitest';
import {
  computeStage,
  parseQuarterlyOrderKrwHistoryJson,
  parseUserStageColumn,
  rollQuarterlyOrderKrwHistoryJson,
  STAGE_QUARTERLY_VOLUME_F_KRW,
} from '@/lib/stage-engine';

describe('computeStage (bm-matrix §1.1)', () => {
  const base = {
    quarterlyOrderKrw: 0,
    enterpriseContract: false,
    erpIntegrationContract: false,
    quarterlyWindowKrwHistory: [0, 0, 0] as const,
  };

  it('E: 1억+ and team size ≥2 (기존)', () => {
    expect(
      computeStage({
        ...base,
        cumulativeOrderKrw: 100_000_000,
        orderCountSuccess: 3,
        orgSize: 2,
        isBusinessAccount: false,
      }),
    ).toBe('E');
  });

  it('E: 1억+ and 법인 proxy — account_type business, org 1인', () => {
    expect(
      computeStage({
        ...base,
        cumulativeOrderKrw: 100_000_000,
        orderCountSuccess: 2,
        orgSize: 1,
        isBusinessAccount: true,
      }),
    ).toBe('E');
  });

  it('D: 1억+ 이지만 개인·팀 1인 — E 아님', () => {
    expect(
      computeStage({
        ...base,
        cumulativeOrderKrw: 100_000_000,
        orderCountSuccess: 2,
        orgSize: 1,
        isBusinessAccount: false,
      }),
    ).toBe('D');
  });

  it('F: enterpriseContract (G-S3)', () => {
    expect(
      computeStage({
        ...base,
        cumulativeOrderKrw: 0,
        orderCountSuccess: 0,
        orgSize: 1,
        enterpriseContract: true,
        isBusinessAccount: false,
      }),
    ).toBe('F');
  });

  it('F: erpIntegrationContract', () => {
    expect(
      computeStage({
        ...base,
        cumulativeOrderKrw: 10_000_000,
        orderCountSuccess: 1,
        orgSize: 1,
        erpIntegrationContract: true,
        isBusinessAccount: false,
      }),
    ).toBe('F');
  });

  it('F: E 자격 + 직전 3구간 모두 ≥ 1억 (G-S2 볼륨 경로)', () => {
    const q = STAGE_QUARTERLY_VOLUME_F_KRW;
    expect(
      computeStage({
        ...base,
        cumulativeOrderKrw: 100_000_000,
        orderCountSuccess: 2,
        orgSize: 2,
        isBusinessAccount: false,
        quarterlyWindowKrwHistory: [q, q, q],
      }),
    ).toBe('F');
  });

  it('E 유지: 3구간 1억+여도 E 누적·조직 미충족이면 F 볼륨 경로 아님', () => {
    const q = STAGE_QUARTERLY_VOLUME_F_KRW;
    expect(
      computeStage({
        ...base,
        cumulativeOrderKrw: 50_000_000,
        orderCountSuccess: 2,
        orgSize: 2,
        isBusinessAccount: false,
        quarterlyWindowKrwHistory: [q, q, q],
      }),
    ).toBe('D');
  });

  it('E 유지: 누적 1억+인데 3구간 중 하나만 부족하면 F 아님', () => {
    const q = STAGE_QUARTERLY_VOLUME_F_KRW;
    expect(
      computeStage({
        ...base,
        cumulativeOrderKrw: 100_000_000,
        orderCountSuccess: 2,
        orgSize: 2,
        isBusinessAccount: false,
        quarterlyWindowKrwHistory: [q, q, q - 1],
      }),
    ).toBe('E');
  });

  it('G-S4: computeStage는 B를 반환하지 않음', () => {
    expect(
      computeStage({
        ...base,
        cumulativeOrderKrw: 0,
        orderCountSuccess: 0,
        orgSize: 1,
        isBusinessAccount: false,
      }),
    ).not.toBe('B');
  });
});

describe('parseUserStageColumn', () => {
  it('도메인 값만 통과', () => {
    expect(parseUserStageColumn('e')).toBe('E');
    expect(parseUserStageColumn('bad')).toBe('A');
  });
});

describe('quarterly_order_krw_history JSON', () => {
  it('parseQuarterlyOrderKrwHistoryJson — 기본·손상 JSON', () => {
    expect(parseQuarterlyOrderKrwHistoryJson(null)).toEqual([0, 0, 0]);
    expect(parseQuarterlyOrderKrwHistoryJson('')).toEqual([0, 0, 0]);
    expect(parseQuarterlyOrderKrwHistoryJson('not-json')).toEqual([0, 0, 0]);
    expect(parseQuarterlyOrderKrwHistoryJson('[1,2]')).toEqual([0, 0, 0]);
    expect(parseQuarterlyOrderKrwHistoryJson('[10,20,30]')).toEqual([10, 20, 30]);
  });

  it('rollQuarterlyOrderKrwHistoryJson — 시프트', () => {
    expect(rollQuarterlyOrderKrwHistoryJson('[1,2,3]', 40)).toBe('[2,3,40]');
    expect(rollQuarterlyOrderKrwHistoryJson(null, 5)).toBe('[0,0,5]');
  });
});
