/**
 * building 잔여 2종의 오분류 (260729).
 *
 * 5개 분야 평가에서 "role 태깅 갭"으로 적어 뒀던 두 건을 형상으로 확인하니
 * **태깅 갭이 아니었다** — 둘 다 검사기의 적용범위 밖이거나 다른 검사의 대상이었다.
 *
 *  · steel_canopy: column14→beam3→rafter14→purlin6. **완결된 하중경로**인데 슬래브가
 *    없다. 캐노피에 슬래브가 없는 것은 정상이라 "태깅 필요"는 없는 부재를 만들라는 뜻.
 *  · duct_run: column4→slab1 직결(무량판, 보 없음)이고 **본체는 덕트 계통**이다.
 *    그리고 duct_sizing 계산기는 어디서도 호출되지 않고 있었다.
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { ductRunCheck } from './duct-run-check.mjs';
import { loadPathCheck } from './load-path.mjs';
import { domainSafetyVerdict } from './domain-dossier-verify.mjs';

type Duct = {
  ok: boolean; label: string; checks: Record<string, { pass: boolean | null; detail: string[] }>;
  sizingUnavailable?: { needInputs: { name: string }[]; messageKo: string };
} | null;
const duct = ductRunCheck as unknown as (a: unknown) => Duct;
const tpl = (id: string) => buildAssemblyTemplate('building', id, {});

describe('덕트 계통 — 형상 자기정합은 판정, 사이징은 정직 거부', () => {
  it('선언 메타와 실제 형상이 일치한다 — 출하 템플릿 오탐 0', () => {
    const r = duct(tpl('duct_run'));
    expect(r?.ok).toBe(true);
    const failed = Object.entries(r!.checks).filter(([, c]) => c.pass === false).map(([k]) => k);
    expect(failed).toEqual([]);
    expect(Object.keys(r!.checks)).toContain('trunkLength');
    expect(Object.keys(r!.checks)).toContain('trunkSection');
  });

  it('메타가 형상과 어긋나면 잡는다 — 규칙이 공허하지 않다', () => {
    const a = tpl('duct_run') as unknown as { ductMeta: Record<string, number> };
    const bad = { ...a, ductMeta: { ...a.ductMeta, trunkW: 999 } };
    expect(duct(bad)?.checks.trunkSection.pass).toBe(false);
  });

  it('사이징은 형상에서 알 수 없는 것만 요구한다 — 풍량·허용유속', () => {
    const s = duct(tpl('duct_run'))?.sizingUnavailable;
    expect(s?.needInputs.map((x) => x.name)).toEqual(['duct.flowCMH', 'duct.velocityLimit']);
    expect(s?.messageKo).toContain('"덕트 용량이 충분하다"는 뜻이 아닙니다');
    // 산출한 것은 산출했다고 말한다.
    expect(s?.messageKo).toContain('0.320㎡');
  });

  it('허용 유속 관례로 합·불을 내지 않는다 — 용도마다 다르다', () => {
    expect(duct(tpl('duct_run'))?.checks.sectionInfo.pass).toBeNull();
    expect(duct(tpl('duct_run'))?.checks.hangerInfo.pass).toBeNull();
  });

  it('ductMeta 가 없으면 null — 다른 어셈블리에 덕트 검사를 들이대지 않는다', () => {
    expect(duct(tpl('rc_frame'))).toBeNull();
  });

  it('디스패치: duct_run 은 라멘 검토가 아니라 덕트 검토로 간다', () => {
    const v = (domainSafetyVerdict as unknown as (a: unknown, p: unknown) => { label: string; ok: boolean; unavailable?: string[] } | null)(tpl('duct_run'), {});
    expect(v?.label).toContain('덕트 계통');
    expect(v?.unavailable?.join(' ')).toContain('덕트 사이징');
  });
});

describe('캐노피 — 지붕 골조형은 라멘 검토 대상이 아니다', () => {
  it('사유가 "태깅 필요"가 아니라 적용범위로 바뀐다', () => {
    const r = loadPathCheck(tpl('steel_canopy'), {}) as unknown as { ok: boolean; error: string; notApplicable?: boolean };
    expect(r.ok).toBe(false);
    expect(r.error).toContain('지붕 골조형');
    expect(r.error).not.toContain('role 태깅 필요');
  });

  it('침묵시키지 않는다 — 풍 상향력 안내가 실행 가능한 정보다', () => {
    // 벽식은 shearWallCheck 가 받아 주지만 지붕 골조형은 받아 줄 검사가 없다.
    // notApplicable 로 침묵시키면 이 안내까지 사라진다.
    const r = loadPathCheck(tpl('steel_canopy'), {}) as unknown as { notApplicable?: boolean; error: string };
    expect(r.notApplicable).toBeUndefined();
    expect(r.error).toContain('풍 상향력');
    // ⚠ 260730: 안내가 실행 가능한 정보인지에서 나아가 **실제 검토가 생겼다.**
    //   "V0 를 주고 풍하중 검토를 받는 편이 낫다"고 적어 놓고 정작 받을 검토가 없었다 —
    //   `canopy-check` 신설로 해소. 이제 디스패치가 캐노피 검토로 보낸다.
    const v = (domainSafetyVerdict as unknown as (a: unknown, p: unknown) => { label?: string } | null)(tpl('steel_canopy'), {});
    expect(v?.label).toContain('캐노피 검토');
  });

  it('라멘은 종전대로 판정 — 회귀 없음', () => {
    expect((loadPathCheck(tpl('rc_frame'), {}) as unknown as { ok: boolean }).ok).toBe(true);
  });
});
