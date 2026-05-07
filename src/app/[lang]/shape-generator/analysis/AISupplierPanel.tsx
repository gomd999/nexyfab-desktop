'use client';

/**
 * AISupplierPanel.tsx — AI Supplier Matcher UI (Phase 3).
 *
 * Shows AI-picked Top 3 suppliers with reasoning, strengths, concerns, and
 * tailored RFQ talking points. Clicking "Request Quote" submits an order via
 * /api/nexyfab/orders (same endpoint as the full ManufacturerMatch panel).
 */

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { matchSuppliers, type SupplierMatchResult } from './supplierMatcher';
import type { RfqSupplierBrief } from './rfqWriter';

// ─── i18n dict (6 languages) ───────────────────────────────────────────────
const dict = {
  ko: {
    proPlanRequired: 'Pro 플랜이 필요합니다',
    quoteRequested: '견적 요청 완료!',
    aiTop3: 'AI 공급사 Top 3',
    matchedBy: '재질·공정·수량 종합 매칭',
    certFilterTitle: '인증·규제 필터',
    cert: '인증',
    designChangeDetector: '설계 변경 감지',
    diff: '변경',
    certFilterActive: '인증 필터 적용 중',
    clear: '해제',
    process: '공정',
    quantity: '수량',
    useCase: '용도',
    prototype: '프로토타입',
    production: '양산',
    custom: '맞춤형',
    priority: '우선순위',
    cost: '비용',
    speed: '속도',
    quality: '품질',
    aiMatching: 'AI 매칭 중…',
    reMatch: '재분석',
    noMatched: '매칭된 공급사가 없습니다',
    noCertMatched: '인증 필터에 맞는 공급사가 없습니다',
    onTimeRate: '납기 준수율',
    avgResponse: '평균 응답속도',
    qualityRating: '품질 평점',
    communication: '소통 평점',
    reorderRate: '재주문률',
    newPartner: '신규',
    strengths: '강점',
    concerns: '유의사항',
    rfqPoints: 'RFQ 포인트',
    aiDraft: 'AI 작성',
    sending: '전송 중…',
    sentDone: '✅ 완료',
    rfqLabel: 'RFQ',
    pcs: '개',
    rfqSent: 'RFQ 전송 완료!',
  },
  en: {
    proPlanRequired: 'Pro plan required',
    quoteRequested: 'Quote requested!',
    aiTop3: 'AI Top-3 Suppliers',
    matchedBy: 'Matched by material, process, qty',
    certFilterTitle: 'Cert / Reg filter',
    cert: 'Cert',
    designChangeDetector: 'Design change detector',
    diff: 'Diff',
    certFilterActive: 'Cert filter active',
    clear: 'clear',
    process: 'Process',
    quantity: 'Quantity',
    useCase: 'Use Case',
    prototype: 'Prototype',
    production: 'Production',
    custom: 'Custom',
    priority: 'Priority',
    cost: 'Cost',
    speed: 'Speed',
    quality: 'Quality',
    aiMatching: 'AI matching…',
    reMatch: 'Re-match',
    noMatched: 'No matched suppliers',
    noCertMatched: 'No suppliers match the cert filter',
    onTimeRate: 'On-time rate',
    avgResponse: 'Avg response time',
    qualityRating: 'Quality rating',
    communication: 'Communication',
    reorderRate: 'Reorder rate',
    newPartner: 'New',
    strengths: 'Strengths',
    concerns: 'Concerns',
    rfqPoints: 'RFQ Talking Points',
    aiDraft: 'AI Draft',
    sending: 'Sending…',
    sentDone: '✅ Sent',
    rfqLabel: 'RFQ',
    pcs: 'pcs',
    rfqSent: 'RFQ sent!',
  },
  ja: {
    proPlanRequired: 'Proプランが必要です',
    quoteRequested: '見積依頼完了！',
    aiTop3: 'AIサプライヤー Top 3',
    matchedBy: '材料・工程・数量で総合マッチング',
    certFilterTitle: '認証・規制フィルター',
    cert: '認証',
    designChangeDetector: '設計変更検知',
    diff: '変更',
    certFilterActive: '認証フィルター適用中',
    clear: '解除',
    process: '工程',
    quantity: '数量',
    useCase: '用途',
    prototype: 'プロトタイプ',
    production: '量産',
    custom: 'カスタム',
    priority: '優先順位',
    cost: 'コスト',
    speed: '納期',
    quality: '品質',
    aiMatching: 'AIマッチング中…',
    reMatch: '再分析',
    noMatched: 'マッチしたサプライヤーがありません',
    noCertMatched: '認証フィルターに合うサプライヤーがありません',
    onTimeRate: '納期遵守率',
    avgResponse: '平均応答時間',
    qualityRating: '品質評価',
    communication: 'コミュニケーション',
    reorderRate: '再注文率',
    newPartner: '新規',
    strengths: '強み',
    concerns: '留意事項',
    rfqPoints: 'RFQポイント',
    aiDraft: 'AI作成',
    sending: '送信中…',
    sentDone: '✅ 完了',
    rfqLabel: 'RFQ',
    pcs: '個',
    rfqSent: 'RFQ送信完了！',
  },
  zh: {
    proPlanRequired: '需要 Pro 套餐',
    quoteRequested: '报价请求已完成！',
    aiTop3: 'AI 供应商 Top 3',
    matchedBy: '按材料·工艺·数量综合匹配',
    certFilterTitle: '认证·法规筛选',
    cert: '认证',
    designChangeDetector: '设计变更检测',
    diff: '变更',
    certFilterActive: '认证筛选已启用',
    clear: '清除',
    process: '工艺',
    quantity: '数量',
    useCase: '用途',
    prototype: '原型',
    production: '量产',
    custom: '定制',
    priority: '优先级',
    cost: '成本',
    speed: '速度',
    quality: '质量',
    aiMatching: 'AI 匹配中…',
    reMatch: '重新匹配',
    noMatched: '没有匹配的供应商',
    noCertMatched: '没有符合认证筛选的供应商',
    onTimeRate: '准时交付率',
    avgResponse: '平均响应时间',
    qualityRating: '质量评分',
    communication: '沟通评分',
    reorderRate: '再订购率',
    newPartner: '新',
    strengths: '优势',
    concerns: '注意事项',
    rfqPoints: 'RFQ 要点',
    aiDraft: 'AI 起草',
    sending: '发送中…',
    sentDone: '✅ 已发送',
    rfqLabel: 'RFQ',
    pcs: '个',
    rfqSent: 'RFQ 已发送！',
  },
  es: {
    proPlanRequired: 'Se requiere plan Pro',
    quoteRequested: '¡Cotización solicitada!',
    aiTop3: 'Top 3 proveedores IA',
    matchedBy: 'Emparejado por material, proceso, cantidad',
    certFilterTitle: 'Filtro de certificación / regulación',
    cert: 'Cert',
    designChangeDetector: 'Detector de cambios de diseño',
    diff: 'Diff',
    certFilterActive: 'Filtro de certificación activo',
    clear: 'limpiar',
    process: 'Proceso',
    quantity: 'Cantidad',
    useCase: 'Caso de uso',
    prototype: 'Prototipo',
    production: 'Producción',
    custom: 'Personalizado',
    priority: 'Prioridad',
    cost: 'Costo',
    speed: 'Velocidad',
    quality: 'Calidad',
    aiMatching: 'Emparejando IA…',
    reMatch: 'Re-emparejar',
    noMatched: 'Sin proveedores emparejados',
    noCertMatched: 'Ningún proveedor coincide con el filtro de certificación',
    onTimeRate: 'Tasa de puntualidad',
    avgResponse: 'Tiempo medio de respuesta',
    qualityRating: 'Calificación de calidad',
    communication: 'Comunicación',
    reorderRate: 'Tasa de recompra',
    newPartner: 'Nuevo',
    strengths: 'Fortalezas',
    concerns: 'Observaciones',
    rfqPoints: 'Puntos clave RFQ',
    aiDraft: 'Borrador IA',
    sending: 'Enviando…',
    sentDone: '✅ Enviado',
    rfqLabel: 'RFQ',
    pcs: 'uds',
    rfqSent: '¡RFQ enviado!',
  },
  ar: {
    proPlanRequired: 'خطة Pro مطلوبة',
    quoteRequested: 'تم طلب عرض السعر!',
    aiTop3: 'أفضل 3 موردين بالذكاء الاصطناعي',
    matchedBy: 'مطابقة حسب المادة والعملية والكمية',
    certFilterTitle: 'مرشح الشهادات / اللوائح',
    cert: 'شهادة',
    designChangeDetector: 'كاشف تغيير التصميم',
    diff: 'تغيير',
    certFilterActive: 'مرشح الشهادات نشط',
    clear: 'مسح',
    process: 'العملية',
    quantity: 'الكمية',
    useCase: 'حالة الاستخدام',
    prototype: 'نموذج أولي',
    production: 'إنتاج',
    custom: 'مخصص',
    priority: 'الأولوية',
    cost: 'التكلفة',
    speed: 'السرعة',
    quality: 'الجودة',
    aiMatching: 'جاري المطابقة بالذكاء الاصطناعي…',
    reMatch: 'إعادة المطابقة',
    noMatched: 'لا يوجد موردون مطابقون',
    noCertMatched: 'لا يوجد موردون يطابقون مرشح الشهادات',
    onTimeRate: 'معدل الالتزام بالموعد',
    avgResponse: 'متوسط وقت الاستجابة',
    qualityRating: 'تقييم الجودة',
    communication: 'التواصل',
    reorderRate: 'معدل إعادة الطلب',
    newPartner: 'جديد',
    strengths: 'نقاط القوة',
    concerns: 'ملاحظات',
    rfqPoints: 'نقاط RFQ',
    aiDraft: 'مسودة AI',
    sending: 'جاري الإرسال…',
    sentDone: '✅ تم الإرسال',
    rfqLabel: 'RFQ',
    pcs: 'قطعة',
    rfqSent: 'تم إرسال RFQ!',
  },
} as const;

