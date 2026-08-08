/**
 * chatCadHandoff — E1(260808b): 챗 생성 결과를 정밀 CAD(shape-generator 전문가
 * 모드)의 **편집 가능한 피처트리**로 여는 핸드오프.
 *
 * 접합점은 신설이 아니라 기존 스튜디오 핸드오프 심(`nexyfab:studio-handoff-
 * program` sessionStorage → 모델러 부팅 시 reconstructFeatureTree)을 그대로
 * 재사용한다 — 모델러 쪽 코드 변경 0. sessionStorage는 탭 단위이므로 반드시
 * **같은 탭 내 내비게이션**으로 넘긴다(새 탭=빈 스토리지).
 *
 * 정직 범위(P-1a·P-1b·F-1 확장): ① 단일 사각 판 + 위치 있는 관통 구멍 +
 * **판 상면 보스**(add 원통이 판 상면(z=판두께)에 안착한 경우 — face-frame
 * 스케치로 시드) ② 단일 원통 몸체(축·파이프) + **동심** 구멍 ③ 단일
 * 폴리라인(extrude) 몸체 — 구멍 없는 경우만. 그 밖(회전체·복수 몸체·원통
 * 편심 구멍·측면 보스·폴리라인+구멍)은 null — 버튼 숨김(부분 약속 금지).
 * 좌표 규약은 **몸체 종류별로 다르다**(P-1a에서 충돌 발견):
 *  - 판(box): intent 구멍=판 모서리 원점(x∈[0,w], y∈[0,d]) → 프로그램은 중심
 *    원점(circularPattern 전개가 cos/sin·0 기준인 것에서 실측) — (x−w/2, y−d/2)
 *    변환. **(0,0)=위치 미부여 관례라 거부**(개수만 아는 구멍을 원점에 찍으면
 *    조용한 오답).
 *  - 원통(cylinder): 동심 구멍의 중심 (0,0)이 **정답**이므로 (0,0)·미부여를
 *    동심으로 수용, 편심(비영 translate)은 좌표 원점 규약이 미실측이라 거부.
 */
import type { FeatureProgram, ProgramFeature } from './studio/emitScadFromProgram';

export const STUDIO_HANDOFF_PROGRAM_KEY = 'nexyfab:studio-handoff-program';

