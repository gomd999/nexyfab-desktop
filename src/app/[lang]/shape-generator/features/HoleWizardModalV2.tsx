'use client';

/**
 * HoleWizardModalV2 — flag-gated three-tab redesign (Phase 2 W2 skeleton).
 *
 * Visual + interaction shell only. The Apply button is wired to a single
 * `onApply(def: HoleArrayDefinition)` callback that hands the validated
 * definition to the parent; no boolean / worker calls happen inside the
 * modal. The worker endpoint (`/occt/op/hole/drilled`) lands in a later
 * commit once occt-worker `src/` is unblocked.
 *
 * Flag mechanism — matches the existing `?shell=v2` pattern (see
 * `ShapeGeneratorApp.tsx` `ShellGate`): we read `useSearchParams()` and
 * gate on `?hole-wizard=v2`. The legacy `HoleWizardModal.tsx` (V1) is
 * untouched and continues to mount in `ShapeGeneratorInner.tsx`; this V2
 * component is rendered alongside but returns `null` until the flag is
 * flipped (default-off through Phase 2 W2).
 *
 * Spec references: §6.1 layout, §6.5 i18n strings.
 */

import React, { useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  HOLE_STANDARD_SERIES,
  type HoleStandardSeries,
  type HoleStandardSpec,
} from './holeStandards';
import {
  createLinearArrayDefaults,
  createLinear2DArrayDefaults,
  createCircularArrayDefaults,
  createRectArrayDefaults,
  createManualArrayDefaults,
  createFromSketchArrayDefaults,
  expandHoleArray,
  validateHoleArray,
  resolveHoleSpec,
  DEFAULT_DRILL_TIP_ANGLE,
  type BlindBottomShape,
  type HoleArrayDefinition,
  type HoleArrayKind,
  type HoleKind,
  type HoleAxis,
  type HoleSpec,
  type HoleStandardRef,
  type PipeTapHoleSpec,
  type TerminationKind,
  type TerminationParams,
} from './holeArray';
import {
  CSV_PASTE_MAX_POINTS,
  csvPointsToManualPoints,
  parseCsvPaste,
  type CsvParseResult,
} from './csvPaste';
import { computeHoleSectionSvg, type SvgElement } from './holeSectionSvg';
import {
  evaluateTapBottomRisk,
  pointListBoundingBox,
  type SketchPointSnapshot,
  type TapBottomRiskFinding,
} from './holeSketchPropagation';
// === D6 THREADS BOUNDARY START ===
import HoleWizardThreadsSection from './threads/HoleWizardThreadsSection';
// === D6 THREADS BOUNDARY END ===

// ─── Public props ──────────────────────────────────────────────────────────

/**
 * A sketch the wizard can offer in the `fromSketch` position mode. Each entry
 * carries a stable feature id + display name + the current point list. The
 * wizard does NOT mutate these — propagation is handled by
 * `holeSketchPropagation.ts` once the feature is committed via `onApply`.
 */
export interface AvailableSketch {
  /** Stable feature id (matches the value the propagator looks up by). */
  featureId: string;
  /** Human-friendly name shown in the picker dropdown. */
  label: string;
  /** Live point list. Empty array = sketch exists but has no points yet. */
  points: SketchPointSnapshot[];
}

interface Props {
  open: boolean;
  lang: 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar' | string;
  onClose: () => void;
  /** Return false when the host cannot commit the definition (for example an
   * up-to-face request without a selected face). The wizard then stays open. */
  onApply: (def: HoleArrayDefinition) => void | boolean;
  /**
   * When `true`, bypass the search-param flag check. Test escape hatch
   * (the next/navigation mock in tests can't easily set query params).
   *
   * W6 flag-flip note: V2 is now the **default** path. The escape hatch
   * is unchanged — `forceFlagOpen={true}` still forces V2 on regardless
   * of search params, which is the test-side ergonomic behaviour callers
   * have already adopted. The flag-off render path is now only triggered
   * by an explicit `?hole-wizard=v1` rollback URL.
   */
  forceFlagOpen?: boolean;
  /**
   * Inverse of `forceFlagOpen` — when `true`, force the V1 rollback path
   * regardless of search params. Used by integration tests that need to
   * exercise the V1 fallback after the W6 default flip.
   */
  forceFlagV1?: boolean;
  /**
   * Sketches the user can pick in the `fromSketch` position mode (W4 — C4).
   * When undefined or empty, the fromSketch tile is still selectable but the
   * picker shows an empty-state message.
   */
  availableSketches?: AvailableSketch[];
  /** Stable topology id of the face selected in the 3D viewport. Required
   * only for the up-to-face termination mode. */
  selectedFaceId?: string;
}

// ─── i18n dictionary ───────────────────────────────────────────────────────
// Strings sourced from `wave-2-phase-2-hole-wizard-spec.md` §6.5 (KR/EN/JA/
// ZH/ES/AR). KR is canonical for the Nexysys product surface per the i18n
// preferences memory; EN baseline drives the spec table.

type Dict = {
  wizardTitle: string;
  tabType: string;
  tabSize: string;
  tabPosition: string;
  tabTermination: string;
  tabPreview: string;
  kindDrilled: string;
  kindCbore: string;
  kindCsk: string;
  kindCdrill: string;
  kindTap: string;
  kindPipeTap: string;
  positionKindLinear: string;
  positionKindCircular: string;
  positionKindRect: string;
  positionKindFromSketch: string;
  positionKindManual: string;
  fitClose: string;
  fitNormal: string;
  fitLoose: string;
  nPositions: (n: number) => string;
  addHoles: string;
  cancel: string;
  flagOff: string;
  /** Field labels (kept short for the dense table layout). */
  fStartX: string;
  fStartY: string;
  fDx: string;
  fDy: string;
  fCount: string;
  fCenterX: string;
  fCenterY: string;
  fRadius: string;
  fStartAngle: string;
  fStepX: string;
  fStepY: string;
  fRows: string;
  fCols: string;
  fSketchId: string;
  fitClassLabel: string;
  /** Termination tab labels. */
  termBlind: string;
  termThrough: string;
  termUpToNext: string;
  termUpToFace: string;
  termDepth: string;
  termBottomFlat: string;
  termBottomConical: string;
  termDrillTipAngle: string;
  termFacePickerPlaceholder: string;
  termFacePickerHint: string;
  /** Preview tab labels. */
  prevHeader: string;
  prevDiameter: string;
  prevHeadDiameter: string;
  prevHeadDepth: string;
  prevConeDiameter: string;
  prevConeAngle: string;
  prevPositions: string;
  /** Sub-type fields (counterbore / countersink / tap). */
  fHeadDiameter: string;
  fHeadDepth: string;
  fConeDiameter: string;
  fConeAngle: string;
  /** C4 — fromSketch tab + tap class picker + DFM warning. */
  fromSketchPick: string;
  fromSketchEmpty: string;
  fromSketchPointCount: (n: number) => string;
  fromSketchBBox: (w: number, h: number) => string;
  fromSketchSelectHint: string;
  tapClassLabel: string;
  pitchLabel: string;
  tpiLabel: string;
  tapDepthLabel: string;
  tapBottomRiskTitle: string;
  pipeStandardLabel: string;
  pipeSizeKeyLabel: string;
  engagementDepthLabel: string;
  prevTapDepth: string;
  prevPitch: string;
  prevMiddleDiameter: string;
  prevMiddleDepth: string;
  prevPipeStandard: string;
  prevPipeSizeKey: string;
  prevEngagementDepth: string;
  /** W5 — linear2D pattern. */
  positionKindLinear2D: string;
  fDxRow: string;
  fDyRow: string;
  fDxCol: string;
  fDyCol: string;
  /** W5 — circular partialAngle + direction. */
  fPartialAngle: string;
  fDirection: string;
  directionCw: string;
  directionCcw: string;
  /** W5 — pipe-tap class picker + taper. */
  pipeTapClassLabel: string;
  pipeTapClassNPT: string;
  pipeTapClassNPSM: string;
  pipeTapClassBSPTaper: string;
  pipeTapClassBSPParallel: string;
  taperAngleLabel: string;
  prevTaperAngle: string;
  prevPipeTapClass: string;
  /** W5 — CSV paste sub-mode. */
  positionSubModeManualEdit: string;
  positionSubModeCsvPaste: string;
  csvPlaceholder: string;
  csvParseBtn: string;
  csvUseAsManualBtn: string;
  csvParsedSummary: (n: number) => string;
  csvErrorCount: (n: number) => string;
  csvBboxLine: (w: number, h: number) => string;
  csvDelimiterLine: (d: string) => string;
  csvTooManyPoints: (cap: number) => string;
  /** W6 — DFM flag chip labels (rendered next to the validation warning). */
  dfmTapBottomRisk: string;
  dfmSmallDrillLargeDepth: string;
  dfmCloseHoleSpacing: string;
  dfmTapShallowEngagement: string;
  dfmPipeTapClassTaperMismatch: string;
  dfmCboreDeeperThanHole: string;
  /** W6 — BOM aggregate panel. */
  bomTitle: string;
  bomTotalRow: (n: number) => string;
};

