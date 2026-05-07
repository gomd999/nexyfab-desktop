'use client';
/**
 * 단면 물성 패널 (Section Properties Panel)
 * I빔, 파이프, 박스, L브래킷, T-슬롯 등 구조 단면의 주요 물성 계산:
 *  - Ix, Iy: 단면 2차 모멘트 (mm⁴)
 *  - Sx, Sy: 단면 계수 (mm³)
 *  - rx, ry: 회전 반경 (mm)
 *  - 단면적 (mm²)
 *  - 도심 위치 (yc)
 */
import React, { useMemo } from 'react';
import { usePathname } from 'next/navigation';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SectionProps {
  A: number;   // 단면적 (mm²)
  Ix: number;  // 도심축 2차 모멘트 (mm⁴)
  Iy: number;
  yc: number;  // 도심 y 위치 (중립축 ~ 상단까지, mm)
  xc: number;
}

// ─── Calculators per shape type ──────────────────────────────────────────────

function calcBox(p: Record<string, number>): SectionProps {
  const W = p.width ?? p.w ?? 50;
  const H = p.height ?? p.h ?? 50;
  return {
    A:  W * H,
    Ix: (W * H ** 3) / 12,
    Iy: (H * W ** 3) / 12,
    yc: H / 2,
    xc: W / 2,
  };
}

function calcCylinder(p: Record<string, number>): SectionProps {
  const R = (p.radius ?? p.topRadius ?? p.bottomRadius ?? 25);
  const r4 = Math.PI * R ** 4 / 4;
  return {
    A:  Math.PI * R ** 2,
    Ix: r4,
    Iy: r4,
    yc: R,
    xc: R,
  };
}

function calcPipe(p: Record<string, number>): SectionProps {
  const Ro = (p.outerDia ?? 50) / 2;
  const Ri = (p.innerDia ?? (p.outerDia ?? 50) - 2 * (p.wallThick ?? 3)) / 2;
  const I = Math.PI * (Ro ** 4 - Ri ** 4) / 4;
  return {
    A:  Math.PI * (Ro ** 2 - Ri ** 2),
    Ix: I,
    Iy: I,
    yc: Ro,
    xc: Ro,
  };
}

function calcIBeam(p: Record<string, number>): SectionProps {
  const H  = p.height ?? 200;
  const BF = p.flangeWidth ?? 100;
  const tw = p.webThick ?? 8;
  const tf = p.flangeThick ?? 12;
  const hw = H - 2 * tf; // clear web height

  // Two flanges + web
  const Af  = BF * tf;
  const Aw  = tw * hw;
  const A   = 2 * Af + Aw;

  // Ix: sum of each rectangle's contribution (parallel axis theorem)
  // Web:
  const Ix_web = (tw * hw ** 3) / 12;
  // Flanges (distance from centroid):
  const d = hw / 2 + tf / 2;
  const Ix_fl  = (BF * tf ** 3) / 12 + Af * d ** 2;
  const Ix = Ix_web + 2 * Ix_fl;

  // Iy:
  const Iy_web = (hw * tw ** 3) / 12;
  const Iy_fl  = (tf * BF ** 3) / 12;
  const Iy = Iy_web + 2 * Iy_fl;

  return { A, Ix, Iy, yc: H / 2, xc: BF / 2 };
}

function calcTSlot(p: Record<string, number>): SectionProps {
  const S  = p.profileSize ?? 40;
  const tw = p.wallThick ?? 3;
  // Outer square - inner square (ignoring T-slots for simplicity)
  const A = S ** 2 - (S - 2 * tw) ** 2;
  const Io = (S ** 4) / 12;
  const Ii = ((S - 2 * tw) ** 4) / 12;
  const I  = Io - Ii;
  return { A, Ix: I, Iy: I, yc: S / 2, xc: S / 2 };
}

function calcLBracket(p: Record<string, number>): SectionProps {
  const W  = p.width ?? 80;
  const H  = p.height ?? 60;
  const t  = p.thickness ?? 5;
  // Horizontal + vertical members, T-shape cross-section approach
  const A  = W * t + (H - t) * t;
  // Centroid yc from bottom:
  const y1 = t / 2;        // horiz member centroid from bottom
  const y2 = t + (H - t) / 2; // vert member centroid from bottom
  const A1 = W * t;
  const A2 = (H - t) * t;
  const yc = (A1 * y1 + A2 * y2) / A;
  // Ix parallel axis
  const Ix1 = (W * t ** 3) / 12 + A1 * (yc - y1) ** 2;
  const Ix2 = (t * (H - t) ** 3) / 12 + A2 * (yc - y2) ** 2;
  // Iy (about x = 0)
  const Iy = (t * W ** 3) / 12 + ((H - t) * t ** 3) / 12;
  return { A, Ix: Ix1 + Ix2, Iy, yc, xc: W / 2 };
}

// ─── Shape → Calculator map ──────────────────────────────────────────────────

const CALCULATORS: Record<string, (p: Record<string, number>) => SectionProps> = {
  box:       calcBox,
  cylinder:  calcCylinder,
  pipe:      calcPipe,
  iBeam:     calcIBeam,
  tSlot:     calcTSlot,
  lBracket:  calcLBracket,
};

const SUPPORTED = new Set(Object.keys(CALCULATORS));

