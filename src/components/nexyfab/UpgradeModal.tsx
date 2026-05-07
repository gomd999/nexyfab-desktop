'use client';

/**
 * UpgradeModal.tsx
 *
 * Shows when a free-plan user tries to use a Pro-only feature or has
 * exceeded their monthly usage limit. Links to /pricing.
 */

import React from 'react';
import type { FreemiumFeature } from '@/hooks/useFreemium';
import { isKorean } from '@/lib/i18n/normalize';

interface UpgradeModalProps {
  open: boolean;
  feature: FreemiumFeature;
  /** If true, user hit a monthly limit (not a hard Pro-only gate) */
  overLimit?: boolean;
  used?: number;
  limit?: number;
  lang: string;
  onClose: () => void;
}

const FEATURE_INFO: Record<FreemiumFeature, {
  icon: string;
  nameKo: string;
  nameEn: string;
  descKo: string;
  descEn: string;
}> = {
  ai_advisor: {
    icon: '🤖',
    nameKo: 'AI 치수·재료 추천',
    nameEn: 'AI Dimension Advisor',
    descKo: 'AI가 재질·환경 조건에 맞는 최적 치수와 재료를 제안합니다.',
    descEn: 'AI suggests optimal dimensions and materials based on load and environment conditions.',
  },
  cam_export: {
    icon: '⚙️',
    nameKo: 'CAM G-코드 내보내기',
    nameEn: 'CAM G-code Export',
    descKo: 'CNC 컨트롤러용 G-코드를 생성하고 다운로드합니다.',
    descEn: 'Generate and download G-code for CNC controllers (Fanuc, Mazak, Haas).',
  },
  supplier_match: {
    icon: '🏭',
    nameKo: '공급사 매칭',
    nameEn: 'Supplier Matching',
    descKo: '재질과 공정에 맞는 국내 제조 협력사를 매칭합니다.',
    descEn: 'Match domestic manufacturing suppliers by material and process.',
  },
  rfq_bundle: {
    icon: '📦',
    nameKo: 'RFQ 패키지 다운로드',
    nameEn: 'RFQ Bundle Download',
    descKo: '견적서 · 도면 · DFM 보고서를 ZIP 패키지로 다운로드합니다.',
    descEn: 'Download quote, drawing, and DFM report as a ZIP bundle.',
  },
  dfm_autofix: {
    icon: '🔧',
    nameKo: 'DFM 자동 수정',
    nameEn: 'DFM Auto-Fix',
    descKo: 'DFM 분석이 찾아낸 문제를 한 번의 클릭으로 안전한 값으로 교정합니다.',
    descEn: 'Apply recommended parameter fixes from the DFM analysis in a single click.',
  },
  collaboration_edit: {
    icon: '👥',
    nameKo: '실시간 협업 편집',
    nameEn: 'Real-time Collaboration',
    descKo: '공유된 세션에서 동시 편집하고, 변경 이력을 함께 추적합니다. 무료 플랜은 읽기 전용입니다.',
    descEn: 'Edit shared sessions together in real-time. Free plan is view-only.',
  },
  export_optimize: {
    icon: '🚀',
    nameKo: '내보내기 전 최적화',
    nameEn: 'Pre-Export Optimization',
    descKo: '내보내기 전에 비-매니폴드 정리, 법선 정렬, LOD 단순화를 자동으로 실행합니다.',
    descEn: 'Auto-repair non-manifold geometry, align normals, and run LOD simplification before export.',
  },
  dfm_insights: {
    icon: '💡',
    nameKo: 'AI DFM 설명 + 단가 영향',
    nameEn: 'AI DFM Explainer + Cost Impact',
    descKo: 'AI가 DFM 문제의 근본 원인을 설명하고, 수정 시 단가 변화를 실시간으로 계산합니다.',
    descEn: 'AI explains DFM root causes and calculates real-time cost delta for each fix suggestion.',
  },
  process_router: {
    icon: '🧭',
    nameKo: 'AI 공정 라우터',
    nameEn: 'AI Process Router',
    descKo: 'AI가 형상·재질·수량에 최적인 제조 공정(CNC/판금/3D/주조)을 추천하고 단가·리드타임을 비교합니다.',
    descEn: 'AI recommends the optimal manufacturing process (CNC/sheet/3D/casting) for your shape and compares cost & lead time.',
  },
  ai_supplier_match: {
    icon: '🎯',
    nameKo: 'AI 공급사 Top 3 매칭',
    nameEn: 'AI Supplier Top-3 Match',
    descKo: 'AI가 재질·공정·수량·크기를 종합 분석해 최적 공급사 Top 3를 추천하고 RFQ 작성 포인트까지 제시합니다.',
    descEn: 'AI analyzes material, process, quantity & size to recommend Top-3 suppliers with tailored RFQ talking points.',
  },
  cost_copilot: {
    icon: '💰',
    nameKo: '비용 절감 코파일럿',
    nameEn: 'Design-for-Cost Copilot',
    descKo: '"비용 20% 줄여줘" 같은 자연어 질문에 AI가 파라미터·재료·공정 변경 제안과 예상 절감률을 돌려줍니다.',
    descEn: 'Ask "cut cost by 20%" in plain language — AI returns parameter, material, and process changes with projected savings.',
  },
};

