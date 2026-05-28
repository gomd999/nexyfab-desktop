/**
 * referenceGeometry/i18n.ts — 6-language string table for the ref-geom UI.
 *
 * Wave 2 Phase 2 Track D Week 4. Spec §13.4 (Korean canonical strings).
 *
 * Why a self-contained dict (not the global i18n CSV):
 *
 *   - The repo doesn't yet have a centralised i18n CSV for the shape-generator
 *     route — every panel (`CostCopilotPanel`, `DFMPanel`, …) ships its own
 *     `const dict: Record<Lang, …>`. Mirroring that pattern keeps the W4
 *     change additive and avoids cross-cutting i18n plumbing.
 *   - The Wave 3 i18n pass (per project policy) will collect these into the
 *     shared CSV; until then the strings live next to the code that uses
 *     them.
 *
 * Six-lang per project standard: ko / en / ja / zh / es / ar. Phase 2 ships
 * ko + en complete; the other four use English fallbacks for any string the
 * Wave 3 translation pass hasn't filled yet (spec §13.4 — "ships ko/en only
 * and queues the rest behind the existing admin-i18n backlog"). Consumers
 * call `pickRefGeomDict(lang)` to get a fully-populated dict regardless of
 * the requested language, so call-sites never need a fallback guard.
 *
 * Korean CAD terminology — sourced from KS B 0001 (mechanical drawing) and
 * the SolidWorks Korean localisation: 기준 평면 / 기준 축 / 기준 점 / 좌표계.
 */

export type RefGeomLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export interface RefGeomDict {
  // ─── Top-level group label (tree section + toolbar) ────────────
  /** Tree section header + toolbar dropdown trigger. */
  readonly groupLabel: string;
  /** Empty-state copy in the tree section. */
  readonly emptyLabel: string;

  // ─── Kind labels ───────────────────────────────────────────────
  readonly kindPlane: string;
  readonly kindAxis: string;
  readonly kindPoint: string;
  readonly kindCsys: string;

  // ─── Dialog titles ─────────────────────────────────────────────
  readonly dialogTitlePlane: string;
  readonly dialogTitleAxis: string;
  readonly dialogTitlePoint: string;
  readonly dialogTitleCsys: string;

  // ─── Dialog actions ────────────────────────────────────────────
  readonly insert: string;
  readonly cancel: string;
  readonly close: string;

  // ─── Plane methods (spec §13.4) ────────────────────────────────
  readonly planeStandard: string;
  readonly planeOffset: string;
  readonly planeAngle: string;
  readonly planeThrough3Points: string;
  readonly planeParallelThroughPoint: string;
  readonly planeMidBetween: string;
  readonly planeThroughLineAndPoint: string;
  readonly planeTangentToCylinder: string;

  // ─── Axis methods ──────────────────────────────────────────────
  readonly axisStandard: string;
  readonly axisThrough2Points: string;
  readonly axisAlongEdge: string;
  readonly axisTwoPlaneIntersect: string;
  readonly axisNormalToPlaneAtPoint: string;
  readonly axisCylinderConeAxis: string;

  // ─── Point methods ─────────────────────────────────────────────
  readonly pointByCoordinates: string;
  readonly pointVertex: string;
  readonly pointMidOfEdge: string;
  readonly pointCenterOfFace: string;
  readonly pointIntersectLineAndPlane: string;
  readonly pointIntersectThreePlanes: string;
  readonly pointProjectPointOntoPlane: string;

  // ─── CSys methods ──────────────────────────────────────────────
  readonly csysWorld: string;
  readonly csysOriginAndTwoAxes: string;
  readonly csysOriginAndPlane: string;
  readonly csysByFaceVertex: string;

  // ─── PlaneRef kinds (plane-picker dropdown) ────────────────────
  readonly planeRefStandard: string;
  readonly planeRefReference: string;
  readonly planeRefFace: string;
  readonly planeRefInline: string;

  // ─── Standard plane labels ─────────────────────────────────────
  readonly standardFront: string;
  readonly standardTop: string;
  readonly standardRight: string;

  // ─── Field labels (dialog forms) ───────────────────────────────
  readonly fieldStandardPlane: string;
  readonly fieldParentPlane: string;
  readonly fieldDistanceMm: string;
  readonly fieldDirection: string;
  readonly fieldFlipNormal: string;
  readonly fieldAxisOfRotation: string;
  readonly fieldAngleDeg: string;
  readonly fieldFlip: string;
  readonly fieldPoint1: string;
  readonly fieldPoint2: string;
  readonly fieldPoint3: string;
  readonly fieldThroughPoint: string;
  readonly fieldPlaneA: string;
  readonly fieldPlaneB: string;
  readonly fieldLineAxis: string;
  readonly fieldCylindricalFace: string;
  readonly fieldReferencePlane: string;
  readonly fieldDelete: string;
  readonly fieldShow: string;
  readonly fieldHide: string;

  // ─── Error chips (spec §7.4) ───────────────────────────────────
  readonly errorParentMissing: string;
  readonly errorDegenerate: string;
  readonly errorCycle: string;
  readonly errorUnsupported: string;
}

