/**
 * failureLog — **실패가 어디에도 안 남고 있었다** (260803).
 *
 * ## 왜 이 파일이 있는가
 * `nf_intent_log`(intentTelemetry)는 **성공 경로에서만** 기록된다 — `intentCheck` 가
 * `if (built.ok)` 안에 있다. 즉 **게이트 실패·부품 드롭·이미지 미매칭은 화면에 뿌리고 끝**이었다.
 *
 * 그런데 이 세션에서 실제로 제품을 고친 것은 전부 **라이브 실패 한 건**에서 나왔다:
 * 「와셔를 flange 로 분류 → 60건」 하나가 어휘 힌트 17종 결손을 드러냈다.
 * 그 한 건이 우연히 스크린샷으로 전달됐기 때문에 고쳐졌다. **자동으로 쌓였어야 했다.**
 *
 * ## ⚠ 개인정보 — 사용자 입력은 **고객의 설계 IP** 다
 * 원문 설명에는 미출시 제품의 치수가 들어 있다. 그래서 이 로그의 **1급 키는 지문**이고
 * 원문은 부가다:
 *   - `signature`  게이트 코드·부품 타입만으로 만든 **PII 없는 지문** → 집계·분류의 근거
 *   - `descHash`   원문 해시 → **원문 없이** 중복 제거
 *   - `description` **기본 `null`.** `retainInput: true` 를 준 호출부만 남긴다
 *     (데모 세션·내부 하네스 등 IP 문제가 없는 경로)
 * ⚠ `nf_intent_log` 가 이미 원문을 2000자까지 저장하고 있다 — 그건 별개 문제이고
 *   여기서 같은 선택을 반복하지 않는다.
 *
 * ## 두 소비처
 *   ① **개발** — 무엇이 자주 깨지는지 집계해서 다음에 고칠 것을 정한다(`aggregateFailures`)
 *   ② **자체 수정** — 빈도 상위 지문이 `auto-fix.mjs` 규칙 후보가 된다(§11 자율 검증 루프)
 *
 * ⚠ 기록 실패는 **조용히 무시**한다 — 로깅이 생성을 막으면 안 된다(intentTelemetry 규율과 동일).
 */
import { createHash } from 'node:crypto';
import { getDbAdapter } from './db-adapter';

export type FailureStage =
  | 'gate'          // 부품 게이트 실패
  | 'drop'          // 못 고쳐 제외한 부품
  | 'assembly'      // 조립 판정 실패(부유·간섭)
  | 'template-miss' // 이미지: 맞는 템플릿 없음
  | 'vision'        // 이미지 판독 자체 실패
  | 'empty';        // 빈 어셈블리

export interface FailureRecord {
  stage: FailureStage;
  /** 원문 — 지문·해시 생성에만 쓴다. 저장은 retainInput 일 때만. */
  input: string;
  /** 게이트/에러 문구 목록 */
  errors?: string[];
  /** 관련 부품 타입(있으면 지문 정확도가 올라간다) */
  partTypes?: string[];
  domain?: string | null;
  /** 원문을 저장해도 되는 경로인가 (데모·내부 하네스). 기본 false */
  retainInput?: boolean;
}

/**
 * ★**PII 없는 실패 지문.**
 *
 * 목표는 「같은 원인의 실패가 같은 문자열이 되는 것」이다. 그래서:
 *   - 숫자를 전부 `#` 로 지운다 — `hole[0] d 없음` 과 `hole[3] d 없음` 은 같은 원인이다
 *     (숫자를 남기면 같은 버그가 4건으로 흩어져 집계가 무의미해진다. 라이브에서 실제로 그랬다)
 *   - 식별자 접두(`friction_washer_1: `)를 떼어낸다 — 부품 이름은 사용자가 지은 것이라 PII 이고,
 *     같은 원인이 이름마다 다른 지문이 된다
 *   - 상위 3건만 쓰고 정렬한다 — 순서가 흔들려도 같은 지문이 되게
 */
