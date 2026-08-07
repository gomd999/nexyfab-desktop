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
import { toIsoLang } from '@/lib/i18n/normalize';
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
  ja: {
    title: '見積依頼 (RFQ) パッケージ',
    subtitle: 'サプライヤーへそのまま送れるパッケージを生成',
    qty: '数量', material: '材料仕様', tolerance: '公差等級',
    finish: '表面処理', delivery: '納期', notes: '特記事項',
    budget: '目標単価 (任意)', company: '会社名 (任意)', email: 'メール (任意)',
    revision: '改訂番号', download: 'RFQ パッケージをダウンロード',
    estimatedCost: '概算費用', perPiece: '/個', total: '合計',
    generating: '生成中…', currency: '通貨',
    rough: '粗 (ISO 2768-c)', medium: '中 (ISO 2768-m)',
    fine: '精 (ISO 2768-f)', ultraFine: '超精 (ISO 2768-v)',
    asMachined: '機械加工まま', polished: 'ポリッシュ', anodized: 'アルマイト',
    powderCoated: '粉体塗装', electroplated: '電気めっき', none: 'なし',
    standard: '標準 (4〜8 週)', expedited: '特急 (1〜2 週)', prototype: '試作 (1〜5 日)',
    submitApi: 'ファクトリーネットワークへ直接発注 (API)',
    submitting: '発注中…',
    submitSuccess: '発注を受け付けました。ダッシュボードで状況をご確認ください。',
  },
  zh: {
    title: '询价 (RFQ) 资料包',
    subtitle: '一键生成可直接发给供应商的资料包',
    qty: '数量', material: '材料规格', tolerance: '公差等级',
    finish: '表面处理', delivery: '交期', notes: '特别说明',
    budget: '目标单价（可选）', company: '公司名称（可选）', email: '邮箱（可选）',
    revision: '版本号', download: '下载 RFQ 资料包',
    estimatedCost: '预估费用', perPiece: '/件', total: '合计',
    generating: '生成中…', currency: '币种',
    rough: '粗级 (ISO 2768-c)', medium: '中级 (ISO 2768-m)',
    fine: '精级 (ISO 2768-f)', ultraFine: '超精级 (ISO 2768-v)',
    asMachined: '加工态', polished: '抛光', anodized: '阳极氧化',
    powderCoated: '喷粉', electroplated: '电镀', none: '无',
    standard: '标准（4~8 周）', expedited: '加急（1~2 周）', prototype: '样件（1~5 天）',
    submitApi: '直接下单到工厂网络 (API)',
    submitting: '下单中…',
    submitSuccess: '订单已受理，请在仪表板查看状态。',
  },
  es: {
    title: 'Paquete de solicitud de presupuesto (RFQ)',
    subtitle: 'Genere un paquete listo para enviar al proveedor',
    qty: 'Cantidad', material: 'Especificación de material', tolerance: 'Clase de tolerancia',
    finish: 'Acabado superficial', delivery: 'Plazo de entrega', notes: 'Observaciones',
    budget: 'Precio unitario objetivo (opc.)', company: 'Empresa (opc.)', email: 'Correo (opc.)',
    revision: 'Revisión', download: 'Descargar paquete RFQ',
    estimatedCost: 'Coste estimado', perPiece: '/ud.', total: 'Total',
    generating: 'Generando…', currency: 'Moneda',
    rough: 'Basta (ISO 2768-c)', medium: 'Media (ISO 2768-m)',
    fine: 'Fina (ISO 2768-f)', ultraFine: 'Muy fina (ISO 2768-v)',
    asMachined: 'Tal como se mecaniza', polished: 'Pulido', anodized: 'Anodizado',
    powderCoated: 'Pintura en polvo', electroplated: 'Electrodepositado', none: 'Ninguno',
    standard: 'Estándar (4-8 semanas)', expedited: 'Urgente (1-2 semanas)', prototype: 'Prototipo (1-5 días)',
    submitApi: 'Pedir directamente a la red de fábricas (API)',
    submitting: 'Enviando el pedido…',
    submitSuccess: 'Pedido recibido correctamente. Consulte el estado en el panel.',
  },
  ar: {
    title: 'حزمة طلب عرض سعر (RFQ)',
    subtitle: 'أنشئ حزمة جاهزة للإرسال إلى المورّد',
    qty: 'الكمية', material: 'مواصفات المادة', tolerance: 'درجة التفاوت',
    finish: 'المعالجة السطحية', delivery: 'مدة التسليم', notes: 'ملاحظات خاصة',
    budget: 'سعر الوحدة المستهدف (اختياري)', company: 'اسم الشركة (اختياري)', email: 'البريد الإلكتروني (اختياري)',
    revision: 'رقم المراجعة', download: 'تنزيل حزمة RFQ',
    estimatedCost: 'التكلفة التقديرية', perPiece: '/قطعة', total: 'الإجمالي',
    generating: 'جارٍ الإنشاء…', currency: 'العملة',
    rough: 'خشن (ISO 2768-c)', medium: 'متوسط (ISO 2768-m)',
    fine: 'دقيق (ISO 2768-f)', ultraFine: 'فائق الدقة (ISO 2768-v)',
    asMachined: 'كما بعد التشغيل', polished: 'مصقول', anodized: 'مؤكسد كهربائياً',
    powderCoated: 'طلاء بالمسحوق', electroplated: 'مطلي كهربائياً', none: 'بدون',
    standard: 'قياسي (4–8 أسابيع)', expedited: 'مستعجل (1–2 أسبوع)', prototype: 'نموذج أولي (1–5 أيام)',
    submitApi: 'الطلب مباشرةً عبر شبكة المصانع (API)',
    submitting: 'جارٍ إرسال الطلب…',
    submitSuccess: 'تم استلام طلبك بنجاح. تابع الحالة من لوحة التحكم.',
  },
} as const;

