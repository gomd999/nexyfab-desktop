import { describe, expect, it } from 'vitest';
import { shouldRunLunaDesignPreflight } from './lunaDesignPreflightPolicy';

describe('Luna design preflight complexity gate', () => {
  it('skips simple parameter edits', () => {
    expect(shouldRunLunaDesignPreflight('직경을 40mm로 변경')).toBe(false);
    expect(shouldRunLunaDesignPreflight('move the selected face by 3 mm')).toBe(false);
  });

  it('runs for complex assemblies and ambiguous refinement requests', () => {
    expect(shouldRunLunaDesignPreflight('다단 기어박스 조립체의 mate와 공차를 포함해 설계해줘')).toBe(true);
    expect(shouldRunLunaDesignPreflight('이 설계를 더 구체화하고 개선해줘')).toBe(true);
  });
});
