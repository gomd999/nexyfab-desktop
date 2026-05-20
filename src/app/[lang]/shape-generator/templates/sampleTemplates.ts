/**
 * sampleTemplates.ts — Starter templates for new users.
 *
 * Goal (Phase 2 sprint): get a new user from signup to first STL
 * download in under 5 minutes. The blocker is the blank canvas —
 * users don't know which feature to add first. Templates remove
 * that blocker.
 *
 * Each template is a serialised `FeatureInstance[]` that the
 * pipeline can load directly. Templates intentionally use only the
 * feature types that beginners can modify visually: sketchExtrude,
 * fillet, chamfer, hole. No assemblies, no sheet metal complexity.
 *
 * Idea-to-startup users (per memory `nexyfab-gtm`) typically need:
 *   - bracket (1인 HW 시제품)
 *   - enclosure (전자 박스)
 *   - box (기본 형상)
 *   - disk (모터 / 기어 시제품)
 *   - rod (샤프트 / 핀)
 *
 * Each template surfaces 2-3 dimensions the user can tweak in the
 * feature tree — enough to feel parametric, not so many that they
 * get lost.
 */

import type { FeatureInstance } from '../features/types';
import type { SketchProfile, SketchConfig } from '../sketch/types';

export type SampleTemplateId = 'bracket' | 'enclosure' | 'box' | 'disk' | 'rod';

export interface SampleTemplate {
  id: SampleTemplateId;
  /** Display name per language. */
  nameKo: string;
  nameEn: string;
  nameJa: string;
  /** Short description shown in the picker card. */
  descKo: string;
  descEn: string;
  descJa: string;
  /** Tags for filtering ("sheet-metal", "rotational", etc). */
  tags: string[];
  /** Estimated time-to-first-export when starting from this template (min). */
  timeToExportMin: number;
  /** Build the initial pipeline. */
  build: () => FeatureInstance[];
}

const baseSketchConfig = (depth = 10): SketchConfig => ({
  mode: 'extrude',
  depth,
  revolveAngle: 360,
  revolveAxis: 'y',
  segments: 32,
});

function rectProfile(width: number, height: number): SketchProfile {
  const w = width / 2;
  const h = height / 2;
  return {
    closed: true,
    segments: [
      { type: 'rect', points: [{ x: -w, y: -h }, { x: w, y: h }] },
    ],
  };
}

function circleProfile(radius: number): SketchProfile {
  return {
    closed: true,
    segments: [
      { type: 'circle', points: [{ x: 0, y: 0 }, { x: radius, y: 0 }] },
    ],
  };
}

function rectWithHolesProfile(
  width: number, height: number, holes: Array<{ cx: number; cy: number; r: number }>,
): SketchProfile {
  // The first segment is the outer rect; remaining circles represent holes
  // when the sketcher renders profile[0] as outer + others as inner.
  const w = width / 2;
  const h = height / 2;
  return {
    closed: true,
    segments: [
      { type: 'rect', points: [{ x: -w, y: -h }, { x: w, y: h }] },
      ...holes.map(hole => ({
        type: 'circle' as const,
        points: [{ x: hole.cx, y: hole.cy }, { x: hole.cx + hole.r, y: hole.cy }],
      })),
    ],
  };
}

/** Bracket — L-shaped mounting bracket with 4 corner holes. */
function buildBracket(): FeatureInstance[] {
  return [
    {
      id: 'feat_bracket_base',
      type: 'sketchExtrude',
      params: {},
      enabled: true,
      sketchData: {
        profile: rectWithHolesProfile(60, 40, [
          { cx: -22, cy: -12, r: 3 },
          { cx:  22, cy: -12, r: 3 },
          { cx: -22, cy:  12, r: 3 },
          { cx:  22, cy:  12, r: 3 },
        ]),
        config: baseSketchConfig(3),
        plane: 'xy',
        planeOffset: 0,
        operation: 'add',
      },
    },
    {
      id: 'feat_bracket_fillet',
      type: 'fillet',
      params: { radius: 2, segments: 2, engine: 1 },
      enabled: true,
    },
  ];
}

/** Enclosure — hollow box with screw flange. */
function buildEnclosure(): FeatureInstance[] {
  return [
    {
      id: 'feat_enclosure_outer',
      type: 'sketchExtrude',
      params: {},
      enabled: true,
      sketchData: {
        profile: rectProfile(80, 60),
        config: baseSketchConfig(30),
        plane: 'xy',
        planeOffset: 0,
        operation: 'add',
      },
    },
    {
      id: 'feat_enclosure_shell',
      type: 'shell',
      params: { thickness: 2 },
      enabled: true,
    },
    {
      id: 'feat_enclosure_fillet',
      type: 'fillet',
      params: { radius: 3, segments: 2, engine: 1 },
      enabled: true,
    },
  ];
}

