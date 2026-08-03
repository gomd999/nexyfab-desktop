/**
 * step-assembly-tree.test.ts — **STEP 이 진짜 조립 트리인가** (260803).
 *
 * ## 두 가지를 잠근다
 *
 * ### ① NAUO — 트리가 있는가
 * `replicad.exportSTEP` 은 내부 `createAssembly` 가 모든 shape 를 `ShapeTool.NewShape()` 로
 * **최상위 free shape** 로만 등록한다(`AddComponent` 를 한 번도 부르지 않는다). 그래서 우리
 * 출력은 **PRODUCT 25 · NAUO 0** — SOLIDWORKS 에서 파트는 다 보이지만 **평면 나열**이었다.
 * 조립도·BOM·하위조립이 전부 트리에 얹히므로 평면 나열은 「열리기는 한다」 이상이 못 된다.
 * `exportAssemblySTEP` 이 XCAF 로 root→계통→부품 3단을 만든다.
 *
 * ### ② 이름 인코딩 — 어제 고쳤다고 한 것이 실은 안 고쳐졌다
 * 이름을 미리 `stepSafeName` 해서 OCCT 에 넘겼는데, 라이터는 리터럴 이스케이프 층을
 * 자기가 소유해서 우리 `\` 를 `\\` 로 다시 이중화했다:
 * ```
 *   넣은 값  \X2\AD6CC870\X0\   →   파일  \\X2\\AD6CC870\\X0\\   →   화면  \X2\AD6CC870\X0\
 * ```
 * 「파일에 비ASCII 0」만 재고 **디코드해 보지 않아** 통과로 봤다.
 * **바이트 검사는 인코딩 검사가 아니다.** 그래서 이 파일은 커널을 실제로 돌려
 * **디코드까지** 한다 — 순수 인코딩 검사(`step-naming.test.ts`)로는 못 잡는 층이다.
 */

import { describe, expect, it } from 'vitest';
import { buildAssemblyTemplate, listAssemblyTemplates } from './domain-assemblies.mjs';
import { autoTagAssembly, buildAssembly } from './assembly.mjs';
import { ensureReplicad, intentToStep } from './to-step.mjs';

type StepResult = {
  step: string; importNotes: string[];
  tree: { nauo: number; products: number; groups: string[]; reusedInstances?: number } | null;
};

/** 뷰어가 하는 일 — `\X2\…\X0\` 를 되돌린다. 이걸 해봐야 「깨졌는지」를 안다. */
const decode = (s: string) =>
  s.replace(/\\X2\\((?:[0-9A-Fa-f]{4})+)\\X0\\/g, (_m, h: string) =>
    h.match(/.{4}/g)!.map((x) => String.fromCharCode(parseInt(x, 16))).join(''));

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

let cached: StepResult | null = null;
async function stepOnce() {
  if (!cached) {
    const built = buildAssembly(buildAssemblyTemplate('mech', 'desk_stand', {}) as never) as { composeIntent: unknown };
    cached = (await (intentToStep as unknown as (i: unknown) => Promise<StepResult>)(built.composeIntent));
  }
  return cached;
}

