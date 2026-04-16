'use client';

import { useState } from 'react';

interface QuoteWizardProps {
  lang: string;
  onClose: () => void;
  onGetQuote: (opts: { category: string; materialId: string; w: number; h: number; d: number; qty: number }) => void;
  initialMaterialId?: string;
  /** 견적 요청 완료 후 제조사 매칭 패널을 열 콜백 */
  onMatchManufacturer?: () => void;
}

const CATEGORIES = [
  { id: 'cnc',      label: 'CNC 가공',    icon: '🔧', desc: '정밀 금속/플라스틱 절삭' },
  { id: 'sheet',    label: '판금',         icon: '📄', desc: '절곡·레이저 절단·용접' },
  { id: 'print3d',  label: '3D 프린팅',   icon: '🖨️', desc: '시제품·복잡 형상 제작' },
  { id: 'inject',   label: '사출 성형',   icon: '💧', desc: '플라스틱 대량 생산' },
  { id: 'casting',  label: '주조',         icon: '🏭', desc: '금속 복잡 형상 양산' },
  { id: 'other',    label: '기타',         icon: '📦', desc: '용도에 맞는 공정 추천' },
];

const MATERIALS: { id: string; label: string; group: string }[] = [
  { id: 'aluminum',       label: '알루미늄 (Al)',       group: '금속' },
  { id: 'steel',          label: '철강 (Steel)',         group: '금속' },
  { id: 'stainless_steel',label: '스테인리스 (SUS)',     group: '금속' },
  { id: 'titanium',       label: '티타늄 (Ti)',          group: '금속' },
  { id: 'copper',         label: '구리 (Cu)',             group: '금속' },
  { id: 'brass',          label: '황동 (Brass)',          group: '금속' },
  { id: 'abs',            label: 'ABS 수지',             group: '플라스틱' },
  { id: 'pla',            label: 'PLA',                  group: '플라스틱' },
  { id: 'nylon',          label: '나일론 (PA)',           group: '플라스틱' },
  { id: 'pc',             label: '폴리카보네이트 (PC)',  group: '플라스틱' },
];

const MATERIAL_GROUPS = ['금속', '플라스틱'];

