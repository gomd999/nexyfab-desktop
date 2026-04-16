/**
 * matching.ts — 공장 자동 매칭 알고리즘
 * 문의(inquiry) 기준으로 승인된 파트너들에게 점수를 매겨 상위 5개 반환
 */

export interface ScoreBreakdown {
  field: number;      // 분야 매칭 (max 40)
  budget: number;     // 예산 적합 (max 30)
  rating: number;     // 평점 보너스 (max 20)
  experience: number; // 완료 건수 (max 10)
}

export interface MatchScore {
  partnerId: string;
  email: string;
  company: string;
  score: number; // 0-100
  reasons: string[];
  breakdown: ScoreBreakdown;
}

/**
 * 금액 문자열을 만원 단위 숫자로 파싱 (다통화 지원)
 * 예) "5000만원" → 5000, "1억원" → 10000, "$500,000" → 약 5000만원
 * ¥3,000,000 (JPY) → 약 3000만원, ¥350,000 (CNY) → 약 5000만원
 */

// 대략적 환산율 (만원 기준). 정밀 환산 불필요, 범위 매칭이므로 근사치 사용.
const CURRENCY_TO_MANWON: Record<string, number> = {
  KRW: 1,            // 1만원 = 1
  USD: 1350,         // $1 = 약 1350원 → 1만원 = $7.4
  CNY: 185,          // ¥1(CNY) = 약 185원 → 1만원 = ¥54
  JPY: 9,            // ¥1(JPY) = 약 9원 → 1만원 = ¥1111
  EUR: 1470,         // €1 = 약 1470원
};

function parseAmount(str: string): number | null {
  if (!str) return null;
  const s = str.replace(/\s/g, '');

  // Korean style: 억/만
  const eokMatch = s.match(/(\d+(?:\.\d+)?)억/);
  const manMatch = s.match(/(\d+)만/);
  if (eokMatch || manMatch) {
    let result = 0;
    if (eokMatch) result += parseFloat(eokMatch[1]) * 10000;
    if (manMatch) result += parseInt(manMatch[1], 10);
    return result > 0 ? result : null;
  }

  // International currencies: $, €, ¥, ￥ + numeric
  const currencyMatch = s.match(/^([$€¥￥]|USD|CNY|JPY|EUR|KRW)?([\d,]+(?:\.\d+)?)\s*(USD|CNY|JPY|EUR|KRW|원)?$/i);
  if (currencyMatch) {
    const prefix = currencyMatch[1] || '';
    const numStr = currencyMatch[2].replace(/,/g, '');
    const suffix = currencyMatch[3] || '';
    const amount = parseFloat(numStr);
    if (isNaN(amount)) return null;

    let currency = 'KRW';
    const sym = (prefix + suffix).toUpperCase();
    if (sym.includes('$') || sym.includes('USD')) currency = 'USD';
    else if (sym.includes('€') || sym.includes('EUR')) currency = 'EUR';
    else if (sym.includes('¥') || sym.includes('￥') || sym.includes('CNY')) {
      // Disambiguate JPY vs CNY by magnitude: >10000 is likely JPY
      currency = amount > 10000 ? 'JPY' : 'CNY';
    }
    else if (sym.includes('JPY')) currency = 'JPY';
    else if (sym.includes('원') || sym.includes('KRW')) currency = 'KRW';

    const rate = CURRENCY_TO_MANWON[currency] || 1;
    const manwon = (amount * rate) / 10000;
    return manwon > 0 ? Math.round(manwon) : null;
  }

  return null;
}

/**
 * "이하", "이상", "~" 패턴 파싱으로 범위 객체 반환
 * 반환: { min: 만원, max: 만원 } (없으면 0 / Infinity)
 */
