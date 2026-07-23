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

  it('①: 표시 프록시(massProxy)는 총 무게에서 제외한다 — 수관 구체가 수십 t 로 새지 않음', async () => {
    const { buildAssemblyTemplate } = await import('./domain-assemblies.mjs');
    const asm = buildAssemblyTemplate('landscape', 'tree_planting', {}) as { parts: { massProxy?: boolean }[] };
    expect(asm.parts.some((p) => p.massProxy)).toBe(true);
    const html = easySummary(asm, { title: '식재', domain: 'landscape' });
    const m = /<b>([^<]+)<\/b><span>총 무게/.exec(html);
    expect(m, '총 무게 KPI 를 찾지 못함').not.toBeNull();
    // 줄기만 계상 → 수백 kg 규모. 프록시가 섞이면 t 단위가 되어 실패한다.
    expect(m![1]).toMatch(/kg$/);
    expect(Number(m![1].replace(/[^\d.]/g, ''))).toBeLessThan(1000);
    expect(html).toContain('총 무게에서 뺐습니다');
  }, 60_000);

  // F2 — 전도 경고가 일반인 문서에서만 사라지던 결함. structural.warnings 는 반드시 ③에 도달해야 한다.
  it('③: structural 의 전도 경고가 쉬운 말로 요약에 나타난다(FS 수치는 원본과 동일)', async () => {
    const { buildAssembly } = await import('./assembly.mjs') as unknown as {
      buildAssembly: (a: unknown) => { structural: { ok: boolean; warnings: string[]; tipover: { seismicFS: number; staticAngleDeg: number } } };
    };
    const asm = buildAssemblyTemplate('mech', 'tower_crane', {});
    const st = buildAssembly(asm).structural;
    expect(st.ok, '전제: 이 템플릿은 구조 경고가 있어야 한다').toBe(false);
    expect(st.warnings.length).toBeGreaterThan(0);

    const html = easySummary(asm, { title: 'tower_crane', domain: 'mech' });
    expect(html).toContain('넘어질');                    // 전도가 일반인 말로 등장
    expect(html).toContain('안전 경고');
    expect(html).toContain('class="warn"');              // 눈에 띄게(경고 스타일)
    // 수치가 원본과 일치 — 요약이 원본보다 낙관적이면 안 된다
    expect(html).toContain(String(st.tipover.seismicFS));
    expect(html).toContain(String(st.tipover.staticAngleDeg));
    // 종합 판정도 FAIL 로 노출
    expect(html).toContain('보완 필요');
    expect(html).toContain('보완 없이 제작에 들어가면 안 됩니다');
  }, 60_000);

  it('③: 극단 케이스(FS 0.04 급)에서도 안전 경고가 반드시 나온다', () => {
    // 좁은 받침 위 아주 높은 기둥 — 전도 FS 가 극단적으로 낮아진다
    const TIPPY = {
      name: '전도 극단',
      parts: [
        { id: 'base', type: 'plate_with_holes', material: 'SS400', params: { width: 200, depth: 200, thickness: 10, holes: [] }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'mast', type: 'box', material: 'SS400', params: { width: 100, depth: 100, height: 6000 }, at: { tx: 50, ty: 50, tz: 10 } },
      ],
    };
    const html = easySummary(TIPPY);
    expect(html).toContain('안전 경고');
    expect(html).toContain('넘어질');
  });

  it('③: 구조 경고가 없으면 없다고만 적고 안전을 보증하지 않는다', () => {
    // 전도 폴백 수리(260720) 이후 픽스처 갱신: 종전 FS 1.81(d900·o100)은 지지 스팬에
    // **접지하지 않는** 풋레일 브래킷 CG(y=-145)까지 계상한 값이었다. 지지 기반을 접지
    // footprint(걸레받이, 전면 전도축 y=60)로 고치면 같은 치수의 FS 는 0.94 — 자립 바
    // 카운터는 0.5g 에 실제로 앵커가 필요하다(경고가 맞다). 이 테스트가 보려는 건
    // "경고 없음 경로의 문면"이므로 실제로 안정한 치수(깊이 1200·높이 800·내밈 0,
    // FS 1.70·전도각 40.4°)로 고정한다.
    const html = easySummary(buildAssemblyTemplate('interior', 'counter_bar', { depth: 1200, height: 800, overhang: 0 }), { domain: 'interior' });
    expect(html).toContain('걸린 안전 경고는 없습니다');
    expect(html).toContain('안전 보증 아님');
    expect(html).not.toContain('안전 경고 — 지금 형상 그대로');
  });

  // F7 — massProxy 는 질량뿐 아니라 발주(BOM)·접합 계상에서도 빠져야 한다(나무를 용접시키지 않기).
  it('②③: 표시용 형상(massProxy)은 발주 표·접합 계상에서 제외된다', async () => {
    const asm = buildAssemblyTemplate('landscape', 'tree_planting', {}) as unknown as { parts: { id: string; massProxy?: boolean }[] };
    const proxyIds = asm.parts.filter((p) => p.massProxy).map((p) => p.id);
    expect(proxyIds.length).toBeGreaterThan(0);
    const html = easySummary(asm, { title: '식재', domain: 'landscape' });

    // 발주 표(②의 첫 표)에는 프록시가 없고, 별도 "표시용 형상" 표로 분리 표기된다
    const buyTable = html.slice(html.indexOf('② 무엇을 사면 되나요'), html.indexOf('③ 만들 때 주의할 점'));
    expect(buyTable).toContain('발주·제작 대상이 아닙니다');
    expect(buyTable).toContain('표시용 형상');
    const orderRows = buyTable.slice(0, buyTable.indexOf('표시용 형상입니다'));
    expect(orderRows).not.toContain('회전체'); // 수관(revolve)은 발주 행에 없다

    // 이 템플릿의 접합은 전부 줄기↔수관이므로 접합 계상이 0 이 되어야 한다
    expect(html).not.toContain('접합해야 하는 곳이');
    expect(html).not.toMatch(/용접이 \d+군데/);
  }, 60_000);

  // F11 — 가구 한 점에 건축신고를 요구하지 않는다(단, 애매하면 요구하는 쪽).
  it('④: 인허가 안내는 대지 정착 구조물 규모일 때만 요구한다', () => {
    // 실내 가구 규모(높이 1.05 m · 2.4 m²) → 건축신고 요구하지 않음, 대신 관할 확인 안내
    const bar = buildAssemblyTemplate('interior', 'counter_bar', {});
    const barHtml = easySummary(bar, { title: '카운터 바', domain: 'interior' });
    expect(barHtml).not.toContain('건축신고');
    expect(barHtml).toContain('관할 기관');

    // 건축 도메인 → 항상 요구
    const canopy = easySummary(buildAssemblyTemplate('building', 'steel_canopy', {}), { domain: 'building' });
    expect(canopy).toContain('건축신고');

    // 기계라도 구조물 규모(높이 2.4 m 이상)면 요구(안전측)
    const tall = {
      name: '대형 가대',
      parts: [
        { id: 'base', type: 'plate_with_holes', material: 'SS400', params: { width: 2000, depth: 2000, thickness: 20, holes: [] }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'col', type: 'box', material: 'SS400', params: { width: 200, depth: 200, height: 3000 }, at: { tx: 900, ty: 900, tz: 20 } },
      ],
    };
    expect(easySummary(tall, { domain: 'mech' })).toContain('건축신고');
  }, 60_000);

  it('⑤: 비법정 면책 문구가 들어간다(안전·인허가 보증 표현 없음)', () => {
    const html = easySummary(OK_ASM);
    expect(html).toContain('유자격 기술사의 검토·날인이 필요합니다');
    expect(html).toContain('비법정');
    // "…보증 아님"(면책·부정)은 허용 — 전도 폴백 수리(260720)로 OK_ASM 이 정상적으로
    // 안정 판정이 되면서 경고-없음 문구 "(안전 보증 아님)"이 나타나기 시작했다(③ 테스트가
    // 요구하는 바로 그 문구). 이 검사의 의도는 **긍정형 보증 표현** 금지다.
    expect(html).not.toMatch(/안전(을)? (보증|보장)(?!(되| 되)? ?(아님|않))|인허가 (보증|통과)/);
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

  it('FEA 안전율 위험(0.49) 전달 시 종합 판정이 위험으로 뒤집힌다(도그푸딩 260723 5차)', () => {
    // structural(강체 전도/CG)은 정상이어도 FEA(응력)가 별개로 위험할 수 있다 —
    // 이 문서가 opts.fea 없이는 FEA를 아예 모른 채 "이상 없음"만 보여주던 결함.
    const html = easySummary(OK_ASM, { domain: 'mech', fea: { safetyFactor: 0.49, method: 'linear-fem-tet' } });
    expect(html).toContain('0.49');
    expect(html).toMatch(/응력 해석.*안전율.*1 미만/);
    expect(html).toContain('보완 없이 제작에 들어가면 안 됩니다');
  });

  it('FEA 안전율 여유(3.2) 전달 시 안전율 경고 없이 "이상 없음"으로 표시된다', () => {
    const html = easySummary(OK_ASM, { domain: 'mech', fea: { safetyFactor: 3.2 } });
    expect(html).toContain('응력 해석(개산) <b>이상 없음</b>');
    expect(html).not.toContain('보완 없이 제작에 들어가면 안 됩니다');
  });

  it('opts.fea를 넘기지 않으면 기존과 동일하게 응력 해석 판정 자체가 없다(하위 호환)', () => {
    const html = easySummary(OK_ASM, { domain: 'mech' });
    expect(html).not.toContain('응력 해석(개산)');
  });

  it('opts.domainSafety FAIL 전달 시 종합 판정이 위험으로 뒤집힌다(도그푸딩 260723 계속 — 인테리어 등)', () => {
    // domainSafetyReportHtml(안전검토.html)엔 FAIL이 정확히 떴는데, 이 문서가 opts.domainSafety
    // 없이는 그 판정을 아예 모른 채 "이상 없음"만 보여주던 결함(FEA와 같은 구조의 갭).
    const html = easySummary(OK_ASM, {
      domain: 'interior',
      domainSafety: { label: '실내건축 검토 (피난·수용인원 등)', ok: false, failed: ['egress_width', 'exit_count'] },
    });
    expect(html).toContain('기준 미달 항목이 있습니다: egress_width, exit_count');
    expect(html).toContain('보완 없이 제작에 들어가면 안 됩니다');
    expect(html).toMatch(/실내건축 검토.*보완 필요/);
  });

  it('opts.domainSafety ok:true 전달 시 안전 경고 없이 "이상 없음"으로 표시된다', () => {
    const html = easySummary(OK_ASM, {
      domain: 'interior',
      domainSafety: { label: '실내건축 검토 (피난·수용인원 등)', ok: true, failed: [] },
    });
    expect(html).toMatch(/실내건축 검토.*이상 없음/);
    expect(html).not.toContain('보완 없이 제작에 들어가면 안 됩니다');
  });

  it('opts.domainSafety를 넘기지 않으면 기존과 동일하게 해당 판정 자체가 없다(하위 호환)', () => {
    const html = easySummary(OK_ASM, { domain: 'mech' });
    expect(html).not.toContain('실내건축 검토');
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
