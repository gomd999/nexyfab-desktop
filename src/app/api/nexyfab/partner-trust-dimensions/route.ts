import { NextResponse } from 'next/server';

/**
 * Phase 7-5 — 공급사 신뢰·평가 **차원 스키마** (읽기 전용).
 *
 * 단일 점수가 아니라 차원별 지표로 나눈다는 정책(`current-status.md` §6.4)에 맞춘
 * 메타데이터입니다. 실제 집계·저장은 후속 마이그레이션에서 `nf_partner_*` 등과 연결합니다.
 */
export interface PartnerTrustDimension {
  id: string;
  labelKo: string;
  labelEn: string;
  /** 0–100 스케일 권장 (UI/정책용 힌트) */
  scaleHint: string;
}

const DIMENSIONS: PartnerTrustDimension[] = [
  { id: 'delivery', labelKo: '납기 준수', labelEn: 'On-time delivery', scaleHint: '0–100' },
  { id: 'quality', labelKo: '품질·불량', labelEn: 'Quality & defect rate', scaleHint: '0–100' },
  { id: 'responsiveness', labelKo: '응답 속도', labelEn: 'Response time', scaleHint: '0–100' },
  { id: 'communication', labelKo: '소통', labelEn: 'Communication', scaleHint: '0–100' },
  { id: 'process_fit', labelKo: '공정 적합도', labelEn: 'Process fit', scaleHint: '0–100' },
];

export async function GET() {
  return NextResponse.json({
    version: 1,
    policyNote:
      'No single credit score — dimensions are evaluated separately (Phase 7-5).',
    dimensions: DIMENSIONS,
  });
}