export default function QuoteWizard({ lang, onClose, onGetQuote, initialMaterialId = 'aluminum', onMatchManufacturer }: QuoteWizardProps) {
  const [step, setStep] = useState(1);
  const [category, setCategory] = useState('');
  const [materialId, setMaterialId] = useState(initialMaterialId);
  const [w, setW] = useState(50);
  const [h, setH] = useState(30);
  const [d, setD] = useState(20);
  const [qty, setQty] = useState(1);

  const isKo = lang === 'ko';

  const stepLabel = (n: number) => {
    if (isKo) return ['공정 선택', '기본 치수', '견적 요청'][n - 1];
    return ['Process', 'Dimensions', 'Request'][n - 1];
  };

  const handleSubmit = () => {
    onGetQuote({ category, materialId, w, h, d, qty });
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#161b22', border: '1px solid #30363d', borderRadius: 16,
        width: 520, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        fontFamily: 'system-ui, sans-serif',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid #30363d',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ color: '#f0f6fc', fontWeight: 700, fontSize: 18 }}>
              {isKo ? '🚀 빠른 견적 요청' : '🚀 Quick Quote'}
            </div>
            <div style={{ color: '#8b949e', fontSize: 13, marginTop: 2 }}>
              {isKo ? '3단계로 빠르게 제조 견적을 받으세요' : 'Get a manufacturing quote in 3 steps'}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: 20, cursor: 'pointer', padding: 4 }}
          >×</button>
        </div>

        {/* Step indicator */}
        <div style={{ padding: '16px 24px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
          {[1, 2, 3].map((n) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: n < 3 ? 1 : 'none' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: step > n ? '#238636' : step === n ? '#1f6feb' : '#21262d',
                border: `2px solid ${step > n ? '#238636' : step === n ? '#388bfd' : '#30363d'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: step >= n ? '#fff' : '#8b949e', fontSize: 12, fontWeight: 700,
                flexShrink: 0, transition: 'all 0.2s',
              }}>
                {step > n ? '✓' : n}
              </div>
              <span style={{ color: step === n ? '#f0f6fc' : '#8b949e', fontSize: 12, fontWeight: step === n ? 600 : 400, whiteSpace: 'nowrap' }}>
                {stepLabel(n)}
              </span>
              {n < 3 && <div style={{ flex: 1, height: 1, background: step > n ? '#238636' : '#30363d', transition: 'background 0.2s' }} />}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div style={{ padding: '20px 24px 24px' }}>

          {/* ── STEP 1: Category ── */}
          {step === 1 && (
            <div>
              <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 16 }}>
                {isKo ? '어떤 제조 공정이 필요하세요?' : 'Which manufacturing process do you need?'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    style={{
                      background: category === c.id ? 'rgba(31,111,235,0.15)' : '#21262d',
                      border: `2px solid ${category === c.id ? '#388bfd' : '#30363d'}`,
                      borderRadius: 10, padding: '14px 12px', cursor: 'pointer',
                      textAlign: 'left', transition: 'all 0.15s',
                    }}
                  >
                    <div style={{ fontSize: 22, marginBottom: 4 }}>{c.icon}</div>
                    <div style={{ color: '#f0f6fc', fontWeight: 600, fontSize: 14 }}>{c.label}</div>
                    <div style={{ color: '#8b949e', fontSize: 11, marginTop: 2 }}>{c.desc}</div>
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => category && setStep(2)}
                  disabled={!category}
                  style={{
                    background: category ? '#1f6feb' : '#21262d',
                    border: 'none', borderRadius: 8, padding: '10px 24px',
                    color: category ? '#fff' : '#8b949e', fontWeight: 600, fontSize: 14,
                    cursor: category ? 'pointer' : 'not-allowed', transition: 'all 0.15s',
                  }}
                >
                  {isKo ? '다음 →' : 'Next →'}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Dimensions ── */}
          {step === 2 && (
            <div>
              <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 20 }}>
                {isKo ? '부품의 기본 치수와 소재를 입력하세요.' : 'Enter basic dimensions and material.'}
              </div>

              {/* Material picker */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ color: '#8b949e', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>
                  {isKo ? '소재' : 'Material'}
                </label>
                {MATERIAL_GROUPS.map(group => (
                  <div key={group} style={{ marginBottom: 10 }}>
                    <div style={{ color: '#6e7681', fontSize: 11, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{group}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {MATERIALS.filter(m => m.group === group).map(m => (
                        <button
                          key={m.id}
                          onClick={() => setMaterialId(m.id)}
                          style={{
                            background: materialId === m.id ? 'rgba(31,111,235,0.2)' : '#21262d',
                            border: `1px solid ${materialId === m.id ? '#388bfd' : '#30363d'}`,
                            borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
                            color: materialId === m.id ? '#79c0ff' : '#c9d1d9', fontSize: 12,
                            transition: 'all 0.15s',
                          }}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Dimension sliders */}
              {([
                { key: 'w' as const, label: isKo ? '너비 (W)' : 'Width (W)', val: w, set: setW },
                { key: 'h' as const, label: isKo ? '높이 (H)' : 'Height (H)', val: h, set: setH },
                { key: 'd' as const, label: isKo ? '깊이 (D)' : 'Depth (D)', val: d, set: setD },
              ]).map(({ label, val, set }) => (
                <div key={label} style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label style={{ color: '#8b949e', fontSize: 12, fontWeight: 600 }}>{label}</label>
                    <span style={{ color: '#f0f6fc', fontSize: 13, fontWeight: 700 }}>{val} mm</span>
                  </div>
                  <input
                    type="range" min={1} max={500} value={val}
                    onChange={e => set(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#388bfd' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6e7681', fontSize: 10 }}>
                    <span>1mm</span><span>500mm</span>
                  </div>
                </div>
              ))}

              {/* Quantity */}
              <div style={{ marginBottom: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ color: '#8b949e', fontSize: 12, fontWeight: 600 }}>{isKo ? '수량' : 'Quantity'}</label>
                  <span style={{ color: '#f0f6fc', fontSize: 13, fontWeight: 700 }}>{qty} {isKo ? '개' : 'pcs'}</span>
                </div>
                <input
                  type="range" min={1} max={10000} value={qty}
                  onChange={e => setQty(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#388bfd' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6e7681', fontSize: 10 }}>
                  <span>1</span><span>10,000</span>
                </div>
              </div>

              <div style={{ marginTop: 24, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setStep(1)}
                  style={{
                    background: '#21262d', border: '1px solid #30363d', borderRadius: 8,
                    padding: '10px 20px', color: '#c9d1d9', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  }}
                >← {isKo ? '이전' : 'Back'}</button>
                <button
                  onClick={() => setStep(3)}
                  style={{
                    background: '#1f6feb', border: 'none', borderRadius: 8,
                    padding: '10px 24px', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  }}
                >{isKo ? '다음 →' : 'Next →'}</button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Summary & submit ── */}
          {step === 3 && (
            <div>
              <div style={{ color: '#8b949e', fontSize: 13, marginBottom: 20 }}>
                {isKo ? '입력 정보를 확인하고 견적을 요청하세요.' : 'Review your information and request a quote.'}
              </div>

              {/* Summary card */}
              <div style={{
                background: '#0d1117', border: '1px solid #30363d', borderRadius: 10,
                padding: '16px 20px', marginBottom: 20,
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
                  {[
                    { label: isKo ? '공정' : 'Process', value: CATEGORIES.find(c => c.id === category)?.label ?? category },
                    { label: isKo ? '소재' : 'Material', value: MATERIALS.find(m => m.id === materialId)?.label ?? materialId },
                    { label: isKo ? '너비' : 'Width', value: `${w} mm` },
                    { label: isKo ? '높이' : 'Height', value: `${h} mm` },
                    { label: isKo ? '깊이' : 'Depth', value: `${d} mm` },
                    { label: isKo ? '수량' : 'Qty', value: `${qty.toLocaleString()} ${isKo ? '개' : 'pcs'}` },
                    {
                      label: isKo ? '예상 부피' : 'Est. Volume',
                      value: `${((w * h * d) / 1000).toFixed(1)} cm³`,
                    },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div style={{ color: '#6e7681', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                      <div style={{ color: '#f0f6fc', fontSize: 14, fontWeight: 600, marginTop: 2 }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Note */}
              <div style={{
                background: 'rgba(56,139,253,0.1)', border: '1px solid rgba(56,139,253,0.3)',
                borderRadius: 8, padding: '10px 14px', marginBottom: 20,
                color: '#79c0ff', fontSize: 12, lineHeight: 1.5,
              }}>
                {isKo
                  ? '💡 견적 요청 후 대시보드에서 진행 상황을 확인할 수 있습니다. 파트너사가 영업일 기준 1-2일 내로 연락드립니다.'
                  : '💡 After requesting a quote, track progress in your dashboard. Partners will contact you within 1-2 business days.'}
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setStep(2)}
                  style={{
                    background: '#21262d', border: '1px solid #30363d', borderRadius: 8,
                    padding: '10px 20px', color: '#c9d1d9', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  }}
                >← {isKo ? '이전' : 'Back'}</button>
                <button
                  onClick={handleSubmit}
                  style={{
                    background: 'linear-gradient(135deg, #21262d, #30363d)',
                    border: '1px solid #30363d', borderRadius: 8, padding: '10px 20px',
                    color: '#c9d1d9', fontWeight: 600, fontSize: 14, cursor: 'pointer',
                  }}
                >
                  {isKo ? '견적만 요청' : 'Quote only'}
                </button>
                <button
                  onClick={() => {
                    handleSubmit();
                    if (onMatchManufacturer) {
                      setTimeout(onMatchManufacturer, 300);
                    }
                  }}
                  style={{
                    background: 'linear-gradient(135deg, #238636, #2ea043)',
                    border: 'none', borderRadius: 8, padding: '10px 28px',
                    color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer',
                    boxShadow: '0 4px 16px rgba(46,160,67,0.4)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  🚀 {isKo ? '견적 + 제조사 매칭' : 'Quote + Match Factory'}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
