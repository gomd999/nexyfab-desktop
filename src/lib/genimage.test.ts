import { describe, it, expect } from 'vitest';
import { buildGenImagePrompt, GENIMAGE_DAILY_LIMITS, GENIMAGE_ANON_DAILY } from './genimage';

describe('genimage 입력 커스텀 계층', () => {
  it('텍스트 모드 — 흰 배경·단일 객체·정면 뷰 규격이 강제되고 원문이 포함된다', () => {
    const p = buildGenImagePrompt({ text: '200L 스테인리스 원통 탱크', hasImage: false, domain: 'mech' });
    expect(p).toContain('순수 흰색 배경');
    expect(p).toContain('단일 객체');
    expect(p).toContain('정면에 가까운 뷰');
    expect(p).toContain('200L 스테인리스 원통 탱크');
    expect(p).toContain('금속'); // mech 재질 힌트
    expect(p).not.toContain('다시 그려라'); // 이미지 재현 지시문 아님
  });

  it('이미지 모드 — 원본 유지·배경 제거 재현 지시문 + 추가 요청 반영', () => {
    const p = buildGenImagePrompt({ text: '더 밝게', hasImage: true, domain: 'interior' });
    expect(p).toContain('다시 그려라');
    expect(p).toContain('원본 그대로 유지');
    expect(p).toContain('추가 요청');
    expect(p).toContain('더 밝게');
    expect(p).toContain('목재'); // interior 재질 힌트
  });

  it('이미지 모드 텍스트 없음 — 추가 요청 줄이 생기지 않는다', () => {
    const p = buildGenImagePrompt({ text: '', hasImage: true });
    expect(p).not.toContain('추가 요청');
    expect(p).toContain('순수 흰색 배경');
  });

  it('긴 입력은 800자로 절단, 미지 도메인은 mech 힌트 폴백', () => {
    const p = buildGenImagePrompt({ text: 'x'.repeat(2000), hasImage: false, domain: 'unknown' });
    expect(p.length).toBeLessThan(1400);
    expect(p).toContain('산업 장비');
  });

  it('일일 한도 — 사용자 결정값(무료·비회원 2, 유료 50)', () => {
    expect(GENIMAGE_ANON_DAILY).toBe(2);
    expect(GENIMAGE_DAILY_LIMITS.free).toBe(2);
    expect(GENIMAGE_DAILY_LIMITS.pro).toBe(50);
    expect(GENIMAGE_DAILY_LIMITS.team).toBe(50);
    expect(GENIMAGE_DAILY_LIMITS.enterprise).toBe(50);
  });
});