const PROCESS_LABEL: Record<keyof typeof dict, Record<string, string>> = {
  ko: { cnc_milling: 'CNC 밀링', cnc_turning: 'CNC 선반', sheet_metal: '판금 가공', injection_molding: '사출 성형', casting: '주조', '3d_printing': '3D 프린팅' },
  en: { cnc_milling: 'CNC Milling', cnc_turning: 'CNC Turning', sheet_metal: 'Sheet Metal', injection_molding: 'Injection Molding', casting: 'Casting', '3d_printing': '3D Printing' },
  ja: { cnc_milling: 'CNCフライス', cnc_turning: 'CNC旋盤', sheet_metal: '板金加工', injection_molding: '射出成形', casting: '鋳造', '3d_printing': '3Dプリンティング' },
  zh: { cnc_milling: 'CNC 铣削', cnc_turning: 'CNC 车削', sheet_metal: '钣金加工', injection_molding: '注塑成型', casting: '铸造', '3d_printing': '3D 打印' },
  es: { cnc_milling: 'Fresado CNC', cnc_turning: 'Torneado CNC', sheet_metal: 'Chapa metálica', injection_molding: 'Moldeo por inyección', casting: 'Fundición', '3d_printing': 'Impresión 3D' },
  ar: { cnc_milling: 'تفريز CNC', cnc_turning: 'خراطة CNC', sheet_metal: 'صفائح معدنية', injection_molding: 'صب بالحقن', casting: 'سباكة', '3d_printing': 'طباعة ثلاثية الأبعاد' },
};

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

