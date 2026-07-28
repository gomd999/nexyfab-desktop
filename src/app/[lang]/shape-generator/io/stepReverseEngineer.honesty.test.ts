/**
 * 역설계 결과의 정직성 (260728) — 참고 코퍼스가 지목한 계열.
 *
 * 실측 기록(참고파일들 STEP 임포트, 17,269부품): 실물 SolidWorks B-rep 의 FeatureTree 가
 * **전부 `nodes:[]`** 로 나왔다 — 분류기 커버리지 0% 인데 **정직 신호가 없었다**.
 * 이 파일의 `detectHoles` 가 그 경로다: 위상맵이 없으면 조용히 `[]` 를 돌려줘서
 * "구멍이 없는 부품"과 구별되지 않았고, 심지어 **0개일 때 신뢰도가 올라갔다**
 * (`holes.length > 0 ? 0.9 : 1.0` — 방향이 거꾸로).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { reverseEngineerStep, summariseReconstructedTree } from './stepReverseEngineer';

const box = () => new THREE.BoxGeometry(100, 60, 20).toNonIndexed();

describe('reverseEngineerStep — 못 돌린 검출을 "없음"으로 내보내지 않는다', () => {
  it('★위상맵이 없으면 limitations 로 알린다 — 빈 features 가 "구멍 없음"으로 읽히지 않게', async () => {
    const t = await reverseEngineerStep(box()); // map 미전달 = 피처 검출 불가
    expect(t.features).toHaveLength(0);
    expect(t.limitations.length).toBeGreaterThan(0);
    expect(t.limitations.join(' ')).toContain('확인하지 못했다');
  });

  it('★검출을 못 돌렸으면 신뢰도가 낮아진다 — 종전엔 오히려 최고치였다', async () => {
    const t = await reverseEngineerStep(box());
    // 종전 식이면 baseShape.confidence × 1.0 (구멍 0개 = 최고 배수)였다.
    expect(t.overallConfidence).toBeLessThan(t.baseShape.confidence);
    expect(t.overallConfidence).toBeCloseTo(t.baseShape.confidence * 0.5, 6);
  });

  it('요약 문자열이 그 한계를 그대로 싣는다 — 읽는 사람이 오해할 여지를 없앤다', async () => {
    const s = summariseReconstructedTree(await reverseEngineerStep(box()));
    expect(s).toContain('⚠');
    expect(s).toContain('확인하지 못했다');
    // "검출을 돌렸는데 0개"라는 다른 의미의 문장을 잘못 붙이지 않는다
    expect(s).not.toContain('detection ran');
  });
});
