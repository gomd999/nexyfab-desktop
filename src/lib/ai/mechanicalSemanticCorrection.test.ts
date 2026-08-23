import { describe, expect, it } from 'vitest';
import { mechanicalSemanticCorrection } from './mechanicalSemanticCorrection';

describe('mechanical semantic correction', () => {
  const history = [
    { role: 'user', content: '아이스크림 스쿠프 만들어줘' },
    { role: 'assistant', content: '스쿠프 형태로 생성했습니다. 보우 ϴ55mm, 손잡이 ϴ18×120mm, 두께 2mm' },
  ];

  it('turns a hemispherical-shape complaint into a full revision action', () => {
    expect(mechanicalSemanticCorrection('반구형이 아닌데?', history)).toMatchObject({
      type: 'scad',
      prompt: expect.stringContaining('open hollow hemispherical bowl'),
      reply: expect.stringContaining('상부가 열린 반구형 보우'),
    });
  });

  it('does not bypass MUST_ASK for a first-turn request', () => {
    expect(mechanicalSemanticCorrection('스쿠프를 반구형으로 만들어줘', [])).toBeNull();
  });

  it('returns deterministic jet follow-ups in the requested Arabic locale', () => {
    const jetHistory = [{ role: 'assistant', content: 'A turbojet concept assembly was generated.' }];
    const result = mechanicalSemanticCorrection('تفصيل', jetHistory, '', 'ar');
    expect(result?.type).toBe('assembly');
    expect(result?.reply).toContain('خطة التحسين');
    expect(result?.reply).not.toMatch(/[가-힣]/);
  });
});
