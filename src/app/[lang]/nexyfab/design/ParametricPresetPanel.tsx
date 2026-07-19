'use client';

/**
 * 결정론 파라메트릭 프리셋 패널 — "카드 선택 → 즉시 생성 → 말로 수정" (2026-07-16 개편).
 *
 * 폼-우선에서 대화-우선으로: 템플릿 카드를 클릭하면 기본값으로 즉시 생성되고,
 * 이후 "내경 600으로" 같은 자연어로 수정한다(edit-intent: 서버=문장→구조화 편집 변환만,
 * 적용·min/max 클램프·재생성은 여기서 결정론). 숫자 폼은 접이식 '세부 치수 직접 입력'.
 * 도면·사진 업로드: 기계=기존 extract(11종 부품) 우선, 실패·타 분야=extract-preset
 * (템플릿 매칭 → 판독값 **확인 카드** → 사용자가 승인해야 생성 — 허위 형상 방지).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isKorean } from '@/lib/i18n/normalize';

interface ParamSpec { name: string; labelKo: string; unit: string; default: number; min: number; max: number }
interface Template { id: string; labelKo: string; labelEn: string; params: ParamSpec[] }

interface Applied {
  ok: boolean;
  intent?: { name?: string; features?: unknown[] };
  scad?: string;
  verify?: { manifold?: boolean; triangles?: number; nonManifoldEdges?: number; error?: string } | null;
  gateErrors?: string[];
  error?: string;
}

interface DrawRes {
  templateId: string; labelKo?: string; labelEn?: string; confidence: number;
  values: Record<string, number>; filled?: string[]; clamped?: string[]; notes?: string;
  /** 사진 업로드 경로(§3 역할 분리) — 형태 힌트만, 치수는 사용하지 않음 */
  photo?: boolean;
}

const defaultsOf = (tpl: Template): Record<string, number> =>
  Object.fromEntries(tpl.params.map((p) => [p.name, p.default]));