const PRO_BENEFITS_KO = [
  '🤖 AI 치수·재료 추천 무제한',
  '⚙️ CAM G-코드 내보내기 (Fanuc/Mazak/Haas)',
  '🏭 공급사 매칭 무제한 조회',
  '📦 RFQ 패키지 다운로드',
  '☁️ 클라우드 프로젝트 무제한 저장',
  '📊 NexyFlow 견적 승인 연동',
];

const PRO_BENEFITS_EN = [
  '🤖 Unlimited AI dimension & material advisor',
  '⚙️ CAM G-code export (Fanuc / Mazak / Haas)',
  '🏭 Unlimited supplier matching',
  '📦 RFQ bundle download',
  '☁️ Unlimited cloud project storage',
  '📊 NexyFlow quote approval integration',
];

export default function UpgradeModal({
  open, feature, overLimit, used, limit, lang, onClose,
}: UpgradeModalProps) {
  if (!open) return null;
  const isKo = isKorean(lang);
  const info = FEATURE_INFO[feature];
  const benefits = isKo ? PRO_BENEFITS_KO : PRO_BENEFITS_EN;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 400,
          background: '#161b22', border: '1px solid #30363d',
          borderRadius: 16, overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header gradient */}
        <div style={{
          background: 'linear-gradient(135deg, #1a2e4a, #1a1a3a)',
          borderBottom: '1px solid #30363d',
          padding: '20px 24px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>⚡</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#e6edf3', marginBottom: 4 }}>
            {isKo ? 'Pro 플랜이 필요합니다' : 'Pro Plan Required'}
          </div>
          <div style={{ fontSize: 12, color: '#8b949e' }}>
            {isKo ? 'Pro로 업그레이드하고 모든 기능을 사용하세요' : 'Upgrade to Pro and unlock all features'}
          </div>
        </div>

        <div style={{ padding: '20px 24px' }}>
          {/* Blocked feature */}
          <div style={{
            background: '#21262d', borderRadius: 10,
            border: '1px solid #30363d', padding: '12px 16px', marginBottom: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>{info.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>
                  {isKo ? info.nameKo : info.nameEn}
                </div>
                <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>
                  {isKo ? info.descKo : info.descEn}
                </div>
              </div>
            </div>
            {overLimit && limit !== undefined && used !== undefined && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11, color: '#8b949e' }}>
                  <span>{isKo ? '이번 달 사용량' : 'Monthly usage'}</span>
                  <span style={{ color: '#f85149', fontWeight: 700 }}>{used} / {limit}</span>
                </div>
                <div style={{ height: 4, background: '#30363d', borderRadius: 2 }}>
                  <div style={{ height: '100%', width: '100%', background: '#f85149', borderRadius: 2 }} />
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: '#f85149' }}>
                  {isKo
                    ? `이번 달 무료 한도 ${limit}회를 모두 사용했습니다.`
                    : `You've used all ${limit} free uses this month.`}
                </div>
              </div>
            )}
          </div>

          {/* Pro benefits */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Pro {isKo ? '플랜 혜택' : 'Plan includes'}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {benefits.map((b, i) => (
                <div key={i} style={{ fontSize: 12, color: '#c9d1d9', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <span style={{ color: '#3fb950', flexShrink: 0 }}>✓</span>
                  <span>{b}</span>
                </div>
              ))}
            </div>
          </div>

          {/* CTA buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 8,
                border: '1px solid #30363d', background: 'transparent',
                color: '#8b949e', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#58a6ff'; e.currentTarget.style.color = '#e6edf3'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e'; }}
            >
              {isKo ? '나중에' : 'Later'}
            </button>
            <a
              href={`/${lang}/pricing`}
              style={{
                flex: 2, padding: '10px 0', borderRadius: 8, border: 'none',
                background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer',
                textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              ⚡ {isKo ? 'Pro 업그레이드' : 'Upgrade to Pro'}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