// ─── Korean (canonical for the Korean market) ──────────────────────

const KO: RefGeomDict = {
  groupLabel: '참조 형상',
  emptyLabel: '참조 형상이 없습니다.',

  kindPlane: '참조 평면',
  kindAxis: '참조 축',
  kindPoint: '참조 점',
  kindCsys: '좌표계',

  dialogTitlePlane: '새 참조 평면',
  dialogTitleAxis: '새 참조 축',
  dialogTitlePoint: '새 참조 점',
  dialogTitleCsys: '새 좌표계',

  insert: '삽입',
  cancel: '취소',
  close: '닫기',

  planeStandard: '표준',
  planeOffset: '오프셋',
  planeAngle: '각도',
  planeThrough3Points: '세 점',
  planeParallelThroughPoint: '평행 (점 통과)',
  planeMidBetween: '중간 평면',
  planeThroughLineAndPoint: '선과 점',
  planeTangentToCylinder: '원통 접면',

  axisStandard: '표준',
  axisThrough2Points: '두 점',
  axisAlongEdge: '모서리',
  axisTwoPlaneIntersect: '평면 교차',
  axisNormalToPlaneAtPoint: '평면 법선',
  axisCylinderConeAxis: '회전축',

  pointByCoordinates: '좌표 입력',
  pointVertex: '꼭지점',
  pointMidOfEdge: '모서리 중점',
  pointCenterOfFace: '면 중심',
  pointIntersectLineAndPlane: '선·평면 교점',
  pointIntersectThreePlanes: '세 평면 교점',
  pointProjectPointOntoPlane: '점 투영',

  csysWorld: '월드',
  csysOriginAndTwoAxes: '원점 + 두 축',
  csysOriginAndPlane: '원점 + 평면',
  csysByFaceVertex: '면 + 꼭지점',

  planeRefStandard: '표준',
  planeRefReference: '참조',
  planeRefFace: '면',
  planeRefInline: '직접 입력',

  standardFront: '정면',
  standardTop: '평면 (상단)',
  standardRight: '우측',

  fieldStandardPlane: '표준 평면',
  fieldParentPlane: '상위 평면',
  fieldDistanceMm: '거리 (mm)',
  fieldDirection: '방향',
  fieldFlipNormal: '법선 반전',
  fieldAxisOfRotation: '회전축',
  fieldAngleDeg: '각도 (도)',
  fieldFlip: '반전',
  fieldPoint1: '점 1',
  fieldPoint2: '점 2',
  fieldPoint3: '점 3',
  fieldThroughPoint: '통과점',
  fieldPlaneA: '평면 A',
  fieldPlaneB: '평면 B',
  fieldLineAxis: '선 / 축',
  fieldCylindricalFace: '원통면',
  fieldReferencePlane: '참조 평면',
  fieldDelete: '삭제',
  fieldShow: '표시',
  fieldHide: '숨김',

  errorParentMissing: '상위 참조 누락',
  errorDegenerate: '퇴화 형상',
  errorCycle: '순환 의존',
  errorUnsupported: '지원되지 않는 방법',
};

// ─── English (canonical for everywhere else) ───────────────────────

