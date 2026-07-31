/**
 * required-inputs.test.ts — **「검토가 없다」와 「값이 없다」를 구별한다** (260802).
 *
 * ## 왜 필요한가 — 실측
 * 54템플릿: 판정 152 · **입력 대기 30** · 판정불가 55. 대기 30건의 정체:
 * ```
 * lighting 5 · ventilation 5 · electrical 5 · water 5 · fire 5   ← 인테리어 25건
 * mech 판정불가 33건 중 15건 = seismicG **하나**
 * ```
 * 막혀 있는 것은 **검토가 없어서가 아니라 값이 안 와서**인데, 사용자는 **무엇을 주면
 * 무엇이 켜지는지 알 방법이 없었다.**
 *
 * ## ⚠ 새 판정을 만들지 않는다
 * 각 검토가 자기 `needInputs` 로 **선언한 것**을 모으기만 한다. 기본값을 제안하면
 * 그 값으로 판정이 나가고 **근거가 우리 추측**이 된다.
 */
import { describe, expect, it } from 'vitest';
import { collectRequiredInputs, requiredInputsSummaryKo } from './required-inputs.mjs';
import { auditDomainSafety } from './domain-dossier-verify.mjs';
import { buildAssemblyTemplate, ASSEMBLY_TEMPLATES as TEMPLATES } from './domain-assemblies.mjs';
import { collectJudgments } from './domain-audit.mjs';

const collectJudgmentsOf = (run: any) => (collectJudgments as unknown as (t: unknown) => any)(run?.result ?? run);

type RI = { fields: Array<{ field: string; kind: string; unlocks: number; checks: string[] }>; totalWaiting: number } | null;
const collect = (d: string, id: string): RI => {
  const a = (buildAssemblyTemplate as unknown as (x: string, y: string) => unknown)(d, id);
  const tree = (auditDomainSafety as unknown as (x: unknown, p: unknown) => unknown)(a, {});
  return (collectRequiredInputs as unknown as (t: unknown) => RI)(tree);
};

describe('필요 입력 수집', () => {
  it('★인테리어 카페는 조명·환기·전기·급수·소방을 기다린다 — 이름으로 나온다', () => {
    const ri = collect('interior', 'cafe_room');
    expect(ri, '대기 목록이 없다').toBeTruthy();
    const names = ri!.fields.map((f) => f.field);
    for (const k of ['targetLux', 'ventPerPersonCMH', 'loadDensityVAm2', 'waterPerPersonLpd']) {
      expect(names, `${k} 누락`).toContain(k);
    }
    expect(ri!.totalWaiting).toBeGreaterThanOrEqual(4);
  });

  it('★검토들이 이름으로 붙는다 — 「무엇이 켜지는지」를 알아야 값을 줄 이유가 생긴다', () => {
    const ri = collect('interior', 'cafe_room');
    for (const f of ri!.fields) {
      expect(f.checks.length, `${f.field} 에 검토 이름이 없다`).toBeGreaterThan(0);
      expect(f.unlocks).toBe(f.checks.length);
    }
  });

  it('대기가 없으면 **null** 이다 — 빈 배열이면 「검토가 없다」로 읽힌다', () => {
    expect((collectRequiredInputs as unknown as (t: unknown) => RI)(null)).toBeNull();
  });

  it('★요약이 건수를 부풀리지 않는다 — 1건짜리에 「(1건)」을 붙이지 않는다', () => {
    const ri = collect('interior', 'cafe_room');
    const line = (requiredInputsSummaryKo as unknown as (r: unknown) => string | null)(ri)!;
    expect(line).toMatch(/입력 대기 \d+건/);
    // 한 어셈블리 안에서는 대개 필드마다 1건이라, 과장하면 곧 거짓이 된다.
    expect(line).not.toMatch(/\(1건\)/);
  });
});

/**
 * ★ 안내한 경로를 **문자열 그대로 실행**한다.
 *
 * 260802 실측: `needInputs` 가 `holes[].fit`·`parts[].fit` 이라고 안내했는데 판정기는
 * `params.holes[].fit`·`params.fit` 을 읽고 있었다. **시킨 대로 해도 12건이 안 켜졌다.**
 * 안내와 실제가 갈리면 없는 기능보다 나쁘다 — 사용자는 값을 주고도 안 된다고 읽는다.
 * 그래서 이 테스트는 안내 문자열을 **파싱해서 그 경로에 값을 넣고**, 판정이 켜지는지 본다.
 * 읽는 쪽을 바꾸면 여기서 깨진다.
 */
function setByDeclaredPath(assembly: any, path: string, value: string): number {
  // `parts[].params.holes[].fit` 처럼 `[]` 는 「그 배열의 모든 원소」다.
  const seg = path.split('.');
  let n = 0;
  const walk = (node: any, i: number) => {
    if (node == null) return;
    if (i === seg.length) return;
    const m = /^([A-Za-z_]\w*)(\[\])?$/.exec(seg[i]);
    if (!m) return;
    const [, key, arr] = m;
    const next = node[key];
    if (arr) {
      for (const el of Array.isArray(next) ? next : []) {
        if (i === seg.length - 1) continue;
        walk(el, i + 1);
      }
      return;
    }
    if (i === seg.length - 1) { if (node[key] === undefined || node[key] === null) { node[key] = value; n++; } return; }
    walk(next ?? (node[key] = {}), i + 1);
  };
  walk(assembly, 0);
  return n;
}

