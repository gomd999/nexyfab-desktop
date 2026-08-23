/**
 * R2-⑨ 컨베이어 · ⑩ 송전탑 템플릿 회귀(260719).
 * 컨베이어=지지 체인 완결(mount 선언·측면 체결) — B1 확정 간섭 0.
 * 송전탑=angle 격자(경사 주주재=E1 헐 투영) — 교차부 랩 규칙으로 확정 간섭 0.
 */
import { describe, it, expect } from 'vitest';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { buildAssembly } from './assembly.mjs';
import { refineInterferencesMesh } from './interference-refine.mjs';
import { ga2dDrawing as _ga2d } from './package.mjs';

const ga2dDrawing = _ga2d as unknown as (asm: unknown, opts?: Record<string, unknown>) => string;
type Built = { ok: boolean; designOk: boolean; interferences: { a: string; b: string }[]; contacts: { a: string; b: string; note: string }[]; support: { floating: string[] }; collisionAudit: { declarationErrors: Array<{ code: string }> } };
type Refined = { interferences: unknown[]; laps: { a: string; b: string }[]; demoted: unknown[] };

describe('R2-⑨ 컨베이어', () => {
  it('벨트: 게이트·지지 완결(designOk) + B1 확정 간섭 0 + 풀리/모터 구성', async () => {
    const asm = buildAssemblyTemplate('mech', 'conveyor', {});
    const b = buildAssembly(asm) as Built;
    expect(b.ok).toBe(true);
    expect(b.designOk).toBe(true);
    expect(asm.parts.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(['pulley_head', 'pulley_tail', 'belt', 'drive_motor']));
    const r = (await refineInterferencesMesh(asm, b.interferences)) as Refined;
    expect(r.interferences).toHaveLength(0);
  }, 120_000);
  it('롤러: designOk + 롤러 수=피치 산식 + 벨트/풀리 없음', () => {
    const asm = buildAssemblyTemplate('mech', 'conveyor', { kind: 'roller', length: 4000, rollerPitch: 300 });
    const b = buildAssembly(asm) as Built;
    expect(b.designOk).toBe(true);
    expect(asm.conveyorMeta.kind).toBe('roller');
    expect(asm.conveyorMeta.rollers).toBeGreaterThanOrEqual(12);
    expect(asm.parts.some((p: { id: string }) => p.id === 'belt')).toBe(false);
  });
});

describe('R2-⑩ 송전탑', () => {
  it('격자 형상은 생성되지만 gusset 없는 깊은 절점 선언은 release HOLD + E1 헐 투영', async () => {
    const asm = buildAssemblyTemplate('mech', 'transmission_tower', { panels: 3, height: 15000 });
    const b = buildAssembly(asm) as Built;
    expect(b.ok).toBe(true);
    // connectedWith는 접합 후보일 뿐이다. 실제 gusset/볼트/용접 형상 없이 깊이 교차한
    // 부재는 더 이상 선언만으로 release PASS가 되지 않는다.
    expect(b.designOk).toBe(false);
    expect(b.interferences.length).toBeGreaterThan(0);
    expect(b.collisionAudit.declarationErrors.some(error => error.code === 'DECLARED_JOINT_GEOMETRY_MISMATCH')).toBe(true);
    const r = (await refineInterferencesMesh(asm, b.interferences)) as Refined;
    expect(r.interferences.length).toBeGreaterThan(0);
    expect(r.laps).toHaveLength(0);
    // 경사 주주재/브레이스 = E1 실윤곽 폴리곤(AABB 사각 아님)
    const ga = ga2dDrawing(asm, { title: 'tower', domain: 'mech' });
    expect((ga.match(/<polygon points=/g) ?? []).length).toBeGreaterThan(20);
  }, 300_000);
  it('절점 선언을 제거하면 같은 격자 교차가 확정 간섭으로 남는다(fail-closed)', async () => {
    const asm = buildAssemblyTemplate('mech', 'transmission_tower', { panels: 3, height: 15000 });
    const undeclared = {
      ...asm,
      parts: asm.parts.map(({ connectedWith: _connectedWith, ...part }: { connectedWith?: string[]; [key: string]: unknown }) => part),
    };
    const b = buildAssembly(undeclared) as Built;
    expect(b.designOk).toBe(false);
    expect(b.interferences.length).toBeGreaterThan(0);
    const r = (await refineInterferencesMesh(undeclared, b.interferences)) as Refined;
    expect(r.interferences.length).toBeGreaterThan(0);
    expect(r.laps).toHaveLength(0);
  }, 300_000);
});