const DICT: Record<'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar', Dict> = {
  ko: {
    wizardTitle: '구멍 마법사 (V2)',
    tabType: '유형',
    tabSize: '크기',
    tabPosition: '위치',
    tabTermination: '종료',
    tabPreview: '미리보기',
    kindDrilled: '드릴',
    kindCbore: '카운터보어',
    kindCsk: '카운터싱크',
    kindCdrill: '카운터드릴',
    kindTap: '탭(나사구멍)',
    kindPipeTap: '파이프 탭',
    positionKindLinear: '선형 패턴',
    positionKindCircular: '원형 패턴',
    positionKindRect: '격자',
    positionKindFromSketch: '스케치에서',
    positionKindManual: '수동 입력',
    fitClose: '정밀',
    fitNormal: '보통',
    fitLoose: '헐거움',
    nPositions: (n: number) => `${n}개 위치`,
    addHoles: '구멍 추가',
    cancel: '취소',
    flagOff: 'V1 롤백 경로 활성 — ?hole-wizard=v1 을 제거하면 V2로 복귀합니다',
    fStartX: '시작 X',
    fStartY: '시작 Y',
    fDx: 'dX',
    fDy: 'dY',
    fCount: '개수',
    fCenterX: '중심 X',
    fCenterY: '중심 Y',
    fRadius: '반지름',
    fStartAngle: '시작각 (rad)',
    fStepX: 'X 간격',
    fStepY: 'Y 간격',
    fRows: '행',
    fCols: '열',
    fSketchId: '스케치 ID',
    fitClassLabel: '핏 클래스',
    termBlind: '막힘',
    termThrough: '관통',
    termUpToNext: '다음 면까지',
    termUpToFace: '면 지정',
    termDepth: '깊이 (mm)',
    termBottomFlat: '평면 바닥',
    termBottomConical: '원뿔 바닥',
    termDrillTipAngle: '드릴팁 각도 (°)',
    termFacePickerPlaceholder: '[3D에서 대상 면을 먼저 선택]',
    termFacePickerHint: '선택한 면의 영구 참조를 사용합니다.',
    prevHeader: '단면 미리보기',
    prevDiameter: '드릴 ⌀',
    prevHeadDiameter: '카운터보어 ⌀',
    prevHeadDepth: '카운터보어 깊이',
    prevConeDiameter: '카운터싱크 ⌀',
    prevConeAngle: '카운터싱크 각도',
    prevPositions: '위치 수',
    fHeadDiameter: '머리 ⌀',
    fHeadDepth: '머리 깊이',
    fConeDiameter: '원뿔 ⌀',
    fConeAngle: '원뿔 각도 (°)',
    fromSketchPick: '스케치 선택',
    fromSketchEmpty: '사용할 수 있는 스케치 없음 — 먼저 스케치를 만드세요',
    fromSketchPointCount: (n: number) => `${n}개 점`,
    fromSketchBBox: (w: number, h: number) => `범위 ${w.toFixed(1)} × ${h.toFixed(1)} mm`,
    fromSketchSelectHint: '스케치의 점이 그대로 구멍 위치가 됩니다',
    tapClassLabel: '탭 클래스',
    pitchLabel: '피치 (mm)',
    tpiLabel: 'TPI',
    tapDepthLabel: '탭 깊이 (mm)',
    tapBottomRiskTitle: '⚠ 탭 바닥 위험',
    pipeStandardLabel: '파이프 규격',
    pipeSizeKeyLabel: '파이프 사이즈',
    engagementDepthLabel: '체결 깊이 (mm)',
    prevTapDepth: '탭 깊이',
    prevPitch: '피치',
    prevMiddleDiameter: '중간 ⌀',
    prevMiddleDepth: '중간 깊이',
    prevPipeStandard: '파이프 규격',
    prevPipeSizeKey: '파이프 사이즈',
    prevEngagementDepth: '체결 깊이',
    positionKindLinear2D: '2D 격자',
    fDxRow: '행 dX',
    fDyRow: '행 dY',
    fDxCol: '열 dX',
    fDyCol: '열 dY',
    fPartialAngle: '부분 각도 (°)',
    fDirection: '방향',
    directionCw: '시계',
    directionCcw: '반시계',
    pipeTapClassLabel: '파이프 탭 클래스',
    pipeTapClassNPT: 'NPT (테이퍼)',
    pipeTapClassNPSM: 'NPSM (평행)',
    pipeTapClassBSPTaper: 'BSP 테이퍼',
    pipeTapClassBSPParallel: 'BSP 평행',
    taperAngleLabel: '테이퍼 반각 (°)',
    prevTaperAngle: '테이퍼 반각',
    prevPipeTapClass: '파이프 탭 클래스',
    positionSubModeManualEdit: '직접 편집',
    positionSubModeCsvPaste: 'CSV 붙여넣기',
    csvPlaceholder: 'x, y[, 직경, 라벨]\n예: 10, 20, 5, A1\n     30, 40\n     50, 60, 6',
    csvParseBtn: '파싱',
    csvUseAsManualBtn: '수동 모드로 사용',
    csvParsedSummary: (n: number) => `${n}개 점 파싱됨`,
    csvErrorCount: (n: number) => `${n}개 오류`,
    csvBboxLine: (w: number, h: number) => `범위 ${w.toFixed(1)} × ${h.toFixed(1)} mm`,
    csvDelimiterLine: (d: string) => `구분자: ${d === '\t' ? 'TAB' : d}`,
    csvTooManyPoints: (cap: number) => `최대 ${cap}개를 초과한 행은 무시됨`,
    dfmTapBottomRisk: '⚠ 탭 바닥 위험',
    dfmSmallDrillLargeDepth: '⚠ 작은 드릴 / 큰 깊이',
    dfmCloseHoleSpacing: '⚠ 구멍 간격 좁음',
    dfmTapShallowEngagement: '⚠ 탭 체결 깊이 부족',
    dfmPipeTapClassTaperMismatch: '⚠ 파이프 탭 클래스 / 테이퍼 불일치',
    dfmCboreDeeperThanHole: '⚠ 카운터보어가 구멍보다 깊음',
    bomTitle: 'BOM 요약',
    bomTotalRow: (n: number) => `총 ${n}개 구멍`,
  },
  en: {
    wizardTitle: 'Hole Wizard (V2)',
    tabType: 'Type',
    tabSize: 'Size',
    tabPosition: 'Position',
    tabTermination: 'Termination',
    tabPreview: 'Preview',
    kindDrilled: 'Drilled',
    kindCbore: 'Counterbore',
    kindCsk: 'Countersink',
    kindCdrill: 'Counterdrill',
    kindTap: 'Tap',
    kindPipeTap: 'Pipe Tap',
    positionKindLinear: 'Linear',
    positionKindCircular: 'Circular',
    positionKindRect: 'Rectangular',
    positionKindFromSketch: 'From sketch',
    positionKindManual: 'Manual',
    fitClose: 'Close',
    fitNormal: 'Normal',
    fitLoose: 'Loose',
    nPositions: (n: number) => `${n} position${n === 1 ? '' : 's'}`,
    addHoles: 'Add Holes',
    cancel: 'Cancel',
    flagOff: 'V1 rollback path active — remove ?hole-wizard=v1 to return to V2',
    fStartX: 'Start X',
    fStartY: 'Start Y',
    fDx: 'dX',
    fDy: 'dY',
    fCount: 'Count',
    fCenterX: 'Center X',
    fCenterY: 'Center Y',
    fRadius: 'Radius',
    fStartAngle: 'Start angle (rad)',
    fStepX: 'Step X',
    fStepY: 'Step Y',
    fRows: 'Rows',
    fCols: 'Cols',
    fSketchId: 'Sketch ID',
    fitClassLabel: 'Fit class',
    termBlind: 'Blind',
    termThrough: 'Through all',
    termUpToNext: 'Up to next',
    termUpToFace: 'Up to face',
    termDepth: 'Depth (mm)',
    termBottomFlat: 'Flat bottom',
    termBottomConical: 'Conical bottom',
    termDrillTipAngle: 'Drill tip angle (°)',
    termFacePickerPlaceholder: '[Select a target face in 3D first]',
    termFacePickerHint: 'Uses the persistent reference of the selected face.',
    prevHeader: 'Cross-section preview',
    prevDiameter: 'Drill ⌀',
    prevHeadDiameter: 'Counterbore ⌀',
    prevHeadDepth: 'Counterbore depth',
    prevConeDiameter: 'Countersink ⌀',
    prevConeAngle: 'Countersink angle',
    prevPositions: 'Positions',
    fHeadDiameter: 'Head ⌀',
    fHeadDepth: 'Head depth',
    fConeDiameter: 'Cone ⌀',
    fConeAngle: 'Cone angle (°)',
    fromSketchPick: 'Pick sketch',
    fromSketchEmpty: 'No sketches available — create a sketch first',
    fromSketchPointCount: (n: number) => `${n} point${n === 1 ? '' : 's'}`,
    fromSketchBBox: (w: number, h: number) => `bbox ${w.toFixed(1)} × ${h.toFixed(1)} mm`,
    fromSketchSelectHint: 'Sketch points become hole positions',
    tapClassLabel: 'Tap class',
    pitchLabel: 'Pitch (mm)',
    tpiLabel: 'TPI',
    tapDepthLabel: 'Tap depth (mm)',
    tapBottomRiskTitle: '⚠ Tap-bottom risk',
    pipeStandardLabel: 'Pipe standard',
    pipeSizeKeyLabel: 'Pipe size',
    engagementDepthLabel: 'Engagement depth (mm)',
    prevTapDepth: 'Tap depth',
    prevPitch: 'Pitch',
    prevMiddleDiameter: 'Middle ⌀',
    prevMiddleDepth: 'Middle depth',
    prevPipeStandard: 'Pipe standard',
    prevPipeSizeKey: 'Pipe size',
    prevEngagementDepth: 'Engagement depth',
    positionKindLinear2D: 'Linear 2D',
    fDxRow: 'Row dX',
    fDyRow: 'Row dY',
    fDxCol: 'Col dX',
    fDyCol: 'Col dY',
    fPartialAngle: 'Partial angle (°)',
    fDirection: 'Direction',
    directionCw: 'CW',
    directionCcw: 'CCW',
    pipeTapClassLabel: 'Pipe-tap class',
    pipeTapClassNPT: 'NPT (taper)',
    pipeTapClassNPSM: 'NPSM (parallel)',
    pipeTapClassBSPTaper: 'BSP taper',
    pipeTapClassBSPParallel: 'BSP parallel',
    taperAngleLabel: 'Taper half-angle (°)',
    prevTaperAngle: 'Taper half-angle',
    prevPipeTapClass: 'Pipe-tap class',
    positionSubModeManualEdit: 'Edit',
    positionSubModeCsvPaste: 'CSV paste',
    csvPlaceholder: 'x, y[, diameter, label]\nex:  10, 20, 5, A1\n     30, 40\n     50, 60, 6',
    csvParseBtn: 'Parse',
    csvUseAsManualBtn: 'Use as Manual',
    csvParsedSummary: (n: number) => `${n} point${n === 1 ? '' : 's'} parsed`,
    csvErrorCount: (n: number) => `${n} error${n === 1 ? '' : 's'}`,
    csvBboxLine: (w: number, h: number) => `bbox ${w.toFixed(1)} × ${h.toFixed(1)} mm`,
    csvDelimiterLine: (d: string) => `delimiter: ${d === '\t' ? 'TAB' : d}`,
    csvTooManyPoints: (cap: number) => `Rows past ${cap} ignored`,
    dfmTapBottomRisk: '⚠ Tap-bottom risk',
    dfmSmallDrillLargeDepth: '⚠ Small drill at large depth',
    dfmCloseHoleSpacing: '⚠ Hole spacing too close',
    dfmTapShallowEngagement: '⚠ Shallow tap engagement',
    dfmPipeTapClassTaperMismatch: '⚠ Pipe-tap class / taper mismatch',
    dfmCboreDeeperThanHole: '⚠ Counterbore deeper than hole',
    bomTitle: 'BOM summary',
    bomTotalRow: (n: number) => `${n} ${n === 1 ? 'hole' : 'holes'} total`,
  },
  ja: {
    wizardTitle: 'ホールウィザード (V2)',
    tabType: '種類',
    tabSize: 'サイズ',
    tabPosition: '位置',
    tabTermination: '終端',
    tabPreview: 'プレビュー',
    kindDrilled: 'ドリル',
    kindCbore: 'カウンターボア',
    kindCsk: 'カウンターシンク',
    kindCdrill: 'カウンタードリル',
    kindTap: 'タップ',
    kindPipeTap: 'パイプタップ',
    positionKindLinear: '直線',
    positionKindCircular: '円形',
    positionKindRect: '格子',
    positionKindFromSketch: 'スケッチから',
    positionKindManual: '手動',
    fitClose: '精密',
    fitNormal: '普通',
    fitLoose: 'ゆるい',
    nPositions: (n: number) => `${n} 位置`,
    addHoles: 'ホールを追加',
    cancel: 'キャンセル',
    flagOff: 'V1 ロールバック中 — ?hole-wizard=v1 を外すと V2 に戻ります',
    fStartX: '開始 X',
    fStartY: '開始 Y',
    fDx: 'dX',
    fDy: 'dY',
    fCount: '数',
    fCenterX: '中心 X',
    fCenterY: '中心 Y',
    fRadius: '半径',
    fStartAngle: '開始角 (rad)',
    fStepX: 'X 間隔',
    fStepY: 'Y 間隔',
    fRows: '行',
    fCols: '列',
    fSketchId: 'スケッチ ID',
    fitClassLabel: 'フィット',
    termBlind: '止まり',
    termThrough: '貫通',
    termUpToNext: '次の面まで',
    termUpToFace: '面指定',
    termDepth: '深さ (mm)',
    termBottomFlat: '平面底',
    termBottomConical: '円錐底',
    termDrillTipAngle: 'ドリル先端角 (°)',
    termFacePickerPlaceholder: '[先に3Dで対象面を選択]',
    termFacePickerHint: '選択面の永続参照を使用します。',
    prevHeader: '断面プレビュー',
    prevDiameter: 'ドリル ⌀',
    prevHeadDiameter: 'カウンターボア ⌀',
    prevHeadDepth: 'カウンターボア深さ',
    prevConeDiameter: 'カウンターシンク ⌀',
    prevConeAngle: 'カウンターシンク角度',
    prevPositions: '位置数',
    fHeadDiameter: 'ヘッド ⌀',
    fHeadDepth: 'ヘッド深さ',
    fConeDiameter: 'コーン ⌀',
    fConeAngle: 'コーン角度 (°)',
    fromSketchPick: 'スケッチを選択',
    fromSketchEmpty: 'スケッチがありません — まずスケッチを作成してください',
    fromSketchPointCount: (n: number) => `${n} 点`,
    fromSketchBBox: (w: number, h: number) => `範囲 ${w.toFixed(1)} × ${h.toFixed(1)} mm`,
    fromSketchSelectHint: 'スケッチ点がそのまま穴の位置になります',
    tapClassLabel: 'タップクラス',
    pitchLabel: 'ピッチ (mm)',
    tpiLabel: 'TPI',
    tapDepthLabel: 'タップ深さ (mm)',
    tapBottomRiskTitle: '⚠ タップ底リスク',
    pipeStandardLabel: 'パイプ規格',
    pipeSizeKeyLabel: 'パイプサイズ',
    engagementDepthLabel: '締結深さ (mm)',
    prevTapDepth: 'タップ深さ',
    prevPitch: 'ピッチ',
    prevMiddleDiameter: '中間 ⌀',
    prevMiddleDepth: '中間深さ',
    prevPipeStandard: 'パイプ規格',
    prevPipeSizeKey: 'パイプサイズ',
    prevEngagementDepth: '締結深さ',
    positionKindLinear2D: '2D 格子',
    fDxRow: '行 dX',
    fDyRow: '行 dY',
    fDxCol: '列 dX',
    fDyCol: '列 dY',
    fPartialAngle: '部分角 (°)',
    fDirection: '方向',
    directionCw: '時計回り',
    directionCcw: '反時計回り',
    pipeTapClassLabel: 'パイプタップクラス',
    pipeTapClassNPT: 'NPT (テーパー)',
    pipeTapClassNPSM: 'NPSM (平行)',
    pipeTapClassBSPTaper: 'BSP テーパー',
    pipeTapClassBSPParallel: 'BSP 平行',
    taperAngleLabel: 'テーパー半角 (°)',
    prevTaperAngle: 'テーパー半角',
    prevPipeTapClass: 'パイプタップクラス',
    positionSubModeManualEdit: '編集',
    positionSubModeCsvPaste: 'CSV 貼付',
    csvPlaceholder: 'x, y[, 直径, ラベル]\n例: 10, 20, 5, A1\n     30, 40\n     50, 60, 6',
    csvParseBtn: '解析',
    csvUseAsManualBtn: '手動モードへ',
    csvParsedSummary: (n: number) => `${n} 点 解析済`,
    csvErrorCount: (n: number) => `${n} エラー`,
    csvBboxLine: (w: number, h: number) => `範囲 ${w.toFixed(1)} × ${h.toFixed(1)} mm`,
    csvDelimiterLine: (d: string) => `区切り: ${d === '\t' ? 'TAB' : d}`,
    csvTooManyPoints: (cap: number) => `${cap} 行を超える行は無視`,
    dfmTapBottomRisk: '⚠ タップ底リスク',
    dfmSmallDrillLargeDepth: '⚠ 小径ドリル × 深穴',
    dfmCloseHoleSpacing: '⚠ 穴間隔が近すぎ',
    dfmTapShallowEngagement: '⚠ タップ係合深さ不足',
    dfmPipeTapClassTaperMismatch: '⚠ パイプタップクラス/テーパー不一致',
    dfmCboreDeeperThanHole: '⚠ カウンターボアが穴より深い',
    bomTitle: 'BOM 要約',
    bomTotalRow: (n: number) => `合計 ${n} 穴`,
  },
  zh: {
    wizardTitle: '孔向导 (V2)',
    tabType: '类型',
    tabSize: '尺寸',
    tabPosition: '位置',
    tabTermination: '终止',
    tabPreview: '预览',
    kindDrilled: '钻孔',
    kindCbore: '沉头扩孔',
    kindCsk: '沉头孔',
    kindCdrill: '沉头钻孔',
    kindTap: '攻丝',
    kindPipeTap: '管螺纹',
    positionKindLinear: '线性',
    positionKindCircular: '圆形',
    positionKindRect: '矩形',
    positionKindFromSketch: '从草图',
    positionKindManual: '手动',
    fitClose: '紧配合',
    fitNormal: '普通配合',
    fitLoose: '松配合',
    nPositions: (n: number) => `${n} 个位置`,
    addHoles: '添加孔',
    cancel: '取消',
    flagOff: 'V1 回退路径已启用 — 移除 ?hole-wizard=v1 即可恢复 V2',
    fStartX: '起点 X',
    fStartY: '起点 Y',
    fDx: 'dX',
    fDy: 'dY',
    fCount: '数量',
    fCenterX: '中心 X',
    fCenterY: '中心 Y',
    fRadius: '半径',
    fStartAngle: '起始角 (rad)',
    fStepX: 'X 步长',
    fStepY: 'Y 步长',
    fRows: '行',
    fCols: '列',
    fSketchId: '草图 ID',
    fitClassLabel: '配合等级',
    termBlind: '盲孔',
    termThrough: '通孔',
    termUpToNext: '至下一面',
    termUpToFace: '至指定面',
    termDepth: '深度 (mm)',
    termBottomFlat: '平底',
    termBottomConical: '锥底',
    termDrillTipAngle: '钻头角度 (°)',
    termFacePickerPlaceholder: '[先在3D中选择目标面]',
    termFacePickerHint: '使用所选面的持久引用。',
    prevHeader: '截面预览',
    prevDiameter: '钻孔 ⌀',
    prevHeadDiameter: '沉头扩孔 ⌀',
    prevHeadDepth: '沉头扩孔深度',
    prevConeDiameter: '沉头孔 ⌀',
    prevConeAngle: '沉头孔角度',
    prevPositions: '位置数',
    fHeadDiameter: '头部 ⌀',
    fHeadDepth: '头部深度',
    fConeDiameter: '锥面 ⌀',
    fConeAngle: '锥面角度 (°)',
    fromSketchPick: '选择草图',
    fromSketchEmpty: '没有可用草图 — 请先创建草图',
    fromSketchPointCount: (n: number) => `${n} 个点`,
    fromSketchBBox: (w: number, h: number) => `范围 ${w.toFixed(1)} × ${h.toFixed(1)} mm`,
    fromSketchSelectHint: '草图点直接作为孔位置',
    tapClassLabel: '攻丝等级',
    pitchLabel: '螺距 (mm)',
    tpiLabel: 'TPI',
    tapDepthLabel: '攻丝深度 (mm)',
    tapBottomRiskTitle: '⚠ 攻丝底部风险',
    pipeStandardLabel: '管螺纹规格',
    pipeSizeKeyLabel: '管螺纹尺寸',
    engagementDepthLabel: '啮合深度 (mm)',
    prevTapDepth: '攻丝深度',
    prevPitch: '螺距',
    prevMiddleDiameter: '中间 ⌀',
    prevMiddleDepth: '中间深度',
    prevPipeStandard: '管螺纹规格',
    prevPipeSizeKey: '管螺纹尺寸',
    prevEngagementDepth: '啮合深度',
    positionKindLinear2D: '2D 网格',
    fDxRow: '行 dX',
    fDyRow: '行 dY',
    fDxCol: '列 dX',
    fDyCol: '列 dY',
    fPartialAngle: '局部角度 (°)',
    fDirection: '方向',
    directionCw: '顺时针',
    directionCcw: '逆时针',
    pipeTapClassLabel: '管螺纹等级',
    pipeTapClassNPT: 'NPT (锥形)',
    pipeTapClassNPSM: 'NPSM (平行)',
    pipeTapClassBSPTaper: 'BSP 锥形',
    pipeTapClassBSPParallel: 'BSP 平行',
    taperAngleLabel: '锥度半角 (°)',
    prevTaperAngle: '锥度半角',
    prevPipeTapClass: '管螺纹等级',
    positionSubModeManualEdit: '编辑',
    positionSubModeCsvPaste: 'CSV 粘贴',
    csvPlaceholder: 'x, y[, 直径, 标签]\n例: 10, 20, 5, A1\n     30, 40\n     50, 60, 6',
    csvParseBtn: '解析',
    csvUseAsManualBtn: '使用为手动',
    csvParsedSummary: (n: number) => `${n} 个点已解析`,
    csvErrorCount: (n: number) => `${n} 个错误`,
    csvBboxLine: (w: number, h: number) => `范围 ${w.toFixed(1)} × ${h.toFixed(1)} mm`,
    csvDelimiterLine: (d: string) => `分隔符: ${d === '\t' ? 'TAB' : d}`,
    csvTooManyPoints: (cap: number) => `超过 ${cap} 行被忽略`,
    dfmTapBottomRisk: '⚠ 攻丝底部风险',
    dfmSmallDrillLargeDepth: '⚠ 小钻头 × 深孔',
    dfmCloseHoleSpacing: '⚠ 孔间距过近',
    dfmTapShallowEngagement: '⚠ 攻丝啮合不足',
    dfmPipeTapClassTaperMismatch: '⚠ 管螺纹等级/锥度不匹配',
    dfmCboreDeeperThanHole: '⚠ 沉头扩孔深于钻孔',
    bomTitle: 'BOM 摘要',
    bomTotalRow: (n: number) => `共 ${n} 个孔`,
  },
  es: {
    wizardTitle: 'Asistente de Hole (V2)',
    tabType: 'Tipo',
    tabSize: 'Tamaño',
    tabPosition: 'Posición',
    tabTermination: 'Terminación',
    tabPreview: 'Vista previa',
    kindDrilled: 'Taladrado',
    kindCbore: 'Avellanado plano',
    kindCsk: 'Avellanado',
    kindCdrill: 'Contrataladrado',
    kindTap: 'Roscado',
    kindPipeTap: 'Roscado para tubo',
    positionKindLinear: 'Lineal',
    positionKindCircular: 'Circular',
    positionKindRect: 'Rectangular',
    positionKindFromSketch: 'Desde croquis',
    positionKindManual: 'Manual',
    fitClose: 'Cerrado',
    fitNormal: 'Normal',
    fitLoose: 'Flojo',
    nPositions: (n: number) => `${n} ${n === 1 ? 'posición' : 'posiciones'}`,
    addHoles: 'Añadir Holes',
    cancel: 'Cancelar',
    flagOff: 'Ruta V1 (rollback) activa — quita ?hole-wizard=v1 para volver a V2',
    fStartX: 'X inicial',
    fStartY: 'Y inicial',
    fDx: 'dX',
    fDy: 'dY',
    fCount: 'Cantidad',
    fCenterX: 'X centro',
    fCenterY: 'Y centro',
    fRadius: 'Radio',
    fStartAngle: 'Ángulo inicial (rad)',
    fStepX: 'Paso X',
    fStepY: 'Paso Y',
    fRows: 'Filas',
    fCols: 'Columnas',
    fSketchId: 'ID de croquis',
    fitClassLabel: 'Clase de ajuste',
    termBlind: 'Ciego',
    termThrough: 'Pasante total',
    termUpToNext: 'Hasta el próximo',
    termUpToFace: 'Hasta cara',
    termDepth: 'Profundidad (mm)',
    termBottomFlat: 'Fondo plano',
    termBottomConical: 'Fondo cónico',
    termDrillTipAngle: 'Ángulo de punta (°)',
    termFacePickerPlaceholder: '[Selecciona primero una cara en 3D]',
    termFacePickerHint: 'Usa la referencia persistente de la cara seleccionada.',
    prevHeader: 'Vista previa de sección',
    prevDiameter: 'Taladro ⌀',
    prevHeadDiameter: 'Avellanado ⌀',
    prevHeadDepth: 'Profundidad avellanado',
    prevConeDiameter: 'Avellanado cónico ⌀',
    prevConeAngle: 'Ángulo avellanado',
    prevPositions: 'Posiciones',
    fHeadDiameter: 'Cabeza ⌀',
    fHeadDepth: 'Profundidad cabeza',
    fConeDiameter: 'Cono ⌀',
    fConeAngle: 'Ángulo del cono (°)',
    fromSketchPick: 'Elegir croquis',
    fromSketchEmpty: 'Sin croquis disponibles — crea uno primero',
    fromSketchPointCount: (n: number) => `${n} ${n === 1 ? 'punto' : 'puntos'}`,
    fromSketchBBox: (w: number, h: number) => `bbox ${w.toFixed(1)} × ${h.toFixed(1)} mm`,
    fromSketchSelectHint: 'Los puntos del croquis serán las posiciones de los holes',
    tapClassLabel: 'Clase de rosca',
    pitchLabel: 'Paso (mm)',
    tpiLabel: 'TPI',
    tapDepthLabel: 'Profundidad de rosca (mm)',
    tapBottomRiskTitle: '⚠ Riesgo de fondo de rosca',
    pipeStandardLabel: 'Estándar de tubo',
    pipeSizeKeyLabel: 'Tamaño de tubo',
    engagementDepthLabel: 'Profundidad de engrane (mm)',
    prevTapDepth: 'Profundidad de rosca',
    prevPitch: 'Paso',
    prevMiddleDiameter: 'Medio ⌀',
    prevMiddleDepth: 'Profundidad media',
    prevPipeStandard: 'Estándar de tubo',
    prevPipeSizeKey: 'Tamaño de tubo',
    prevEngagementDepth: 'Profundidad de engrane',
    positionKindLinear2D: 'Lineal 2D',
    fDxRow: 'Fila dX',
    fDyRow: 'Fila dY',
    fDxCol: 'Col dX',
    fDyCol: 'Col dY',
    fPartialAngle: 'Ángulo parcial (°)',
    fDirection: 'Dirección',
    directionCw: 'CW',
    directionCcw: 'CCW',
    pipeTapClassLabel: 'Clase de rosca de tubo',
    pipeTapClassNPT: 'NPT (cónico)',
    pipeTapClassNPSM: 'NPSM (paralelo)',
    pipeTapClassBSPTaper: 'BSP cónico',
    pipeTapClassBSPParallel: 'BSP paralelo',
    taperAngleLabel: 'Semiángulo cónico (°)',
    prevTaperAngle: 'Semiángulo cónico',
    prevPipeTapClass: 'Clase de rosca de tubo',
    positionSubModeManualEdit: 'Editar',
    positionSubModeCsvPaste: 'Pegar CSV',
    csvPlaceholder: 'x, y[, diámetro, etiqueta]\nej: 10, 20, 5, A1\n     30, 40\n     50, 60, 6',
    csvParseBtn: 'Parsear',
    csvUseAsManualBtn: 'Usar como manual',
    csvParsedSummary: (n: number) => `${n} ${n === 1 ? 'punto' : 'puntos'} parseados`,
    csvErrorCount: (n: number) => `${n} ${n === 1 ? 'error' : 'errores'}`,
    csvBboxLine: (w: number, h: number) => `bbox ${w.toFixed(1)} × ${h.toFixed(1)} mm`,
    csvDelimiterLine: (d: string) => `delimitador: ${d === '\t' ? 'TAB' : d}`,
    csvTooManyPoints: (cap: number) => `Filas después de ${cap} ignoradas`,
    dfmTapBottomRisk: '⚠ Riesgo de fondo de rosca',
    dfmSmallDrillLargeDepth: '⚠ Broca pequeña / profundidad excesiva',
    dfmCloseHoleSpacing: '⚠ Holes demasiado cercanos',
    dfmTapShallowEngagement: '⚠ Engrane de rosca insuficiente',
    dfmPipeTapClassTaperMismatch: '⚠ Clase de rosca de tubo / cono no coinciden',
    dfmCboreDeeperThanHole: '⚠ Avellanado más profundo que el hole',
    bomTitle: 'Resumen BOM',
    bomTotalRow: (n: number) => `${n} ${n === 1 ? 'hole' : 'holes'} en total`,
  },
  ar: {
    wizardTitle: 'معالج الفتحات (V2)',
    tabType: 'النوع',
    tabSize: 'الحجم',
    tabPosition: 'الموضع',
    tabTermination: 'الإنهاء',
    tabPreview: 'معاينة',
    kindDrilled: 'مثقوب',
    kindCbore: 'تجويف عميق',
    kindCsk: 'تجويف مخروطي',
    kindCdrill: 'تثقيب مركّب',
    kindTap: 'حلزون داخلي',
    kindPipeTap: 'حلزون أنبوب',
    positionKindLinear: 'خطي',
    positionKindCircular: 'دائري',
    positionKindRect: 'مستطيل',
    positionKindFromSketch: 'من الرسم',
    positionKindManual: 'يدوي',
    fitClose: 'تطابق دقيق',
    fitNormal: 'تطابق عادي',
    fitLoose: 'تطابق فضفاض',
    nPositions: (n: number) => `${n} مواضع`,
    addHoles: 'إضافة فتحات',
    cancel: 'إلغاء',
    flagOff: 'مسار التراجع V1 نشط — أزل ?hole-wizard=v1 للعودة إلى V2',
    fStartX: 'بداية X',
    fStartY: 'بداية Y',
    fDx: 'dX',
    fDy: 'dY',
    fCount: 'العدد',
    fCenterX: 'مركز X',
    fCenterY: 'مركز Y',
    fRadius: 'نصف القطر',
    fStartAngle: 'الزاوية البدائية (rad)',
    fStepX: 'خطوة X',
    fStepY: 'خطوة Y',
    fRows: 'صفوف',
    fCols: 'أعمدة',
    fSketchId: 'معرف الرسم',
    fitClassLabel: 'فئة التطابق',
    termBlind: 'معتم',
    termThrough: 'نافذ كامل',
    termUpToNext: 'حتى السطح التالي',
    termUpToFace: 'حتى وجه محدد',
    termDepth: 'العمق (mm)',
    termBottomFlat: 'قاع مستوٍ',
    termBottomConical: 'قاع مخروطي',
    termDrillTipAngle: 'زاوية رأس المثقاب (°)',
    termFacePickerPlaceholder: '[حدد الوجه الهدف في العرض ثلاثي الأبعاد أولاً]',
    termFacePickerHint: 'يستخدم المرجع الدائم للوجه المحدد.',
    prevHeader: 'معاينة المقطع',
    prevDiameter: 'قطر المثقاب',
    prevHeadDiameter: 'قطر التجويف العميق',
    prevHeadDepth: 'عمق التجويف العميق',
    prevConeDiameter: 'قطر التجويف المخروطي',
    prevConeAngle: 'زاوية التجويف المخروطي',
    prevPositions: 'عدد المواضع',
    fHeadDiameter: 'قطر الرأس',
    fHeadDepth: 'عمق الرأس',
    fConeDiameter: 'قطر المخروط',
    fConeAngle: 'زاوية المخروط (°)',
    fromSketchPick: 'اختر الرسم',
    fromSketchEmpty: 'لا توجد رسومات — أنشئ رسمًا أولاً',
    fromSketchPointCount: (n: number) => `${n} نقاط`,
    fromSketchBBox: (w: number, h: number) => `نطاق ${w.toFixed(1)} × ${h.toFixed(1)} mm`,
    fromSketchSelectHint: 'نقاط الرسم تصبح مواضع الفتحات',
    tapClassLabel: 'فئة الحلزون',
    pitchLabel: 'الخطوة (mm)',
    tpiLabel: 'TPI',
    tapDepthLabel: 'عمق الحلزون (mm)',
    tapBottomRiskTitle: '⚠ خطر قاع الحلزون',
    pipeStandardLabel: 'معيار الأنبوب',
    pipeSizeKeyLabel: 'حجم الأنبوب',
    engagementDepthLabel: 'عمق التشابك (mm)',
    prevTapDepth: 'عمق الحلزون',
    prevPitch: 'الخطوة',
    prevMiddleDiameter: 'قطر الوسط',
    prevMiddleDepth: 'عمق الوسط',
    prevPipeStandard: 'معيار الأنبوب',
    prevPipeSizeKey: 'حجم الأنبوب',
    prevEngagementDepth: 'عمق التشابك',
    positionKindLinear2D: 'شبكة ثنائية',
    fDxRow: 'صف dX',
    fDyRow: 'صف dY',
    fDxCol: 'عمود dX',
    fDyCol: 'عمود dY',
    fPartialAngle: 'زاوية جزئية (°)',
    fDirection: 'الاتجاه',
    directionCw: 'باتجاه الساعة',
    directionCcw: 'عكس عقارب الساعة',
    pipeTapClassLabel: 'فئة حلزون الأنبوب',
    pipeTapClassNPT: 'NPT (مخروطي)',
    pipeTapClassNPSM: 'NPSM (موازٍ)',
    pipeTapClassBSPTaper: 'BSP مخروطي',
    pipeTapClassBSPParallel: 'BSP موازٍ',
    taperAngleLabel: 'نصف زاوية الميل (°)',
    prevTaperAngle: 'نصف زاوية الميل',
    prevPipeTapClass: 'فئة حلزون الأنبوب',
    positionSubModeManualEdit: 'تحرير',
    positionSubModeCsvPaste: 'لصق CSV',
    csvPlaceholder: 'x, y[, القطر, تسمية]\n10, 20, 5, A1\n30, 40\n50, 60, 6',
    csvParseBtn: 'تحليل',
    csvUseAsManualBtn: 'استخدم كيدوي',
    csvParsedSummary: (n: number) => `${n} نقطة محللة`,
    csvErrorCount: (n: number) => `${n} خطأ`,
    csvBboxLine: (w: number, h: number) => `النطاق ${w.toFixed(1)} × ${h.toFixed(1)} mm`,
    csvDelimiterLine: (d: string) => `المحدّد: ${d === '\t' ? 'TAB' : d}`,
    csvTooManyPoints: (cap: number) => `تم تجاهل الصفوف بعد ${cap}`,
    dfmTapBottomRisk: '⚠ خطر قاع الحلزون',
    dfmSmallDrillLargeDepth: '⚠ مثقاب صغير مع عمق كبير',
    dfmCloseHoleSpacing: '⚠ تباعد الفتحات قريب جدًا',
    dfmTapShallowEngagement: '⚠ تشابك حلزون غير كافٍ',
    dfmPipeTapClassTaperMismatch: '⚠ عدم توافق فئة حلزون الأنبوب مع الميل',
    dfmCboreDeeperThanHole: '⚠ التجويف العميق أعمق من الفتحة',
    bomTitle: 'ملخص قائمة المواد (BOM)',
    bomTotalRow: (n: number) => `إجمالي ${n} فتحات`,
  },
};

