/**
 * 표준 시험 파일 회귀 (260729) — 로컬 코퍼스가 있을 때만 돈다.
 *
 * ⚠️ 코퍼스는 **로컬 전용·라이선스 제한**이라 저장소에 어떤 파일도 넣지 않는다.
 *    없으면 `skip` — 「통과」로 세지 않는다.
 *
 * 여기서 지키는 것은 **정답 수치가 아니라 불변식**이다. NIST 변형본은 서로 다른 CAD
 * 시스템의 내보내기라 부피가 정말 다르다(실측 최대 4.97%) — 「형식 간 부피 일치」는
 * 지킬 수 없는 약속이고, 지어내면 안 된다. 대신:
 *   ① 임포트 커버리지(32/33, 실패 1건은 이름과 사유로 고정)
 *   ② 경계 측정 방식의 건전성 — 이 회귀가 실제로 결함을 찾아냈다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { corpusRoot, nistParts, pcertScenes, measureStepFile, measureClassifierCoverage } from './corpus-fixtures.mjs';
import { importStep } from '@/lib/brep-bridge/stepImport';

const root = (corpusRoot as unknown as () => string | null)();
const d = root ? describe : describe.skip;
if (!root) {
  // eslint-disable-next-line no-console
  console.warn('[corpus] 로컬 코퍼스 없음 — 표준 시험 파일 회귀 skip(통과 아님). NEXYFAB_CAD_CORPUS 로 지정 가능.');
}

d('NIST-PMI 33건 — STEP 임포트 커버리지', () => {
  it('16개 부품군·33개 파일이 잡힌다', () => {
    const parts = (nistParts as unknown as () => Map<string, string[]>)();
    expect(parts.size).toBe(16);
    expect([...parts.values()].reduce((a, b) => a + b.length, 0)).toBe(33);
  });

  it('AP242 tessellated-geometry(-tg) 1건만 실패한다 — 나머지 32건 임포트', async () => {
    const parts = (nistParts as unknown as () => Map<string, string[]>)();
    const failed: string[] = [];
    let ok = 0;
    for (const files of parts.values()) {
      for (const f of files) {
        try {
          const m = await (measureStepFile as unknown as (f: string, e: unknown, r: unknown) => Promise<{ volumeMm3: number }>)(
            f, (await import('./to-step.mjs')).ensureReplicad, readFileSync);
          expect(m.volumeMm3).toBeGreaterThan(0);
          ok++;
        } catch { failed.push(f.split(/[\\/]/).pop() as string); }
      }
    }
    expect(ok).toBe(32);
    // 실패는 **이름으로** 고정한다 — 「몇 건 실패」만 세면 다른 파일이 깨져도 통과한다.
    expect(failed).toEqual(['nist_ftc_08_asme1_ap242-e1-tg.stp']);
  }, 900_000);
});

d('경계 측정 — Bnd_Box 는 실 경계가 아니다', () => {
  it('nist_ctc_01 은 실측 800×450×150, Bnd_Box 는 1170×650×150 (+46%)', async () => {
    const { ensureReplicad, stepFileBounds } = await import('./to-step.mjs');
    const parts = (nistParts as unknown as () => Map<string, string[]>)();
    const f = (parts.get('nist_ctc_01') as string[]).find((x) => /_rd\.stp$/i.test(x)) as string;

    const b = await (stepFileBounds as unknown as (f: string) => Promise<{
      min: number[]; max: number[]; basis: string; occt: { min: number[]; max: number[] }; occtInflatePct?: number[];
    }>)(f);
    const size = b.max.map((v, k) => Math.round(v - b.min[k]));
    const occtSize = b.occt.max.map((v, k) => Math.round(v - b.occt.min[k]));

    expect(b.basis).toBe('mesh_measured');
    expect(size.slice().sort((x, y) => x - y)).toEqual([150, 450, 800]);   // 공칭치로 떨어진다
    expect(occtSize.slice().sort((x, y) => x - y)).toEqual([150, 650, 1170]); // Bnd_Box 는 부풀어 있다
    expect(Math.max(...(b.occtInflatePct ?? [0]))).toBeGreaterThan(40);
    void ensureReplicad;
  }, 300_000);

  it('부풀지 않은 파일에는 고지를 붙이지 않는다 — 과고지 금지', async () => {
    const { stepFileBounds } = await import('./to-step.mjs');
    const parts = (nistParts as unknown as () => Map<string, string[]>)();
    const f = (parts.get('nist_ctc_02') as string[]).find((x) => /ap242/i.test(x)) as string;
    const b = await (stepFileBounds as unknown as (f: string) => Promise<{ occtInflatePct?: number[]; note?: string }>)(f);
    expect(b.occtInflatePct).toBeUndefined();
    expect(b.note).toBeUndefined();
  }, 300_000);
});

d('buildingSMART PCERT — 씬 9종이 IFC4·IFC4.3 양쪽에 있다', () => {
  it('짝이 다 맞는다', () => {
    const sc = (pcertScenes as unknown as () => Map<string, { ifc4?: string; ifc4x3?: string }>)();
    expect(sc.size).toBe(9);
    expect([...sc.values()].filter((v) => v.ifc4 && v.ifc4x3)).toHaveLength(9);
  });
});

d('buildingSMART PCERT — IFC4 테셀레이션 임포트 (260729b)', () => {
  const imp = async (file: string) => {
    const { readFileSync } = await import('node:fs');
    const { ifcToNexyfabAssembly } = await import('@/lib/brep-bridge/ifcImport');
    return ifcToNexyfabAssembly(readFileSync(file, 'latin1'), { name: 'pcert' });
  };
  const scenes = () => (pcertScenes as unknown as () => Map<string, { ifc4: string; ifc4x3: string }>)();

  it('★공식 인증 세트가 임포트된다 — 종전엔 18파일 전부 0건이었다', async () => {
    // 형상이 전부 `IfcTriangulatedFaceSet` 이고 좌표가 `IfcCartesianPointList3D` 에 있는데
    // 점 스캔이 그 형태를 몰라 폐포가 비었다. IFC2X3 코퍼스(17,269부품)는 개별 점을 써서
    // 이 구멍이 드러나지 않았다 — **다른 표현을 쓰는 파일군에서만 나타나는 한계**였다.
    let total = 0;
    for (const v of scenes().values()) total += (await imp(v.ifc4)).stats?.imported ?? 0;
    expect(total).toBeGreaterThan(280);
  }, 600_000);

  it('★전 씬에서 IFC4 ↔ IFC4.3 임포트 수가 일치한다', async () => {
    // 260729c: IFC4.3 인프라 클래스(IfcTrackElement·IfcRail·IfcCourse·IfcEarthworksFill·
    // IfcGeographicElement 등)를 넣기 전에는 Rail 73→1 · Road 33→1 로 무너졌다.
    // 지원을 넓히자 **9개 씬 전부** 같아졌다 — 이제 이것이 지킬 수 있는 불변식이다.
    for (const [name, v] of scenes()) {
      const a = (await imp(v.ifc4)).stats?.imported ?? 0;
      const b = (await imp(v.ifc4x3)).stats?.imported ?? 0;
      expect(b, name).toBe(a);
      expect(a, name).toBeGreaterThan(0);
    }
  }, 900_000);

  it('공간 구조는 부품으로 세지 않는다 — 세면 부피·질량이 허구가 된다', async () => {
    // IfcRoad·IfcRoadPart 는 IfcFacility/IfcFacilityPart(건물의 IfcBuilding 자리)다.
    // 형상 표현이 있어도 그것은 **영역 경계**이지 부재가 아니고, 자식과 이중 계상된다.
    const r = await imp(scenes().get('Infra-Road')!.ifc4x3);
    const skips = Object.keys(r.stats?.skipByClass ?? {});
    expect(skips.join(' ')).toContain('IFCROADPART:spatial');
    expect(Object.keys(r.stats?.byClass ?? {})).not.toContain('IFCROAD');
  }, 300_000);

});

d('PCERT — 실형상 부피 복원 (260729c)', () => {
  const imp = async (file: string) => {
    const { readFileSync } = await import('node:fs');
    const { ifcToNexyfabAssembly } = await import('@/lib/brep-bridge/ifcImport');
    return ifcToNexyfabAssembly(readFileSync(file, 'latin1'), { name: 'pcert' });
  };
  const scenes = () => (pcertScenes as unknown as () => Map<string, { ifc4: string; ifc4x3: string }>)();

  it('삼각 메시 요소는 `mesh` 로 나가고 **부피가 실측**이다', async () => {
    const r = await imp(scenes().get('Building-Structural')!.ifc4);
    const parts = r.assembly?.parts ?? [];
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((p) => p.type === 'mesh')).toBe(true);
    for (const p of parts) {
      const v = (p.params as { volumeMm3: number }).volumeMm3;
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual((p.boxVolumeMm3 ?? Infinity) * 1.001);  // 실부피 ≤ AABB
      expect(p.meshVolumeExact).toBe(true);
    }
  }, 300_000);

  it('★AABB 부피는 크게 과대였다 — 최대 58배(실측)', async () => {
    // 좌표와 면 인덱스가 다 있는데 박스로 뭉개면 **있는 정보를 버리는 것**이다.
    // 부피가 틀리면 질량·물량·원가가 전부 틀린다.
    const r = await imp(scenes().get('Infra-Plumbing')!.ifc4);
    const p = (r.assembly?.parts ?? [])[0];
    const ratio = (p.params as { volumeMm3: number }).volumeMm3 / (p.boxVolumeMm3 ?? 1);
    expect(ratio).toBeLessThan(0.05);          // 실측 0.017 = 58배 과대
  }, 300_000);

  it('형상은 여전히 AABB 다 — 부피 실측과 형상 근사를 구별해 적는다', async () => {
    const r = await imp(scenes().get('Infra-Rail')!.ifc4x3);
    const p = (r.assembly?.parts ?? [])[0];
    const aabb = (p.params as { aabb: { min: number[]; max: number[] } }).aabb;
    expect(aabb.max.every((v, i) => v > aabb.min[i])).toBe(true);
    expect(r.assembly?.importedApprox).toBe(true);   // 근사임을 계속 밝힌다
  }, 300_000);
});


d('★ 구멍 뚫린 판 임포트 (260801c)', () => {
  /**
   * 원호 근사 후 미지원 사유 1위가 `(N CYLINDRICAL_SURFACE, N PLANE)` **22건**이었다.
   * 실물에서 이건 거의 항상 **판재 + 원형 홀**(볼트홀·보스·경량화)이다.
   *
   * ⚠ **홀을 형상으로 넣지는 못한다** — IR 프로파일이 단일 루프고, 소비부는 노드마다
   *   독립 바디로 배치해 노드 간 부울을 하지 않는다. 외곽·두께만 정확히 받고
   *   홀은 개수·반경·부피 과대율을 **수치로 고지**한다.
   *
   * ⚠⚠ 이 회귀를 쓰다 **측정 도구의 버그**를 찾았다 — `measureClassifierCoverage` 가
   *   `r.nodes`(없는 필드)를 읽어 **항상 0** 을 냈다. 「코퍼스 바디 0」이라는 보고가
   *   여러 번 나갔고 원호 근사의 효과를 「없다」로 읽었다. 실제 대조: **바디 2 → 12**.
   *   측정 도구를 고정하는 것만으로는 부족하고 **한 번은 반대로 검증**해야 한다.
   */
  it('판+홀 솔리드가 외곽·두께로 임포트되고 홀은 수치로 고지된다', () => {
    const files = nistParts(root!);
    void files;
    const cov = (measureClassifierCoverage as unknown as (i: unknown, rf: unknown) => {
      withBodies: number; bodies: number; reasons: Array<[string, number]>;
    } | null)(importStep as unknown, readFileSync as unknown);
    expect(cov).not.toBeNull();
    // 260801c 실측: 바디 2 → 12. 개선분이 사라지면 잡는다(정확한 수는 코퍼스에 달렸다).
    expect(cov!.bodies).toBeGreaterThanOrEqual(12);
    // 판+홀 사유는 22 → 12 로 줄었다. 늘어나면 검출기가 퇴행한 것이다.
    const plateHole = cov!.reasons.find(([r]) => /CYLINDRICAL_SURFACE/.test(r));
    expect(plateHole?.[1] ?? 0).toBeLessThanOrEqual(12);
  }, 900_000);

  it('★측정 도구가 **바디를 실제로 센다** — `r.nodes` 를 읽던 버그의 회귀', () => {
    // 도구가 0 을 내는데 실제로는 바디가 있는 상태를 다시는 만들지 않는다.
    const cov = (measureClassifierCoverage as unknown as (i: unknown, rf: unknown) => { withBodies: number; bodies: number } | null)(
      importStep as unknown, readFileSync as unknown);
    expect(cov!.withBodies).toBeGreaterThan(0);
    expect(cov!.bodies).toBeGreaterThan(cov!.withBodies - 1);
  }, 900_000);
});
