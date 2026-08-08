/**
 * chatCadHandoff — E1(260808b): 챗 생성 결과를 정밀 CAD(shape-generator 전문가
 * 모드)의 **편집 가능한 피처트리**로 여는 핸드오프.
 *
 * 접합점은 신설이 아니라 기존 스튜디오 핸드오프 심(`nexyfab:studio-handoff-
 * program` sessionStorage → 모델러 부팅 시 reconstructFeatureTree)을 그대로
 * 재사용한다 — 모델러 쪽 코드 변경 0. sessionStorage는 탭 단위이므로 반드시
 * **같은 탭 내 내비게이션**으로 넘긴다(새 탭=빈 스토리지).
 *
 * v1 정직 범위: compose intent 가 "단일 사각 판(main box) + 관통 구멍(subtract
 * cylinder)들"로만 이루어진 경우에만 변환한다. 그 밖(원통 몸체·보스·프리즘·
 * 회전체·복수 몸체)은 null — 버튼 자체를 숨겨 부분 약속을 하지 않는다.
 * 좌표 규약: intent 구멍은 판 모서리 원점(x∈[0,w], y∈[0,d]), 프로그램 구멍은
 * 중심 원점(circularPattern 전개가 cos/sin·0 기준인 것에서 실측 확인) — 변환
 * 시 (x−w/2, y−d/2).
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
  const holes: Array<{ x: number; y: number; dia: number }> = [];

  for (const raw of feats as IntentFeatureLike[]) {
    const kind = String(raw.kind ?? '');
    const sub = raw.op === 'subtract';
    if (kind === 'box' && !sub) {
      if (box) return null; // 복수 몸체 — v1 범위 밖
      if (!Array.isArray(raw.size) || raw.size.length < 3) return null;
      const [w, d, h] = (raw.size as unknown[]).map(v => num(v));
      if (w === null || d === null || h === null || w <= 0 || d <= 0 || h <= 0) return null;
      box = { w, d, h };
    } else if ((kind === 'cylinder' || kind === 'hole') && sub) {
      const dia = num(raw.diameter) ?? num(raw.d);
      const tr = raw.at?.translate;
      const x = Array.isArray(tr) ? num(tr[0]) : null;
      const y = Array.isArray(tr) ? num(tr[1]) : null;
      if (dia === null || dia <= 0) return null;
      // 위치 미부여(원점 겹침 관례) 구멍은 시드 불가 — 정직하게 전체 거부
      // (개수만 아는 구멍을 (0,0)에 찍으면 조용한 오답이 된다).
      if (x === null || y === null || (x === 0 && y === 0)) return null;
      holes.push({ x, y, dia });
    } else {
      return null; // 보스·프리즘·회전체 등 — v1 범위 밖
    }
  }
  if (!box) return null;
  // 판 밖 구멍은 형상 모순 — 거부
  for (const hole of holes) {
    if (hole.x < 0 || hole.x > box.w || hole.y < 0 || hole.y > box.d) return null;
  }

  const features: ProgramFeature[] = [
    { id: 'f1', type: 'sketchExtrude', shape: 'rect', width: box.w, depth: box.d, height: box.h },
    ...holes.map((hole, i): ProgramFeature => ({
      id: `h${i + 1}`,
      type: 'hole',
      diameter: hole.dia,
      posX: hole.x - box.w / 2,
      posY: hole.y - box.d / 2,
      holeType: 0,
    })),
  ];
  return { part: 'chat-part', features };
}

/** 핸드오프 실행: 프로그램 기록 + 같은 탭에서 전문가 모드로 이동. */
export function openInPrecisionCad(program: FeatureProgram, lang: string): void {
  sessionStorage.setItem(STUDIO_HANDOFF_PROGRAM_KEY, JSON.stringify(program));
  window.location.href = `/${lang}/shape-generator?expert=1&mode=expert`;
}
