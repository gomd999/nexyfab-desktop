'use client';

import React, { useState, useMemo } from 'react';
import {
  SUPPLIERS, REGION_OPTIONS, MATERIAL_PROCESS_MAP, matchSuppliers,
  type Supplier, type ProcessType,
} from './supplierData';
import { PROCESS_ICONS, getProcessName } from './CostEstimator';

interface SupplierPanelProps {
  materialId: string;
  lang: string;
  onClose: () => void;
  /** Pre-select the process that got the best quote */
  defaultProcess?: ProcessType;
}

const C = {
  bg: '#161b22', card: '#21262d', border: '#30363d',
  accent: '#388bfd', accentBright: '#58a6ff',
  text: '#c9d1d9', dim: '#8b949e',
  green: '#3fb950', yellow: '#d29922', red: '#f85149',
};

function t(lang: string, ko: string, en: string) { return lang === 'ko' ? ko : en; }

function StarRating({ stars }: { stars: number }) {
  const full = Math.floor(stars);
  const half = stars % 1 >= 0.5;
  return (
    <span style={{ color: C.yellow, fontSize: 11, letterSpacing: -1 }}>
      {'★'.repeat(full)}{half ? '½' : ''}{'☆'.repeat(5 - full - (half ? 1 : 0))}
    </span>
  );
}

