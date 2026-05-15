'use client';

// L2 — Smart Fastener panel UI for K6.
//
// Walks the design's hole features (and per-part hole features in an
// assembly), runs `suggestFasteners` to find aligned hole pairs across two
// distinct parts, and lists each suggestion with a "Apply to BOM" button.
//
// Hole extraction is a best-effort heuristic — currently we read each
// `hole` feature's posX/posY/posZ + diameter directly. True multi-part
// detection requires the assembly snapshot to track per-part feature lists,
// which is a B1-tier follow-up.

import React, { useMemo, useState } from 'react';
import {
  suggestFasteners, suggestionToBomRows,
  type HoleEntry, type FastenerSuggestion,
} from './smartFastener';
import type { FeatureInstance } from '../features/types';

interface SmartFastenerPanelProps {
  open: boolean;
  /** Top-level part name used as the partId for design-level holes. */
  rootPartName: string;
  /** Design tree features (hole feature instances are extracted from here). */
  features: FeatureInstance[];
  /** Optional assembly bodies — each row contributes its hole features. */
  assemblyBodies?: Array<{
    partId: string;
    position?: [number, number, number];
    features: FeatureInstance[];
  }>;
  lang: 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';
  onClose: () => void;
  /**
   * Caller commits the chosen suggestion to the BOM/assembly. The panel emits
   * the BOM-ready rows; the host wires them into the project (and optionally
   * into PLM via F9/G9).
   */
  onApply: (s: FastenerSuggestion, bomRows: ReturnType<typeof suggestionToBomRows>) => void;
}

const dict = {
  ko: { title: '스마트 체결구', detect: '구멍 감지', noPairs: '정렬된 구멍 쌍이 없습니다.', apply: '적용', boltLength: '볼트 길이', score: '신뢰도' },
  en: { title: 'Smart Fastener', detect: 'Detect Holes', noPairs: 'No aligned hole pairs found.', apply: 'Apply', boltLength: 'Bolt length', score: 'Score' },
  ja: { title: 'スマート締結具', detect: '穴検出', noPairs: '整列した穴のペアがありません。', apply: '適用', boltLength: 'ボルト長', score: '信頼度' },
  zh: { title: '智能紧固件', detect: '检测孔', noPairs: '未找到对齐的孔对。', apply: '应用', boltLength: '螺栓长度', score: '置信度' },
  es: { title: 'Sujetador Inteligente', detect: 'Detectar Agujeros', noPairs: 'No se encontraron pares de agujeros alineados.', apply: 'Aplicar', boltLength: 'Longitud de perno', score: 'Confianza' },
  ar: { title: 'مثبت ذكي', detect: 'كشف الثقوب', noPairs: 'لم يتم العثور على أزواج ثقوب متراصة.', apply: 'تطبيق', boltLength: 'طول البرغي', score: 'الثقة' },
};

const C = {
  bg: 'var(--nx-panel)',
  border: 'var(--nx-border)',
  text: 'var(--nx-text)',
  muted: 'var(--nx-text-2)',
  accent: 'var(--nx-accent-2)',
  green: 'var(--nx-ok)',
  cellBg: 'var(--nx-bg)',
};

/** Convert a list of `hole`-typed feature instances into HoleEntry[]. */
function holesFromFeatures(
  features: FeatureInstance[],
  partId: string,
  partOffset: [number, number, number] = [0, 0, 0],
): HoleEntry[] {
  const out: HoleEntry[] = [];
  for (const f of features) {
    if (f.type !== 'hole' || !f.enabled) continue;
    const p = f.params;
    // hole.ts uses posX/posZ for 2D placement on the top face; the bore
    // axis is +Y by default. holeType=0 is plain through, 1=counterbore,
    // 2=countersink — for fastener detection we just need centre + diameter.
    const cx = p.posX ?? 0;
    const cy = 0;
    const cz = p.posZ ?? 0;
    out.push({
      partId,
      center: [cx + partOffset[0], cy + partOffset[1], cz + partOffset[2]],
      axis: [0, 1, 0],
      diameter: p.diameter ?? p.holeDiameter ?? 5,
      depth: p.depth,
    });
  }
  return out;
}

export default function SmartFastenerPanel({
  open, rootPartName, features, assemblyBodies, lang, onClose, onApply,
}: SmartFastenerPanelProps) {
  const t = dict[lang] ?? dict.en;
  const [suggestions, setSuggestions] = useState<FastenerSuggestion[]>([]);

  const allHoles: HoleEntry[] = useMemo(() => {
    const list: HoleEntry[] = [];
    list.push(...holesFromFeatures(features, rootPartName));
    if (assemblyBodies) {
      for (const body of assemblyBodies) {
        list.push(...holesFromFeatures(body.features, body.partId, body.position));
      }
    }
    return list;
  }, [features, rootPartName, assemblyBodies]);

  if (!open) return null;

  const handleDetect = () => {
    const s = suggestFasteners(allHoles);
    setSuggestions(s);
  };

  return (
    <div style={{
      position: 'fixed', right: 16, top: 64, width: 'min(540px, calc(100vw - 32px))',
      maxHeight: '80vh', background: C.bg, border: `1px solid ${C.border}`,
      borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 200,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>🔩 {t.title}</span>
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none', color: C.muted,
          fontSize: 16, cursor: 'pointer',
        }}>×</button>
      </div>

      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'auto' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={handleDetect}
            disabled={allHoles.length < 2}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 6, border: 'none',
              background: allHoles.length >= 2 ? C.accent : '#374151',
              color: 'var(--nx-text)', fontSize: 12, fontWeight: 700,
              cursor: allHoles.length >= 2 ? 'pointer' : 'not-allowed',
            }}
          >{t.detect}</button>
          <span style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>
            {allHoles.length} hole(s)
          </span>
        </div>

        {suggestions.length === 0 && (
          <div style={{ padding: 16, fontSize: 12, color: C.muted, textAlign: 'center' }}>
            {t.noPairs}
          </div>
        )}

        {suggestions.map((s, i) => (
          <div
            key={`${s.hostPart}-${s.partnerPart}-${i}`}
            style={{
              padding: 10, borderRadius: 6, border: `1px solid ${C.border}`,
              background: C.cellBg, display: 'flex', flexDirection: 'column', gap: 6,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.accent }}>
                {s.spec.name} — {s.hostPart} ↔ {s.partnerPart}
              </span>
              <span style={{
                fontSize: 10, padding: '2px 6px', borderRadius: 10,
                background: 'rgba(63,185,80,0.18)', color: C.green,
              }}>
                {t.score} {(s.score * 100).toFixed(0)}%
              </span>
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>
              {t.boltLength}: <strong style={{ color: C.text }}>{s.boltLength.toFixed(0)} mm</strong> ·{' '}
              clearance Ø{s.spec.clearance.toFixed(2)} mm
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {s.components.map((c, ci) => (
                <span
                  key={ci}
                  style={{
                    fontSize: 10, padding: '2px 6px', borderRadius: 4,
                    background: C.bg, border: `1px solid ${C.border}`, color: C.text,
                  }}
                >{c.kind}×{c.quantity}</span>
              ))}
            </div>
            <button
              onClick={() => onApply(s, suggestionToBomRows(s))}
              style={{
                marginTop: 4, padding: '5px 10px', borderRadius: 4, border: 'none',
                background: C.green, color: 'var(--nx-text)', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', alignSelf: 'flex-start',
              }}
            >+ {t.apply}</button>
          </div>
        ))}
      </div>
    </div>
  );
}
