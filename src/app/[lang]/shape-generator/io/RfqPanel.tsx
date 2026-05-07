'use client';
/**
 * RfqPanel — Request for Quotation floating panel
 *
 * Allows the user to configure an RFQ and download a complete supplier
 * package (STEP + STL + JSON manifest + RFQ form + email draft) as a ZIP.
 *
 * Shows a live cost estimate based on volume + material + tolerance.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type * as THREE from 'three';
import type { RfqOptions, ToleranceClass, SurfaceFinish, DeliveryUrgency } from '../io/rfqPackage';

// ─── i18n ────────────────────────────────────────────────────────────────────

const dict = {
  ko: {
    title: '견적 요청 (RFQ) 패키지',
    subtitle: '공급업체에게 바로 보낼 수 있는 패키지 생성',
    qty: '수량', material: '재료 사양', tolerance: '공차 등급',
    finish: '표면 처리', delivery: '납기', notes: '특이 사항',
    budget: '단가 목표 (선택)', company: '회사명 (선택)', email: '이메일 (선택)',
    revision: '개정 번호', download: 'RFQ 패키지 다운로드',
    estimatedCost: '예상 비용', perPiece: '/개', total: '합계',
    generating: '생성 중…', currency: '통화',
    rough: '거칠게 (ISO 2768-c)', medium: '보통 (ISO 2768-m)',
    fine: '정밀 (ISO 2768-f)', ultraFine: '초정밀 (ISO 2768-v)',
    asMachined: '가공 후 그대로', polished: '폴리싱', anodized: '아노다이징',
    powderCoated: '분체 도장', electroplated: '전기 도금', none: '없음',
    standard: '일반 (4–8주)', expedited: '긴급 (1–2주)', prototype: '시제품 (1–5일)',
    submitApi: '팩토리 네트워크로 바로 발주 (API)',
    submitting: '발주 중…',
    submitSuccess: '발주가 성공적으로 접수되었습니다. 대시보드에서 상태를 확인하세요.',
  },
  en: {
    title: 'Request for Quotation (RFQ)',
    subtitle: 'Generate a supplier-ready package in one click',
    qty: 'Quantity', material: 'Material Spec', tolerance: 'Tolerance Class',
    finish: 'Surface Finish', delivery: 'Delivery', notes: 'Special Notes',
    budget: 'Target Unit Price (opt.)', company: 'Buyer Company (opt.)', email: 'Buyer Email (opt.)',
    revision: 'Revision', download: 'Download RFQ Package',
    estimatedCost: 'Cost Estimate', perPiece: '/pc', total: 'Total',
    generating: 'Generating…', currency: 'Currency',
    rough: 'Rough (ISO 2768-c)', medium: 'Medium (ISO 2768-m)',
    fine: 'Fine (ISO 2768-f)', ultraFine: 'Ultra-fine (ISO 2768-v)',
    asMachined: 'As-machined', polished: 'Polished', anodized: 'Anodized',
    powderCoated: 'Powder coated', electroplated: 'Electroplated', none: 'None',
    standard: 'Standard (4–8 wks)', expedited: 'Expedited (1–2 wks)', prototype: 'Prototype (1–5 days)',
    submitApi: 'Direct Order via Factory Network (API)',
    submitting: 'Submitting…',
    submitSuccess: 'Order successfully submitted. Check dashboard for status.',
  },
} as const;

type Lang = keyof typeof dict;

// ─── Styles ───────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: 8,
  border: '1px solid #30363d', background: '#0d1117',
  color: '#c9d1d9', fontSize: 12, outline: 'none',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = { ...inputStyle };

const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#8b949e',
  textTransform: 'uppercase', letterSpacing: '0.04em',
  display: 'block', marginBottom: 4,
};

const fieldStyle: React.CSSProperties = { marginBottom: 10 };

// ─── Props ────────────────────────────────────────────────────────────────────

interface RfqPanelProps {
  geometry: THREE.BufferGeometry | null;
  partLabel?: string;
  materialKey?: string;
  lang?: string;
  volume_cm3?: number;
  onClose?: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function RfqPanel({
  geometry,
  partLabel = 'NexyFab_Part',
  materialKey,
  lang = 'en',
  volume_cm3 = 0,
  onClose,
}: RfqPanelProps) {
  const lk: Lang = lang === 'ko' || lang === 'kr' ? 'ko' : 'en';
  const t = dict[lk];

  const [opts, setOpts] = useState<RfqOptions>({
    quantity: 10,
    materialSpec: 'Aluminum 6061-T6',
    toleranceClass: 'medium',
    surfaceFinish: 'as-machined',
    deliveryUrgency: 'standard',
    notes: '',
    currency: 'USD',
    buyerCompany: '',
    buyerEmail: '',
    revision: 'A',
  });

  const [estimate, setEstimate] = useState<{ low: number; high: number; perPiece: { low: number; high: number } } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Live cost estimate
  useEffect(() => {
    if (volume_cm3 <= 0) return;
    (async () => {
      try {
        const { estimateRfqCost } = await import('../io/rfqPackage');
        setEstimate(estimateRfqCost(volume_cm3, opts));
      } catch { /* ignore */ }
    })();
  }, [volume_cm3, opts]);

  const set = useCallback(<K extends keyof RfqOptions>(key: K, value: RfqOptions[K]) => {
    setOpts(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleDownload = useCallback(async () => {
    if (!geometry) return;
    setGenerating(true);
    try {
      const { downloadRfqBundle } = await import('../io/rfqPackage');
      await downloadRfqBundle(geometry, partLabel, opts, materialKey);
    } catch (err) {
      console.error('RFQ bundle failed:', err);
    } finally {
      setGenerating(false);
    }
  }, [geometry, partLabel, opts, materialKey]);

  const handleSubmitApi = useCallback(async () => {
    setSubmitting(true);
    // Simulate API delay
    await new Promise(r => setTimeout(r, 1500));
    
    // Update local storage project status to 'ordered'
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const projectId = urlParams.get('id');
      if (projectId) {
        const saved = localStorage.getItem('nexyfab_projects');
        if (saved) {
          const projects = JSON.parse(saved);
          const idx = projects.findIndex((p: any) => p.id === projectId);
          if (idx >= 0) {
            projects[idx].status = 'ordered';
            projects[idx].updatedAt = Date.now();
            localStorage.setItem('nexyfab_projects', JSON.stringify(projects));
          }
        }
      }
      alert(t.submitSuccess);
      if (onClose) onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }, [t, onClose]);

  return (
    <div style={{
      background: '#0d1117', border: '1px solid #21262d', borderRadius: 14,
      width: 340, fontFamily: 'Inter, system-ui, sans-serif',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #21262d',
        background: 'linear-gradient(135deg,rgba(240,160,50,0.08),rgba(56,139,253,0.08))',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>📋</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#c9d1d9' }}>{t.title}</div>
          <div style={{ fontSize: 10, color: '#8b949e' }}>{t.subtitle}</div>
        </div>
        {onClose && (
          <button onClick={onClose} style={{
            border: 'none', background: '#161b22', color: '#6e7681',
            width: 22, height: 22, borderRadius: 6, cursor: 'pointer', fontSize: 11,
          }}>✕</button>
        )}
      </div>

      {/* Form */}
      <div style={{ padding: '14px 16px', overflowY: 'auto', maxHeight: 500 }}>
        {/* Quantity + Revision */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>{t.qty}</label>
            <input type="number" min={1} max={10000} value={opts.quantity}
              onChange={e => set('quantity', parseInt(e.target.value) || 1)}
              style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>{t.revision}</label>
            <input type="text" maxLength={4} value={opts.revision}
              onChange={e => set('revision', e.target.value)}
              style={inputStyle} />
          </div>
        </div>

        {/* Material */}
        <div style={fieldStyle}>
          <label style={labelStyle}>{t.material}</label>
          <input type="text" value={opts.materialSpec}
            onChange={e => set('materialSpec', e.target.value)}
            style={inputStyle} placeholder="e.g. Al 6061-T6, Steel 304, ABS" />
        </div>

        {/* Tolerance */}
        <div style={fieldStyle}>
          <label style={labelStyle}>{t.tolerance}</label>
          <select value={opts.toleranceClass}
            onChange={e => set('toleranceClass', e.target.value as ToleranceClass)}
            style={selectStyle}>
            <option value="rough">{t.rough}</option>
            <option value="medium">{t.medium}</option>
            <option value="fine">{t.fine}</option>
            <option value="ultra-fine">{t.ultraFine}</option>
          </select>
        </div>

        {/* Surface Finish */}
        <div style={fieldStyle}>
          <label style={labelStyle}>{t.finish}</label>
          <select value={opts.surfaceFinish}
            onChange={e => set('surfaceFinish', e.target.value as SurfaceFinish)}
            style={selectStyle}>
            <option value="as-machined">{t.asMachined}</option>
            <option value="polished">{t.polished}</option>
            <option value="anodized">{t.anodized}</option>
            <option value="powder-coated">{t.powderCoated}</option>
            <option value="electroplated">{t.electroplated}</option>
            <option value="none">{t.none}</option>
          </select>
        </div>

        {/* Delivery */}
        <div style={fieldStyle}>
          <label style={labelStyle}>{t.delivery}</label>
          <select value={opts.deliveryUrgency}
            onChange={e => set('deliveryUrgency', e.target.value as DeliveryUrgency)}
            style={selectStyle}>
            <option value="standard">{t.standard}</option>
            <option value="expedited">{t.expedited}</option>
            <option value="prototype">{t.prototype}</option>
          </select>
        </div>

        {/* Optional fields */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>{t.company}</label>
            <input type="text" value={opts.buyerCompany}
              onChange={e => set('buyerCompany', e.target.value)}
              style={inputStyle} placeholder="Acme Corp" />
          </div>
          <div>
            <label style={labelStyle}>{t.currency}</label>
            <select value={opts.currency ?? 'USD'} onChange={e => set('currency', e.target.value)} style={selectStyle}>
              {['USD', 'EUR', 'GBP', 'JPY', 'KRW', 'CNY'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>{t.email}</label>
          <input type="email" value={opts.buyerEmail}
            onChange={e => set('buyerEmail', e.target.value)}
            style={inputStyle} placeholder="buyer@company.com" />
        </div>

        {/* Notes */}
        <div style={fieldStyle}>
          <label style={labelStyle}>{t.notes}</label>
          <textarea value={opts.notes} rows={3}
            onChange={e => set('notes', e.target.value)}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            placeholder="Special requirements, finish colour, etc." />
        </div>

        {/* Cost estimate */}
        {estimate && volume_cm3 > 0 && (
          <div style={{
            background: 'rgba(240,160,50,0.08)', border: '1px solid rgba(240,160,50,0.2)',
            borderRadius: 8, padding: '10px 12px', marginBottom: 12,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#d29922', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
              {t.estimatedCost}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div>
                <div style={{ fontSize: 9, color: '#8b949e' }}>{t.perPiece}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#e3b341' }}>
                  {opts.currency} {estimate.perPiece.low.toFixed(2)}–{estimate.perPiece.high.toFixed(2)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: '#8b949e' }}>{t.total} (×{opts.quantity})</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#e3b341' }}>
                  {opts.currency} {estimate.low.toFixed(0)}–{estimate.high.toFixed(0)}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 9, color: '#484f58', marginTop: 4 }}>
              Rough estimate only — actual quotes may differ significantly.
            </div>
          </div>
        )}

        {/* Download button */}
        <button
          onClick={handleDownload}
          disabled={!geometry || generating}
          style={{
            width: '100%', padding: '11px 0', borderRadius: 10, border: 'none',
            background: geometry && !generating
              ? 'linear-gradient(135deg,#d29922,#f0a032)'
              : '#21262d',
            color: geometry && !generating ? '#0d1117' : '#484f58',
            fontWeight: 800, fontSize: 13, cursor: geometry && !generating ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            transition: 'all 0.15s',
          }}
        >
          {generating ? (
            <>
              <span style={{
                width: 14, height: 14, border: '2px solid rgba(0,0,0,0.2)',
                borderTop: '2px solid #0d1117', borderRadius: '50%',
                animation: 'rfqSpin 0.8s linear infinite', display: 'inline-block',
              }} />
              <style>{`@keyframes rfqSpin{to{transform:rotate(360deg)}}`}</style>
              {t.generating}
            </>
          ) : (
            <>📦 {t.download}</>
          )}
        </button>

        {/* Submit to API button */}
        <button
          onClick={handleSubmitApi}
          disabled={!geometry || submitting}
          style={{
            width: '100%', padding: '11px 0', borderRadius: 10, border: '1px solid #238636',
            background: geometry && !submitting
              ? '#238636'
              : '#21262d',
            color: geometry && !submitting ? '#ffffff' : '#484f58',
            fontWeight: 800, fontSize: 13, cursor: geometry && !submitting ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            transition: 'all 0.15s',
            marginTop: 8,
          }}
        >
          {submitting ? (
            <>
              <span style={{
                width: 14, height: 14, border: '2px solid rgba(255,255,255,0.2)',
                borderTop: '2px solid #ffffff', borderRadius: '50%',
                animation: 'rfqSpin 0.8s linear infinite', display: 'inline-block',
              }} />
              {t.submitting}
            </>
          ) : (
            <>🚀 {t.submitApi}</>
          )}
        </button>
      </div>
    </div>
  );
}
