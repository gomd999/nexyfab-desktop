/**
 * synthesize.mjs — **실패 지문에서 재현 케이스를 합성한다** (260803, B4 완결).
 *
 * ## 왜 필요한가
 * `failureLog` 는 **원문을 저장하지 않는다** — 사용자 입력은 미출시 제품의 치수, 즉
 * 고객의 설계 IP 다(§0.12). 그래서 「무엇이 자주 깨지는지」는 알아도
 * **「그 입력을 다시 태워 고쳐졌는지 확인」할 수가 없었다.** 루프가 거기서 끊겼다.
 *
 * ## 해법 — 사용자 입력을 되살리지 않는다. **우리 어휘로 최소 재현을 만든다.**
 * 지문에는 PII 가 없다(부품 타입 + 정규화된 게이트 문구뿐). 거기서:
 * ```
 *   ① 지문의 부품 타입으로 **전 파라미터를 채운** 정상 부품을 만든다
 *   ② 게이트 문구에서 파라미터 이름을 뽑아 그것만 **지운다**
 *   ③ 게이트에 태워 **지문이 실제로 재현되는지 확인**한다
 * ```
 * ③이 핵심이다. 재현되지 않으면 **그 케이스를 버린다** — 재현 못 하는 케이스는
 * 회귀에 넣어도 무엇을 지키는지 알 수 없고, 「고쳤다」를 거짓으로 만든다.
 *
 * ## ⚠ 이 합성이 **하지 않는** 것
 * - **사용자의 원래 설계를 복원하지 않는다.** 치수는 우리가 넣은 기본값이고,
 *   재현되는 것은 **오류의 형태**이지 그 사람의 제품이 아니다.
 * - **원문 없이 재현 불가능한 실패는 못 만든다** — 예: 배치(부유)·의도 불일치는
 *   부품 파라미터만으로는 재현되지 않는다. 그런 지문은 `null` 을 내고 사유를 남긴다.
 *   못 만드는 것을 못 만든다고 말한다.
 */
import { gate, PARAMS } from '../drawing-to-3d/reconstruct.mjs';

/**
 * ⚠ `failureSignature` 를 여기서 **다시 구현하지 않는다.** 지문 규칙이 두 벌이 되면
 *   합성이 「재현했다」고 말하는데 수집 쪽 지문과 다를 수 있다 — 이 세션 내내 잡아 온
 *   단일소스 문제의 또 다른 판이다. `src/lib/failureLog.ts` 가 canonical 이고,
 *   그 파일은 런타임 lib 이라 .mjs 에서 정적 import 할 수 없다(webpack 경계).
 *   그래서 **호출부가 주입한다** — 기본값을 두지 않는다(빠뜨리면 즉시 드러나게).
 */

/**
 * 파라미터 이름 → 그럴듯한 기본값.
 * ⚠ 이 값들은 **재현용**이지 설계값이 아니다. 게이트를 통과할 정도면 충분하고,
 *   실제 제품 치수를 흉내 내려 하지 않는다(그건 사용자 IP 를 추측하는 것이다).
 */
const D = {
  width: 200, depth: 150, height: 100, length: 300, thickness: 10,
  diameter: 40, outerDia: 60, innerDia: 30, boreDia: 20, wallThk: 4,
  legA: 80, legB: 60, bcd: 45, boltHoleD: 9, boltCount: 4, boltDia: 12,
  stepWidth: 80, stepThickness: 5, webWidth: 60, flangeHeight: 40,
  H: 200, B: 100, tw: 8, tf: 12, af: 24, threadDia: 12, pitch: 20,
  module: 2, teeth: 24, dia: 16, dia1: 60, dia2: 40, od: 60, bendR: 90,
  angleDeg: 90, majorDia: 100, minorDia: 20, wireDia: 4, coilDia: 30, turns: 6,
  runOD: 60, branchOD: 40, runLen: 200, branchLen: 100,
  topW: 300, topT: 20, webT: 12, webH: 600, webH1: 600, webH2: 400, botW: 350, botT: 25,
  blockW: 390, blockD: 190, blockH: 190, coreCount: 2, coreW: 100, coreD: 120,
  boltPitch: 80, volumeMm3: 1000, teethCount: 24,
};

