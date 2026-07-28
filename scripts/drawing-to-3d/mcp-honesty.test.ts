/**
 * MCP 응답 정직성 회귀 (260728) — 42개 툴 전수 호출 실측에서 나온 결함들.
 *
 * 호출자는 대개 AI 에이전트이고, 에이전트가 읽는 것은 이 JSON 뿐이다. 그래서 두 가지가
 * 지켜져야 한다:
 *   1. **성공과 실패가 구별될 것** — `ok` 없는 알몸 객체 금지(8개 툴이 그랬다).
 *   2. **쓰레기 입력이 조용히 통과하지 않을 것** — 못 읽은 것이 "없는 것"으로 읽히면
 *      §6-G "absence reads as normal" 이다.
 */
import { describe, it, expect } from 'vitest';
import { callTool } from './mcp-server.mjs';

type Res = Record<string, unknown>;
const call = (n: string, a: unknown) => (callTool as unknown as (n: string, a: unknown) => Promise<Res>)(n, a);

const L = (c: number | string, v: number | string) => `${c}\n${v}`;
const DXF_WITH_DIM = [
  L(0, 'SECTION'), L(2, 'ENTITIES'),
  L(0, 'DIMENSION'), L(70, 0), L(50, '0.0'), L(42, '200.0'),
  L(0, 'ENDSEC'), L(0, 'EOF'),
].join('\n');
const DXF_EMPTY = [L(0, 'SECTION'), L(2, 'ENTITIES'), L(0, 'ENDSEC'), L(0, 'EOF')].join('\n');

describe('MCP 응답 규약: 모든 툴 응답에 ok 가 있다', () => {
  it('ok 없이 돌려주던 툴들도 이제 ok 를 단다 — 성공/실패 구별 가능', async () => {
    for (const [name, args] of [
      ['list_domains', {}],
      ['analyze_dfm', { intent: { kind: 'box', width: 10, depth: 10, height: 10 } }],
      ['fab_estimate', { intent: { kind: 'box', width: 10, depth: 10, height: 10 } }],
    ] as [string, unknown][]) {
      const r = await call(name, args);
      expect(r.ok, `${name} 에 ok 가 없다`).toBe(true);
    }
  });

  it('ok=true 는 "호출 성공"이지 "합격"이 아님을 응답 자체가 밝힌다', async () => {
    // 스탬프를 찍은 응답은 그 구별을 함께 실어야 한다 — 에이전트가 합격으로 오독하면
    // 그게 곧 "판정 없음이 이상 없음으로 읽히는" 자리다.
    // 형식은 통과했지만 DFM 이 두께를 인식하지 못한 경우: ok=true 인데 recognized=false 다.
    const r = await call('analyze_dfm', { intent: { kind: 'box', width: 10, depth: 10, height: 10 } });
    expect(r.ok).toBe(true);
    expect(String(r.okMeaning)).toContain('합격 여부가 아니다');
    expect(r.recognized).toBe(false); // 실제 판정은 본문에 — ok 와 별개다
  });

  it('툴이 스스로 선언한 ok 는 덮어쓰지 않는다', async () => {
    const r = await call('list_templates', { domain: 'nonexistent-domain' });
    expect(r.ok).toBe(false);
    expect(r.okMeaning).toBeUndefined();
  });
});