// ─── Tabs & sub-type catalogs ──────────────────────────────────────────────

type WizardTab = 'type' | 'size' | 'position' | 'termination' | 'preview';

/**
 * The 6 first-class hole types from spec §2. The wizard's UI label uses
 * camelCase / friendly names but the data-model `HoleKind` uses snake_case
 * for `pipe_tap`. The `WIZARD_TO_HOLEKIND` table maps between them.
 */
type WizardHoleType = 'drilled' | 'counterbore' | 'countersink' | 'counterdrill' | 'tap' | 'pipeTap';

const WIZARD_HOLE_TYPES: ReadonlyArray<WizardHoleType> = [
  'drilled',
  'counterbore',
  'countersink',
  'counterdrill',
  'tap',
  'pipeTap',
];

const WIZARD_TO_HOLEKIND: Record<WizardHoleType, HoleKind> = {
  drilled: 'drilled',
  counterbore: 'counterbore',
  countersink: 'countersink',
  counterdrill: 'counterdrill',
  tap: 'tap',
  pipeTap: 'pipe_tap',
};

const TERMINATION_KINDS: ReadonlyArray<TerminationKind> = [
  'blind',
  'through',
  'upToNext',
  'upToFace',
];

const POSITION_KINDS: ReadonlyArray<HoleArrayKind> = [
  'linear',
  'linear2D',
  'circular',
  'rect',
  'fromSketch',
  'manual',
];

