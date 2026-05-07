'use client';

import { useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  HOLE_STANDARD_SERIES,
  holeParamsFromStandard,
  type HoleStandardSeries,
  type HoleStandardSpec,
  type HoleKind,
} from './holeStandards';

interface Props {
  open: boolean;
  lang: 'ko' | 'en' | string;
  onClose: () => void;
  onApply: (params: {
    holeType: number;
    diameter: number;
    counterboreDia: number;
    counterboreDepth: number;
    countersinkAngle: number;
    posX: number;
    posZ: number;
    depth: number;
  }) => void;
}

const dict = {
  ko: {
    title: 'Hole 마법사 (표준 규격)',
    standardSeries: '규격 시리즈',
    isoMetric: 'ISO 미터법',
    ansiImperial: 'ANSI 인치법',
    size: '크기',
    holeType: 'Hole 유형',
    kindThrough: '관통 (Clearance)',
    kindTap: 'Tap (Threaded)',
    kindCounterbore: 'Counterbore',
    kindCountersink: 'Countersink',
    depth: '깊이',
    throughAllNote: '깊이 999 = 관통 (bounding box 전체)',
    resolved: '적용될 치수',
    holeDia: 'Hole 지름',
    cboreDia: 'Counterbore Ø',
    cboreDepth: 'Counterbore 깊이',
    cskAngle: 'Countersink 각도',
    tapWarn: 'Tap 드릴 지름이며, 실제 Thread는 별도 나사산 피처로 추가해야 합니다.',
    cancel: '취소',
    addHole: 'Hole 추가',
  },
  en: {
    title: 'Hole Wizard (Standard Specs)',
    standardSeries: 'Standard Series',
    isoMetric: 'ISO Metric',
    ansiImperial: 'ANSI Imperial',
    size: 'Size',
    holeType: 'Hole Type',
    kindThrough: 'Through (Clearance)',
    kindTap: 'Tap (Threaded)',
    kindCounterbore: 'Counterbore',
    kindCountersink: 'Countersink',
    depth: 'Depth',
    throughAllNote: 'Depth 999 = through-all (full bounding box)',
    resolved: 'Resolved Dimensions',
    holeDia: 'Hole diameter',
    cboreDia: 'Counterbore Ø',
    cboreDepth: 'Counterbore depth',
    cskAngle: 'Countersink angle',
    tapWarn: 'This is the Tap-drill diameter — add Threads via the thread feature separately.',
    cancel: 'Cancel',
    addHole: 'Add Hole',
  },
  ja: {
    title: 'Hole ウィザード (標準規格)',
    standardSeries: '規格シリーズ',
    isoMetric: 'ISO メートル法',
    ansiImperial: 'ANSI インチ法',
    size: 'サイズ',
    holeType: 'Hole 種類',
    kindThrough: '貫通 (Clearance)',
    kindTap: 'Tap (Threaded)',
    kindCounterbore: 'Counterbore',
    kindCountersink: 'Countersink',
    depth: '深さ',
    throughAllNote: '深さ 999 = 貫通 (bounding box 全体)',
    resolved: '適用される寸法',
    holeDia: 'Hole 直径',
    cboreDia: 'Counterbore Ø',
    cboreDepth: 'Counterbore 深さ',
    cskAngle: 'Countersink 角度',
    tapWarn: 'Tap ドリル直径です。実際の Thread は別途ねじ山フィーチャで追加してください。',
    cancel: 'キャンセル',
    addHole: 'Hole を追加',
  },
  zh: {
    title: 'Hole 向导 (标准规格)',
    standardSeries: '规格系列',
    isoMetric: 'ISO 公制',
    ansiImperial: 'ANSI 英制',
    size: '尺寸',
    holeType: 'Hole 类型',
    kindThrough: '通孔 (Clearance)',
    kindTap: 'Tap (Threaded)',
    kindCounterbore: 'Counterbore',
    kindCountersink: 'Countersink',
    depth: '深度',
    throughAllNote: '深度 999 = 通孔 (完整 bounding box)',
    resolved: '应用的尺寸',
    holeDia: 'Hole 直径',
    cboreDia: 'Counterbore Ø',
    cboreDepth: 'Counterbore 深度',
    cskAngle: 'Countersink 角度',
    tapWarn: '这是 Tap 钻头直径 — 请通过螺纹特征单独添加 Thread。',
    cancel: '取消',
    addHole: '添加 Hole',
  },
  es: {
    title: 'Asistente de Hole (Especificaciones Estándar)',
    standardSeries: 'Serie Estándar',
    isoMetric: 'ISO Métrico',
    ansiImperial: 'ANSI Imperial',
    size: 'Tamaño',
    holeType: 'Tipo de Hole',
    kindThrough: 'Pasante (Clearance)',
    kindTap: 'Tap (Threaded)',
    kindCounterbore: 'Counterbore',
    kindCountersink: 'Countersink',
    depth: 'Profundidad',
    throughAllNote: 'Profundidad 999 = pasante total (bounding box completo)',
    resolved: 'Dimensiones Resueltas',
    holeDia: 'Diámetro del Hole',
    cboreDia: 'Counterbore Ø',
    cboreDepth: 'Profundidad de Counterbore',
    cskAngle: 'Ángulo de Countersink',
    tapWarn: 'Este es el diámetro de broca para Tap — añada Threads mediante la característica de rosca por separado.',
    cancel: 'Cancelar',
    addHole: 'Añadir Hole',
  },
  ar: {
    title: 'معالج Hole (المواصفات القياسية)',
    standardSeries: 'السلسلة القياسية',
    isoMetric: 'ISO متري',
    ansiImperial: 'ANSI إمبراطوري',
    size: 'الحجم',
    holeType: 'نوع Hole',
    kindThrough: 'نافذ (Clearance)',
    kindTap: 'Tap (Threaded)',
    kindCounterbore: 'Counterbore',
    kindCountersink: 'Countersink',
    depth: 'العمق',
    throughAllNote: 'العمق 999 = نافذ كامل (bounding box كامل)',
    resolved: 'الأبعاد المطبقة',
    holeDia: 'قطر Hole',
    cboreDia: 'Counterbore Ø',
    cboreDepth: 'عمق Counterbore',
    cskAngle: 'زاوية Countersink',
    tapWarn: 'هذا هو قطر مثقاب Tap — أضف Threads عبر ميزة اللولب بشكل منفصل.',
    cancel: 'إلغاء',
    addHole: 'إضافة Hole',
  },
};