function parseRange(str: string): { min: number; max: number } | null {
  if (!str) return null;
  const s = str.replace(/\s/g, '');

  // 범위: "A~B" or "A 이상 ~ B 이하"
  if (s.includes('~')) {
    const parts = s.split('~');
    const lo = parseAmount(parts[0]);
    const hi = parseAmount(parts[1]);
    if (lo !== null || hi !== null) {
      return { min: lo ?? 0, max: hi ?? Infinity };
    }
  }

  // 이하
  const ihaMatch = s.match(/^([\d억만원]+)이하$/);
  if (ihaMatch) {
    const val = parseAmount(ihaMatch[1]);
    if (val !== null) return { min: 0, max: val };
  }

  // 이상
  const isangMatch = s.match(/^([\d억만원]+)이상$/);
  if (isangMatch) {
    const val = parseAmount(isangMatch[1]);
    if (val !== null) return { min: val, max: Infinity };
  }

  // 단순 금액 (단일 값이면 ±50% 허용)
  const single = parseAmount(s);
  if (single !== null) {
    return { min: single * 0.5, max: single * 1.5 };
  }

  return null;
}

/**
 * 예산 범위 매칭
 * 문의 예산 범위와 파트너 수용 금액 범위가 겹치면 true
 */
export function checkBudgetMatch(
  inquiryBudget: string,
  partnerAmount: string
): boolean {
  if (!inquiryBudget || !partnerAmount) return false;
  const inqRange = parseRange(inquiryBudget);
  const partRange = parseRange(partnerAmount);
  if (!inqRange || !partRange) return false;
  // 범위 겹침 확인
  return inqRange.min <= partRange.max && partRange.min <= inqRange.max;
}

/**
 * 파트너 매칭 메인 함수
 * @param inquiry  문의 객체 (request_field, budget_range 등)
 * @param partners 파트너 목록 (partnerStatus, match_field, amount, avgRating, completedCount 등)
 */
export function matchPartners(inquiry: any, partners: any[]): MatchScore[] {
  return partners
    .filter((p) => p.partnerStatus === 'approved')
    .map((p) => {
      let score = 0;
      const reasons: string[] = [];
      const breakdown: ScoreBreakdown = { field: 0, budget: 0, rating: 0, experience: 0 };

      // 1. 분야 매칭 (최대 40점)
      const inqFields = (inquiry.request_field || '')
        .toLowerCase()
        .split(/[,\s\/]+/)
        .filter(Boolean);
      const partnerFields = (p.match_field || '')
        .toLowerCase()
        .split(/[,\s\/]+/)
        .filter(Boolean);

      const fieldOverlap = inqFields.filter((f: string) =>
        partnerFields.some((pf: string) => pf.includes(f) || f.includes(pf))
      );
      if (fieldOverlap.length > 0) {
        const fieldScore = Math.min(40, fieldOverlap.length * 15);
        score += fieldScore;
        breakdown.field = fieldScore;
        reasons.push(`분야 일치: ${fieldOverlap.join(', ')}`);
      }

      // 2. 예산 범위 매칭 (30점)
      if (checkBudgetMatch(inquiry.budget_range, p.amount)) {
        score += 30;
        breakdown.budget = 30;
        reasons.push('예산 범위 적합');
      }

      // 3. 평점 보너스 (최대 20점)
      if (p.avgRating && p.avgRating > 0) {
        const ratingScore = Math.round((p.avgRating / 5) * 20);
        score += ratingScore;
        breakdown.rating = ratingScore;
        reasons.push(`평점 ${Number(p.avgRating).toFixed(1)}점`);
      }

      // 4. 완료 건수 보너스 (최대 10점)
      if (p.completedCount && p.completedCount > 0) {
        const expScore = Math.min(10, p.completedCount * 2);
        score += expScore;
        breakdown.experience = expScore;
        reasons.push(`완료 프로젝트 ${p.completedCount}건`);
      }

      return {
        partnerId: p.id,
        email: p.email || '',
        company: p.company || p.name || '(미입력)',
        score,
        reasons,
        breakdown,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