// ─── Multi-dim partner metrics (Phase 7-5b) ────────────────────────────────
// 단일 신용점수로 collapse 하지 않고 납기·품질·응답속도·소통을 차원별로 표시.
interface PartnerMetricSnapshot {
  onTimeRate: number;          // 0..100
  onTimeCount: number;
  lateCount: number;
  avgLeadTimeDays: number | null;
  avgResponseMinutes: number | null;
  responseSamples: number;
  qualityAvg: number | null;         // 0..5
  communicationAvg: number | null;   // 0..5
  deadlineRatingAvg: number | null;  // 0..5
  reviewCount: number;
  reorderRate: number;         // 0..100
}
interface PartnerColdStart {
  isColdStart: boolean;
  badges: string[];
  certifications: string[];
  ageDays: number;
}
type PartnerMetricsByEmail = Record<string, { metrics: PartnerMetricSnapshot; coldStart: PartnerColdStart }>;

const RfqWriterPanel = dynamic(() => import('./RfqWriterPanel'), { ssr: false });
const CertFilterPanel = dynamic(() => import('./CertFilterPanel'), { ssr: false });
const ChangeDetectorPanel = dynamic(() => import('./ChangeDetectorPanel'), { ssr: false });

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  accent: '#388bfd',
  purple: '#a371f7',
  teal: '#39c5bb',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  text: '#c9d1d9',
  dim: '#8b949e',
};

