import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult } from './index';

/**
 * emptyBase('none') — 베이스리스 파트(260808e): 기본 프리미티브 없이 첫
 * sketchExtrude 피처가 B-rep 체인을 시작하게 하는 빈 베이스.
 *
 * 근거: 파이프라인은 upstreamEmpty(빈 업스트림)에서 첫 add 피처를 체인
 * 시작점으로 삼는 경로를 이미 지원한다(pipelineManager — "first solid —
 * starts the chain"). 이 셰이프는 그 경로의 정식 진입구다. 스케치-우선
 * 워크플로(챗 폴리라인 핸드오프 포함)에서 기본 박스가 산출물과 겹쳐
 * 보이던 결함(260808e 프로브 실측)의 근본 수정.
 *
 * 파라미터 0개 — 파라미터 패널은 비어 있는 게 정직하다(조정할 베이스가
 * 없음). 피처가 없으면 빈 형상("형상 없음" 안내)이 맞는 표시다.
 */
export const emptyBaseShape: ShapeConfig = {
  id: 'none',
  tier: 1,
  icon: '✏️',
  params: [],
  generate(): ShapeResult {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    geometry.setIndex([]);
    return {
      geometry,
      edgeGeometry: new THREE.BufferGeometry(),
      volume_cm3: 0,
      surface_area_cm2: 0,
      bbox: { w: 0, h: 0, d: 0 },
    };
  },
};