/** 그 어휘의 전 파라미터를 기본값으로 채운 **정상** 부품. */
export function healthyPart(type, id = 'repro') {
  const keys = PARAMS[type] ?? [];
  const params = {};
  for (const k of keys) params[k] = D[k] ?? 10;
  // 배열/객체 파라미터는 PARAMS 에 없다(스키마 특례) — 어휘별 최소 형태를 채운다.
  if (type === 'plate_with_holes') params.holes = [{ x: 30, y: 30, d: 8 }];
  if (type === 'slab_with_openings') params.openings = [{ x: 20, y: 20, w: 60, d: 40 }];
  if (type === 'wall_with_openings') params.openings = [{ x: 40, y: 0, w: 900, h: 2100 }];
  if (type === 'revolve') params.profile = [[0, 0], [30, 0], [30, 80], [0, 80]];
  if (type === 'extrude_profile') params.profile = [[0, 0], [100, 0], [100, 60], [0, 60]];
  if (type === 'rebar') params.points = [[0, 0, 0], [1000, 0, 0]];
  if (type === 'cavity_block') params.cavity = { type: 'box', params: { width: 100, depth: 80, height: 80 } };
  if (type === 'sheet_profile') { params.segments = [20, 40, 20]; params.angles = [90, 90]; }
  if (type === 'composite') params.subs = [{ type: 'box', params: { width: 100, depth: 80, height: 40 } }];
  if (type === 'mesh') { params.verts = [[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]]; params.aabb = [[0, 0, 0], [10, 10, 10]]; }
  return { id, type, params };
}

/** 게이트 문구에서 파라미터 이름을 뽑는다. `bcd invalid` · `boltCount invalid — …` 형태. */
export function paramsFromErrors(errors = []) {
  const out = new Set();
  for (const e of errors) {
    for (const m of String(e).matchAll(/\b([A-Za-z][A-Za-z0-9]*)\s+invalid\b/g)) out.add(m[1]);
  }
  return [...out];
}

/**
 * 지문 1건 → 재현 케이스(또는 null).
 *
 * @param {{signature:string, stage:string, sampleErrors:string[]}} row `aggregateFailures` 한 행
 * @returns {{case:object, signature:string}|{skipped:string}}
 */
export function synthesizeCase(row, { signatureOf } = {}) {
  if (typeof signatureOf !== 'function') throw new Error('synthesizeCase: signatureOf 주입 필수 — 지문 규칙을 두 벌로 만들지 않는다');
  const { signature, stage, sampleErrors = [] } = row ?? {};
  if (stage !== 'gate' && stage !== 'drop') {
    // ⚠ 배치·의도·템플릿 미스는 부품 파라미터만으로 재현되지 않는다. 지어내지 않는다.
    return { skipped: `stage '${stage}' 는 부품 단위 재현 대상이 아니다(원문 필요)` };
  }
  // 지문 형식: `stage::types::errors`
  const types = String(signature ?? '').split('::')[1]?.split('+').filter(Boolean) ?? [];
  const type = types.find((t) => PARAMS[t]);
  if (!type) return { skipped: '지문에 재현 가능한 어휘가 없다' };

  const drop = paramsFromErrors(sampleErrors);
  if (!drop.length) return { skipped: '오류 문구에서 파라미터 이름을 못 뽑았다' };

  const part = healthyPart(type, 'repro_' + type);
  // 정상 부품이 실제로 통과하는지 먼저 본다 — 기본값이 틀렸으면 합성이 무의미하다.
  if (gate({ type, ...part.params }).length) return { skipped: `기본값이 ${type} 게이트를 통과하지 못한다 — DEFAULTS 보강 필요` };

  const broken = { ...part, params: { ...part.params } };
  for (const k of drop) delete broken.params[k];

  const errs = gate({ type: broken.type, ...broken.params });
  if (!errs.length) return { skipped: '파라미터를 지워도 게이트가 통과한다 — 재현 실패' };

  /**
   * ★**지문이 실제로 재현되는지 확인한다.** 이게 없으면 「케이스를 만들었다」가
   * 「그 실패를 잡는다」를 뜻하지 않는다.
   */
  const reproSig = signatureOf('gate', errs, [type]);
  if (reproSig !== signature) return { skipped: `지문 불일치 — 원본 ${signature} / 재현 ${reproSig}` };

  return {
    signature,
    case: {
      id: 'auto-' + signature.replace(/[^\w가-힣]+/g, '-').slice(0, 48).replace(/-+$/, ''),
      title: `자동 합성 재현 — ${type}: ${drop.join(', ')} 누락`,
      source: `failureLog 지문 자동 합성(260803). 원문은 저장하지 않으므로 **우리 어휘로 만든 최소 재현**이다.`,
      kind: 'assembly',
      expectFail: true,
      note: '⚠ 사용자의 원래 설계가 아니다 — 재현되는 것은 **오류의 형태**다. 치수는 합성 기본값.',
      input: {
        name: `재현: ${type} 파라미터 누락`,
        parts: [
          { id: 'base', type: 'box', params: { width: 400, depth: 400, height: 20 }, at: { tx: 0, ty: 0, tz: 0 } },
          { ...broken, at: { tx: 0, ty: 0, tz: 20 } },
        ],
      },
    },
  };
}

/** 여러 지문 → 케이스 배열 + 건너뛴 사유(무엇을 못 만들었는지 숨기지 않는다). */
export function synthesizeAll(rows = [], opts = {}) {
  const cases = [];
  const skipped = [];
  for (const r of rows) {
    const out = synthesizeCase(r, opts);
    if (out.case) cases.push(out.case);
    else skipped.push({ signature: r.signature, reason: out.skipped });
  }
  return { cases, skipped };
}
