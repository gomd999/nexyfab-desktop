/**
 * Phase 7-5 — 차원별 신뢰 지표 집계 (단일 신용점수로 collapse 하지 않음).
 *
 * 데이터 원천:
 *  - `getPartnerMetrics` / `nf_partner_metric_events` (납품·견적 응답·리뷰 이벤트)
 *  - `nf_reviews` 직접 AVG — 이벤트 테이블보다 리뷰만 먼저 쌓인 콜드스타트 보조
 *
 * 스키마 ID는 `GET /api/nexyfab/partner-trust-dimensions` 와 동일한 5축을 유지합니다.
 */
import { getDbAdapter } from './db-adapter';
import { getPartnerMetrics } from './partner-metrics';
import { normPartnerEmail } from './partner-factory-access';

export type TrustDimId = 'delivery' | 'quality' | 'responsiveness' | 'communication' | 'process_fit';

export interface PartnerTrustAggregateRow {
  id: TrustDimId;
  labelKo: string;
  labelEn: string;
  displayKo: string;
  displayEn: string;
  sampleSize: number;
}

export async function getPartnerTrustAggregateRows(
  partnerEmail: string,
  windowDays = 90,
): Promise<PartnerTrustAggregateRow[]> {
  const emailKey = normPartnerEmail(partnerEmail);
  const m = await getPartnerMetrics(partnerEmail, windowDays);
  const db = getDbAdapter();

  const rv = await db.queryOne<{
    n: number;
    qa: number | null;
    ca: number | null;
    da: number | null;
  }>(
    `SELECT COUNT(*) as n,
            AVG(cat_quality) as qa,
            AVG(cat_communication) as ca,
            AVG(cat_deadline) as da
       FROM nf_reviews
      WHERE partner_email IS NOT NULL AND LOWER(TRIM(partner_email)) = ?`,
    emailKey,
  ).catch(() => null);

  const rvN = rv?.n ?? 0;
  const rvQa = rv?.qa != null && Number.isFinite(Number(rv.qa)) ? Math.round(Number(rv.qa) * 10) / 10 : null;
  const rvCa = rv?.ca != null && Number.isFinite(Number(rv.ca)) ? Math.round(Number(rv.ca) * 10) / 10 : null;
  const rvDa = rv?.da != null && Number.isFinite(Number(rv.da)) ? Math.round(Number(rv.da) * 10) / 10 : null;

  const qualityVal = m.reviewCount > 0 && m.qualityAvg != null ? m.qualityAvg : rvQa;
  const commVal = m.reviewCount > 0 && m.communicationAvg != null ? m.communicationAvg : rvCa;
  const deadlineStars = m.reviewCount > 0 && m.deadlineRatingAvg != null ? m.deadlineRatingAvg : rvDa;
  const reviewSamples = m.reviewCount > 0 ? m.reviewCount : rvN;

  const deliveryN = m.onTimeCount + m.lateCount;
  let deliveryKo: string;
  let deliveryEn: string;
  let deliverySamples: number;
  if (m.onTimeRate != null && deliveryN > 0) {
    deliveryKo = `납기 준수율 ${m.onTimeRate}% · 납품 ${deliveryN}건`;
    deliveryEn = `On-time ${m.onTimeRate}% · ${deliveryN} deliveries`;
    deliverySamples = deliveryN;
  } else if (deadlineStars != null && rvN > 0) {
    deliveryKo = `리뷰 납기 평균 ${deadlineStars.toFixed(1)}/5 · ${rvN}건`;
    deliveryEn = `Deadline rating avg ${deadlineStars.toFixed(1)}/5 · ${rvN} reviews`;
    deliverySamples = rvN;
  } else {
    deliveryKo = '납품·리뷰 납기 데이터 없음';
    deliveryEn = 'No delivery / deadline samples yet';
    deliverySamples = 0;
  }

  const rows: PartnerTrustAggregateRow[] = [
    {
      id: 'delivery',
      labelKo: '납기 준수',
      labelEn: 'On-time delivery',
      displayKo: deliveryKo,
      displayEn: deliveryEn,
      sampleSize: deliverySamples,
    },
    {
      id: 'quality',
      labelKo: '품질·불량',
      labelEn: 'Quality & defect rate',
      displayKo: qualityVal != null ? `평균 ${qualityVal.toFixed(1)}/5` : '데이터 없음',
      displayEn: qualityVal != null ? `Avg ${qualityVal.toFixed(1)}/5` : 'No data',
      sampleSize: reviewSamples,
    },
    {
      id: 'responsiveness',
      labelKo: '응답 속도',
      labelEn: 'Response time',
      displayKo:
        m.avgResponseMinutes != null && m.responseSamples > 0
          ? `견적 회신 평균 ${Math.round(m.avgResponseMinutes)}분 · 샘플 ${m.responseSamples}건`
          : '견적 응답 샘플 없음',
      displayEn:
        m.avgResponseMinutes != null && m.responseSamples > 0
          ? `Avg quote response ${Math.round(m.avgResponseMinutes)} min · ${m.responseSamples} samples`
          : 'No quote response samples',
      sampleSize: m.responseSamples,
    },
    {
      id: 'communication',
      labelKo: '소통',
      labelEn: 'Communication',
      displayKo: commVal != null ? `평균 ${commVal.toFixed(1)}/5` : '데이터 없음',
      displayEn: commVal != null ? `Avg ${commVal.toFixed(1)}/5` : 'No data',
      sampleSize: reviewSamples,
    },
    {
      id: 'process_fit',
      labelKo: '공정 적합도',
      labelEn: 'Process fit',
      displayKo:
        m.defectCount > 0 && m.defectResolutionRate != null
          ? `불량 해결률 ${m.defectResolutionRate}% · 제기 ${m.defectCount}건`
          : m.defectCount > 0
            ? `불량 제기 ${m.defectCount}건 (해결 이벤트 없음)`
            : '불량·RMA 샘플 없음',
      displayEn:
        m.defectCount > 0 && m.defectResolutionRate != null
          ? `Defect resolution ${m.defectResolutionRate}% · ${m.defectCount} reported`
          : m.defectCount > 0
            ? `${m.defectCount} defect(s) reported (no resolution events)`
            : 'No defect / RMA samples',
      sampleSize: m.defectCount,
    },
  ];

  return rows;
}