interface IntentFeatureLike {
  kind?: string;
  op?: string;
  size?: unknown;
  diameter?: unknown;
  d?: unknown;
  at?: { translate?: unknown };
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * compose intent → FeatureProgram. 변환 불가(=v1 어휘 밖 피처 존재)면 null.
 */
export function composeIntentToFeatureProgram(
  intent: { features?: unknown } | undefined,
): FeatureProgram | null {
  const feats = intent?.features;
  if (!Array.isArray(feats) || feats.length === 0) return null;

  let box: { w: number; d: number; h: number } | null = null;
  let cyl: { dia: number; len: number } | null = null;
  let poly: { profile: [number, number][]; h: number } | null = null;
  const subs: Array<{ x: number | null; y: number | null; dia: number }> = [];
  const adds: Array<{ x: number | null; y: number | null; z: number | null; dia: number; h: number }> = [];

  for (const raw of feats as IntentFeatureLike[]) {
    const kind = String(raw.kind ?? '');
    const sub = raw.op === 'subtract';
    if (kind === 'box' && !sub) {
      if (box || cyl || poly) return null; // 복수 몸체 — 범위 밖
      if (!Array.isArray(raw.size) || raw.size.length < 3) return null;
      const [w, d, h] = (raw.size as unknown[]).map(v => num(v));
      if (w === null || d === null || h === null || w <= 0 || d <= 0 || h <= 0) return null;
      box = { w, d, h };
    } else if (kind === 'extrude' && !sub) {
      if (box || cyl || poly) return null; // 복수 몸체 — 범위 밖
      const profRaw = (raw as { profile?: unknown }).profile;
      const h = num((raw as { height?: unknown }).height) ?? num((raw as { depth?: unknown }).depth);
      if (!Array.isArray(profRaw) || profRaw.length < 3 || h === null || h <= 0) return null;
      const profile: [number, number][] = [];
      for (const pt2 of profRaw) {
        if (!Array.isArray(pt2)) return null;
        const x = num(pt2[0]); const y = num(pt2[1]);
        if (x === null || y === null) return null;
        profile.push([x, y]);
      }
      poly = { profile, h };
    } else if (kind === 'cylinder' && !sub) {
      const dia = num(raw.diameter) ?? num(raw.d);
      const len = num((raw as { height?: unknown }).height)
        ?? num((raw as { h?: unknown }).h)
        ?? num((raw as { length?: unknown }).length);
      if (dia === null || dia <= 0 || len === null || len <= 0) return null;
      if (!box && !cyl && !poly && adds.length === 0) {
        cyl = { dia, len }; // 첫 add 원통 = 몸체 후보
      } else if (box) {
        // F-1: 판 위 add 원통 = 보스 후보(안착 판정은 아래에서)
        const tr = raw.at?.translate;
        adds.push({
          x: Array.isArray(tr) ? num(tr[0]) : null,
          y: Array.isArray(tr) ? num(tr[1]) : null,
          z: Array.isArray(tr) ? num(tr[2]) : null,
          dia, h: len,
        });
      } else {
        return null; // 원통 몸체+add 원통 등 — 범위 밖
      }
    } else if ((kind === 'cylinder' || kind === 'hole') && sub) {
      const dia = num(raw.diameter) ?? num(raw.d);
      const tr = raw.at?.translate;
      const x = Array.isArray(tr) ? num(tr[0]) : null;
      const y = Array.isArray(tr) ? num(tr[1]) : null;
      if (dia === null || dia <= 0) return null;
      subs.push({ x, y, dia });
    } else {
      return null; // 보스·프리즘·회전체 등 — 범위 밖
    }
  }

  if (box) {
    const holes: Array<{ x: number; y: number; dia: number }> = [];
    for (const hole of subs) {
      // 판: (0,0)/미부여=위치 없는 구멍 관례 — 원점에 찍으면 조용한 오답이라 거부
      if (hole.x === null || hole.y === null || (hole.x === 0 && hole.y === 0)) return null;
      if (hole.x < 0 || hole.x > box.w || hole.y < 0 || hole.y > box.d) return null; // 판 밖=모순
      holes.push({ x: hole.x, y: hole.y, dia: hole.dia });
    }
    // F-1 — 보스 판정: add 원통이 판 상면(z=판두께±1e-6)에 안착하고 판 안에
    // 있어야 한다. 그 밖(측면·부유·판 밖)은 정직 거부(전체 null).
    const bosses: Array<{ x: number; y: number; dia: number; h: number }> = [];
    for (const boss of adds) {
      if (boss.x === null || boss.y === null) return null;
      const z = boss.z ?? 0;
      if (Math.abs(z - box.h) > 1e-6) return null; // 상면 안착 아님
      if (boss.x < 0 || boss.x > box.w || boss.y < 0 || boss.y > box.d) return null;
      bosses.push({ x: boss.x, y: boss.y, dia: boss.dia, h: boss.h });
    }
    return {
      part: 'chat-part',
      features: [
        { id: 'f1', type: 'sketchExtrude', shape: 'rect', width: box.w, depth: box.d, height: box.h },
        ...holes.map((hole, i): ProgramFeature => ({
          id: `h${i + 1}`, type: 'hole', diameter: hole.dia,
          posX: hole.x - box.w / 2, posY: hole.y - box.d / 2, holeType: 0,
        })),
        ...bosses.map((boss, i): ProgramFeature => ({
          id: `b${i + 1}`, type: 'boss', diameter: boss.dia, height: boss.h,
          posX: boss.x - box.w / 2, posY: boss.y - box.d / 2,
        })),
      ],
    };
  }
  if (adds.length > 0) return null; // 판 없는 add 원통 잔여 — 범위 밖

  if (poly) {
    // 폴리라인 몸체는 구멍 좌표 규약 미실측 — 구멍 있으면 정직 거부
    if (subs.length > 0) return null;
    return {
      part: 'chat-part',
      features: [
        { id: 'f1', type: 'sketchExtrude', profile: poly.profile, height: poly.h },
      ],
    };
  }

  if (cyl) {
    const body = cyl;
    for (const hole of subs) {
      // 원통: 동심((0,0)/미부여)만 수용 — 편심은 좌표 원점 규약 미실측이라 거부
      if (!((hole.x === null && hole.y === null) || (hole.x === 0 && hole.y === 0))) return null;
      if (hole.dia >= body.dia) return null; // 보어 ≥ 외경 = 모순
    }
    return {
      part: 'chat-part',
      features: [
        { id: 'f1', type: 'sketchExtrude', shape: 'circle', width: body.dia, height: body.len },
        ...subs.map((hole, i): ProgramFeature => ({
          id: `h${i + 1}`, type: 'hole', diameter: hole.dia, posX: 0, posY: 0, holeType: 0,
        })),
      ],
    };
  }

  return null;
}

/** 핸드오프 실행: 프로그램 기록 + 같은 탭에서 전문가 모드로 이동. */
export function openInPrecisionCad(program: FeatureProgram, lang: string): void {
  sessionStorage.setItem(STUDIO_HANDOFF_PROGRAM_KEY, JSON.stringify(program));
  window.location.href = `/${lang}/shape-generator?expert=1&mode=expert`;
}
