/**
 * /examples — 예시 갤러리 (29축 P, 2026-07-16).
 * 전 분야 10종 결정론 파이프라인 산출물: 카드(분야·핵심 수치·검증 요약) →
 * [3D 보기]=자립형 GA 뷰어(조정 패널 v2) · [스튜디오에서 만들기]=해당 분야 프리필.
 * 정직: 모든 수치는 빌드·검증 엔진 실측값(매니페스트는 생성 시점 산출) — 마케팅 수치 없음.
 */
import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/metaHelper';
import { toIsoLang } from '@/lib/i18n/normalize';
import manifest from './manifest.json';

export async function generateMetadata(
  { params }: { params: Promise<{ lang: string }> }
): Promise<Metadata> {
  const { lang } = await params;
  return buildMetadata(lang, 'nexyfab');
}

interface Example {
  slug: string; domain: string; studioDomain: string; icon: string;
  titleKo: string; titleEn: string; descKo: string; descEn: string;
  stats: { parts: number | null; areaM2: number | null; massKg: number | null; manifold: boolean | null; interferences: number | null; egressM?: number; egressPass?: boolean };
}

const DOMAIN_COLOR: Record<string, string> = {
  mech: '#3b82f6', rack: '#6366f1', civil: '#0ea5e9', bridge: '#0891b2',
  building: '#8b5cf6', landscape: '#22c55e', interior: '#f59e0b',
};

export default async function ExamplesPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const ko = toIsoLang(lang) === 'ko';
  const items = manifest as Example[];

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '96px 20px 60px', fontFamily: "'Segoe UI',sans-serif" }}>
      <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.02em', margin: '0 0 6px' }}>
        {ko ? '예시 갤러리 — 기계부터 인테리어·교량까지' : 'Example gallery — mechanical to interiors & bridges'}
      </h1>
      <p style={{ fontSize: 14, color: '#5a6875', margin: '0 0 26px', lineHeight: 1.6 }}>
        {ko
          ? '전부 NexyFab 결정론 파이프라인 산출물입니다(AI 형상 생성 없음). 수치는 빌드·검증 엔진 실측값이며, 3D는 브라우저에서 바로 열립니다(분해·단면·계통 토글 포함).'
          : 'All produced by the NexyFab deterministic pipeline (no AI geometry). Figures are engine-measured; 3D opens right in your browser.'}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 16 }}>
        {items.map((ex) => {
          const c = DOMAIN_COLOR[ex.domain] ?? '#64748b';
          const s = ex.stats;
          const chips: string[] = [];
          if (s.parts) chips.push((ko ? '부품 ' : 'parts ') + s.parts);
          if (s.areaM2) chips.push(s.areaM2 + '㎡');
          if (s.massKg) chips.push((s.massKg >= 1000 ? (s.massKg / 1000).toFixed(1) + 't' : Math.round(s.massKg) + 'kg'));
          if (s.manifold === true) chips.push('manifold ✓');
          if (s.interferences === 0) chips.push(ko ? '간섭 0' : 'no clash');
          if (typeof s.egressM === 'number') chips.push((ko ? '피난 ' : 'egress ') + s.egressM + 'm' + (s.egressPass ? ' ✓' : ''));
          return (
            <div key={ex.slug} style={{ border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column' }}>
              <div style={{ height: 8, background: c }} />
              <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>
                  <span aria-hidden style={{ marginRight: 7 }}>{ex.icon}</span>{ko ? ex.titleKo : ex.titleEn}
                </div>
                <div style={{ fontSize: 12, color: '#5a6875', lineHeight: 1.55, marginBottom: 10 }}>{ko ? ex.descKo : ex.descEn}</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
                  {chips.map((ch) => (
                    <span key={ch} style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: '#f1f5f9', color: '#334155', fontVariantNumeric: 'tabular-nums' }}>{ch}</span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                  <a href={`/examples/${ex.slug}/GA_3D.html`} target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, textAlign: 'center', padding: '9px 0', borderRadius: 9, background: c, color: '#fff', fontSize: 12.5, fontWeight: 800, textDecoration: 'none' }}>
                    🧊 {ko ? '3D 보기' : 'View 3D'}
                  </a>
                  <a href={`/${lang}/nexyfab/design/?domain=${ex.studioDomain}`}
                    style={{ flex: 1, textAlign: 'center', padding: '9px 0', borderRadius: 9, border: `1.5px solid ${c}`, color: c, fontSize: 12.5, fontWeight: 800, textDecoration: 'none' }}>
                    {ko ? '직접 만들기 →' : 'Make yours →'}
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ marginTop: 26, fontSize: 11, color: '#94a3b8' }}>
        {ko ? 'AI 응답·산출물은 비법정 참고자료입니다. 최종 검토·서명은 유자격 기술자의 책임입니다.' : 'Outputs are non-statutory references; final review by a qualified engineer.'}
      </p>
    </div>
  );
}
