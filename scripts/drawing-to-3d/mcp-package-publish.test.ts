/**
 * MCP generate_package 의 발행 규약 회귀(260728).
 *
 * 배경: 260727 A-7 전수감사의 잔여였던 "웹 라우트만 하고 MCP 는 안 하는" 비대칭.
 * 실측 재현(수정 전): MCP 산출물의 GA_plan.dxf 는 표제란이 리터럴 'NF-REV-PENDING',
 * GA_2D_drawing.html 의 REV 스팬은 '—' 인 채로 나갔고, 문서 간 수치 대조
 * (packageConsistencyCheck)는 **한 번도 실행되지 않았다**. 응답에도 rev/consistency 가 없었다.
 *
 * 이 테스트가 고정하는 것:
 *  1) REV 가 웹 라우트(route.ts:345)와 **같은 식**으로 나온다 — 같은 어셈블리면 같은 REV.
 *     (두 발생지가 다른 REV 를 찍으면 "카드=REV B vs 도면=REV C" 가 그대로 재발한다)
 *  2) DXF 표제란 · HTML REV 스팬에 미치환 자리표시자가 남지 않는다.
 *  3) 정합 게이트가 실제로 실행되고 결과가 응답에 실린다.
 *  4) (동반 확인) 옹벽 KDS 활동 FAIL 이 MCP 경로에서도 쉬운요약까지 도달한다 — 835eec40.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callTool as _ct } from './mcp-server.mjs';
import { buildAssemblyTemplate as _bt } from './domain-assemblies.mjs';

type PkgResult = {
  ok: boolean;
  rev?: string;
  outDir?: string;
  consistency?: { pass?: boolean; checks?: Array<{ pass: boolean; file: string; metric: string }>; error?: string } | null;
};
const callTool = _ct as unknown as (name: string, args: Record<string, unknown>) => Promise<PkgResult>;
const buildAssemblyTemplate = _bt as unknown as (d: string, id: string, p: Record<string, unknown>) => Record<string, unknown>;

const mkOut = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `nf-mcp-${tag}-`));
const read = (dir: string, name: string) => fs.readFileSync(path.join(dir, name), 'utf8');

// 건전 옹벽(전 항목 통과) — 발행 규약만 본다
const OK_PARAMS = { H: 3000, B: 2000, toe: 1200 };
// 활동(sliding) FS 미달 — 안전 판정이 소비자 문서까지 가는지 본다
const FAIL_PARAMS = { H: 4000, B: 1600, toe: 300 };

describe('MCP generate_package — 발행 규약(REV·정합)이 웹 라우트와 동급인가', () => {
  it('REV 는 웹 라우트와 같은 식으로 산출되고 전 HTML 에 스탬프된다', async () => {
    const outDir = mkOut('rev');
    const res = await callTool('generate_domain_package', {
      domain: 'civil', templateId: 'retaining_wall_run', params: OK_PARAMS, outDir,
    });
    expect(res.ok).toBe(true);

    // 웹 라우트(route.ts:345)의 식을 그대로 재현
    const asm = buildAssemblyTemplate('civil', 'retaining_wall_run', OK_PARAMS);
    const webRev = createHash('sha1')
      .update(JSON.stringify({ a: asm, d: (asm as { domain?: string }).domain ?? 'mech' }))
      .digest('hex').slice(0, 8);
    expect(res.rev).toBe(webRev);

    // nf-basis 메타가 실제로 파일에 박혀 있고, 그 안의 rev 가 응답 rev 와 같다
    const ga = read(outDir, 'GA_2D_drawing.html');
    const m = ga.match(/name="nf-basis" content="([^"]*)"/);
    expect(m).not.toBeNull();
    expect(JSON.parse((m as RegExpMatchArray)[1].replace(/&quot;/g, '"')).rev).toBe(res.rev);
    fs.rmSync(outDir, { recursive: true, force: true });
  }, 180_000);

  it('DXF 표제란·HTML REV 스팬에 미치환 자리표시자가 남지 않는다', async () => {
    const outDir = mkOut('ph');
    const res = await callTool('generate_domain_package', {
      domain: 'civil', templateId: 'retaining_wall_run', params: OK_PARAMS, outDir,
    });
    expect(res.ok).toBe(true);
    const dxf = read(outDir, 'GA_plan.dxf');
    expect(dxf).not.toContain('NF-REV-PENDING');
    expect(dxf).toContain(res.rev as string);
    for (const f of fs.readdirSync(outDir).filter((n) => n.endsWith('.html'))) {
      expect(read(outDir, f)).not.toContain('<span class="nf-rev">—</span>');
    }
    fs.rmSync(outDir, { recursive: true, force: true });
  }, 180_000);

  it('정합 게이트가 실행되어 결과가 응답에 실린다(스킵도 침묵도 아님)', async () => {
    const outDir = mkOut('cons');
    const res = await callTool('generate_domain_package', {
      domain: 'civil', templateId: 'retaining_wall_run', params: OK_PARAMS, outDir,
    });
    expect(res.ok).toBe(true);
    expect(res.consistency).toBeTruthy();
    expect(res.consistency?.error).toBeUndefined();
    // 대조 가능한 문서가 실제로 있으므로 체크가 0건이면 회수 정규식이 죽은 것이다
    expect((res.consistency?.checks ?? []).length).toBeGreaterThan(0);
    expect(res.consistency?.pass).toBe(true);
    fs.rmSync(outDir, { recursive: true, force: true });
  }, 180_000);

  it('실시 검도 M1~M6 리포트가 파일로 나간다 — 게이트를 계산만 하고 버리지 않는다', async () => {
    const outDir = mkOut('exec');
    const res = await callTool('generate_domain_package', {
      domain: 'civil', templateId: 'retaining_wall_run', params: OK_PARAMS, outDir,
    });
    expect(res.ok).toBe(true);
    // 종전: executionGate 를 계산해 쉬운요약에 한 줄만 넘기고 항목별 판정은 어디에도 없었다.
    const rep = read(outDir, '실시검도리포트.html');
    for (const id of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6']) expect(rep).toContain(id);
    expect(rep).toMatch(/PASS|FAIL|N\/A/);
    expect(rep).toContain('nf-basis'); // 이 파일도 같은 REV 로 발행된다
    fs.rmSync(outDir, { recursive: true, force: true });
  }, 180_000);

  it('부유 부품(설치 불가 신호)이 응답 JSON 에 실린다 — ok:true 가 designOk 를 덮지 않는다', async () => {
    // MCP 호출자는 대개 AI 에이전트이고, 에이전트가 읽는 건 파일이 아니라 이 JSON 이다.
    // 종전엔 buildAssembly 가 support.floating 을 산출해 두고도 응답에 싣지 않아,
    // 공중에 뜬 부품이 있어도 에이전트에게는 `ok:true` 만 보였다.
    const outDir = mkOut('float');
    const res = (await callTool('generate_package', {
      outDir,
      assembly: {
        name: '부유 테스트',
        parts: [
          { id: 'base', type: 'box', material: 'SS400', params: { width: 300, depth: 300, height: 20 }, at: { tx: 0, ty: 0, tz: 0 } },
          { id: 'floater', type: 'box', material: 'SS400', params: { width: 60, depth: 60, height: 60 }, at: { tx: 100, ty: 100, tz: 900 } },
        ],
      },
    })) as PkgResult & { designOk?: boolean | null; support?: { floating?: string[] } | null };
    expect(res.ok).toBe(true); // 생성은 된다 — 그게 곧 타당하다는 뜻이 아니다
    expect(res.support?.floating).toContain('floater');
    expect(res.designOk).toBe(false);
    fs.rmSync(outDir, { recursive: true, force: true });
  }, 180_000);

  it('옹벽 활동 FAIL 이 MCP 경로에서도 쉬운요약까지 도달한다(835eec40 · 과탐 0)', async () => {
    const bad = mkOut('fail');
    const resBad = await callTool('generate_domain_package', {
      domain: 'civil', templateId: 'retaining_wall_run', params: FAIL_PARAMS, outDir: bad,
    });
    expect(resBad.ok).toBe(true);
    const easyBad = read(bad, '쉬운요약.html');
    expect(easyBad).toContain('활동(미끄러짐)');
    expect(easyBad).not.toContain('걸린 안전 경고는 없습니다');
    fs.rmSync(bad, { recursive: true, force: true });

    // 과탐 0 — 건전 옹벽은 경고를 만들지 않는다
    const ok = mkOut('nofail');
    await callTool('generate_domain_package', {
      domain: 'civil', templateId: 'retaining_wall_run', params: OK_PARAMS, outDir: ok,
    });
    const easyOk = read(ok, '쉬운요약.html');
    expect(easyOk).not.toContain('활동(미끄러짐)');
    fs.rmSync(ok, { recursive: true, force: true });
  }, 240_000);
});

/**
 * §7-5 마무리 — 산출물 생성 실패가 응답에 남는가 (260728).
 * 특히 `쉬운요약.html` 은 **모든 안전 판정을 소비자에게 나르는 유일한 표면**이라,
 * 그 실패가 조용하면 판정 전체가 사라진다. 실패를 적을 자리가 그 문서 안이므로
 * 응답 JSON 이 유일한 통로다.
 */
