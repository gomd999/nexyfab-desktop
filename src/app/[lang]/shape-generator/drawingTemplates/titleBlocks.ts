/**
 * titleBlocks.ts — Standard drawing title-block library.
 *
 * Engineering drawings carry a title block in the lower-right corner
 * with company, part number, sheet number, scale, revision, signed-by,
 * material, weight, etc. The exact layout is regulated by standards:
 *
 *   - **ISO 7200** (international) — rich, multi-row
 *   - **ASME Y14.100** (US) — slightly different cell ordering
 *   - **DIN 6771** (German) — historical, still used in EU heavy industry
 *   - **JIS Z 8311** (Japan) — similar to ISO with metric variants
 *   - **GB/T 10609.1** (China) — Chinese national standard
 *   - **KS A 0106** (Korea) — Korean standard, close to ISO
 *   - **Custom** — user-defined per company
 *
 * Each preset specifies sheet sizes (A0..A4, ANSI A..E) and the title
 * block cell layout (label + position). Renderers draw to an SVG/PDF
 * page using these specs.
 */

export type DrawingStandard = 'ISO_7200' | 'ASME_Y14_100' | 'DIN_6771' | 'JIS_Z_8311' | 'GB_T_10609' | 'KS_A_0106' | 'custom';

export type SheetSize =
  | 'A0' | 'A1' | 'A2' | 'A3' | 'A4'
  | 'ANSI_A' | 'ANSI_B' | 'ANSI_C' | 'ANSI_D' | 'ANSI_E';

export const SHEET_SIZES_MM: Record<SheetSize, { width: number; height: number }> = {
  A0: { width: 1189, height: 841 },
  A1: { width: 841,  height: 594 },
  A2: { width: 594,  height: 420 },
  A3: { width: 420,  height: 297 },
  A4: { width: 297,  height: 210 },
  ANSI_A: { width: 279, height: 216 }, // 11 × 8.5"
  ANSI_B: { width: 432, height: 279 }, // 17 × 11"
  ANSI_C: { width: 559, height: 432 }, // 22 × 17"
  ANSI_D: { width: 864, height: 559 }, // 34 × 22"
  ANSI_E: { width: 1118, height: 864 },// 44 × 34"
};

export interface TitleBlockCell {
  /** Field key (rendered as label or filled with value). */
  key: string;
  /** Display label. */
  label: string;
  /** Position (mm) from title-block lower-right origin, x going left, y going up. */
  positionMm: { x: number; y: number };
  widthMm: number;
  heightMm: number;
  /** Default value template (caller fills). */
  defaultValue?: string;
  fontSizePt?: number;
  bold?: boolean;
}

export interface TitleBlockSpec {
  standard: DrawingStandard;
  name: string;
  /** Total title block extent (mm). */
  widthMm: number;
  heightMm: number;
  cells: TitleBlockCell[];
}

/** ISO 7200 standard (170 × 70 mm). */
export const ISO_7200: TitleBlockSpec = {
  standard: 'ISO_7200',
  name: 'ISO 7200 Standard',
  widthMm: 170,
  heightMm: 70,
  cells: [
    { key: 'title',        label: 'Title',              positionMm: { x: 170, y: 50 }, widthMm: 100, heightMm: 20, fontSizePt: 14, bold: true },
    { key: 'partNumber',   label: 'Document No.',       positionMm: { x: 170, y: 30 }, widthMm:  70, heightMm: 10 },
    { key: 'revision',     label: 'Rev.',               positionMm: { x:  90, y: 30 }, widthMm:  20, heightMm: 10 },
    { key: 'sheet',        label: 'Sheet',              positionMm: { x:  60, y: 30 }, widthMm:  30, heightMm: 10 },
    { key: 'scale',        label: 'Scale',              positionMm: { x:  30, y: 30 }, widthMm:  30, heightMm: 10 },
    { key: 'date',         label: 'Date',               positionMm: { x: 170, y: 20 }, widthMm:  40, heightMm: 10 },
    { key: 'drawnBy',      label: 'Drawn',              positionMm: { x: 130, y: 20 }, widthMm:  40, heightMm: 10 },
    { key: 'approvedBy',   label: 'Approved',           positionMm: { x:  90, y: 20 }, widthMm:  40, heightMm: 10 },
    { key: 'company',      label: 'Company',            positionMm: { x:  50, y: 20 }, widthMm:  40, heightMm: 10 },
    { key: 'material',     label: 'Material',           positionMm: { x: 170, y: 10 }, widthMm:  85, heightMm: 10 },
    { key: 'weightKg',     label: 'Weight (kg)',        positionMm: { x:  85, y: 10 }, widthMm:  40, heightMm: 10 },
    { key: 'projection',   label: 'Projection',         positionMm: { x:  45, y: 10 }, widthMm:  45, heightMm: 10, defaultValue: 'first-angle' },
  ],
};