export function failureSignature(stage: FailureStage, errors: string[] = [], partTypes: string[] = []): string {
  const norm = (m: string) => String(m)
    .replace(/^[\w가-힣.\-]+:\s*/, '')      // "friction_washer_1: " 제거
    .replace(/\d+(\.\d+)?/g, '#')            // 숫자 제거 — 같은 원인을 하나로 모은다
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  const es = [...new Set(errors.map(norm))].filter(Boolean).sort().slice(0, 3);
  const ts = [...new Set(partTypes)].sort().slice(0, 3);
  return [stage, ts.join('+'), es.join('|')].filter(Boolean).join('::');
}

const descHashOf = (s: string) => createHash('sha1').update(String(s ?? '')).digest('hex').slice(0, 16);

let ensured = false;
async function ensureTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (ensured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_failure_log (
      id          TEXT PRIMARY KEY,
      stage       TEXT NOT NULL,
      signature   TEXT NOT NULL,
      desc_hash   TEXT NOT NULL,
      description TEXT,
      domain      TEXT,
      errors      TEXT,
      part_types  TEXT,
      created_at  BIGINT NOT NULL
    )
  `).catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_nf_failure_sig ON nf_failure_log (signature)').catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_nf_failure_ts ON nf_failure_log (created_at)').catch(() => {});
  ensured = true;
}

/** 실패 1건 기록. **비치명** — 실패해도 응답에 영향 없다. */
export async function recordFailure(rec: FailureRecord): Promise<void> {
  try {
    const db = getDbAdapter();
    await ensureTable(db);
    const errors = (rec.errors ?? []).slice(0, 12);
    await db.execute(
      `INSERT INTO nf_failure_log (id, stage, signature, desc_hash, description, domain, errors, part_types, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      rec.stage,
      failureSignature(rec.stage, errors, rec.partTypes ?? []),
      descHashOf(rec.input),
      // ⚠ 기본 null. 원문은 고객 IP 다 — 명시적으로 허용한 경로만 남긴다.
      rec.retainInput ? String(rec.input ?? '').slice(0, 2000) : null,
      rec.domain ?? null,
      errors.length ? JSON.stringify(errors) : null,
      rec.partTypes?.length ? JSON.stringify(rec.partTypes.slice(0, 12)) : null,
      Date.now(),
    );
  } catch { /* non-fatal — 로깅이 생성을 막지 않는다 */ }
}

export interface FailureAggregateRow {
  signature: string;
  stage: string;
  hits: number;
  /** 서로 다른 입력 수 — 한 사람이 반복한 것과 여러 사람이 겪은 것을 구분한다 */
  distinctInputs: number;
  lastSeen: number;
  sampleErrors: string[];
}

/**
 * 무엇이 자주 깨지는가 — **개발 시 이걸 보고 다음에 고칠 것을 정한다.**
 *
 * ⚠ `hits` 가 아니라 `distinctInputs` 로 정렬한다. 한 사람이 같은 입력을 20번 재시도한 것보다
 *   **20명이 각각 겪은 것**이 훨씬 중요하다. 재시도 폭주가 우선순위를 왜곡하는 것을 막는다.
 */
export async function aggregateFailures(sinceMs = 7 * 24 * 3600_000, limit = 40): Promise<FailureAggregateRow[]> {
  try {
    const db = getDbAdapter();
    await ensureTable(db);
    const rows = await db.queryAll<{
      signature: string; stage: string; hits: number | string;
      distinct_inputs: number | string; last_seen: number | string; sample_errors: string | null;
    }>(
      `SELECT signature, stage,
              COUNT(*) AS hits,
              COUNT(DISTINCT desc_hash) AS distinct_inputs,
              MAX(created_at) AS last_seen,
              MAX(errors) AS sample_errors
         FROM nf_failure_log
        WHERE created_at >= ?
        GROUP BY signature, stage
        ORDER BY distinct_inputs DESC, hits DESC
        LIMIT ?`,
      Date.now() - sinceMs, limit,
    );
    return rows.map((r) => ({
      signature: r.signature,
      stage: r.stage,
      hits: Number(r.hits),
      distinctInputs: Number(r.distinct_inputs),
      lastSeen: Number(r.last_seen),
      sampleErrors: r.sample_errors ? (JSON.parse(r.sample_errors) as string[]).slice(0, 3) : [],
    }));
  } catch {
    return [];
  }
}
