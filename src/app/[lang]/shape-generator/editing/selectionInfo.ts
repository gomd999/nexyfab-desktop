/**
 * selectionInfo.ts — 면/선 선택 정보 타입 정의
 */

export interface FaceSelectionInfo {
  type: 'face';
  normal: [number, number, number];      // 월드 좌표계 법선 (단위 벡터)
  position: [number, number, number];    // 클릭 지점 (mm)
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
}

export type ElementSelectionInfo = FaceSelectionInfo | EdgeSelectionInfo;

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