/** ASME Y14.100 standard (160 × 76 mm typical). */
export const ASME_Y14_100: TitleBlockSpec = {
  standard: 'ASME_Y14_100',
  name: 'ASME Y14.100 Standard',
  widthMm: 160,
  heightMm: 76,
  cells: [
    { key: 'title',        label: 'TITLE',                  positionMm: { x: 160, y: 60 }, widthMm: 90, heightMm: 16, fontSizePt: 14, bold: true },
    { key: 'cageCode',     label: 'CAGE CODE',              positionMm: { x:  70, y: 60 }, widthMm: 30, heightMm: 16 },
    { key: 'partNumber',   label: 'DRAWING NUMBER',         positionMm: { x: 160, y: 44 }, widthMm: 90, heightMm: 16 },
    { key: 'revision',     label: 'REV',                    positionMm: { x:  70, y: 44 }, widthMm: 30, heightMm: 16 },
    { key: 'scale',        label: 'SCALE',                  positionMm: { x: 160, y: 28 }, widthMm: 30, heightMm: 16 },
    { key: 'sheet',        label: 'SHEET',                  positionMm: { x: 130, y: 28 }, widthMm: 30, heightMm: 16 },
    { key: 'tolerance',    label: 'TOLERANCES UNLESS NOTED', positionMm: { x: 160, y: 12 }, widthMm: 90, heightMm: 16 },
    { key: 'projection',   label: 'PROJECTION',             positionMm: { x:  70, y: 12 }, widthMm: 30, heightMm: 16, defaultValue: 'third-angle' },
  ],
};

/** KS A 0106 — 한국산업표준 (170 × 56 mm). */
export const KS_A_0106: TitleBlockSpec = {
  standard: 'KS_A_0106',
  name: 'KS A 0106 한국산업표준',
  widthMm: 170,
  heightMm: 56,
  cells: [
    { key: 'title',       label: '도면명',     positionMm: { x: 170, y: 42 }, widthMm: 100, heightMm: 14, fontSizePt: 14, bold: true },
    { key: 'partNumber',  label: '도번',       positionMm: { x:  70, y: 42 }, widthMm:  70, heightMm: 14 },
    { key: 'scale',       label: '척도',       positionMm: { x: 170, y: 28 }, widthMm:  30, heightMm: 14 },
    { key: 'projection',  label: '투상법',     positionMm: { x: 140, y: 28 }, widthMm:  30, heightMm: 14, defaultValue: '제3각법' },
    { key: 'unit',        label: '단위',       positionMm: { x: 110, y: 28 }, widthMm:  30, heightMm: 14, defaultValue: 'mm' },
    { key: 'material',    label: '재질',       positionMm: { x:  70, y: 28 }, widthMm:  40, heightMm: 14 },
    { key: 'drawnBy',     label: '작도',       positionMm: { x: 170, y: 14 }, widthMm:  40, heightMm: 14 },
    { key: 'approvedBy',  label: '승인',       positionMm: { x: 130, y: 14 }, widthMm:  40, heightMm: 14 },
    { key: 'date',        label: '날짜',       positionMm: { x:  90, y: 14 }, widthMm:  40, heightMm: 14 },
    { key: 'revision',    label: '개정',       positionMm: { x:  50, y: 14 }, widthMm:  20, heightMm: 14 },
  ],
};

