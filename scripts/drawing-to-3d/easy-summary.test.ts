/**
 * 일반인용 결과 요약 회귀(260719).
 * 섹션 5개 존재 · 부유 부품/간섭 경고 · 값 없을 때 "입력 필요"/"미산출" 정직 표기 ·
 * 검도 게이트 미충족 항목의 쉬운 말 번역 · XSS 이스케이프.
 */
import { describe, it, expect } from 'vitest';
import { easySummary as _es } from './easy-summary.mjs';
import { buildAssemblyTemplate as _bt } from './domain-assemblies.mjs';

const easySummary = _es as unknown as (asm: unknown, opts?: Record<string, unknown>) => string;
const buildAssemblyTemplate = _bt as unknown as (d: string, id: string, p: Record<string, unknown>) => Record<string, unknown>;

const SECTIONS = ['① 이게 뭔가요', '② 무엇을 사면 되나요', '③ 만들 때 주의할 점', '④ 다음에 뭘 하나요', '⑤ 꼭 알아두세요'];

// 지지 정상 어셈블리(바닥판 위 기둥)
const OK_ASM = {
  name: '테스트 받침대',
  parts: [
    { id: 'base', type: 'plate_with_holes', material: 'SS400', params: { width: 300, depth: 300, thickness: 20, holes: [{ x: 40, y: 40, d: 10 }] }, at: { tx: 0, ty: 0, tz: 0 } },
    { id: 'post', type: 'box', material: 'SS400', params: { width: 60, depth: 60, height: 400 }, at: { tx: 120, ty: 120, tz: 20 } },
  ],
};

// 공중에 뜬 부품 — support.floating 발생
const FLOAT_ASM = {
  name: '부유 테스트',
  parts: [
    { id: 'base', type: 'plate_with_holes', material: 'SS400', params: { width: 300, depth: 300, thickness: 20, holes: [] }, at: { tx: 0, ty: 0, tz: 0 } },
    { id: 'ghost_beam', type: 'box', material: 'SS400', params: { width: 100, depth: 40, height: 40 }, at: { tx: 60, ty: 60, tz: 900 } },
  ],
};

