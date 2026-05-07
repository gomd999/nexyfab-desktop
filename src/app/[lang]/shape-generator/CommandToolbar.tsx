'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useSceneStore } from './store/sceneStore';
import { getRecentImportFiles } from '@/lib/platform';
import { usePathname } from 'next/navigation';
import type { FeatureType } from './features/types';
import type { EditMode } from './editing/types';

const dict = {
  ko: {
    generate: '최적화 실행',
    exportSTL: 'STL 내보내기',
    tabSketch: '스케치',
    tabSolid: '솔리드',
    tabSurface: '곡면',
    tabMesh: '메쉬',
    tabSheetMetal: '판금',
    tabPlastic: '플라스틱',
    tabManage: '관리',
    tabUtilities: '유틸리티',
    tabEvaluate: '평가',
    comingSoon: '준비 중 — NexyFab 로드맵',
    sfLoftSurf: '로프트 곡면',
    sfPatch: '패치',
    sfOffsetSurf: '오프셋 곡면',
    sfTrimExt: '곡면 트림',
    surfaceLoftStackHint: '피처 트리에 로프트 추가 (솔리드 탭과 동일)',
    surfacePatchStackHint: '피처 트리에 경계 패치 추가',
    plRib: '리브',
    plBoss: '보스',
    plSnap: '스냅 핏',
    plGrill: '그릴',
    plLip: '립 / 그루브',
    plDraft: '플라스틱 구배',
    ribbonSfOffsetStack: 'NURBS 자유곡면 피처 추가 (오프셋 워크플로 대체)',
    ribbonSfTrimStack: '분할 바디 피처 추가 (트림 스타일)',
    ribbonPlRibStack: '쉘 피처 추가 (얇은 벽·리브 시작점)',
    ribbonPlBossStack: '금형 피처 추가 (보스 워크플로 대체)',
    ribbonPlSnapStack: '금형 피처 추가 (스냅 핏)',
    ribbonPlGrillStack: '금형 피처 추가 (그릴)',
    ribbonPlLipStack: '금형 피처 추가 (립·그루브)',
    ribbonPlDraftStack: '구배(draft) 피처 추가',
    grRibbonCreate: '작성',
    grRibbonModify: '수정',
    grRibbonHole: '홀·나사·불리언',
    grRibbonPattern: '패턴·분할',
    grRibbonMold: '금형',
    grRibbonWeld: '용접 부재',
    grRibbonArray: '배열 분석',
    grRibbonSkCreate: '작성',
    grRibbonSkModify: '수정',
    grRibbonSkConstraints: '구속조건',
    grRibbonSkInspect: '검사',
    grRibbonSkInsert: '삽입',
    grRibbonSkSelect: '선택',
    skInsertImport: '캔버스 / 파일',
    skInsertImportHint: '이미지·STL·STEP·DXF를 스케치 참조로 가져오기',
    skInspectMeasureHint: '3D 뷰포트 측정 켜기/끄기',
    skSelectFilter: '선택 필터',
    grRibbonMeshRepair: '수리·준비',
    grRibbonMeshRefine: '리메시·정리',
    grRibbonSurfExtract: '추출',
    grRibbonSurfBuild: '로프트·패치',
    grRibbonSurfPlanned: '오프셋·트림 (준비)',
    grRibbonSmForm: '성형',
    grRibbonSmFlat: '전개',
    grRibbonPlFeatures: '플라스틱 특징',
    grRibbonMgDoc: '문서·파라미터',
    grRibbonMgCollab: '협업·바디',
    grRibbonMgFile: '파일',
    grRibbonUtAddons: '애드온',
    grRibbonUtViews: '뷰·분석',
    grRibbonUtOptimize: '최적화',
    grRibbonEvCompare: '검증·편차',
    grRibbonEvMeasure: '측정',
    grRibbonEvSection: '단면·평면',
    grRibbonEvRecognize: '형상 인식',
    grRibbonEvPrint: '3D 프린트',
    grRibbonEvPhysics: '해석',
    grRibbonEvCam: 'CAM·포스트',
    grRibbonEvDfm: 'DFM·구배',
    grRibbonEvMass: '질량',
    grRibbonEvGdt: 'GD&T',
    grRibbonEvAdvisor: '치수 어드바이저',
    grRibbonEvGenDesign: '생성형',
    grRibbonEvStudies: '연구·탐색',
    grRibbonEvPipeline: '제조 파이프',
    skLine: '선',
    skArc: '호',
    skCircle: '원',
    skRect: '사각형',
    skPolygon: '다각형',
    skOffset: '오프셋',
    skTrim: '트림',
    skConstrain: '구속',
    cHoriz: '수평',
    cVert: '수직',
    cPerp: '직교',
    cPar: '평행',
    cTang: '접선',
    cCoinc: '일치',
    cEqual: '동일',
    skDim: '스마트 치수',
    ftExtrude: '돌출 보스',
    ftExtCut: '돌출 컷',
    ftRevolve: '회전',
    ftSweep: '스윕',
    ftLoft: '로프트',
    ftFillet: '필렛',
    ftChamfer: '챔퍼',
    ftShell: '쉘',
    ftDraft: '구배',
    ftHoleWizard: '홀 위저드',
    ftThread: '나사',
    ftBoolean: '불리안',
    ftPattern: '패턴',
    pLin: '직선 패턴',
    pCir: '원형 패턴',
    ftMirror: '대칭',
    ftSplit: '분할',
    ftMold: '금형',
    mDraft: '구배 분석',
    mCavity: '캐비티',
    mCore: '코어',
    ftWeld: '용접 부재',
    wRectTube: '사각관',
    wIBeam: 'I 빔',
    wAngle: '앵글',
    wRoundTube: '원형관',
    ftArray: '배열',
    sfAuto: '자동 서피스',
    sfCross: '단면',
    sfRepair: '수리',
    sfSmooth: '스무딩',
    sfSimplify: '단순화',
    sfFill: '홀 채우기',
    sfFlip: '노말 뒤집기',
    sfSpike: '스파이크 제거',
    sfRemesh: '리메시',
    sfNoise: '노이즈 감소',
    sfDetach: '분리 제거',
    smBox: '판금 박스',
    smBend: '벤드',
    smFlange: '플랜지',
    smHem: '헴',
    smUnfold: '전개',
    evValid: '형상 검증',
    evDev: '편차 분석',
    evMeasure: '측정',
    evDist: '거리',
    evAngleM: '각도',
    evRadius: '반지름',
    evSection: '단면 분석',
    evPlanes: '기준 평면',
    evPrim: '프리미티브 감지',
    evExtr: '돌출 감지',
    evPrint: '3D 프린팅 분석',
    evFea: '응력 해석',
    evThermal: '열해석',
    evEcad: 'PCB 열매핑',
    evCam: 'CAM 경로',
    evCamPostLinuxcnc: '포스트: LinuxCNC',
    evCamPostFanuc: '포스트: Fanuc',
    evCamPostMazak: '포스트: Mazak',
    evCamPostHaas: '포스트: Haas',
    evDfm: '제조 가능성 분석',
    evDraftAn: '구배 분석',
    evMass: '질량 특성',
    evGdt: 'GD&T 공차',
    evModelParams: '모델 파라미터',
    evHistory: '히스토리',
    evDimAdvisor: 'AI 치수 추천',
    evGenDesign: '생성형 설계',
    evMotion: '동작 해석',
    evModal: '고유진동수',
    evSweep: '매개변수 탐색',
    evTolerance: '공차 누적',
    evSurface: '곡률 분석',
    evDrawing: '자동 도면',
    evMfg: '제조 파이프라인',
    fileLabel: '파일',
    importFile: '파일 불러오기',
    recentFiles: '최근 파일',
    recentFilesTip: '최근 파일 목록은 참고용입니다. 다시 불러오려면 위의 Import를 사용하세요.',
    recentFileItemTip: '최근 파일',
    recentFileItemHint: '다시 불러오려면 Import 버튼을 사용하세요',
    genShapeFirst: '형상을 생성한 후 내보낼 수 있습니다',
    export3MF: '3MF 내보내기 (3D 프린터)',
    exportingSTEP: 'STEP 변환 중...',
    exportSTEP: 'STEP 내보내기',
    exportingGLTF: 'GLTF 변환 중...',
    exportGLTFLabel: 'GLTF (GLB) 내보내기',
    exportSceneGLB: '씬 GLB 내보내기',
    viewAR: 'AR로 보기 (WebXR)',
    featureGraph: 'Feature 의존성 그래프',
    nesting: '네스팅 (2D 배치)',
    threadHole: '나사산 / 홀 콜아웃',
    variants: '설계 대안 (Variants)',
    myPartsLib: '내 부품 라이브러리',
    timelapse: '세션 타임랩스',
    stockOptimizer: '자재 스톡 최적화',
    exportingRhino: 'Rhino 변환 중...',
    exportRhinoJSON: 'Rhino JSON 내보내기',
    exportingGH: 'Grasshopper 변환 중...',
    exportGHPoints: 'Grasshopper 포인트 내보내기',
    saveScene: '씬 저장 (.nexyfab)',
    loadScene: '씬 불러오기 (.nexyfab)',
    exportingDXF: 'DXF 변환 중...',
    exportDXF: 'DXF 내보내기',
    flatPatternDXF: '전개도 DXF (판금·레이저)',
    exportingPDF: 'PDF 변환 중...',
    exportPDF: 'PDF 도면 내보내기',
    sketchModeTip: '스케치 모드 (단축키: S)',
    undoTip: '실행 취소 (Ctrl+Z)',
    undo: '취소',
    redoTip: '다시 실행 (Ctrl+Y)',
    redo: '재실행',
    cmdHistory: '명령 히스토리',
    history: '히스토리',
    topoOpt: '위상 최적화',
    optimize: '최적화',
    plugins: '플러그인',
    scriptTip: 'NexyScript 코드 편집기',
    script: '스크립트',
    shareDesign: 'Share design',
    share: 'Share',
    mfgMatchTip: '재질·형상 기반 제조사 매칭',
    mfgMatch: '제조사 매칭',
    bodyMgrTip: '바디 분리·합체 관리',
    bodies: '바디 관리',
    moreMenu: '더보기',
  },
  en: {
    generate: 'Generate',
    exportSTL: 'Export STL',
    tabSketch: 'Sketch',
    tabSolid: 'Solid',
    tabSurface: 'Surface',
    tabMesh: 'Mesh',
    tabSheetMetal: 'Sheet Metal',
    tabPlastic: 'Plastic',
    tabManage: 'Manage',
    tabUtilities: 'Utilities',
    tabEvaluate: 'Evaluate',
    comingSoon: 'Coming soon — NexyFab roadmap',
    sfLoftSurf: 'Loft surface',
    sfPatch: 'Patch',
    sfOffsetSurf: 'Offset surface',
    sfTrimExt: 'Trim surface',
    surfaceLoftStackHint: 'Adds Loft to the feature stack (same as Solid)',
    surfacePatchStackHint: 'Adds Boundary surface to the feature stack',
    plRib: 'Rib',
    plBoss: 'Boss',
    plSnap: 'Snap fit',
    plGrill: 'Grill',
    plLip: 'Lip & groove',
    plDraft: 'Plastic draft',
    ribbonSfOffsetStack: 'Add NURBS surface feature (offset-style workflow)',
    ribbonSfTrimStack: 'Add split-body feature (trim-style)',
    ribbonPlRibStack: 'Add shell (thin wall; rib starting point)',
    ribbonPlBossStack: 'Add mold-tools feature (boss placeholder)',
    ribbonPlSnapStack: 'Add mold-tools feature (snap fit)',
    ribbonPlGrillStack: 'Add mold-tools feature (vent grill)',
    ribbonPlLipStack: 'Add mold-tools feature (lip & groove)',
    ribbonPlDraftStack: 'Add draft-angle feature',
    grRibbonCreate: 'Create',
    grRibbonModify: 'Modify',
    grRibbonHole: 'Hole / Thread / Boolean',
    grRibbonPattern: 'Pattern / Split',
    grRibbonMold: 'Mold',
    grRibbonWeld: 'Weldment',
    grRibbonArray: 'Array study',
    grRibbonSkCreate: 'Create',
    grRibbonSkModify: 'Modify',
    grRibbonSkConstraints: 'Constraints',
    grRibbonSkInspect: 'Inspect',
    grRibbonSkInsert: 'Insert',
    grRibbonSkSelect: 'Select',
    skInsertImport: 'Canvas / file',
    skInsertImportHint: 'Import image, STL, STEP, or DXF as sketch reference underlay',
    skInspectMeasureHint: 'Toggle 3D viewport measure',
    skSelectFilter: 'Selection',
    grRibbonMeshRepair: 'Repair / prep',
    grRibbonMeshRefine: 'Remesh / clean',
    grRibbonSurfExtract: 'Extract',
    grRibbonSurfBuild: 'Loft / patch',
    grRibbonSurfPlanned: 'Offset / trim',
    grRibbonSmForm: 'Form',
    grRibbonSmFlat: 'Flat pattern',
    grRibbonPlFeatures: 'Plastic',
    grRibbonMgDoc: 'Document',
    grRibbonMgCollab: 'Collaborate',
    grRibbonMgFile: 'File',
    grRibbonUtAddons: 'Add-ins',
    grRibbonUtViews: 'Views',
    grRibbonUtOptimize: 'Optimize',
    grRibbonEvCompare: 'Inspect',
    grRibbonEvMeasure: 'Measure',
    grRibbonEvSection: 'Section / planes',
    grRibbonEvRecognize: 'Recognize',
    grRibbonEvPrint: 'Additive',
    grRibbonEvPhysics: 'Physics',
    grRibbonEvCam: 'CAM / post',
    grRibbonEvDfm: 'DFM / draft',
    grRibbonEvMass: 'Mass',
    grRibbonEvGdt: 'GD&T',
    grRibbonEvAdvisor: 'Advisor',
    grRibbonEvGenDesign: 'Generative',
    grRibbonEvStudies: 'Studies',
    grRibbonEvPipeline: 'Pipeline',
    skLine: 'Line',
    skArc: 'Arc',
    skCircle: 'Circle',
    skRect: 'Rect',
    skPolygon: 'Polygon',
    skOffset: 'Offset',
    skTrim: 'Trim',
    skConstrain: 'Constrain',
    cHoriz: 'Horizontal',
    cVert: 'Vertical',
    cPerp: 'Perpendicular',
    cPar: 'Parallel',
    cTang: 'Tangent',
    cCoinc: 'Coincident',
    cEqual: 'Equal',
    skDim: 'Dimension',
    ftExtrude: 'Extrude',
    ftExtCut: 'Ext. Cut',
    ftRevolve: 'Revolve',
    ftSweep: 'Sweep',
    ftLoft: 'Loft',
    ftFillet: 'Fillet',
    ftChamfer: 'Chamfer',
    ftShell: 'Shell',
    ftDraft: 'Draft',
    ftHoleWizard: 'Hole Wiz.',
    ftThread: 'Thread',
    ftBoolean: 'Boolean',
    ftPattern: 'Pattern',
    pLin: 'Linear Pattern',
    pCir: 'Circular Pattern',
    ftMirror: 'Mirror',
    ftSplit: 'Split',
    ftMold: 'Mold Tools',
    mDraft: 'Draft Analysis',
    mCavity: 'Cavity',
    mCore: 'Core',
    ftWeld: 'Weldment',
    wRectTube: 'Rect Tube',
    wIBeam: 'I-Beam',
    wAngle: 'Angle',
    wRoundTube: 'Round Tube',
    ftArray: 'Array',
    sfAuto: 'Auto Surf.',
    sfCross: 'Cross Sec.',
    sfRepair: 'Repair',
    sfSmooth: 'Smooth',
    sfSimplify: 'Simplify',
    sfFill: 'Fill Holes',
    sfFlip: 'Flip Norm.',
    sfSpike: 'Rm Spikes',
    sfRemesh: 'Remesh',
    sfNoise: 'Denoise',
    sfDetach: 'Rm Detach.',
    smBox: 'Box',
    smBend: 'Bend',
    smFlange: 'Flange',
    smHem: 'Hem',
    smUnfold: 'Unfold',
    evValid: 'Validate',
    evDev: 'Deviation',
    evMeasure: 'Measure',
    evDist: 'Distance',
    evAngleM: 'Angle',
    evRadius: 'Radius',
    evSection: 'Section',
    evPlanes: 'Planes',
    evPrim: 'Primitives',
    evExtr: 'Extrusions',
    evPrint: '3D Print',
    evFea: 'FEA',
    evThermal: 'Thermal',
    evEcad: 'PCB Thermal',
    evCam: 'CAM Path',
    evCamPostLinuxcnc: 'Post: LinuxCNC',
    evCamPostFanuc: 'Post: Fanuc',
    evCamPostMazak: 'Post: Mazak',
    evCamPostHaas: 'Post: Haas',
    evDfm: 'DFM Analysis',
    evDraftAn: 'Draft Analysis',
    evMass: 'Mass properties',
    evGdt: 'GD&T',
    evModelParams: 'Parameters',
    evHistory: 'History',
    evDimAdvisor: 'AI Suggest',
    evGenDesign: 'Gen. Design',
    evMotion: 'Motion Study',
    evModal: 'Modal Analysis',
    evSweep: 'Param Sweep',
    evTolerance: 'Tolerance',
    evSurface: 'Surface Quality',
    evDrawing: 'Auto Drawing',
    evMfg: 'Mfg Pipeline',
    fileLabel: 'File',
    importFile: 'Import',
    recentFiles: 'Recent Files',
    recentFilesTip: 'Recent file history (read-only). Use Import above to re-open a file.',
    recentFileItemTip: 'Recent',
    recentFileItemHint: 'Use Import to re-open',
    genShapeFirst: 'Generate a shape to enable export',
    export3MF: 'Export 3MF (3D print)',
    exportingSTEP: 'Exporting STEP...',
    exportSTEP: 'Export STEP',
    exportingGLTF: 'Exporting GLTF...',
    exportGLTFLabel: 'Export GLTF (GLB)',
    exportSceneGLB: 'Export Scene GLB',
    viewAR: 'View in AR (WebXR)',
    featureGraph: 'Feature Dependency Graph',
    nesting: 'Nesting (2D Packing)',
    threadHole: 'Thread & Hole Callout',
    variants: 'Design Variants',
    myPartsLib: 'My Parts Library',
    timelapse: 'Session Timelapse',
    stockOptimizer: 'Stock Optimizer',
    exportingRhino: 'Exporting Rhino...',
    exportRhinoJSON: 'Export Rhino JSON',
    exportingGH: 'Exporting GH...',
    exportGHPoints: 'Export Grasshopper Points',
    saveScene: 'Save Scene (.nexyfab)',
    loadScene: 'Load Scene (.nexyfab)',
    exportingDXF: 'Exporting DXF...',
    exportDXF: 'Export DXF',
    flatPatternDXF: 'Flat Pattern DXF (sheet metal)',
    exportingPDF: 'Exporting PDF...',
    exportPDF: 'PDF Drawing',
    sketchModeTip: 'Sketch mode (shortcut: S)',
    undoTip: 'Undo (Ctrl+Z)',
    undo: 'Undo',
    redoTip: 'Redo (Ctrl+Y)',
    redo: 'Redo',
    cmdHistory: 'Command History',
    history: 'History',
    topoOpt: 'Topology optimization',
    optimize: 'Optimize',
    plugins: 'Plugins',
    scriptTip: 'NexyScript Editor',
    script: 'Script',
    shareDesign: 'Share design',
    share: 'Share',
    mfgMatchTip: 'Match manufacturers to your part',
    mfgMatch: 'Manufacturer Match',
    bodyMgrTip: 'Split and merge bodies',
    bodies: 'Bodies',
    moreMenu: 'More',
  },
  ja: {
    generate: '最適化実行',
    exportSTL: 'STL エクスポート',
    tabSketch: 'スケッチ',
    tabSolid: 'ソリッド',
    tabSurface: 'サーフェス',
    tabMesh: 'メッシュ',
    tabSheetMetal: '板金',
    tabPlastic: 'プラスチック',
    tabManage: '管理',
    tabUtilities: 'ユーティリティ',
    tabEvaluate: '評価',
    comingSoon: '準備中 — NexyFab ロードマップ',
    sfLoftSurf: 'ロフトサーフェス',
    sfPatch: 'パッチ',
    sfOffsetSurf: 'オフセットサーフェス',
    sfTrimExt: 'サーフェストリム',
    surfaceLoftStackHint: 'フィーチャツリーにロフトを追加',
    surfacePatchStackHint: '境界パッチをフィーチャに追加',
    plRib: 'リブ',
    plBoss: 'ボス',
    plSnap: 'スナップフィット',
    plGrill: 'グリル',
    plLip: 'リップ／グルーブ',
    plDraft: 'プラスチックドラフト',
    ribbonSfOffsetStack: 'NURBSサーフェスを追加（オフセット相当）',
    ribbonSfTrimStack: '分割ボディを追加（トリム相当）',
    ribbonPlRibStack: 'シェル追加（薄肉・リブ起点）',
    ribbonPlBossStack: '金型ツールを追加（ボス相当）',
    ribbonPlSnapStack: '金型ツールを追加（スナップフィット）',
    ribbonPlGrillStack: '金型ツールを追加（グリル）',
    ribbonPlLipStack: '金型ツールを追加（リップ・グルーブ）',
    ribbonPlDraftStack: 'ドラフト（勾配）を追加',
    grRibbonCreate: '作成',
    grRibbonModify: '修正',
    grRibbonHole: '穴·ねじ·ブーリアン',
    grRibbonPattern: 'パターン·分割',
    grRibbonMold: '金型',
    grRibbonWeld: '溶接部材',
    grRibbonArray: '配列解析',
    grRibbonSkCreate: '作成',
    grRibbonSkModify: '修正',
    grRibbonSkConstraints: '拘束',
    grRibbonSkInspect: '検査',
    grRibbonSkInsert: '挿入',
    grRibbonSkSelect: '選択',
    skInsertImport: 'キャンバス / ファイル',
    skInsertImportHint: '画像・STL・STEP・DXFをスケッチ参照として取り込み',
    skInspectMeasureHint: '3D ビューで測定',
    skSelectFilter: '選択フィルタ',
    grRibbonMeshRepair: '修復·準備',
    grRibbonMeshRefine: 'リメッシュ',
    grRibbonSurfExtract: '抽出',
    grRibbonSurfBuild: 'ロフト·パッチ',
    grRibbonSurfPlanned: 'オフセット·トリム',
    grRibbonSmForm: '成形',
    grRibbonSmFlat: '展開',
    grRibbonPlFeatures: 'プラスチック',
    grRibbonMgDoc: 'ドキュメント',
    grRibbonMgCollab: '共有',
    grRibbonMgFile: 'ファイル',
    grRibbonUtAddons: 'アドイン',
    grRibbonUtViews: 'ビュー',
    grRibbonUtOptimize: '最適化',
    grRibbonEvCompare: '検査',
    grRibbonEvMeasure: '測定',
    grRibbonEvSection: '断面·平面',
    grRibbonEvRecognize: '認識',
    grRibbonEvPrint: '3Dプリント',
    grRibbonEvPhysics: '物理解析',
    grRibbonEvCam: 'CAM·ポスト',
    grRibbonEvDfm: 'DFM·ドラフト',
    grRibbonEvMass: '質量',
    grRibbonEvGdt: 'GD&T',
    grRibbonEvAdvisor: 'アドバイザ',
    grRibbonEvGenDesign: 'ジェネレーティブ',
    grRibbonEvStudies: 'スタディ',
    grRibbonEvPipeline: 'パイプライン',
    skLine: '線',
    skArc: '弧',
    skCircle: '円',
    skRect: '四角形',
    skPolygon: '多角形',
    skOffset: 'オフセット',
    skTrim: 'トリム',
    skConstrain: '拘束',
    cHoriz: '水平',
    cVert: '垂直',
    cPerp: '直角',
    cPar: '平行',
    cTang: '接線',
    cCoinc: '一致',
    cEqual: '等しい',
    skDim: 'スマート寸法',
    ftExtrude: '押し出しボス',
    ftExtCut: '押し出しカット',
    ftRevolve: '回転',
    ftSweep: 'スイープ',
    ftLoft: 'ロフト',
    ftFillet: 'フィレット',
    ftChamfer: '面取り',
    ftShell: 'シェル',
    ftDraft: '抜き勾配',
    ftHoleWizard: '穴ウィザード',
    ftThread: 'ねじ',
    ftBoolean: 'Boolean',
    ftPattern: 'パターン',
    pLin: '直線パターン',
    pCir: '円形パターン',
    ftMirror: 'ミラー',
    ftSplit: '分割',
    ftMold: '金型',
    mDraft: '抜き勾配解析',
    mCavity: 'キャビティ',
    mCore: 'コア',
    ftWeld: '溶接部材',
    wRectTube: '角パイプ',
    wIBeam: 'I 形鋼',
    wAngle: 'アングル',
    wRoundTube: '丸パイプ',
    ftArray: '配列',
    sfAuto: '自動サーフェス',
    sfCross: '断面',
    sfRepair: '修復',
    sfSmooth: 'スムージング',
    sfSimplify: '簡素化',
    sfFill: '穴埋め',
    sfFlip: '法線反転',
    sfSpike: 'スパイク除去',
    sfRemesh: 'リメッシュ',
    sfNoise: 'ノイズ低減',
    sfDetach: '分離除去',
    smBox: '板金ボックス',
    smBend: 'ベンド',
    smFlange: 'フランジ',
    smHem: 'ヘム',
    smUnfold: '展開',
    evValid: '形状検証',
    evDev: '偏差解析',
    evMeasure: '測定',
    evDist: '距離',
    evAngleM: '角度',
    evRadius: '半径',
    evSection: '断面解析',
    evPlanes: '基準平面',
    evPrim: 'プリミティブ検出',
    evExtr: '押し出し検出',
    evPrint: '3D プリント解析',
    evFea: '応力解析',
    evThermal: '熱解析',
    evEcad: 'PCB 熱マッピング',
    evCam: 'CAM パス',
    evCamPostLinuxcnc: 'ポスト: LinuxCNC',
    evCamPostFanuc: 'ポスト: Fanuc',
    evCamPostMazak: 'ポスト: Mazak',
    evCamPostHaas: 'ポスト: Haas',
    evDfm: '製造可能性解析',
    evDraftAn: '抜き勾配解析',
    evMass: '質量特性',
    evGdt: 'GD&T 公差',
    evModelParams: 'モデルパラメータ',
    evHistory: '履歴',
    evDimAdvisor: 'AI 寸法提案',
    evGenDesign: 'ジェネレーティブ設計',
    evMotion: '動作解析',
    evModal: '固有振動数',
    evSweep: 'パラメータ探索',
    evTolerance: '公差スタック',
    evSurface: '曲率解析',
    evDrawing: '自動図面',
    evMfg: '製造パイプライン',
    fileLabel: 'ファイル',
    importFile: 'ファイル読み込み',
    recentFiles: '最近のファイル',
    recentFilesTip: '最近のファイルは参照用です。再度開くには上の Import をご利用ください。',
    recentFileItemTip: '最近のファイル',
    recentFileItemHint: '再度開くには Import ボタンをご利用ください',
    genShapeFirst: '形状を生成するとエクスポートできます',
    export3MF: '3MF エクスポート (3D プリンタ)',
    exportingSTEP: 'STEP 変換中...',
    exportSTEP: 'STEP エクスポート',
    exportingGLTF: 'GLTF 変換中...',
    exportGLTFLabel: 'GLTF (GLB) エクスポート',
    exportSceneGLB: 'シーン GLB エクスポート',
    viewAR: 'AR で表示 (WebXR)',
    featureGraph: 'Feature 依存グラフ',
    nesting: 'ネスティング (2D 配置)',
    threadHole: 'ねじ / 穴コールアウト',
    variants: '設計バリアント',
    myPartsLib: 'マイパーツライブラリ',
    timelapse: 'セッションタイムラプス',
    stockOptimizer: '素材在庫最適化',
    exportingRhino: 'Rhino 変換中...',
    exportRhinoJSON: 'Rhino JSON エクスポート',
    exportingGH: 'Grasshopper 変換中...',
    exportGHPoints: 'Grasshopper ポイントエクスポート',
    saveScene: 'シーン保存 (.nexyfab)',
    loadScene: 'シーン読み込み (.nexyfab)',
    exportingDXF: 'DXF 変換中...',
    exportDXF: 'DXF エクスポート',
    flatPatternDXF: '展開図 DXF (板金・レーザー)',
    exportingPDF: 'PDF 変換中...',
    exportPDF: 'PDF 図面エクスポート',
    sketchModeTip: 'スケッチモード (ショートカット: S)',
    undoTip: '元に戻す (Ctrl+Z)',
    undo: '元に戻す',
    redoTip: 'やり直し (Ctrl+Y)',
    redo: 'やり直し',
    cmdHistory: 'コマンド履歴',
    history: '履歴',
    topoOpt: 'トポロジー最適化',
    optimize: '最適化',
    plugins: 'プラグイン',
    scriptTip: 'NexyScript コードエディタ',
    script: 'スクリプト',
    shareDesign: 'デザインを共有',
    share: '共有',
    mfgMatchTip: '材質・形状によるメーカーマッチング',
    mfgMatch: 'メーカーマッチング',
    bodyMgrTip: 'ボディ分離・結合管理',
    bodies: 'ボディ管理',
    moreMenu: 'その他',
  },
  zh: {
    generate: '运行优化',
    exportSTL: '导出 STL',
    tabSketch: '草图',
    tabSolid: '实体',
    tabSurface: '曲面',
    tabMesh: '网格',
    tabSheetMetal: '钣金',
    tabPlastic: '塑料',
    tabManage: '管理',
    tabUtilities: '实用工具',
    tabEvaluate: '评估',
    comingSoon: '即将推出 — NexyFab 路线图',
    sfLoftSurf: '放样曲面',
    sfPatch: '修补',
    sfOffsetSurf: '偏移曲面',
    sfTrimExt: '修剪曲面',
    surfaceLoftStackHint: '将放样加入特征树（与实体选项卡相同）',
    surfacePatchStackHint: '将边界曲面加入特征树',
    plRib: '筋',
    plBoss: '凸台',
    plSnap: '卡扣',
    plGrill: '格栅',
    plLip: '唇槽',
    plDraft: '塑料拔模',
    ribbonSfOffsetStack: '添加 NURBS 曲面（类偏移流程）',
    ribbonSfTrimStack: '添加分割实体（类修剪）',
    ribbonPlRibStack: '添加抽壳（薄壁/筋位起点）',
    ribbonPlBossStack: '添加模具工具（凸台占位）',
    ribbonPlSnapStack: '添加模具工具（卡扣）',
    ribbonPlGrillStack: '添加模具工具（格栅）',
    ribbonPlLipStack: '添加模具工具（唇槽）',
    ribbonPlDraftStack: '添加拔模特征',
    grRibbonCreate: '创建',
    grRibbonModify: '修改',
    grRibbonHole: '孔·螺纹·布尔',
    grRibbonPattern: '阵列·分割',
    grRibbonMold: '模具',
    grRibbonWeld: '焊件',
    grRibbonArray: '阵列分析',
    grRibbonSkCreate: '创建',
    grRibbonSkModify: '修改',
    grRibbonSkConstraints: '约束',
    grRibbonSkInspect: '检查',
    grRibbonSkInsert: '插入',
    grRibbonSkSelect: '选择',
    skInsertImport: '画布 / 文件',
    skInsertImportHint: '导入图片或 STL/STEP/DXF 作为草图参考底图',
    skInspectMeasureHint: '开关三维测量',
    skSelectFilter: '选择过滤器',
    grRibbonMeshRepair: '修复·准备',
    grRibbonMeshRefine: '重网格',
    grRibbonSurfExtract: '提取',
    grRibbonSurfBuild: '放样·修补',
    grRibbonSurfPlanned: '偏移·修剪',
    grRibbonSmForm: '成形',
    grRibbonSmFlat: '展开',
    grRibbonPlFeatures: '塑料',
    grRibbonMgDoc: '文档',
    grRibbonMgCollab: '协作',
    grRibbonMgFile: '文件',
    grRibbonUtAddons: '插件',
    grRibbonUtViews: '视图',
    grRibbonUtOptimize: '优化',
    grRibbonEvCompare: '检查',
    grRibbonEvMeasure: '测量',
    grRibbonEvSection: '截面·平面',
    grRibbonEvRecognize: '识别',
    grRibbonEvPrint: '增材',
    grRibbonEvPhysics: '物理',
    grRibbonEvCam: 'CAM / 后处理',
    grRibbonEvDfm: 'DFM / 拔模',
    grRibbonEvMass: '质量',
    grRibbonEvGdt: 'GD&T',
    grRibbonEvAdvisor: '顾问',
    grRibbonEvGenDesign: '生成设计',
    grRibbonEvStudies: '研究',
    grRibbonEvPipeline: '流水线',
    skLine: '直线',
    skArc: '弧',
    skCircle: '圆',
    skRect: '矩形',
    skPolygon: '多边形',
    skOffset: '偏移',
    skTrim: '修剪',
    skConstrain: '约束',
    cHoriz: '水平',
    cVert: '垂直',
    cPerp: '垂直于',
    cPar: '平行',
    cTang: '相切',
    cCoinc: '重合',
    cEqual: '相等',
    skDim: '智能尺寸',
    ftExtrude: '拉伸凸台',
    ftExtCut: '拉伸切除',
    ftRevolve: '旋转',
    ftSweep: 'Sweep',
    ftLoft: 'Loft',
    ftFillet: 'Fillet',
    ftChamfer: 'Chamfer',
    ftShell: 'Shell',
    ftDraft: '拔模',
    ftHoleWizard: '孔向导',
    ftThread: '螺纹',
    ftBoolean: 'Boolean',
    ftPattern: '阵列',
    pLin: '线性阵列',
    pCir: '圆周阵列',
    ftMirror: '镜像',
    ftSplit: '拆分',
    ftMold: '模具',
    mDraft: '拔模分析',
    mCavity: '型腔',
    mCore: '型芯',
    ftWeld: '焊件',
    wRectTube: '方管',
    wIBeam: 'I 型梁',
    wAngle: '角钢',
    wRoundTube: '圆管',
    ftArray: 'Array',
    sfAuto: '自动曲面',
    sfCross: '截面',
    sfRepair: '修复',
    sfSmooth: '平滑',
    sfSimplify: '简化',
    sfFill: '填充孔',
    sfFlip: '翻转法线',
    sfSpike: '移除尖刺',
    sfRemesh: '重新网格化',
    sfNoise: '降噪',
    sfDetach: '移除分离',
    smBox: '钣金盒',
    smBend: '折弯',
    smFlange: '法兰',
    smHem: '卷边',
    smUnfold: '展开',
    evValid: '形状验证',
    evDev: '偏差分析',
    evMeasure: '测量',
    evDist: '距离',
    evAngleM: '角度',
    evRadius: '半径',
    evSection: '截面分析',
    evPlanes: '基准平面',
    evPrim: '基元检测',
    evExtr: '拉伸检测',
    evPrint: '3D 打印分析',
    evFea: 'FEA',
    evThermal: '热分析',
    evEcad: 'PCB 热映射',
    evCam: 'CAM 路径',
    evCamPostLinuxcnc: '后处理: LinuxCNC',
    evCamPostFanuc: '后处理: Fanuc',
    evCamPostMazak: '后处理: Mazak',
    evCamPostHaas: '后处理: Haas',
    evDfm: 'DFM 分析',
    evDraftAn: '拔模分析',
    evMass: '质量属性',
    evGdt: 'GD&T 公差',
    evModelParams: '模型参数',
    evHistory: '历史',
    evDimAdvisor: 'AI 尺寸推荐',
    evGenDesign: '生成式设计',
    evMotion: '运动分析',
    evModal: '固有频率',
    evSweep: '参数扫描',
    evTolerance: '公差累积',
    evSurface: '曲率分析',
    evDrawing: '自动图纸',
    evMfg: '制造流水线',
    fileLabel: '文件',
    importFile: '导入文件',
    recentFiles: '最近文件',
    recentFilesTip: '最近文件列表仅供参考。请使用上面的 Import 重新打开文件。',
    recentFileItemTip: '最近',
    recentFileItemHint: '使用 Import 按钮重新打开',
    genShapeFirst: '生成形状后可导出',
    export3MF: '导出 3MF (3D 打印)',
    exportingSTEP: 'STEP 转换中...',
    exportSTEP: '导出 STEP',
    exportingGLTF: 'GLTF 转换中...',
    exportGLTFLabel: '导出 GLTF (GLB)',
    exportSceneGLB: '导出场景 GLB',
    viewAR: 'AR 查看 (WebXR)',
    featureGraph: 'Feature 依赖图',
    nesting: '套料 (2D 布局)',
    threadHole: '螺纹 / 孔标注',
    variants: '设计变体',
    myPartsLib: '我的零件库',
    timelapse: '会话延时',
    stockOptimizer: '材料库存优化',
    exportingRhino: 'Rhino 转换中...',
    exportRhinoJSON: '导出 Rhino JSON',
    exportingGH: 'Grasshopper 转换中...',
    exportGHPoints: '导出 Grasshopper 点',
    saveScene: '保存场景 (.nexyfab)',
    loadScene: '加载场景 (.nexyfab)',
    exportingDXF: 'DXF 转换中...',
    exportDXF: '导出 DXF',
    flatPatternDXF: '展开图 DXF (钣金·激光)',
    exportingPDF: 'PDF 转换中...',
    exportPDF: '导出 PDF 图纸',
    sketchModeTip: '草图模式 (快捷键: S)',
    undoTip: '撤销 (Ctrl+Z)',
    undo: '撤销',
    redoTip: '重做 (Ctrl+Y)',
    redo: '重做',
    cmdHistory: '命令历史',
    history: '历史',
    topoOpt: '拓扑优化',
    optimize: '优化',
    plugins: '插件',
    scriptTip: 'NexyScript 代码编辑器',
    script: '脚本',
    shareDesign: '分享设计',
    share: '分享',
    mfgMatchTip: '基于材料和形状的制造商匹配',
    mfgMatch: '制造商匹配',
    bodyMgrTip: '实体分离·合并管理',
    bodies: '实体管理',
    moreMenu: '更多',
  },
  es: {
    generate: 'Ejecutar optimización',
    exportSTL: 'Exportar STL',
    tabSketch: 'Croquis',
    tabSolid: 'Sólido',
    tabSurface: 'Superficie',
    tabMesh: 'Malla',
    tabSheetMetal: 'Chapa',
    tabPlastic: 'Plástico',
    tabManage: 'Administrar',
    tabUtilities: 'Utilidades',
    tabEvaluate: 'Evaluar',
    comingSoon: 'Próximamente — hoja de ruta NexyFab',
    sfLoftSurf: 'Superficie loft',
    sfPatch: 'Parche',
    sfOffsetSurf: 'Superficie offset',
    sfTrimExt: 'Recortar superficie',
    surfaceLoftStackHint: 'Añade Loft al árbol de operaciones',
    surfacePatchStackHint: 'Añade superficie límite al árbol',
    plRib: 'Refuerzo',
    plBoss: 'Collerín',
    plSnap: 'Encaje a presión',
    plGrill: 'Rejilla',
    plLip: 'Labio y ranura',
    plDraft: 'Borrador plástico',
    ribbonSfOffsetStack: 'Añadir superficie NURBS (flujo tipo offset)',
    ribbonSfTrimStack: 'Añadir cuerpo dividido (tipo recorte)',
    ribbonPlRibStack: 'Añadir vaciado (pared fina; base de nervio)',
    ribbonPlBossStack: 'Añadir herramientas de molde (protuberancia)',
    ribbonPlSnapStack: 'Añadir herramientas de molde (ajuste a presión)',
    ribbonPlGrillStack: 'Añadir herramientas de molde (rejilla)',
    ribbonPlLipStack: 'Añadir herramientas de molde (labio y ranura)',
    ribbonPlDraftStack: 'Añadir desmoldeo (draft)',
    grRibbonCreate: 'Crear',
    grRibbonModify: 'Modificar',
    grRibbonHole: 'Agujero / Roscado / Booleano',
    grRibbonPattern: 'Patrón / Dividir',
    grRibbonMold: 'Molde',
    grRibbonWeld: 'Soldadura',
    grRibbonArray: 'Estudio de matriz',
    grRibbonSkCreate: 'Crear',
    grRibbonSkModify: 'Modificar',
    grRibbonSkConstraints: 'Restricciones',
    grRibbonSkInspect: 'Inspeccionar',
    grRibbonSkInsert: 'Insertar',
    grRibbonSkSelect: 'Seleccionar',
    skInsertImport: 'Lienzo / archivo',
    skInsertImportHint: 'Importar imagen, STL, STEP o DXF como referencia de boceto',
    skInspectMeasureHint: 'Medición 3D en vista',
    skSelectFilter: 'Selección',
    grRibbonMeshRepair: 'Reparar',
    grRibbonMeshRefine: 'Remallado',
    grRibbonSurfExtract: 'Extraer',
    grRibbonSurfBuild: 'Loft / parche',
    grRibbonSurfPlanned: 'Desfase / recorte',
    grRibbonSmForm: 'Conformado',
    grRibbonSmFlat: 'Desplegado',
    grRibbonPlFeatures: 'Plástico',
    grRibbonMgDoc: 'Documento',
    grRibbonMgCollab: 'Colaborar',
    grRibbonMgFile: 'Archivo',
    grRibbonUtAddons: 'Complementos',
    grRibbonUtViews: 'Vistas',
    grRibbonUtOptimize: 'Optimizar',
    grRibbonEvCompare: 'Inspección',
    grRibbonEvMeasure: 'Medir',
    grRibbonEvSection: 'Sección / planos',
    grRibbonEvRecognize: 'Reconocer',
    grRibbonEvPrint: 'Aditivo',
    grRibbonEvPhysics: 'Física',
    grRibbonEvCam: 'CAM / post',
    grRibbonEvDfm: 'DFM / vaciado',
    grRibbonEvMass: 'Masa',
    grRibbonEvGdt: 'GD&T',
    grRibbonEvAdvisor: 'Asesor',
    grRibbonEvGenDesign: 'Generativo',
    grRibbonEvStudies: 'Estudios',
    grRibbonEvPipeline: 'Pipeline',
    skLine: 'Línea',
    skArc: 'Arco',
    skCircle: 'Círculo',
    skRect: 'Rect.',
    skPolygon: 'Polígono',
    skOffset: 'Desfase',
    skTrim: 'Recortar',
    skConstrain: 'Restringir',
    cHoriz: 'Horizontal',
    cVert: 'Vertical',
    cPerp: 'Perpendicular',
    cPar: 'Paralela',
    cTang: 'Tangente',
    cCoinc: 'Coincidente',
    cEqual: 'Igual',
    skDim: 'Cota',
    ftExtrude: 'Extruir',
    ftExtCut: 'Corte Extr.',
    ftRevolve: 'Revolve',
    ftSweep: 'Sweep',
    ftLoft: 'Loft',
    ftFillet: 'Fillet',
    ftChamfer: 'Chamfer',
    ftShell: 'Shell',
    ftDraft: 'Draft',
    ftHoleWizard: 'Asist. taladro',
    ftThread: 'Rosca',
    ftBoolean: 'Boolean',
    ftPattern: 'Patrón',
    pLin: 'Patrón lineal',
    pCir: 'Patrón circular',
    ftMirror: 'Mirror',
    ftSplit: 'Dividir',
    ftMold: 'Moldes',
    mDraft: 'Análisis de ángulo',
    mCavity: 'Cavidad',
    mCore: 'Macho',
    ftWeld: 'Soldadura',
    wRectTube: 'Tubo rect.',
    wIBeam: 'Viga I',
    wAngle: 'Ángulo',
    wRoundTube: 'Tubo redondo',
    ftArray: 'Array',
    sfAuto: 'Superf. auto',
    sfCross: 'Sección',
    sfRepair: 'Reparar',
    sfSmooth: 'Suavizar',
    sfSimplify: 'Simplificar',
    sfFill: 'Rellenar huecos',
    sfFlip: 'Invertir norm.',
    sfSpike: 'Elim. picos',
    sfRemesh: 'Remallar',
    sfNoise: 'Reducir ruido',
    sfDetach: 'Elim. desprend.',
    smBox: 'Caja',
    smBend: 'Pliegue',
    smFlange: 'Pestaña',
    smHem: 'Dobladillo',
    smUnfold: 'Desplegar',
    evValid: 'Validar',
    evDev: 'Desviación',
    evMeasure: 'Medir',
    evDist: 'Distancia',
    evAngleM: 'Ángulo',
    evRadius: 'Radio',
    evSection: 'Sección',
    evPlanes: 'Planos',
    evPrim: 'Primitivas',
    evExtr: 'Extrusiones',
    evPrint: 'Impresión 3D',
    evFea: 'FEA',
    evThermal: 'Térmico',
    evEcad: 'Térmico PCB',
    evCam: 'Ruta CAM',
    evCamPostLinuxcnc: 'Post: LinuxCNC',
    evCamPostFanuc: 'Post: Fanuc',
    evCamPostMazak: 'Post: Mazak',
    evCamPostHaas: 'Post: Haas',
    evDfm: 'Análisis DFM',
    evDraftAn: 'Análisis de ángulo',
    evMass: 'Propiedades',
    evGdt: 'GD&T',
    evModelParams: 'Parámetros',
    evHistory: 'Historial',
    evDimAdvisor: 'IA Sugerir',
    evGenDesign: 'Diseño gen.',
    evMotion: 'Estudio movim.',
    evModal: 'Análisis modal',
    evSweep: 'Barrido param.',
    evTolerance: 'Tolerancia',
    evSurface: 'Calidad super.',
    evDrawing: 'Plano auto',
    evMfg: 'Canal fabric.',
    fileLabel: 'Archivo',
    importFile: 'Importar',
    recentFiles: 'Archivos recientes',
    recentFilesTip: 'Historial de archivos (solo lectura). Usa Importar arriba para reabrir un archivo.',
    recentFileItemTip: 'Reciente',
    recentFileItemHint: 'Usa Importar para reabrir',
    genShapeFirst: 'Genera una forma para habilitar la exportación',
    export3MF: 'Exportar 3MF (impresión 3D)',
    exportingSTEP: 'Exportando STEP...',
    exportSTEP: 'Exportar STEP',
    exportingGLTF: 'Exportando GLTF...',
    exportGLTFLabel: 'Exportar GLTF (GLB)',
    exportSceneGLB: 'Exportar escena GLB',
    viewAR: 'Ver en AR (WebXR)',
    featureGraph: 'Grafo de dependencias',
    nesting: 'Anidado (Pack. 2D)',
    threadHole: 'Rosca y taladro',
    variants: 'Variantes de diseño',
    myPartsLib: 'Mi biblioteca',
    timelapse: 'Timelapse sesión',
    stockOptimizer: 'Optim. de stock',
    exportingRhino: 'Exportando Rhino...',
    exportRhinoJSON: 'Exportar Rhino JSON',
    exportingGH: 'Exportando GH...',
    exportGHPoints: 'Exportar puntos Grasshopper',
    saveScene: 'Guardar escena (.nexyfab)',
    loadScene: 'Cargar escena (.nexyfab)',
    exportingDXF: 'Exportando DXF...',
    exportDXF: 'Exportar DXF',
    flatPatternDXF: 'Desarrollo DXF (chapa)',
    exportingPDF: 'Exportando PDF...',
    exportPDF: 'Plano PDF',
    sketchModeTip: 'Modo croquis (atajo: S)',
    undoTip: 'Deshacer (Ctrl+Z)',
    undo: 'Deshacer',
    redoTip: 'Rehacer (Ctrl+Y)',
    redo: 'Rehacer',
    cmdHistory: 'Historial comandos',
    history: 'Historial',
    topoOpt: 'Optim. topológica',
    optimize: 'Optimizar',
    plugins: 'Plugins',
    scriptTip: 'Editor NexyScript',
    script: 'Script',
    shareDesign: 'Compartir diseño',
    share: 'Compartir',
    mfgMatchTip: 'Empareja fabricantes con tu pieza',
    mfgMatch: 'Fabricantes',
    bodyMgrTip: 'Dividir y unir cuerpos',
    bodies: 'Cuerpos',
    moreMenu: 'Más',
  },
  ar: {
    generate: 'تشغيل التحسين',
    exportSTL: 'تصدير STL',
    tabSketch: 'الرسم',
    tabSolid: 'صلب',
    tabSurface: 'سطح',
    tabMesh: 'شبكة',
    tabSheetMetal: 'الصفائح المعدنية',
    tabPlastic: 'بلاستيك',
    tabManage: 'إدارة',
    tabUtilities: 'أدوات',
    tabEvaluate: 'التقييم',
    comingSoon: 'قريبًا — خارطة طريق NexyFab',
    sfLoftSurf: 'سطح Loft',
    sfPatch: 'رقعة',
    sfOffsetSurf: 'سطح إزاحة',
    sfTrimExt: 'قص السطح',
    surfaceLoftStackHint: 'يضيف Loft إلى شجرة الميزات',
    surfacePatchStackHint: 'يضيف سطح حدودي إلى الشجرة',
    plRib: 'ضلع',
    plBoss: 'برج',
    plSnap: 'تثبيت طقطقة',
    plGrill: 'شبكة',
    plLip: 'شفة وأخدود',
    plDraft: 'مسودة بلاستيك',
    ribbonSfOffsetStack: 'إضافة سطح NURBS (مثل الإزاحة)',
    ribbonSfTrimStack: 'إضافة تقسيم جسم (مثل القص)',
    ribbonPlRibStack: 'إضافة قشرة (جدار رقيق؛ بداية ضلع)',
    ribbonPlBossStack: 'إضافة أدوات قالب (نتوء)',
    ribbonPlSnapStack: 'إضافة أدوات قالب (تثبيت طقطقة)',
    ribbonPlGrillStack: 'إضافة أدوات قالب (شبكة تهوية)',
    ribbonPlLipStack: 'إضافة أدوات قالب (شفة وأخدود)',
    ribbonPlDraftStack: 'إضافة ميزان سقوط (draft)',
    grRibbonCreate: 'إنشاء',
    grRibbonModify: 'تعديل',
    grRibbonHole: 'ثقب / برغي / بوليان',
    grRibbonPattern: 'تكرار / تقسيم',
    grRibbonMold: 'قالب',
    grRibbonWeld: 'لحام',
    grRibbonArray: 'مصفوفة',
    grRibbonSkCreate: 'إنشاء',
    grRibbonSkModify: 'تعديل',
    grRibbonSkConstraints: 'قيود',
    grRibbonSkInspect: 'فحص',
    grRibbonSkInsert: 'إدراج',
    grRibbonSkSelect: 'تحديد',
    skInsertImport: 'لوحة / ملف',
    skInsertImportHint: 'استيراد صورة أو STL أو STEP أو DXF كمرجع للرسم',
    skInspectMeasureHint: 'قياس في العرض ثلاثي الأبعاد',
    skSelectFilter: 'تحديد',
    grRibbonMeshRepair: 'إصلاح',
    grRibbonMeshRefine: 'إعادة شبكة',
    grRibbonSurfExtract: 'استخراج',
    grRibbonSurfBuild: 'لوفت / رقع',
    grRibbonSurfPlanned: 'إزاحة / قص',
    grRibbonSmForm: 'تشكيل',
    grRibbonSmFlat: 'بسط',
    grRibbonPlFeatures: 'بلاستيك',
    grRibbonMgDoc: 'مستند',
    grRibbonMgCollab: 'تعاون',
    grRibbonMgFile: 'ملف',
    grRibbonUtAddons: 'إضافات',
    grRibbonUtViews: 'عروض',
    grRibbonUtOptimize: 'تحسين',
    grRibbonEvCompare: 'فحص',
    grRibbonEvMeasure: 'قياس',
    grRibbonEvSection: 'مقطع / مستويات',
    grRibbonEvRecognize: 'تمييز',
    grRibbonEvPrint: 'طباعة ثلاثية',
    grRibbonEvPhysics: 'فيزياء',
    grRibbonEvCam: 'CAM / بوست',
    grRibbonEvDfm: 'DFM / مسودة',
    grRibbonEvMass: 'كتلة',
    grRibbonEvGdt: 'GD&T',
    grRibbonEvAdvisor: 'مستشار',
    grRibbonEvGenDesign: 'تصميم توليدي',
    grRibbonEvStudies: 'دراسات',
    grRibbonEvPipeline: 'خط أنابيب',
    skLine: 'خط',
    skArc: 'قوس',
    skCircle: 'دائرة',
    skRect: 'مستطيل',
    skPolygon: 'مضلع',
    skOffset: 'إزاحة',
    skTrim: 'قص',
    skConstrain: 'تقييد',
    cHoriz: 'أفقي',
    cVert: 'عمودي',
    cPerp: 'متعامد',
    cPar: 'متوازي',
    cTang: 'مماس',
    cCoinc: 'متطابق',
    cEqual: 'متساوي',
    skDim: 'أبعاد ذكية',
    ftExtrude: 'بثق بارز',
    ftExtCut: 'قطع بالبثق',
    ftRevolve: 'Revolve',
    ftSweep: 'Sweep',
    ftLoft: 'Loft',
    ftFillet: 'Fillet',
    ftChamfer: 'Chamfer',
    ftShell: 'Shell',
    ftDraft: 'Draft',
    ftHoleWizard: 'معالج الثقب',
    ftThread: 'Thread',
    ftBoolean: 'Boolean',
    ftPattern: 'Pattern',
    pLin: 'نمط خطي',
    pCir: 'نمط دائري',
    ftMirror: 'Mirror',
    ftSplit: 'تقسيم',
    ftMold: 'أدوات القالب',
    mDraft: 'تحليل السحب',
    mCavity: 'التجويف',
    mCore: 'النواة',
    ftWeld: 'لحام',
    wRectTube: 'أنبوب مستطيل',
    wIBeam: 'عارضة I',
    wAngle: 'زاوية',
    wRoundTube: 'أنبوب دائري',
    ftArray: 'Array',
    sfAuto: 'سطح تلقائي',
    sfCross: 'مقطع عرضي',
    sfRepair: 'إصلاح',
    sfSmooth: 'تنعيم',
    sfSimplify: 'تبسيط',
    sfFill: 'ملء الثقوب',
    sfFlip: 'قلب الأعمدة',
    sfSpike: 'إزالة النتوءات',
    sfRemesh: 'إعادة التشبيك',
    sfNoise: 'تقليل الضوضاء',
    sfDetach: 'إزالة المنفصلة',
    smBox: 'صندوق معدني',
    smBend: 'ثني',
    smFlange: 'شفة',
    smHem: 'حاشية',
    smUnfold: 'فرد',
    evValid: 'التحقق من الشكل',
    evDev: 'تحليل الانحراف',
    evMeasure: 'قياس',
    evDist: 'المسافة',
    evAngleM: 'الزاوية',
    evRadius: 'نصف القطر',
    evSection: 'تحليل المقطع',
    evPlanes: 'المستويات المرجعية',
    evPrim: 'اكتشاف الأوليات',
    evExtr: 'اكتشاف البثق',
    evPrint: 'تحليل الطباعة 3D',
    evFea: 'FEA',
    evThermal: 'تحليل حراري',
    evEcad: 'تخطيط PCB الحراري',
    evCam: 'مسار CAM',
    evCamPostLinuxcnc: 'ما بعد: LinuxCNC',
    evCamPostFanuc: 'ما بعد: Fanuc',
    evCamPostMazak: 'ما بعد: Mazak',
    evCamPostHaas: 'ما بعد: Haas',
    evDfm: 'تحليل DFM',
    evDraftAn: 'تحليل السحب',
    evMass: 'خصائص الكتلة',
    evGdt: 'GD&T',
    evModelParams: 'معلمات النموذج',
    evHistory: 'السجل',
    evDimAdvisor: 'اقتراح AI',
    evGenDesign: 'تصميم توليدي',
    evMotion: 'دراسة الحركة',
    evModal: 'التردد الطبيعي',
    evSweep: 'مسح معلمي',
    evTolerance: 'تراكم التفاوت',
    evSurface: 'جودة السطح',
    evDrawing: 'رسم تلقائي',
    evMfg: 'خط التصنيع',
    fileLabel: 'ملف',
    importFile: 'استيراد',
    recentFiles: 'الملفات الأخيرة',
    recentFilesTip: 'سجل الملفات للقراءة فقط. استخدم استيراد أعلاه لإعادة فتح الملف.',
    recentFileItemTip: 'أخير',
    recentFileItemHint: 'استخدم استيراد لإعادة الفتح',
    genShapeFirst: 'أنشئ شكلاً لتمكين التصدير',
    export3MF: 'تصدير 3MF (طباعة 3D)',
    exportingSTEP: 'جاري تصدير STEP...',
    exportSTEP: 'تصدير STEP',
    exportingGLTF: 'جاري تصدير GLTF...',
    exportGLTFLabel: 'تصدير GLTF (GLB)',
    exportSceneGLB: 'تصدير المشهد GLB',
    viewAR: 'عرض في AR (WebXR)',
    featureGraph: 'رسم تبعية Feature',
    nesting: 'التعشيش (تعبئة 2D)',
    threadHole: 'تعليق Thread / Hole',
    variants: 'متغيرات التصميم',
    myPartsLib: 'مكتبة القطع الخاصة بي',
    timelapse: 'تيمابس الجلسة',
    stockOptimizer: 'تحسين مخزون المواد',
    exportingRhino: 'جاري تصدير Rhino...',
    exportRhinoJSON: 'تصدير Rhino JSON',
    exportingGH: 'جاري تصدير GH...',
    exportGHPoints: 'تصدير نقاط Grasshopper',
    saveScene: 'حفظ المشهد (.nexyfab)',
    loadScene: 'تحميل المشهد (.nexyfab)',
    exportingDXF: 'جاري تصدير DXF...',
    exportDXF: 'تصدير DXF',
    flatPatternDXF: 'نمط مسطح DXF (صفائح معدنية)',
    exportingPDF: 'جاري تصدير PDF...',
    exportPDF: 'رسم PDF',
    sketchModeTip: 'وضع الرسم (اختصار: S)',
    undoTip: 'تراجع (Ctrl+Z)',
    undo: 'تراجع',
    redoTip: 'إعادة (Ctrl+Y)',
    redo: 'إعادة',
    cmdHistory: 'سجل الأوامر',
    history: 'السجل',
    topoOpt: 'تحسين طوبولوجي',
    optimize: 'تحسين',
    plugins: 'الإضافات',
    scriptTip: 'محرر NexyScript',
    script: 'سكريبت',
    shareDesign: 'مشاركة التصميم',
    share: 'مشاركة',
    mfgMatchTip: 'مطابقة المصنعين بناءً على المادة والشكل',
    mfgMatch: 'مطابقة المصنعين',
    bodyMgrTip: 'إدارة تقسيم ودمج الأجسام',
    bodies: 'الأجسام',
    moreMenu: 'المزيد',
  },
} as const;

