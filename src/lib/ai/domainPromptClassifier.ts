import type { DesignDomainId } from './domainProfile';

export interface DomainRecommendation {
  domain: DesignDomainId;
  score: number;
  reasons: string[];
}

const CLASSIFIER_DOMAINS: readonly DesignDomainId[] = ['mechanical', 'building', 'civil', 'landscape', 'interior'];
const KEYWORDS: Record<DesignDomainId, readonly string[]> = {
  mechanical: ['기계', '제품', '부품', '조립', '기어', '브래킷', '축', '베어링', '공차', '가공', 'mechanical', 'product', 'part', 'assembly', 'gear', 'bracket', 'bearing'],
  building: ['건축', '건물', '층', '벽', '문', '창호', '지붕', '피난', 'bim', 'building', 'architecture', 'storey', 'wall', 'roof', 'egress'],
  civil: ['토목', '도로', '교량', '선형', '측량', '종단', '횡단', '배수', '코리더', 'civil', 'road', 'bridge', 'alignment', 'survey', 'drainage', 'corridor'],
  landscape: ['조경', '식재', '수목', '관수', '정원', '광장', '토양', 'landscape', 'planting', 'tree', 'irrigation', 'garden', 'soil'],
  interior: ['인테리어', '실내', '가구', '마감', '천장', '조명', '밀워크', 'interior', 'furniture', 'finish', 'ceiling', 'lighting', 'millwork'],
};

type KeywordHit = { domain: DesignDomainId; keyword: string; start: number; end: number };

function keywordHits(prompt: string, domain: DesignDomainId): KeywordHit[] {
  const hits: KeywordHit[] = [];
  for (const keyword of KEYWORDS[domain]) {
    let cursor = 0;
    while (cursor < prompt.length) {
      const start = prompt.indexOf(keyword, cursor);
      if (start < 0) break;
      const end = start + keyword.length;
      const asciiKeyword = /^[a-z0-9]+$/.test(keyword);
      const left = start === 0 ? '' : prompt[start - 1]!;
      const right = end === prompt.length ? '' : prompt[end]!;
      // Latin terms must be complete words: `part` must not classify
      // `apartment` as mechanical.
      const completeWord = !asciiKeyword || (!/[a-z0-9_]/.test(left) && !/[a-z0-9_]/.test(right));
      if (completeWord) hits.push({ domain, keyword, start, end });
      cursor = Math.max(end, start + 1);
    }
  }
  return hits;
}

/** Small, deterministic classifier shared by the landing client and the governed planner. */
export function recommendDesignDomains(prompt: string): DomainRecommendation[] {
  const normalized = prompt.toLocaleLowerCase();
  const allHits = CLASSIFIER_DOMAINS.flatMap(domain => keywordHits(normalized, domain));
  // Prefer the more specific phrase when keywords overlap across domains.
  // Example: the mechanical keyword `축` is nested inside building keyword
  // `건축`; counting both made an unambiguous building request look tied.
  const hits = allHits.filter(hit => !allHits.some(other => (
    other !== hit
    && other.start <= hit.start
    && other.end >= hit.end
    && other.end - other.start > hit.end - hit.start
  )));
  const raw = CLASSIFIER_DOMAINS.map(domain => {
    const reasons = [...new Set(hits.filter(hit => hit.domain === domain).map(hit => hit.keyword))];
    return { domain, matches: reasons.length, reasons };
  });
  const total = raw.reduce((sum, item) => sum + item.matches, 0);
  return raw
    .filter(item => item.matches > 0)
    .map(item => ({ domain: item.domain, score: total ? item.matches / total : 0, reasons: [...item.reasons] }))
    .sort((a, b) => b.score - a.score || a.domain.localeCompare(b.domain));
}