/** Box — simple parametric rounded box. */
function buildBox(): FeatureInstance[] {
  return [
    {
      id: 'feat_box_base',
      type: 'sketchExtrude',
      params: {},
      enabled: true,
      sketchData: {
        profile: rectProfile(50, 40),
        config: baseSketchConfig(20),
        plane: 'xy',
        planeOffset: 0,
        operation: 'add',
      },
    },
    {
      id: 'feat_box_fillet',
      type: 'fillet',
      params: { radius: 4, segments: 3, engine: 1 },
      enabled: true,
    },
  ];
}

/** Disk — cylindrical disk with central bore + chamfered edge. */
function buildDisk(): FeatureInstance[] {
  return [
    {
      id: 'feat_disk_base',
      type: 'sketchExtrude',
      params: {},
      enabled: true,
      sketchData: {
        profile: {
          closed: true,
          segments: [
            { type: 'circle', points: [{ x: 0, y: 0 }, { x: 25, y: 0 }] },
            { type: 'circle', points: [{ x: 0, y: 0 }, { x: 6, y: 0 }] }, // bore
          ],
        },
        config: baseSketchConfig(8),
        plane: 'xy',
        planeOffset: 0,
        operation: 'add',
      },
    },
    {
      id: 'feat_disk_chamfer',
      type: 'chamfer',
      params: { distance: 1, engine: 1 },
      enabled: true,
    },
  ];
}

/** Rod — cylindrical shaft with chamfered ends. */
function buildRod(): FeatureInstance[] {
  return [
    {
      id: 'feat_rod_base',
      type: 'sketchExtrude',
      params: {},
      enabled: true,
      sketchData: {
        profile: circleProfile(8),
        config: baseSketchConfig(80),
        plane: 'xy',
        planeOffset: 0,
        operation: 'add',
      },
    },
    {
      id: 'feat_rod_chamfer',
      type: 'chamfer',
      params: { distance: 1.5, engine: 1 },
      enabled: true,
    },
  ];
}

export const SAMPLE_TEMPLATES: SampleTemplate[] = [
  {
    id: 'bracket',
    nameKo: '브래킷',
    nameEn: 'Bracket',
    nameJa: 'ブラケット',
    descKo: '4-홀 직사각 브래킷. 시제품 / 마운트 부품.',
    descEn: 'Four-hole rectangular mounting bracket.',
    descJa: '4ホール矩形ブラケット。試作・マウント部品用。',
    tags: ['mounting', 'sheet-metal-like', 'prototype'],
    timeToExportMin: 1,
    build: buildBracket,
  },
  {
    id: 'enclosure',
    nameKo: '인클로저',
    nameEn: 'Enclosure',
    nameJa: 'エンクロージャー',
    descKo: '속이 빈 박스 + 라운드 모서리. 전자 부품 케이스.',
    descEn: 'Hollow box with rounded corners — electronics case.',
    descJa: '中空ボックス＋丸み付き角部。電子部品ケース。',
    tags: ['hollow', 'electronics', 'enclosure'],
    timeToExportMin: 2,
    build: buildEnclosure,
  },
  {
    id: 'box',
    nameKo: '박스',
    nameEn: 'Rounded Box',
    nameJa: 'ボックス',
    descKo: '라운드 모서리 솔리드 박스. 가장 단순한 형상.',
    descEn: 'Solid box with rounded corners — simplest part.',
    descJa: '丸み付き角の中実ボックス。最もシンプル。',
    tags: ['solid', 'basic'],
    timeToExportMin: 1,
    build: buildBox,
  },
  {
    id: 'disk',
    nameKo: '디스크',
    nameEn: 'Disk',
    nameJa: 'ディスク',
    descKo: '중심 홀 있는 원반. 모터 / 기어 베이스.',
    descEn: 'Disk with central bore — motor / gear base.',
    descJa: '中心穴付きディスク。モーター/ギア用ベース。',
    tags: ['rotational', 'mechanical'],
    timeToExportMin: 1,
    build: buildDisk,
  },
  {
    id: 'rod',
    nameKo: '막대 / 샤프트',
    nameEn: 'Rod / Shaft',
    nameJa: 'ロッド / シャフト',
    descKo: '챔퍼 모서리 원통. 핀 / 샤프트 / 스페이서.',
    descEn: 'Chamfered cylinder — pin, shaft, spacer.',
    descJa: '面取り円柱。ピン/シャフト/スペーサー。',
    tags: ['rotational', 'shaft'],
    timeToExportMin: 1,
    build: buildRod,
  },
];

export function getSampleTemplate(id: SampleTemplateId): SampleTemplate | null {
  return SAMPLE_TEMPLATES.find(t => t.id === id) ?? null;
}