// ─── i18n ────────────────────────────────────────────────────────────────────

const dict = {
  ko: {
    title: '단면 물성',
    area: '단면적',
    Ix: '단면 2차 모멘트 Ix',
    Iy: '단면 2차 모멘트 Iy',
    Sx: '단면 계수 Sx',
    Sy: '단면 계수 Sy',
    rx: '회전 반경 rx',
    ry: '회전 반경 ry',
    yc: '도심 (y)',
    noSupport: '이 shape은 단면 물성을 지원하지 않습니다',
  },
  en: {
    title: 'Section Properties',
    area: 'Cross-section Area',
    Ix: 'Moment of Inertia Ix',
    Iy: 'Moment of Inertia Iy',
    Sx: 'Section Modulus Sx',
    Sy: 'Section Modulus Sy',
    rx: 'Radius of Gyration rx',
    ry: 'Radius of Gyration ry',
    yc: 'Centroid (y)',
    noSupport: 'Section properties not available for this shape',
  },
  ja: {
    title: '断面特性',
    area: '断面積',
    Ix: '断面二次モーメント Ix',
    Iy: '断面二次モーメント Iy',
    Sx: '断面係数 Sx',
    Sy: '断面係数 Sy',
    rx: '回転半径 rx',
    ry: '回転半径 ry',
    yc: '図心 (y)',
    noSupport: 'この形状は断面特性に対応していません',
  },
  zh: {
    title: '截面特性',
    area: '截面积',
    Ix: '截面二阶矩 Ix',
    Iy: '截面二阶矩 Iy',
    Sx: '截面系数 Sx',
    Sy: '截面系数 Sy',
    rx: '回转半径 rx',
    ry: '回转半径 ry',
    yc: '形心 (y)',
    noSupport: '此形状不支持截面特性',
  },
  es: {
    title: 'Propiedades de Sección',
    area: 'Área de Sección',
    Ix: 'Momento de Inercia Ix',
    Iy: 'Momento de Inercia Iy',
    Sx: 'Módulo de Sección Sx',
    Sy: 'Módulo de Sección Sy',
    rx: 'Radio de Giro rx',
    ry: 'Radio de Giro ry',
    yc: 'Centroide (y)',
    noSupport: 'Propiedades de sección no disponibles para esta forma',
  },
  ar: {
    title: 'خصائص المقطع',
    area: 'مساحة المقطع',
    Ix: 'عزم القصور الذاتي Ix',
    Iy: 'عزم القصور الذاتي Iy',
    Sx: 'معامل المقطع Sx',
    Sy: 'معامل المقطع Sy',
    rx: 'نصف قطر الدوران rx',
    ry: 'نصف قطر الدوران ry',
    yc: 'المركز الهندسي (y)',
    noSupport: 'خصائص المقطع غير متاحة لهذا الشكل',
  },
};
const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

// ─── Number formatter ────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' ×10⁹';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' ×10⁶';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + ' ×10³';
  return n.toFixed(2);
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  shapeId: string;
  params: Record<string, number>;
  isKo: boolean;
}

export default function SectionPropertiesPanel({ shapeId, params, isKo }: Props) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? (isKo ? 'ko' : 'en');
  const t = dict[langMap[seg] ?? (isKo ? 'ko' : 'en')];

  const sp = useMemo<SectionProps | null>(() => {
    const calc = CALCULATORS[shapeId];
    if (!calc) return null;
    try { return calc(params); } catch { return null; }
  }, [shapeId, params]);

  if (!SUPPORTED.has(shapeId)) {
    return <div style={{ fontSize: 10, color: '#484f58', textAlign: 'center', padding: '6px 0' }}>{t.noSupport}</div>;
  }

  if (!sp) return null;

  const Sx = sp.Ix / sp.yc;
  const Sy = sp.Iy / sp.xc;
  const rx = Math.sqrt(sp.Ix / sp.A);
  const ry = Math.sqrt(sp.Iy / sp.A);

  const rows: { label: string; value: string; unit: string }[] = [
    { label: t.area,  value: fmt(sp.A),  unit: 'mm²' },
    { label: t.yc,    value: fmt(sp.yc), unit: 'mm'  },
    { label: t.Ix,    value: fmt(sp.Ix), unit: 'mm⁴' },
    { label: t.Iy,    value: fmt(sp.Iy), unit: 'mm⁴' },
    { label: t.Sx,    value: fmt(Sx),    unit: 'mm³' },
    { label: t.Sy,    value: fmt(Sy),    unit: 'mm³' },
    { label: t.rx,    value: fmt(rx),    unit: 'mm'  },
    { label: t.ry,    value: fmt(ry),    unit: 'mm'  },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
        {t.title}
      </div>
      {rows.map(row => (
        <div key={row.label} style={{
          display: 'grid', gridTemplateColumns: '1fr auto auto',
          alignItems: 'baseline', gap: 4,
          padding: '2px 0', borderBottom: '1px solid #21262d',
        }}>
          <span style={{ fontSize: 10, color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#e6edf3', fontFamily: 'monospace', textAlign: 'right' }}>{row.value}</span>
          <span style={{ fontSize: 9, color: '#484f58', minWidth: 32, textAlign: 'right' }}>{row.unit}</span>
        </div>
      ))}
    </div>
  );
}
