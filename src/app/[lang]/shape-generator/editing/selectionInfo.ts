/**
 * selectionInfo.ts — 면/선 선택 정보 타입 정의
 */

export interface FaceSelectionInfo {
  type: 'face';
  normal: [number, number, number];      // 월드 좌표계 법선 (단위 벡터)
  position: [number, number, number];    // 클릭 지점 (mm)
  /** Phase-1 persistent face id from the topology tracker. Same fallback
   *  story as EdgeSelectionInfo.persistentId. */
  persistentId?: string;
  area: number;                          // 동일 법선 면들의 합산 면적 (mm²)
  triangleCount: number;                 // 동일 법선 삼각형 수
  normalLabel: string;                   // e.g. "+Y 상면", "-X 좌측면"
  triangleIndices: number[];             // geometry 내 해당 면 삼각형 인덱스 목록 (하이라이트용)
  partName?: string;                     // 어셈블리 내 파트 식별자 (Optional)
}

export interface EdgeSelectionInfo {
  type: 'edge';
  position: [number, number, number];    // 클릭 지점 (mm)
  length: number;                        // 추정 엣지 길이 (mm)
  normal: [number, number, number];      // 해당 면의 법선
  partName?: string;                     // 어셈블리 내 파트 식별자 (Optional)
  /** 엣지 방향 단위벡터 (월드). inDirection 파인더로 평행 엣지를 좁힌 뒤
   *  position 으로 특정 엣지를 고른다 — 위치 단독보다 견고. */
  direction?: [number, number, number];
  /** 선택 시점의 파트 월드 bounding box. 리빌드 시 현재 bbox 로 클릭점을
   *  재매핑(scale-aware)해 치수 변경 후에도 같은 엣지를 추적한다. */
  bbox?: { min: [number, number, number]; max: [number, number, number] };
  /** Phase-1 persistent edge id from the topology tracker. Optional
   *  until phase-2 topology naming is wired into the pipeline; when
   *  present, downstream features (fillet/chamfer) can attach it. */
  persistentId?: string;
  /** K7-S3(260808) — 생성-이력(System A) 에지 이름(예: 'e.vert.2', 'f7/e.top.0-1').
   *  persistentId(레거시 해시/서수 계열)와 병행 저장되는 이중화 채널: 리빌드 시
   *  이 이름이 현재 이름표에 실재하면 그 앵커가 우선(A안 해석), 이름표는 있는데
   *  이름이 사라졌으면 명시 상실(추측 적용 금지). 서명(B안)은 대조군으로 병행. */
  topoName?: string;
}

export interface MultiSelectionInfo {
  type: 'multi';
  faces: FaceSelectionInfo[];
  totalArea: number;
  totalTriangleCount: number;
  allTriangleIndices: number[];
}

export type ElementSelectionInfo = FaceSelectionInfo | EdgeSelectionInfo | MultiSelectionInfo;

// 법선 벡터 → 사람이 읽기 쉬운 라벨
export function normalToLabel(n: [number, number, number], isKo = true): string {
  const [x, y, z] = n;
  const abs = [Math.abs(x), Math.abs(y), Math.abs(z)];
  const maxIdx = abs.indexOf(Math.max(...abs));
  const sign = [x, y, z][maxIdx] > 0 ? '+' : '-';
  const axis = ['X', 'Y', 'Z'][maxIdx];

  if (isKo) {
    const labels: Record<string, string> = {
      '+Y': '상면', '-Y': '하면',
      '+X': '우측면', '-X': '좌측면',
      '+Z': '전면', '-Z': '후면',
    };
    return labels[`${sign}${axis}`] ?? `${sign}${axis}면`;
  }
  const labels: Record<string, string> = {
    '+Y': 'Top', '-Y': 'Bottom',
    '+X': 'Right', '-X': 'Left',
    '+Z': 'Front', '-Z': 'Back',
  };
  return labels[`${sign}${axis}`] ?? `${sign}${axis} Face`;
}