export default function HoleWizardModal({ open, lang, onClose, onApply }: Props) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

  const [series, setSeries] = useState<HoleStandardSeries>('ISO');
  const [specIndex, setSpecIndex] = useState(3); // M6 default
  const [kind, setKind] = useState<HoleKind>('through');
  const [posX, setPosX] = useState(0);
  const [posZ, setPosZ] = useState(0);
  const [depth, setDepth] = useState(999);

  const specs = HOLE_STANDARD_SERIES[series];
  const spec: HoleStandardSpec | undefined = specs[Math.min(specIndex, specs.length - 1)];

  const preview = useMemo(() => {
    if (!spec) return null;
    return holeParamsFromStandard(spec, kind);
  }, [spec, kind]);

  if (!open) return null;

  const handleApply = () => {
    if (!preview) return;
    onApply({ ...preview, posX, posZ, depth });
    onClose();
  };

  const kindLabels: Record<HoleKind, string> = {
    through: t.kindThrough,
    tap: t.kindTap,
    counterbore: t.kindCounterbore,
    countersink: t.kindCountersink,
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#1f2937', color: '#f3f4f6', borderRadius: 10,
          padding: 20, width: 520, maxHeight: '85vh', overflowY: 'auto',
          border: '1px solid #374151',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
            🕳️ {t.title}
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#9ca3af', fontSize: 20, cursor: 'pointer' }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Series picker */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>
            {t.standardSeries}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['ISO', 'ANSI'] as HoleStandardSeries[]).map(s => (
              <button
                key={s}
                onClick={() => { setSeries(s); setSpecIndex(0); }}
                style={{
                  flex: 1, padding: '8px 10px',
                  background: series === s ? '#2563eb' : '#374151',
                  color: '#f3f4f6', border: 'none', borderRadius: 6,
                  cursor: 'pointer', fontSize: 13, fontWeight: 500,
                }}
              >
                {s === 'ISO' ? t.isoMetric : t.ansiImperial}
              </button>
            ))}
          </div>
        </div>

        {/* Size picker */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>
            {t.size}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
            {specs.map((s, i) => (
              <button
                key={s.name}
                onClick={() => setSpecIndex(i)}
                style={{
                  padding: '6px 4px',
                  background: i === specIndex ? '#059669' : '#374151',
                  color: '#f3f4f6', border: 'none', borderRadius: 4,
                  cursor: 'pointer', fontSize: 12, fontWeight: 500,
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>

        {/* Kind picker */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>
            {t.holeType}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
            {(['through', 'tap', 'counterbore', 'countersink'] as HoleKind[]).map(k => (
              <button
                key={k}
                onClick={() => setKind(k)}
                style={{
                  padding: '8px 6px',
                  background: kind === k ? '#7c3aed' : '#374151',
                  color: '#f3f4f6', border: 'none', borderRadius: 4,
                  cursor: 'pointer', fontSize: 12, fontWeight: 500,
                }}
              >
                {kindLabels[k]}
              </button>
            ))}
          </div>
        </div>

        {/* Position + depth */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#9ca3af' }}>
            X (mm)
            <input
              type="number" value={posX} onChange={e => setPosX(Number(e.target.value))} step={1}
              style={{ width: '100%', padding: '6px 8px', background: '#111827', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 4, marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: 12, color: '#9ca3af' }}>
            Z (mm)
            <input
              type="number" value={posZ} onChange={e => setPosZ(Number(e.target.value))} step={1}
              style={{ width: '100%', padding: '6px 8px', background: '#111827', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 4, marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: 12, color: '#9ca3af' }}>
            {t.depth} (mm)
            <input
              type="number" value={depth} onChange={e => setDepth(Number(e.target.value))} step={1} min={1}
              style={{ width: '100%', padding: '6px 8px', background: '#111827', color: '#f3f4f6', border: '1px solid #374151', borderRadius: 4, marginTop: 4 }}
            />
          </label>
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: -6, marginBottom: 10 }}>
          {t.throughAllNote}
        </div>

        {/* Preview */}
        {spec && preview && (
          <div style={{
            background: '#111827', border: '1px solid #374151', borderRadius: 6,
            padding: 10, fontSize: 12, fontFamily: 'monospace', color: '#d1d5db',
            marginBottom: 14,
          }}>
            <div style={{ color: '#9ca3af', marginBottom: 6, fontFamily: 'inherit', fontSize: 11 }}>
              {t.resolved}
            </div>
            <div>{t.holeDia}: <b>{preview.diameter.toFixed(2)} mm</b></div>
            {preview.holeType === 1 && (
              <>
                <div>{t.cboreDia}: <b>{preview.counterboreDia.toFixed(2)} mm</b></div>
                <div>{t.cboreDepth}: <b>{preview.counterboreDepth.toFixed(2)} mm</b></div>
              </>
            )}
            {preview.holeType === 2 && (
              <div>{t.cskAngle}: <b>{preview.countersinkAngle}°</b></div>
            )}
            {kind === 'tap' && (
              <div style={{ color: '#fbbf24', marginTop: 4 }}>
                ⚠ {t.tapWarn}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{ padding: '8px 14px', background: '#374151', color: '#f3f4f6', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
          >
            {t.cancel}
          </button>
          <button
            onClick={handleApply}
            style={{ padding: '8px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
          >
            {t.addHole}
          </button>
        </div>
      </div>
    </div>
  );
}