const EN: RefGeomDict = {
  groupLabel: 'Reference geometry',
  emptyLabel: 'No reference geometry yet.',

  kindPlane: 'Plane',
  kindAxis: 'Axis',
  kindPoint: 'Point',
  kindCsys: 'Coordinate System',

  dialogTitlePlane: 'New Reference Plane',
  dialogTitleAxis: 'New Reference Axis',
  dialogTitlePoint: 'New Reference Point',
  dialogTitleCsys: 'New Coordinate System',

  insert: 'Insert',
  cancel: 'Cancel',
  close: 'Close',

  planeStandard: 'Standard',
  planeOffset: 'Offset',
  planeAngle: 'Angle',
  planeThrough3Points: 'Through 3 points',
  planeParallelThroughPoint: 'Parallel through point',
  planeMidBetween: 'Mid plane',
  planeThroughLineAndPoint: 'Through line and point',
  planeTangentToCylinder: 'Tangent to cylinder',

  axisStandard: 'Standard',
  axisThrough2Points: 'Through 2 points',
  axisAlongEdge: 'Along edge',
  axisTwoPlaneIntersect: 'Intersection of 2 planes',
  axisNormalToPlaneAtPoint: 'Normal to plane at point',
  axisCylinderConeAxis: 'Cylinder / cone axis',

  pointByCoordinates: 'By coordinates',
  pointVertex: 'Vertex',
  pointMidOfEdge: 'Midpoint of edge',
  pointCenterOfFace: 'Center of face',
  pointIntersectLineAndPlane: 'Line / plane intersection',
  pointIntersectThreePlanes: 'Three-plane intersection',
  pointProjectPointOntoPlane: 'Project point onto plane',

  csysWorld: 'World',
  csysOriginAndTwoAxes: 'Origin + 2 axes',
  csysOriginAndPlane: 'Origin + plane',
  csysByFaceVertex: 'By face + vertex',

  planeRefStandard: 'Standard',
  planeRefReference: 'Reference',
  planeRefFace: 'Face',
  planeRefInline: 'Inline frame',

  standardFront: 'Front',
  standardTop: 'Top',
  standardRight: 'Right',

  fieldStandardPlane: 'Standard plane',
  fieldParentPlane: 'Parent plane',
  fieldDistanceMm: 'Distance (mm)',
  fieldDirection: 'Direction',
  fieldFlipNormal: 'Flip normal',
  fieldAxisOfRotation: 'Axis of rotation',
  fieldAngleDeg: 'Angle (deg)',
  fieldFlip: 'Flip',
  fieldPoint1: 'Point 1',
  fieldPoint2: 'Point 2',
  fieldPoint3: 'Point 3',
  fieldThroughPoint: 'Through point',
  fieldPlaneA: 'Plane A',
  fieldPlaneB: 'Plane B',
  fieldLineAxis: 'Line / axis',
  fieldCylindricalFace: 'Cylindrical face',
  fieldReferencePlane: 'Reference plane',
  fieldDelete: 'Delete',
  fieldShow: 'Show',
  fieldHide: 'Hide',

  errorParentMissing: 'Missing parent',
  errorDegenerate: 'Degenerate',
  errorCycle: 'Cycle',
  errorUnsupported: 'Unsupported',
};

// ─── JA / ZH / ES / AR — partial native, English fallback for the rest ─

const JA: RefGeomDict = {
  ...EN,
  groupLabel: '参照ジオメトリ',
  emptyLabel: '参照ジオメトリがまだありません。',
  kindPlane: '参照平面',
  kindAxis: '参照軸',
  kindPoint: '参照点',
  kindCsys: '座標系',
  dialogTitlePlane: '新規参照平面',
  dialogTitleAxis: '新規参照軸',
  dialogTitlePoint: '新規参照点',
  dialogTitleCsys: '新規座標系',
  insert: '挿入',
  cancel: 'キャンセル',
  close: '閉じる',
  standardFront: '正面',
  standardTop: '平面 (上面)',
  standardRight: '右側面',
};

const ZH: RefGeomDict = {
  ...EN,
  groupLabel: '参考几何',
  emptyLabel: '尚未创建参考几何。',
  kindPlane: '参考平面',
  kindAxis: '参考轴',
  kindPoint: '参考点',
  kindCsys: '坐标系',
  dialogTitlePlane: '新建参考平面',
  dialogTitleAxis: '新建参考轴',
  dialogTitlePoint: '新建参考点',
  dialogTitleCsys: '新建坐标系',
  insert: '插入',
  cancel: '取消',
  close: '关闭',
  standardFront: '前视',
  standardTop: '俯视',
  standardRight: '右视',
};

const ES: RefGeomDict = {
  ...EN,
  groupLabel: 'Geometría de referencia',
  emptyLabel: 'Aún no hay geometría de referencia.',
  kindPlane: 'Plano',
  kindAxis: 'Eje',
  kindPoint: 'Punto',
  kindCsys: 'Sistema de coordenadas',
  dialogTitlePlane: 'Nuevo plano de referencia',
  dialogTitleAxis: 'Nuevo eje de referencia',
  dialogTitlePoint: 'Nuevo punto de referencia',
  dialogTitleCsys: 'Nuevo sistema de coordenadas',
  insert: 'Insertar',
  cancel: 'Cancelar',
  close: 'Cerrar',
  standardFront: 'Frente',
  standardTop: 'Superior',
  standardRight: 'Derecha',
};

const AR: RefGeomDict = {
  ...EN,
  groupLabel: 'الهندسة المرجعية',
  emptyLabel: 'لا توجد هندسة مرجعية بعد.',
  kindPlane: 'مستوى',
  kindAxis: 'محور',
  kindPoint: 'نقطة',
  kindCsys: 'نظام إحداثيات',
  dialogTitlePlane: 'مستوى مرجعي جديد',
  dialogTitleAxis: 'محور مرجعي جديد',
  dialogTitlePoint: 'نقطة مرجعية جديدة',
  dialogTitleCsys: 'نظام إحداثيات جديد',
  insert: 'إدراج',
  cancel: 'إلغاء',
  close: 'إغلاق',
};

