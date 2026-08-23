/**
 * POST /api/nexyfab/drawing/package — 웹 패키지 라우트 API 표면 (260728 §7-6).
 *
 * 왜 이제야: 이 라우트는 **테스트가 0 이었다.** 같은 날 MCP 쪽 결함 3건을 고치면서 이쪽도
 * 함께 손댔는데(검도 리포트 렌더러 단일화·쉬운요약 생성 순서 이동), 등가를 확인할 방법이
 * 인라인 템플릿 바이트 대조밖에 없었다. 다음에 같은 리팩터를 하면 그 방법은 안 통한다.
 *
 * 파이프라인은 **진짜로 돈다**(어셈블리 빌드·도면·구조·BOQ·스탬프·정합 게이트) — rate-limit
 * 만 막는다. 즉 아래 단언은 실제 산출물에 대한 것이다.
 */
import { describe, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { heavyTestBudgetMs } from '@/test/heavyTestBudget';
import { designRevisionSha256 } from '@/lib/designArtifactBinding';

vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: vi.fn(() => '127.0.0.1') }));

import { POST } from './route';

type PkgResponse = {
  ok: boolean;
  error?: string;
  rev?: string;
  revisionSha256?: string;
  artifactManifestSha256?: string;
  artifactManifest?: {
    schema: string;
    revisionId: string;
    revisionSha256: string;
    releaseStatus: string;
    manufacturingAllowed: boolean;
  };
  fileNames?: string[];
  files?: Array<{ name: string; content: string }>;
  zipBase64?: string | null;
  consistency?: { pass?: boolean; checks?: unknown[] } | null;
  designOk?: boolean | null;
  support?: { floating?: string[] } | null;
};