export default function ParametricPresetPanel({
  lang,
  domain = 'mech',
  onApply,
}: {
  lang: string;
  domain?: string;
  onApply: (intent: { name?: string; features?: unknown[] }, scad: string, verify: Applied['verify']) => void | Promise<void>;
}) {
  const ko = isKorean(lang);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [tid, setTid] = useState('');
  const [params, setParams] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  // 말로 수정
  const [nlText, setNlText] = useState('');
  const [nlBusy, setNlBusy] = useState(false);
  const [nlMsg, setNlMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 업로드 이원화(§3 역할 분리): 도면=치수의 유일한 진실 · 사진=형태 힌트만(치수 결정 금지)
  const fileRef = useRef<HTMLInputElement>(null);
  const modeRef = useRef<'drawing' | 'photo'>('drawing');
  const [drawBusy, setDrawBusy] = useState(false);
  const [drawRes, setDrawRes] = useState<DrawRes | null>(null);
  const [drawErr, setDrawErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/nexyfab/drawing/preset/?domain=${encodeURIComponent(domain)}`)
      .then((r) => r.json())
      .then((d: { ok: boolean; templates?: Template[] }) => {
        if (!alive || !d.ok || !d.templates) return;
        setTemplates(d.templates);
        if (d.templates[0]) setTid(d.templates[0].id); // 선택만 — 생성은 클릭/업로드에서
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [domain]);

  const tpl = useMemo(() => templates?.find((t) => t.id === tid) ?? null, [templates, tid]);

  // 템플릿 바뀌면 파라미터 기본값으로 (카드 클릭의 명시 값 세팅과 겹쳐도 같은 값이라 무해)
  useEffect(() => {
    if (!tpl) return;
    setParams(defaultsOf(tpl));
    setNlMsg(null);
  }, [tpl]);

  // 스테일 클로저 없이 즉시 생성 — tid/params를 인자로 받는다
  const doGenerate = useCallback(async (tid2: string, p2: Record<string, number>) => {
    if (!tid2) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/preset/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, templateId: tid2, params: p2 }),
      });
      const data = (await res.json()) as Applied;
      if (data.ok && data.intent && data.scad) {
        await onApply(data.intent, data.scad, data.verify);
        setApplied(true);
        setMsg(ko ? '생성됨 · 항상 유효(결정론)' : 'Generated · always valid (deterministic)');
      } else {
        setMsg((ko ? '실패: ' : 'Failed: ') + (data.gateErrors?.join('; ') ?? data.error ?? ''));
      }
    } catch (e) {
      setMsg((ko ? '실패: ' : 'Failed: ') + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, [domain, onApply, ko]);

  // 카드 클릭 = 선택 + 기본값 즉시 생성 (대화-우선 문법의 1단)
  const onCard = useCallback((tp: Template) => {
    setTid(tp.id);
    const dv = defaultsOf(tp);
    setParams(dv);
    setDrawRes(null); setDrawErr(null);
    void doGenerate(tp.id, dv);
  }, [doGenerate]);

  // 말로 수정 — 서버(정규식→LLM 폴백)는 구조화 편집만, 클램프·적용·재생성은 여기서(결정론)
  const sendNl = useCallback(async () => {
    const utterance = nlText.trim();
    if (!utterance || !tpl || nlBusy) return;
    setNlBusy(true); setNlMsg(null);
    try {
      const allowedParams = tpl.params.map((p) => ({ name: p.name, current: Number(params[p.name] ?? p.default), min: p.min, max: p.max, unit: p.unit }));
      const res = await fetch('/api/nexyfab/drawing/edit-intent/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utterance, allowedParams }),
      });
      const j = (await res.json()) as { ok?: boolean; edits?: Array<{ param: string; op: 'set' | 'delta'; value: number }>; error?: string };
      if (!j.ok || !j.edits?.length) { setNlMsg({ ok: false, text: j.error ?? '—' }); return; }
      const next = { ...params };
      const summary: string[] = [];
      for (const e of j.edits) {
        const spec = tpl.params.find((p) => p.name === e.param);
        if (!spec || !Number.isFinite(e.value)) continue;
        const cur = Number(next[e.param] ?? spec.default);
        const raw = e.op === 'set' ? e.value : cur + e.value;
        next[e.param] = Math.min(spec.max, Math.max(spec.min, raw));
        summary.push(`${spec.labelKo} → ${next[e.param]}${spec.unit}`);
      }
      if (!summary.length) { setNlMsg({ ok: false, text: j.error ?? '—' }); return; }
      setParams(next);
      setNlText('');
      setNlMsg({ ok: true, text: summary.join(' · ') });
      void doGenerate(tpl.id, next); // 수정 즉시 재생성 — 대화 문법 유지
    } catch (e) {
      setNlMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setNlBusy(false);
    }
  }, [nlText, tpl, nlBusy, params, doGenerate]);

  // 도면·사진 업로드 → (기계) 부품 판독 우선 → 실패·타 분야는 템플릿 매칭 → 확인 카드
  const onPickFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    // DWG 씨앗(260718): LibreDWG WASM 서버 변환 → DXF 와 동일 씨앗 플로우(사람 검증 전제)
    if (/\.dwg$/i.test(f.name)) {
      if (f.size > 60_000_000) { setDrawErr(ko ? 'DWG 60MB 초과' : 'DWG over 60MB'); return; }
      void (async () => {
        setDrawBusy(true); setDrawErr(null); setDrawRes(null);
        try {
          const buf = new Uint8Array(await f.arrayBuffer());
          let bin = '';
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          const r = await fetch('/api/nexyfab/drawing/dwg-convert/', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dwgBase64: btoa(bin) }),
          });
          const j = (await r.json()) as { ok?: boolean; seed?: { measurements: number[]; circles: Array<{ r: number }>; extents: { w: number; h: number } | null }; error?: string; mesh3dLikely?: boolean };
          if (!j.ok || !j.seed) {
            setDrawErr(j.mesh3dLikely
              ? (ko ? '3D 메시 DWG 입니다 — 어셈블리 프리셋의 "실물 가져오기"로 업로드하세요(부품 AABB 임포트).' : '3D mesh DWG — upload via assembly panel "import real model".')
              : (j.error ?? (ko ? 'DWG 파싱 실패' : 'DWG parse failed')));
            return;
          }
          const sd = j.seed;
          const parts: string[] = [];
          if (sd.extents) parts.push(ko ? `전체 약 ${sd.extents.w}×${sd.extents.h}mm` : `overall ~${sd.extents.w}x${sd.extents.h}mm`);
          if (sd.measurements.length) parts.push((ko ? '치수값 ' : 'dims ') + sd.measurements.slice(0, 12).join(', '));
          if (sd.circles.length) parts.push((ko ? '원 Ø' : 'holes Ø') + [...new Set(sd.circles.map((c) => +(c.r * 2).toFixed(2)))].slice(0, 8).join(', Ø') + ` ×${sd.circles.length}`);
          const seedText = (ko ? 'DWG 씨앗(LibreDWG 변환·사람 검증 필요): ' : 'DWG seed (verify): ') + parts.join(' · ') + (ko ? ' — 이 치수로 [부품 설명]을 설계' : ' — design [part] with these dims');
          window.dispatchEvent(new CustomEvent('nf-dxf-seed', { detail: seedText }));
          setMsg(ko ? 'DWG를 변환해 씨앗을 프롬프트에 넣었어요 — 부품 설명을 붙여 생성하세요(자동 생성 아님).' : 'DWG converted — seed prefilled, add a part description.');
        } catch (err) {
          setDrawErr(err instanceof Error ? err.message : String(err));
        } finally {
          setDrawBusy(false);
        }
      })();
      return;
    }
    // DXF 씨앗(입구 A Phase 2, §9): 치수·원을 결정론 파싱해 프롬프트 프리필(사람 검증 전제)
    if (/\.dxf$/i.test(f.name)) {
      const tr = new FileReader();
      tr.onload = () => {
        void (async () => {
          setDrawBusy(true); setDrawErr(null); setDrawRes(null);
          try {
            const r = await fetch('/api/nexyfab/drawing/dxf-seed/', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dxfText: String(tr.result ?? '') }),
            });
            const j = (await r.json()) as { ok?: boolean; seed?: { measurements: number[]; circles: Array<{ r: number }>; extents: { w: number; h: number } | null }; error?: string };
            if (!j.ok || !j.seed) { setDrawErr(j.error ?? 'DXF 파싱 실패'); return; }
            const sd = j.seed;
            const parts: string[] = [];
            if (sd.extents) parts.push(ko ? `전체 약 ${sd.extents.w}×${sd.extents.h}mm` : `overall ~${sd.extents.w}x${sd.extents.h}mm`);
            if (sd.measurements.length) parts.push((ko ? '치수값 ' : 'dims ') + sd.measurements.slice(0, 12).join(', '));
            if (sd.circles.length) parts.push((ko ? '원 Ø' : 'holes Ø') + [...new Set(sd.circles.map((c) => +(c.r * 2).toFixed(2)))].slice(0, 8).join(', Ø') + ` ×${sd.circles.length}`);
            const seedText = (ko ? 'DXF 씨앗(사람 검증 필요): ' : 'DXF seed (verify): ') + parts.join(' · ') + (ko ? ' — 이 치수로 [부품 설명]을 설계' : ' — design [part] with these dims');
            window.dispatchEvent(new CustomEvent('nf-dxf-seed', { detail: seedText }));
            setMsg(ko ? 'DXF 씨앗을 프롬프트에 넣었어요 — 부품 설명을 붙여 생성하세요(자동 생성 아님 · §9 Phase 2).' : 'DXF seed prefilled — add a part description and generate.');
          } catch (err) {
            setDrawErr(err instanceof Error ? err.message : String(err));
          } finally {
            setDrawBusy(false);
          }
        })();
      };
      tr.readAsText(f);
      return;
    }
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { setDrawErr(ko ? 'PNG·JPG·WebP 이미지 또는 DXF만 지원합니다.' : 'PNG/JPG/WebP or DXF only.'); return; }
    if (f.size > 6_000_000) { setDrawErr(ko ? '이미지가 너무 큽니다(6MB 이하).' : 'Image too large (max 6MB).'); return; }
    const mode = modeRef.current;
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = String(reader.result || '').replace(/^data:[^,]+,/, '');
      void (async () => {
        setDrawBusy(true); setDrawErr(null); setDrawRes(null);
        try {
          // 기계 도면: 11종 부품 어휘 판독(치수 모순 게이트 포함)이 더 풍부 — 먼저 시도.
          // 사진 모드는 제외 — 사진에서 치수를 읽지 않는다(§3, AI 렌더에 속은 치수 방지).
          if (domain === 'mech' && mode === 'drawing') {
            const r = await fetch('/api/nexyfab/drawing/extract/', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageBase64: b64, mimeType: f.type }),
            });
            const j = (await r.json()) as { ok?: boolean; intent?: { name?: string; features?: unknown[] }; scad?: string; recognized?: { label?: string; confidence?: number; reproject?: { verdict?: string; support?: number } } };
            if (j.ok && j.intent && j.scad) {
              await onApply(j.intent, j.scad, null);
              setApplied(true);
              // D1 지지율 배지(260719b): 역투영 대조 결과를 성공 시에도 표시(검증됨 vs 추론)
              const rp = j.recognized?.reproject;
              const rpBadge = rp?.verdict === 'OK' && typeof rp.support === 'number'
                ? (ko ? ` · 역투영 검증 ✓ 지지율 ${Math.round(rp.support * 100)}%` : ` · reprojection ✓ ${Math.round(rp.support * 100)}%`)
                : rp?.verdict === 'UNSUPPORTED' ? (ko ? ' · 역투영 대상 외' : ' · reprojection n/a') : '';
              setMsg((ko ? '도면 판독 → 생성됨: ' : 'Drawing read → generated: ') + (j.recognized?.label ?? '') + (typeof j.recognized?.confidence === 'number' ? ` (${Math.round(j.recognized.confidence * 100)}%)` : '') + rpBadge);
              return;
            }
            // 부품 어휘 매칭 실패 → 아래 프리셋 템플릿 매칭으로 폴백
          }
          const r2 = await fetch('/api/nexyfab/drawing/extract-preset/', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: b64, mimeType: f.type, domain }),
          });
          const j2 = (await r2.json()) as ({ ok: true } & DrawRes) | { ok: false; error?: string };
          if (j2.ok) {
            // 사진 = 템플릿 분류(형태)만 사용, 판독 치수는 폐기(§3 — 치수 결정 금지)
            setDrawRes(mode === 'photo' ? { ...j2, values: {}, filled: undefined, clamped: undefined, photo: true } : j2);
          } else setDrawErr(j2.error ?? (ko ? '판독 실패' : 'Read failed'));
        } catch (err) {
          setDrawErr(err instanceof Error ? err.message : String(err));
        } finally {
          setDrawBusy(false);
        }
      })();
    };
    reader.readAsDataURL(f);
  }, [domain, ko, onApply]);

  // 판독값 확인 → 승인 시에만 생성 (허위 형상 방지 — 확인 단계 생략 금지)
  const confirmDraw = useCallback(() => {
    if (!drawRes || !templates) return;
    const tp = templates.find((t) => t.id === drawRes.templateId);
    if (!tp) { setDrawErr(ko ? '템플릿을 찾을 수 없습니다.' : 'Template not found.'); return; }
    const merged = { ...defaultsOf(tp), ...drawRes.values };
    setTid(tp.id);
    setParams(merged);
    setDrawRes(null);
    void doGenerate(tp.id, merged);
  }, [drawRes, templates, doGenerate, ko]);

  if (!templates) return null;

  return (
    <div style={{ marginBottom: 12, padding: 12, borderRadius: 8, background: 'var(--nx-accent-soft, #eef4ff)', border: '1px solid var(--nx-border, #dfe3e8)' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 800 }}>
          {ko ? '파라메트릭 프리셋' : 'Parametric preset'}
          <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
            {ko ? '카드 클릭=즉시 생성 · AI 없이 항상 유효' : 'click = generate · no AI, always valid'}
          </span>
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,.dxf,.dwg" onChange={onPickFile} style={{ display: 'none' }} />
        {/* §3 역할 분리 — 도면=치수의 진실 · 사진=형태 힌트(치수 미사용) */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button type="button" onClick={() => { modeRef.current = 'drawing'; fileRef.current?.click(); }} disabled={drawBusy}
            title={ko ? '치수 도면 — 치수를 판독합니다' : 'Dimensioned drawing — dims are read'}
            style={{ padding: '4px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit' }}>
            📐 {ko ? '도면' : 'Drawing'}
          </button>
          <button type="button" onClick={() => { modeRef.current = 'photo'; fileRef.current?.click(); }} disabled={drawBusy}
            title={ko ? '사진·렌더 — 형태 힌트만, 치수는 읽지 않습니다' : 'Photo/render — shape hint only, no dims'}
            style={{ padding: '4px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'inherit' }}>
            📷 {ko ? '사진' : 'Photo'}
          </button>
        </div>
      </div>

      {/* 템플릿 카드 갤러리 — 클릭 = 기본값 즉시 생성 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
        {templates.map((tp) => (
          <button
            key={tp.id} type="button" onClick={() => onCard(tp)} disabled={busy}
            style={{
              textAlign: 'left', padding: 8, borderRadius: 8, cursor: busy ? 'wait' : 'pointer',
              border: tid === tp.id ? '2px solid var(--nx-accent, #2563eb)' : '1px solid var(--nx-border, #dfe3e8)',
              background: tid === tp.id ? 'var(--nx-accent-soft, #eef4ff)' : 'var(--nx-panel, #fff)',
              color: 'inherit',
            }}
          >
            <div style={{ fontSize: 11.5, fontWeight: 800 }}>{ko ? tp.labelKo : tp.labelEn}</div>
            <div style={{ fontSize: 9.5, color: 'var(--nx-text-3, #6b7684)', marginTop: 2, lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {tp.params.slice(0, 4).map((p) => `${p.labelKo} ${p.default}${p.unit}`).join(' · ')}
            </div>
          </button>
        ))}
      </div>

      {drawBusy && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--nx-accent, #2563eb)' }}>{ko ? '이미지 판독 중…' : 'Reading image…'}</div>}
      {drawErr && <div style={{ marginTop: 6, fontSize: 11, color: '#991b1b' }}>{drawErr}</div>}

      {/* 판독 확인 카드 — 승인해야 생성(정직: 기본값 대체·클램프 내역 표기) */}
      {drawRes && (
        <div style={{ marginTop: 8, padding: 10, borderRadius: 8, border: '1px solid var(--nx-accent, #2563eb)', background: 'var(--nx-panel, #fff)' }}>
          <div style={{ fontSize: 11.5, fontWeight: 800 }}>
            📷 {ko ? drawRes.labelKo : drawRes.labelEn ?? drawRes.labelKo}
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
              {ko ? '판독 신뢰도' : 'confidence'} {Math.round(drawRes.confidence * 100)}%
            </span>
          </div>
          <div style={{ marginTop: 4, fontSize: 10.5, lineHeight: 1.6 }}>
            {drawRes.photo
              ? (ko ? '사진 = 형태 힌트만 — 치수는 사용하지 않습니다(정책 §3). 기본값으로 생성 후 말로 수정하세요.' : 'Photo = shape hint only — dims are not read. Generate with defaults, then adjust.')
              : Object.entries(drawRes.values).map(([k, v]) => `${k}: ${v}`).join(' · ') || (ko ? '판독된 치수 없음' : 'no dimensions read')}
          </div>
          {!!drawRes.filled?.length && (
            <div style={{ marginTop: 2, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>
              {ko ? '기본값 사용: ' : 'defaults used: '}{drawRes.filled.join(', ')}
            </div>
          )}
          {!!drawRes.clamped?.length && (
            <div style={{ marginTop: 2, fontSize: 10, color: '#b45309' }}>
              {ko ? '범위 보정: ' : 'clamped: '}{drawRes.clamped.join(', ')}
            </div>
          )}
          {drawRes.notes && <div style={{ marginTop: 2, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{drawRes.notes}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button type="button" onClick={confirmDraw} disabled={busy}
              style={{ flex: 1, padding: '7px 0', borderRadius: 7, border: 'none', background: 'var(--nx-accent, #2563eb)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              {ko ? '이 값으로 생성' : 'Generate with these'}
            </button>
            <button type="button" onClick={() => setDrawRes(null)}
              style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)', background: 'transparent', color: 'inherit', fontSize: 12, cursor: 'pointer' }}>
              {ko ? '취소' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* 말로 수정 — 생성된 뒤 대화로 치수 조정 (수정 즉시 재생성) */}
      {tpl && applied && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 5 }}>
            <input
              value={nlText} onChange={(e) => setNlText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void sendNl(); }}
              placeholder={ko ? '말로 수정: "내경 600으로", "높이 100 늘려"' : 'e.g. "bore to 600", "add 100 height"'}
              style={{ ...inpStyle, flex: 1 }}
            />
            <button type="button" onClick={() => void sendNl()} disabled={nlBusy || !nlText.trim()}
              style={{ padding: '0 12px', borderRadius: 6, border: 'none', background: 'var(--nx-accent, #2563eb)', color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', opacity: nlBusy || !nlText.trim() ? 0.5 : 1 }}>
              {nlBusy ? '…' : ko ? '적용' : 'Apply'}
            </button>
          </div>
          {nlMsg && <div style={{ marginTop: 3, fontSize: 10.5, color: nlMsg.ok ? '#16a34a' : '#991b1b' }}>{nlMsg.text}</div>}
        </div>
      )}

      {/* 접이식 — 숫자 직접 입력(전문가용). 대화-우선이지만 폼은 없애지 않는다 */}
      {tpl && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 11, fontWeight: 700, cursor: 'pointer', color: 'var(--nx-text-2, #46505e)' }}>
            {ko ? '세부 치수 직접 입력' : 'Edit dimensions directly'}
          </summary>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, margin: '8px 0' }}>
            {tpl.params.map((p) => (
              <label key={p.name} style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{p.labelKo}{p.unit ? ` (${p.unit})` : ''}</span>
                <input
                  type="number" inputMode="decimal"
                  value={params[p.name] ?? ''}
                  min={p.min} max={p.max}
                  onChange={(e) => setParams((s) => ({ ...s, [p.name]: Number(e.target.value) }))}
                  style={inpStyle}
                />
              </label>
            ))}
          </div>
          <button type="button" onClick={() => void doGenerate(tid, params)} disabled={busy} style={genStyle}>
            {busy ? (ko ? '생성 중…' : 'Generating…') : ko ? '이 치수로 생성' : 'Generate with these'}
          </button>
        </details>
      )}

      {msg && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--nx-text-2, #46505e)' }}>{msg}</div>}
    </div>
  );
}

const inpStyle: React.CSSProperties = {
  padding: '5px 7px', borderRadius: 6, fontSize: 12, border: '1px solid var(--nx-border, #dfe3e8)',
  background: 'var(--nx-panel, #fff)', color: 'inherit', width: '100%', boxSizing: 'border-box',
};
const genStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 7, border: 'none',
  background: 'var(--nx-accent, #2563eb)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