describe('MCP generate_package — 산출물 실패는 응답에 남는다', () => {
  it('정상 경로에서는 outputsFailed 가 비어 있다 (과탐 0)', async () => {
    const outDir = mkOut('nofail');
    const res = (await callTool('generate_domain_package', {
      domain: 'civil', templateId: 'retaining_wall_run', params: OK_PARAMS, outDir,
    })) as PkgResult & { outputsFailed?: string[] };
    expect(res.ok).toBe(true);
    expect(res.outputsFailed).toEqual([]);
    // 안전 판정 전달 문서가 실제로 나왔다는 것과 같은 말이다
    expect(fs.readdirSync(outDir)).toContain('쉬운요약.html');
    fs.rmSync(outDir, { recursive: true, force: true });
  }, 180_000);

  it('응답에 outputsFailed 필드가 항상 존재한다 — "검사 안 함"과 구별되게', async () => {
    const outDir = mkOut('field');
    const res = (await callTool('generate_domain_package', {
      domain: 'civil', templateId: 'retaining_wall_run', params: OK_PARAMS, outDir,
    })) as PkgResult & { outputsFailed?: string[] };
    expect(Array.isArray(res.outputsFailed)).toBe(true);
    fs.rmSync(outDir, { recursive: true, force: true });
  }, 180_000);
});