const req = (body: unknown): Request =>
  new Request('http://localhost/api/nexyfab/drawing/package', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const call = async (body: unknown): Promise<PkgResponse> =>
  (await (await POST(req(body) as never)).json()) as PkgResponse;

/**
 * 산출물 본문 읽기. 라우트는 zip 이 성공하면 개별 content 를 생략하므로(페이로드 절감)
 * 테스트가 zip 을 푼다 — 본문을 보려고 프로덕션에 디버그 옵션을 새로 만들지 않는다.
 */
async function readFile(data: PkgResponse, name: string): Promise<string | null> {
  const inline = (data.files ?? []).find((f) => f.name === name);
  if (inline) return inline.content;
  if (!data.zipBase64) return null;
  const zip = await JSZip.loadAsync(data.zipBase64, { base64: true });
  const entry = zip.file(name);
  return entry ? entry.async('string') : null;
}

const BASE_PLATE = {
  name: '테스트 받침대',
  parts: [
    { id: 'base', type: 'box', material: 'SS400', params: { width: 300, depth: 300, height: 20 }, at: { tx: 0, ty: 0, tz: 0 } },
    { id: 'post', type: 'box', material: 'SS400', params: { width: 60, depth: 60, height: 400 }, at: { tx: 120, ty: 120, tz: 20 } },
  ],
};

describe('POST /api/nexyfab/drawing/package — 입력 검증', () => {
  it('본문이 JSON 이 아니면 400', async () => {
    const res = await POST(new Request('http://localhost/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }) as never);
    expect(res.status).toBe(400);
  });

  it('parts 도 templateId 도 없으면 400 — 기본값으로 덮지 않는다', async () => {
    const res = await POST(req({ assembly: {} }) as never);
    expect(res.status).toBe(400);
    expect((await res.json() as PkgResponse).error).toContain('assembly.parts');
  });

  it('templateId 만 있고 domain 이 없으면 400', async () => {
    const res = await POST(req({ templateId: 'retaining_wall_run' }) as never);
    expect(res.status).toBe(400);
  });

  it('없는 템플릿은 404 — 조용히 다른 걸 만들지 않는다', async () => {
    const res = await POST(req({ domain: 'civil', templateId: 'no_such_template' }) as never);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/nexyfab/drawing/package — 발행 규약과 판정 도달', () => {
  it('정상 어셈블리 → 산출물 + REV + 정합 게이트 결과가 응답에 실린다', async () => {
    const options = { title: '테스트' };
    const verifyParams = { usage: 'commercial-review' };
    const data = await call({ assembly: BASE_PLATE, options, verifyParams });
    expect(data.ok).toBe(true);
    expect(data.rev).toMatch(/^[0-9a-f]{8}$/);
    const names = data.fileNames ?? [];
    // 핵심 산출물이 실제로 나온다(이름만 약속하고 빠지는 것을 막는다)
    for (const n of ['GA_2D_drawing.html', 'structural.html', 'BOQ.html', '쉬운요약.html']) {
      expect(names, n).toContain(n);
    }
    // 정합 게이트는 실행되어야 한다 — null 이면 "검사 안 함"과 구별되지 않는다
    expect(data.consistency).toBeTruthy();
    expect((data.consistency?.checks ?? []).length).toBeGreaterThan(0);
    expect(data.revisionSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(data.revisionSha256).toBe(designRevisionSha256({
      assembly: BASE_PLATE,
      options,
      verifyParams,
      template: {},
      domain: 'mech',
    }));
    expect(data.artifactManifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(data.artifactManifest).toMatchObject({
      schema: 'nexyfab.design-artifact-manifest.v1',
      revisionId: data.rev,
      revisionSha256: data.revisionSha256,
      releaseStatus: 'review_required',
      manufacturingAllowed: false,
    });
    expect(data.fileNames ?? []).toContain('artifact-manifest.json');
  }, heavyTestBudgetMs(30_000));

  /**
   * ★260801m — 받는 사람이 **실제로 쓸 수 있는 형태**인가.
   *
   * 종전 패키지에는 **CAD 로 열리는 파일이 하나도 없었다.** 3D 모델이 `model.scad`
   * (OpenSCAD 소스)뿐이라 SolidWorks·CATIA·NX·Fusion 어디서도 못 열었다.
   * B-rep STEP 은 이미 만들 수 있었고(검증용으로 쓰고 있었다) **넣지 않았을 뿐**이다.
   */
  it('★model.step 이 동봉된다 — CAD 로 열 수 있는 파일이 있어야 한다', async () => {
    const data = await call({ assembly: BASE_PLATE });
    expect(data.fileNames ?? []).toContain('model.step');
    const step = await readFile(data, 'model.step');
    // 껍데기가 아니라 실제 STEP 인지 본다 — 이름만 맞고 내용이 비면 더 나쁘다.
    expect(step, 'model.step 을 읽지 못했다').toBeTruthy();
    expect(step!).toMatch(/^ISO-10303-21;/);
    expect(step!).toMatch(/END-ISO-10303-21;/);
    expect(step!.length).toBeGreaterThan(2000);
    const manifestRaw = await readFile(data, 'artifact-manifest.json');
    expect(manifestRaw, 'artifact manifest를 읽지 못했다').toBeTruthy();
    const manifest = JSON.parse(manifestRaw!) as {
      revisionSha256: string;
      manufacturingAllowed: boolean;
      artifacts: Array<{ name: string; sha256: string }>;
    };
    expect(manifest.revisionSha256).toBe(data.revisionSha256);
    expect(manifest.manufacturingAllowed).toBe(false);
    expect(manifest.artifacts.map(artifact => artifact.name)).toEqual(expect.arrayContaining([
      'model.step', 'BOQ.html', 'GA_2D_drawing.html', 'summary.json',
    ]));
    expect(manifest.artifacts.find(artifact => artifact.name === 'model.step')?.sha256).toBe(
      createHash('sha256').update(step!, 'utf8').digest('hex'),
    );
  }, heavyTestBudgetMs(60_000));

  it('★안내문이 동봉되고 **근사 고지**를 담는다 — 파일 15개를 줘도 근거를 모르면 못 쓴다', async () => {
    const data = await call({ assembly: BASE_PLATE });
    expect(data.fileNames ?? []).toContain('00_안내.html');
    const guide = await readFile(data, '00_안내.html');
    expect(guide, '안내문을 읽지 못했다').toBeTruthy();
    expect(guide!).toMatch(/model\.step/);          // 어디서부터 보는지 안내
    expect(guide!).toMatch(/근사/);                  // 한계를 적는다
    expect(guide!).toMatch(/개념 검토|비법정/);       // 법적 지위를 적는다
  }, heavyTestBudgetMs(60_000));

  it('★summary.json 이 **실패한 산출물까지** 담는다 — 비어 있다고 성공이 아니다', async () => {
    const data = await call({ assembly: BASE_PLATE });
    const raw = await readFile(data, 'summary.json');
    expect(raw, 'summary.json 을 읽지 못했다').toBeTruthy();
    const sum = JSON.parse(raw!) as {
      schema: string; totals: { massKg: number }; files: string[];
      outputsFailed: string[]; verificationUnavailable: string[];
      accuracy: { knownApproximations: string[]; notLegal: string };
    };
    expect(sum.schema).toBe('nexyfab.design-package/1');
    expect(sum.totals.massKg).toBeGreaterThan(0);
    expect(sum.files).toContain('BOQ.html');
    // 실패·미검증 목록은 **키가 존재**해야 한다. 없으면 「없다」와 「안 봤다」가 구별되지 않는다.
    expect(Array.isArray(sum.outputsFailed)).toBe(true);
    expect(Array.isArray(sum.verificationUnavailable)).toBe(true);
    expect(sum.accuracy.knownApproximations.length).toBeGreaterThan(0);
    expect(sum.accuracy.notLegal).toMatch(/기술사/);
  }, heavyTestBudgetMs(60_000));

  it('실시검도리포트가 동봉된다 — 게이트를 계산만 하고 버리지 않는다(efc2261d 회귀)', async () => {
    const data = await call({ assembly: BASE_PLATE });
    expect(data.fileNames ?? []).toContain('실시검도리포트.html');
  }, heavyTestBudgetMs(30_000));

  it('쉬운요약이 REV 스탬프를 받는다 — 정합 게이트 뒤로 옮긴 뒤에도(341f59d7 회귀)', async () => {
    // 생성 순서를 바꾸면서 쉬운요약만 스탬프 루프를 지나쳐 버리기 쉬운 지점이다.
    const data = await call({ assembly: BASE_PLATE });
    const easy = await readFile(data, '쉬운요약.html');
    expect(easy, '쉬운요약 본문을 읽지 못했다').toBeTruthy();
    expect(easy!).toContain('nf-basis');
    expect(easy!).toContain(data.rev as string);
  }, heavyTestBudgetMs(30_000));

  it('부유 부품이 있으면 designOk=false 로 응답에 실린다 — ok:true 가 덮지 않는다', async () => {
    const data = await call({
      assembly: {
        name: '부유',
        parts: [
          { id: 'base', type: 'box', material: 'SS400', params: { width: 300, depth: 300, height: 20 }, at: { tx: 0, ty: 0, tz: 0 } },
          { id: 'floater', type: 'box', material: 'SS400', params: { width: 60, depth: 60, height: 60 }, at: { tx: 100, ty: 100, tz: 900 } },
        ],
      },
    });
    expect(data.ok).toBe(true); // 생성은 된다
    expect(data.support?.floating).toContain('floater');
    expect(data.designOk).toBe(false);
  }, heavyTestBudgetMs(30_000));

  it('옹벽 KDS 활동 FAIL 이 쉬운요약까지 도달한다(835eec40 회귀) · 건전 옹벽 과탐 0', async () => {
    const bad = await call({ domain: 'civil', templateId: 'retaining_wall_run', params: { H: 4000, B: 1600, toe: 300 } });
    expect(bad.ok).toBe(true);
    const easyBad = await readFile(bad, '쉬운요약.html');
    expect(easyBad, '쉬운요약 본문이 필요하다').toBeTruthy();
    expect(easyBad!).toContain('활동(미끄러짐)');

    const ok = await call({ domain: 'civil', templateId: 'retaining_wall_run', params: { H: 3000, B: 2000, toe: 1200 } });
    const easyOk = await readFile(ok, '쉬운요약.html');
    expect(easyOk!).not.toContain('활동(미끄러짐)');
  }, heavyTestBudgetMs(45_000));
});

/**
 * ★ **요청 언어를 못 들어줬으면 문서에 적는다** (260802).
 *
 * 종전엔 `options.lang === 'en'` 하나만 알아들었다 — `es` 로 요청하면 **조용히 무시**되고
 * 한국어 패키지가 그대로 나갔다. 「요청이 없었던 것」과 「요청을 못 들어준 것」은 다르다.
 * 실측 배경: `labelKo 836 · labelEn 86` — 영어조차 약 10%이고 ja·zh·es·ar 은 0이다.
 */
describe('POST /api/nexyfab/drawing/package — 산출물 언어 고지', () => {
  it('★es 로 요청하면 **스페인어로** 「본문은 한국어」라고 고지한다', async () => {
    const data = await call({ assembly: BASE_PLATE, options: { title: '테스트', lang: 'es' } });
    expect(data.ok).toBe(true);
    const guide = await readFile(data, '00_안내.html');
    expect(guide, '안내문이 없다').toBeTruthy();
    // 읽을 수 있는 언어로 적혀야 고지다 — 한국어로만 적으면 스페인어 사용자는 못 읽는다.
    expect(guide!, '스페인어 고지가 없다').toContain('coreano');
    expect(guide!).toContain('Idioma del documento');
    const summary = await readFile(data, 'summary.json');
    const parsed = JSON.parse(summary!) as { documentLang?: { requested?: string; content?: string; coverage?: string } };
    expect(parsed.documentLang, 'summary.json 에 언어 상태가 없다 — 기계로 받는 쪽은 한국어인 줄 모른다').toBeTruthy();
    expect(parsed.documentLang!.requested).toBe('es');
    expect(parsed.documentLang!.content).toBe('ko');
    expect(parsed.documentLang!.coverage).toBe('none');
  }, heavyTestBudgetMs(60_000));

  it('★en 은 partial 이다 — 「번역됨」으로 부풀리지 않는다', async () => {
    const data = await call({ assembly: BASE_PLATE, options: { title: '테스트', lang: 'en' } });
    const summary = await readFile(data, 'summary.json');
    const parsed = JSON.parse(summary!) as { documentLang?: { coverage?: string } };
    expect(parsed.documentLang!.coverage).toBe('partial');
    const guide = await readFile(data, '00_안내.html');
    expect(guide!).toContain('not a translated document');
  }, heavyTestBudgetMs(60_000));

  it('★ar 요청은 아랍어 RTL 고지와 언어 메타데이터를 보존한다', async () => {
    const data = await call({ assembly: BASE_PLATE, options: { title: '테스트', lang: 'ar' } });
    const guide = await readFile(data, '00_안내.html');
    expect(guide).toContain('dir="rtl"');
    const parsed = JSON.parse((await readFile(data, 'summary.json'))!) as { documentLang?: { requested?: string; content?: string; coverage?: string } };
    expect(parsed.documentLang?.requested).toBe('ar');
    expect(parsed.documentLang?.content).toBe('ko');
    expect(parsed.documentLang?.coverage).toBe('none');
  }, heavyTestBudgetMs(60_000));

  it('언어를 안 주면 고지가 없다 — 할 말이 없을 때 만들어 내지 않는다', async () => {
    const data = await call({ assembly: BASE_PLATE, options: { title: '테스트' } });
    const guide = await readFile(data, '00_안내.html');
    expect(guide!).not.toContain('Idioma del documento');
    const parsed = JSON.parse((await readFile(data, 'summary.json'))!) as { documentLang?: { requested?: string | null } };
    expect(parsed.documentLang!.requested).toBeNull();
  }, heavyTestBudgetMs(60_000));
});
