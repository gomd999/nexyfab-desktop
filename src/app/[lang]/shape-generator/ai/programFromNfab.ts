/**
 * programFromNfab — P-2(260808b) 역루프의 순수 코어: 모델러의 저장 직렬화
 * (NfabProjectV1 — getCloudSceneObject()가 라이브 상태에서 생성)를 챗 컨텍스트용
 * FeatureProgram 으로 역변환한다.
 *
 * 정직 계약: 매핑 가능한 어휘(박스/원통 베이스 + hole/fillet/chamfer)만
 * 프로그램에 싣고, 그 밖의 활성 피처는 **unmapped 목록으로 명시 반환**한다 —
 * 챗은 이 목록을 컨텍스트에 그대로 실어 "이 피처들은 반영 안 됨"을 AI와
 * 사용자 모두에게 알린다(조용한 누락 금지). 매핑 0(베이스조차 불가)이면 null.
 *
 * 좌표 규약: 모델러 hole 은 posX/posZ(Y-up), 프로그램은 posX/posY —
 * programToFeatures 의 posY→posZ 사상의 정확한 역(posZ→posY)이다.
 */
import type { FeatureProgram, ProgramFeature } from '../../studio/emitScadFromProgram';

interface NfabNodeLike {
  featureType?: string;
  params?: Record<string, number>;
  enabled?: boolean;
}
interface NfabProjectLike {
  tree?: { nodes?: NfabNodeLike[] };
  scene?: { selectedId?: string; params?: Record<string, number> };
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export interface ReverseProgramResult {
  program: FeatureProgram;
  /** 매핑 못 한 활성 피처 타입들(중복 제거) — 컨텍스트에 정직 표기용. */
  unmapped: string[];
}

export function programFromNfab(project: NfabProjectLike | null | undefined): ReverseProgramResult | null {
  if (!project) return null;
  const scene = project.scene ?? {};
  const params = scene.params ?? {};
  const features: ProgramFeature[] = [];
  const unmapped = new Set<string>();

  if (scene.selectedId === 'box') {
    features.push({
      id: 'f1', type: 'sketchExtrude', shape: 'rect',
      width: num(params.width, 100), depth: num(params.depth, 80), height: num(params.height, 8),
    });
  } else if (scene.selectedId === 'cylinder') {
    features.push({
      id: 'f1', type: 'sketchExtrude', shape: 'circle',
      width: num(params.diameter, 50), height: num(params.height, 50),
    });
  } else {
    // 폴리라인/기타 베이스의 역변환은 후속(스케치 노드에서 프로파일 복원 필요)
    return null;
  }

  let seq = 0;
  for (const node of project.tree?.nodes ?? []) {
    if (node.enabled === false || !node.featureType) continue;
    const p = node.params ?? {};
    if (node.featureType === 'hole') {
      features.push({
        id: `h${++seq}`, type: 'hole',
        diameter: num(p.diameter, 6),
        posX: num(p.posX, 0),
        posY: num(p.posZ, 0), // 모델러 posZ → 프로그램 posY (정확한 역사상)
        holeType: num(p.holeType, 0),
      });
    } else if (node.featureType === 'fillet') {
      features.push({ id: `fl${++seq}`, type: 'fillet', radius: num(p.radius, 3) });
    } else if (node.featureType === 'chamfer') {
      features.push({ id: `ch${++seq}`, type: 'chamfer', distance: num(p.distance, 1) });
    } else {
      unmapped.add(node.featureType);
    }
  }

  return { program: { part: 'edited-model', features }, unmapped: [...unmapped].sort() };
}

/** 챗 프롬프트에 앞세울 컨텍스트 블록(사람·AI 공용 읽기, 미반영 명시). */
export function chatContextPreamble(result: ReverseProgramResult): string {
  const lines = [
    '[기존 모델 컨텍스트 — 정밀 CAD에서 편집된 상태. 아래 요청을 이 모델 기준으로 반영해 전체 모델을 다시 설계하라]',
    JSON.stringify(result.program),
  ];
  if (result.unmapped.length) {
    lines.push(`[주의: 다음 피처는 컨텍스트에 반영되지 못했다(어휘 밖): ${result.unmapped.join(', ')}]`);
  }
  return lines.join('\n');
}