describe('쓰레기 입력이 조용히 통과하지 않는다', () => {
  it('dxf_reconcile: DXF 가 아닌 텍스트 = 정직 거부 (종전엔 ok:true + "실측값 직사용" 안내)', async () => {
    const r = await call('dxf_reconcile', { dxfText: 'THIS IS NOT A DXF FILE', intent: { width: 100 } });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('not_dxf');
  });

  it('dxf_reconcile: 빈 문자열 = 거부', async () => {
    const r = await call('dxf_reconcile', { dxfText: '', intent: {} });
    expect(r.ok).toBe(false);
  });

  it('dxf_reconcile: 정상 DXF 지만 치수 0개 = 통과하되 "대조 못 함"을 명시', async () => {
    // 이건 거부가 아니다 — 읽기는 성공했고 도면에 치수가 없을 뿐이다.
    // 다만 comparable=false 로, "대조했으나 다 빗나감"과 구별돼야 한다.
    const r = await call('dxf_reconcile', { dxfText: DXF_EMPTY, intent: { width: 100 } });
    expect(r.ok).toBe(true);
    const rec = r.reconciled as Res;
    expect(rec.comparable).toBe(false);
    expect(String(rec.note)).toContain('확인하지 못했다');
    expect(String(r.warning)).toContain('대조 못 함');
  });

  it('dxf_reconcile: 치수가 있는 DXF 는 종전대로 실측 교체 — 회귀 없음', async () => {
    const r = await call('dxf_reconcile', { dxfText: DXF_WITH_DIM, intent: { width: 201 } });
    expect(r.ok).toBe(true);
    const rec = r.reconciled as Res;
    expect(rec.comparable).toBe(true);
    expect((rec.intent as Res).width).toBe(200);
    expect(r.warning).toBeUndefined();
  });

  it('std_audit: parts 가 배열이 아니면 MCP 경계에서 거부 — 사유를 이름으로 지목', async () => {
    const r = await call('std_audit', { assembly: { name: 'x', parts: 'not-an-array' } });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('assembly.parts 는 배열이어야 한다');
  });

  it('auditAssemblyStd 자체도 거부한다 — 쉬운요약은 MCP 를 거치지 않고 직접 부른다', async () => {
    // 빈 감사 결과가 "규격 위반 없음"으로 읽히던 자리. MCP 경계만 막으면
    // easy-summary 경로는 여전히 조용히 빈 목록을 받는다.
    const { auditAssemblyStd } = await import('./std-snap.mjs') as unknown as
      { auditAssemblyStd: (a: unknown) => { ok: boolean; warnings: string[] } };
    const r = auditAssemblyStd({ name: 'x', parts: 'not-an-array' });
    expect(r.ok).toBe(false);
    // 사유가 소비자(쉬운요약)까지 도달하도록 warnings 에도 실린다.
    expect(r.warnings.join(' ')).toContain('감사 불가');
  });

  it('blade_ring: 날 0개는 사양이 아니라 입력 오류 — 종전엔 mesh 를 만들어 부피를 돌려줬다', async () => {
    const r = await call('blade_ring', { nB: 0, rRoot: 50, rTip: 200, chord: 40, cx: 0, pitch: 20 });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('nB=0');
  });

  it('blade_ring: rTip ≤ rRoot 는 날 길이 0 이하 — 거부', async () => {
    const r = await call('blade_ring', { nB: 3, rRoot: 200, rTip: 200, chord: 40, cx: 0, pitch: 20 });
    expect(r.ok).toBe(false);
  });

  it('blade_ring: 정상 입력은 종전대로 mesh 생성 — 회귀 없음', async () => {
    const r = await call('blade_ring', { nB: 3, rRoot: 50, rTip: 200, chord: 40, cx: 0, pitch: 20 });
    expect(r.ok).toBe(true);
    expect((r.params as Res).volumeMm3).toBeGreaterThan(0);
  });

  it('list_templates: 없는 분야 = 거부(템플릿 0개가 아니다) + 실제 분야 목록 제시', async () => {
    const r = await call('list_templates', { domain: 'nonexistent-domain' });
    expect(r.ok).toBe(false);
    expect((r.availableDomains as string[]).length).toBeGreaterThan(0);
    expect(r.availableDomains).toContain('mech');
  });

  it('list_templates: 실재 분야는 종전대로 목록 반환 — 회귀 없음', async () => {
    const r = await call('list_templates', { domain: 'mech' });
    expect(r.ok).toBe(true);
    expect((r.templates as unknown[]).length).toBeGreaterThan(0);
  });
});