describe('★① 조립 트리(NAUO)', () => {
  it('NAUO 가 부품 수만큼 있다 — 0 이면 트리가 아니라 평면 나열이다', async () => {
    const r = await stepOnce();
    expect(r.tree, `트리 경로로 안 나갔다: ${r.importNotes.join(' / ')}`).toBeTruthy();
    expect(count(r.step, /NEXT_ASSEMBLY_USAGE_OCCURRENCE/g)).toBeGreaterThan(0);
    /**
     * NAUO = 부품 25 + 계통 5 = 30. **PRODUCT 와 1:1 이 아니다** — 인스턴스 재사용 뒤로는
     * 반복 부품이 PRODUCT 를 공유하기 때문이다(19 = 고유형상 12 + 계통 5 + 루트 1 + 여유).
     * ⚠ 종전 이 자리에 `nauo === products - 1` 이 있었다. 그건 1 부품 = 1 PRODUCT 시절의
     *   식이고, 재사용을 넣으면서 **의미가 바뀌었다.** 식을 고치는 게 아니라 뜻을 다시 쓴다.
     */
    expect(r.tree!.nauo).toBeGreaterThan(r.tree!.products);
  });

  it('계통이 여러 갈래다 — 전부 한 덩어리면 트리를 만든 뜻이 없다', async () => {
    const r = await stepOnce();
    expect(r.tree!.groups.length).toBeGreaterThan(1);
  });

  /**
   * ★**인스턴스 재사용**(260803) — 같은 형상은 PRODUCT 하나, 위치만 NAUO.
   * desk_stand 25부품의 고유 형상은 12개다(와셔 8·패드 4 등이 반복).
   * 진짜 CAD 가 하는 방식이고, BOM 수량이 자동으로 잡히며 파일이 작아진다(442KB → 265KB).
   * ⚠ **줄어든 만큼 형상이 사라지면 안 된다** — 아래 왕복 검사가 그것을 잡는다.
   */
  it('★반복 부품이 PRODUCT 를 늘리지 않는다 — 1 PRODUCT + N NAUO', async () => {
    const r = await stepOnce();
    expect(r.tree!.reusedInstances, '25부품에 고유 형상 12개면 13개는 인스턴스다').toBeGreaterThan(5);
    // 부품 수(25)보다 PRODUCT 가 적어야 재사용이 실제로 일어난 것이다
    expect(r.tree!.products).toBeLessThan(25);
    expect(count(r.step, /MANIFOLD_SOLID_BREP/g)).toBeLessThan(25);
  });

  it('★NAUO 는 줄지 않는다 — 부품 수만큼 자리가 있어야 한다', async () => {
    const r = await stepOnce();
    expect(r.tree!.nauo).toBe(30); // 부품 25 + 계통 5
  });

  /**
   * ★**PRODUCT 를 줄였는데 부품이 엉뚱한 데 가 있으면 그건 개선이 아니라 파손이다.**
   * 인스턴스 변환(TopLoc_Location)이 맞는지는 **되읽어서** 확인해야 한다 —
   * 엔티티 수만 세면 「작아졌다」와 「망가졌다」를 구별할 수 없다.
   */
  it('★인스턴스 재사용이 위치를 옮기지 않았다 — STEP 을 되읽어 확인', async () => {
    const r = await stepOnce();
    const built = buildAssembly(buildAssemblyTemplate('mech', 'desk_stand', {}) as never) as {
      parts: Array<{ aabb: { min: number[]; max: number[] } }>;
    };
    const dmin = [0, 1, 2].map((k) => Math.min(...built.parts.map((p) => p.aabb.min[k])));
    const dmax = [0, 1, 2].map((k) => Math.max(...built.parts.map((p) => p.aabb.max[k])));
    type BB = { min?: number[]; max?: number[]; bounds?: number[][] };
    const rc = await (ensureReplicad as unknown as () => Promise<{ importSTEP: (b: Blob) => Promise<{ boundingBox: BB }> }>)();
    const shp = await rc.importSTEP(new Blob([r.step]));
    const bb = shp.boundingBox;
    // replicad 판본에 따라 `min/max` 또는 `bounds[0]/[1]` 이다 — 둘 다 받는다.
    const imin = bb.min ?? bb.bounds?.[0];
    const imax = bb.max ?? bb.bounds?.[1];
    expect(imin && imax, 'boundingBox 를 못 읽었다').toBeTruthy();
    for (const k of [0, 1, 2]) {
      expect(Math.abs(imin![k] - dmin[k]), `min[${k}]`).toBeLessThan(1);
      expect(Math.abs(imax![k] - dmax[k]), `max[${k}]`).toBeLessThan(1);
    }
  });

  it('AP242 스키마와 색이 유지된다', async () => {
    const r = await stepOnce();
    expect(r.step).toMatch(/FILE_SCHEMA\s*\(\s*\(\s*'AUTOMOTIVE_DESIGN/);
    expect(count(r.step, /COLOUR_RGB/g)).toBeGreaterThan(0);
  });
});

/**
 * 트리의 **재료**는 `part.system` 이다. 여기가 비면 STEP 트리는 한 덩어리가 되고,
 * 그건 평면 나열과 다를 바 없다 — 그래서 계통 태깅을 카탈로그 전수로 잰다(커널 불필요).
 */
describe('★③ 계통 태깅 — 트리의 재료', () => {
  type Tmpl = { domain: string; id: string };
  type Tagged = { parts: Array<{ system?: string }> };
  const tag = (t: Tmpl) =>
    (autoTagAssembly as unknown as (a: unknown) => Tagged)(buildAssemblyTemplate(t.domain, t.id, {} as never));
  const all = (listAssemblyTemplates as unknown as () => Tmpl[])();

  it('★미분류(\'부품\')로 떨어지는 부품이 하나도 없다', () => {
    const bad: string[] = [];
    for (const t of all) {
      const n = tag(t).parts.filter((p) => p.system === '부품').length;
      if (n) bad.push(`${t.domain}/${t.id}:${n}`);
    }
    // 종전 실측: 48/55 템플릿에 미분류 존재(ceiling_grid 95/95 · parking_pavement 46/46)
    expect(bad, `미분류 role 이 있다 — SYS_ROLE 에 추가하라: ${bad.join(' ')}`).toEqual([]);
  });

  it('모든 부품에 계통이 붙는다 — 빈 값은 트리 노드 이름이 될 수 없다', () => {
    for (const t of all) {
      for (const p of tag(t).parts) expect(p.system, `${t.domain}/${t.id}`).toBeTruthy();
    }
  });

  it('다부품 템플릿 다수가 2갈래 이상으로 갈린다', () => {
    const multi = all.filter((t) => new Set(tag(t).parts.map((p) => p.system)).size >= 2);
    expect(multi.length).toBeGreaterThanOrEqual(40); // 실측 45/55
  });

  it('★계통 1갈래도 정상일 수 있다 — 균질 조립을 억지로 쪼개지 않는다', () => {
    // 옹벽 연장·조적벽·수목식재는 실제로 한 계통이다. 「전부 갈려야 한다」는 규칙이 아니다.
    const single = all.filter((t) => new Set(tag(t).parts.map((p) => p.system)).size <= 1);
    expect(single.length).toBeLessThanOrEqual(15); // 실측 10 — 늘어나면 태깅이 후퇴한 것이다
  });
});

describe('★② 이름 인코딩 — 디코드까지 해서 확인한다', () => {
  it('파일에 raw 비ASCII 가 없다', async () => {
    const r = await stepOnce();
    expect([...r.step].filter((c) => c.charCodeAt(0) > 127).length).toBe(0);
  });

  it('★이중 이스케이프가 없다 — `\\\\X2\\\\` 는 뷰어에 리터럴로 뜬다', async () => {
    const r = await stepOnce();
    expect(count(r.step, /\\\\X2\\\\/g)).toBe(0);
  });

  it('★디코드하면 한글 계통명이 나온다 — 이것이 「안 깨졌다」의 정의다', async () => {
    const r = await stepOnce();
    const names = [...r.step.matchAll(/PRODUCT\('([^']*)'/g)].map((m) => decode(m[1]));
    expect(names).toContain('구조');
    expect(names).toContain('체결');
  });

  it('ASCII 부품명은 그대로 읽힌다', async () => {
    const r = await stepOnce();
    const names = [...r.step.matchAll(/PRODUCT\('([^']*)'/g)].map((m) => decode(m[1]));
    expect(names).toContain('base_plate');
  });
});
