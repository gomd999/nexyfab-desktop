/**
 * downgradeNoticeView — pure presentation logic for mesh-downgrade notices.
 *
 * Splits the "what does the banner say" decision out of the React component so
 * it is unit-testable headlessly. The component (DowngradeBanner.tsx) renders
 * whatever this returns. Resolves the notice i18nKey + op into a localized,
 * deduped, severity-ranked view-model.
 */

import type { MeshDowngradeNotice, DowngradeSeverity } from './downgradeNotice';

export interface DowngradeBannerItem {
  op: string;
  severity: DowngradeSeverity;
  /** Localized one-line message. */
  message: string;
  /** How many features collapsed into this row (deduped by op+severity). */
  count: number;
}

export interface DowngradeBannerModel {
  /** Total notices (before dedup). 0 → the banner should not render. */
  total: number;
  blocked: number;
  approximated: number;
  /** Worst severity present, or null when empty. */
  worst: DowngradeSeverity | null;
  /** Localized headline. */
  headline: string;
  /** Deduped rows, blocked first then approximated, each op once. */
  items: DowngradeBannerItem[];
}

type Locale = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

const LANG_MAP: Record<string, Locale> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

/** `{op}`-templated messages per severity + the banner headline. */
const DICT: Record<Locale, { headline: string; approximated: (op: string) => string; blocked: (op: string) => string }> = {
  ko: {
    headline: '정밀도 주의',
    approximated: (op) => `${op}: 메시로 근사됨 — 정밀 B-rep 엔진을 켜세요`,
    blocked: (op) => `${op}: B-rep 필요 — 메시로는 이 연산을 만들 수 없습니다`,
  },
  en: {
    headline: 'Precision notice',
    approximated: (op) => `${op}: computed as a mesh approximation — enable the B-rep engine for an exact result`,
    blocked: (op) => `${op}: needs the B-rep engine — the mesh path cannot produce this operation`,
  },
  ja: {
    headline: '精度の注意',
    approximated: (op) => `${op}: メッシュ近似で計算 — 正確な結果には B-rep エンジンを有効化`,
    blocked: (op) => `${op}: B-rep が必要 — メッシュではこの操作を生成できません`,
  },
  zh: {
    headline: '精度提示',
    approximated: (op) => `${op}：以网格近似计算 — 启用 B-rep 引擎以获得精确结果`,
    blocked: (op) => `${op}：需要 B-rep 引擎 — 网格无法生成此操作`,
  },
  es: {
    headline: 'Aviso de precisión',
    approximated: (op) => `${op}: calculado como aproximación de malla — active el motor B-rep para un resultado exacto`,
    blocked: (op) => `${op}: requiere el motor B-rep — la malla no puede producir esta operación`,
  },
  ar: {
    headline: 'تنبيه الدقة',
    approximated: (op) => `${op}: حُسب كتقريب شبكي — فعّل محرك B-rep للحصول على نتيجة دقيقة`,
    blocked: (op) => `${op}: يتطلب محرك B-rep — لا يمكن للشبكة إنتاج هذه العملية`,
  },
};

const SEVERITY_RANK: Record<DowngradeSeverity, number> = { blocked: 0, approximated: 1 };

/**
 * Build the banner view-model from the raw notices stamped on a geometry.
 * Dedupes by (op, severity) so a 3-fillet part shows one "Fillet" row with
 * count 3, and orders blocked (hard) before approximated (soft).
 */
export function summarizeDowngrades(
  notices: readonly MeshDowngradeNotice[],
  lang: string,
): DowngradeBannerModel {
  const t = DICT[LANG_MAP[lang] ?? 'en']!;
  const total = notices.length;
  const blocked = notices.filter((n) => n.severity === 'blocked').length;
  const approximated = total - blocked;

  // Dedup by op+severity, counting collisions.
  const byKey = new Map<string, DowngradeBannerItem>();
  for (const n of notices) {
    const key = `${n.severity}:${n.op}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byKey.set(key, {
        op: n.op,
        severity: n.severity,
        message: n.severity === 'blocked' ? t.blocked(n.op) : t.approximated(n.op),
        count: 1,
      });
    }
  }

  const items = [...byKey.values()].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.op.localeCompare(b.op),
  );

  return {
    total,
    blocked,
    approximated,
    worst: total === 0 ? null : blocked > 0 ? 'blocked' : 'approximated',
    headline: t.headline,
    items,
  };
}