type Lang = keyof typeof dict;

// ─── Styles ───────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: 8,
  border: '1px solid var(--nx-border)', background: 'var(--nx-bg)',
  color: 'var(--nx-text)', fontSize: 12, outline: 'none',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = { ...inputStyle };

const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: 'var(--nx-text-2)',
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
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const lk: Lang = toIsoLang(lang) as Lang;
  const t = dict[lk] ?? dict.en;

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
          interface StoredProject {
            id: string;
            status?: string;
            updatedAt?: number;
          }
          const projects = JSON.parse(saved) as StoredProject[];
          const idx = projects.findIndex((p) => p.id === projectId);
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
    <div data-testid="rfq-panel" style={{
      background: 'var(--nx-bg)', border: '1px solid var(--nx-panel-2)', borderRadius: 14,
      width: 340, fontFamily: 'Inter, system-ui, sans-serif',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--nx-panel-2)',
        background: 'linear-gradient(135deg,rgba(240,160,50,0.08),rgba(56,139,253,0.08))',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>📋</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--nx-text)' }}>{t.title}</div>
          <div style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>{t.subtitle}</div>
        </div>
        {onClose && (
          <button onClick={onClose} style={{
            border: 'none', background: 'var(--nx-panel)', color: 'var(--nx-text-3)',
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
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--nx-warn)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
              {t.estimatedCost}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div>
                <div style={{ fontSize: 9, color: 'var(--nx-text-2)' }}>{t.perPiece}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#e3b341' }}>
                  {opts.currency} {estimate.perPiece.low.toFixed(2)}–{estimate.perPiece.high.toFixed(2)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: 'var(--nx-text-2)' }}>{t.total} (×{opts.quantity})</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#e3b341' }}>
                  {opts.currency} {estimate.low.toFixed(0)}–{estimate.high.toFixed(0)}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 9, color: 'var(--nx-border-strong)', marginTop: 4 }}>
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
              ? 'linear-gradient(135deg,var(--nx-warn),#f0a032)'
              : 'var(--nx-panel-2)',
            color: geometry && !generating ? 'var(--nx-bg)' : 'var(--nx-border-strong)',
            fontWeight: 800, fontSize: 13, cursor: geometry && !generating ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            transition: 'all 0.15s',
          }}
        >
          {generating ? (
            <>
              <span style={{
                width: 14, height: 14, border: '2px solid rgba(0,0,0,0.2)',
                borderTop: '2px solid var(--nx-bg)', borderRadius: '50%',
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
              ? 'var(--nx-ok)'
              : 'var(--nx-panel-2)',
            color: geometry && !submitting ? 'var(--nx-text)' : 'var(--nx-border-strong)',
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