function SupplierCard({ s, lang }: { s: Supplier; lang: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{
        background: C.card, borderRadius: 8, border: `1px solid ${C.border}`,
        padding: '10px 12px', cursor: 'pointer', transition: 'border-color 0.15s',
      }}
      onClick={() => setExpanded(v => !v)}
      onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent)}
      onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
            {lang === 'ko' ? s.nameKo : s.name}
          </div>
          <div style={{ fontSize: 10, color: C.dim, marginTop: 1 }}>
            {s.regionLabel} · {s.processes.map(p => PROCESS_ICONS[p as keyof typeof PROCESS_ICONS] ?? '⚙').join(' ')}
            {' '}{s.processes.map(p => getProcessName(p as any, lang).split('/')[0]).join(', ')}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <StarRating stars={s.ratingStars} />
          <div style={{ fontSize: 9, color: C.dim }}>({s.reviewCount})</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        {s.tags.map(tag => (
          <span key={tag} style={{
            fontSize: 9, padding: '2px 6px', borderRadius: 10,
            background: `${C.accent}18`, color: C.accentBright, border: `1px solid ${C.accent}33`,
          }}>{tag}</span>
        ))}
      </div>

      {expanded && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 10 }}>
            <div>
              <span style={{ color: C.dim }}>{t(lang, '납기', 'Lead Time')}</span><br />
              <span style={{ color: C.text, fontWeight: 700 }}>
                {s.leadTimeDays.min}–{s.leadTimeDays.max} {t(lang, '일', 'days')}
              </span>
            </div>
            <div>
              <span style={{ color: C.dim }}>{t(lang, '최소발주', 'Min. Order')}</span><br />
              <span style={{ color: C.text, fontWeight: 700 }}>
                ₩{s.minOrderKRW.toLocaleString('ko-KR')}
              </span>
            </div>
          </div>
          {s.certifications.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 10, color: C.green }}>
              ✓ {s.certifications.join(' · ')}
            </div>
          )}
          {s.materials.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 9, color: C.dim }}>
              {t(lang, '소재', 'Materials')}: {s.materials.join(', ')}
            </div>
          )}
          {(s.contactEmail || s.website) && (
            <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
              {s.contactEmail && (
                <a href={`mailto:${s.contactEmail}`} style={{ fontSize: 10, color: C.accentBright }} onClick={e => e.stopPropagation()}>
                  ✉ {s.contactEmail}
                </a>
              )}
              {s.website && (
                <a href={s.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: C.accentBright }} onClick={e => e.stopPropagation()}>
                  🌐 {t(lang, '웹사이트', 'Website')}
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const ALL_PROCESSES: ProcessType[] = ['cnc', 'sheetmetal_laser', 'fdm', 'sla', 'sls', 'injection'];

export default function SupplierPanel({ materialId, lang, onClose, defaultProcess }: SupplierPanelProps) {
  const compatibleProcesses = useMemo(
    () => MATERIAL_PROCESS_MAP[materialId] ?? MATERIAL_PROCESS_MAP[materialId.split('_')[0]] ?? ALL_PROCESSES,
    [materialId],
  );

  const [selectedProcess, setSelectedProcess] = useState<ProcessType>(
    defaultProcess ?? compatibleProcesses[0] ?? 'cnc',
  );
  const [regionFilter, setRegionFilter] = useState('');

  const matched = useMemo(
    () => matchSuppliers(selectedProcess, materialId, regionFilter || undefined),
    [selectedProcess, materialId, regionFilter],
  );

  return (
    <div style={{
      width: 360, flexShrink: 0, borderLeft: `1px solid ${C.border}`,
      background: C.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '10px 14px',
        borderBottom: `1px solid ${C.border}`, gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>🏭</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>
            {t(lang, '공급사 매칭', 'Supplier Matching')}
          </div>
          <div style={{ fontSize: 9, color: C.dim }}>
            {t(lang, '재질·공정 기반 협력사 추천', 'Material + process based matching')}
          </div>
        </div>
        <button onClick={onClose} style={{
          border: 'none', background: C.card, cursor: 'pointer', fontSize: 12,
          color: C.dim, width: 24, height: 24, borderRadius: 6,
        }}>✕</button>
      </div>

      {/* Process selector */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, marginBottom: 6 }}>
          {t(lang, '공정', 'Process')}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {compatibleProcesses.map(p => (
            <button key={p} onClick={() => setSelectedProcess(p)} style={{
              padding: '4px 8px', borderRadius: 5, fontSize: 10, fontWeight: 700,
              border: `1px solid ${selectedProcess === p ? C.accent : C.border}`,
              background: selectedProcess === p ? `${C.accent}22` : 'transparent',
              color: selectedProcess === p ? C.accentBright : C.dim,
              cursor: 'pointer',
            }}>
              {PROCESS_ICONS[p as keyof typeof PROCESS_ICONS] ?? '⚙'} {getProcessName(p as any, lang).split('/')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Region filter */}
      <div style={{ padding: '8px 14px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, marginBottom: 4 }}>
          {t(lang, '지역', 'Region')}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {REGION_OPTIONS.map(r => (
            <button key={r.value} onClick={() => setRegionFilter(r.value)} style={{
              padding: '3px 8px', borderRadius: 10, fontSize: 9, fontWeight: 600,
              border: `1px solid ${regionFilter === r.value ? C.accent : C.border}`,
              background: regionFilter === r.value ? `${C.accent}22` : 'transparent',
              color: regionFilter === r.value ? C.accentBright : C.dim,
              cursor: 'pointer',
            }}>
              {r.label[lang === 'ko' ? 'ko' : 'en']}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {matched.length === 0 ? (
          <div style={{ fontSize: 11, color: C.dim, textAlign: 'center', padding: 24 }}>
            {t(lang, '해당 조건에 맞는 공급사가 없습니다', 'No suppliers match this criteria')}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 10, color: C.dim, marginBottom: 2 }}>
              {matched.length}{t(lang, '개 공급사 매칭됨', ' suppliers matched')}
            </div>
            {matched.map(s => <SupplierCard key={s.id} s={s} lang={lang} />)}
          </>
        )}

        <div style={{ fontSize: 9, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>
          {t(lang,
            '* 등록 업체 데이터 기준이며 실제 거래 전 별도 확인이 필요합니다.',
            '* Based on registered supplier data. Verify before placing orders.',
          )}
        </div>
      </div>
    </div>
  );
}