describe('일반인용 결과 요약(easySummary)', () => {
  it('기계·건축·조경 3개 도메인 템플릿에서 5개 섹션이 모두 생성된다', () => {
    for (const [domain, id] of [['mech', 'tower_crane'], ['building', 'steel_canopy'], ['landscape', 'pergola']] as const) {
      const asm = buildAssemblyTemplate(domain, id, {});
      const html = easySummary(asm, { title: id, domain });
      for (const s of SECTIONS) expect(html, `${domain}/${id} → ${s}`).toContain(s);
      expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
      expect(html).toContain('</html>');
      // 자립형: 외부 리소스 참조 없음
      expect(html).not.toMatch(/<script\s+src=|<link\s+rel="stylesheet"/);
    }
  });

  it('①: 전체 크기는 m 단위, 총 무게·부재 개수를 표기한다', () => {
    const html = easySummary(OK_ASM);
    expect(html).toContain('전체 크기');
    expect(html).toMatch(/0\.300 m/); // 300mm → m 환산(1m 미만은 소수 3자리)
    expect(html).toContain('총 무게');
    expect(html).toContain('2개');
  });

  it('②: 발주 가능 규격은 그대로, 아니면 "도면대로 제작"으로 적는다', () => {
    const html = easySummary(OK_ASM);
    expect(html).toContain('무엇을 사면 되나요');
    expect(html).toContain('도면대로 제작');
    expect(html).toContain('제작품');
  });

  it('②: 재질이 없으면 지어내지 않고 "입력 필요"로 표기한다', () => {
    const noMat = { name: '재질없음', parts: [{ id: 'p1', type: 'box', params: { width: 100, depth: 100, height: 100 }, at: { tx: 0, ty: 0, tz: 0 } }] };
    const html = easySummary(noMat);
    expect(html).toContain('입력 필요');
  });

  it('③: 부유 부품이 있으면 "세울 수 없습니다" 경고와 부품명이 나온다', () => {
    const html = easySummary(FLOAT_ASM);
    expect(html).toContain('부유 부품');
    expect(html).toContain('세울 수 없습니다');
    expect(html).toContain('ghost_beam');
  });

  it('③: 검도 게이트 미충족 항목을 쉬운 말로 번역한다(M1→치수 누락 안내)', () => {
    const html = easySummary(OK_ASM, {
      executionGate: { score: '1/3', ok: false, items: [], na: [], failed: ['M1 치수 충분성(파라미터↔기입 치수) — base: width 치수 누락', 'M5 재질열+일반공차 주기(표제란)'] },
    });
    expect(html).toContain('도면에 빠진 치수가 있어요');
    expect(html).toContain('재질·일반공차 표기가 빠졌어요');
    expect(html).toContain('1/3');
    // 원문 게이트 코드가 그대로 노출되지 않는다(쉬운 말 레이어)
    expect(html).not.toContain('파라미터↔기입 치수');
  });

  it('③: 게이트를 넘기지 않으면 판정을 지어내지 않고 "포함되지 않았습니다"로 표기한다', () => {
    const html = easySummary(OK_ASM);
    expect(html).toContain('이 요약에 포함되지 않았습니다');
  });

  it('④: 파일 용도 안내는 실제 동봉 목록만 설명한다', () => {
    const html = easySummary(OK_ASM, { fileNames: ['GA_2D_drawing.html', 'BOQ.html'] });
    expect(html).toContain('GA_2D_drawing.html');
    expect(html).toContain('BOQ.html');
    expect(html).not.toContain('부품제작도.html'); // 동봉되지 않은 파일은 안내하지 않음
    // 목록이 아예 없으면 카탈로그를 나열하지 않는다 — "무엇이 들어있는지 모른다"가 사실(정직)
    const noList = easySummary(OK_ASM);
    expect(noList).toContain('동봉 파일 목록이 전달되지 않았습니다');
    expect(noList).not.toContain('GA_2D_drawing.html');
    // 용도 미등록 파일명은 숨기지 않고 "미등록"으로 정직 표기
    const extra = easySummary(OK_ASM, { fileNames: ['GA_2D_drawing.html', '신규산출물.html'] });
    expect(extra).toContain('신규산출물.html');
    expect(extra).toContain('용도 설명 미등록');
  });

  it('⑤: 비법정 면책 문구가 들어간다(안전·인허가 보증 표현 없음)', () => {
    const html = easySummary(OK_ASM);
    expect(html).toContain('유자격 기술사의 검토·날인이 필요합니다');
    expect(html).toContain('비법정');
    expect(html).not.toMatch(/안전(을)? (보증|보장)|인허가 (보증|통과)/);
  });

  it('금액(₩)은 어디에도 산출하지 않는다', () => {
    const html = easySummary(buildAssemblyTemplate('mech', 'tower_crane', {}), { domain: 'mech' });
    // 실제 금액 수치가 없어야 한다("금액(₩)은 산출하지 않습니다" 고지 문구 자체는 허용)
    expect(html).not.toMatch(/₩\s*[\d,]/);
    expect(html).not.toMatch(/[\d,]+\s*원(?![가-힣])/);
    expect(html).toContain('금액(₩)은 산출하지 않습니다');
  });

  it('빌드 게이트 실패 시 형상을 지어내지 않고 사유만 안내한다', () => {
    const bad = { name: 'bad', parts: [{ id: 'x', type: 'box', params: { width: -5, depth: 10, height: 10 } }] };
    const html = easySummary(bad);
    expect(html).toContain('요약을 만들 수 없습니다');
    expect(html).not.toContain('② 무엇을 사면 되나요');
  });

  it('XSS: 제목·부품 ID의 태그가 이스케이프된다', () => {
    const evil = {
      name: '<script>alert(1)</script>',
      parts: [{ id: '<img src=x onerror=1>', type: 'box', material: '<b>steel</b>', params: { width: 100, depth: 100, height: 100 }, at: { tx: 0, ty: 0, tz: 900 } }],
    };
    const html = easySummary(evil, { title: '<script>alert(2)</script>' });
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });
});
