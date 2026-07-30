/**
 * runtime-deps.test.ts — 런타임 이미지에 **필요한 패키지가 들어가는가** (260802).
 *
 * ## 왜 생겼나 — 라이브 실측
 * `GA_3D.html` 이 **라이브에서만** 실패하고 있었다. 사유를 남기게 하고서야 원인이 나왔다:
 * ```
 * Cannot find module 'three'  (/app/scripts/drawing-to-3d/html-render.mjs)
 * ```
 * `html-render.mjs` 는 three.js 를 **data: URL 로 인라인**해 뷰어를 오프라인 자립시키는데
 * (현장 인터넷 없음), 그 참조가 `createRequire` 동적 해석이라 **Next 트레이서가 못 본다.**
 * 런타임 스테이지는 `node_modules` 를 **선별 복사**하므로 목록에 없으면 통째로 빠진다.
 *
 * ⚠ **로컬에서는 재현되지 않는다** — 전체 `node_modules` 가 있기 때문이다.
 *   그래서 「로컬에서 되니 된다」가 통하지 않는 부류이고, 이 검사가 그 자리를 지킨다.
 *
 * ## ⚠ 「빠진 걸 다 넣자」가 아니다
 * `playwright`(시각 회귀)·`sharp`(시험 도면 생성)는 **개발 도구**라 넣지 않는다.
 * 안 쓰는 것을 넣으면 이미지만 커진다 — 제외 근거를 여기 남긴다.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DF = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');
const copied = new Set(
  [...DF.matchAll(/node_modules\/(@[\w.-]+\/[\w.-]+|[\w.-]+) \.\/node_modules/g)].map((m) => m[1]),
);

/** 런타임에 필요 없다고 **판단한** 패키지 — 근거와 함께 둔다(비면 판단이 사라진다). */
const DEV_ONLY: Record<string, string> = {
  playwright: '시각 회귀(visual-golden) — 개발 도구',
  sharp: '시험 도면 생성(gen-drawing) — 시험 데이터, 런타임 산출물 아님',
};

describe('런타임 이미지 의존성', () => {
  it('★scripts/drawing-to-3d 가 쓰는 외부 패키지가 복사되거나 **제외 근거**가 있다', () => {
    const dir = join(process.cwd(), 'scripts', 'drawing-to-3d');
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
      const s = readFileSync(join(dir, f), 'utf8');
      for (const re of [
        /(?:req|require)\.resolve\(\s*['"]([^'"./][^'"]*)['"]/g,
        /await import\(\s*['"]([^'"./][^'"]*)['"]/g,
        /^import .* from ['"]([^'"./][^'"]*)['"]/gm,
        /require\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g,
      ]) {
        for (const m of s.matchAll(re)) {
          const p = m[1]!;
          if (p.startsWith('node:')) continue;
          used.add(p.startsWith('@') ? p.split('/').slice(0, 2).join('/') : p.split('/')[0]!);
        }
      }
    }
    const missing = [...used].filter((p) => !copied.has(p) && !(p in DEV_ONLY));
    expect(missing, `런타임 미복사·근거 없음: ${missing.join(', ')}`).toEqual([]);
  });

  it('★`three` 가 복사된다 — 빠지면 GA_3D 가 라이브에서만 죽는다', () => {
    expect(copied.has('three'), 'three 미복사').toBe(true);
  });

  it('제외 목록이 비어 있지 않다 — 판단을 지우지 않는다', () => {
    // 목록이 비면 「전부 넣는다」로 바뀐 것이고, 그건 이미지만 키운다.
    expect(Object.keys(DEV_ONLY).length).toBeGreaterThan(0);
  });
});