describe('안내한 입력 경로가 실제로 판정을 켠다', () => {
  it('★`fit` 안내 경로를 그대로 따라가면 끼워맞춤 12건이 판정된다 — 260802 이전엔 0건이었다', () => {
    let touched = 0, before = 0, after = 0;
    for (const id of ['gear_train', 'four_bar']) {
      const asm = (buildAssemblyTemplate as unknown as (a: string, b: string, c: unknown) => any)('mech', id, {});
      const j0 = (auditDomainSafety as unknown as (a: unknown, b: unknown) => any)(asm, {});
      const acc0 = collectJudgmentsOf(j0);
      const waiting = acc0.unjudged.filter((u: any) => /끼워맞춤/.test(String(u.label)));
      before += waiting.length;
      // 안내에 적힌 필드 문자열만 쓴다 — 우리가 아는 실제 경로를 쓰지 않는다.
      const paths = new Set<string>(waiting.flatMap((u: any) => u.fields ?? []));
      for (const p of paths) touched += setByDeclaredPath(asm, p, /holes/.test(p) ? 'H7' : 'g6');
      const acc1 = collectJudgmentsOf((auditDomainSafety as unknown as (a: unknown, b: unknown) => any)(asm, {}));
      after += acc1.unjudged.filter((u: any) => /끼워맞춤/.test(String(u.label))).length;
    }
    expect(before, '끼워맞춤 미판정이 애초에 없다 — 이 회귀가 무의미해졌다').toBe(12);
    expect(touched, '안내 경로가 형상에 닿지 않았다').toBeGreaterThan(0);
    expect(after, '안내대로 선언했는데 여전히 판정되지 않는다 — 안내가 틀린 것이다').toBe(0);
  });
});

/**
 * ★ **판정불가는 사유 없이 나가지 않는다** — 260802 전수 실측으로 굳힌 불변식.
 *
 * 54템플릿의 판정불가 55건을 분해하니 이랬다:
 * ```
 * 값이 없다(필드 선언) 35 · 참고값(기준 미선언) 9 · 적용범위 밖 5 · 확인 필요(CHECK) 4
 * 산출조건 미충족(사유 서술) 2 · **사유 없음 0**
 * ```
 * 즉 「판정불가 55」는 **계산기가 55개 없다는 뜻이 아니다.** 이 구별이 무너지면
 * 사용자는 기능이 없는 줄 알고, 우리는 고칠 곳을 못 찾는다.
 * 사유가 필드도 서술도 없이 나가는 순간 그 항목은 **영영 추적되지 않는다** — 그래서 0을 지킨다.
 */
describe('판정불가 불변식', () => {
  it('★사유(필드 선언·서술·참고·적용범위·CHECK) 없는 판정불가는 0건이다', () => {
    const cls = { field: 0, ref: 0, scope: 0, check: 0, detail: 0, none: 0 };
    const nameless: string[] = [];
    const walk = (n: any, d = 0) => {
      if (n == null || typeof n !== 'object' || d > 7) return;
      if (Array.isArray(n)) { n.forEach((x) => walk(x, d + 1)); return; }
      const name = typeof n.labelKo === 'string' ? n.labelKo : (typeof n.name === 'string' ? n.name : null);
      const v = typeof n.verdict === 'string' ? n.verdict : null;
      const unjudged = (v && !/^INPUT/.test(v) && !['PASS', 'FAIL', 'INFO'].includes(v))
        || (name && (n.pass === null || n.ok === null) && !v);
      if (unjudged) {
        const said = (Array.isArray(n.detail) ? n.detail.join(' ') : String(n.detail ?? '')).trim()
          || String(n.note ?? '').trim() || String(n.messageKo ?? '').trim();
        if ((n.needInputs ?? []).length) cls.field++;
        else if (/참고/.test(String(name))) cls.ref++;
        else if (/적용범위 밖|해당하지 않/.test(String(name))) cls.scope++;
        else if (v === 'CHECK') cls.check++;
        else if (said) cls.detail++;
        else { cls.none++; nameless.push(String(name)); }
      }
      for (const [k, x] of Object.entries(n)) {
        if (['refs', 'note', 'inputsEcho', 'provenance', 'needInputs'].includes(k)) continue;
        if (x && typeof x === 'object') walk(x, d + 1);
      }
    };
    for (const [domain, list] of Object.entries((TEMPLATES as Record<string, Array<{ id?: string }>>) ?? {})) {
      for (const t of list) {
        let r: any;
        try { r = (auditDomainSafety as unknown as (a: unknown, b: unknown) => any)(
          (buildAssemblyTemplate as unknown as (a: string, b: string, c: unknown) => unknown)(domain, t.id ?? (t as unknown as string), {}), {}); } catch { continue; }
        if (r?.result) walk(r.result);
      }
    }
    expect(cls.none, `사유 없는 판정불가: ${nameless.join(' | ')}`).toBe(0);
    // 값만 주면 켜지는 것이 **가장 큰 몫**이라는 사실 자체가 회귀 대상이다 —
    // 이게 뒤집히면(계산기 부재가 다수가 되면) 우선순위가 달라져야 한다.
    expect(cls.field).toBeGreaterThan(cls.ref + cls.scope + cls.check + cls.detail);
  });
});