/** JIS Z 8311 — 日本産業規格. */
export const JIS_Z_8311: TitleBlockSpec = {
  standard: 'JIS_Z_8311',
  name: 'JIS Z 8311 日本産業規格',
  widthMm: 170,
  heightMm: 56,
  cells: [
    { key: 'title',      label: '図面名称',  positionMm: { x: 170, y: 42 }, widthMm: 100, heightMm: 14, fontSizePt: 14, bold: true },
    { key: 'partNumber', label: '図番',      positionMm: { x:  70, y: 42 }, widthMm:  70, heightMm: 14 },
    { key: 'scale',      label: '尺度',      positionMm: { x: 170, y: 28 }, widthMm:  40, heightMm: 14 },
    { key: 'projection', label: '投影法',    positionMm: { x: 130, y: 28 }, widthMm:  40, heightMm: 14, defaultValue: '第三角法' },
    { key: 'material',   label: '材質',      positionMm: { x:  90, y: 28 }, widthMm:  50, heightMm: 14 },
    { key: 'drawnBy',    label: '製図',      positionMm: { x: 170, y: 14 }, widthMm:  50, heightMm: 14 },
    { key: 'approvedBy', label: '承認',      positionMm: { x: 120, y: 14 }, widthMm:  50, heightMm: 14 },
    { key: 'date',       label: '日付',      positionMm: { x:  70, y: 14 }, widthMm:  50, heightMm: 14 },
  ],
};

/** GB/T 10609.1 — 中华人民共和国国家标准. */
export const GB_T_10609: TitleBlockSpec = {
  standard: 'GB_T_10609',
  name: 'GB/T 10609.1 国家标准',
  widthMm: 180,
  heightMm: 56,
  cells: [
    { key: 'title',      label: '图样名称',  positionMm: { x: 180, y: 42 }, widthMm: 110, heightMm: 14, fontSizePt: 14, bold: true },
    { key: 'partNumber', label: '图号',      positionMm: { x:  70, y: 42 }, widthMm:  70, heightMm: 14 },
    { key: 'scale',      label: '比例',      positionMm: { x: 180, y: 28 }, widthMm:  35, heightMm: 14 },
    { key: 'unit',       label: '单位',      positionMm: { x: 145, y: 28 }, widthMm:  35, heightMm: 14, defaultValue: 'mm' },
    { key: 'material',   label: '材料',      positionMm: { x: 110, y: 28 }, widthMm:  35, heightMm: 14 },
    { key: 'weight',     label: '重量',      positionMm: { x:  75, y: 28 }, widthMm:  35, heightMm: 14 },
    { key: 'drawnBy',    label: '制图',      positionMm: { x: 180, y: 14 }, widthMm:  45, heightMm: 14 },
    { key: 'approvedBy', label: '审核',      positionMm: { x: 135, y: 14 }, widthMm:  45, heightMm: 14 },
    { key: 'date',       label: '日期',      positionMm: { x:  90, y: 14 }, widthMm:  45, heightMm: 14 },
  ],
};

export const TITLE_BLOCK_REGISTRY: Record<DrawingStandard, TitleBlockSpec | null> = {
  ISO_7200: ISO_7200,
  ASME_Y14_100: ASME_Y14_100,
  KS_A_0106: KS_A_0106,
  JIS_Z_8311: JIS_Z_8311,
  GB_T_10609: GB_T_10609,
  DIN_6771: null,
  custom: null,
};

/** Render-ready position: caller draws each cell anchored from the
 *  sheet's lower-right corner (sheet width, sheet height in mm). */
export function placeTitleBlock(
  spec: TitleBlockSpec,
  sheetSize: SheetSize,
  marginMm: number = 10,
): { absoluteCells: Array<TitleBlockCell & { absX: number; absY: number }> } {
  const sheet = SHEET_SIZES_MM[sheetSize];
  // Title-block origin (lower-right corner inside the margin).
  const originX = sheet.width - marginMm;
  const originY = marginMm;
  return {
    absoluteCells: spec.cells.map(c => ({
      ...c,
      absX: originX - c.positionMm.x,
      absY: originY + c.positionMm.y,
    })),
  };
}

/** Fill in a title block's cells from a values map; missing keys keep
 *  the cell's defaultValue (or empty). */
export interface TitleBlockValues {
  title?: string;
  partNumber?: string;
  revision?: string;
  sheet?: string;
  scale?: string;
  date?: string;
  drawnBy?: string;
  approvedBy?: string;
  company?: string;
  material?: string;
  weightKg?: string;
  projection?: string;
  unit?: string;
  cageCode?: string;
  tolerance?: string;
  weight?: string;
  [k: string]: string | undefined;
}

export function fillTitleBlock(spec: TitleBlockSpec, values: TitleBlockValues): Array<TitleBlockCell & { value: string }> {
  return spec.cells.map(c => ({
    ...c,
    value: values[c.key] ?? c.defaultValue ?? '',
  }));
}

export function listTitleBlocks(): TitleBlockSpec[] {
  return Object.values(TITLE_BLOCK_REGISTRY).filter((s): s is TitleBlockSpec => s !== null);
}
