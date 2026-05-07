'use client';
import React from 'react';
import { usePathname } from 'next/navigation';
import type { ElementSelectionInfo, FaceSelectionInfo } from './selectionInfo';

interface Props {
  info: ElementSelectionInfo | null;
  onClose: () => void;
  onSendToChat: (info: ElementSelectionInfo, actionHint?: string) => void;
}

function fmt(n: number, decimals = 1) {
  return n.toFixed(decimals);
}

const dict = {
  ko: {
    faceSelect: '면 선택',
    edgeSelect: '엣지 선택',
    direction: '방향',
    area: '면적',
    triangles: '삼각형',
    clickPos: '클릭 위치',
    estLength: '추정 길이',
    position: '위치',
    trianglesUnit: '개',
    quickActions: '빠른 작업',
    aiChat: 'AI 채팅에서 이 면 참조하기',
    addHole: '구멍 추가',
    faceOffset: '면 오프셋',
    chamfer: '모따기',
    sketch: '스케치',
    createMate: '메이트(조립) 생성',
  },
  en: {
    faceSelect: 'Face Selection',
    edgeSelect: 'Edge Selection',
    direction: 'Direction',
    area: 'Area',
    triangles: 'Triangles',
    clickPos: 'Click Position',
    estLength: 'Estimated Length',
    position: 'Position',
    trianglesUnit: '',
    quickActions: 'Quick Actions',
    aiChat: 'Reference this face in AI Chat',
    addHole: 'Add Hole',
    faceOffset: 'Face Offset',
    chamfer: 'Chamfer',
    sketch: 'Sketch',
    createMate: 'Create Mate',
  },
  ja: {
    faceSelect: '面選択',
    edgeSelect: 'エッジ選択',
    direction: '方向',
    area: '面積',
    triangles: '三角形',
    clickPos: 'クリック位置',
    estLength: '推定長さ',
    position: '位置',
    trianglesUnit: '個',
    quickActions: 'クイック操作',
    aiChat: 'AIチャットでこの面を参照',
    addHole: '穴を追加',
    faceOffset: '面オフセット',
    chamfer: '面取り',
    sketch: 'スケッチ',
    createMate: 'メイト作成',
  },
  zh: {
    faceSelect: '选择面',
    edgeSelect: '选择边',
    direction: '方向',
    area: '面积',
    triangles: '三角形',
    clickPos: '点击位置',
    estLength: '估算长度',
    position: '位置',
    trianglesUnit: '个',
    quickActions: '快速操作',
    aiChat: '在AI聊天中引用此面',
    addHole: '添加孔',
    faceOffset: '面偏移',
    chamfer: '倒角',
    sketch: '草图',
    createMate: '创建配合',
  },
  es: {
    faceSelect: 'Selección de Cara',
    edgeSelect: 'Selección de Arista',
    direction: 'Dirección',
    area: 'Área',
    triangles: 'Triángulos',
    clickPos: 'Posición del Clic',
    estLength: 'Longitud Estimada',
    position: 'Posición',
    trianglesUnit: '',
    quickActions: 'Acciones Rápidas',
    aiChat: 'Referenciar esta cara en Chat IA',
    addHole: 'Añadir Agujero',
    faceOffset: 'Desplazar Cara',
    chamfer: 'Chaflán',
    sketch: 'Boceto',
    createMate: 'Crear mate',
  },
  ar: {
    faceSelect: 'تحديد الوجه',
    edgeSelect: 'تحديد الحافة',
    direction: 'الاتجاه',
    area: 'المساحة',
    triangles: 'مثلثات',
    clickPos: 'موقع النقرة',
    estLength: 'الطول المقدر',
    position: 'الموضع',
    trianglesUnit: '',
    quickActions: 'إجراءات سريعة',
    aiChat: 'الإشارة إلى هذا الوجه في محادثة AI',
    addHole: 'إضافة فتحة',
    faceOffset: 'إزاحة الوجه',
    chamfer: 'شطف',
    sketch: 'رسم',
    createMate: 'إنشاء تقييد',
  },
};

export default function SelectionInfoBadge({ info, onClose, onSendToChat }: Props) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

  const FACE_ACTIONS = [
    { label: t.addHole, hint: '이 면에 구멍(홀)을 추가해줘.' },
    { label: t.faceOffset, hint: '이 면을 오프셋(두께 방향으로 이동)해줘.' },
    { label: t.chamfer, hint: '이 면의 가장자리에 모따기(chamfer)를 추가해줘.' },
    { label: t.sketch, hint: '이 면 위에 스케치를 시작해줘.' },
  ];

  if (!info) return null;

  const isFace = info.type === 'face';
  const face = info as FaceSelectionInfo;

  const dynamicActions = [...FACE_ACTIONS];
  if (info.partName) {
    dynamicActions.unshift({ label: t.createMate ?? 'Create Mate', hint: 'mate_start' });
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 200,
        minWidth: 280,
        maxWidth: 360,
        background: 'rgba(15,20,35,0.97)',
        border: '1px solid rgba(99,102,241,0.5)',
        borderRadius: 12,
        boxShadow: '0 4px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.1)',
        padding: '12px 14px',
        color: '#e5e7eb',
        fontSize: 12,
        backdropFilter: 'blur(12px)',
        pointerEvents: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#22d3ee', boxShadow: '0 0 6px #22d3ee',
            display: 'inline-block', flexShrink: 0,
          }} />
          <span style={{ fontWeight: 700, color: '#e0f2fe', fontSize: 13 }}>
            {isFace ? `${t.faceSelect}: ${face.normalLabel}` : t.edgeSelect}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '2px 4px' }}
        >
          ✕
        </button>
      </div>

      {/* Info rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {isFace ? (
          <>
            <Row label={t.direction} value={face.normalLabel} accent />
            <Row label={t.area} value={`${fmt(face.area)} mm²`} />
            <Row label={t.triangles} value={`${face.triangleCount}${t.trianglesUnit}`} />
            <Row label={t.clickPos} value={`(${fmt(face.position[0])}, ${fmt(face.position[1])}, ${fmt(face.position[2])}) mm`} />
          </>
        ) : (
          <>
            <Row label={t.estLength} value={`${fmt((info as any).length)} mm`} />
            <Row label={t.position} value={`(${fmt(info.position[0])}, ${fmt(info.position[1])}, ${fmt(info.position[2])}) mm`} />
          </>
        )}
      </div>

      {/* Quick action chips */}
      {isFace && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 5, fontWeight: 600, letterSpacing: '0.04em' }}>
            {t.quickActions}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {dynamicActions.map(a => (
              <button
                key={a.label}
                onClick={() => onSendToChat(info, a.hint)}
                style={{
                  padding: '4px 10px',
                  background: 'rgba(99,102,241,0.12)',
                  border: '1px solid rgba(99,102,241,0.3)',
                  borderRadius: 20,
                  color: '#c7d2fe',
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'background 0.12s',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.28)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.12)')}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Full AI chat button */}
      <button
        onClick={() => onSendToChat(info)}
        style={{
          width: '100%',
          padding: '7px 0',
          background: 'rgba(34,211,238,0.08)',
          border: '1px solid rgba(34,211,238,0.3)',
          borderRadius: 7,
          color: '#67e8f9',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 600,
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(34,211,238,0.18)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(34,211,238,0.08)')}
      >
        💬 {t.aiChat}
      </button>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: '#6b7280', flexShrink: 0, minWidth: 56 }}>{label}</span>
      <span style={{ color: accent ? '#22d3ee' : '#e5e7eb', fontFamily: 'monospace', textAlign: 'right', wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  );
}
