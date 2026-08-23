'use client';

import { useEffect, useRef, useState } from 'react';
import { clampInteriorClearanceMm, clampInteriorPlacementPositionMm, clampInteriorRotationDeg, type InteriorPlacementObject, type Vec3Mm } from '@/lib/cad/interiorPlacementDocument';
import type { InteriorPlacementTransactionState } from './useInteriorPlacementTransaction';

type Draft = { position: Vec3Mm; rotation: Vec3Mm; dimensions: Vec3Mm; clearance: Vec3Mm };
const COPY = {
  ko: { title: '선택한 배치', id: 'ID', type: '유형', space: '공간', position: '위치 (mm)', rotation: '회전 (°)', dimensions: '치수 (mm)', clearance: '여유 (mm)', none: '먼저 가구를 선택하세요', pending: '저장 중…', stale: '공간 기준이 바뀌어 수정이 차단되었습니다', saved: '프로젝트 배치 저장됨', local: '로컬 배치', auth: '로그인이 필요합니다', conflict: '최신 배치와 충돌했습니다', blocked: '배치 저장 차단됨', undo: '실행 취소', redo: '다시 실행' },
  en: { title: 'Selected placement', id: 'ID', type: 'Type', space: 'Space', position: 'Position (mm)', rotation: 'Rotation (°)', dimensions: 'Dimensions (mm)', clearance: 'Clearance (mm)', none: 'Select a furniture object first', pending: 'Saving…', stale: 'Editing is blocked because the room basis changed', saved: 'Project placement saved', local: 'Local placement', auth: 'Sign in to save', conflict: 'Placement conflicts with the latest draft', blocked: 'Placement save blocked', undo: 'Undo', redo: 'Redo' },
  ja: { title: '選択した配置', id: 'ID', type: '種類', space: '空間', position: '位置 (mm)', rotation: '回転 (°)', dimensions: '寸法 (mm)', clearance: '余裕 (mm)', none: '家具を選択してください', pending: '保存中…', stale: '部屋基準が変わったため編集できません', saved: '配置を保存しました', local: 'ローカル配置', auth: '保存にはログインが必要です', conflict: '最新の配置と競合しています', blocked: '配置の保存がブロックされました', undo: '元に戻す', redo: 'やり直す' },
  zh: { title: '所选布局', id: 'ID', type: '类型', space: '空间', position: '位置 (mm)', rotation: '旋转 (°)', dimensions: '尺寸 (mm)', clearance: '间隙 (mm)', none: '请先选择家具', pending: '保存中…', stale: '房间基准已改变，编辑已阻止', saved: '项目布局已保存', local: '本地布局', auth: '请登录后保存', conflict: '与最新布局冲突', blocked: '布局保存已阻止', undo: '撤销', redo: '重做' },
  es: { title: 'Colocación seleccionada', id: 'ID', type: 'Tipo', space: 'Espacio', position: 'Posición (mm)', rotation: 'Rotación (°)', dimensions: 'Dimensiones (mm)', clearance: 'Holgura (mm)', none: 'Seleccione un mueble', pending: 'Guardando…', stale: 'La base del espacio cambió; edición bloqueada', saved: 'Colocación guardada', local: 'Colocación local', auth: 'Inicie sesión para guardar', conflict: 'Conflicto con la colocación más reciente', blocked: 'Guardado bloqueado', undo: 'Deshacer', redo: 'Rehacer' },
  ar: { title: 'العنصر المحدد', id: 'المعرّف', type: 'النوع', space: 'المساحة', position: 'الموضع (مم)', rotation: 'الدوران (°)', dimensions: 'الأبعاد (مم)', clearance: 'الخلوص (مم)', none: 'اختر قطعة أثاث أولاً', pending: 'جارٍ الحفظ…', stale: 'تغير أساس الغرفة؛ تم حظر التعديل', saved: 'تم حفظ موضع المشروع', local: 'موضع محلي', auth: 'سجّل الدخول للحفظ', conflict: 'يتعارض الموضع مع أحدث مسودة', blocked: 'تم حظر حفظ الموضع', undo: 'تراجع', redo: 'إعادة' },
} as const;

function draftFor(object: InteriorPlacementObject): Draft {
  return { position: [...object.pose.positionMm] as Vec3Mm, rotation: [...object.pose.rotationDeg] as Vec3Mm, dimensions: [...object.dimensionsMm] as Vec3Mm, clearance: [...object.clearanceMm] as Vec3Mm };
}

