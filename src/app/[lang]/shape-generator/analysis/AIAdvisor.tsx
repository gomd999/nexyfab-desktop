'use client';

import { useState } from 'react';
import type { ShapeResult } from '../shapes';
import type { DFMResult } from './dfmAnalysis';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIAdvisorProps {
  result: ShapeResult;
  dfmResults?: DFMResult[] | null;
  materialId?: string;
  lang?: string;
  onTextToCAD?: (shapeId: string, params: Record<string, number>) => void;
}

// ─── Text-to-CAD NL parser ────────────────────────────────────────────────────

type ParsedShape = { shapeId: string; params: Record<string, number>; confidence: 'high' | 'medium' | 'low' };

function parseNLToCAD(text: string): ParsedShape | null {
  const t = text.toLowerCase().trim();
  if (!t) return null;

  // Extract first number that follows a unit or dimension keyword
  const numOf = (patterns: RegExp[]): number | undefined => {
    for (const p of patterns) {
      const m = t.match(p);
      if (m) return parseFloat(m[1]);
    }
    return undefined;
  };

  // Extract all bare numbers (for "100x50x30" style)
  const allNums = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(?:mm|cm|m)?/g)].map(m => parseFloat(m[1])).filter(n => n > 0 && n < 10000);

  // Detect shape
  let shapeId: string | null = null;
  if (/cylinder|원기둥|실린더|원통/.test(t)) shapeId = 'cylinder';
  else if (/sphere|ball|구체|구형|공/.test(t)) shapeId = 'sphere';
  else if (/cone|원뿔|코너|코니/.test(t)) shapeId = 'cone';
  else if (/torus|ring|donut|토러스|링|도넛/.test(t)) shapeId = 'torus';
  else if (/pipe|tube|파이프|튜브/.test(t)) shapeId = 'pipe';
  else if (/box|cube|cuboid|block|상자|박스|육면체|블록|직육면체/.test(t)) shapeId = 'box';
  else if (allNums.length >= 2) shapeId = 'box'; // fallback to box if dimensions found

  if (!shapeId) return null;

  const params: Record<string, number> = {};

  if (shapeId === 'box') {
    // Try "WxHxD" pattern first
    const xyzMatch = t.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/);
    if (xyzMatch) {
      params.width  = parseFloat(xyzMatch[1]);
      params.height = parseFloat(xyzMatch[2]);
      params.depth  = parseFloat(xyzMatch[3]);
    } else {
      params.width  = numOf([/width[^\d]*(\d+(?:\.\d+)?)/,/wide[^\d]*(\d+(?:\.\d+)?)/,/(?:가로|너비)[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[0] ?? 100;
      params.height = numOf([/height[^\d]*(\d+(?:\.\d+)?)/,/tall[^\d]*(\d+(?:\.\d+)?)/,/(?:높이|세로)[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[1] ?? allNums[0] ?? 50;
      params.depth  = numOf([/depth[^\d]*(\d+(?:\.\d+)?)/,/deep[^\d]*(\d+(?:\.\d+)?)/,/(?:깊이|두께)[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[2] ?? allNums[0] ?? 50;
    }
  } else if (shapeId === 'cylinder') {
    const diam = numOf([/diameter[^\d]*(\d+(?:\.\d+)?)/,/지름[^\d]*(\d+(?:\.\d+)?)/,/직경[^\d]*(\d+(?:\.\d+)?)/]);
    const rad  = numOf([/radius[^\d]*(\d+(?:\.\d+)?)/,/반지름[^\d]*(\d+(?:\.\d+)?)/,/반경[^\d]*(\d+(?:\.\d+)?)/]);
    params.radius = diam ? diam / 2 : rad ?? allNums[0] ?? 30;
    params.height = numOf([/height[^\d]*(\d+(?:\.\d+)?)/,/tall[^\d]*(\d+(?:\.\d+)?)/,/(?:높이|길이)[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[1] ?? allNums[0] ?? 80;
  } else if (shapeId === 'sphere') {
    const diam = numOf([/diameter[^\d]*(\d+(?:\.\d+)?)/,/지름[^\d]*(\d+(?:\.\d+)?)/]);
    const rad  = numOf([/radius[^\d]*(\d+(?:\.\d+)?)/,/반지름[^\d]*(\d+(?:\.\d+)?)/]);
    params.radius = diam ? diam / 2 : rad ?? allNums[0] ?? 40;
  } else if (shapeId === 'cone') {
    params.radius = numOf([/radius[^\d]*(\d+(?:\.\d+)?)/,/반지름[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[0] ?? 30;
    params.height = numOf([/height[^\d]*(\d+(?:\.\d+)?)/,/높이[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[1] ?? allNums[0] ?? 60;
  } else if (shapeId === 'torus') {
    params.radius      = numOf([/radius[^\d]*(\d+(?:\.\d+)?)/,/반지름[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[0] ?? 50;
    params.tubeRadius  = numOf([/tube[^\d]*(\d+(?:\.\d+)?)/,/관[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[1] ?? 15;
  } else if (shapeId === 'pipe') {
    params.outerRadius = numOf([/outer[^\d]*(\d+(?:\.\d+)?)/,/외경[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[0] ?? 30;
    params.innerRadius = numOf([/inner[^\d]*(\d+(?:\.\d+)?)/,/내경[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[1] ?? 20;
    params.height      = numOf([/height[^\d]*(\d+(?:\.\d+)?)/,/길이[^\d]*(\d+(?:\.\d+)?)/]) ?? allNums[2] ?? allNums[0] ?? 100;
  }

  const confidence: ParsedShape['confidence'] =
    Object.keys(params).length >= 2 && allNums.length > 0 ? 'high'
    : Object.keys(params).length >= 1 ? 'medium'
    : 'low';

  return { shapeId, params, confidence };
}

export interface AdvisorSuggestion {
  id: string;
  category: 'cost' | 'weight' | 'process' | 'optimize';
  icon: string;
  headlineKo: string;
  headlineEn: string;
  impactLabel: string;  // e.g. "-12% 비용"
  type: string;         // opaque key passed to parent onClick
}

// ─── Heuristic suggestion generator ──────────────────────────────────────────

export function generateAdvisorSuggestions(
  result: ShapeResult,
  dfmResults: DFMResult[] | null | undefined,
  material: string | undefined,
  lang: string | undefined,
): AdvisorSuggestion[] {
  const suggestions: AdvisorSuggestion[] = [];

  // 1. Wall thickness issue → fillet reduction tip
  const hasThinWall = dfmResults?.some(r =>
    r.issues.some(i => i.type === 'thin_wall')
  );
  if (hasThinWall) {
    suggestions.push({
      id: 'fillet-reduce',
      category: 'cost',
      icon: '💰',
      headlineKo: '필렛 반경을 2mm로 줄이면 CNC 공정비 약 12% 절감 예상',
      headlineEn: 'Reducing fillet radius to 2mm could cut CNC machining cost ~12%',
      impactLabel: '-12% 비용',
      type: 'reduce-fillet',
    });
  }

  // 2. Score < 70 → suggest PLA / 3D printing
  const lowestScore = dfmResults?.reduce<number>((min, r) => Math.min(min, r.score), 100) ?? 100;
  if (lowestScore < 70) {
    suggestions.push({
      id: 'material-pla',
      category: 'process',
      icon: '🔧',
      headlineKo: '재질을 PLA로 변경하면 3D 프린팅 적합성 점수가 85점으로 개선됩니다',
      headlineEn: 'Switching to PLA improves 3D printing feasibility score to 85',
      impactLabel: '+15pt 점수',
      type: 'switch-material-pla',
    });
  }

  // 3. Volume > 500 cm³ → topology optimization
  if (result.volume_cm3 > 500) {
    suggestions.push({
      id: 'topology-opt',
      category: 'weight',
      icon: '⚖️',
      headlineKo: '위상 최적화를 통해 최대 40% 경량화 가능합니다',
      headlineEn: 'Topology optimization can reduce mass by up to 40%',
      impactLabel: '-40% 무게',
      type: 'topology-optimize',
    });
  }

  // 4. Bbox ratio > 5:1 → splitting suggestion
  const { w, h, d } = result.bbox;
  const dims = [w, h, d].sort((a, b) => b - a);
  const bboxRatio = dims[0] / Math.max(dims[2], 0.01);
  if (bboxRatio > 5) {
    suggestions.push({
      id: 'split-assembly',
      category: 'cost',
      icon: '💰',
      headlineKo: '긴 돌출부는 CNC 척킹 비용을 증가시킵니다. 분할 조립을 고려하세요',
      headlineEn: `Long protrusion ratio ${bboxRatio.toFixed(1)}:1 increases CNC chucking cost. Consider split assembly`,
      impactLabel: '-20% 비용',
      type: 'split-assembly',
    });
  }

  // 5. Always: cheapest alternative process suggestion
  const cheapestProcess = (() => {
    if (!dfmResults || dfmResults.length === 0) {
      return { ko: '3D 프린팅(FDM)으로 전환하면 초기 제작비를 최대 60% 절감할 수 있습니다', en: 'Switching to FDM 3D printing can cut initial production cost by up to 60%', impact: '-60% 비용' };
    }
    const best = dfmResults.reduce((a, b) => a.score > b.score ? a : b);
    const labels: Record<string, { ko: string; en: string; impact: string }> = {
      cnc_milling: { ko: 'CNC 밀링이 현재 형상에 가장 적합합니다. 배치 생산으로 단가 절감 가능', en: 'CNC milling best suits this geometry. Batch production lowers unit cost', impact: '-25% 단가' },
      cnc_turning: { ko: 'CNC 선삭으로 전환하면 회전 대칭 파트 단가를 낮출 수 있습니다', en: 'CNC turning reduces unit cost for rotationally symmetric parts', impact: '-30% 단가' },
      injection_molding: { ko: '사출 성형 금형 투자 시 대량 생산 단가가 최저화됩니다', en: 'Injection molding tooling investment minimizes high-volume unit cost', impact: '대량 최적' },
      sheet_metal: { ko: '판금 절곡 공정으로 재료 낭비 없이 제작 가능합니다', en: 'Sheet metal bending allows near-zero material waste fabrication', impact: '-35% 재료비' },
      casting: { ko: '주조 공정으로 복잡한 내부 구조도 일체 제작 가능합니다', en: 'Casting produces complex internal geometries in a single pour', impact: '복잡도 ↑' },
    };
    return labels[best.process] ?? { ko: '3D 프린팅(FDM)으로 전환하면 초기 제작비를 최대 60% 절감할 수 있습니다', en: 'Switching to FDM 3D printing can cut initial production cost by up to 60%', impact: '-60% 비용' };
  })();

  suggestions.push({
    id: 'cheapest-alt',
    category: 'optimize',
    icon: '⚡',
    headlineKo: cheapestProcess.ko,
    headlineEn: cheapestProcess.en,
    impactLabel: cheapestProcess.impact,
    type: 'cheapest-alternative',
  });

  // 6. Aspect ratio wall thickness — plate-like geometry
  if (w / d > 8 || h / d > 8) {
    suggestions.push({
      id: 'rib-stiffness',
      category: 'optimize',
      icon: '🏗️',
      headlineKo: '얇은 판 형상 감지 — 리브 추가로 굽힘 강성 3-5배 향상 가능',
      headlineEn: 'Thin plate detected — adding ribs can improve bending stiffness 3-5×',
      impactLabel: '+300% 강성',
      type: 'add-ribs',
    });
  }

  // 7. Surface area to volume ratio > 15 → suggest SLA/SLS
  const sav = result.surface_area_cm2 / result.volume_cm3;
  if (sav > 15) {
    suggestions.push({
      id: 'sla-sls-complex',
      category: 'cost',
      icon: '💰',
      headlineKo: '형상 복잡도가 높습니다. SLA/SLS 3D 프린팅이 CNC 대비 비용 효율적입니다',
      headlineEn: 'High geometric complexity — SLA/SLS 3D printing is more cost-efficient than CNC',
      impactLabel: '-45% 비용',
      type: 'switch-sla-sls',
    });
  }

  // 8. Symmetry detection — near-square cross section and tall → CNC turning
  const squareness = Math.abs(w - d) / Math.max(w, d);
  if (squareness < 0.05 && h > w * 1.5) {
    suggestions.push({
      id: 'cnc-turning-sym',
      category: 'process',
      icon: '🔄',
      headlineKo: '회전 대칭 형상 감지 — CNC 선삭으로 전환하면 가공 시간 50% 단축',
      headlineEn: 'Rotationally symmetric geometry — switching to CNC turning reduces cycle time by 50%',
      impactLabel: '-50% 가공시간',
      type: 'switch-cnc-turning',
    });
  }

  // 9. Oversize warning — any bbox dimension > 300 mm
  const maxDim = Math.max(w, h, d);
  if (maxDim > 300) {
    suggestions.push({
      id: 'oversize-split',
      category: 'cost',
      icon: '📐',
      headlineKo: `큰 부품 감지 (${Math.round(maxDim)}mm) — 분할 제작 후 접합을 검토하세요`,
      headlineEn: `Large part detected (${Math.round(maxDim)}mm) — consider splitting and joining`,
      impactLabel: '-30% 비용',
      type: 'split-large-part',
    });
  }

  // 10. Shell detection — low volume, high surface area → sheet metal / thermoforming
  if (result.volume_cm3 < 5 && result.surface_area_cm2 > 50) {
    suggestions.push({
      id: 'sheet-metal-shell',
      category: 'process',
      icon: '🔩',
      headlineKo: '쉘 형상 감지 — 판금 성형이 적합합니다',
      headlineEn: 'Shell geometry detected — sheet metal forming is a great fit',
      impactLabel: '-50% 재료비',
      type: 'switch-sheet-metal',
    });
  }

  // 11. Material + process mismatch — titanium + complex CNC → DMLS
  if (material === 'titanium' && dfmResults?.some(r => r.process === 'cnc_milling' && r.score > 60)) {
    suggestions.push({
      id: 'dmls-titanium',
      category: 'cost',
      icon: '⚡',
      headlineKo: '티타늄 소재: DMLS 금속 3D 프린팅이 복잡 형상에서 CNC 대비 40% 저렴할 수 있습니다',
      headlineEn: 'Titanium: DMLS metal 3D printing can be 40% cheaper than CNC for complex shapes',
      impactLabel: '-40% 비용',
      type: 'switch-dmls',
    });
  }

  return suggestions.slice(0, 8);
}

// ─── Category colours ─────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<AdvisorSuggestion['category'], string> = {
  cost: '#f0883e',
  weight: '#3fb950',
  process: '#79c0ff',
  optimize: '#a371f7',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AIAdvisor({
  result,
  dfmResults,
  materialId,
  lang,
  onApply,
  onTextToCAD,
}: AIAdvisorProps & { onApply?: (type: string) => void }) {
  const isKo = lang === 'ko';
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [nlText, setNlText] = useState('');
  const [parsed, setParsed] = useState<ReturnType<typeof parseNLToCAD>>(null);
  const [nlApplied, setNlApplied] = useState(false);

  const suggestions = generateAdvisorSuggestions(result, dfmResults, materialId, lang);

  function handleApply(suggestion: AdvisorSuggestion) {
    setApplied(prev => new Set(prev).add(suggestion.id));
    onApply?.(suggestion.type);
  }

  function handleNLChange(text: string) {
    setNlText(text);
    setNlApplied(false);
    setParsed(text.trim().length > 5 ? parseNLToCAD(text) : null);
  }

  function handleNLApply() {
    if (!parsed || !onTextToCAD) return;
    onTextToCAD(parsed.shapeId, parsed.params);
    setNlApplied(true);
  }

  const SHAPE_LABELS: Record<string, { ko: string; en: string }> = {
    box: { ko: '직육면체', en: 'Box' },
    cylinder: { ko: '원기둥', en: 'Cylinder' },
    sphere: { ko: '구', en: 'Sphere' },
    cone: { ko: '원뿔', en: 'Cone' },
    torus: { ko: '토러스', en: 'Torus' },
    pipe: { ko: '파이프', en: 'Pipe' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ── Text-to-CAD section ── */}
      <div style={{
        background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
        padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 14 }}>✏️</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#e6edf3' }}>
            {isKo ? '텍스트 → 형상 변환' : 'Text to Shape'}
          </span>
          <span style={{ fontSize: 10, color: '#6e7681' }}>
            {isKo ? '(예: 100×50×30mm 박스)' : '(e.g. 100×50×30mm box)'}
          </span>
        </div>
        <textarea
          value={nlText}
          onChange={e => handleNLChange(e.target.value)}
          placeholder={isKo
            ? '자연어로 형상을 설명하세요. 예) 반지름 40mm 높이 100mm 원기둥'
            : 'Describe shape in plain text. e.g. cylinder radius 40mm height 100mm'}
          rows={2}
          style={{
            width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
            color: '#c9d1d9', fontSize: 11, padding: '6px 8px', resize: 'none',
            outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
        {parsed && (
          <div style={{ background: '#0d1117', borderRadius: 6, padding: '8px 10px', fontSize: 11 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                background: parsed.confidence === 'high' ? '#3fb95022' : parsed.confidence === 'medium' ? '#f0883e22' : '#6e767122',
                color: parsed.confidence === 'high' ? '#3fb950' : parsed.confidence === 'medium' ? '#f0883e' : '#6e7681',
              }}>
                {parsed.confidence === 'high' ? (isKo ? '높은 확신' : 'High confidence') :
                 parsed.confidence === 'medium' ? (isKo ? '보통 확신' : 'Medium confidence') :
                 (isKo ? '낮은 확신' : 'Low confidence')}
              </span>
              <span style={{ color: '#58a6ff', fontWeight: 700 }}>
                {isKo ? SHAPE_LABELS[parsed.shapeId]?.ko : SHAPE_LABELS[parsed.shapeId]?.en || parsed.shapeId}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
              {Object.entries(parsed.params).map(([k, v]) => (
                <span key={k} style={{ color: '#8b949e' }}>
                  <span style={{ color: '#79c0ff' }}>{k}</span>: {v}mm
                </span>
              ))}
            </div>
          </div>
        )}
        {parsed && (
          <button
            onClick={handleNLApply}
            disabled={nlApplied || !onTextToCAD}
            style={{
              alignSelf: 'flex-end', padding: '5px 14px', borderRadius: 6,
              border: `1px solid ${nlApplied ? '#30363d' : '#388bfd'}`,
              background: nlApplied ? '#21262d' : '#388bfd18',
              color: nlApplied ? '#6e7681' : '#58a6ff',
              fontSize: 11, fontWeight: 700, cursor: nlApplied ? 'default' : 'pointer',
            }}
          >
            {nlApplied ? (isKo ? '적용됨 ✓' : 'Applied ✓') : (isKo ? '형상 생성' : 'Generate')}
          </button>
        )}
        {!parsed && nlText.trim().length > 5 && (
          <div style={{ fontSize: 10, color: '#8b949e' }}>
            {isKo ? '형상 유형을 인식하지 못했습니다. 예: 박스, 원기둥, 구체, 파이프' : 'Shape type not recognized. Try: box, cylinder, sphere, pipe'}
          </div>
        )}
      </div>

      {suggestions.length === 0 ? (
        <div style={{
          background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
          padding: '16px 20px', color: '#8b949e', fontSize: 13, textAlign: 'center',
        }}>
          {isKo ? 'AI 제안 사항이 없습니다. 설계가 최적화되어 있습니다!' : 'No AI suggestions — your design looks well optimized!'}
        </div>
      ) : (
        <>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 16 }}>🤖</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>
              {isKo ? 'AI 제조 어드바이저' : 'AI Manufacturing Advisor'}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px',
              borderRadius: 10, background: '#a371f718', color: '#a371f7',
            }}>
              {suggestions.length} {isKo ? '가지 제안' : 'suggestions'}
            </span>
          </div>

          {suggestions.map(s => {
            const isApplied = applied.has(s.id);
            const color = CATEGORY_COLORS[s.category];
            return (
              <div
                key={s.id}
                style={{
                  background: '#161b22',
                  border: `1px solid ${isApplied ? color + '55' : '#30363d'}`,
                  borderRadius: 10,
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  transition: 'border-color 0.2s',
                }}
              >
                {/* Icon */}
                <div style={{
                  width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                  background: color + '18',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18,
                }}>
                  {s.icon}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    margin: '0 0 6px', fontSize: 12, color: '#e6edf3', lineHeight: 1.5,
                    wordBreak: 'keep-all',
                  }}>
                    {isKo ? s.headlineKo : s.headlineEn}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px',
                      borderRadius: 6, background: color + '22', color,
                    }}>
                      {s.impactLabel}
                    </span>
                    <span style={{ fontSize: 10, color: '#6e7681', textTransform: 'uppercase' }}>
                      {s.category}
                    </span>
                  </div>
                </div>

                {/* Apply button */}
                <button
                  onClick={() => handleApply(s)}
                  disabled={isApplied}
                  style={{
                    flexShrink: 0,
                    padding: '5px 12px',
                    borderRadius: 6,
                    border: `1px solid ${isApplied ? '#30363d' : color}`,
                    background: isApplied ? '#21262d' : color + '18',
                    color: isApplied ? '#6e7681' : color,
                    fontSize: 11, fontWeight: 700, cursor: isApplied ? 'default' : 'pointer',
                    transition: 'background 0.15s, color 0.15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isApplied
                    ? (isKo ? '적용됨' : 'Applied')
                    : (isKo ? '적용' : 'Apply')}
                </button>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
