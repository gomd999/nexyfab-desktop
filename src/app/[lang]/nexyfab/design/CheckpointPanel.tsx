'use client';

/**
 * CheckpointPanel — 입구 B 도면 체크포인트 (방법론 §2.1, 2026-07-16).
 *
 * 자유 서술(AI 해석) 경로에서 3D를 뷰어에 올리기 전, 드래프트 지오메트리의
 * 실루엣 뷰 + 치수선(AABB) + intent 스펙을 보여주고 사람이 승인해야 적용한다.
 * §12.3 뷰 라우팅 v1: 형상 클래스(회전체/각주형/조립체)를 intent에서 판정해
 * 뷰 구성을 라우팅한다 — 회전체=정면·평면 2뷰(측면=정면과 동일), 그 외=3각법 3뷰.
 * (반단면·중심선 그래프·판금 전개도 라우팅은 후속 — 정직 표기)
 * 실루엣·치수는 클라이언트 결정론(삼각형 정투영·AABB) — AI 개입 없음.
 */

import { useEffect, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { designLoc } from './designI18n';

export interface CheckpointData {
  intent: { name?: string; features?: unknown[] };
  scad: string;
  verify: { manifold?: boolean; triangles?: number; nonManifoldEdges?: number; error?: string } | null;
  positions: Float32Array; // STL 삼각형 정점(드래프트)
  bbox: { x: number; y: number; z: number }; // 전체 외형(mm)
}

// §12.3 형상 클래스 판정 v1 — intent add 피처 구성으로 결정(결정론)
function shapeClass(features?: unknown[]): 'revolve' | 'assembly' | 'prismatic' {
  if (!Array.isArray(features)) return 'prismatic';
  const f = features as Array<Record<string, unknown>>;
  const adds = f.filter((x) => x && x.op !== 'subtract');
  const rounds = adds.filter((x) => x.kind === 'cylinder' || x.kind === 'sphere').length;
  if (f.length > 10 || adds.length > 6) return 'assembly';
  if (adds.length > 0 && rounds === adds.length) return 'revolve';
  return 'prismatic';
}

// 정투영 실루엣 + 치수선(하단 폭·좌측 높이 — '치수 박힌 도면' §2.1)
function drawView(canvas: HTMLCanvasElement, pos: Float32Array, ax: number, ay: number, flipY: boolean, dimW: number, dimH: number, balloons?: Array<{ a: number; b: number; n: number }>) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height, PAD = 13;
  ctx.clearRect(0, 0, W, H);
  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const a = pos[i + ax], b = pos[i + ay];
    if (a < minA) minA = a; if (a > maxA) maxA = a;
    if (b < minB) minB = b; if (b > maxB) maxB = b;
  }
  const sw = maxA - minA || 1, sh = maxB - minB || 1;
  const s = Math.min((W - PAD * 2) / sw, (H - PAD * 2) / sh);
  const ox = (W - sw * s) / 2, oy = (H - sh * s) / 2;
  const px = (a: number) => ox + (a - minA) * s;
  const py = (b: number) => (flipY ? H - (oy + (b - minB) * s) : oy + (b - minB) * s);
  ctx.fillStyle = 'rgba(59,130,246,0.55)';
  ctx.beginPath();
  const triCount = pos.length / 9;
  const stride = triCount > 60000 ? Math.ceil(triCount / 60000) * 9 : 9;
  for (let i = 0; i + 8 < pos.length; i += stride) {
    ctx.moveTo(px(pos[i + ax]), py(pos[i + ay]));
    ctx.lineTo(px(pos[i + 3 + ax]), py(pos[i + 3 + ay]));
    ctx.lineTo(px(pos[i + 6 + ax]), py(pos[i + 6 + ay]));
    ctx.closePath();
  }
  ctx.fill();
  // 치수선 — 값은 AABB 실측(결정론), 하단=폭 · 좌측=높이
  const x1 = ox, x2 = ox + sw * s;
  const yT = Math.min(py(minB), py(maxB)), yB = Math.max(py(minB), py(maxB));
  ctx.strokeStyle = 'rgba(96,165,250,0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x1, H - 4); ctx.lineTo(x2, H - 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1, H - 7); ctx.lineTo(x1, H - 1); ctx.moveTo(x2, H - 7); ctx.lineTo(x2, H - 1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, yT); ctx.lineTo(4, yB); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(1, yT); ctx.lineTo(7, yT); ctx.moveTo(1, yB); ctx.lineTo(7, yB); ctx.stroke();
  ctx.fillStyle = 'rgba(147,197,253,1)';
  ctx.font = '8px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(dimW), (x1 + x2) / 2, H - 6);
  ctx.save(); ctx.translate(11, (yT + yB) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(String(dimH), 0, 0); ctx.restore();
  // #2 밸룬(부품 번호 — 피처 스펙 목록과 연동, 위치=피처 원점 기반 근사 표기)
  if (balloons?.length) {
    ctx.font = '7px ui-monospace, monospace';
    for (const bl of balloons) {
      const cx = px(bl.a), cy = py(bl.b);
      ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(15,23,42,0.78)'; ctx.fill();
      ctx.strokeStyle = 'rgba(96,165,250,0.9)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(String(bl.n), cx, cy + 2.5);
    }
  }
}

