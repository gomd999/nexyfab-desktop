/**
 * 벽 + 골조 혼합구조의 횡력 분담 (260729, 계획 P1-6 — 마지막 잔존 항목).
 *
 * `commercial_massing` 은 기둥 24본이 전부 **1열**(6×1×4층)이고 벽이 43장인 상가 건물이다.
 * 라멘도 벽식도 아닌 혼합이라 두 검사 어디에도 온전히 걸리지 않았고, 실측해 보니
 * 결함이 다섯 겹으로 쌓여 있었다. 전부 「없는 기능」이 아니라 **있는 것이 안 닿는** 형태였다.
 *
 *  ① 층별 벽 조각을 연직으로 잇지 못해 43장 중 7장만 세고 36장을 버렸다
 *  ② 그 탓에 4층 건물의 전체높이를 **1층 높이 4.2m** 로 잡았다 → 밑면전단 V 자체가 틀렸다
 *  ③ 기둥을 횡력저항 요소로 **아예 보지 않아** 벽 분담이 언제나 100% 로 나왔다
 *  ④ `shear_wall` 계산기가 `frameStiffness_kNmm` 를 받는데 그 입력이 한 번도 채워지지 않았다
 *  ⑤ `loadPathCheck` 는 "벽·일방향 골조는 별도 검토가 필요하다"고 적어놓고
 *     `notApplicable` 을 안 달아 **그 별도 검토를 부르지 않았다**
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { shearWallCheck } from './shear-wall-check.mjs';
import { domainSafetyVerdict } from './domain-dossier-verify.mjs';

type Chk = { pass: boolean | null; labelKo?: string; detail?: string[]; frameShare?: number };
type SW = {
  ok: boolean; label?: string;
  checks?: Record<string, Chk>;
  basis?: {
    lateralWalls: number; dirX: number; dirY: number; wallParts: number; stacks: number;
    frameColumns: number; frameK_kNmm: { X: number; Y: number };
    hn_m: number; storyH1_mm: number; storyShear_kN: number; multiStory: boolean;
  };
} | null;
const sw = (id: string, p: unknown = { seismic: { R: 4 } }) =>
  (shearWallCheck as unknown as (a: unknown, p: unknown) => SW)(buildAssemblyTemplate('building', id, {}), p);

describe('① 층별 벽 조각을 연직으로 잇는다', () => {
  const r = sw('commercial_massing');

  it('벽 부품 43장이 스택으로 병합된다 — 조각 수와 부재 수는 다르다', () => {
    expect(r?.basis?.wallParts).toBe(43);
    expect(r?.basis?.stacks).toBeLessThan(43);
    expect(r?.basis?.multiStory).toBe(true);
  });

  it('② 전체높이가 4층 건물의 15m 다 — 종전엔 1층 높이 4.2m 였다', () => {
    expect(r?.basis?.hn_m).toBe(15);
    expect(r?.basis?.storyH1_mm).toBe(3950);
  });

  it('스택 병합 키는 평면 **중심** — 코너로 묶으면 인방이 문설주에 붙는다', () => {
    // elevator_shaft: 문설주(폭 500)와 그 위 상인방(폭 1900)이 둘 다 tx=200 이다.
    // 코너로 묶으면 한 스택(높이 17.4m)이 되어 인방이 캔틸레버 전단벽으로 둔갑했다.
    const e = sw('elevator_shaft');
    expect(e?.basis?.lateralWalls).toBe(3);
  });

  it('경사지붕 건물이 무너지지 않는다 — 「최상단 관통」을 요구하면 전부 탈락한다', () => {
    // gable_house 는 지붕이 경사라 어떤 벽도 건물 최상단에 닿지 않는다.
    // 캔틸레버 요건은 「기초에서 시작해 1층을 관통」이지 「최상단 도달」이 아니다.
    const g = sw('gable_house');
    expect(g?.basis?.lateralWalls).toBe(6);
    expect(g?.basis?.dirX).toBe(4);
    expect(g?.basis?.dirY).toBe(2);
  });

  it('상부 단면이 줄면 **밑면 단면**으로 검토하고 그 사실을 밝힌다', () => {
    // 처음엔 「보수측」이라며 최소 단면을 썼는데 물리 왜곡이었다 — 7000mm 측벽 위에
    // 409mm 박공 조각이 얹히자 벽이 409mm 가 됐다(강성은 lw³ 이라 5000배 과소).
    const g = sw('gable_house');
    expect(g?.checks?.varyingWalls?.detail?.join(' ')).toContain('밑면 단면');
    expect(g?.checks?.dirY?.detail?.join(' ')).toMatch(/φVc 68[0-9.]+kN/); // 7000mm 벽 기준
  });
});

describe('③④ 기둥이 횡력저항 요소로 들어간다', () => {
  const r = sw('commercial_massing');

  it('1층 기둥 6본의 방향별 강성을 낸다', () => {
    expect(r?.basis?.frameColumns).toBe(6);
    expect(r?.basis?.frameK_kNmm.X).toBeGreaterThan(0);
    expect(r?.basis?.frameK_kNmm.Y).toBeGreaterThan(0);
  });

  it('벽이 있는 방향은 벽·골조 분담을 함께 낸다 — 벽 100% 가 아니다', () => {
    const share = r?.checks?.dirX?.frameShare;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(1);
    expect(r?.checks?.dirX?.detail?.join(' ')).toContain('골조(기둥 6본');
  });

  it('보가 없으면 강접으로 치지 않는다 — 강성을 4배 부풀리면 비보수적이다', () => {
    // commercial_massing 의 보(transom)는 전면(ty=0)에 있고 기둥은 ty=11200 이라 안 닿는다.
    expect(r?.checks?.dirX?.detail?.join(' ')).toContain('강접 0본');
  });

  it('지배 부재를 잘라내지 않는다 — 분담 큰 순으로 표시하고 생략을 밝힌다', () => {
    // 선언 순서대로 6개만 보이면 분담 0.0% 인 필라스터만 나오고 99% 를 먹는
    // wall_back 이 7번째라 사라졌다(조용한 절단).
    const first = r?.checks?.dirX?.detail?.[0] ?? '';
    expect(first).toContain('wall_back');
    expect(r?.checks?.dirX?.detail?.join(' ')).toContain('생략');
  });
});

describe('KDS 41 17 00 구조시스템 분류 — 이중골조 요건', () => {
  const r = sw('commercial_massing');

  it('골조 분담 25% 미달이면 이중골조가 아니라고 판정한다', () => {
    const dual = r?.checks?.dualX;
    expect(dual?.pass).toBe(false);
    expect(dual?.detail?.join(' ')).toContain('전단벽 시스템으로 분류');
    expect(dual?.detail?.join(' ')).toContain('설계지진력이 과소평가');
  });

  it('한 열뿐인 기둥은 모멘트골조로 보지 않는다', () => {
    // X방향은 기둥 6본이 한 선상(ty=11200)에 늘어서 있어 프레임 자체는 성립 가능하다
    // — 다만 보가 안 닿아 강접이 아니다. 「1열」 경고가 붙는 쪽은 Y방향이다.
    expect(r?.checks?.dualX?.detail?.join(' ')).not.toContain('한 열뿐이라');
    expect(r?.checks?.dirY?.detail?.join(' ')).toContain('한 축(1열)');
  });

  it('벽이 없는 방향은 「판정 불가」가 아니라 「골조 단독」이다', () => {
    const y = r?.checks?.dirY;
    expect(y?.labelKo).toContain('골조 단독');
    expect(y?.detail?.join(' ')).toContain('전량을 부담');
    expect(y?.detail?.join(' ')).toContain('역추형');
  });
});

describe('비틀림 — 사실은 내되 단정하지 않는다', () => {
  const r = sw('commercial_massing');

  it('강성중심이 배면으로 쏠린 것을 잡아낸다', () => {
    const t = r?.checks?.torsion?.detail?.join(' ') ?? '';
    expect(t).toContain('X방향');
    expect(t).toMatch(/편심 4\.\d+m/);
  });

  it('기둥도 강성중심에 넣는다 — 벽 없는 축의 편심이 통째로 누락되면 안 된다', () => {
    expect(r?.checks?.torsion?.detail?.join(' ')).toContain('Y방향: 강성중심');
  });

  it('대칭 구조는 편심 0 — 코너 좌표로 재면 대칭인데도 치우쳐 나온다', () => {
    const w = sw('water_tank');
    expect(w?.checks?.torsion?.detail?.[0]).toContain('편심 0.00m');
  });

  it('「비틀림 비정형」이라고 단정하지 않는다 — 층간변위비는 3D 해석 항목이다', () => {
    expect(r?.checks?.torsion?.pass).toBeNull();
    expect(r?.checks?.torsion?.detail?.join(' ')).toContain('산출하지 않았다');
  });
});

describe('⑤ 디스패치 — 「별도 검토가 필요하다」고 적었으면 그 검토를 불러야 한다', () => {
  const verdict = (p: unknown) => (domainSafetyVerdict as unknown as (a: unknown, p: unknown) =>
    { label: string; ok: boolean } | null)(buildAssemblyTemplate('building', 'commercial_massing', {}), p);

  it('1열 기둥 건물이 벽식 횡력 검토로 넘어간다', () => {
    expect(verdict({ seismic: { R: 4 } })?.label).toContain('벽식 횡력 검토');
  });

  it('연직 하중경로를 검토하지 않았다는 사실이 **소비자에 도달**한다', () => {
    // checks 에만 넣으면 사라진다 — domainSafetyVerdict 는 checks 를 넘기지 않는다.
    const v = (domainSafetyVerdict as unknown as (a: unknown, p: unknown) =>
      { unavailable?: string[] } | null)(
      buildAssemblyTemplate('building', 'commercial_massing', {}), { seismic: { R: 4 } });
    expect((v?.unavailable ?? []).join(' ')).toContain('연직이 확인된 것이 아닙니다');
    // 항목 형태가 어긋나면 "undefined: undefined" 로 나간다 — 그것도 막는다.
    expect((v?.unavailable ?? []).join(' ')).not.toContain('undefined');
  });

  it('격자 라멘은 종전대로 하중경로 검토 — 회귀 없음', () => {
    const v = (domainSafetyVerdict as unknown as (a: unknown, p: unknown) => { label: string } | null)(
      buildAssemblyTemplate('building', 'rc_frame', {}), {});
    expect(v?.label).toContain('하중경로');
  });
});

describe('검증 입력이 두 생성 사이트 모두에 도달한다 (260729)', () => {
  it('params 를 주면 안전검토 HTML 내용이 달라진다 — 「입력 필요」로 굳지 않는다', async () => {
    const dv = await import('./domain-dossier-verify.mjs');
    const html = dv.domainSafetyReportHtml as unknown as
      (a: unknown, o: { title?: string; params?: unknown }) => string | null;
    const a = buildAssemblyTemplate('building', 'commercial_massing', {});
    const bare = html(a, { title: 't', params: {} }) ?? '';
    const given = html(a, { title: 't', params: { seismic: { R: 4 } } }) ?? '';
    expect(bare).not.toContain('이중골조');
    expect(given).toContain('이중골조');
    expect(given).toContain('강성중심');
  });

  it('웹 패키지 라우트가 검증 params 를 배선한다 — `{}` 고정이면 영원히 「입력 필요」다', async () => {
    // ⚠ 이건 소스 계약 검사다. 260729 실측: 이 라우트는 domainSafetyVerdict/ReportHtml 에
    //   빈 객체를 넘기고 있어 **R·V0·usage 가 있어도 도달하지 않았다** — MCP 쪽에서 고친
    //   verifyParams 결함의 웹 쪽 쌍둥이. 두 생성 사이트는 대칭이어야 한다.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/app/api/nexyfab/drawing/package/route.ts', 'utf8');
    expect(src).toContain('body.verifyParams');
    expect(src).toContain('dv.domainSafetyVerdict(assembly, verifyParams)');
    expect(src).toContain('dv.codeVerificationVerdict(assembly, verifyParams)');
    expect(src).not.toContain('dv.domainSafetyVerdict(assembly, {})');
  });
});

describe('제네릭 렌더러가 문자열 배열을 버리지 않는다 (260729)', () => {
  const html = async (id: string, domain = 'building') => {
    const dv = await import('./domain-dossier-verify.mjs');
    const fn = dv.domainSafetyReportHtml as unknown as
      (a: unknown, o: { title?: string; params?: unknown }) => string | null;
    return fn(buildAssemblyTemplate(domain, id, {}), { title: 't', params: { seismic: { R: 4 } } }) ?? '';
  };

  it('detail 문장이 "#1 #2 #3" 로 뭉개지지 않는다 — 라이브에서 실제로 그랬다', async () => {
    // 렌더러가 스칼라를 빈 문자열로 버려서, 판정은 도달했는데 **본문이 통째로 사라졌다**.
    // "전단벽 시스템으로 분류해야 한다" 같은 핵심 경고가 안전검토.html 에 한 글자도 없었다.
    const h = await html('commercial_massing');
    const t = h.replace(/<[^>]+>/g, ' ');
    expect(t).toContain('전단벽 시스템으로 분류');
    expect(t).toContain('설계지진력이 과소평가');
    expect(t).toContain('역추형');
    expect(t).toContain('wall_back_1');
  });

  it('마크업이 원문 그대로 새지 않는다 — `**강조**` 는 <b> 로', async () => {
    for (const [dom, id] of [['building', 'commercial_massing'], ['building', 'gable_house'],
      ['interior', 'studio_unit'], ['landscape', 'timber_deck'], ['bridge', 'girder_bridge']] as const) {
      const t = (await html(id, dom)).replace(/<[^>]+>/g, ' ');
      expect(t, `${dom}/${id}`).not.toContain('**');
    }
  });

  it('다른 도메인도 같은 렌더 경로 — 문서가 계속 나온다', async () => {
    for (const [dom, id] of [['interior', 'studio_unit'], ['landscape', 'timber_deck'],
      ['bridge', 'girder_bridge']] as const) {
      expect((await html(id, dom)).length, `${dom}/${id}`).toBeGreaterThan(1000);
    }
  });
});
