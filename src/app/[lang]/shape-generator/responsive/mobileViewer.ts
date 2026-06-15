/**
 * mobileViewer — pure decision + i18n helpers for the read-only mobile 3D viewer.
 *
 * Kept free of react-three-fiber so it can be statically imported (the Canvas
 * component is loaded dynamically, ssr:false) and unit-tested without WebGL.
 */
import type * as THREE from 'three';

/** Is there a real model to show? (a non-empty BufferGeometry). Decides whether
 *  the mobile branch shows the viewer or falls back to the desktop-only wall. */
export function hasViewableGeometry(geo: THREE.BufferGeometry | null | undefined): boolean {
  const count = geo?.attributes?.position?.count as number | undefined;
  return !!geo && (count ?? 0) > 0;
}

export interface MobileViewerLabels { badge: string; gesture: string; edit: string; }

const VIEWER_LABELS: Record<string, MobileViewerLabels> = {
  ko: { badge: '보기 전용', gesture: '한 손가락 회전 · 두 손가락 확대·이동', edit: '편집하려면 PC에서 여세요' },
  en: { badge: 'View only', gesture: 'One finger to rotate · two to zoom/pan', edit: 'Open on a desktop to edit' },
  ja: { badge: '表示のみ', gesture: '1本指で回転 · 2本指で拡大・移動', edit: '編集はPCで開いてください' },
  cn: { badge: '仅查看', gesture: '单指旋转 · 双指缩放/平移', edit: '在电脑上打开以编辑' },
  es: { badge: 'Solo vista', gesture: 'Un dedo rota · dos dedos zoom/mover', edit: 'Ábrelo en un escritorio para editar' },
  ar: { badge: 'عرض فقط', gesture: 'إصبع للتدوير · إصبعان للتكبير/التحريك', edit: 'افتحه على سطح المكتب للتحرير' },
};

/** Viewer micro-labels for the device language, falling back to English. */
export function mobileViewerLabels(lang: string): MobileViewerLabels {
  return VIEWER_LABELS[lang] ?? VIEWER_LABELS.en;
}