// intent 스펙 라인 — features의 숫자 필드를 있는 그대로 나열(값 날조 없음, 최대 12줄)
function specLines(features: unknown[] | undefined): string[] {
  if (!Array.isArray(features)) return [];
  const out: string[] = [];
  let n = 0; // 밸룬 번호(#2) — add 피처만 카운트(뷰의 원 번호와 1:1)
  for (const f of features) {
    if (out.length >= 12) { out.push('…'); break; }
    if (!f || typeof f !== 'object') continue;
    const o = f as Record<string, unknown>;
    const kind = String(o.type ?? o.kind ?? o.op ?? 'feature');
    const isSub = o.op === 'subtract';
    const prefix = isSub ? '⊖' : `${++n}.`;
    const nums = Object.entries(o)
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
      .slice(0, 6)
      .map(([k, v]) => `${k}=${v}`);
    out.push(`${prefix} ${nums.length ? `${kind}: ${nums.join(', ')}` : kind}`);
  }
  return out;
}

export default function CheckpointPanel({
  data, onApprove, onCancel,
}: {
  data: CheckpointData;
  ko: boolean;
  onApprove: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const pathname = usePathname();
  // DesignInner historically passed only `ko`; recover the full route locale here
  // so kr/cn and the four additional locales remain available without touching it.
  const routeLang = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const t = (copy: Parameters<typeof designLoc>[1]) => designLoc(routeLang, copy);
  const frontRef = useRef<HTMLCanvasElement>(null); // 정면 = X-Z
  const topRef = useRef<HTMLCanvasElement>(null);   // 평면 = X-Y
  const sideRef = useRef<HTMLCanvasElement>(null);  // 측면 = Y-Z

  const cls = shapeClass(data.intent.features);
  const isRevolve = cls === 'revolve';

  // #2 밸룬 좌표(add 피처 중심 근사 — box=원점+size/2·cylinder=축상 중앙, 회전 미반영=근사 명시)
  const balloonsW = useMemo(() => {
    const out: Array<{ c: [number, number, number]; n: number }> = [];
    const fs = Array.isArray(data.intent.features) ? (data.intent.features as Array<Record<string, unknown>>) : [];
    let n = 0;
    for (const f of fs) {
      if (out.length >= 12) break;
      if (!f || typeof f !== 'object') continue;
      if (f.op === 'subtract') continue;
      n += 1;
      const t = ((f.at as { translate?: number[] } | undefined)?.translate ?? [0, 0, 0]) as number[];
      const kind = String(f.kind ?? f.type ?? '');
      let c: [number, number, number] = [t[0] ?? 0, t[1] ?? 0, t[2] ?? 0];
      if (kind === 'box' && Array.isArray(f.size)) { const sz = f.size as number[]; c = [c[0] + (sz[0] ?? 0) / 2, c[1] + (sz[1] ?? 0) / 2, c[2] + (sz[2] ?? 0) / 2]; }
      else if (kind === 'cylinder' && typeof f.height === 'number') c = [c[0], c[1], c[2] + (f.height as number) / 2];
      out.push({ c, n });
    }
    return out.length >= 2 ? out : []; // 단일 피처면 밸룬 생략(노이즈)
  }, [data]);

  useEffect(() => {
    const bl = (ax: 0 | 1, ay: 1 | 2) => balloonsW.map((q) => ({ a: q.c[ax], b: q.c[ay], n: q.n }));
    if (frontRef.current) drawView(frontRef.current, data.positions, 0, 2, true, data.bbox.x, data.bbox.z, bl(0, 2));
    if (topRef.current) drawView(topRef.current, data.positions, 0, 1, true, data.bbox.x, data.bbox.y, bl(0, 1));
    if (sideRef.current) drawView(sideRef.current, data.positions, 1, 2, true, data.bbox.y, data.bbox.z, bl(1, 2));
  }, [data, isRevolve, balloonsW]);

  // §12.3 뷰 라우팅 v1 — 회전체는 정면·평면 2뷰(측면=정면과 동일), 그 외 3각법 3뷰
  const views: Array<[React.RefObject<HTMLCanvasElement | null>, string, string]> = isRevolve
    ? [
      [frontRef, t({ ko: '정면(=측면)', en: 'Front (=Side)', ja: '正面（=側面）', zh: '正面（=侧面）', es: 'Frontal (=lateral)', ar: 'أمامي (=جانبي)' }), `Ø/W ${data.bbox.x} × H ${data.bbox.z}`],
      [topRef, t({ ko: '평면', en: 'Top', ja: '平面', zh: '顶面', es: 'Superior', ar: 'علوي' }), `W ${data.bbox.x} × D ${data.bbox.y}`],
    ]
    : [
      [frontRef, t({ ko: '정면', en: 'Front', ja: '正面', zh: '正面', es: 'Frontal', ar: 'أمامي' }), `W ${data.bbox.x} × H ${data.bbox.z}`],
      [topRef, t({ ko: '평면', en: 'Top', ja: '平面', zh: '顶面', es: 'Superior', ar: 'علوي' }), `W ${data.bbox.x} × D ${data.bbox.y}`],
      [sideRef, t({ ko: '측면', en: 'Side', ja: '側面', zh: '侧面', es: 'Lateral', ar: 'جانبي' }), `D ${data.bbox.y} × H ${data.bbox.z}`],
    ];
  const spec = specLines(data.intent.features);
  const clsLabel = cls === 'revolve'
    ? t({ ko: '회전체/대칭형 — 2뷰로 충분(§12.3)', en: 'Revolved — 2 views suffice', ja: '回転体・対称形 — 2ビューで十分（§12.3）', zh: '回转体/对称形 — 2 个视图足够（§12.3）', es: 'Revolucionado — bastan 2 vistas', ar: 'جسم دوراني/متماثل — يكفي عرضان' })
    : cls === 'assembly'
      ? t({ ko: '조립체 — 3각법(중심선 그래프 뷰는 후속)', en: 'Assembly — 3 views (skeleton view later)', ja: 'アセンブリ — 3面図（骨格ビューは後続）', zh: '装配体 — 三视图（骨架视图后续提供）', es: 'Ensamblaje — 3 vistas (esqueleto después)', ar: 'تجميعة — 3 مساقط (العرض الهيكلي لاحقاً)' })
      : t({ ko: '각주형 — 표준 3각법', en: 'Prismatic — standard 3 views', ja: '角柱形 — 標準三面図', zh: '棱柱体 — 标准三视图', es: 'Prismático — 3 vistas estándar', ar: 'منشوري — 3 مساقط قياسية' });

  return (
    <div style={{ marginTop: 10, padding: 12, borderRadius: 10, border: '2px solid var(--nx-accent, #2563eb)', background: 'var(--nx-panel, #fff)' }}>
      <div style={{ fontSize: 12, fontWeight: 800 }}>
        📐 {t({ ko: '도면 체크포인트 — 적용 전 확인', en: 'Drawing checkpoint — review before apply', ja: '図面チェックポイント — 適用前に確認', zh: '图纸检查点 — 应用前确认', es: 'Punto de control del plano — revisar antes de aplicar', ar: 'نقطة فحص الرسم — راجع قبل التطبيق' })}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)', marginTop: 2, lineHeight: 1.5 }}>
        {t({ ko: 'AI가 해석한 설계의 드래프트 뷰입니다. 치수·형태가 의도와 맞는지 확인 후 적용하세요. 3D를 만들기 전에 잡는 게 가장 쌉니다.', en: 'Draft views of the AI-interpreted design. Check shape & dims before applying.', ja: 'AIが解釈した設計の下書きです。適用前に形状と寸法を確認してください。', zh: '这是 AI 解读设计的草图视图。应用前请检查形状和尺寸。', es: 'Vistas preliminares del diseño interpretado por IA. Comprueba forma y medidas antes de aplicar.', ar: 'هذه مسودات للتصميم الذي فسّره الذكاء الاصطناعي. تحقق من الشكل والأبعاد قبل التطبيق.' })}
      </div>
      <div style={{ marginTop: 4, fontSize: 9.5, fontWeight: 700, color: 'var(--nx-accent, #2563eb)' }}>{clsLabel}</div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {views.map(([ref, label, dims]) => (
          <div key={label} style={{ flex: 1, textAlign: 'center' }}>
            <canvas ref={ref} width={isRevolve ? 158 : 104} height={92}
              style={{ width: '100%', border: '1px solid var(--nx-border, #dfe3e8)', borderRadius: 6, background: 'var(--nx-bg, #f8fafc)' }} />
            <div style={{ fontSize: 9.5, fontWeight: 700, marginTop: 2 }}>{label}</div>
            <div style={{ fontSize: 9, color: 'var(--nx-text-3, #6b7684)', fontVariantNumeric: 'tabular-nums' }}>{dims} mm</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 6, fontSize: 10.5, fontVariantNumeric: 'tabular-nums' }}>
        <b>{t({ ko: '전체 외형', en: 'Overall', ja: '全体外形', zh: '总体外形', es: 'Dimensiones generales', ar: 'الأبعاد الكلية' })}:</b> {data.bbox.x} × {data.bbox.y} × {data.bbox.z} mm
        {data.verify && !data.verify.error && (
          <span style={{ marginLeft: 8, color: data.verify.manifold ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
            {data.verify.manifold ? 'manifold ✓' : 'manifold ✗'}
          </span>
        )}
      </div>

      {spec.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ fontSize: 10, cursor: 'pointer', color: 'var(--nx-text-3, #6b7684)' }}>
            {t({ ko: `피처 스펙 ${data.intent.features?.length ?? 0}개 (원본 값 그대로)`, en: `Feature spec (${data.intent.features?.length ?? 0})`, ja: `フィーチャー仕様（${data.intent.features?.length ?? 0}件）`, zh: `特征规格（${data.intent.features?.length ?? 0}项）`, es: `Especificación de features (${data.intent.features?.length ?? 0})`, ar: `مواصفات العناصر (${data.intent.features?.length ?? 0})` })}
          </summary>
          <div style={{ fontSize: 9.5, color: 'var(--nx-text-2, #46505e)', lineHeight: 1.6, marginTop: 2, fontFamily: 'ui-monospace, monospace' }}>
            {spec.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </details>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button type="button" onClick={() => void onApprove()}
          style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', background: 'var(--nx-accent, #2563eb)', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
          ✓ {t({ ko: '승인하고 3D 적용', en: 'Approve & apply 3D', ja: '承認して3Dを適用', zh: '批准并应用 3D', es: 'Aprobar y aplicar 3D', ar: 'اعتماد وتطبيق 3D' })}
        </button>
        <button type="button" onClick={onCancel}
          style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)', background: 'transparent', color: 'inherit', fontSize: 12.5, cursor: 'pointer' }}>
          {t({ ko: '수정하기', en: 'Revise', ja: '修正', zh: '修改', es: 'Revisar', ar: 'مراجعة' })}
        </button>
      </div>
      <div style={{ marginTop: 4, fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)' }}>
        {t({ ko: '수정하기 = 프롬프트를 고쳐 다시 생성 (도면에서 숫자 하나 고치는 게 SCAD 디버깅보다 100배 쌉니다)', en: 'Revise = edit the prompt and regenerate.', ja: '修正 = プロンプトを編集して再生成します。', zh: '修改 = 编辑提示词并重新生成。', es: 'Revisar = edita el prompt y vuelve a generar.', ar: 'المراجعة = عدّل الطلب ثم أعد الإنشاء.' })}
      </div>
    </div>
  );
}