interface AISupplierPanelProps {
  material: string;
  /** Initial process; user can change it in the panel. */
  process?: string;
  lang: string;
  volume_cm3?: number;
  bbox?: { w: number; h: number; d: number };
  partName?: string;
  onClose: () => void;
  onRequirePro?: () => void;
  /** Fire when user triggers an RFQ for the given supplier+quantity (optional hook). */
  onRfqSubmitted?: (mfrName: string, quantity: number, orderId: string) => void;
  /** Optional project link for history filtering. */
  projectId?: string;
}

const PROCESS_VALUES: string[] = [
  'cnc_milling', 'cnc_turning', 'sheet_metal', 'injection_molding', 'casting', '3d_printing',
];

function RankBadge({ rank }: { rank: number }) {
  const color = rank === 1 ? C.green : rank === 2 ? C.accent : C.yellow;
  return (
    <div style={{
      width: 28, height: 28, borderRadius: 14, background: `${color}22`, border: `1px solid ${color}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color, fontSize: 14, fontWeight: 800, flexShrink: 0,
    }}>
      {rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}
    </div>
  );
}

// ─── Multi-dim metric chip (Phase 7-5b) ────────────────────────────────────
// 단일 평점 collapse 금지 — 차원별로 별도 칩.
function MetricChip({ icon, label, value, tone }: {
  icon: string; label: string; value: string; tone: 'green' | 'accent' | 'yellow' | 'dim';
}) {
  const color = tone === 'green' ? C.green
              : tone === 'accent' ? C.accent
              : tone === 'yellow' ? C.yellow
              : C.dim;
  return (
    <div title={label} style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 6px', borderRadius: 10,
      background: `${color}14`, border: `1px solid ${color}33`,
      fontSize: 9, fontWeight: 700, color,
    }}>
      <span>{icon}</span>
      <span>{value}</span>
    </div>
  );
}

function formatResponseTime(minutes: number | null): string | null {
  if (minutes === null || minutes === undefined) return null;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / (60 * 24)).toFixed(1)}d`;
}

export default function AISupplierPanel({
  material, process: initialProcess, lang, volume_cm3, bbox, partName,
  onClose, onRequirePro, onRfqSubmitted, projectId,
}: AISupplierPanelProps) {
  const isKo = lang === 'ko';
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const resolvedLang = langMap[seg] ?? (langMap[lang] ?? 'en');
  const tt = dict[resolvedLang];
  const processLabels = PROCESS_LABEL[resolvedLang];

  const [quantity, setQuantity] = useState(100);
  const [useCase, setUseCase] = useState<'prototype' | 'production' | 'custom'>('production');
  const [priority, setPriority] = useState<'cost' | 'speed' | 'quality'>('cost');
  const [process, setProcess] = useState<string>(initialProcess ?? 'cnc_milling');
  const [rows, setRows] = useState<SupplierMatchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partnerMetrics, setPartnerMetrics] = useState<PartnerMetricsByEmail>({});
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);
  const [rfqSubmittingIdx, setRfqSubmittingIdx] = useState<number | null>(null);
  const [rfqResultByIdx, setRfqResultByIdx] = useState<Record<number, { ok: boolean; message: string }>>({});
  const [rfqWriterFor, setRfqWriterFor] = useState<RfqSupplierBrief | null>(null);
  const [showCertFilter, setShowCertFilter] = useState<boolean>(false);
  const [requiredCerts, setRequiredCerts] = useState<string[]>([]);
  const [showChangeDetector, setShowChangeDetector] = useState<boolean>(false);

  const run = useCallback(async () => {
    if (!material || !process) return;
    setLoading(true);
    setError(null);
    try {
      const results = await matchSuppliers({
        material, process, quantity,
        volume_cm3, bbox,
        useCase, priority,
        lang,
        projectId,
      });
      setRows(results);
      setExpandedIdx(0);

      // 다차원 지표 배치 조회 — 매칭 결과 렌더링을 블로킹하지 않도록 fire-and-forget
      const emails = results
        .map(r => (r.manufacturer as { partnerEmail?: string | null }).partnerEmail)
        .filter((e): e is string => typeof e === 'string' && e.includes('@'));
      if (emails.length > 0) {
        fetch('/api/nexyfab/partner/metrics-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails, windowDays: 90 }),
        })
          .then(r => r.ok ? r.json() : null)
          .then((data: { partners?: Array<{
            partnerEmail: string;
            metrics: PartnerMetricSnapshot;
            coldStart: PartnerColdStart;
          }> } | null) => {
            if (!data?.partners) return;
            const map: PartnerMetricsByEmail = {};
            for (const p of data.partners) {
              map[p.partnerEmail] = { metrics: p.metrics, coldStart: p.coldStart };
            }
            setPartnerMetrics(map);
          })
          .catch(() => { /* 지표 조회 실패는 UI 영향 없음 */ });
      } else {
        setPartnerMetrics({});
      }
    } catch (err) {
      const e = err as Error & { requiresPro?: boolean };
      if (e.requiresPro) {
        onRequirePro?.();
        setError(tt.proPlanRequired);
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }, [material, process, quantity, useCase, priority, volume_cm3, bbox, lang, onRequirePro, projectId, tt]);

  useEffect(() => {
    if (material && process && rows === null && !loading && !error) {
      run();
    }
  }, [material, process, rows, loading, error, run]);

  const handleRequestQuote = useCallback(async (idx: number, row: SupplierMatchResult) => {
    setRfqSubmittingIdx(idx);
    setRfqResultByIdx(prev => { const n = { ...prev }; delete n[idx]; return n; });
    try {
      const res = await fetch('/api/nexyfab/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partName: partName ?? 'Custom Part',
          manufacturerName: isKo ? row.manufacturer.nameKo : row.manufacturer.name,
          quantity,
          estimatedLeadDays: row.manufacturer.minLeadTime,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { order?: { id?: string } };
      const orderId = data.order?.id ?? 'new';
      setRfqResultByIdx(prev => ({ ...prev, [idx]: {
        ok: true,
        message: tt.quoteRequested,
      }}));
      onRfqSubmitted?.(isKo ? row.manufacturer.nameKo : row.manufacturer.name, quantity, orderId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRfqResultByIdx(prev => ({ ...prev, [idx]: { ok: false, message: msg }}));
    } finally {
      setRfqSubmittingIdx(null);
    }
  }, [partName, quantity, isKo, lang, onRfqSubmitted, tt]);

  return (
    <div style={{
      position: 'fixed', top: 48, right: 16, zIndex: 900,
      width: 400, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', borderBottom: `1px solid ${C.border}`,
        background: `linear-gradient(135deg, ${C.teal}11, transparent)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🎯</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>
              {tt.aiTop3}
            </div>
            <div style={{ fontSize: 10, color: C.dim }}>
              {tt.matchedBy}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            onClick={() => setShowCertFilter(true)}
            title={tt.certFilterTitle}
            style={{
              background: requiredCerts.length > 0 ? `${C.purple}22` : 'transparent',
              border: `1px solid ${requiredCerts.length > 0 ? C.purple : C.border}`,
              color: requiredCerts.length > 0 ? C.purple : C.dim,
              fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
            }}>
            🛡 {requiredCerts.length > 0 ? `(${requiredCerts.length})` : tt.cert}
          </button>
          <button
            onClick={() => setShowChangeDetector(true)}
            title={tt.designChangeDetector}
            style={{
              background: 'transparent', border: `1px solid ${C.border}`,
              color: C.dim, fontSize: 11, fontWeight: 700, padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
            }}>
            🔍 {tt.diff}
          </button>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: C.dim, fontSize: 18, cursor: 'pointer', padding: 4,
          }}>✕</button>
        </div>
      </div>

      {requiredCerts.length > 0 && (
        <div style={{
          padding: '6px 16px', borderBottom: `1px solid ${C.border}`,
          background: `${C.purple}0a`, fontSize: 10, color: C.purple, fontWeight: 700,
        }}>
          🛡 {tt.certFilterActive}: {requiredCerts.join(', ')}
          <button onClick={() => setRequiredCerts([])} style={{
            marginLeft: 8, background: 'none', border: 'none',
            color: C.dim, fontSize: 10, cursor: 'pointer',
          }}>✕ {tt.clear}</button>
        </div>
      )}

      {/* Controls */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, color: C.dim, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
            {tt.process}
          </label>
          <select value={process} onChange={e => setProcess(e.target.value)} style={{
            width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.border}`,
            background: C.card, color: C.text, fontSize: 11,
          }}>
            {PROCESS_VALUES.map(v => (
              <option key={v} value={v}>{processLabels[v] ?? v}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 10, fontWeight: 700, color: C.dim, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
            {tt.quantity}
          </label>
          <div style={{ display: 'flex', gap: 4 }}>
            {[1, 10, 100, 1000, 10000].map(q => (
              <button key={q} onClick={() => setQuantity(q)} style={{
                flex: 1, padding: '6px 0', borderRadius: 6,
                border: `1px solid ${quantity === q ? C.teal : C.border}`,
                background: quantity === q ? `${C.teal}22` : 'transparent',
                color: quantity === q ? C.teal : C.dim,
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}>{q.toLocaleString()}</button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: C.dim, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
              {tt.useCase}
            </label>
            <select value={useCase} onChange={e => setUseCase(e.target.value as 'prototype' | 'production' | 'custom')} style={{
              width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.border}`,
              background: C.card, color: C.text, fontSize: 11,
            }}>
              <option value="prototype">{tt.prototype}</option>
              <option value="production">{tt.production}</option>
              <option value="custom">{tt.custom}</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: C.dim, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>
              {tt.priority}
            </label>
            <select value={priority} onChange={e => setPriority(e.target.value as 'cost' | 'speed' | 'quality')} style={{
              width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${C.border}`,
              background: C.card, color: C.text, fontSize: 11,
            }}>
              <option value="cost">{tt.cost}</option>
              <option value="speed">{tt.speed}</option>
              <option value="quality">{tt.quality}</option>
            </select>
          </div>
        </div>

        <button onClick={run} disabled={loading} style={{
          padding: '8px 0', borderRadius: 6, border: 'none',
          background: loading ? C.border : `linear-gradient(135deg, ${C.teal}, ${C.accent})`,
          color: '#fff', fontSize: 12, fontWeight: 800, cursor: loading ? 'wait' : 'pointer',
        }}>
          {loading ? tt.aiMatching : `🎯 ${tt.reMatch}`}
        </button>
      </div>

      {/* Results */}
      <div style={{ padding: '12px 16px' }}>
        {error && (
          <div style={{
            padding: '10px 12px', borderRadius: 6, border: `1px solid ${C.red}44`,
            background: `${C.red}0d`, color: C.red, fontSize: 11, fontWeight: 600,
          }}>
            ⚠️ {error}
          </div>
        )}
        {rows && rows.length === 0 && !loading && (
          <div style={{ color: C.dim, fontSize: 11, textAlign: 'center', padding: 20 }}>
            {tt.noMatched}
          </div>
        )}
        {rows && rows.length > 0 && (() => {
          const filteredRows = requiredCerts.length === 0
            ? rows
            : rows.filter(r => {
                const certs = (r.manufacturer.certifications ?? []).map(c => c.toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
                return requiredCerts.every(req => {
                  const reqNorm = req.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
                  return certs.some(c => c === reqNorm || c.includes(reqNorm.replace(/_/g, '')));
                });
              });
          if (filteredRows.length === 0) {
            return (
              <div style={{ color: C.yellow, fontSize: 11, textAlign: 'center', padding: 16 }}>
                ⚠ {tt.noCertMatched}
              </div>
            );
          }
          return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredRows.map((row, idx) => {
              const { manufacturer: m, ranking } = row;
              const isExpanded = expandedIdx === idx;
              const rfqResult = rfqResultByIdx[idx];
              const email = (m as { partnerEmail?: string | null }).partnerEmail ?? undefined;
              const snap = email ? partnerMetrics[email] : undefined;
              return (
                <div key={m.id} style={{
                  border: `1px solid ${isExpanded ? C.teal : C.border}`,
                  borderRadius: 8, background: C.card, overflow: 'hidden',
                  transition: 'border 0.15s',
                }}>
                  <button onClick={() => setExpandedIdx(isExpanded ? null : idx)} style={{
                    width: '100%', padding: '10px 12px', border: 'none', background: 'transparent',
                    cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
                  }}>
                    <RankBadge rank={ranking.rank} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {isKo ? m.nameKo : m.name}
                      </div>
                      <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>
                        ⭐ {m.rating.toFixed(1)} · {m.minLeadTime}-{m.maxLeadTime}d · {m.region}
                      </div>
                      {/* 다차원 지표 뱃지 — 단일 평점 collapse 금지 (Phase 7-5b) */}
                      {snap && !snap.coldStart.isColdStart && (
                        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {snap.metrics.onTimeCount + snap.metrics.lateCount > 0 && (
                            <MetricChip
                              icon="⏱"
                              label={tt.onTimeRate}
                              value={`${Math.round(snap.metrics.onTimeRate)}%`}
                              tone={snap.metrics.onTimeRate >= 90 ? 'green' : snap.metrics.onTimeRate >= 70 ? 'accent' : 'yellow'}
                            />
                          )}
                          {snap.metrics.avgResponseMinutes !== null && snap.metrics.responseSamples > 0 && (
                            <MetricChip
                              icon="💬"
                              label={tt.avgResponse}
                              value={formatResponseTime(snap.metrics.avgResponseMinutes) ?? ''}
                              tone={snap.metrics.avgResponseMinutes <= 60 ? 'green' : snap.metrics.avgResponseMinutes <= 60 * 8 ? 'accent' : 'yellow'}
                            />
                          )}
                          {snap.metrics.qualityAvg !== null && snap.metrics.reviewCount > 0 && (
                            <MetricChip
                              icon="🔬"
                              label={tt.qualityRating}
                              value={`${snap.metrics.qualityAvg.toFixed(1)}`}
                              tone={snap.metrics.qualityAvg >= 4.5 ? 'green' : snap.metrics.qualityAvg >= 3.5 ? 'accent' : 'yellow'}
                            />
                          )}
                          {snap.metrics.communicationAvg !== null && snap.metrics.reviewCount > 0 && (
                            <MetricChip
                              icon="🤝"
                              label={tt.communication}
                              value={`${snap.metrics.communicationAvg.toFixed(1)}`}
                              tone={snap.metrics.communicationAvg >= 4.5 ? 'green' : snap.metrics.communicationAvg >= 3.5 ? 'accent' : 'yellow'}
                            />
                          )}
                          {snap.metrics.reorderRate > 0 && (
                            <MetricChip
                              icon="🔁"
                              label={tt.reorderRate}
                              value={`${Math.round(snap.metrics.reorderRate)}%`}
                              tone="accent"
                            />
                          )}
                        </div>
                      )}
                      {/* 콜드 스타트 뱃지 — 리뷰 0건인 신규 파트너용 */}
                      {snap?.coldStart.isColdStart && snap.coldStart.badges.length > 0 && (
                        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          <div style={{
                            fontSize: 9, fontWeight: 700, color: C.purple,
                            padding: '2px 6px', borderRadius: 10,
                            background: `${C.purple}14`, border: `1px solid ${C.purple}33`,
                          }}>
                            🌱 {tt.newPartner}
                          </div>
                          {snap.coldStart.badges.map((b, i) => (
                            <div key={i} style={{
                              fontSize: 9, fontWeight: 700, color: C.dim,
                              padding: '2px 6px', borderRadius: 10,
                              background: 'transparent', border: `1px solid ${C.border}`,
                            }}>
                              {b}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ width: 50, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: C.teal }}>{ranking.score}</div>
                      <div style={{ fontSize: 9, color: C.dim }}>/ 100</div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div style={{ padding: '0 12px 12px 12px', borderTop: `1px solid ${C.border}` }}>
                      <div style={{ marginTop: 10, fontSize: 11, color: C.text, lineHeight: 1.5 }}>
                        {isKo ? ranking.reasoningKo : ranking.reasoning}
                      </div>

                      {ranking.strengths.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: C.green, textTransform: 'uppercase', marginBottom: 4 }}>
                            ✓ {tt.strengths}
                          </div>
                          {(isKo ? ranking.strengthsKo : ranking.strengths).map((s, i) => (
                            <div key={i} style={{ fontSize: 10, color: C.text, lineHeight: 1.4, marginBottom: 3 }}>
                              • {s}
                            </div>
                          ))}
                        </div>
                      )}

                      {ranking.concerns.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: C.yellow, textTransform: 'uppercase', marginBottom: 4 }}>
                            ⚠ {tt.concerns}
                          </div>
                          {(isKo ? ranking.concernsKo : ranking.concerns).map((c, i) => (
                            <div key={i} style={{ fontSize: 10, color: C.text, lineHeight: 1.4, marginBottom: 3 }}>
                              • {c}
                            </div>
                          ))}
                        </div>
                      )}

                      {ranking.rfqTalkingPoints.length > 0 && (
                        <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: `${C.accent}0d`, border: `1px solid ${C.accent}33` }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: C.accent, textTransform: 'uppercase', marginBottom: 4 }}>
                            📋 {tt.rfqPoints}
                          </div>
                          {(isKo ? ranking.rfqTalkingPointsKo : ranking.rfqTalkingPoints).map((p, i) => (
                            <div key={i} style={{ fontSize: 10, color: C.text, lineHeight: 1.4, marginBottom: 3 }}>
                              {i + 1}. {p}
                            </div>
                          ))}
                        </div>
                      )}

                      {rfqResult && (
                        <div style={{
                          marginTop: 10, padding: '6px 10px', borderRadius: 6,
                          background: rfqResult.ok ? `${C.green}22` : `${C.red}22`,
                          border: `1px solid ${rfqResult.ok ? C.green : C.red}`,
                          color: rfqResult.ok ? C.green : C.red,
                          fontSize: 11, fontWeight: 700,
                        }}>
                          {rfqResult.ok ? '✅' : '⚠️'} {rfqResult.message}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                        <button
                          onClick={() => setRfqWriterFor({
                            id: m.id,
                            name: m.name,
                            nameKo: m.nameKo,
                            region: m.region,
                            certifications: m.certifications,
                            processes: m.processes,
                            rating: m.rating,
                            minLeadTime: m.minLeadTime,
                            maxLeadTime: m.maxLeadTime,
                          })}
                          style={{
                            flex: 1, padding: '8px 0', borderRadius: 6,
                            border: `1px solid ${C.yellow}66`, background: `${C.yellow}11`,
                            color: C.yellow, fontSize: 11, fontWeight: 800, cursor: 'pointer',
                          }}
                        >
                          ✉️ {tt.aiDraft}
                        </button>
                        <button
                          onClick={() => handleRequestQuote(idx, row)}
                          disabled={rfqSubmittingIdx === idx || rfqResult?.ok}
                          style={{
                            flex: 1, padding: '8px 0', borderRadius: 6, border: 'none',
                            background: rfqResult?.ok ? C.border : `linear-gradient(135deg, ${C.teal}, ${C.accent})`,
                            color: '#fff', fontSize: 11, fontWeight: 800,
                            cursor: rfqSubmittingIdx === idx || rfqResult?.ok ? 'wait' : 'pointer',
                            opacity: rfqResult?.ok ? 0.6 : 1,
                          }}
                        >
                          {rfqSubmittingIdx === idx
                            ? tt.sending
                            : rfqResult?.ok
                              ? tt.sentDone
                              : `📨 ${tt.rfqLabel} (${quantity}${tt.pcs})`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          );
        })()}
      </div>

      {/* AI RFQ Writer overlay */}
      {rfqWriterFor && (
        <RfqWriterPanel
          lang={lang}
          supplier={rfqWriterFor}
          partName={partName}
          material={material}
          process={process}
          quantity={quantity}
          volume_cm3={volume_cm3}
          bbox={bbox}
          projectId={projectId}
          onClose={() => setRfqWriterFor(null)}
          onRequirePro={onRequirePro}
          onSendDraft={async (subject, bodyText) => {
            try {
              const res = await fetch('/api/nexyfab/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  partName: partName ?? 'Custom Part',
                  manufacturerName: rfqWriterFor.nameKo ?? rfqWriterFor.name ?? 'Supplier',
                  quantity,
                  estimatedLeadDays: rfqWriterFor.minLeadTime,
                  rfqSubject: subject,
                  rfqBody: bodyText,
                }),
              });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const data = await res.json() as { order?: { id?: string } };
              const orderId = data.order?.id ?? 'new';
              onRfqSubmitted?.(rfqWriterFor.nameKo ?? rfqWriterFor.name ?? 'Supplier', quantity, orderId);
              return { ok: true, message: tt.rfqSent };
            } catch (e) {
              return { ok: false, message: e instanceof Error ? e.message : String(e) };
            }
          }}
        />
      )}

      {/* AI Cert/Reg Filter overlay */}
      {showCertFilter && (
        <CertFilterPanel
          lang={lang}
          material={material}
          process={process}
          suppliers={(rows ?? []).map(r => ({
            id: r.manufacturer.id,
            name: r.manufacturer.name,
            nameKo: r.manufacturer.nameKo,
            certifications: r.manufacturer.certifications,
          }))}
          projectId={projectId}
          onClose={() => setShowCertFilter(false)}
          onRequirePro={onRequirePro}
          onApplyFilter={(codes) => {
            setRequiredCerts(codes);
            setShowCertFilter(false);
          }}
        />
      )}

      {showChangeDetector && (
        <ChangeDetectorPanel
          currentSpec={{ material, process }}
          lang={lang}
          projectId={projectId}
          onClose={() => setShowChangeDetector(false)}
        />
      )}
    </div>
  );
}
