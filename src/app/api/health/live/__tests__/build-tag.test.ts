/**
 * build-tag.test.ts — 헬스 응답이 **어느 빌드인지** 말한다 (260802).
 *
 * ## 왜 필요한가
 * `railway up` 이 **exit 0 · 빌드 성공 · 헬스체크 성공**인데도 새 코드가 반영되지 않는 일이
 * 하루에 **네 번** 있었다. 매번 기능별 관측점(패키지를 풀어 특정 문자열 찾기)으로 확인해야
 * 했고, **관측점이 없는 변경**(동시성 상한 등)은 확인할 방법이 아예 없었다.
 *
 * ⚠ 이 검사가 지키는 것은 「값이 맞는가」가 아니라 **「필드가 존재하는가」**다.
 *   필드가 사라지면 배포 확인 수단이 통째로 없어진다 — 그게 회귀의 대상이다.
 * ⚠ 미설정은 **`unknown`** 이다. 빈 문자열을 내보내면 소비자가 「최신」으로 오독한다.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { GET } from '../route';

const orig = process.env.NEXYFAB_BUILD_TAG;
afterEach(() => {
  if (orig === undefined) delete process.env.NEXYFAB_BUILD_TAG;
  else process.env.NEXYFAB_BUILD_TAG = orig;
});

describe('헬스 응답 — 빌드 태그', () => {
  it('★build 필드가 항상 있다 — 없으면 배포 확인 수단이 사라진다', async () => {
    const r = await GET();
    const j = (await r.json()) as { status: string; build?: string };
    expect(j.status).toBe('ok');
    expect(j.build, 'build 필드 없음').toBeTruthy();
  });

  it('설정된 태그를 그대로 돌려준다', async () => {
    process.env.NEXYFAB_BUILD_TAG = '20260802-999';
    const j = (await (await GET()).json()) as { build: string };
    expect(j.build).toBe('20260802-999');
  });

  it('★미설정이면 **unknown** — 빈 값을 「최신」으로 읽지 않게 한다', async () => {
    delete process.env.NEXYFAB_BUILD_TAG;
    const j = (await (await GET()).json()) as { build: string };
    expect(j.build).toBe('unknown');
  });
});

/**
 * ★Dockerfile 의 두 `ARG CACHEBUST` 가 어긋나지 않는가 (260802).
 *
 * ⚠ 실제로 겪었다. 런타임 스테이지 기본값을 `unknown` 으로 두었더니 **그 값이 그대로
 *   라이브에 나갔다**(`build:"unknown"`). Docker 는 **스테이지마다 `ARG` 가 독립**이라
 *   빌드 스테이지 값을 물려받지 않고, Railway 가 인자를 주입하지 않으면 기본값이 쓰인다.
 * ⚠ 두 곳이 갈리면 **표시가 실제와 달라진다** — 배포 확인 수단이 거짓말을 하게 된다.
 *   그게 없느니만 못하다.
 */
describe('Dockerfile — 빌드 태그 기본값이 두 스테이지에서 같다', () => {
  it('★ARG CACHEBUST 가 모두 같은 값이다', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const df = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');
    const tags = [...df.matchAll(/^ARG CACHEBUST=(\S+)$/gm)].map((m) => m[1]);
    expect(tags.length, 'ARG CACHEBUST 선언이 2개여야 한다(빌드·런타임)').toBeGreaterThanOrEqual(2);
    expect(new Set(tags).size, `값이 갈렸다: ${tags.join(' vs ')}`).toBe(1);
    // `unknown` 을 기본값으로 두면 그 값이 그대로 나간다 — 실제로 겪었다.
    expect(tags[0]).not.toBe('unknown');
  });
});
