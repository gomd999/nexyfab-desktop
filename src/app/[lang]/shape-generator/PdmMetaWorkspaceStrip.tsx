'use client';

import React from 'react';
import { usePdmProjectMetaStore } from './store/pdmProjectMetaStore';
import { useCloudProjectAccessStore } from './store/cloudProjectAccessStore';
import type { NfabLifecycleState } from './io/nfabPdmMeta';
import { useLang } from './hooks/useLang';
import { loc } from './lib/loc';

interface PdmMetaWorkspaceStripProps {
  isKo?: boolean;
  onFieldsEdited?: () => void;
}

export default function PdmMetaWorkspaceStrip({ isKo, onFieldsEdited }: PdmMetaWorkspaceStripProps) {
  void isKo;
  const lang = useLang();
  const partNumber = usePdmProjectMetaStore(s => s.partNumber);
  const lifecycle = usePdmProjectMetaStore(s => s.lifecycle);
  const revisionLabel = usePdmProjectMetaStore(s => s.revisionLabel);
  const setPartNumber = usePdmProjectMetaStore(s => s.setPartNumber);
  const setLifecycle = usePdmProjectMetaStore(s => s.setLifecycle);
  const setRevisionLabel = usePdmProjectMetaStore(s => s.setRevisionLabel);
  const cloudReadOnly = useCloudProjectAccessStore(s => s.hydrated && !s.canEdit);

  const inputStyle: React.CSSProperties = {
    background: 'var(--nx-panel)',
    border: '1px solid var(--nx-border)',
    borderRadius: 4,
    color: 'var(--nx-text)',
    fontSize: 11,
    padding: '2px 6px',
    minWidth: 0,
    maxWidth: 140,
  };

  const bump = () => {
    if (cloudReadOnly) return;
    onFieldsEdited?.();
  };

  return (
    <div
      data-shell-v2-hide="pdm-strip"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '4px 10px',
        borderBottom: '1px solid var(--nx-panel-2)',
        background: 'var(--nx-bg)',
        fontSize: 11,
      }}
    >
      <span style={{ color: 'var(--nx-text-2)', fontWeight: 600, letterSpacing: '0.02em' }}>PDM</span>
      {cloudReadOnly && (
        <span style={{ color: 'var(--nx-accent-2)', fontSize: 10, maxWidth: 280, lineHeight: 1.35 }}>
          {loc(lang, {
            ko: '보기 전용: 팀 뷰어로 열려 있어 PDM 필드와 클라우드 저장을 변경할 수 없습니다.',
            en: 'Read-only: opened as team viewer — PDM fields and cloud save are locked.',
            ja: '閲覧専用: チームビューアーとして開いているため、PDM フィールドとクラウド保存は変更できません。',
            zh: '只读: 以团队查看者身份打开 — PDM 字段和云端保存已锁定。',
            es: 'Solo lectura: abierto como visor de equipo — los campos PDM y el guardado en la nube están bloqueados.',
            ar: 'للقراءة فقط: مفتوح كعارض للفريق — حقول PDM والحفظ السحابي مقفلة.',
          })}
        </span>
      )}
      {lifecycle === 'released' && (
        <span style={{ color: 'var(--nx-warn)', fontSize: 10, maxWidth: 280, lineHeight: 1.35 }}>
          {loc(lang, {
            ko: '릴리스 상태: 클라우드 저장 시 씬 변경이 거부됩니다. 편집하려면 상태를 WIP로 바꾸세요.',
            en: 'Released: cloud saves reject scene changes until you set State to WIP.',
            ja: 'リリース状態: 状態を WIP に変更するまで、クラウド保存ではシーンの変更が拒否されます。',
            zh: '已发布状态: 在将状态改为 WIP 之前,云端保存将拒绝场景更改。',
            es: 'Publicado: el guardado en la nube rechaza los cambios de escena hasta que cambie el estado a WIP.',
            ar: 'الحالة مُصدَرة: يرفض الحفظ السحابي تغييرات المشهد حتى تُغيّر الحالة إلى WIP.',
          })}
        </span>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--nx-text-2)' }}>
        {loc(lang, { ko: '부품 번호', en: 'Part #', ja: '部品番号', zh: '零件号', es: 'N.º de pieza', ar: 'رقم القطعة' })}
        <input
          value={partNumber}
          onChange={e => {
            setPartNumber(e.target.value);
            bump();
          }}
          readOnly={cloudReadOnly}
          disabled={cloudReadOnly}
          style={inputStyle}
          maxLength={120}
          spellCheck={false}
          aria-label={loc(lang, { ko: '부품 번호', en: 'Part number', ja: '部品番号', zh: '零件号', es: 'Número de pieza', ar: 'رقم القطعة' })}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--nx-text-2)' }}>
        {loc(lang, { ko: '개정', en: 'Rev', ja: '改訂', zh: '版本', es: 'Rev', ar: 'مراجعة' })}
        <input
          value={revisionLabel}
          onChange={e => {
            setRevisionLabel(e.target.value);
            bump();
          }}
          readOnly={cloudReadOnly}
          disabled={cloudReadOnly}
          style={{ ...inputStyle, maxWidth: 72 }}
          maxLength={64}
          spellCheck={false}
          aria-label={loc(lang, { ko: '개정 라벨', en: 'Revision label', ja: '改訂ラベル', zh: '版本标签', es: 'Etiqueta de revisión', ar: 'تسمية المراجعة' })}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--nx-text-2)' }}>
        {loc(lang, { ko: '상태', en: 'State', ja: '状態', zh: '状态', es: 'Estado', ar: 'الحالة' })}
        <select
          value={lifecycle}
          onChange={e => {
            setLifecycle(e.target.value as NfabLifecycleState);
            bump();
          }}
          disabled={cloudReadOnly}
          style={{ ...inputStyle, maxWidth: 110, cursor: cloudReadOnly ? 'not-allowed' : 'pointer' }}
          aria-label={loc(lang, { ko: '작업 상태', en: 'Lifecycle state', ja: 'ライフサイクル状態', zh: '生命周期状态', es: 'Estado del ciclo de vida', ar: 'حالة دورة الحياة' })}
        >
          <option value="wip">{loc(lang, { ko: '작업 중', en: 'WIP', ja: '作業中', zh: '进行中', es: 'En curso', ar: 'قيد العمل' })}</option>
          <option value="released">{loc(lang, { ko: '릴리스', en: 'Released', ja: 'リリース', zh: '已发布', es: 'Publicado', ar: 'مُصدَر' })}</option>
        </select>
      </label>
    </div>
  );
}
