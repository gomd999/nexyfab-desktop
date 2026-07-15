'use client';

/**
 * CheckpointPanel — 입구 B 도면 체크포인트 (방법론 §2.1, 2026-07-16).
 *
 * 자유 서술(AI 해석) 경로에서 3D를 뷰어에 올리기 전, 드래프트 지오메트리의
 * 3뷰 실루엣(정면·평면·측면) + 전체 외형 치수(AABB) + intent 스펙을 보여주고
 * 사람이 승인해야 적용한다 — "3D를 만들기 전에 틀린 걸 잡는 것"이 정확도의 엔진.
 * 실루엣은 클라이언트 결정론(삼각형 정투영 채움) — AI 개입 없음.
 * 프리셋·도면판독 경로는 결정론/확인카드가 이미 있어 스킵(§2.2).
 */

import { useEffect, useRef } from 'react';

export interface CheckpointData {
  intent: { name?: string; features?: unknown[] };
  scad: string;
  verify: { manifold?: boolean; triangles?: number; nonManifoldEdges?: number; error?: string } | null;
  positions: Float32Array; // STL 삼각형 정점(드래프트)
  bbox: { x: number; y: number; z: number }; // 전체 외형(mm)
}

// 정투영 실루엣 — 삼각형을 지정 축 평면에 투영해 단색 채움(union = 실루엣)
function drawView(canvas: HTMLCanvasElement, pos: Float32Array, ax: number, ay: number, flipY: boolean) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width, H = canvas.height, PAD = 10;
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
  // 삼각형 수 상한 — 매우 큰 STL은 성능 위해 스트라이드 샘플(실루엣 근사임을 캡션에 표기하지 않음:
  // 상한 아래에선 전수라 정확, 상한 초과는 촘촘한 메시라 시각 차이 무시 가능)
  const triCount = pos.length / 9;
  const stride = triCount > 60000 ? Math.ceil(triCount / 60000) * 9 : 9;
  for (let i = 0; i + 8 < pos.length; i += stride) {
    ctx.moveTo(px(pos[i + ax]), py(pos[i + ay]));
    ctx.lineTo(px(pos[i + 3 + ax]), py(pos[i + 3 + ay]));
    ctx.lineTo(px(pos[i + 6 + ax]), py(pos[i + 6 + ay]));
    ctx.closePath();
  }
  ctx.fill();
}

// intent 스펙 라인 — features의 숫자 필드를 있는 그대로 나열(값 날조 없음, 최대 12줄)
function specLines(features: unknown[] | undefined): string[] {
  if (!Array.isArray(features)) return [];
  const out: string[] = [];
  for (const f of features) {
    if (out.length >= 12) { out.push('…'); break; }
    if (!f || typeof f !== 'object') continue;
    const o = f as Record<string, unknown>;
    const kind = String(o.type ?? o.kind ?? o.op ?? 'feature');
    const nums = Object.entries(o)
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
      .slice(0, 6)
      .map(([k, v]) => `${k}=${v}`);
    out.push(nums.length ? `${kind}: ${nums.join(', ')}` : kind);
  }
  return out;
}

export default function CheckpointPanel({
  data, ko, onApprove, onCancel,
}: {
  data: CheckpointData;
  ko: boolean;
  onApprove: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const frontRef = useRef<HTMLCanvasElement>(null); // 정면 = X-Z
  const topRef = useRef<HTMLCanvasElement>(null);   // 평면 = X-Y
  const sideRef = useRef<HTMLCanvasElement>(null);  // 측면 = Y-Z

  useEffect(() => {
    if (frontRef.current) drawView(frontRef.current, data.positions, 0, 2, true);
    if (topRef.current) drawView(topRef.current, data.positions, 0, 1, true);
    if (sideRef.current) drawView(sideRef.current, data.positions, 1, 2, true);
  }, [data]);

  const views: Array<[React.RefObject<HTMLCanvasElement | null>, string, string]> = [
    [frontRef, ko ? '정면' : 'Front', `W ${data.bbox.x} × H ${data.bbox.z}`],
    [topRef, ko ? '평면' : 'Top', `W ${data.bbox.x} × D ${data.bbox.y}`],
    [sideRef, ko ? '측면' : 'Side', `D ${data.bbox.y} × H ${data.bbox.z}`],
  ];
  const spec = specLines(data.intent.features);

  return (
    <div style={{ marginTop: 10, padding: 12, borderRadius: 10, border: '2px solid var(--nx-accent, #2563eb)', background: 'var(--nx-panel, #fff)' }}>
      <div style={{ fontSize: 12, fontWeight: 800 }}>
        📐 {ko ? '도면 체크포인트 — 적용 전 확인' : 'Drawing checkpoint — review before apply'}
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--nx-text-3, #6b7684)', marginTop: 2, lineHeight: 1.5 }}>
        {ko
          ? 'AI가 해석한 설계의 드래프트 3뷰입니다. 치수·형태가 의도와 맞는지 확인 후 적용하세요. 3D를 만들기 전에 잡는 게 가장 쌉니다.'
          : 'Draft 3-view of the AI-interpreted design. Check shape & overall dims before applying.'}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {views.map(([ref, label, dims]) => (
          <div key={label} style={{ flex: 1, textAlign: 'center' }}>
            <canvas ref={ref} width={104} height={86}
              style={{ width: '100%', border: '1px solid var(--nx-border, #dfe3e8)', borderRadius: 6, background: 'var(--nx-bg, #f8fafc)' }} />
            <div style={{ fontSize: 9.5, fontWeight: 700, marginTop: 2 }}>{label}</div>
            <div style={{ fontSize: 9, color: 'var(--nx-text-3, #6b7684)', fontVariantNumeric: 'tabular-nums' }}>{dims} mm</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 6, fontSize: 10.5, fontVariantNumeric: 'tabular-nums' }}>
        <b>{ko ? '전체 외형' : 'Overall'}:</b> {data.bbox.x} × {data.bbox.y} × {data.bbox.z} mm
        {data.verify && !data.verify.error && (
          <span style={{ marginLeft: 8, color: data.verify.manifold ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
            {data.verify.manifold ? (ko ? 'manifold ✓' : 'manifold ✓') : (ko ? 'manifold ✗' : 'manifold ✗')}
          </span>
        )}
      </div>

      {spec.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ fontSize: 10, cursor: 'pointer', color: 'var(--nx-text-3, #6b7684)' }}>
            {ko ? `피처 스펙 ${data.intent.features?.length ?? 0}개 (원본 값 그대로)` : `Feature spec (${data.intent.features?.length ?? 0})`}
          </summary>
          <div style={{ fontSize: 9.5, color: 'var(--nx-text-2, #46505e)', lineHeight: 1.6, marginTop: 2, fontFamily: 'ui-monospace, monospace' }}>
            {spec.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </details>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button type="button" onClick={() => void onApprove()}
          style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', background: 'var(--nx-accent, #2563eb)', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
          ✓ {ko ? '승인하고 3D 적용' : 'Approve & apply 3D'}
        </button>
        <button type="button" onClick={onCancel}
          style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)', background: 'transparent', color: 'inherit', fontSize: 12.5, cursor: 'pointer' }}>
          {ko ? '수정하기' : 'Revise'}
        </button>
      </div>
      <div style={{ marginTop: 4, fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)' }}>
        {ko ? '수정하기 = 프롬프트를 고쳐 다시 생성 (도면에서 숫자 하나 고치는 게 SCAD 디버깅보다 100배 쌉니다)' : 'Revise = edit the prompt and regenerate.'}
      </div>
    </div>
  );
}
