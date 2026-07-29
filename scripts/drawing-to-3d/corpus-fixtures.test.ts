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
import { corpusRoot, nistParts, pcertScenes, measureStepFile } from './corpus-fixtures.mjs';

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