export function InteriorPlacementInspector({ object, roomSizeMm, lang, pending = false, roomBasisStale = false, onCommit }: { object: InteriorPlacementObject | null; roomSizeMm: Vec3Mm; lang: string; pending?: boolean; roomBasisStale?: boolean; onCommit: (changes: Partial<Pick<InteriorPlacementObject, 'pose' | 'dimensionsMm' | 'clearanceMm'>>) => boolean | Promise<boolean> }) {
  const t = COPY[lang === 'kr' ? 'ko' : (lang in COPY ? lang : 'en') as keyof typeof COPY];
  const [draft, setDraft] = useState<Draft | null>(() => object ? draftFor(object) : null);
  const committed = useRef<Draft | null>(draft);
  const lastSubmitted = useRef<string | null>(null);
  useEffect(() => { const next = object ? draftFor(object) : null; setDraft(next); committed.current = next; lastSubmitted.current = null; }, [object]);
  if (!object || !draft) return <section aria-live="polite" data-testid="interior-placement-inspector" style={{ display: 'grid', gap: 5, fontSize: 10.5 }}><b>{t.title}</b><span>{t.none}</span></section>;
  const commit = async (next: Draft) => {
    if (pending || roomBasisStale || !committed.current || JSON.stringify(next) === JSON.stringify(committed.current)) return;
    const dimensions = next.dimensions.map((value, index) => Math.min(roomSizeMm[index], Math.max(1, Number.isFinite(value) ? value : 1))) as unknown as Vec3Mm;
    const rotation = clampInteriorRotationDeg(next.rotation);
    const clearance = clampInteriorClearanceMm(next.clearance, roomSizeMm.map(value => value / 2) as unknown as Vec3Mm);
    const position = clampInteriorPlacementPositionMm(next.position, roomSizeMm, dimensions, rotation, clearance);
    const normalized = { position, rotation, dimensions, clearance };
    const signature = JSON.stringify(normalized);
    if (lastSubmitted.current === signature) return;
    lastSubmitted.current = signature;
    const ok = await onCommit({ pose: { positionMm: position, rotationDeg: rotation }, dimensionsMm: dimensions, clearanceMm: clearance });
    if (ok) { committed.current = normalized; setDraft(normalized); }
    else if (lastSubmitted.current === signature) lastSubmitted.current = null;
  };
  const field = (group: keyof Draft, index: number, label: string) => {
    const limits = group === 'rotation' ? { min: -180, max: 180, step: 1 } : group === 'clearance' ? { min: 0, max: roomSizeMm[index] / 2, step: 1 } : group === 'dimensions' ? { min: 1, max: roomSizeMm[index], step: 1 } : { min: -roomSizeMm[index] / 2, max: roomSizeMm[index] / 2, step: 1 };
    return <input aria-label={`${label} ${index + 1}`} data-testid={`interior-placement-${group}-${index}`} type="number" {...limits} value={draft[group][index]} disabled={pending || roomBasisStale} onChange={event => { const next = { ...draft, [group]: [...draft[group].slice(0, index), Number(event.target.value), ...draft[group].slice(index + 1)] as unknown as Vec3Mm }; setDraft(next); }} onBlur={() => void commit(draft)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commit(draft); } if (event.key === 'Escape') { event.preventDefault(); const reset = committed.current; if (reset) setDraft(reset); } }} style={{ width: '100%', minWidth: 0 }} />;
  };
  const group = (key: keyof Draft, label: string) => <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend>{label}</legend><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>{[0, 1, 2].map(index => <span key={index}>{field(key, index, label)}</span>)}</div></fieldset>;
  return <section aria-live="polite" data-testid="interior-placement-inspector" style={{ display: 'grid', gap: 6, fontSize: 10.5 }} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <b>{t.title}</b><dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 3, margin: 0 }}><dt>{t.id}</dt><dd data-testid="interior-placement-object-id" style={{ margin: 0, userSelect: 'text' }}>{object.id}</dd><dt>{t.type}</dt><dd style={{ margin: 0 }}>{object.catalogType}</dd><dt>{t.space}</dt><dd style={{ margin: 0 }}>{object.spaceId}</dd></dl>
    {group('position', t.position)}{group('rotation', t.rotation)}{group('dimensions', t.dimensions)}{group('clearance', t.clearance)}
    {pending && <span>{t.pending}</span>}{roomBasisStale && <span role="alert">{t.stale}</span>}
  </section>;
}

export function InteriorPlacementTransactionStatus({ state, lang, onUndo, onRedo }: { state: InteriorPlacementTransactionState; lang: string; onUndo: () => boolean | Promise<boolean>; onRedo: () => boolean | Promise<boolean> }) {
  const t = COPY[lang === 'kr' ? 'ko' : (lang in COPY ? lang : 'en') as keyof typeof COPY];
  const busy = state.persistence === 'RUNNING';
  const persistence = busy ? t.pending : state.persistence === 'SAVED' ? t.saved : state.persistence === 'AUTH_REQUIRED' ? t.auth : state.persistence === 'CONFLICT' ? t.conflict : state.persistence === 'BLOCKED' ? t.blocked : t.local;
  return <section data-testid="interior-placement-transaction-status" aria-live="polite" dir={lang === 'ar' ? 'rtl' : 'ltr'} style={{ marginTop: 8, padding: '7px 8px', border: '1px solid var(--nx-border)', borderRadius: 6, display: 'grid', gap: 4, fontSize: 9.5 }}>
    <b>{t.local} r{state.revision}</b><span>{persistence}</span>
    <div style={{ display: 'flex', gap: 4 }}><button type="button" disabled={busy || !state.canUndo} onClick={() => void onUndo()}>{t.undo}</button><button type="button" disabled={busy || !state.canRedo} onClick={() => void onRedo()}>{t.redo}</button></div>
    {!!state.issues.length && <span role="alert">{state.issues.join(' · ')}</span>}
  </section>;
}