/** Resolve which catalog series matches a (standard, holeType) selection. */
function defaultSeriesFor(holeType: WizardHoleType): HoleStandardSeries {
  if (holeType === 'pipeTap') return 'NPT';
  return 'ISO';
}

// ─── Component ─────────────────────────────────────────────────────────────

function pickLang(raw: string | undefined): keyof typeof DICT {
  const map: Record<string, keyof typeof DICT> = {
    ko: 'ko', kr: 'ko', en: 'en', ja: 'ja', jp: 'ja',
    zh: 'zh', cn: 'zh', es: 'es', ar: 'ar',
  };
  return map[raw ?? 'en'] ?? 'en';
}

/** W6 — flag the RTL family (only AR for now). Modal sets `dir="rtl"` so
 *  layout reverses naturally — the tabs reorder, footer buttons align
 *  on the opposite edge, and labels flip without per-component overrides. */
function isRtlLang(lang: keyof typeof DICT): boolean {
  return lang === 'ar';
}

export default function HoleWizardModalV2({
  open,
  lang,
  onClose,
  onApply,
  forceFlagOpen,
  forceFlagV1,
  availableSketches,
  selectedFaceId,
}: Props) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const resolvedLang = pickLang(seg);
  const t = DICT[resolvedLang];
  const rtl = isRtlLang(resolvedLang);

  // ── Flag gate — W6 flag flip (spec §9 Week 4, tracker C6).
  //
  // BEFORE W6:  default → V1; `?hole-wizard=v2` → V2
  // AFTER  W6:  default → V2; `?hole-wizard=v1` → V1 (rollback escape hatch)
  //
  // We accept the legacy `?hole-wizard=v2` URL as forward-compat (it
  // matches the post-flip default anyway, so the URL stays meaningful).
  // The `forceFlagOpen` / `forceFlagV1` props give tests a way to pin
  // either side regardless of search-params (next/navigation mocks
  // can't easily mutate URLSearchParams between renders).
  const queryParam = sp?.get('hole-wizard');
  const flagOn =
    forceFlagOpen === true
      ? true
      : forceFlagV1 === true
        ? false
        : queryParam === 'v1'
          ? false
          : true; // default V2 (W6 flag flip)

  // ── Tab state. ───────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<WizardTab>('type');

  // ── Type tab state. ──────────────────────────────────────────────────────
  const [holeType, setHoleType] = useState<WizardHoleType>('drilled');

  // ── Size tab state. ──────────────────────────────────────────────────────
  const [series, setSeries] = useState<HoleStandardSeries>(() => defaultSeriesFor('drilled'));
  const [designationIndex, setDesignationIndex] = useState(0);
  const [fitClass, setFitClass] = useState<'close' | 'normal' | 'loose'>('normal');

  // Reset designation when series flips so we don't index past the new
  // catalog's length (e.g. ISO has 18 rows, NPT has 10).
  const rows = HOLE_STANDARD_SERIES[series] ?? [];
  const safeIndex = Math.min(designationIndex, Math.max(0, rows.length - 1));
  const selectedRow: HoleStandardSpec | undefined = rows[safeIndex];

  // ── Position tab state. ──────────────────────────────────────────────────
  // We hold the full HoleArrayDefinition in state, seeded from the factory
  // matching the current `positionKind`. Switching kind reseeds with the
  // factory default — that's intentional, the wizard is "pick a kind, then
  // tweak", not "fill in the kind-specific section of a shared blob".
  const [positionKind, setPositionKind] = useState<HoleArrayKind>('linear');
  // Positive world drill axis. Y preserves the historical top-face wizard
  // behaviour; X/Z are useful for upright flanges and side plates.
  const [holeAxis, setHoleAxis] = useState<HoleAxis>(1);
  const [arrayDef, setArrayDef] = useState<HoleArrayDefinition>(() =>
    createLinearArrayDefaults('wizard-array', {
      series: 'ISO',
      designation: 'M6',
      fitClass: 'normal',
    }),
  );

  // Keep arrayDef.holeSpec in sync with current Size selection. The compiler
  // warning here is benign — selectedRowName is a primitive string from a
  // catalog read on every render, but the compiler can't prove the upstream
  // useState identity is stable enough to track. Plain derivation is fine.
  const selectedRowName = selectedRow?.name ?? '';
  const currentHoleSpec: HoleStandardRef = {
    series,
    designation: selectedRowName,
    fitClass,
  };

  /**
   * Switch position kind — reseed the array def using the matching factory
   * so each kind starts at sensible defaults the user can tweak.
   */
  function changePositionKind(next: HoleArrayKind) {
    setPositionKind(next);
    let seeded: HoleArrayDefinition;
    switch (next) {
      case 'linear':
        seeded = createLinearArrayDefaults('wizard-array', currentHoleSpec);
        break;
      case 'linear2D':
        seeded = createLinear2DArrayDefaults('wizard-array', currentHoleSpec);
        break;
      case 'circular':
        seeded = createCircularArrayDefaults('wizard-array', currentHoleSpec);
        break;
      case 'rect':
        seeded = createRectArrayDefaults('wizard-array', currentHoleSpec);
        break;
      case 'fromSketch':
        seeded = createFromSketchArrayDefaults('wizard-array', '', currentHoleSpec);
        break;
      case 'manual':
        seeded = createManualArrayDefaults('wizard-array', currentHoleSpec);
        break;
    }
    setArrayDef(seeded);
  }

  // ── C4 tap-class override (W4). When holeType=tap the user can flip
  // between '6H'/'6G' (ISO) or '2B'/'3B' (UTS). Empty = use the resolver's
  // default, which picks based on series.
  const [tapClassOverride, setTapClassOverride] = useState<'' | '6H' | '6G' | '2B' | '3B'>('');

  // ── W5 — pipe-tap class override. When holeType=pipeTap the user can flip
  // between NPT (tapered), NPSM (parallel), BSP taper, BSP parallel. Empty
  // = inherit from the resolver, which picks from series.
  const [pipeTapClassOverride, setPipeTapClassOverride] = useState<'' | NonNullable<PipeTapHoleSpec['pipeTapClass']>>('');

  // ── Termination tab state. ───────────────────────────────────────────────
  // We hold the termination + params separately from arrayDef so flipping
  // tabs doesn't reseed when the user comes back. The full HoleArrayDefinition
  // delivered to onApply merges these via the `effectiveDef` memo below.
  const [terminationKind, setTerminationKind] = useState<TerminationKind>('through');
  const [blindDepth, setBlindDepth] = useState<number>(10);
  const [blindBottomShape, setBlindBottomShape] = useState<BlindBottomShape>('conical');
  const [drillTipAngle, setDrillTipAngle] = useState<number>(DEFAULT_DRILL_TIP_ANGLE);

  // Derived HoleSpec from current Type + Size selection. Resolves from the
  // catalog row whenever Type / Size / Fit changes. Pure derivation — no extra
  // state to keep in sync. C4: apply tap-class override when applicable.
  const resolvedHoleSpec: HoleSpec = useMemo(() => {
    const base = resolveHoleSpec(
      WIZARD_TO_HOLEKIND[holeType],
      currentHoleSpec,
      selectedRow as Parameters<typeof resolveHoleSpec>[2],
    );
    if (base.kind === 'tap' && tapClassOverride !== '') {
      return { ...base, tapClass: tapClassOverride };
    }
    if (base.kind === 'pipe_tap' && pipeTapClassOverride !== '') {
      // Derive a taper angle from the chosen class — parallel classes get 0,
      // tapered classes inherit the 1°47′ default unless the resolver already
      // produced a different value.
      const taperAngle =
        pipeTapClassOverride === 'BSP_parallel' ||
        pipeTapClassOverride === 'NPSM'
          ? 0
          : base.taperAngle ?? 1.7833;
      return { ...base, pipeTapClass: pipeTapClassOverride, taperAngle };
    }
    return base;
  }, [holeType, selectedRow, currentHoleSpec, tapClassOverride, pipeTapClassOverride]);

  // Build the termination-params bag from the four-piece termination state.
  const terminationParams: TerminationParams = useMemo(() => {
    switch (terminationKind) {
      case 'blind':
        return {
          kind: 'blind',
          depth: blindDepth,
          bottomShape: blindBottomShape,
          drillTipAngle,
        };
      case 'through':
        return { kind: 'through' };
      case 'upToNext':
        return { kind: 'upToNext' };
      case 'upToFace':
        return { kind: 'upToFace', faceId: selectedFaceId?.trim() ?? '' };
    }
  }, [terminationKind, blindDepth, blindBottomShape, drillTipAngle, selectedFaceId]);

  // The "effective" def merges the current Size + Type + Termination selections
  // back into the position-tab def for validation + preview. arrayDef itself
  // only changes on Position-tab edits.
  const effectiveDef: HoleArrayDefinition = useMemo(() => ({
    ...arrayDef,
    axis: holeAxis,
    holeSpec: currentHoleSpec,
    holeSpecDetail: resolvedHoleSpec,
    terminationKind,
    terminationParams,
  }), [arrayDef, holeAxis, currentHoleSpec, resolvedHoleSpec, terminationKind, terminationParams]);

  // Sketch-point provider — when the modal's host supplies `availableSketches`
  // we hand them to `expandHoleArray` so the fromSketch position-mode shows
  // real point counts in the live preview. Without a provider the function
  // returns empty positions and the validator flags MISSING_SKETCH_POINTS.
  const sketchRegistry = useMemo<Record<string, SketchPointSnapshot[]>>(() => {
    if (!availableSketches) return {};
    const reg: Record<string, SketchPointSnapshot[]> = {};
    for (const s of availableSketches) reg[s.featureId] = s.points;
    return reg;
  }, [availableSketches]);

  // Live count of resolved positions — drives the "(N positions)" footer.
  const positions = useMemo(
    () =>
      expandHoleArray(effectiveDef, {
        resolveSketchPoints: (id) => sketchRegistry[id],
      }),
    [effectiveDef, sketchRegistry],
  );
  const validation = useMemo(() => validateHoleArray(effectiveDef), [effectiveDef]);

  // C4 — TAP_BOTTOM_RISK pure-logic check used by the Termination tab.
  const tapBottomRisk: TapBottomRiskFinding | null = useMemo(() => {
    return evaluateTapBottomRisk({
      kind: resolvedHoleSpec.kind,
      tapDepth: resolvedHoleSpec.kind === 'tap' ? resolvedHoleSpec.tapDepth : undefined,
      pitch: resolvedHoleSpec.kind === 'tap' ? resolvedHoleSpec.pitch : undefined,
      terminationKind,
      blindDepth: terminationKind === 'blind' ? blindDepth : undefined,
    });
  }, [resolvedHoleSpec, terminationKind, blindDepth]);

  if (!open) return null;

  // Flag-off rendering: emit a tiny placeholder so the parent's mount logic
  // sees the component is present (helps with test ergonomics) but no real
  // UI appears. Keeps V2 dark until the search-param flag is flipped.
  if (!flagOn) {
    return (
      <div data-testid="hole-wizard-v2-flag-off" style={{ display: 'none' }}>
        {t.flagOff}
      </div>
    );
  }

  const handleApply = () => {
    if (!validation.ok) return;
    // Hand off the effective definition (size + termination + position) — the
    // memoized merge already carries the resolved HoleSpec + TerminationParams.
    const applied = onApply(effectiveDef);
    if (applied === false) return;
    onClose();
  };

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '8px 12px',
    background: active ? 'var(--nx-accent)' : 'var(--nx-border-strong)',
    color: 'var(--nx-text)',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
  });

  const tileBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '10px 8px',
    background: active ? '#059669' : 'var(--nx-border-strong)',
    color: 'var(--nx-text)',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
  });

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    background: 'var(--nx-bg)',
    color: 'var(--nx-text)',
    border: '1px solid #374151',
    borderRadius: 4,
    marginTop: 4,
  };

  const kindLabels: Record<WizardHoleType, string> = {
    drilled: t.kindDrilled,
    counterbore: t.kindCbore,
    countersink: t.kindCsk,
    counterdrill: t.kindCdrill,
    tap: t.kindTap,
    pipeTap: t.kindPipeTap,
  };

  const positionKindLabels: Record<HoleArrayKind, string> = {
    linear: t.positionKindLinear,
    linear2D: t.positionKindLinear2D,
    circular: t.positionKindCircular,
    rect: t.positionKindRect,
    fromSketch: t.positionKindFromSketch,
    manual: t.positionKindManual,
  };

  return (
    <div
      data-testid="hole-wizard-v2-root"
      onClick={onClose}
      dir={rtl ? 'rtl' : 'ltr'}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--nx-panel)',
          color: 'var(--nx-text)',
          borderRadius: 10,
          padding: 20,
          width: 640,
          maxHeight: '85vh',
          overflowY: 'auto',
          border: '1px solid #374151',
          textAlign: rtl ? 'right' : 'left',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
            🕳️ {t.wizardTitle}
          </h2>
          <button
            onClick={onClose}
            data-testid="hole-wizard-v2-close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--nx-text-2)',
              fontSize: 20,
              cursor: 'pointer',
            }}
            aria-label={t.cancel}
          >
            ×
          </button>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }} role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'type'}
            data-testid="hole-wizard-v2-tab-type"
            onClick={() => setActiveTab('type')}
            style={tabBtnStyle(activeTab === 'type')}
          >
            {t.tabType}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'size'}
            data-testid="hole-wizard-v2-tab-size"
            onClick={() => setActiveTab('size')}
            style={tabBtnStyle(activeTab === 'size')}
          >
            {t.tabSize}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'position'}
            data-testid="hole-wizard-v2-tab-position"
            onClick={() => setActiveTab('position')}
            style={tabBtnStyle(activeTab === 'position')}
          >
            {t.tabPosition}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'termination'}
            data-testid="hole-wizard-v2-tab-termination"
            onClick={() => setActiveTab('termination')}
            style={tabBtnStyle(activeTab === 'termination')}
          >
            {t.tabTermination}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'preview'}
            data-testid="hole-wizard-v2-tab-preview"
            onClick={() => setActiveTab('preview')}
            style={tabBtnStyle(activeTab === 'preview')}
          >
            {t.tabPreview}
          </button>
        </div>

        {/* ── Tab: Type ─────────────────────────────────────────────────── */}
        {activeTab === 'type' && (
          <div data-testid="hole-wizard-v2-panel-type">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {WIZARD_HOLE_TYPES.map((k) => (
                <button
                  key={k}
                  data-testid={`hole-wizard-v2-type-${k}`}
                  onClick={() => {
                    setHoleType(k);
                    // Auto-flip series if the user picks Pipe Tap so the
                    // Size tab opens onto a sensible catalog.
                    const nextSeries = defaultSeriesFor(k);
                    if (nextSeries !== series) {
                      setSeries(nextSeries);
                      setDesignationIndex(0);
                    }
                  }}
                  style={tileBtnStyle(holeType === k)}
                >
                  {kindLabels[k]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Tab: Size ─────────────────────────────────────────────────── */}
        {activeTab === 'size' && (
          <div data-testid="hole-wizard-v2-panel-size">
            {/* Series picker */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
              {(Object.keys(HOLE_STANDARD_SERIES) as HoleStandardSeries[]).map((s) => (
                <button
                  key={s}
                  data-testid={`hole-wizard-v2-series-${s}`}
                  onClick={() => {
                    setSeries(s);
                    setDesignationIndex(0);
                  }}
                  style={{
                    padding: '6px 10px',
                    background: series === s ? 'var(--nx-accent)' : 'var(--nx-border-strong)',
                    color: 'var(--nx-text)',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            {/* Designation grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, marginBottom: 10 }}>
              {rows.map((row, i) => (
                <button
                  key={row.name}
                  data-testid={`hole-wizard-v2-designation-${row.name}`}
                  onClick={() => setDesignationIndex(i)}
                  style={tileBtnStyle(i === safeIndex)}
                >
                  {row.name}
                </button>
              ))}
            </div>
            {/* Fit class — only meaningful for clearance kinds */}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginBottom: 4 }}>
                {t.fitClassLabel}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['close', 'normal', 'loose'] as const).map((f) => (
                  <button
                    key={f}
                    data-testid={`hole-wizard-v2-fit-${f}`}
                    onClick={() => setFitClass(f)}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      background: fitClass === f ? '#0ea5e9' : 'var(--nx-border-strong)',
                      color: 'var(--nx-text)',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    {f === 'close' ? t.fitClose : f === 'normal' ? t.fitNormal : t.fitLoose}
                  </button>
                ))}
              </div>
            </div>
            {/* C4 — Tap class picker (visible only when holeType=tap). */}
            {holeType === 'tap' && (
              <div
                data-testid="hole-wizard-v2-tap-class-panel"
                style={{ marginTop: 8 }}
              >
                <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginBottom: 4 }}>
                  {t.tapClassLabel}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['6H', '6G', '2B', '3B'] as const).map((tc) => (
                    <button
                      key={tc}
                      data-testid={`hole-wizard-v2-tapclass-${tc}`}
                      onClick={() => setTapClassOverride(tc)}
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        background: tapClassOverride === tc ? '#0ea5e9' : 'var(--nx-border-strong)',
                        color: 'var(--nx-text)',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      {tc}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* W5 — Pipe-tap class picker (visible only when holeType=pipeTap). */}
            {holeType === 'pipeTap' && (
              <div
                data-testid="hole-wizard-v2-pipetap-class-panel"
                style={{ marginTop: 8 }}
              >
                <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginBottom: 4 }}>
                  {t.pipeTapClassLabel}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                  {(['NPT', 'NPSM', 'BSP_taper', 'BSP_parallel'] as const).map((pc) => {
                    const label =
                      pc === 'NPT' ? t.pipeTapClassNPT
                      : pc === 'NPSM' ? t.pipeTapClassNPSM
                      : pc === 'BSP_taper' ? t.pipeTapClassBSPTaper
                      : t.pipeTapClassBSPParallel;
                    return (
                      <button
                        key={pc}
                        data-testid={`hole-wizard-v2-pipetapclass-${pc}`}
                        onClick={() => setPipeTapClassOverride(pc)}
                        style={{
                          padding: '6px 4px',
                          background: pipeTapClassOverride === pc ? '#0ea5e9' : 'var(--nx-border-strong)',
                          color: 'var(--nx-text)',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                          fontSize: 11,
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Resolved row preview */}
            {selectedRow && (
              <div
                data-testid="hole-wizard-v2-size-preview"
                style={{
                  marginTop: 12,
                  padding: 10,
                  background: 'var(--nx-bg)',
                  border: '1px solid #374151',
                  borderRadius: 6,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: 'var(--nx-text)',
                }}
              >
                <div>name: <b>{selectedRow.name}</b></div>
                <div>nominal Ø: <b>{selectedRow.nominal} {selectedRow.unit}</b></div>
                <div>tap drill Ø: <b>{selectedRow.tapDrill.toFixed(2)} mm</b></div>
                {selectedRow.pitch !== undefined && (
                  <div>pitch: <b>{selectedRow.pitch} mm</b></div>
                )}
                {selectedRow.tpi !== undefined && (
                  <div>TPI: <b>{selectedRow.tpi}</b></div>
                )}
                {selectedRow.fits && (
                  <div>
                    fits — close {selectedRow.fits.close.toFixed(2)} / normal {selectedRow.fits.normal.toFixed(2)} / loose {selectedRow.fits.loose.toFixed(2)}
                  </div>
                )}
              </div>
            )}
            {/* === D6 THREADS BOUNDARY START === */}
            {(holeType === 'tap' || holeType === 'pipeTap') && (
              <HoleWizardThreadsSection lang={seg} hideKindToggle />
            )}
            {/* === D6 THREADS BOUNDARY END === */}
          </div>
        )}

        {/* ── Tab: Position ─────────────────────────────────────────────── */}
        {activeTab === 'position' && (
          <div data-testid="hole-wizard-v2-panel-position">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 12, color: 'var(--nx-text-2)' }}>
              Drill axis
              <select
                data-testid="hole-wizard-v2-axis"
                value={holeAxis}
                onChange={(e) => setHoleAxis(Number(e.target.value) as HoleAxis)}
                style={inputStyle}
              >
                <option value={1}>Y (top)</option>
                <option value={0}>X (side)</option>
                <option value={2}>Z (side)</option>
              </select>
            </label>
            {/* Position-kind picker */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4, marginBottom: 10 }}>
              {POSITION_KINDS.map((pk) => (
                <button
                  key={pk}
                  data-testid={`hole-wizard-v2-position-${pk}`}
                  onClick={() => changePositionKind(pk)}
                  style={tileBtnStyle(positionKind === pk)}
                >
                  {positionKindLabels[pk]}
                </button>
              ))}
            </div>

            {/* Kind-specific parameter inputs. */}
            <PositionKindEditor
              def={arrayDef}
              onChange={setArrayDef}
              labels={t}
              inputStyle={inputStyle}
              availableSketches={availableSketches}
            />
          </div>
        )}

        {/* ── Tab: Termination ──────────────────────────────────────────── */}
        {activeTab === 'termination' && (
          <div data-testid="hole-wizard-v2-panel-termination">
            {/* Mode picker — 4 tile buttons matching the 4 TerminationKind values. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 12 }}>
              {TERMINATION_KINDS.map((tk) => {
                const label =
                  tk === 'blind' ? t.termBlind
                  : tk === 'through' ? t.termThrough
                  : tk === 'upToNext' ? t.termUpToNext
                  : t.termUpToFace;
                return (
                  <button
                    key={tk}
                    data-testid={`hole-wizard-v2-termination-${tk}`}
                    onClick={() => setTerminationKind(tk)}
                    style={tileBtnStyle(terminationKind === tk)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* C4 — TAP_BOTTOM_RISK warning banner (only when blind+tap+too-close). */}
            {tapBottomRisk && terminationKind === 'blind' && (
              <div
                data-testid="hole-wizard-v2-tap-bottom-risk"
                style={{
                  padding: 8,
                  marginBottom: 8,
                  background: tapBottomRisk.severity === 'error' ? '#7f1d1d' : '#78350f',
                  color: '#fde68a',
                  border: '1px solid ' + (tapBottomRisk.severity === 'error' ? '#dc2626' : '#f59e0b'),
                  borderRadius: 6,
                  fontSize: 12,
                  fontFamily: 'monospace',
                }}
              >
                <div style={{ fontWeight: 600 }}>{t.tapBottomRiskTitle}</div>
                <div data-testid="hole-wizard-v2-tap-bottom-risk-message">
                  {tapBottomRisk.message}
                </div>
              </div>
            )}

            {/* Blind sub-panel — depth + bottom shape + tip angle. */}
            {terminationKind === 'blind' && (
              <div
                data-testid="hole-wizard-v2-termination-blind-detail"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}
              >
                <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
                  {t.termDepth}
                  <input
                    type="number"
                    data-testid="hole-wizard-v2-termination-depth"
                    min={0}
                    step={0.5}
                    value={blindDepth}
                    onChange={(e) => setBlindDepth(Number(e.target.value))}
                    style={inputStyle}
                  />
                </label>
                <div style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
                  {t.termBottomFlat} / {t.termBottomConical}
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {(['flat', 'conical'] as const).map((shape) => (
                      <button
                        key={shape}
                        data-testid={`hole-wizard-v2-termination-bottom-${shape}`}
                        onClick={() => setBlindBottomShape(shape)}
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          background: blindBottomShape === shape ? '#0ea5e9' : 'var(--nx-border-strong)',
                          color: 'var(--nx-text)',
                          border: 'none',
                          borderRadius: 4,
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        {shape === 'flat' ? t.termBottomFlat : t.termBottomConical}
                      </button>
                    ))}
                  </div>
                </div>
                {blindBottomShape === 'conical' && (
                  <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
                    {t.termDrillTipAngle}
                    <select
                      data-testid="hole-wizard-v2-termination-tipangle"
                      value={drillTipAngle}
                      onChange={(e) => setDrillTipAngle(Number(e.target.value))}
                      style={inputStyle}
                    >
                      <option value={60}>60°</option>
                      <option value={118}>118° (std)</option>
                      <option value={135}>135° (hard)</option>
                    </select>
                  </label>
                )}
              </div>
            )}

            {/* Through — no params, just an explanatory tag. */}
            {terminationKind === 'through' && (
              <div
                data-testid="hole-wizard-v2-termination-through-detail"
                style={{ fontSize: 12, color: 'var(--nx-text-2)', padding: 8 }}
              >
                {t.termThrough}: ⌀{resolvedHoleSpec.diameter} {/* passes entire body */}
              </div>
            )}

            {/* Up-to-next resolves the first material boundary automatically. */}
            {terminationKind === 'upToNext' && (
              <div
                data-testid="hole-wizard-v2-termination-upToNext-detail"
                style={{ padding: 8, fontSize: 11, color: 'var(--nx-text-2)' }}
              >
                {t.termUpToNext}
              </div>
            )}

            {/* Face selection is owned by the 3D viewport; the wizard receives
                and commits its stable topology id. */}
            {terminationKind === 'upToFace' && (
              <div
                data-testid="hole-wizard-v2-termination-upToFace-detail"
                style={{ padding: 8 }}
              >
                <button
                  data-testid="hole-wizard-v2-termination-upToFace-picker"
                  disabled
                  style={{
                    padding: '8px 12px',
                    background: 'var(--nx-border-strong)',
                    color: 'var(--nx-text-2)',
                    border: '1px dashed #4b5563',
                    borderRadius: 6,
                    cursor: 'default',
                    fontSize: 12,
                    opacity: selectedFaceId ? 1 : 0.6,
                  }}
                >
                  {selectedFaceId
                    ? `${t.termUpToFace}: ${selectedFaceId}`
                    : t.termFacePickerPlaceholder}
                </button>
                <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginTop: 6 }}>
                  {t.termFacePickerHint}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: Preview ──────────────────────────────────────────────── */}
        {activeTab === 'preview' && (
          <div data-testid="hole-wizard-v2-panel-preview">
            <PreviewPanel
              spec={resolvedHoleSpec}
              term={terminationParams}
              positionCount={positions.length}
              labels={t}
            />
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 16,
            gap: 8,
          }}
        >
          <div
            data-testid="hole-wizard-v2-count"
            style={{ fontSize: 12, color: 'var(--nx-text-2)' }}
          >
            {t.nPositions(positions.length)}
            {!validation.ok && (
              <span style={{ color: '#fbbf24', marginLeft: 8 }}>
                ⚠ {validation.errors.length}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              data-testid="hole-wizard-v2-cancel"
              style={{
                padding: '8px 14px',
                background: 'var(--nx-border-strong)',
                color: 'var(--nx-text)',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {t.cancel}
            </button>
            <button
              onClick={handleApply}
              disabled={!validation.ok || !selectedRow}
              data-testid="hole-wizard-v2-apply"
              style={{
                padding: '8px 14px',
                background: validation.ok && selectedRow ? 'var(--nx-accent)' : 'var(--nx-border-strong)',
                color: 'var(--nx-text)',
                border: 'none',
                borderRadius: 6,
                cursor: validation.ok && selectedRow ? 'pointer' : 'not-allowed',
                fontSize: 13,
                fontWeight: 600,
                opacity: validation.ok && selectedRow ? 1 : 0.6,
              }}
            >
              {t.addHoles}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Position-kind editor (kept inline; small enough not to need a file) ───

interface PositionKindEditorProps {
  def: HoleArrayDefinition;
  onChange: (next: HoleArrayDefinition) => void;
  labels: Dict;
  inputStyle: React.CSSProperties;
  availableSketches?: AvailableSketch[];
}

function PositionKindEditor({ def, onChange, labels, inputStyle, availableSketches }: PositionKindEditorProps) {
  // Helper: update the kind-specific data without losing the discriminator.
  function patch<K extends HoleArrayKind>(
    kind: K,
    data: Partial<Extract<HoleArrayDefinition['params'], { kind: K }>['data']>,
  ) {
    if (def.params.kind !== kind) return;
    onChange({
      ...def,
      params: {
        kind,
        // Runtime check above narrows the union; the cast below is the
        // narrowest possible signoff for the spread.
        data: { ...def.params.data, ...data },
      } as HoleArrayDefinition['params'],
    });
  }

  if (def.params.kind === 'linear') {
    const d = def.params.data;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fStartX}
          <input
            type="number"
            data-testid="hole-wizard-v2-linear-startX"
            value={d.startX}
            onChange={(e) => patch('linear', { startX: Number(e.target.value) })}
            style={inputStyle}
          />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fStartY}
          <input
            type="number"
            data-testid="hole-wizard-v2-linear-startY"
            value={d.startY}
            onChange={(e) => patch('linear', { startY: Number(e.target.value) })}
            style={inputStyle}
          />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fDx}
          <input
            type="number"
            data-testid="hole-wizard-v2-linear-dx"
            value={d.dx}
            onChange={(e) => patch('linear', { dx: Number(e.target.value) })}
            style={inputStyle}
          />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fDy}
          <input
            type="number"
            data-testid="hole-wizard-v2-linear-dy"
            value={d.dy}
            onChange={(e) => patch('linear', { dy: Number(e.target.value) })}
            style={inputStyle}
          />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fCount}
          <input
            type="number"
            data-testid="hole-wizard-v2-linear-count"
            min={1}
            step={1}
            value={d.count}
            onChange={(e) => patch('linear', { count: Number(e.target.value) })}
            style={inputStyle}
          />
        </label>
      </div>
    );
  }

  if (def.params.kind === 'circular') {
    const d = def.params.data;
    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
            {labels.fCenterX}
            <input type="number" data-testid="hole-wizard-v2-circular-centerX" value={d.centerX} onChange={(e) => patch('circular', { centerX: Number(e.target.value) })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
            {labels.fCenterY}
            <input type="number" data-testid="hole-wizard-v2-circular-centerY" value={d.centerY} onChange={(e) => patch('circular', { centerY: Number(e.target.value) })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
            {labels.fRadius}
            <input type="number" data-testid="hole-wizard-v2-circular-radius" value={d.radius} onChange={(e) => patch('circular', { radius: Number(e.target.value) })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
            {labels.fStartAngle}
            <input type="number" data-testid="hole-wizard-v2-circular-startAngle" value={d.startAngle} step={0.1} onChange={(e) => patch('circular', { startAngle: Number(e.target.value) })} style={inputStyle} />
          </label>
          <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
            {labels.fCount}
            <input type="number" data-testid="hole-wizard-v2-circular-count" min={1} step={1} value={d.count} onChange={(e) => patch('circular', { count: Number(e.target.value) })} style={inputStyle} />
          </label>
        </div>
        {/* W5 — partial-arc sweep + direction. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginTop: 8 }}>
          <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
            {labels.fPartialAngle}
            <input
              type="number"
              data-testid="hole-wizard-v2-circular-partialAngle"
              value={d.partialAngle ?? 0}
              min={0}
              max={360}
              step={5}
              onChange={(e) => {
                const v = Number(e.target.value);
                patch('circular', {
                  partialAngle: v <= 0 || v >= 360 ? undefined : v,
                });
              }}
              style={inputStyle}
            />
          </label>
          <div style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
            {labels.fDirection}
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              {(['ccw', 'cw'] as const).map((dir) => (
                <button
                  key={dir}
                  data-testid={`hole-wizard-v2-circular-direction-${dir}`}
                  type="button"
                  onClick={() => patch('circular', { direction: dir })}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    background: (d.direction ?? 'ccw') === dir ? '#0ea5e9' : 'var(--nx-border-strong)',
                    color: 'var(--nx-text)',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  {dir === 'ccw' ? labels.directionCcw : labels.directionCw}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (def.params.kind === 'linear2D') {
    const d = def.params.data;
    return (
      <div data-testid="hole-wizard-v2-linear2D-panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fStartX}
          <input type="number" data-testid="hole-wizard-v2-linear2D-startX" value={d.startX}
            onChange={(e) => patch('linear2D', { startX: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fStartY}
          <input type="number" data-testid="hole-wizard-v2-linear2D-startY" value={d.startY}
            onChange={(e) => patch('linear2D', { startY: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fRows}
          <input type="number" data-testid="hole-wizard-v2-linear2D-rows" min={1} step={1} value={d.rows}
            onChange={(e) => patch('linear2D', { rows: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fCols}
          <input type="number" data-testid="hole-wizard-v2-linear2D-cols" min={1} step={1} value={d.cols}
            onChange={(e) => patch('linear2D', { cols: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fDxRow}
          <input type="number" data-testid="hole-wizard-v2-linear2D-dxRow" value={d.dxRow}
            onChange={(e) => patch('linear2D', { dxRow: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fDyRow}
          <input type="number" data-testid="hole-wizard-v2-linear2D-dyRow" value={d.dyRow}
            onChange={(e) => patch('linear2D', { dyRow: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fDxCol}
          <input type="number" data-testid="hole-wizard-v2-linear2D-dxCol" value={d.dxCol}
            onChange={(e) => patch('linear2D', { dxCol: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fDyCol}
          <input type="number" data-testid="hole-wizard-v2-linear2D-dyCol" value={d.dyCol}
            onChange={(e) => patch('linear2D', { dyCol: Number(e.target.value) })} style={inputStyle} />
        </label>
      </div>
    );
  }

  if (def.params.kind === 'rect') {
    const d = def.params.data;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fStartX}
          <input type="number" data-testid="hole-wizard-v2-rect-startX" value={d.startX} onChange={(e) => patch('rect', { startX: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fStartY}
          <input type="number" data-testid="hole-wizard-v2-rect-startY" value={d.startY} onChange={(e) => patch('rect', { startY: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fStepX}
          <input type="number" data-testid="hole-wizard-v2-rect-stepX" value={d.stepX} onChange={(e) => patch('rect', { stepX: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fStepY}
          <input type="number" data-testid="hole-wizard-v2-rect-stepY" value={d.stepY} onChange={(e) => patch('rect', { stepY: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fRows}
          <input type="number" data-testid="hole-wizard-v2-rect-rows" min={1} step={1} value={d.rows} onChange={(e) => patch('rect', { rows: Number(e.target.value) })} style={inputStyle} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
          {labels.fCols}
          <input type="number" data-testid="hole-wizard-v2-rect-cols" min={1} step={1} value={d.cols} onChange={(e) => patch('rect', { cols: Number(e.target.value) })} style={inputStyle} />
        </label>
      </div>
    );
  }

  if (def.params.kind === 'fromSketch') {
    const d = def.params.data;
    const sketches = availableSketches ?? [];
    const selected = sketches.find((s) => s.featureId === d.sketchFeatureId);
    const bbox = selected ? pointListBoundingBox(selected.points) : null;
    return (
      <div data-testid="hole-wizard-v2-fromSketch-panel">
        {sketches.length === 0 ? (
          <div
            data-testid="hole-wizard-v2-fromSketch-empty"
            style={{
              padding: 10,
              background: 'var(--nx-bg)',
              border: '1px dashed #4b5563',
              borderRadius: 6,
              fontSize: 12,
              color: 'var(--nx-text-2)',
            }}
          >
            {labels.fromSketchEmpty}
          </div>
        ) : (
          <>
            <label style={{ fontSize: 11, color: 'var(--nx-text-2)', display: 'block' }}>
              {labels.fromSketchPick}
              <select
                data-testid="hole-wizard-v2-fromSketch-picker"
                value={d.sketchFeatureId}
                onChange={(e) => patch('fromSketch', { sketchFeatureId: e.target.value })}
                style={inputStyle}
              >
                <option value="">— —</option>
                {sketches.map((s) => (
                  <option key={s.featureId} value={s.featureId}>
                    {s.label} ({s.points.length})
                  </option>
                ))}
              </select>
            </label>
            <div
              data-testid="hole-wizard-v2-fromSketch-preview"
              style={{
                marginTop: 8,
                padding: 10,
                background: 'var(--nx-bg)',
                border: '1px solid #374151',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--nx-text)',
                fontFamily: 'monospace',
              }}
            >
              {selected ? (
                <>
                  <div data-testid="hole-wizard-v2-fromSketch-pointCount">
                    {labels.fromSketchPointCount(selected.points.length)}
                  </div>
                  {bbox && (
                    <div data-testid="hole-wizard-v2-fromSketch-bbox">
                      {labels.fromSketchBBox(bbox.width, bbox.height)}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--nx-text-2)', marginTop: 4 }}>
                    {labels.fromSketchSelectHint}
                  </div>
                </>
              ) : (
                <div style={{ color: 'var(--nx-text-2)' }}>
                  {labels.fromSketchSelectHint}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // Manual — render compact table + CSV-paste sub-mode (W5 — C5).
  if (def.params.kind === 'manual') {
    return (
      <ManualEditor
        def={def}
        labels={labels}
        inputStyle={inputStyle}
        onPatch={(points) => patch('manual', { points })}
      />
    );
  }

  // Exhaustive fallback — should be unreachable.
  return null;
}

// ─── Manual editor + CSV paste sub-mode (W5 — C5) ──────────────────────────

interface ManualEditorProps {
  def: Extract<HoleArrayDefinition, { kind: 'manual' }> | HoleArrayDefinition;
  labels: Dict;
  inputStyle: React.CSSProperties;
  onPatch: (points: Array<{ id?: string; x: number; y: number }>) => void;
}

function ManualEditor({ def, labels, inputStyle, onPatch }: ManualEditorProps) {
  const [subMode, setSubMode] = useState<'edit' | 'csv'>('edit');
  const [csvText, setCsvText] = useState('');
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);

  if (def.params.kind !== 'manual') return null;
  const d = def.params.data;

  const subModeBtnStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '6px 10px',
    background: active ? '#0ea5e9' : 'var(--nx-border-strong)',
    color: 'var(--nx-text)',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
  });

  return (
    <div data-testid="hole-wizard-v2-manual-panel">
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button
          data-testid="hole-wizard-v2-manual-submode-edit"
          type="button"
          onClick={() => setSubMode('edit')}
          style={subModeBtnStyle(subMode === 'edit')}
        >
          {labels.positionSubModeManualEdit}
        </button>
        <button
          data-testid="hole-wizard-v2-manual-submode-csv"
          type="button"
          onClick={() => setSubMode('csv')}
          style={subModeBtnStyle(subMode === 'csv')}
        >
          {labels.positionSubModeCsvPaste}
        </button>
      </div>

      {subMode === 'edit' && (
        <div data-testid="hole-wizard-v2-manual-table" style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {d.points.map((pt, i) => (
            <div key={pt.id ?? i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              <span style={{ minWidth: 24, color: 'var(--nx-text-2)' }}>#{i + 1}</span>
              <input
                type="number"
                data-testid={`hole-wizard-v2-manual-x-${i}`}
                value={pt.x}
                onChange={(e) => {
                  const next = [...d.points];
                  next[i] = { ...next[i], x: Number(e.target.value) };
                  onPatch(next);
                }}
                style={inputStyle}
              />
              <input
                type="number"
                data-testid={`hole-wizard-v2-manual-y-${i}`}
                value={pt.y}
                onChange={(e) => {
                  const next = [...d.points];
                  next[i] = { ...next[i], y: Number(e.target.value) };
                  onPatch(next);
                }}
                style={inputStyle}
              />
            </div>
          ))}
        </div>
      )}

      {subMode === 'csv' && (
        <div data-testid="hole-wizard-v2-csv-panel">
          <textarea
            data-testid="hole-wizard-v2-csv-textarea"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={labels.csvPlaceholder}
            rows={6}
            style={{
              ...inputStyle,
              fontFamily: 'monospace',
              fontSize: 12,
              minHeight: 110,
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button
              data-testid="hole-wizard-v2-csv-parse"
              type="button"
              onClick={() => setParsed(parseCsvPaste(csvText))}
              style={{
                padding: '6px 10px',
                background: 'var(--nx-border-strong)',
                color: 'var(--nx-text)',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {labels.csvParseBtn}
            </button>
            <button
              data-testid="hole-wizard-v2-csv-use"
              type="button"
              disabled={!parsed || parsed.points.length === 0}
              onClick={() => {
                if (!parsed) return;
                const manualPts = csvPointsToManualPoints(def.id, parsed.points);
                onPatch(manualPts);
                setSubMode('edit');
              }}
              style={{
                padding: '6px 10px',
                background:
                  parsed && parsed.points.length > 0
                    ? 'var(--nx-accent)'
                    : 'var(--nx-border-strong)',
                color: 'var(--nx-text)',
                border: 'none',
                borderRadius: 4,
                cursor:
                  parsed && parsed.points.length > 0 ? 'pointer' : 'not-allowed',
                fontSize: 12,
                opacity: parsed && parsed.points.length > 0 ? 1 : 0.6,
              }}
            >
              {labels.csvUseAsManualBtn}
            </button>
          </div>
          {parsed && (
            <div
              data-testid="hole-wizard-v2-csv-preview"
              style={{
                marginTop: 8,
                padding: 10,
                background: 'var(--nx-bg)',
                border: '1px solid #374151',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--nx-text)',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
              }}
            >
              <div data-testid="hole-wizard-v2-csv-parsed-count">
                {labels.csvParsedSummary(parsed.points.length)}
              </div>
              {parsed.bbox && (
                <div data-testid="hole-wizard-v2-csv-bbox">
                  {labels.csvBboxLine(
                    parsed.bbox.maxX - parsed.bbox.minX,
                    parsed.bbox.maxY - parsed.bbox.minY,
                  )}
                </div>
              )}
              <div data-testid="hole-wizard-v2-csv-delimiter">
                {labels.csvDelimiterLine(parsed.delimiter)}
              </div>
              {parsed.errors.length > 0 && (
                <div data-testid="hole-wizard-v2-csv-errors" style={{ marginTop: 6 }}>
                  <div style={{ color: '#fbbf24' }}>
                    {labels.csvErrorCount(parsed.errors.length)}
                  </div>
                  {parsed.errors.slice(0, 10).map((err, idx) => (
                    <div
                      key={idx}
                      data-testid={`hole-wizard-v2-csv-error-${idx}`}
                      style={{ color: '#fcd34d', fontSize: 11 }}
                    >
                      line {err.line}: {err.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Preview panel (Tab 5) ─────────────────────────────────────────────────

interface PreviewPanelProps {
  spec: HoleSpec;
  term: TerminationParams;
  positionCount: number;
  labels: Dict;
}

/**
 * Tab 5 — resolved-dimensions summary + 2D SVG cross-section. The SVG itself
 * is built by `computeHoleSectionSvg` (pure function); this component just
 * maps the primitive list onto SVG nodes.
 *
 * The summary block lists Drill ⌀, Counterbore ⌀×depth (if applicable),
 * Countersink ⌀ + angle (if applicable), Termination, and Position count —
 * matching the layout in spec §6.1.5.
 */
function PreviewPanel({ spec, term, positionCount, labels }: PreviewPanelProps) {
  const svg = useMemo(() => computeHoleSectionSvg(spec, term), [spec, term]);

  const summaryRows: Array<{ label: string; value: string }> = [
    { label: labels.prevDiameter, value: `Ø${spec.diameter} mm` },
  ];
  if (spec.kind === 'counterbore' || spec.kind === 'counterdrill') {
    summaryRows.push({
      label: labels.prevHeadDiameter,
      value: `Ø${spec.headDiameter} mm`,
    });
    summaryRows.push({
      label: labels.prevHeadDepth,
      value: `${spec.headDepth} mm`,
    });
  }
  if (spec.kind === 'countersink') {
    summaryRows.push({
      label: labels.prevConeDiameter,
      value: `Ø${spec.coneDiameter} mm`,
    });
    summaryRows.push({
      label: labels.prevConeAngle,
      value: `${spec.coneAngle}°`,
    });
  }
  if (spec.kind === 'counterdrill') {
    summaryRows.push({
      label: labels.prevMiddleDiameter,
      value: `Ø${spec.middleDiameter} mm`,
    });
    summaryRows.push({
      label: labels.prevMiddleDepth,
      value: `${spec.middleDepth} mm`,
    });
  }
  if (spec.kind === 'tap') {
    summaryRows.push({
      label: labels.prevPitch,
      value: `${spec.pitch} mm`,
    });
    summaryRows.push({
      label: labels.tapClassLabel,
      value: spec.tapClass,
    });
    summaryRows.push({
      label: labels.prevTapDepth,
      value: `${spec.tapDepth} mm`,
    });
  }
  if (spec.kind === 'pipe_tap') {
    summaryRows.push({
      label: labels.prevPipeStandard,
      value: spec.pipeStandard,
    });
    summaryRows.push({
      label: labels.prevPipeSizeKey,
      value: spec.pipeSizeKey,
    });
    summaryRows.push({
      label: labels.prevEngagementDepth,
      value: `${spec.engagementDepth} mm`,
    });
    if (spec.pipeTapClass) {
      summaryRows.push({
        label: labels.prevPipeTapClass,
        value: spec.pipeTapClass,
      });
    }
    if (spec.taperAngle !== undefined) {
      summaryRows.push({
        label: labels.prevTaperAngle,
        value: `${spec.taperAngle}°`,
      });
    }
  }
  summaryRows.push({
    label: labels.tabTermination,
    value:
      term.kind === 'blind'
        ? `${labels.termBlind} ${term.depth} mm`
        : term.kind === 'through'
          ? labels.termThrough
          : term.kind === 'upToNext'
            ? labels.termUpToNext
            : labels.termUpToFace,
  });
  summaryRows.push({
    label: labels.prevPositions,
    value: String(positionCount),
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      {/* Summary table */}
      <div data-testid="hole-wizard-v2-preview-summary">
        <div style={{ fontSize: 12, color: 'var(--nx-text-2)', marginBottom: 6 }}>
          {labels.prevHeader}
        </div>
        <div
          style={{
            background: 'var(--nx-bg)',
            border: '1px solid #374151',
            borderRadius: 6,
            padding: 10,
            fontFamily: 'monospace',
            fontSize: 12,
            color: 'var(--nx-text)',
          }}
        >
          {summaryRows.map((row) => (
            <div
              key={row.label}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}
            >
              <span>{row.label}</span>
              <b>{row.value}</b>
            </div>
          ))}
        </div>
      </div>

      {/* SVG cross-section */}
      <div data-testid="hole-wizard-v2-preview-svg-container">
        <svg
          data-testid="hole-wizard-v2-preview-svg"
          width={svg.layout.width}
          height={svg.layout.height}
          viewBox={`0 0 ${svg.layout.width} ${svg.layout.height}`}
          style={{
            background: 'var(--nx-bg)',
            border: '1px solid #374151',
            borderRadius: 6,
          }}
        >
          {svg.elements.map((el, i) => renderSvgEl(el, i))}
        </svg>
      </div>
    </div>
  );
}

/** Map a single primitive onto its SVG node. Pure render helper. */
function renderSvgEl(el: SvgElement, key: number): React.ReactNode {
  if (el.kind === 'line') {
    const isCenterline = el.className === 'centerline';
    const isDim = el.className === 'dim';
    const isThread = el.className === 'thread-indicator';
    const stroke = isCenterline
      ? '#6b7280'
      : isDim
        ? '#9ca3af'
        : el.className === 'part-edge'
          ? '#94a3b8'
          : isThread
            ? '#0ea5e9'
            : '#22d3ee';
    return (
      <line
        key={key}
        x1={el.x1}
        y1={el.y1}
        x2={el.x2}
        y2={el.y2}
        stroke={stroke}
        strokeWidth={isCenterline ? 0.75 : 1.25}
        strokeDasharray={isCenterline ? '3 2' : el.dashed || isThread ? '2 2' : undefined}
      />
    );
  }
  if (el.kind === 'polyline') {
    const pts = el.points.map((p) => `${p.x},${p.y}`).join(' ');
    return (
      <polyline
        key={key}
        points={pts}
        fill="none"
        stroke="#22d3ee"
        strokeWidth={1.25}
      />
    );
  }
  // label
  return (
    <text
      key={key}
      x={el.x}
      y={el.y}
      textAnchor={el.anchor}
      fontSize={10}
      fill={el.className === 'dim' ? '#cbd5e1' : '#e5e7eb'}
      fontFamily="monospace"
    >
      {el.text}
    </text>
  );
}
