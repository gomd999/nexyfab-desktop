/**
 * dxfCorpusEval.test.ts — **벡터 2D 도면 경로를 실도면으로** 잰다 (260731).
 *
 * ## 왜 만들었나
 * `gate2d.test.ts` 는 이 경로를 잘 검사한다 — 왕복 검증 + 변조 3종 + 증거 없음=UNAVAILABLE.
 * 다만 대상이 **손으로 만든 합성 DXF 한 장**이다. 실도면은 레이어·블록·유닛 선언·
 * 인코딩이 전부 제각각이고, 그 다양성은 합성 픽스처가 재현하지 못한다.
 *
 * ## 무엇을 재는가 — 세 상태를 구별해서
 * ```
 *   인입 성공   →  증거 있음  →  왕복 PASS   ← 여기까지 와야 「읽었다」
 *                              →  왕복 FAIL   ← 잘못 해석했다
 *                 →  증거 없음(UNAVAILABLE)   ← 판정 불가 — **통과가 아니다**
 *   인입 실패                                  ← 못 읽었다
 * ```
 * ⚠ `UNAVAILABLE` 을 통과로 세면 「전부 잘 읽는다」가 된다. 분리해서 보고한다.
 *
 * ## ⚠️ 라이선스
 * 코퍼스는 **로컬 전용·재배포 금지**다. 경로만 읽고 **어떤 파일도 저장소로 복사하지 않는다.**
 * 리포에 남는 것은 수치뿐이다. 코퍼스가 없으면 **skip — 「통과」가 아니다.**
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
// .mjs 하네스 — 경로 수집만 담당한다(타입 추론은 아래 as 로 고정).
import { dxfCorpusFiles } from '../../../scripts/drawing-to-3d/corpus-fixtures.mjs';
import { dxfToIr2d, roundTripVerify2d } from './ingestDxf2d';

const corpus = dxfCorpusFiles() as { files: string[]; tooLarge: string[]; total: number } | null;

(corpus?.files.length ? describe : describe.skip)('실도면 DXF — 벡터 2D 경로 실측', () => {
  it('인입·증거·왕복을 **분리해서** 집계한다 (회귀 방지: 인입 성공률 하락 금지)', async () => {
    const files = corpus!.files;
    const tally = { ingested: 0, failed: 0, pass: 0, fail: 0, unavailable: 0 };
    const coverages: number[] = [];
    const failures: string[] = [];
    const noEvidence: string[] = [];

    for (const p of files) {
      let text: string;
      try { text = readFileSync(p, 'latin1'); } // DXF 는 인코딩이 제각각 — 바이트 보존이 안전
      catch { tally.failed++; failures.push(`${basename(p)}: read`); continue; }

      const r = await dxfToIr2d(text);
      if (!r.ok || !r.ir2d) { tally.failed++; failures.push(`${basename(p)}: ${r.reason ?? 'ingest'}`); continue; }
      tally.ingested++;

      const g = await roundTripVerify2d(r.ir2d);
      if (g.coverage) coverages.push(g.coverage.ratio);
      if (g.status === 'unavailable') { tally.unavailable++; noEvidence.push(basename(p)); }
      else if (g.mismatches === 0) tally.pass++;
      else { tally.fail++; failures.push(`${basename(p)}: ${g.mismatches} mismatch`); }
    }

    const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '표본 없음');
    console.log('\n=== 실도면 DXF 실측 ===');
    console.log(` 코퍼스 ${corpus!.total}장 중 측정 ${files.length}장 (과대 제외 ${corpus!.tooLarge.length}장 — 무시가 아니라 제외)`);
    console.log(` 인입 성공        ${tally.ingested}/${files.length} (${pct(tally.ingested, files.length)})`);
    console.log(` └ 왕복 PASS      ${tally.pass}/${tally.ingested} (${pct(tally.pass, tally.ingested)})`);
    console.log(` └ 왕복 FAIL      ${tally.fail}`);
    console.log(` └ UNAVAILABLE    ${tally.unavailable}  ← 증거 부족으로 **판정 불가**(통과 아님)`);
    /**
     * ⚠ **PASS 를 「도면을 다 담았다」로 읽지 않기 위한 줄.** 왕복이 증명하는 것은
     *   「치수·원·범위가 살아남았다」이지 「ARC·SPLINE 까지 재현했다」가 아니다.
     *   이 숫자를 같이 내지 않으면 87.5% PASS 가 과고지가 된다.
     */
    if (coverages.length) {
      const sorted = [...coverages].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      console.log(` 포착 범위(중앙값)  ${(med * 100).toFixed(1)}%  ← 우리 2D 모델이 재현하는 타입의 비중`);
      console.log(`   최저 ${(sorted[0] * 100).toFixed(1)}% / 최고 ${(sorted.at(-1)! * 100).toFixed(1)}%  — PASS 는 「치수가 맞다」이지 「도면 전체를 담았다」가 아니다`);
    }
    if (failures.length) console.log(' 실패:', failures.slice(0, 8).join(' | '));
    if (noEvidence.length) console.log(' 증거없음:', noEvidence.slice(0, 8).join(' | '));

    /**
     * ⚠ 기준선은 **현재 실측**으로 잡는다 — 목표치를 지어내지 않는다.
     *   260731 실측(16장): 인입 16/16 · 왕복 PASS 14 · FAIL 0 · UNAVAILABLE 2.
     * ⚠ 코퍼스는 개인 로컬이라 **장수가 달라질 수 있다.** 절대 개수로 잠그면 파일 하나
     *   지웠을 때 무관한 실패가 난다 — **비율**로 잠근다.
     * ⚠ `fail`(오해석)은 0 이었다. 그건 **0 으로 잠근다** — 늘어나면 진짜 회귀다.
     */
    expect(tally.ingested / files.length, `인입 성공 ${tally.ingested}/${files.length} — 실패: ${failures.slice(0, 3).join(' | ')}`)
      .toBeGreaterThanOrEqual(Number(process.env.DXF_CORPUS_MIN_INGEST_RATE ?? 1));
    expect(tally.fail, `왕복 오해석 ${tally.fail}건 — ${failures.slice(0, 3).join(' | ')}`).toBe(0);
    // 측정 자체가 성립했는지 — 0장이면 위 숫자는 전부 무의미하다.
    expect(files.length).toBeGreaterThan(0);
  }, 600_000);
});

if (!corpus?.files.length) {
  describe('실도면 DXF', () => {
    it.skip('코퍼스 없음 — **skip 은 통과가 아니다**(NEXYFAB_CAD_CORPUS_WIDE 로 지정)', () => {});
  });
}