const DICTS: Record<RefGeomLang, RefGeomDict> = {
  ko: KO,
  en: EN,
  ja: JA,
  zh: ZH,
  es: ES,
  ar: AR,
};

/** Look up a fully-populated `RefGeomDict` for the given lang. Unknown
 *  lang codes (or `undefined`) fall back to English so the UI is always
 *  fully labelled. */
export function pickRefGeomDict(lang: RefGeomLang | string | undefined): RefGeomDict {
  if (lang === undefined) return EN;
  if (Object.prototype.hasOwnProperty.call(DICTS, lang)) {
    return DICTS[lang as RefGeomLang];
  }
  // Permissive: route segments like 'kr', 'cn' map to ko/zh by convention.
  switch (lang) {
    case 'kr':
      return KO;
    case 'cn':
      return ZH;
    default:
      return EN;
  }
}

/** Method-label lookup helpers used by the dialogs to translate the
 *  method-list strings in `REF_GEOM_METHOD_CATALOGUE`. The catalogue
 *  itself carries the English canonical label; these helpers swap it for
 *  the active dict at render time without forking the catalogue. */
export function planeMethodLabel(
  dict: RefGeomDict,
  method:
    | 'standard'
    | 'offset'
    | 'angle'
    | 'through3Points'
    | 'parallelThroughPoint'
    | 'midBetween'
    | 'throughLineAndPoint'
    | 'tangentToCylinder',
): string {
  switch (method) {
    case 'standard': return dict.planeStandard;
    case 'offset': return dict.planeOffset;
    case 'angle': return dict.planeAngle;
    case 'through3Points': return dict.planeThrough3Points;
    case 'parallelThroughPoint': return dict.planeParallelThroughPoint;
    case 'midBetween': return dict.planeMidBetween;
    case 'throughLineAndPoint': return dict.planeThroughLineAndPoint;
    case 'tangentToCylinder': return dict.planeTangentToCylinder;
  }
}

export function axisMethodLabel(
  dict: RefGeomDict,
  method:
    | 'standard'
    | 'through2Points'
    | 'alongEdge'
    | 'twoPlaneIntersect'
    | 'normalToPlaneAtPoint'
    | 'cylinderConeAxis',
): string {
  switch (method) {
    case 'standard': return dict.axisStandard;
    case 'through2Points': return dict.axisThrough2Points;
    case 'alongEdge': return dict.axisAlongEdge;
    case 'twoPlaneIntersect': return dict.axisTwoPlaneIntersect;
    case 'normalToPlaneAtPoint': return dict.axisNormalToPlaneAtPoint;
    case 'cylinderConeAxis': return dict.axisCylinderConeAxis;
  }
}

export function pointMethodLabel(
  dict: RefGeomDict,
  method:
    | 'byCoordinates'
    | 'vertex'
    | 'midOfEdge'
    | 'centerOfFace'
    | 'intersectLineAndPlane'
    | 'intersectThreePlanes'
    | 'projectPointOntoPlane',
): string {
  switch (method) {
    case 'byCoordinates': return dict.pointByCoordinates;
    case 'vertex': return dict.pointVertex;
    case 'midOfEdge': return dict.pointMidOfEdge;
    case 'centerOfFace': return dict.pointCenterOfFace;
    case 'intersectLineAndPlane': return dict.pointIntersectLineAndPlane;
    case 'intersectThreePlanes': return dict.pointIntersectThreePlanes;
    case 'projectPointOntoPlane': return dict.pointProjectPointOntoPlane;
  }
}

export function csysMethodLabel(
  dict: RefGeomDict,
  method:
    | 'world'
    | 'originAndTwoAxes'
    | 'originAndPlane'
    | 'byFaceVertex',
): string {
  switch (method) {
    case 'world': return dict.csysWorld;
    case 'originAndTwoAxes': return dict.csysOriginAndTwoAxes;
    case 'originAndPlane': return dict.csysOriginAndPlane;
    case 'byFaceVertex': return dict.csysByFaceVertex;
  }
}

/** Translate a `ReferenceErrorCode` to a localised user-visible chip. */
export function errorCodeLabel(
  dict: RefGeomDict,
  code: 'parent_missing' | 'degenerate' | 'cycle' | 'unsupported',
): string {
  switch (code) {
    case 'parent_missing': return dict.errorParentMissing;
    case 'degenerate': return dict.errorDegenerate;
    case 'cycle': return dict.errorCycle;
    case 'unsupported': return dict.errorUnsupported;
  }
}

/** Public re-export of the English dict for tests asserting "default
 *  behaviour preserves prior English UI". */
export const REF_GEOM_DICT_EN = EN;
export const REF_GEOM_DICT_KO = KO;