/**
 * ★ **요구하는 입력은 이름을 가진다** — 260802 전수 census 로 굳힌 불변식.
 *
 * `needInputs` 를 문자열 배열로 적은 자리가 두 곳 있었다(`load-path` 기초 5건 ·
 * `landscape` 관수). 이름은 멀쩡히 적혀 있었지만 수집기는 `x.field ?? x.name` 을 보므로
 * **소비자 문서엔 `?` 로 나갔다.** 「적어 두는 것과 닿는 것은 다르다」의 전형이다.
 * 이름 없는 요구는 사용자가 **줄 수가 없어서**, 그 판정은 영영 안 켜진다.
 */
describe('입력 요구의 형식', () => {
  it('★이름 없는(`?`) 입력 요구는 0건이다 — 줄 수 없는 요구는 요구가 아니다', () => {
    const nameless: string[] = [];
    const walk = (n: any, d = 0, where = '') => {
      if (n == null || typeof n !== 'object' || d > 7) return;
      if (Array.isArray(n)) { n.forEach((x, i) => walk(x, d + 1, `${where}[${i}]`)); return; }
      for (const req of n.needInputs ?? []) {
        const name = typeof req === 'object' && req ? (req.field ?? req.name) : undefined;
        if (!name || String(name).trim() === '' || String(name) === '?') nameless.push(`${where} ← ${JSON.stringify(req).slice(0, 60)}`);
      }
      for (const [k, x] of Object.entries(n)) {
        if (['refs', 'note', 'inputsEcho', 'provenance'].includes(k)) continue;
        if (x && typeof x === 'object') walk(x, d + 1, `${where}.${k}`);
      }
    };
    for (const [domain, list] of Object.entries((TEMPLATES as Record<string, Array<{ id?: string }>>) ?? {})) {
      for (const t of list) {
        let r: any;
        try { r = (auditDomainSafety as unknown as (a: unknown, b: unknown) => any)(
          (buildAssemblyTemplate as unknown as (a: string, b: string, c: unknown) => unknown)(domain, t.id ?? (t as unknown as string), {}), {}); } catch { continue; }
        if (r?.result) walk(r.result, 0, `${domain}/${t.id}`);
      }
    }
    expect(nameless, `이름 없는 입력 요구: ${nameless.slice(0, 5).join(' | ')}`).toHaveLength(0);
  });
});

/**
 * ★ **판정 노드가 아닌 자리의 요구도 잡는다** — 260802 실측으로 굳힌다.
 *
 * `building/water_tank`·`elevator_shaft`·`gable_house` 는 **검토 루트**에서
 * `seismic.R`·`wind.V0` 를 요구한다. 루트는 `label` 만 있고 `labelKo`/`name` 이 없어
 * 판정 수집기의 이름 판정에서 탈락하는데, 처음 만든 수집기가 그 버킷만 봐서
 * **세 템플릿의 요구가 사용자에게 한 글자도 안 나가고 있었다.**
 * 요구가 안 보이면 그 판정은 영영 안 켜진다 — 노출 총량이 30 → 82 로 늘었다.
 */
describe('요구 수집 범위', () => {
  it('★검토 루트의 요구(`seismic.R`·`wind.V0`)도 수집된다 — 벽식 3종', () => {
    for (const id of ['water_tank', 'elevator_shaft', 'gable_house']) {
      const a = (buildAssemblyTemplate as unknown as (x: string, y: string, z: unknown) => unknown)('building', id, {});
      const tree = (auditDomainSafety as unknown as (x: unknown, p: unknown) => unknown)(a, {});
      const ri = (collectRequiredInputs as unknown as (t: unknown) => RI)(tree);
      expect(ri, `${id}: 요구가 하나도 수집되지 않았다`).toBeTruthy();
      const names = ri!.fields.map((f) => f.field);
      expect(names, `${id}: 루트 요구 seismic.R 누락`).toContain('seismic.R');
      expect(names, `${id}: 루트 요구 wind.V0 누락`).toContain('wind.V0');
    }
  });

  it('요구는 `param`/`design` 으로 갈린다 — **주는 곳이 다르다**', () => {
    const a = (buildAssemblyTemplate as unknown as (x: string, y: string, z: unknown) => unknown)('mech', 'four_bar', {});
    const ri = (collectRequiredInputs as unknown as (t: unknown) => RI)(
      (auditDomainSafety as unknown as (x: unknown, p: unknown) => unknown)(a, {}));
    const fit = ri!.fields.find((f) => /fit$/.test(f.field));
    expect(fit, '끼워맞춤 요구가 없다').toBeTruthy();
    expect((fit as unknown as { kind: string }).kind, '모델 선언인데 검토 입력값으로 안내하고 있다').toBe('design');
  });
});
