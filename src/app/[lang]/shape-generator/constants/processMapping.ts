/**
 * DFM 분석 공정 타입 ↔ 비용 추정 공정 타입 매핑
 *
 * dfmAnalysis.ts의 ManufacturingProcess와 CostEstimator.ts의 ProcessType은
 * 분류 체계가 다릅니다. 이 파일이 두 모듈 사이의 브릿지 역할을 합니다.
 *
 *  DFM 공정 (전통 제조 중심)           Cost 공정 (3D 프린팅 포함)
 *  ─────────────────────────────        ──────────────────────────────
 *  cnc_milling                    ──►  cnc
 *  cnc_turning                    ──►  cnc
 *  injection_molding              ──►  injection
 *  sheet_metal                    ──►  sheetmetal_laser
 *  casting                        ──►  cnc  (근사: 주조 후 CNC 피니싱)
 *
 *  fdm / sla / sls 은 DFM 분석 대상이 아니므로 역방향 매핑만 제공.
 */

import type { ManufacturingProcess } from '../analysis/dfmAnalysis';
import type { ProcessType } from '../estimation/CostEstimator';

// ─── DFM → Cost 매핑 ─────────────────────────────────────────────────────────

export const DFM_TO_COST: Record<ManufacturingProcess, ProcessType> = {
  cnc_milling:       'cnc',
  cnc_turning:       'cnc',
  injection_molding: 'injection',
  sheet_metal:       'sheetmetal_laser',
  casting:           'cnc',          // 주조는 CostEstimator에 전용 항목 없음 → CNC로 근사
  '3d_printing':     'fdm',          // 3D 프린팅 → FDM으로 근사
};

// ─── Cost → DFM 매핑 (1:N 역방향, 가장 가까운 DFM 공정 반환) ─────────────────

export const COST_TO_DFM: Partial<Record<ProcessType, ManufacturingProcess>> = {
  cnc:              'cnc_milling',
  injection:        'injection_molding',
  sheetmetal_laser: 'sheet_metal',
  // fdm / sla / sls: DFM 분석 미지원 → undefined
};

// ─── 헬퍼 함수 ───────────────────────────────────────────────────────────────

/**
 * DFM 공정에 대응하는 비용 추정 공정 타입을 반환합니다.
 */
export function getCostProcessForDFM(dfmProcess: ManufacturingProcess): ProcessType {
  return DFM_TO_COST[dfmProcess];
}

/**
 * 비용 추정 공정에 대응하는 DFM 공정 타입을 반환합니다.
 * fdm / sla / sls 등 DFM 미지원 공정은 null을 반환합니다.
 */
export function getDFMProcessForCost(costProcess: ProcessType): ManufacturingProcess | null {
  return COST_TO_DFM[costProcess] ?? null;
}

/**
 * DFM 결과 배열에서 특정 Cost 공정과 관련된 결과만 필터링합니다.
 * ManufacturingReadyCard 등 두 분석 결과를 연결할 때 사용합니다.
 */
export function filterDFMForCostProcess<T extends { process: ManufacturingProcess }>(
  dfmResults: T[],
  costProcess: ProcessType,
): T[] {
  const dfmProcess = getDFMProcessForCost(costProcess);
  if (!dfmProcess) return [];
  return dfmResults.filter((r) => r.process === dfmProcess);
}