/* ── Export loading spinner (injected once) ─────────────────────────────── */
if (typeof document !== 'undefined') {
  const styleId = '__nexyfab_toolbar_spin';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
      @keyframes __nf_spin { to { transform: rotate(360deg); } }
      .__nf_exporting { display:inline-block; animation: __nf_spin 1s linear infinite; }
    `;
    document.head.appendChild(s);
  }
}
import NotificationBell from './NotificationBell';
import { sketchRibbonFullTitle } from './sketch/sketchToolHints';

/* ─── Types ─────────────────────────────────────────────────────────────── */

/** Ribbon tabs (capabilities map to existing NexyFab actions where possible). */
type CommandTab =
  | 'sketch'
  | 'solid'
  | 'surface'
  | 'mesh'
  | 'sheetmetal'
  | 'plastic'
  | 'manage'
  | 'utilities'
  | 'evaluate';

interface ToolBtn {
  id: string;
  icon: string;
  label: string;
  action: () => void;
  active?: boolean;
  disabled?: boolean;
  badge?: number;
  sub?: { id: string; icon: string; label: string; action: () => void }[];
  dataTour?: string;
  /** Tooltip (e.g. roadmap placeholder). */
  title?: string;
}

interface CommandToolbarProps {
  activeTab: 'design' | 'optimize';
  isSketchMode: boolean;
  editMode: EditMode;
  hasResult: boolean;
  onSketchMode: (on: boolean) => void;
  onFinishSketch?: () => void;
  onCancelSketch?: () => void;
  onEditMode: (mode: EditMode) => void;
  onAddFeature: (type: FeatureType) => void;
  onSendToOptimizer: () => void;
  onExportSTL: () => void;
  onToggleChat: () => void;
  onUndo: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  showHistoryPanel?: boolean;
  onToggleHistory?: () => void;
  showChat: boolean;
  isOptimizing: boolean;
  onGenerate: () => void;
  canGenerate: boolean;
  resultMesh: boolean;
  measureActive?: boolean;
  onToggleMeasure?: () => void;
  measureMode?: 'distance' | 'angle' | 'radius';
  onSetMeasureMode?: (mode: 'distance' | 'angle' | 'radius') => void;
  sectionActive?: boolean;
  onToggleSection?: () => void;
  onTogglePlanes?: () => void;
  showPlanes?: boolean;
  onImportFile?: () => void;
  /** In sketch mode, ribbon “Insert” opens sketch reference file picker instead of full part import. */
  onSketchInsertReference?: () => void;
  /** Add feature with param overrides (e.g. plastic ribbon presets). */
  onAddFeatureWithParams?: (type: FeatureType, overrides: Record<string, number>) => void;
  /** Tooltip: workspace import vs sketch tracing (from LOCAL_LABELS). */
  fileImportMenuHint?: string;
  onExportOBJ?: () => void;
  onExportPLY?: () => void;
  onExport3MF?: () => void;
  onExportSTEP?: () => void;
  onExportGLTF?: () => void;
  onExportDXF?: () => void;
  onExportFlatPatternDXF?: () => void;
  onSaveScene?: () => void;
  onLoadScene?: () => void;
  onExportGLB?: () => void;
  onExportRhino?: () => void;
  onExportGrasshopper?: () => void;
  /** Formats NOT in the user's plan — render 🔒 PRO badge next to those items. */
  lockedFormats?: string[];
  dxfProjection?: 'xy' | 'xz' | 'yz';
  onDxfProjectionChange?: (axis: 'xy' | 'xz' | 'yz') => void;
  onMeshProcess?: (op: string) => void;
  onAnalysis?: (type: string) => void;
  onStandardParts?: () => void;
  onSheetMetal?: (op: string) => void;
  onExtraction?: (type: string) => void;
  onSketchTool?: (tool: string) => void;
  onConstraint?: (type: string) => void;
  onSmartDimension?: () => void;
  onExtrudeCut?: () => void;
  onHoleWizard?: () => void;
  showLibrary?: boolean;
  showValidation?: boolean;
  onTogglePlugins?: () => void;
  onToggleScript?: () => void;
  onExportDrawingPDF?: () => void;
  onShare?: () => void;
  onManufacturerMatch?: () => void;
  onBodyManager?: () => void;
  exportingFormat?: string | null;
  /** Called when user picks a CAM post-processor from the menu */
  onSetCamPost?: (id: string) => void;
  /** Current active CAM post-processor id — shown as a checkmark in the menu */
  activeCamPost?: string;
  /** Model Parameters panel toggle */
  showModelParams?: boolean;
  onToggleModelParams?: () => void;
  /** Number of DFM issues from last auto-analysis — shown as badge on DFM button */
  dfmIssueCount?: number;
  /** Open WebXR AR viewer */
  onViewAR?: () => void;
  /** Open Feature Dependency Graph */
  onViewFeatureGraph?: () => void;
  /** Open Nesting Tool */
  onViewNesting?: () => void;
  /** Open Thread/Hole Callout Panel */
  onViewThreadHole?: () => void;
  /** Open Design Variants Panel */
  onViewVariants?: () => void;
  /** Open User Parts Library */
  onViewUserParts?: () => void;
  /** Open Session Timelapse */
  onViewTimelapse?: () => void;
  /** Open Material Stock Optimizer */
  onViewStockOptimizer?: () => void;
  /** 2D sketch: cycle pick filter (all → edges only → vertices only). */
  onCycleSketchPickFilter?: () => void;
  /** Current sketch pick mode description for the Selection ribbon tooltip. */
  sketchPickFilterHint?: string;
  t: Record<string, string>;
  lang?: string;
}

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const C_DARK = {
  bg: '#161b22',
  tabBar: '#1b1f27',
  border: '#30363d',
  accent: '#388bfd',
  text: '#c9d1d9',
  textDim: '#8b949e',
  hover: '#30363d',
  dropBg: '#21262d',
};

const C_LIGHT_RIBBON = {
  bg: '#f6f8fa',
  tabBar: '#ffffff',
  border: '#d0d7de',
  accent: '#0969da',
  text: '#24292f',
  textDim: '#57606a',
  hover: '#eaeef2',
  dropBg: '#ffffff',
};

const S = {
  wrapper: {
    display: 'flex', flexDirection: 'column' as const, flexShrink: 0,
    background: C_DARK.bg, borderBottom: `1px solid ${C_DARK.border}`,
    userSelect: 'none' as const,
  } as React.CSSProperties,
  topRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
    gap: 0,
    background: C_DARK.tabBar,
    borderBottom: `1px solid ${C_DARK.border}`,
    padding: '0 8px',
    minHeight: 30,
    rowGap: 2,
  } as React.CSSProperties,
  fileBtn: {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '3px 10px', marginRight: 4, borderRadius: 4,
    border: 'none', background: 'transparent', color: C_DARK.text,
    fontSize: 12, fontWeight: 600, cursor: 'pointer', height: 26,
    position: 'relative' as const,
  } as React.CSSProperties,
  tab: (active: boolean) => ({
    padding: '6px 16px', border: 'none', borderRadius: 0,
    background: active ? C_DARK.bg : 'transparent',
    color: active ? '#fff' : C_DARK.textDim,
    fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer',
    borderBottom: active ? `2px solid ${C_DARK.accent}` : '2px solid transparent',
    transition: 'all 0.12s', height: '100%',
    display: 'flex', alignItems: 'center',
  }),
  /** Wrap to extra rows instead of a horizontal scrollbar for ribbon readability. */
  strip: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignItems: 'flex-start',
    alignContent: 'flex-start',
    gap: '4px 2px',
    rowGap: 4,
    padding: '6px 6px 4px',
    background: C_DARK.bg,
    overflowX: 'visible' as const,
    overflowY: 'visible' as const,
    minHeight: 44,
  } as React.CSSProperties,
  toolBtn: (active?: boolean, disabled?: boolean) => ({
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
    justifyContent: 'flex-start', gap: 1,
    width: 50, minWidth: 50, padding: '3px 2px 2px', borderRadius: 6,
    border: 'none', background: active ? C_DARK.accent : 'transparent',
    color: active ? '#fff' : disabled ? '#6e7681' : C_DARK.text,
    cursor: disabled ? 'default' : 'pointer',
    fontSize: 10, fontWeight: 600, transition: 'background 0.1s',
    opacity: disabled ? 0.5 : 1, position: 'relative' as const,
    lineHeight: 1.2,
  }),
  toolIcon: { fontSize: 17, lineHeight: 1, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  toolLabel: { fontSize: 9, textAlign: 'center' as const, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 48 },
  sep: { width: 1, height: 34, background: C_DARK.border, margin: '2px 4px', flexShrink: 0 } as React.CSSProperties,
  dropdown: (top: number, left: number) => ({
    position: 'fixed' as const, top, left,
    background: C_DARK.dropBg, border: `1px solid ${C_DARK.border}`,
    borderRadius: 8, padding: 4, zIndex: 9999, minWidth: 170,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  } as React.CSSProperties),
  dropItem: {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    padding: '7px 12px', borderRadius: 5, border: 'none',
    background: 'transparent', color: C_DARK.text, cursor: 'pointer',
    fontSize: 12, fontWeight: 500, textAlign: 'left' as const,
    transition: 'background 0.08s',
  } as React.CSSProperties,
  rightActions: {
    display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto',
  } as React.CSSProperties,
  smallBtn: (active: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '4px 10px', borderRadius: 5, border: 'none',
    background: active ? C_DARK.accent : 'transparent',
    color: active ? '#fff' : C_DARK.text,
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
    transition: 'background 0.1s',
  }),
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function ToolButton({ tool, openSub, onOpenSub, onClose }: {
  tool: ToolBtn; openSub: string | null;
  onOpenSub: (id: string) => void; onClose: () => void;
}) {
  const tcx = C_DARK;
  const btnStyle: React.CSSProperties = {
    ...S.toolBtn(tool.active, tool.disabled),
  };
  const hasSub = tool.sub && tool.sub.length > 0;
  const isOpen = openSub === tool.id;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);

  const handleOpen = () => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const top = rect.bottom + 6;
    const left = rect.left + rect.width / 2 - 85; // 85 = half of minWidth 170
    setDropPos({ top, left: Math.max(8, left) });
    onOpenSub(tool.id);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        data-tour={tool.dataTour}
        style={btnStyle}
        onClick={() => { if (tool.disabled) return; hasSub ? handleOpen() : (tool.action(), onClose()); }}
        onMouseEnter={e => { if (!tool.active && !tool.disabled) (e.currentTarget.style.background = tcx.hover); }}
        onMouseLeave={e => { if (!tool.active) (e.currentTarget.style.background = 'transparent'); }}
        title={tool.title ?? tool.label}
      >
        <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <span style={S.toolIcon}>{tool.icon}</span>
          {tool.badge != null && tool.badge > 0 && (
            <span style={{
              position: 'absolute', top: -5, right: -7,
              minWidth: 14, height: 14, borderRadius: 7,
              background: '#f85149', color: '#fff',
              fontSize: 9, fontWeight: 800, lineHeight: '14px',
              textAlign: 'center', padding: '0 2px',
              pointerEvents: 'none',
            }}>
              {tool.badge > 99 ? '99+' : tool.badge}
            </span>
          )}
        </span>
        <span style={S.toolLabel}>{tool.label}{hasSub ? ' ▾' : ''}</span>
      </button>
      {hasSub && isOpen && dropPos && (
        <div style={{ ...S.dropdown(dropPos.top, dropPos.left), background: tcx.dropBg, border: `1px solid ${tcx.border}` }}>
          {tool.sub!.map(s => (
            <button key={s.id} style={{ ...S.dropItem, color: tcx.text }}
              onClick={() => { s.action(); onClose(); }}
              onMouseEnter={e => (e.currentTarget.style.background = tcx.hover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{s.icon}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Separator() {
  const tcx = C_DARK;
  return <div style={{ ...S.sep, background: tcx.border }} />;
}

/** Split a flat tool row on `'sep'` markers into labeled ribbon groups. */
function splitToolsOnSeparators(items: (ToolBtn | 'sep')[]): ToolBtn[][] {
  const out: ToolBtn[][] = [];
  let cur: ToolBtn[] = [];
  for (const x of items) {
    if (x === 'sep') {
      if (cur.length) out.push(cur);
      cur = [];
    } else {
      cur.push(x);
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Ribbon tab: icon row + group caption under each cluster. */
function RibbonGrouped({
  tabId,
  groups,
  labels,
  openSub,
  toggleSub,
  closeSub,
}: {
  tabId: CommandTab;
  groups: ToolBtn[][];
  labels: readonly string[];
  openSub: string | null;
  toggleSub: (id: string) => void;
  closeSub: () => void;
}) {
  const tcx = C_DARK;
  return (
    <>
      {groups.map((tools, gi) => (
        <div
          key={`ribbon-${tabId}-${gi}`}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            borderLeft: gi > 0 ? `1px solid ${tcx.border}` : undefined,
            paddingLeft: gi > 0 ? 8 : 0,
            marginLeft: gi > 0 ? 2 : 0,
            paddingRight: 4,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 2 }}>
            {tools.map((tool) => (
              <ToolButton key={tool.id} tool={tool} openSub={openSub} onOpenSub={toggleSub} onClose={closeSub} />
            ))}
          </div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: tcx.textDim,
              marginTop: 5,
              textAlign: 'center',
              maxWidth: 100,
              lineHeight: 1.2,
            }}
          >
            {labels[gi] ?? ''}
          </span>
        </div>
      ))}
    </>
  );
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function CommandToolbar(props: CommandToolbarProps) {
  const {
    activeTab, isSketchMode, editMode, hasResult,
    onSketchMode, onEditMode, onAddFeature,
    onSendToOptimizer, onExportSTL, onToggleChat, onUndo,
    showChat, isOptimizing, onGenerate, canGenerate, resultMesh,
    measureActive, onToggleMeasure, measureMode, onSetMeasureMode, sectionActive, onToggleSection,
    onTogglePlanes, showPlanes,
    onImportFile, onSketchInsertReference, onAddFeatureWithParams, fileImportMenuHint,
    onExportOBJ, onExportPLY, onExport3MF, onExportSTEP, onExportGLTF,
    onExportDXF, onExportFlatPatternDXF, dxfProjection, onDxfProjectionChange,
    onSaveScene, onLoadScene, onExportGLB,
    onExportRhino, onExportGrasshopper, lockedFormats = [],
    onMeshProcess, onAnalysis, onStandardParts,
    onSheetMetal, onExtraction,
    onSketchTool, onConstraint, onSmartDimension,
    onExtrudeCut, onHoleWizard,
    onTogglePlugins,
    onToggleScript,
    onExportDrawingPDF,
    onShare,
    onManufacturerMatch,
    onBodyManager,
    exportingFormat,
    onSetCamPost,
    activeCamPost,
    onRedo, canUndo, canRedo, showHistoryPanel, onToggleHistory,
    showModelParams, onToggleModelParams,
    dfmIssueCount,
    onViewAR, onViewFeatureGraph, onViewNesting, onViewThreadHole, onViewVariants,
    onViewUserParts, onViewTimelapse, onViewStockOptimizer,
    onCycleSketchPickFilter, sketchPickFilterHint,
    t,
    lang,
    onFinishSketch,
    onCancelSketch,
  } = props;

  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const tt = dict[langMap[seg] ?? 'en'];

  const tcx = C_DARK;
  const shellWrapper = S.wrapper;
  const shellTop = S.topRow;
  const shellStrip = S.strip;
  const tabStyle = (active: boolean) => S.tab(active);

  const [commandTab, setCommandTab] = useState<CommandTab>('solid');
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [fileOpen, setFileOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Auto-switch to sketch tab when sketch mode activated
  useEffect(() => {
    if (isSketchMode) setCommandTab('sketch');
  }, [isSketchMode]);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!openSub && !fileOpen && !moreMenuOpen) return;
    const h = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpenSub(null); setFileOpen(false); setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [openSub, fileOpen, moreMenuOpen]);

  const toggleSub = (id: string) => {
    setMoreMenuOpen(false);
    setFileOpen(false);
    setOpenSub(prev => prev === id ? null : id);
  };
  const closeSub = () => { setOpenSub(null); setFileOpen(false); setMoreMenuOpen(false); };

  /* ── Optimize tab ── */
  if (activeTab === 'optimize') {
    return (
      <div ref={wrapRef} style={{ ...S.strip, borderBottom: `1px solid ${C_DARK.border}` }}>
        <ToolButton tool={{ id: 'gen', icon: isOptimizing ? '⏳' : '▶', label: tt.generate, action: onGenerate, disabled: !canGenerate || isOptimizing }} openSub={null} onOpenSub={() => {}} onClose={() => {}} />
        <Separator />
        <ToolButton tool={{ id: 'expStl', icon: '💾', label: tt.exportSTL, action: onExportSTL, disabled: !resultMesh }} openSub={null} onOpenSub={() => {}} onClose={() => {}} />
        <div style={{ flex: 1 }} />
        <button style={S.smallBtn(showChat)} onClick={onToggleChat}>🤖 AI Chat</button>
      </div>
    );
  }

  /* ── Tab definitions (ribbon) ── */
  const tabs: { key: CommandTab; label: string }[] = [
    { key: 'sketch', label: tt.tabSketch },
    { key: 'solid', label: tt.tabSolid },
    { key: 'surface', label: tt.tabSurface },
    { key: 'mesh', label: tt.tabMesh },
    { key: 'sheetmetal', label: tt.tabSheetMetal },
    { key: 'plastic', label: tt.tabPlastic },
    { key: 'manage', label: tt.tabManage },
    { key: 'utilities', label: tt.tabUtilities },
    { key: 'evaluate', label: tt.tabEvaluate },
  ];

  /* ── Tool groups per tab ── */
  /** Sketch tab: Create → Modify → Constraints (+ dim) → Inspect → Insert → Select. */
  const sketchTools: (ToolBtn | 'sep')[] = [
    { id: 'sk-line', icon: '╱', label: tt.skLine, title: sketchRibbonFullTitle(lang, 'sk-line', tt.skLine), action: () => { onSketchMode(true); onSketchTool?.('line'); } },
    { id: 'sk-arc', icon: '◠', label: tt.skArc, title: sketchRibbonFullTitle(lang, 'sk-arc', tt.skArc), action: () => { onSketchMode(true); onSketchTool?.('arc'); } },
    { id: 'sk-circle', icon: '○', label: tt.skCircle, title: sketchRibbonFullTitle(lang, 'sk-circle', tt.skCircle), action: () => { onSketchMode(true); onSketchTool?.('circle'); } },
    { id: 'sk-rect', icon: '▭', label: tt.skRect, title: sketchRibbonFullTitle(lang, 'sk-rect', tt.skRect), action: () => { onSketchMode(true); onSketchTool?.('rectangle'); } },
    { id: 'sk-polygon', icon: '⬡', label: tt.skPolygon, title: sketchRibbonFullTitle(lang, 'sk-polygon', tt.skPolygon), action: () => { onSketchMode(true); onSketchTool?.('polygon'); } },
    'sep',
    { id: 'sk-offset', icon: '⧈', label: tt.skOffset, title: sketchRibbonFullTitle(lang, 'sk-offset', tt.skOffset), action: () => { onSketchMode(true); onSketchTool?.('offset'); } },
    { id: 'sk-trim', icon: '✂', label: tt.skTrim, title: sketchRibbonFullTitle(lang, 'sk-trim', tt.skTrim), action: () => { onSketchMode(true); onSketchTool?.('trim'); } },
    'sep',
    { id: 'sk-constraint', icon: '🔗', label: tt.skConstrain, title: sketchRibbonFullTitle(lang, 'sk-constraint', tt.skConstrain), action: () => {},
      sub: [
        { id: 'c-horiz', icon: '─', label: tt.cHoriz, action: () => onConstraint?.('horizontal') },
        { id: 'c-vert', icon: '│', label: tt.cVert, action: () => onConstraint?.('vertical') },
        { id: 'c-perp', icon: '⊥', label: tt.cPerp, action: () => onConstraint?.('perpendicular') },
        { id: 'c-par', icon: '∥', label: tt.cPar, action: () => onConstraint?.('parallel') },
        { id: 'c-tang', icon: '⌒', label: tt.cTang, action: () => onConstraint?.('tangent') },
        { id: 'c-coinc', icon: '●', label: tt.cCoinc, action: () => onConstraint?.('coincident') },
        { id: 'c-equal', icon: '=', label: tt.cEqual, action: () => onConstraint?.('equal') },
      ],
    },
    { id: 'sk-dim', icon: '📏', label: tt.skDim, title: sketchRibbonFullTitle(lang, 'sk-dim', tt.skDim), action: () => onSmartDimension?.() },
    'sep',
    { id: 'sk-inspect-measure', icon: '📐', label: tt.evMeasure, action: () => onToggleMeasure?.(), active: measureActive, title: sketchRibbonFullTitle(lang, 'sk-inspect-measure', tt.evMeasure) },
    'sep',
    {
      id: 'sk-insert',
      icon: '📂',
      label: tt.skInsertImport,
      title: sketchRibbonFullTitle(lang, 'sk-insert', tt.skInsertImport),
      action: () => {
        if (isSketchMode && onSketchInsertReference) onSketchInsertReference();
        else onImportFile?.();
      },
    },
    'sep',
    {
      id: 'sk-select-filter',
      icon: '◇',
      label: tt.skSelectFilter,
      action: () => { onCycleSketchPickFilter?.(); },
      disabled: !onCycleSketchPickFilter,
      title: sketchPickFilterHint
        ? `${tt.skSelectFilter} — ${sketchPickFilterHint}`
        : sketchRibbonFullTitle(lang, 'sk-select-filter', tt.skSelectFilter),
    },
  ];

  const featureTools: (ToolBtn | 'sep')[] = [
    { id: 'ft-extrude', icon: '⬆', label: tt.ftExtrude, action: () => onAddFeature('boolean'), active: false },
    { id: 'ft-extcut', icon: '⬇', label: tt.ftExtCut, action: () => onExtrudeCut?.() },
    { id: 'ft-revolve', icon: '🔄', label: tt.ftRevolve, action: () => onAddFeature('revolve') },
    { id: 'ft-sweep', icon: '〰️', label: tt.ftSweep, action: () => onAddFeature('sweep') },
    { id: 'ft-loft', icon: '◈', label: tt.ftLoft, action: () => onAddFeature('loft') },
    'sep',
    { id: 'ft-fillet', icon: '◠', label: tt.ftFillet, action: () => onAddFeature('fillet') },
    { id: 'ft-chamfer', icon: '⬠', label: tt.ftChamfer, action: () => onAddFeature('chamfer') },
    { id: 'ft-shell', icon: '▢', label: tt.ftShell, action: () => onAddFeature('shell') },
    { id: 'ft-draft', icon: '📐', label: tt.ftDraft, action: () => onAddFeature('draft') },
    'sep',
    { id: 'ft-hole', icon: '◎', label: tt.ftHoleWizard, action: () => { if (onHoleWizard) onHoleWizard(); else onAddFeature('hole'); } },
    { id: 'ft-thread', icon: '🔩', label: tt.ftThread, action: () => onAddFeature('thread') },
    { id: 'ft-boolean', icon: '⊕', label: tt.ftBoolean, action: () => onAddFeature('boolean') },
    'sep',
    { id: 'ft-pattern', icon: '⫼', label: tt.ftPattern, action: () => {},
      sub: [
        { id: 'p-lin', icon: '⫼', label: tt.pLin, action: () => onAddFeature('linearPattern') },
        { id: 'p-cir', icon: '◔', label: tt.pCir, action: () => onAddFeature('circularPattern') },
      ],
    },
    { id: 'ft-mirror', icon: '⬌', label: tt.ftMirror, action: () => onAddFeature('mirror') },
    { id: 'ft-split', icon: '✂', label: tt.ftSplit, action: () => onAddFeature('splitBody') },
    'sep',
    { id: 'ft-mold', icon: '🏭', label: tt.ftMold, action: () => {},
      sub: [
        { id: 'm-draft', icon: '📐', label: tt.mDraft, action: () => onAddFeature('moldTools') },
        { id: 'm-cavity', icon: '⬛', label: tt.mCavity, action: () => onAddFeature('moldTools') },
        { id: 'm-core', icon: '⬜', label: tt.mCore, action: () => onAddFeature('moldTools') },
      ],
    },
    'sep',
    { id: 'ft-weld', icon: '🔧', label: tt.ftWeld, action: () => {},
      sub: [
        { id: 'w-recttube', icon: '▭', label: tt.wRectTube, action: () => onAddFeature('weldment') },
        { id: 'w-ibeam', icon: 'Ι', label: tt.wIBeam, action: () => onAddFeature('weldment') },
        { id: 'w-angle', icon: 'L', label: tt.wAngle, action: () => onAddFeature('weldment') },
        { id: 'w-roundtube', icon: '○', label: tt.wRoundTube, action: () => onAddFeature('weldment') },
      ]
    },
    'sep',
    { id: 'ft-array', icon: '⊞', label: tt.ftArray, action: () => onAnalysis?.('array'), disabled: !hasResult },
  ];

  const solidRibbonGroups = splitToolsOnSeparators(featureTools);
  const solidRibbonLabels = [
    tt.grRibbonCreate,
    tt.grRibbonModify,
    tt.grRibbonHole,
    tt.grRibbonPattern,
    tt.grRibbonMold,
    tt.grRibbonWeld,
    tt.grRibbonArray,
  ] as const;

  /** Surface / NURBS-oriented (extraction + feature-stack wiring where supported). */
  const surfaceTools: (ToolBtn | 'sep')[] = [
    { id: 'sf-auto', icon: '🌐', label: tt.sfAuto, action: () => onExtraction?.('autoSurface') },
    { id: 'sf-cross', icon: '🔪', label: tt.sfCross, action: () => onExtraction?.('crossSection') },
    'sep',
    { id: 'sf-loftSurf', icon: '◈', label: tt.sfLoftSurf, action: () => onAddFeature('loft'), disabled: !hasResult, title: tt.surfaceLoftStackHint },
    { id: 'sf-patch', icon: '🧩', label: tt.sfPatch, action: () => onAddFeature('boundarySurface'), disabled: !hasResult, title: tt.surfacePatchStackHint },
    'sep',
    { id: 'sf-offsetSurf', icon: '⧉', label: tt.sfOffsetSurf, action: () => onAddFeature('nurbsSurface'), disabled: !hasResult, title: tt.ribbonSfOffsetStack },
    { id: 'sf-trimExt', icon: '✂', label: tt.sfTrimExt, action: () => onAddFeature('splitBody'), disabled: !hasResult, title: tt.ribbonSfTrimStack },
  ];

  /** Mesh edit / repair (was mixed into Surface). */
  const meshTools: (ToolBtn | 'sep')[] = [
    { id: 'sf-repair', icon: '🔧', label: tt.sfRepair, action: () => onMeshProcess?.('repair'), disabled: !hasResult },
    { id: 'sf-smooth', icon: '✨', label: tt.sfSmooth, action: () => onMeshProcess?.('smooth'), disabled: !hasResult },
    { id: 'sf-simplify', icon: '📉', label: tt.sfSimplify, action: () => onMeshProcess?.('simplify'), disabled: !hasResult },
    { id: 'sf-fill', icon: '🕳️', label: tt.sfFill, action: () => onMeshProcess?.('fillHoles'), disabled: !hasResult },
    { id: 'sf-flip', icon: '↕', label: tt.sfFlip, action: () => onMeshProcess?.('flipNormals'), disabled: !hasResult },
    { id: 'sf-spike', icon: '📌', label: tt.sfSpike, action: () => onMeshProcess?.('removeSpikes'), disabled: !hasResult },
    'sep',
    { id: 'sf-remesh', icon: '🔄', label: tt.sfRemesh, action: () => onMeshProcess?.('remesh'), disabled: !hasResult },
    { id: 'sf-noise', icon: '🔇', label: tt.sfNoise, action: () => onMeshProcess?.('reduceNoise'), disabled: !hasResult },
    { id: 'sf-detach', icon: '✂️', label: tt.sfDetach, action: () => onMeshProcess?.('detached'), disabled: !hasResult },
  ];

  const plasticTools: (ToolBtn | 'sep')[] = [
    { id: 'pl-rib', icon: '▤', label: tt.plRib, action: () => onAddFeature('shell'), disabled: !hasResult, title: tt.ribbonPlRibStack },
    {
      id: 'pl-boss',
      icon: '▣',
      label: tt.plBoss,
      action: () => (onAddFeatureWithParams
        ? onAddFeatureWithParams('moldTools', { operation: 1, pullAxis: 1, draftAngle: 2, splitOffset: 0 })
        : onAddFeature('moldTools')),
      disabled: !hasResult,
      title: tt.ribbonPlBossStack,
    },
    {
      id: 'pl-snap',
      icon: '⌯',
      label: tt.plSnap,
      action: () => (onAddFeatureWithParams
        ? onAddFeatureWithParams('moldTools', { operation: 0, pullAxis: 1, draftAngle: 3, splitOffset: 0 })
        : onAddFeature('moldTools')),
      disabled: !hasResult,
      title: tt.ribbonPlSnapStack,
    },
    {
      id: 'pl-grill',
      icon: '▦',
      label: tt.plGrill,
      action: () => (onAddFeatureWithParams
        ? onAddFeatureWithParams('moldTools', { operation: 2, pullAxis: 2, draftAngle: 2, splitOffset: 0 })
        : onAddFeature('moldTools')),
      disabled: !hasResult,
      title: tt.ribbonPlGrillStack,
    },
    {
      id: 'pl-lip',
      icon: '⌒',
      label: tt.plLip,
      action: () => (onAddFeatureWithParams
        ? onAddFeatureWithParams('moldTools', { operation: 1, pullAxis: 0, draftAngle: 1.5, splitOffset: 3 })
        : onAddFeature('moldTools')),
      disabled: !hasResult,
      title: tt.ribbonPlLipStack,
    },
    { id: 'pl-draft', icon: '📐', label: tt.plDraft, action: () => onAddFeature('draft'), disabled: !hasResult, title: tt.ribbonPlDraftStack },
  ];

  const manageTools: (ToolBtn | 'sep')[] = [
    { id: 'mg-params', icon: '⚙️', label: tt.evModelParams, action: () => onToggleModelParams?.(), active: showModelParams },
    { id: 'mg-history', icon: '🕐', label: tt.evHistory, action: () => onToggleHistory?.(), active: showHistoryPanel },
    'sep',
    { id: 'mg-share', icon: '🔗', label: t.shareLink ?? tt.share, action: () => onShare?.() },
    { id: 'mg-bodies', icon: '⬡', label: tt.bodies, action: () => onBodyManager?.() },
    { id: 'mg-mfg', icon: '🏭', label: tt.mfgMatch, action: () => onManufacturerMatch?.() },
    { id: 'mg-variants', icon: '🔀', label: tt.variants, action: () => onViewVariants?.() },
    'sep',
    { id: 'mg-save', icon: '💾', label: tt.saveScene, action: () => onSaveScene?.() },
    { id: 'mg-load', icon: '📂', label: tt.loadScene, action: () => onLoadScene?.() },
  ];

  const utilitiesTools: (ToolBtn | 'sep')[] = [
    { id: 'ut-plugins', icon: '🧩', label: tt.plugins, action: () => onTogglePlugins?.() },
    { id: 'ut-script', icon: '📜', label: tt.script, action: () => onToggleScript?.() },
    'sep',
    { id: 'ut-ar', icon: '🥽', label: tt.viewAR, action: () => onViewAR?.() },
    { id: 'ut-fgraph', icon: '📊', label: tt.featureGraph, action: () => onViewFeatureGraph?.() },
    { id: 'ut-nest', icon: '📐', label: tt.nesting, action: () => onViewNesting?.() },
    { id: 'ut-thread', icon: '🔩', label: tt.threadHole, action: () => onViewThreadHole?.() },
    { id: 'ut-parts', icon: '📚', label: tt.myPartsLib, action: () => onViewUserParts?.() },
    { id: 'ut-time', icon: '🎬', label: tt.timelapse, action: () => onViewTimelapse?.() },
    { id: 'ut-stock', icon: '📏', label: tt.stockOptimizer, action: () => onViewStockOptimizer?.() },
    'sep',
    { id: 'ut-opt', icon: '🔬', label: tt.optimize, action: () => onSendToOptimizer() },
  ];

  const sheetMetalTools: (ToolBtn | 'sep')[] = [
    { id: 'sm-box', icon: '📦', label: tt.smBox, action: () => onSheetMetal?.('box') },
    { id: 'sm-bend', icon: '↩', label: tt.smBend, action: () => onSheetMetal?.('bend') },
    { id: 'sm-flange', icon: '⌐', label: tt.smFlange, action: () => onSheetMetal?.('flange') },
    { id: 'sm-hem', icon: '↰', label: tt.smHem, action: () => onSheetMetal?.('hem') },
    'sep',
    { id: 'sm-unfold', icon: '📐', label: tt.smUnfold, action: () => onSheetMetal?.('unfold') },
  ];

  const evaluateTools: (ToolBtn | 'sep')[] = [
    { id: 'ev-valid', icon: '✅', label: tt.evValid, action: () => onAnalysis?.('validation'), disabled: !hasResult },
    { id: 'ev-dev', icon: '📏', label: tt.evDev, action: () => onAnalysis?.('deviation'), disabled: !hasResult },
    'sep',
    { id: 'ev-measure', icon: '📐', label: tt.evMeasure, action: () => onToggleMeasure?.(), active: measureActive },
    { id: 'ev-measure-dist', icon: '↔', label: tt.evDist, action: () => { if (!measureActive) onToggleMeasure?.(); onSetMeasureMode?.('distance'); }, active: measureActive && measureMode === 'distance', disabled: false },
    { id: 'ev-measure-angle', icon: '∠', label: tt.evAngleM, action: () => { if (!measureActive) onToggleMeasure?.(); onSetMeasureMode?.('angle'); }, active: measureActive && measureMode === 'angle', disabled: false },
    { id: 'ev-measure-radius', icon: 'R', label: tt.evRadius, action: () => { if (!measureActive) onToggleMeasure?.(); onSetMeasureMode?.('radius'); }, active: measureActive && measureMode === 'radius', disabled: false },
    'sep',
    { id: 'ev-section', icon: '🔪', label: tt.evSection, action: () => onToggleSection?.(), active: sectionActive },
    { id: 'ev-planes', icon: '◫', label: tt.evPlanes, action: () => onTogglePlanes?.(), active: showPlanes },
    'sep',
    { id: 'ev-prim', icon: '🔍', label: tt.evPrim, action: () => onExtraction?.('primitives'), disabled: !hasResult },
    { id: 'ev-extr', icon: '⬆', label: tt.evExtr, action: () => onExtraction?.('extrusions'), disabled: !hasResult },
    'sep',
    { id: 'ev-print', icon: '🖨', label: tt.evPrint, action: () => onAnalysis?.('printability'), disabled: !hasResult, dataTour: 'ev-print-btn' },
    'sep',
    { id: 'ev-fea', icon: '🔬', label: tt.evFea, action: () => onAnalysis?.('fea'), disabled: !hasResult },
    { id: 'ev-thermal', icon: '🌡️', label: tt.evThermal, action: () => onAnalysis?.('thermal'), disabled: !hasResult },
    { id: 'ev-ecad', icon: '🔌', label: tt.evEcad, action: () => onAnalysis?.('ecad'), disabled: !hasResult },
    'sep',
    { id: 'ev-cam', icon: '⚙️', label: tt.evCam, action: () => onAnalysis?.('cam'), disabled: !hasResult },
    { id: 'ev-cam-post-linuxcnc', icon: activeCamPost === 'linuxcnc' ? '✅' : '🔧', label: tt.evCamPostLinuxcnc, action: () => { onSetCamPost?.('linuxcnc'); } },
    { id: 'ev-cam-post-fanuc', icon: activeCamPost === 'fanuc' ? '✅' : '🔧', label: tt.evCamPostFanuc, action: () => { onSetCamPost?.('fanuc'); } },
    { id: 'ev-cam-post-mazak', icon: activeCamPost === 'mazak' ? '✅' : '🔧', label: tt.evCamPostMazak, action: () => { onSetCamPost?.('mazak'); } },
    { id: 'ev-cam-post-haas', icon: activeCamPost === 'haas' ? '✅' : '🔧', label: tt.evCamPostHaas, action: () => { onSetCamPost?.('haas'); } },
    'sep',
    { id: 'ev-dfm', icon: '🏭', label: tt.evDfm, action: () => onAnalysis?.('dfm'), disabled: !hasResult, badge: dfmIssueCount && dfmIssueCount > 0 ? dfmIssueCount : undefined },
    { id: 'ev-draft', icon: '📐', label: tt.evDraftAn, action: () => onAnalysis?.('draftAnalysis'), disabled: !hasResult },
    'sep',
    { id: 'ev-mass', icon: '\u2696', label: tt.evMass, action: () => onAnalysis?.('massProperties'), disabled: !hasResult },
    'sep',
    { id: 'ev-gdt', icon: '⊕', label: tt.evGdt, action: () => onAnalysis?.('gdt'), disabled: !hasResult },
    'sep',
    { id: 'ev-dim-advisor', icon: '🤖', label: tt.evDimAdvisor, action: () => onAnalysis?.('dimensionAdvisor') },
    'sep',
    { id: 'ev-gendesign', icon: '✨', label: tt.evGenDesign, action: () => onAnalysis?.('generativeDesign'), disabled: !hasResult },
    'sep',
    { id: 'ev-motion', icon: '🎬', label: tt.evMotion, action: () => onAnalysis?.('motionStudy') },
    { id: 'ev-modal', icon: '📊', label: tt.evModal, action: () => onAnalysis?.('modalAnalysis'), disabled: !hasResult },
    { id: 'ev-sweep', icon: '📈', label: tt.evSweep, action: () => onAnalysis?.('parametricSweep'), disabled: !hasResult },
    { id: 'ev-tolerance', icon: '📐', label: tt.evTolerance, action: () => onAnalysis?.('toleranceStackup') },
    { id: 'ev-surface', icon: '🔍', label: tt.evSurface, action: () => onAnalysis?.('surfaceQuality'), disabled: !hasResult },
    { id: 'ev-drawing', icon: '📄', label: tt.evDrawing, action: () => onAnalysis?.('autoDrawing'), disabled: !hasResult },
    'sep',
    { id: 'ev-mfg', icon: '🏭', label: tt.evMfg, action: () => onAnalysis?.('mfgPipeline'), disabled: !hasResult },
  ];

  const ribbonGroupedByTab: Record<CommandTab, { groups: ToolBtn[][]; labels: readonly string[] }> = {
    sketch: {
      groups: splitToolsOnSeparators(sketchTools),
      labels: [
        tt.grRibbonSkCreate,
        tt.grRibbonSkModify,
        tt.grRibbonSkConstraints,
        tt.grRibbonSkInspect,
        tt.grRibbonSkInsert,
        tt.grRibbonSkSelect,
      ],
    },
    solid: {
      groups: solidRibbonGroups,
      labels: solidRibbonLabels,
    },
    surface: {
      groups: splitToolsOnSeparators(surfaceTools),
      labels: [tt.grRibbonSurfExtract, tt.grRibbonSurfBuild, tt.grRibbonSurfPlanned],
    },
    mesh: {
      groups: splitToolsOnSeparators(meshTools),
      labels: [tt.grRibbonMeshRepair, tt.grRibbonMeshRefine],
    },
    sheetmetal: {
      groups: splitToolsOnSeparators(sheetMetalTools),
      labels: [tt.grRibbonSmForm, tt.grRibbonSmFlat],
    },
    plastic: {
      groups: splitToolsOnSeparators(plasticTools),
      labels: [tt.grRibbonPlFeatures],
    },
    manage: {
      groups: splitToolsOnSeparators(manageTools),
      labels: [tt.grRibbonMgDoc, tt.grRibbonMgCollab, tt.grRibbonMgFile],
    },
    utilities: {
      groups: splitToolsOnSeparators(utilitiesTools),
      labels: [tt.grRibbonUtAddons, tt.grRibbonUtViews, tt.grRibbonUtOptimize],
    },
    evaluate: {
      groups: splitToolsOnSeparators(evaluateTools),
      labels: [
        tt.grRibbonEvCompare,
        tt.grRibbonEvMeasure,
        tt.grRibbonEvSection,
        tt.grRibbonEvRecognize,
        tt.grRibbonEvPrint,
        tt.grRibbonEvPhysics,
        tt.grRibbonEvCam,
        tt.grRibbonEvDfm,
        tt.grRibbonEvMass,
        tt.grRibbonEvGdt,
        tt.grRibbonEvAdvisor,
        tt.grRibbonEvGenDesign,
        tt.grRibbonEvStudies,
        tt.grRibbonEvPipeline,
      ],
    },
  };

  return (
    <div ref={wrapRef} style={shellWrapper}>
      {/* ── Tab Bar ── */}
      <div className="sg-topbar" style={shellTop}>
        {/* File button (always visible, far left) */}
        <div style={{ position: 'relative', marginRight: 6 }}>
          <button style={{
            ...S.fileBtn,
            background: fileOpen ? C_DARK.hover : 'transparent',
          }}
            onClick={() => { setFileOpen(p => !p); setOpenSub(null); setMoreMenuOpen(false); }}
          >
            📁 {tt.fileLabel} ▾
          </button>
          {fileOpen && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4,
              background: C_DARK.dropBg, border: `1px solid ${C_DARK.border}`,
              borderRadius: 8, padding: 4, zIndex: 9999, minWidth: 200,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}>
              <button
                style={S.dropItem}
                title={fileImportMenuHint}
                onClick={() => { onImportFile?.(); closeSub(); }}
                onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>📂</span>
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  <span>{tt.importFile}</span>
                  <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.75, maxWidth: 220, whiteSpace: 'normal', textAlign: 'left' }}>
                    STEP · STL · OBJ · PLY · DXF
                  </span>
                </span>
              </button>
              {/* Recent Files */}
              {(() => {
                try {
                  const recent = getRecentImportFiles();
                  if (recent.length === 0) return null;
                  return (
                    <>
                      <div style={{ padding: '6px 12px 3px', fontSize: 10, fontWeight: 700, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 5 }}>
                        {tt.recentFiles}
                        <span
                          title={tt.recentFilesTip}
                          style={{ cursor: 'help', fontSize: 10, color: '#484f58', border: '1px solid #484f58', borderRadius: '50%', width: 13, height: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}
                        >?</span>
                      </div>
                      {recent.slice(0, 5).map((f: { name: string; ext: string; date: number }, i: number) => (
                        <div
                          key={i}
                          title={`${tt.recentFileItemTip}: ${f.name}\n${tt.recentFileItemHint}`}
                          style={{ ...S.dropItem, opacity: 0.55, fontSize: 11, cursor: 'default', pointerEvents: 'none', fontStyle: 'italic' } as React.CSSProperties}
                        >
                          <span style={{ fontSize: 13, width: 18, textAlign: 'center' }}>🕐</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f.name}</span>
                          <span style={{ fontSize: 9, color: '#484f58', flexShrink: 0, marginLeft: 4 }}>
                            {new Date(f.date).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                    </>
                  );
                } catch { return null; }
              })()}
              <div style={{ height: 1, background: C_DARK.border, margin: '3px 8px' }} />
              {!hasResult && (
                <div style={{ padding: '4px 12px 2px', fontSize: 10, color: '#6e7681', fontStyle: 'italic' }}>
                  {tt.genShapeFirst}
                </div>
              )}
              <button style={{ ...S.dropItem, opacity: hasResult ? 1 : 0.4 }} disabled={!hasResult} onClick={() => { if (hasResult) { onExportSTL(); closeSub(); } }}
                onMouseEnter={e => { if (hasResult) e.currentTarget.style.background = C_DARK.hover; }}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>💾</span>
                <span>Export STL</span>
              </button>
              <button style={{ ...S.dropItem, opacity: hasResult ? 1 : 0.4 }} disabled={!hasResult} onClick={() => { if (hasResult) { onExportOBJ?.(); closeSub(); } }}
                onMouseEnter={e => { if (hasResult) e.currentTarget.style.background = C_DARK.hover; }}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>💾</span>
                <span>Export OBJ</span>
              </button>
              <button style={{ ...S.dropItem, opacity: hasResult ? 1 : 0.4 }} disabled={!hasResult} onClick={() => { if (hasResult) { onExportPLY?.(); closeSub(); } }}
                onMouseEnter={e => { if (hasResult) e.currentTarget.style.background = C_DARK.hover; }}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>💾</span>
                <span>Export PLY</span>
              </button>
              <button style={{ ...S.dropItem, opacity: hasResult ? 1 : 0.4 }} disabled={!hasResult} onClick={() => { if (hasResult) { onExport3MF?.(); closeSub(); } }}
                onMouseEnter={e => { if (hasResult) e.currentTarget.style.background = C_DARK.hover; }}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>🖨️</span>
                <span>{tt.export3MF}</span>
              </button>
              <button style={{ ...S.dropItem, opacity: (!hasResult || exportingFormat === 'STEP') ? 0.4 : 1 }} disabled={!hasResult || exportingFormat === 'STEP'} onClick={() => { onExportSTEP?.(); closeSub(); }}
                onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{exportingFormat === 'STEP' ? <span className="__nf_exporting">⟳</span> : '💾'}</span>
                <span>{exportingFormat === 'STEP' ? tt.exportingSTEP : tt.exportSTEP}</span>
                {lockedFormats.includes('step') && <span style={{ marginLeft: 'auto', fontSize: 9, background: '#8b5cf6', color: '#fff', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>🔒 PRO</span>}
              </button>
              <button style={{ ...S.dropItem, opacity: (!hasResult || exportingFormat === 'GLTF') ? 0.4 : 1 }} disabled={!hasResult || exportingFormat === 'GLTF'} onClick={() => { onExportGLTF?.(); closeSub(); }}
                onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{exportingFormat === 'GLTF' ? <span className="__nf_exporting">⟳</span> : '💾'}</span>
                <span>{exportingFormat === 'GLTF' ? tt.exportingGLTF : tt.exportGLTFLabel}</span>
                {lockedFormats.includes('gltf') && <span style={{ marginLeft: 'auto', fontSize: 9, background: '#8b5cf6', color: '#fff', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>🔒 PRO</span>}
              </button>
              <button style={{ ...S.dropItem, opacity: hasResult ? 1 : 0.4 }} disabled={!hasResult} onClick={() => { if (hasResult) { onExportGLB?.(); closeSub(); } }}
                onMouseEnter={e => { if (hasResult) e.currentTarget.style.background = C_DARK.hover; }}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>📦</span>
                <span>{tt.exportSceneGLB}</span>
              </button>
              {onViewAR && (
                <button style={{ ...S.dropItem, opacity: hasResult ? 1 : 0.4 }} disabled={!hasResult} onClick={() => { if (hasResult) { onViewAR(); closeSub(); } }}
                  onMouseEnter={e => { if (hasResult) e.currentTarget.style.background = C_DARK.hover; }}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>📱</span>
                  <span>{tt.viewAR}</span>
                </button>
              )}
              {onViewFeatureGraph && (
                <button style={S.dropItem} onClick={() => { onViewFeatureGraph(); closeSub(); }}
                  onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>🕸</span>
                  <span>{tt.featureGraph}</span>
                </button>
              )}
              {onViewNesting && (
                <button style={S.dropItem} onClick={() => { onViewNesting(); closeSub(); }}
                  onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>🧩</span>
                  <span>{tt.nesting}</span>
                </button>
              )}
              {onViewThreadHole && (
                <button style={S.dropItem} onClick={() => { onViewThreadHole(); closeSub(); }}
                  onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>🔩</span>
                  <span>{tt.threadHole}</span>
                </button>
              )}
              {onViewVariants && (
                <button style={S.dropItem} onClick={() => { onViewVariants(); closeSub(); }}
                  onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>🎨</span>
                  <span>{tt.variants}</span>
                </button>
              )}
              {onViewUserParts && (
                <button style={S.dropItem} onClick={() => { onViewUserParts(); closeSub(); }}
                  onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>📚</span>
                  <span>{tt.myPartsLib}</span>
                </button>
              )}
              {onViewTimelapse && (
                <button style={S.dropItem} onClick={() => { onViewTimelapse(); closeSub(); }}
                  onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>🎬</span>
                  <span>{tt.timelapse}</span>
                </button>
              )}
              {onViewStockOptimizer && (
                <button style={S.dropItem} onClick={() => { onViewStockOptimizer(); closeSub(); }}
                  onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>📏</span>
                  <span>{tt.stockOptimizer}</span>
                </button>
              )}
              <div style={{ height: 1, background: C_DARK.border, margin: '3px 8px' }} />
              <button style={{ ...S.dropItem, opacity: (!hasResult || exportingFormat === 'Rhino') ? 0.4 : 1 }} disabled={!hasResult || exportingFormat === 'Rhino'} onClick={() => { onExportRhino?.(); closeSub(); }}
                onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{exportingFormat === 'Rhino' ? <span className="__nf_exporting">⟳</span> : '🦏'}</span>
                <span>{exportingFormat === 'Rhino' ? tt.exportingRhino : (t.exportRhino ?? tt.exportRhinoJSON)}</span>
                {lockedFormats.includes('rhino') && <span style={{ marginLeft: 'auto', fontSize: 9, background: '#ec4899', color: '#fff', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>🔒 TEAM</span>}
              </button>
              <button style={{ ...S.dropItem, opacity: (!hasResult || exportingFormat === 'Grasshopper') ? 0.4 : 1 }} disabled={!hasResult || exportingFormat === 'Grasshopper'} onClick={() => { onExportGrasshopper?.(); closeSub(); }}
                onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{exportingFormat === 'Grasshopper' ? <span className="__nf_exporting">⟳</span> : '🌿'}</span>
                <span>{exportingFormat === 'Grasshopper' ? tt.exportingGH : (t.exportGrasshopper ?? tt.exportGHPoints)}</span>
                {lockedFormats.includes('grasshopper') && <span style={{ marginLeft: 'auto', fontSize: 9, background: '#ec4899', color: '#fff', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>🔒 TEAM</span>}
              </button>
              <div style={{ height: 1, background: C_DARK.border, margin: '3px 8px' }} />
              <button style={S.dropItem} onClick={() => { onSaveScene?.(); closeSub(); }}
                onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>💾</span>
                <span>{tt.saveScene}</span>
              </button>
              <button style={S.dropItem} onClick={() => { onLoadScene?.(); closeSub(); }}
                onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>📂</span>
                <span>{tt.loadScene}</span>
              </button>
              <div style={{ height: 1, background: C_DARK.border, margin: '3px 8px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px' }}>
                <button style={{ ...S.dropItem, opacity: exportingFormat === 'DXF' ? 0.6 : 1 }} disabled={exportingFormat === 'DXF'} onClick={() => { onExportDXF?.(); closeSub(); }}
                  onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{exportingFormat === 'DXF' ? <span className="__nf_exporting">⟳</span> : '📐'}</span>
                  <span>{exportingFormat === 'DXF' ? tt.exportingDXF : tt.exportDXF}</span>
                  {lockedFormats.includes('dxf') && <span style={{ marginLeft: 'auto', fontSize: 9, background: '#8b5cf6', color: '#fff', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>🔒 PRO</span>}
                </button>
                <button style={S.dropItem} onClick={() => { onExportFlatPatternDXF?.(); closeSub(); }}
                  onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>📏</span>
                  <span>{tt.flatPatternDXF}</span>
                </button>
                <select
                  value={dxfProjection ?? 'xy'}
                  onChange={e => onDxfProjectionChange?.(e.target.value as 'xy' | 'xz' | 'yz')}
                  onClick={e => e.stopPropagation()}
                  style={{
                    background: '#0d1117', color: C_DARK.text, border: `1px solid ${C_DARK.border}`,
                    borderRadius: 4, padding: '2px 6px', fontSize: 11, cursor: 'pointer',
                    marginLeft: 'auto',
                  }}
                >
                  <option value="xy">XY</option>
                  <option value="xz">XZ</option>
                  <option value="yz">YZ</option>
                </select>
              </div>
              <button style={{ ...S.dropItem, opacity: exportingFormat === 'PDF' ? 0.6 : 1 }} disabled={exportingFormat === 'PDF'} onClick={() => { onExportDrawingPDF?.(); closeSub(); }}
                onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>{exportingFormat === 'PDF' ? <span className="__nf_exporting">⟳</span> : '📄'}</span>
                <span>{exportingFormat === 'PDF' ? tt.exportingPDF : tt.exportPDF}</span>
              </button>
            </div>
          )}
        </div>

        <div style={{ width: 1, height: 20, background: C_DARK.border, marginRight: 4 }} />

        {/* Tabs */}
        {tabs.filter(tab => isSketchMode ? tab.key === 'sketch' : true).map(tab => (
          <button key={tab.key} style={tabStyle(commandTab === tab.key)}
            onClick={() => { setCommandTab(tab.key); closeSub(); }}
            onMouseEnter={e => { if (commandTab !== tab.key) e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { if (commandTab !== tab.key) e.currentTarget.style.color = C_DARK.textDim; }}
            title={tab.key === 'sketch' ? tt.sketchModeTip : undefined}
          >
            {tab.label}
            {tab.key === 'sketch' && !isSketchMode && (
              <span style={{ marginLeft: 4, fontSize: 8, opacity: 0.45, fontFamily: 'monospace', letterSpacing: 0 }}>S</span>
            )}
          </button>
        ))}

        {isSketchMode && (
          <div style={{ display: 'flex', alignItems: 'center', marginLeft: 16, gap: 8 }}>
            <button
              onClick={() => onFinishSketch?.()}
              style={{
                padding: '6px 12px',
                backgroundColor: '#238636',
                color: '#ffffff',
                border: '1px solid rgba(240,246,252,0.1)',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <span style={{ fontSize: 14 }}>✅</span> Finish Sketch
            </button>
            <button
              onClick={() => {
                if (onCancelSketch) onCancelSketch();
                else onSketchMode(false);
              }}
              style={{
                padding: '6px 12px',
                backgroundColor: 'transparent',
                color: '#c9d1d9',
                border: '1px solid #30363d',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Right side: compact undo/redo/history/chat + overflow "more" for power tools */}
        <div style={S.rightActions}>
          <button
            type="button"
            style={{ ...S.smallBtn(false), padding: '3px 8px', minWidth: 30, justifyContent: 'center', opacity: canUndo === false ? 0.4 : 1 }}
            onClick={onUndo}
            disabled={canUndo === false}
            title={`${tt.undoTip} — ${tt.undo}`}
          >
            ↶
          </button>
          <button
            type="button"
            style={{ ...S.smallBtn(false), padding: '3px 8px', minWidth: 30, justifyContent: 'center', opacity: canRedo === false ? 0.4 : 1 }}
            onClick={onRedo}
            disabled={canRedo === false}
            title={`${tt.redoTip} — ${tt.redo}`}
          >
            ↷
          </button>
          <button
            type="button"
            style={{ ...S.smallBtn(!!showHistoryPanel), padding: '3px 8px', minWidth: 30, justifyContent: 'center' }}
            onClick={() => { onToggleHistory?.(); closeSub(); }}
            title={`${tt.cmdHistory} — ${tt.history}`}
          >
            🕐
          </button>
          <button
            type="button"
            style={{ ...S.smallBtn(showChat), padding: '3px 10px', justifyContent: 'center', gap: 5 }}
            onClick={() => { onToggleChat(); closeSub(); }}
            title="AI Chat"
          >
            🤖<span style={{ fontSize: 10, fontWeight: 700 }}>AI</span>
          </button>
          <div style={{ position: 'relative' }}>
              <button
                type="button"
                style={{ ...S.smallBtn(moreMenuOpen), padding: '4px 10px', letterSpacing: 1 }}
                title={tt.moreMenu}
                onClick={() => {
                  setMoreMenuOpen(p => !p);
                  setFileOpen(false);
                  setOpenSub(null);
                }}
              >
                ⋯
              </button>
              {moreMenuOpen && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 4,
                  background: C_DARK.dropBg, border: `1px solid ${C_DARK.border}`,
                  borderRadius: 8, padding: 4, zIndex: 10000, minWidth: 200,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }}>
                  <button type="button" style={S.dropItem} onClick={() => { onSendToOptimizer(); closeSub(); }}
                      onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>🔬</span>
                      <span>{tt.optimize}</span>
                    </button>
                  {onTogglePlugins && (
                    <button type="button" style={S.dropItem} onClick={() => { onTogglePlugins?.(); closeSub(); }}
                      onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>🧩</span>
                      <span>{tt.plugins}</span>
                    </button>
                  )}
                  {onToggleScript && (
                    <button type="button" style={S.dropItem} onClick={() => { onToggleScript?.(); closeSub(); }}
                      onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      title={tt.scriptTip}>
                      <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>📜</span>
                      <span>{tt.script}</span>
                    </button>
                  )}
                  {onShare && (
                    <button type="button" style={S.dropItem} onClick={() => { onShare(); closeSub(); }}
                      onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      title={t.shareDesign ?? tt.shareDesign}>
                      <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>🔗</span>
                      <span>{t.shareLink ?? tt.share}</span>
                    </button>
                  )}
                  {onManufacturerMatch && (
                    <button type="button" style={S.dropItem} onClick={() => { onManufacturerMatch(); closeSub(); }}
                      onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      title={tt.mfgMatchTip}>
                      <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>🏭</span>
                      <span>{tt.mfgMatch}</span>
                    </button>
                  )}
                  {onBodyManager && (
                    <button type="button" style={S.dropItem} onClick={() => { onBodyManager(); closeSub(); }}
                      onMouseEnter={e => (e.currentTarget.style.background = C_DARK.hover)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      title={tt.bodyMgrTip}>
                      <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>⬡</span>
                      <span>{tt.bodies}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          <div style={{ flex: 1 }} />
          {lang && <NotificationBell lang={lang} />}
        </div>
      </div>

      {/* ── Tool Strip ── */}
      <div style={shellStrip}>
        <RibbonGrouped
          tabId={commandTab}
          groups={ribbonGroupedByTab[commandTab].groups}
          labels={ribbonGroupedByTab[commandTab].labels}
          openSub={openSub}
          toggleSub={toggleSub}
          closeSub={closeSub}
        />
      </div>
    </div>
  );
}
