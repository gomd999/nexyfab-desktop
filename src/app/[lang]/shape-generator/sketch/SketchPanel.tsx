'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import type {
  SketchProfile, SketchConfig, SketchTool, ExtrudeMode,
  SketchConstraint, SketchDimension, ConstraintType,
} from './types';

// ─── i18n dict (6 languages) ────────────────────────────────────────────────
const dict = {
  ko: {
    profileClosed: '프로파일 완성',
    drawing: '그리는 중',
    startSketching: '스케치 시작',
    toolLine: '선', toolArc: '호', toolCircle: '원', toolRect: '사각형', toolPolygon: '다각형',
    toolEllipse: '타원', toolSlot: '슬롯', toolFillet: 'Fillet', toolMirror: 'Mirror',
    toolConstruction: '보조선', toolSpline: 'Spline', toolOffset: '오프셋',
    toolTrim: '자르기', toolSelect: '선택', toolDimension: '치수', toolConstraint: '구속조건',
    hintLine: '클릭: 시작점 → 끝점',
    hintArc: '3클릭: 시작 → 통과 → 끝',
    hintCircle: '2클릭: 중심 → 가장자리',
    hintRect: '2클릭: 모서리1 → 모서리2',
    hintPolygon: '2클릭: 중심 → 꼭짓점',
    hintEllipse: '3클릭: 중심 → Rx → Ry',
    hintSlot: '2클릭: 중심1 → 중심2',
    hintSpline: '점 클릭, 더블클릭으로 완료',
    hintFillet: '모서리 꼭짓점을 클릭',
    hintMirror: '2클릭: 축 시작 → 끝',
    hintOffset: '세그먼트 클릭으로 오프셋',
    hintTrim: '세그먼트 클릭으로 자르기',
    hintConstruction: '세그먼트 클릭으로 보조선 전환',
    hintSelect: '클릭 선택, 드래그 이동',
    hintDimension: '세그먼트 클릭으로 치수 추가',
    hintConstraint: '아래에서 구속조건 선택',
    hotkey: '단축키',
    groupShape: '도형', groupEdit: '편집', groupAux: '보조',
    less: '접기', more: '더 보기',
    constraintType: '구속조건 선택',
    cHorizontal: '수평', cVertical: '수직', cPerpendicular: '직교',
    cParallel: '평행', cTangent: '접선', cCoincident: '일치',
    cConcentric: '동심', cEqual: '동일', cSymmetric: '대칭', cMidpoint: '중점',
    cAngle: '각도', cFixed: '고정',
    profiles: '프로파일', currentlyEditing: '현재 편집 중', clickToSwitch: '클릭하여 전환',
    cancel: '취소', confirmDelete: '삭제 확인',
    cannotDeleteOuter: '외부 프로파일은 삭제할 수 없습니다',
    deleteCurrentHole: '현재 홀 프로파일 삭제',
    radius: '반지름', ellipseTitle: '타원', slotTitle: '슬롯', filletTitle: 'Fillet', mirrorTitle: 'Mirror',
    mirrorDesc: '축 위 두 점을 클릭하세요. Shift = Y축 미러',
    constructionTitle: '보조선',
    constructionDesc: '세그먼트를 클릭하면 보조선으로 전환됩니다. 형상 생성에 포함되지 않습니다.',
    dimensionDesc: '세그먼트를 클릭하여 치수를 추가하세요. 치수 텍스트를 클릭하여 값을 편집합니다.',
    overDefined: '과잉 구속', inconsistent: '구속 불일치', underDefined: '구속 부족', ok: '정상',
    dofLabel: '자유도',
    dofTip: '0이면 완전 구속, 양수면 구속 부족, 음수면 과잉 구속',
    residualLabel: '오차',
    residualTip: '구속 조건 해결 오차. 값이 작을수록 정확함',
    unsatLabel: '미충족',
    unsatTip: '이 구속 조건들이 현재 만족되지 않습니다',
    redundantLabel: '중복 구속:', clickToRemove: '클릭하여 제거',
    removeConstraint: '구속 조건 삭제', removeDimension: '치수 삭제',
    del: '삭제', no: '취소없음',
    setup3d: '3D 변환 설정 →',
    unlockHint: '스케치 선분을 연결하여 닫힌 프로파일을 만들어야 3D 변환이 활성화됩니다',
    editSketch: '스케치 수정',
    operationHint: '⬆ Extrude: 두께(Depth)를 지정해 돌출. ↻ Revolve: 회전각으로 원통형 생성. ▼ Cut: 기존 형상에서 잘라냄.',
    confirmClear: '⚠️ 스케치 전체를 지우시겠습니까?', clearAll: '전체 삭제',
    nothingUndo: '되돌릴 선분이 없습니다', undoLast: '마지막 선분 되돌리기 (Ctrl+Z)',
    nothingClear: '지울 스케치가 없습니다', clearAllTip: '스케치 전체 지우기',
  },
  en: {
    profileClosed: 'Profile closed', drawing: 'Drawing', startSketching: 'Start sketching',
    toolLine: 'Line', toolArc: 'Arc', toolCircle: 'Circle', toolRect: 'Rectangle', toolPolygon: 'Polygon',
    toolEllipse: 'Ellipse', toolSlot: 'Slot', toolFillet: 'Fillet', toolMirror: 'Mirror',
    toolConstruction: 'Construction', toolSpline: 'Spline', toolOffset: 'Offset',
    toolTrim: 'Trim', toolSelect: 'Select', toolDimension: 'Dimension', toolConstraint: 'Constraint',
    hintLine: 'Click: start point → end point',
    hintArc: '3 clicks: start → through → end',
    hintCircle: '2 clicks: center → edge',
    hintRect: '2 clicks: corner 1 → corner 2',
    hintPolygon: '2 clicks: center → vertex',
    hintEllipse: '3 clicks: center → Rx → Ry',
    hintSlot: '2 clicks: center 1 → center 2',
    hintSpline: 'Click points, double-click to finish',
    hintFillet: 'Click a corner vertex to fillet',
    hintMirror: '2 clicks: axis start → end',
    hintOffset: 'Click a segment to offset',
    hintTrim: 'Click a segment to trim',
    hintConstruction: 'Click a segment to toggle aux',
    hintSelect: 'Click to select, drag to move',
    hintDimension: 'Click a segment to add dimension',
    hintConstraint: 'Select constraint type below',
    hotkey: 'hotkey',
    groupShape: 'SHAPE', groupEdit: 'EDIT', groupAux: 'AUX',
    less: 'Less', more: 'More',
    constraintType: 'CONSTRAINT TYPE',
    cHorizontal: 'Horizontal', cVertical: 'Vertical', cPerpendicular: 'Perp',
    cParallel: 'Parallel', cTangent: 'Tangent', cCoincident: 'Coincid',
    cConcentric: 'Concent', cEqual: 'Equal', cSymmetric: 'Symm', cMidpoint: 'Midpt',
    cAngle: 'Angle', cFixed: 'Fixed',
    profiles: 'Profiles', currentlyEditing: 'Currently editing', clickToSwitch: 'Click to switch',
    cancel: 'Cancel', confirmDelete: 'Confirm',
    cannotDeleteOuter: 'Cannot delete the outer profile',
    deleteCurrentHole: 'Delete current hole profile',
    radius: 'Radius', ellipseTitle: 'Ellipse', slotTitle: 'Slot', filletTitle: 'Fillet', mirrorTitle: 'Mirror',
    mirrorDesc: 'Click two points on the mirror axis. Shift = mirror about Y axis',
    constructionTitle: 'Construction',
    constructionDesc: 'Click a segment to toggle construction mode. Construction lines are excluded from geometry.',
    dimensionDesc: 'Click a segment to add a dimension. Click dimension text to edit value.',
    overDefined: 'Over-defined', inconsistent: 'Inconsistent', underDefined: 'Under-defined', ok: 'OK',
    dofLabel: 'DOF',
    dofTip: '0 = fully constrained, >0 = under-constrained, <0 = over-constrained',
    residualLabel: 'err',
    residualTip: 'Solver residual error — smaller is better',
    unsatLabel: 'unsat',
    unsatTip: 'These constraints are not currently met',
    redundantLabel: 'Redundant:', clickToRemove: 'Click to remove',
    removeConstraint: 'Remove constraint', removeDimension: 'Remove dimension',
    del: 'Del', no: 'No',
    setup3d: 'Setup 3D →',
    unlockHint: 'Draw connected lines to close the profile — then 3D setup unlocks',
    editSketch: 'Edit Sketch',
    operationHint: '⬆ Extrude: pull sketch into a solid. ↻ Revolve: spin around axis. ▼ Cut: remove material from existing shape.',
    confirmClear: '⚠️ Clear entire sketch?', clearAll: 'Clear All',
    nothingUndo: 'Nothing to undo', undoLast: 'Undo last segment (Ctrl+Z)',
    nothingClear: 'Nothing to clear', clearAllTip: 'Clear all sketch segments',
  },
  ja: {
    profileClosed: 'プロファイル閉じた', drawing: '描画中', startSketching: 'スケッチ開始',
    toolLine: '線', toolArc: '弧', toolCircle: '円', toolRect: '矩形', toolPolygon: '多角形',
    toolEllipse: '楕円', toolSlot: 'スロット', toolFillet: 'Fillet', toolMirror: 'Mirror',
    toolConstruction: '補助線', toolSpline: 'Spline', toolOffset: 'オフセット',
    toolTrim: 'トリム', toolSelect: '選択', toolDimension: '寸法', toolConstraint: '拘束',
    hintLine: 'クリック: 始点 → 終点',
    hintArc: '3クリック: 始点 → 通過点 → 終点',
    hintCircle: '2クリック: 中心 → 端',
    hintRect: '2クリック: 角1 → 角2',
    hintPolygon: '2クリック: 中心 → 頂点',
    hintEllipse: '3クリック: 中心 → Rx → Ry',
    hintSlot: '2クリック: 中心1 → 中心2',
    hintSpline: '点クリック、ダブルクリックで完了',
    hintFillet: '角の頂点をクリック',
    hintMirror: '2クリック: 軸始点 → 終点',
    hintOffset: 'セグメントをクリックしてオフセット',
    hintTrim: 'セグメントをクリックしてトリム',
    hintConstruction: 'セグメントをクリックして補助線切替',
    hintSelect: 'クリックで選択、ドラッグで移動',
    hintDimension: 'セグメントをクリックして寸法追加',
    hintConstraint: '下から拘束タイプを選択',
    hotkey: 'ショートカット',
    groupShape: '形状', groupEdit: '編集', groupAux: '補助',
    less: '閉じる', more: 'もっと見る',
    constraintType: '拘束タイプ',
    cHorizontal: '水平', cVertical: '垂直', cPerpendicular: '直交',
    cParallel: '平行', cTangent: '接線', cCoincident: '一致',
    cConcentric: '同心', cEqual: '同等', cSymmetric: '対称', cMidpoint: '中点',
    cAngle: '角度', cFixed: '固定',
    profiles: 'プロファイル', currentlyEditing: '編集中', clickToSwitch: 'クリックで切替',
    cancel: 'キャンセル', confirmDelete: '削除確認',
    cannotDeleteOuter: '外側プロファイルは削除できません',
    deleteCurrentHole: '現在のホールプロファイルを削除',
    radius: '半径', ellipseTitle: '楕円', slotTitle: 'スロット', filletTitle: 'Fillet', mirrorTitle: 'Mirror',
    mirrorDesc: 'ミラー軸上の2点をクリック。Shift = Y軸ミラー',
    constructionTitle: '補助線',
    constructionDesc: 'セグメントをクリックして補助線モードを切替。形状生成から除外されます。',
    dimensionDesc: 'セグメントをクリックして寸法を追加。寸法テキストをクリックで値を編集。',
    overDefined: '過拘束', inconsistent: '拘束矛盾', underDefined: '拘束不足', ok: '正常',
    dofLabel: '自由度',
    dofTip: '0 = 完全拘束, >0 = 拘束不足, <0 = 過拘束',
    residualLabel: '誤差',
    residualTip: 'ソルバ残差誤差 — 小さいほど良い',
    unsatLabel: '未充足',
    unsatTip: 'これらの拘束は現在満たされていません',
    redundantLabel: '冗長拘束:', clickToRemove: 'クリックで削除',
    removeConstraint: '拘束を削除', removeDimension: '寸法を削除',
    del: '削除', no: 'キャンセル',
    setup3d: '3D変換設定 →',
    unlockHint: 'スケッチの線を接続して閉じたプロファイルを作成すると3D変換が有効になります',
    editSketch: 'スケッチ編集',
    operationHint: '⬆ Extrude: スケッチを厚みで押し出し。↻ Revolve: 軸周り回転。▼ Cut: 既存形状から除去。',
    confirmClear: '⚠️ スケッチ全体をクリアしますか?', clearAll: '全てクリア',
    nothingUndo: '元に戻す対象がありません', undoLast: '最後のセグメントを元に戻す (Ctrl+Z)',
    nothingClear: 'クリアするものがありません', clearAllTip: 'スケッチ全体をクリア',
  },
  zh: {
    profileClosed: '轮廓已闭合', drawing: '绘制中', startSketching: '开始绘制',
    toolLine: '线', toolArc: '弧', toolCircle: '圆', toolRect: '矩形', toolPolygon: '多边形',
    toolEllipse: '椭圆', toolSlot: '槽', toolFillet: 'Fillet', toolMirror: 'Mirror',
    toolConstruction: '辅助线', toolSpline: 'Spline', toolOffset: '偏移',
    toolTrim: '修剪', toolSelect: '选择', toolDimension: '尺寸', toolConstraint: '约束',
    hintLine: '点击: 起点 → 终点',
    hintArc: '3次点击: 起点 → 经过 → 终点',
    hintCircle: '2次点击: 中心 → 边缘',
    hintRect: '2次点击: 角1 → 角2',
    hintPolygon: '2次点击: 中心 → 顶点',
    hintEllipse: '3次点击: 中心 → Rx → Ry',
    hintSlot: '2次点击: 中心1 → 中心2',
    hintSpline: '点击点,双击完成',
    hintFillet: '点击角顶点',
    hintMirror: '2次点击: 轴起点 → 终点',
    hintOffset: '点击线段以偏移',
    hintTrim: '点击线段以修剪',
    hintConstruction: '点击线段切换辅助线',
    hintSelect: '点击选择,拖动移动',
    hintDimension: '点击线段添加尺寸',
    hintConstraint: '在下方选择约束类型',
    hotkey: '快捷键',
    groupShape: '形状', groupEdit: '编辑', groupAux: '辅助',
    less: '收起', more: '更多',
    constraintType: '约束类型',
    cHorizontal: '水平', cVertical: '垂直', cPerpendicular: '垂直',
    cParallel: '平行', cTangent: '相切', cCoincident: '重合',
    cConcentric: '同心', cEqual: '相等', cSymmetric: '对称', cMidpoint: '中点',
    cAngle: '角度', cFixed: '固定',
    profiles: '轮廓', currentlyEditing: '正在编辑', clickToSwitch: '点击切换',
    cancel: '取消', confirmDelete: '确认删除',
    cannotDeleteOuter: '无法删除外部轮廓',
    deleteCurrentHole: '删除当前孔轮廓',
    radius: '半径', ellipseTitle: '椭圆', slotTitle: '槽', filletTitle: 'Fillet', mirrorTitle: 'Mirror',
    mirrorDesc: '点击镜像轴上的两点。Shift = Y轴镜像',
    constructionTitle: '辅助线',
    constructionDesc: '点击线段切换辅助线模式。辅助线不会纳入几何体。',
    dimensionDesc: '点击线段添加尺寸。点击尺寸文本编辑值。',
    overDefined: '过约束', inconsistent: '约束不一致', underDefined: '约束不足', ok: '正常',
    dofLabel: '自由度',
    dofTip: '0 = 完全约束, >0 = 约束不足, <0 = 过约束',
    residualLabel: '误差',
    residualTip: '求解器残差误差 — 越小越好',
    unsatLabel: '未满足',
    unsatTip: '这些约束当前未被满足',
    redundantLabel: '冗余约束:', clickToRemove: '点击移除',
    removeConstraint: '删除约束', removeDimension: '删除尺寸',
    del: '删除', no: '否',
    setup3d: '设置3D →',
    unlockHint: '绘制连接的线以闭合轮廓 — 然后将解锁3D设置',
    editSketch: '编辑草图',
    operationHint: '⬆ Extrude: 将草图拉伸为实体。↻ Revolve: 绕轴旋转。▼ Cut: 从现有形状中去除材料。',
    confirmClear: '⚠️ 清除整个草图?', clearAll: '全部清除',
    nothingUndo: '无可撤销', undoLast: '撤销最后一段 (Ctrl+Z)',
    nothingClear: '无可清除', clearAllTip: '清除所有草图线段',
  },
  es: {
    profileClosed: 'Perfil cerrado', drawing: 'Dibujando', startSketching: 'Empezar boceto',
    toolLine: 'Línea', toolArc: 'Arco', toolCircle: 'Círculo', toolRect: 'Rectángulo', toolPolygon: 'Polígono',
    toolEllipse: 'Elipse', toolSlot: 'Ranura', toolFillet: 'Fillet', toolMirror: 'Mirror',
    toolConstruction: 'Auxiliar', toolSpline: 'Spline', toolOffset: 'Desfase',
    toolTrim: 'Recortar', toolSelect: 'Seleccionar', toolDimension: 'Cota', toolConstraint: 'Restricción',
    hintLine: 'Clic: inicio → fin',
    hintArc: '3 clics: inicio → paso → fin',
    hintCircle: '2 clics: centro → borde',
    hintRect: '2 clics: esquina 1 → esquina 2',
    hintPolygon: '2 clics: centro → vértice',
    hintEllipse: '3 clics: centro → Rx → Ry',
    hintSlot: '2 clics: centro 1 → centro 2',
    hintSpline: 'Clic puntos, doble clic para terminar',
    hintFillet: 'Clic en un vértice para redondear',
    hintMirror: '2 clics: inicio → fin del eje',
    hintOffset: 'Clic en un segmento para desfasar',
    hintTrim: 'Clic en un segmento para recortar',
    hintConstruction: 'Clic en segmento para alternar auxiliar',
    hintSelect: 'Clic para seleccionar, arrastra para mover',
    hintDimension: 'Clic en un segmento para añadir cota',
    hintConstraint: 'Selecciona tipo de restricción abajo',
    hotkey: 'atajo',
    groupShape: 'FORMA', groupEdit: 'EDITAR', groupAux: 'AUX',
    less: 'Menos', more: 'Más',
    constraintType: 'TIPO DE RESTRICCIÓN',
    cHorizontal: 'Horizontal', cVertical: 'Vertical', cPerpendicular: 'Perp',
    cParallel: 'Paralela', cTangent: 'Tangente', cCoincident: 'Coincid',
    cConcentric: 'Concent', cEqual: 'Igual', cSymmetric: 'Simétrica', cMidpoint: 'Medio',
    cAngle: 'Ángulo', cFixed: 'Fija',
    profiles: 'Perfiles', currentlyEditing: 'Editando', clickToSwitch: 'Clic para cambiar',
    cancel: 'Cancelar', confirmDelete: 'Confirmar',
    cannotDeleteOuter: 'No se puede eliminar el perfil exterior',
    deleteCurrentHole: 'Eliminar perfil de agujero actual',
    radius: 'Radio', ellipseTitle: 'Elipse', slotTitle: 'Ranura', filletTitle: 'Fillet', mirrorTitle: 'Mirror',
    mirrorDesc: 'Clic dos puntos del eje espejo. Shift = espejo sobre Y',
    constructionTitle: 'Auxiliar',
    constructionDesc: 'Clic en un segmento para alternar modo auxiliar. Las líneas auxiliares se excluyen de la geometría.',
    dimensionDesc: 'Clic en un segmento para añadir cota. Clic en el texto para editar el valor.',
    overDefined: 'Sobre-definido', inconsistent: 'Inconsistente', underDefined: 'Sub-definido', ok: 'OK',
    dofLabel: 'DOF',
    dofTip: '0 = totalmente restringido, >0 = sub-restringido, <0 = sobre-restringido',
    residualLabel: 'err',
    residualTip: 'Error residual del solver — menor es mejor',
    unsatLabel: 'no sat',
    unsatTip: 'Estas restricciones no se cumplen actualmente',
    redundantLabel: 'Redundantes:', clickToRemove: 'Clic para eliminar',
    removeConstraint: 'Eliminar restricción', removeDimension: 'Eliminar cota',
    del: 'Elim', no: 'No',
    setup3d: 'Configurar 3D →',
    unlockHint: 'Dibuja líneas conectadas para cerrar el perfil — entonces se activa 3D',
    editSketch: 'Editar boceto',
    operationHint: '⬆ Extrude: extruye el boceto en sólido. ↻ Revolve: gira alrededor del eje. ▼ Cut: elimina material del sólido.',
    confirmClear: '⚠️ ¿Borrar todo el boceto?', clearAll: 'Borrar todo',
    nothingUndo: 'Nada que deshacer', undoLast: 'Deshacer último segmento (Ctrl+Z)',
    nothingClear: 'Nada que borrar', clearAllTip: 'Borrar todos los segmentos del boceto',
  },
  ar: {
    profileClosed: 'تم إغلاق الملف', drawing: 'جاري الرسم', startSketching: 'ابدأ الرسم',
    toolLine: 'خط', toolArc: 'قوس', toolCircle: 'دائرة', toolRect: 'مستطيل', toolPolygon: 'مضلع',
    toolEllipse: 'قطع ناقص', toolSlot: 'فتحة', toolFillet: 'Fillet', toolMirror: 'Mirror',
    toolConstruction: 'مساعد', toolSpline: 'Spline', toolOffset: 'إزاحة',
    toolTrim: 'قص', toolSelect: 'تحديد', toolDimension: 'قياس', toolConstraint: 'قيد',
    hintLine: 'انقر: البداية → النهاية',
    hintArc: '3 نقرات: البداية → مرور → النهاية',
    hintCircle: 'نقرتان: المركز → الحافة',
    hintRect: 'نقرتان: الزاوية 1 → الزاوية 2',
    hintPolygon: 'نقرتان: المركز → القمة',
    hintEllipse: '3 نقرات: المركز → Rx → Ry',
    hintSlot: 'نقرتان: المركز 1 → المركز 2',
    hintSpline: 'انقر النقاط، نقر مزدوج للإنهاء',
    hintFillet: 'انقر قمة زاوية للتقويس',
    hintMirror: 'نقرتان: بداية المحور → النهاية',
    hintOffset: 'انقر مقطعًا للإزاحة',
    hintTrim: 'انقر مقطعًا للقص',
    hintConstruction: 'انقر مقطعًا لتبديل المساعد',
    hintSelect: 'انقر للتحديد، اسحب للنقل',
    hintDimension: 'انقر مقطعًا لإضافة قياس',
    hintConstraint: 'اختر نوع القيد أدناه',
    hotkey: 'اختصار',
    groupShape: 'الشكل', groupEdit: 'تعديل', groupAux: 'مساعد',
    less: 'أقل', more: 'المزيد',
    constraintType: 'نوع القيد',
    cHorizontal: 'أفقي', cVertical: 'رأسي', cPerpendicular: 'عمودي',
    cParallel: 'متوازي', cTangent: 'مماس', cCoincident: 'متطابق',
    cConcentric: 'متحد المركز', cEqual: 'متساوٍ', cSymmetric: 'متناظر', cMidpoint: 'منتصف',
    cAngle: 'زاوية', cFixed: 'ثابت',
    profiles: 'ملفات', currentlyEditing: 'قيد التحرير', clickToSwitch: 'انقر للتبديل',
    cancel: 'إلغاء', confirmDelete: 'تأكيد',
    cannotDeleteOuter: 'لا يمكن حذف الملف الخارجي',
    deleteCurrentHole: 'حذف ملف الثقب الحالي',
    radius: 'نصف القطر', ellipseTitle: 'قطع ناقص', slotTitle: 'فتحة', filletTitle: 'Fillet', mirrorTitle: 'Mirror',
    mirrorDesc: 'انقر نقطتين على محور المرآة. Shift = انعكاس حول المحور Y',
    constructionTitle: 'خط مساعد',
    constructionDesc: 'انقر مقطعًا لتبديل وضع المساعد. الخطوط المساعدة مستبعدة من الهندسة.',
    dimensionDesc: 'انقر مقطعًا لإضافة قياس. انقر نص القياس لتحرير القيمة.',
    overDefined: 'مقيد بشكل مفرط', inconsistent: 'قيود غير متسقة', underDefined: 'قيود ناقصة', ok: 'حسنًا',
    dofLabel: 'درجات الحرية',
    dofTip: '0 = مقيد بالكامل، >0 = ناقص القيود، <0 = مفرط القيود',
    residualLabel: 'خطأ',
    residualTip: 'الخطأ المتبقي للحل — كلما كان أصغر كان أفضل',
    unsatLabel: 'غير مستوفى',
    unsatTip: 'هذه القيود غير مستوفاة حاليًا',
    redundantLabel: 'قيود زائدة:', clickToRemove: 'انقر للإزالة',
    removeConstraint: 'إزالة القيد', removeDimension: 'إزالة القياس',
    del: 'حذف', no: 'لا',
    setup3d: 'إعداد 3D →',
    unlockHint: 'ارسم خطوطًا متصلة لإغلاق الملف — ثم يُفتح إعداد 3D',
    editSketch: 'تحرير الرسم',
    operationHint: '⬆ Extrude: سحب الرسم إلى جسم صلب. ↻ Revolve: دوران حول المحور. ▼ Cut: إزالة المادة من الشكل.',
    confirmClear: '⚠️ مسح الرسم بالكامل؟', clearAll: 'مسح الكل',
    nothingUndo: 'لا شيء للتراجع عنه', undoLast: 'تراجع عن آخر مقطع (Ctrl+Z)',
    nothingClear: 'لا شيء للمسح', clearAllTip: 'مسح جميع مقاطع الرسم',
  },
} as const;

interface SketchPanelProps {
  profile: SketchProfile;
  config: SketchConfig;
  onConfigChange: (config: SketchConfig) => void;
  activeTool: SketchTool;
  onToolChange: (tool: SketchTool) => void;
  onClear: () => void;
  onUndo: () => void;
  onGenerate: () => void;
  canGenerate: boolean;
  t: Record<string, string>;
  // New props for constraints/dimensions
  constraints?: SketchConstraint[];
  dimensions?: SketchDimension[];
  onAddConstraint?: (constraint: SketchConstraint) => void;
  onRemoveConstraint?: (id: string) => void;
  onDimensionChange?: (id: string, value: number) => void;
  onRemoveDimension?: (id: string) => void;
  // Tool-specific params
  circleRadius?: number;
  onCircleRadiusChange?: (r: number) => void;
  rectWidth?: number;
  rectHeight?: number;
  onRectSizeChange?: (w: number, h: number) => void;
  polygonSides?: number;
  onPolygonSidesChange?: (n: number) => void;
  // ellipseRx/Ry, slotRadius, filletRadius are read from config and written via onConfigChange
  selectedConstraintType?: ConstraintType;
  onConstraintTypeChange?: (type: ConstraintType) => void;
  // Multi-profile support
  multiSketch?: { profiles: SketchProfile[]; activeProfileIndex: number };
  onSetActiveProfile?: (idx: number) => void;
  onAddHoleProfile?: () => void;
  onDeleteProfile?: (idx: number) => void;
  // Feature-tree sketch props
  sketchPlane?: 'xy' | 'xz' | 'yz';
  onSketchPlaneChange?: (plane: 'xy' | 'xz' | 'yz') => void;
  sketchPlaneOffset?: number;
  onSketchPlaneOffsetChange?: (offset: number) => void;
  sketchOperation?: 'add' | 'subtract';
  onSketchOperationChange?: (op: 'add' | 'subtract') => void;
  onAddSketchFeature?: () => void;
  // Sketch history
  showSketchHistory?: boolean;
  onToggleSketchHistory?: () => void;
  // Edit-feature mode
  editingFeatureId?: string | null;
  // Constraint solver
  autoSolve?: boolean;
  onAutoSolveChange?: (v: boolean) => void;
  onSolveConstraints?: () => void;
  /** Status returned from constraint solver */
  constraintStatus?: 'ok' | 'over-defined' | 'under-defined' | 'inconsistent';
  /** Extended diagnostic from the LM solver (dof/residual/message) */
  constraintDiagnostic?: {
    dof?: number;
    residual?: number;
    message?: string;
    unsatisfiedCount?: number;
    /** Constraint ids that can be safely removed (system is over-defined by them) */
    redundant?: string[];
    /** Callback to remove a specific redundant constraint when user clicks */
    onRemoveRedundant?: (id: string) => void;
  };
  isKo?: boolean;
  /** 2-phase sketch UX: 'draw' shows tools only, 'setup3d' shows extrude/generate */
  sketchStep?: 'draw' | 'setup3d';
  onSketchStepChange?: (step: 'draw' | 'setup3d') => void;
}

// ─── Styles (dark theme) ────────────────────────────────────────────────────

const sectionSep: React.CSSProperties = {
  borderTop: '1px solid #21262d',
  paddingTop: 6,
  marginTop: 6,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  color: '#6e7681',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  marginBottom: 6,
};

const toolBtnBase: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '4px 0',
  borderRadius: 6,
  border: '1px solid #30363d',
  background: '#161b22',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 700,
  color: '#8b949e',
  transition: 'all 0.15s',
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
};

const toolBtnActive: React.CSSProperties = {
  ...toolBtnBase,
  border: '2px solid #388bfd',
  background: '#0d1117',
  color: '#388bfd',
};

const sliderRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '56px 1fr 36px',
  alignItems: 'center',
  gap: 4,
  marginBottom: 3,
};

const sliderLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: '#9ca3af',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const sliderStyle: React.CSSProperties = {
  width: '100%',
  accentColor: '#388bfd',
  cursor: 'pointer',
  height: 3,
  borderRadius: 2,
};

const sliderValueStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: '#388bfd',
  textAlign: 'right',
  fontFamily: 'monospace',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid #30363d',
  background: '#0d1117',
  color: '#c9d1d9',
  fontSize: 12,
  fontWeight: 600,
  outline: 'none',
};

const constraintBtnBase: React.CSSProperties = {
  padding: '3px 6px',
  borderRadius: 5,
  border: '1px solid #30363d',
  background: '#161b22',
  cursor: 'pointer',
  fontSize: 10,
  fontWeight: 600,
  color: '#8b949e',
  transition: 'all 0.15s',
};

const constraintBtnActive: React.CSSProperties = {
  ...constraintBtnBase,
  border: '1px solid #388bfd',
  background: '#0d1117',
  color: '#388bfd',
};

// ─── Tool definitions ───────────────────────────────────────────────────────

type ToolDef = { id: SketchTool; label: string; icon: string; hotkey?: string };

/** Always-visible primary tools */
const primaryTools: ToolDef[] = [
  { id: 'line',       label: 'Line',   icon: '/',  hotkey: 'L' },
  { id: 'arc',        label: 'Arc',    icon: '⌒', hotkey: 'A' },
  { id: 'circle',     label: 'Circle', icon: '○', hotkey: 'C' },
  { id: 'rect',       label: 'Rect',   icon: '▭', hotkey: 'R' },
  { id: 'polygon',    label: 'Poly',   icon: '⬡', hotkey: 'P' },
  { id: 'select',     label: 'Select', icon: '↖', hotkey: 'V' },
  { id: 'dimension',  label: 'Dim',    icon: '↔', hotkey: 'N' },
  { id: 'constraint', label: 'Constr', icon: '⊥' },
];

/** Extra tools shown only when "more" is expanded */
const moreTools: ToolDef[] = [
  { id: 'ellipse',      label: 'Ellipse', icon: '⬭',  hotkey: 'E' },
  { id: 'slot',         label: 'Slot',    icon: '⬮',  hotkey: 'U' },
  { id: 'spline',       label: 'Spline',  icon: '〜', hotkey: 'B' },
  { id: 'fillet',       label: 'Fillet',  icon: '◜',  hotkey: 'F' },
  { id: 'mirror',       label: 'Mirror',  icon: '⇆',  hotkey: 'K' },
  { id: 'offset',       label: 'Offset',  icon: '⧫',  hotkey: 'O' },
  { id: 'trim',         label: 'Trim',    icon: '✂',  hotkey: 'X' },
  { id: 'construction', label: 'Aux',     icon: '- -', hotkey: 'Q' },
];

const constraintTypes: Array<{ type: ConstraintType; label: string; icon: string }> = [
  { type: 'horizontal', label: 'Horizontal', icon: 'H' },
  { type: 'vertical', label: 'Vertical', icon: 'V' },
  { type: 'perpendicular', label: 'Perp', icon: '⊥' },
  { type: 'parallel', label: 'Parallel', icon: '∥' },
  { type: 'tangent', label: 'Tangent', icon: '⌢' },
  { type: 'coincident', label: 'Coincid', icon: '●' },
  { type: 'equal', label: 'Equal', icon: '=' },
  { type: 'symmetric', label: 'Symm', icon: '⇔' },
  { type: 'midpoint', label: 'Midpt', icon: '◎' },
  { type: 'concentric', label: 'Concent', icon: '⊙' },
  { type: 'angle', label: 'Angle', icon: '∠' },
  { type: 'fixed', label: 'Fixed', icon: '⊗' },
];

// ─── Component ──────────────────────────────────────────────────────────────

export default function SketchPanel({
  profile, config, onConfigChange, activeTool, onToolChange,
  onClear, onUndo, onGenerate, canGenerate, t,
  constraints = [], dimensions = [],
  onAddConstraint, onRemoveConstraint,
  onDimensionChange, onRemoveDimension,
  circleRadius = 25, onCircleRadiusChange,
  rectWidth = 50, rectHeight = 30, onRectSizeChange,
  polygonSides = 6, onPolygonSidesChange,
  selectedConstraintType = 'horizontal', onConstraintTypeChange,
  multiSketch, onSetActiveProfile, onAddHoleProfile, onDeleteProfile,
  sketchPlane = 'xy', onSketchPlaneChange,
  sketchPlaneOffset = 0, onSketchPlaneOffsetChange,
  sketchOperation = 'add', onSketchOperationChange,
  onAddSketchFeature,
  showSketchHistory = false, onToggleSketchHistory,
  editingFeatureId = null,
  autoSolve = false, onAutoSolveChange,
  onSolveConstraints,
  constraintStatus,
  constraintDiagnostic,
  isKo = false,
  sketchStep = 'draw',
  onSketchStepChange,
}: SketchPanelProps) {

  // ── i18n: resolve locale from URL segment ──
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const i18n = dict[langMap[seg] ?? 'en'];

  // Auto-expand "more tools" if the active tool is in the more-tools group
  const isMoreTool = moreTools.some(t => t.id === activeTool);
  const [showMoreTools, setShowMoreTools] = useState(isMoreTool);
  // Keep expanded if user switches to a "more" tool via hotkey
  React.useEffect(() => {
    if (isMoreTool) setShowMoreTools(true);
  }, [isMoreTool]);

  // Derive new tool params from config (with fallback defaults)
  const ellipseRx = config.ellipseRx ?? 25;
  const ellipseRy = config.ellipseRy ?? 15;
  const slotRadius = config.slotRadius ?? 10;
  const filletRadius = config.filletRadius ?? 5;

  const [dimEditId, setDimEditId] = useState<string | null>(null);
  const [dimEditValue, setDimEditValue] = useState('');
  const [showConstraints, setShowConstraints] = useState(false);

  // ── Destructive action confirmations ──
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteProfileIdx, setConfirmDeleteProfileIdx] = useState<number | null>(null);
  const [confirmRemoveConstraintId, setConfirmRemoveConstraintId] = useState<string | null>(null);
  const [confirmRemoveDimensionId, setConfirmRemoveDimensionId] = useState<string | null>(null);

  // Suppress unused-variable warnings — kept for API compat
  void onAddConstraint;

  const pointCount = (() => {
    const pts = new Set<string>();
    for (const seg of profile.segments) {
      for (const p of seg.points) {
        pts.add(`${p.x.toFixed(2)},${p.y.toFixed(2)}`);
      }
    }
    return pts.size;
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── ① Profile status bar ── */}
      {(() => {
        const segCount = profile.segments.length;
        const isClosed = profile.closed;
        return (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 8px', marginBottom: 6,
            borderRadius: 6,
            background: isClosed ? 'rgba(63,185,80,0.07)' : segCount > 0 ? 'rgba(210,153,34,0.07)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${isClosed ? '#3fb95033' : segCount > 0 ? '#d2992233' : '#21262d'}`,
          }}>
            <span style={{
              fontSize: 13,
              color: isClosed ? '#3fb950' : segCount > 0 ? '#d29922' : '#484f58',
            }}>
              {isClosed ? '✓' : segCount > 0 ? '○' : '◌'}
            </span>
            <span style={{ fontSize: 10, color: isClosed ? '#3fb950' : segCount > 0 ? '#d29922' : '#484f58', fontWeight: 700 }}>
              {isClosed
                ? i18n.profileClosed
                : segCount > 0
                  ? `${i18n.drawing}… (${segCount} seg)`
                  : i18n.startSketching}
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 9, color: '#484f58', fontFamily: 'monospace' }}>
              {pointCount}pt
            </span>
          </div>
        );
      })()}

      {/* ── ② Drawing Tools ── */}
      {(() => {
        const toolLabel: Record<string, string> = {
          line: i18n.toolLine, arc: i18n.toolArc, circle: i18n.toolCircle, rect: i18n.toolRect, polygon: i18n.toolPolygon,
          ellipse: i18n.toolEllipse, slot: i18n.toolSlot, fillet: i18n.toolFillet, mirror: i18n.toolMirror,
          construction: i18n.toolConstruction, spline: i18n.toolSpline, offset: i18n.toolOffset,
          trim: i18n.toolTrim, select: i18n.toolSelect, dimension: i18n.toolDimension, constraint: i18n.toolConstraint,
        };
        // ③ Tool step hints
        const toolHint: Record<string, string> = {
          line:         i18n.hintLine,
          arc:          i18n.hintArc,
          circle:       i18n.hintCircle,
          rect:         i18n.hintRect,
          polygon:      i18n.hintPolygon,
          ellipse:      i18n.hintEllipse,
          slot:         i18n.hintSlot,
          spline:       i18n.hintSpline,
          fillet:       i18n.hintFillet,
          mirror:       i18n.hintMirror,
          offset:       i18n.hintOffset,
          trim:         i18n.hintTrim,
          construction: i18n.hintConstruction,
          select:       i18n.hintSelect,
          dimension:    i18n.hintDimension,
          constraint:   i18n.hintConstraint,
        };
        const hint = toolHint[activeTool];

        const renderTool = (tool: ToolDef) => {
          const isActive = activeTool === tool.id;
          const displayLabel = toolLabel[tool.id] ?? tool.label;
          return (
            <button
              key={tool.id}
              onClick={() => onToolChange(tool.id)}
              title={tool.hotkey ? `${displayLabel} (${i18n.hotkey}: ${tool.hotkey})` : displayLabel}
              aria-label={tool.hotkey ? `${tool.label} (${tool.hotkey})` : tool.label}
              style={{ ...(isActive ? toolBtnActive : toolBtnBase), position: 'relative' }}
            >
              {tool.icon}
              {tool.hotkey && (
                <span style={{
                  position: 'absolute', top: 1, right: 2,
                  fontSize: 8, opacity: 0.55, fontFamily: 'monospace',
                  pointerEvents: 'none',
                }}>{tool.hotkey}</span>
              )}
            </button>
          );
        };

        // Draw tools (line–polygon) vs interact tools (select/dim/constraint)
        const drawTools = primaryTools.slice(0, 5);
        const interactTools = primaryTools.slice(5);

        return (
          <div style={{ marginBottom: 4 }}>
            {/* Primary tools with ③ separator */}
            <div style={{ display: 'flex', gap: 3, marginBottom: 3, alignItems: 'stretch' }}>
              {drawTools.map(renderTool)}
              {/* Divider */}
              <div style={{ width: 1, background: '#30363d', margin: '2px 1px', flexShrink: 0 }} />
              {interactTools.map(renderTool)}
            </div>

            {/* ① Active tool hint */}
            {hint && (
              <div style={{
                fontSize: 10, color: '#8b949e',
                padding: '3px 6px', marginBottom: 3,
                background: 'rgba(56,139,253,0.06)',
                borderLeft: '2px solid #388bfd55',
                borderRadius: '0 4px 4px 0',
              }}>
                {hint}
              </div>
            )}

            {/* More tools — collapsible with sub-groups */}
            {showMoreTools && (
              <div style={{
                marginBottom: 3, padding: '5px 6px',
                background: 'rgba(56,139,253,0.03)',
                border: '1px solid #21262d', borderRadius: 5,
              }}>
                {/* Shape sub-group */}
                <div style={{ fontSize: 9, color: '#484f58', fontWeight: 700, marginBottom: 3, letterSpacing: '0.05em' }}>
                  {i18n.groupShape}
                </div>
                <div style={{ display: 'flex', gap: 3, marginBottom: 5 }}>
                  {moreTools.filter(t => ['ellipse','slot','spline'].includes(t.id)).map(renderTool)}
                </div>
                {/* Edit sub-group */}
                <div style={{ fontSize: 9, color: '#484f58', fontWeight: 700, marginBottom: 3, letterSpacing: '0.05em' }}>
                  {i18n.groupEdit}
                </div>
                <div style={{ display: 'flex', gap: 3, marginBottom: 5 }}>
                  {moreTools.filter(t => ['fillet','mirror','offset','trim'].includes(t.id)).map(renderTool)}
                </div>
                {/* Aux sub-group */}
                <div style={{ fontSize: 9, color: '#484f58', fontWeight: 700, marginBottom: 3, letterSpacing: '0.05em' }}>
                  {i18n.groupAux}
                </div>
                <div style={{ display: 'flex', gap: 3 }}>
                  {moreTools.filter(t => ['construction'].includes(t.id)).map(renderTool)}
                </div>
              </div>
            )}

            {/* Toggle button */}
            <button
              onClick={() => setShowMoreTools(v => !v)}
              style={{
                width: '100%', padding: '3px 0',
                background: 'none', border: '1px solid #21262d',
                borderRadius: 4, cursor: 'pointer',
                color: showMoreTools ? '#388bfd' : '#8b949e',
                fontSize: 10, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                transition: 'color 0.15s',
              }}
            >
              {showMoreTools
                ? `${i18n.less} ▲`
                : `${i18n.more} ▼ (${moreTools.length})`}
              {!showMoreTools && isMoreTool && (
                <span style={{
                  background: '#388bfd', color: '#fff',
                  borderRadius: 3, fontSize: 9, padding: '0 4px',
                }}>active</span>
              )}
            </button>
          </div>
        );
      })()}

      {/* ── ⑤ Constraint type picker — inline (shown when constraint tool active) ── */}
      {activeTool === 'constraint' && (
        <div style={{
          marginBottom: 6, padding: '6px',
          background: '#0d1117', border: '1px solid #388bfd44',
          borderRadius: 6,
        }}>
          <div style={{ fontSize: 9, color: '#484f58', fontWeight: 700, marginBottom: 4, letterSpacing: '0.05em' }}>
            {i18n.constraintType}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
          {constraintTypes.map(ct => (
            <button
              key={ct.type}
              onClick={() => {
                onConstraintTypeChange?.(ct.type);
              }}
              title={ct.label}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 8px', borderRadius: 5,
                border: selectedConstraintType === ct.type ? '1px solid #388bfd' : '1px solid transparent',
                background: selectedConstraintType === ct.type ? 'rgba(56,139,253,0.15)' : 'transparent',
                color: selectedConstraintType === ct.type ? '#58a6ff' : '#c9d1d9',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.1s',
              }}
              onMouseEnter={e => { if (selectedConstraintType !== ct.type) e.currentTarget.style.background = '#21262d'; }}
              onMouseLeave={e => { if (selectedConstraintType !== ct.type) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 13, width: 16, textAlign: 'center' }}>{ct.icon}</span>
              <span>{({
                horizontal: i18n.cHorizontal, vertical: i18n.cVertical, perpendicular: i18n.cPerpendicular,
                parallel: i18n.cParallel, tangent: i18n.cTangent, coincident: i18n.cCoincident,
                concentric: i18n.cConcentric, equal: i18n.cEqual, symmetric: i18n.cSymmetric, midpoint: i18n.cMidpoint,
                angle: i18n.cAngle, fixed: i18n.cFixed,
              } as Record<string, string>)[ct.type] ?? ct.label}</span>
            </button>
          ))}
          </div>
        </div>
      )}

      {/* ── Multi-profile tabs ── */}
      {multiSketch && multiSketch.profiles.length > 0 && (
        <div style={sectionSep}>
          <div style={sectionTitle}>{t.outerProfile ? t.outerProfile + ' / ' + (t.holeProfile || 'Holes') : 'Profiles'}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 5 }}>
            {multiSketch.profiles.map((_, idx) => {
              const isActive = idx === multiSketch.activeProfileIndex;
              const label = idx === 0
                ? (t.outerProfile || 'Outer')
                : `${t.holeProfile || 'Hole'} ${idx}`;
              return (
                <button
                  key={idx}
                  onClick={() => onSetActiveProfile?.(idx)}
                  title={isActive ? i18n.currentlyEditing : i18n.clickToSwitch}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 5,
                    border: isActive ? '2px solid #388bfd' : '1px solid #30363d',
                    background: isActive ? 'linear-gradient(135deg, #388bfd22, #1f6feb11)' : '#161b22',
                    color: isActive ? '#58a6ff' : '#8b949e',
                    fontWeight: isActive ? 800 : 600,
                    fontSize: 10,
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                    boxShadow: isActive ? '0 0 0 1px #388bfd44' : 'none',
                  }}
                >
                  {isActive ? '● ' : ''}{label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={onAddHoleProfile}
              style={{
                flex: 1, padding: '4px 8px', borderRadius: 6,
                border: '1px solid #30363d', background: '#161b22',
                color: '#3fb950', fontWeight: 700, fontSize: 10, cursor: 'pointer',
              }}
            >
              + {t.addHoleProfile || 'Add Hole'}
            </button>
            {confirmDeleteProfileIdx === multiSketch.activeProfileIndex ? (
              <div style={{ flex: 1, display: 'flex', gap: 3 }}>
                <button
                  onClick={() => setConfirmDeleteProfileIdx(null)}
                  style={{ flex: 1, padding: '4px 6px', borderRadius: 6, border: '1px solid #30363d', background: '#161b22', color: '#8b949e', fontWeight: 700, fontSize: 10, cursor: 'pointer' }}
                >
                  {i18n.cancel}
                </button>
                <button
                  onClick={() => { onDeleteProfile?.(multiSketch.activeProfileIndex); setConfirmDeleteProfileIdx(null); }}
                  style={{ flex: 1, padding: '4px 6px', borderRadius: 6, border: '1px solid #f85149', background: '#3d1010', color: '#f85149', fontWeight: 800, fontSize: 10, cursor: 'pointer' }}
                >
                  {i18n.confirmDelete}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeleteProfileIdx(multiSketch.activeProfileIndex)}
                disabled={multiSketch.activeProfileIndex === 0}
                title={multiSketch.activeProfileIndex === 0 ? i18n.cannotDeleteOuter : i18n.deleteCurrentHole}
                style={{
                  flex: 1, padding: '4px 8px', borderRadius: 6,
                  border: '1px solid #30363d', background: '#161b22',
                  color: multiSketch.activeProfileIndex === 0 ? '#6e7681' : '#f85149',
                  fontWeight: 700, fontSize: 10,
                  cursor: multiSketch.activeProfileIndex === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                ✕ {t.deleteProfile || 'Delete'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Tool-specific params ── */}
      {activeTool === 'circle' && (
        <div style={sectionSep}>
          <div style={sectionTitle}>Circle</div>
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>Radius</span>
            <input type="range" min={1} max={200} step={1} value={circleRadius}
              onChange={e => onCircleRadiusChange?.(Number(e.target.value))}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{circleRadius}</span>
          </div>
        </div>
      )}

      {activeTool === 'rect' && (
        <div style={sectionSep}>
          <div style={sectionTitle}>Rectangle</div>
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>Width</span>
            <input type="range" min={1} max={500} step={1} value={rectWidth}
              onChange={e => onRectSizeChange?.(Number(e.target.value), rectHeight)}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{rectWidth}</span>
          </div>
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>Height</span>
            <input type="range" min={1} max={500} step={1} value={rectHeight}
              onChange={e => onRectSizeChange?.(rectWidth, Number(e.target.value))}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{rectHeight}</span>
          </div>
        </div>
      )}

      {activeTool === 'polygon' && (
        <div style={sectionSep}>
          <div style={sectionTitle}>Polygon</div>
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>Sides</span>
            <input type="range" min={3} max={12} step={1} value={polygonSides}
              onChange={e => onPolygonSidesChange?.(Number(e.target.value))}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{polygonSides}</span>
          </div>
        </div>
      )}

      {activeTool === 'ellipse' && (
        <div style={sectionSep}>
          <div style={sectionTitle}>{i18n.ellipseTitle}</div>
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>Rx</span>
            <input type="range" min={1} max={200} step={1} value={ellipseRx}
              onChange={e => onConfigChange({ ...config, ellipseRx: Number(e.target.value) })}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{ellipseRx}</span>
          </div>
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>Ry</span>
            <input type="range" min={1} max={200} step={1} value={ellipseRy}
              onChange={e => onConfigChange({ ...config, ellipseRy: Number(e.target.value) })}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{ellipseRy}</span>
          </div>
        </div>
      )}

      {activeTool === 'slot' && (
        <div style={sectionSep}>
          <div style={sectionTitle}>{i18n.slotTitle}</div>
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>{i18n.radius}</span>
            <input type="range" min={1} max={100} step={1} value={slotRadius}
              onChange={e => onConfigChange({ ...config, slotRadius: Number(e.target.value) })}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{slotRadius}</span>
          </div>
        </div>
      )}

      {activeTool === 'fillet' && (
        <div style={sectionSep}>
          <div style={sectionTitle}>{i18n.filletTitle}</div>
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>{i18n.radius}</span>
            <input type="range" min={1} max={50} step={0.5} value={filletRadius}
              onChange={e => onConfigChange({ ...config, filletRadius: Number(e.target.value) })}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{filletRadius}</span>
          </div>
        </div>
      )}

      {activeTool === 'mirror' && (
        <div style={sectionSep}>
          <div style={sectionTitle}>{i18n.mirrorTitle}</div>
          <p style={{ fontSize: 10, color: '#8b949e', margin: 0 }}>
            {i18n.mirrorDesc}
          </p>
        </div>
      )}

      {activeTool === 'construction' && (
        <div style={sectionSep}>
          <div style={sectionTitle}>{i18n.constructionTitle}</div>
          <p style={{ fontSize: 10, color: '#8b949e', margin: 0 }}>
            {i18n.constructionDesc}
          </p>
        </div>
      )}

      {activeTool === 'dimension' && (
        <div style={sectionSep}>
          <p style={{ fontSize: 10, color: '#8b949e', margin: 0 }}>
            {i18n.dimensionDesc}
          </p>
        </div>
      )}

      {/* ── Constraint solver diagnostic panel ── */}
      {constraintStatus && (() => {
        const isError = constraintStatus === 'over-defined' || constraintStatus === 'inconsistent';
        const isWarn = constraintStatus === 'under-defined';
        const isOk = constraintStatus === 'ok';
        const bg = isError ? '#3d1f1f' : isWarn ? '#1c2933' : '#1a2d1a';
        const border = isError ? '#f85149' : isWarn ? '#388bfd' : '#3fb950';
        const icon = isError ? '⚠️' : isWarn ? 'ℹ️' : '✓';
        const label =
          constraintStatus === 'over-defined'
            ? i18n.overDefined
            : constraintStatus === 'inconsistent'
              ? i18n.inconsistent
              : constraintStatus === 'under-defined'
                ? i18n.underDefined
                : i18n.ok;
        const dof = constraintDiagnostic?.dof;
        const residual = constraintDiagnostic?.residual;
        const unsat = constraintDiagnostic?.unsatisfiedCount;
        const hint = constraintDiagnostic?.message;
        return (
          <div style={{ padding: '6px 10px', background: bg, border: `1px solid ${border}`, borderRadius: 5, color: border, fontSize: 10, marginTop: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
              <span>{icon}</span>
              <span>{label}</span>
              {typeof dof === 'number' && (
                <span
                  title={`${i18n.dofLabel} (DOF): ${dof} — ${i18n.dofTip}`}
                  style={{ marginLeft: 'auto', fontFamily: 'monospace', fontWeight: 400, opacity: 0.9, cursor: 'help', borderBottom: '1px dotted currentColor' }}
                >
                  {i18n.dofLabel}: {dof}
                </span>
              )}
            </div>
            {(typeof residual === 'number' || typeof unsat === 'number') && (
              <div style={{ fontFamily: 'monospace', fontSize: 9, opacity: 0.8, marginTop: 2 }}>
                {typeof residual === 'number' && (
                  <span
                    title={`${i18n.residualLabel}: ${residual.toExponential(2)} — ${i18n.residualTip}`}
                    style={{ cursor: 'help', borderBottom: '1px dotted currentColor' }}
                  >
                    {i18n.residualLabel}={residual.toExponential(2)}
                  </span>
                )}
                {typeof residual === 'number' && typeof unsat === 'number' && unsat > 0 && '  '}
                {typeof unsat === 'number' && unsat > 0 && (
                  <span
                    title={`${unsat} — ${i18n.unsatTip}`}
                    style={{ cursor: 'help', borderBottom: '1px dotted currentColor', color: '#f85149' }}
                  >
                    {i18n.unsatLabel}={unsat}
                  </span>
                )}
              </div>
            )}
            {hint && !isOk && (
              <div style={{ fontSize: 9, opacity: 0.85, marginTop: 2 }}>
                {hint}
              </div>
            )}
            {constraintDiagnostic?.redundant && constraintDiagnostic.redundant.length > 0 && (
              <div style={{ fontSize: 9, marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                <span style={{ opacity: 0.8 }}>{i18n.redundantLabel}</span>
                {constraintDiagnostic.redundant.map((id) => (
                  <button
                    key={id}
                    onClick={() => constraintDiagnostic.onRemoveRedundant?.(id)}
                    title={i18n.clickToRemove}
                    style={{ padding: '1px 6px', borderRadius: 3, border: '1px solid currentColor', background: 'transparent', color: 'inherit', fontSize: 9, cursor: 'pointer', fontFamily: 'monospace' }}
                  >
                    {id.slice(0, 8)} ✕
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Constraints — collapsible ── */}
      {constraints.length > 0 && (
        <div style={sectionSep}>
          <div
            onClick={() => setShowConstraints(s => !s)}
            style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showConstraints ? 4 : 0 }}
          >
            <span style={{ fontSize: 10, color: '#6e7681', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Constraints ({constraints.length}) {constraintStatus === 'over-defined' ? '⚠️' : constraintStatus === 'ok' ? '✓' : ''}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* Auto-solve toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 10, color: '#8b949e', fontWeight: 600 }}
                onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={autoSolve}
                  onChange={e => onAutoSolveChange?.(e.target.checked)}
                  style={{ accentColor: '#388bfd', cursor: 'pointer' }}
                />
                {t.autoSolve || 'Auto'}
              </label>
              {!autoSolve && (
                <button
                  onClick={e => { e.stopPropagation(); onSolveConstraints?.(); }}
                  style={{ padding: '2px 6px', borderRadius: 4, border: '1px solid #388bfd', background: '#0d1a2e', color: '#388bfd', fontWeight: 700, fontSize: 10, cursor: 'pointer' }}
                >
                  {t.solveConstraints || 'Solve'}
                </button>
              )}
              <span style={{ fontSize: 10, color: '#484f58' }}>{showConstraints ? '▲' : '▼'}</span>
            </div>
          </div>
          {showConstraints && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 100, overflowY: 'auto' }}>
              {constraints.map(c => (
                <div key={c.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '3px 6px', borderRadius: 5, background: '#161b22',
                  border: `1px solid ${c.satisfied ? '#238636' : '#da3633'}`,
                }}>
                  <span style={{ fontSize: 10, color: c.satisfied ? '#3fb950' : '#f85149', fontWeight: 600 }}>
                    {c.satisfied ? '✓' : '✗'} {({ horizontal: i18n.cHorizontal, vertical: i18n.cVertical, perpendicular: i18n.cPerpendicular, parallel: i18n.cParallel, tangent: i18n.cTangent, coincident: i18n.cCoincident, equal: i18n.cEqual, symmetric: i18n.cSymmetric, midpoint: i18n.cMidpoint, angle: i18n.cAngle, fixed: i18n.cFixed } as Record<string, string>)[c.type] ?? c.type}
                  </span>
                  {confirmRemoveConstraintId === c.id ? (
                    <div style={{ display: 'flex', gap: 3 }}>
                      <button
                        onClick={() => setConfirmRemoveConstraintId(null)}
                        style={{ padding: '1px 5px', borderRadius: 3, border: '1px solid #30363d', background: '#161b22', color: '#8b949e', fontSize: 9, cursor: 'pointer', fontWeight: 700 }}
                      >
                        {i18n.no}
                      </button>
                      <button
                        onClick={() => { onRemoveConstraint?.(c.id); setConfirmRemoveConstraintId(null); }}
                        style={{ padding: '1px 5px', borderRadius: 3, border: '1px solid #f85149', background: '#3d1010', color: '#f85149', fontSize: 9, cursor: 'pointer', fontWeight: 700 }}
                      >
                        {i18n.del}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmRemoveConstraintId(c.id)}
                      title={i18n.removeConstraint}
                      style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', fontSize: 11, padding: '0 3px' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#f85149')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#6e7681')}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Dimensions ── */}
      {dimensions.length > 0 && (
        <div style={sectionSep}>
          <div style={sectionTitle}>Dimensions ({dimensions.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 100, overflowY: 'auto' }}>
            {dimensions.map(d => (
              <div key={d.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '3px 6px', borderRadius: 5, background: '#161b22',
                border: '1px solid #30363d',
              }}>
                {dimEditId === d.id ? (
                  <input
                    autoFocus
                    value={dimEditValue}
                    onChange={e => setDimEditValue(e.target.value)}
                    onBlur={() => {
                      const v = parseFloat(dimEditValue);
                      if (!isNaN(v) && v > 0) onDimensionChange?.(d.id, v);
                      setDimEditId(null);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const v = parseFloat(dimEditValue);
                        if (!isNaN(v) && v > 0) onDimensionChange?.(d.id, v);
                        setDimEditId(null);
                      }
                    }}
                    style={{ ...inputStyle, width: 70, padding: '1px 5px', fontSize: 10 }}
                  />
                ) : (
                  <span
                    onClick={() => { setDimEditId(d.id); setDimEditValue(String(d.value)); }}
                    style={{ fontSize: 10, color: '#c9d1d9', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {d.type}: {d.value.toFixed(1)} {d.type === 'angular' ? '°' : 'mm'}
                    {d.locked ? ' 🔒' : ''}
                  </span>
                )}
                {confirmRemoveDimensionId === d.id ? (
                  <div style={{ display: 'flex', gap: 3 }}>
                    <button
                      onClick={() => setConfirmRemoveDimensionId(null)}
                      style={{ padding: '1px 5px', borderRadius: 3, border: '1px solid #30363d', background: '#161b22', color: '#8b949e', fontSize: 9, cursor: 'pointer', fontWeight: 700 }}
                    >
                      {i18n.no}
                    </button>
                    <button
                      onClick={() => { onRemoveDimension?.(d.id); setConfirmRemoveDimensionId(null); }}
                      style={{ padding: '1px 5px', borderRadius: 3, border: '1px solid #f85149', background: '#3d1010', color: '#f85149', fontSize: 9, cursor: 'pointer', fontWeight: 700 }}
                    >
                      {i18n.del}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmRemoveDimensionId(d.id)}
                    title={i18n.removeDimension}
                    style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', fontSize: 11, padding: '0 3px' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#f85149')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#6e7681')}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 단계 전환 버튼 ── */}
      {sketchStep === 'draw' ? (
        <div style={{ ...sectionSep, paddingTop: 8 }}>
          <button
            onClick={() => onSketchStepChange?.('setup3d')}
            disabled={!canGenerate}
            style={{
              width: '100%', padding: '9px 14px', borderRadius: 8, border: 'none',
              background: canGenerate
                ? 'linear-gradient(135deg, #388bfd 0%, #1f6feb 100%)'
                : '#21262d',
              color: canGenerate ? '#fff' : '#484f58',
              fontWeight: 800, fontSize: 13, cursor: canGenerate ? 'pointer' : 'not-allowed',
              boxShadow: canGenerate ? '0 4px 16px rgba(56,139,253,0.3)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {i18n.setup3d}
          </button>
          {!canGenerate && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, padding: '6px 8px', borderRadius: 6, background: '#1c2233', border: '1px solid #30363d', marginTop: 5 }}>
              <span style={{ fontSize: 12, flexShrink: 0, marginTop: 1 }}>ℹ️</span>
              <p style={{ fontSize: 11, color: '#8b949e', margin: 0, lineHeight: 1.4 }}>
                {i18n.unlockHint}
              </p>
            </div>
          )}
        </div>
      ) : (
        <div style={{ ...sectionSep, paddingTop: 8 }}>
          <button
            onClick={() => onSketchStepChange?.('draw')}
            style={{
              width: '100%', padding: '6px 10px', borderRadius: 7, marginBottom: 8,
              border: '1px solid #30363d', background: '#161b22',
              color: '#8b949e', fontWeight: 700, fontSize: 11, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            ← {i18n.editSketch}
          </button>
        </div>
      )}

      {/* ── Extrude / Revolve / ExtrudeCut (setup3d 단계에서만) ── */}
      {sketchStep === 'setup3d' && (
      <div style={sectionSep}>
        {/* #wf8: default values hint */}
        <div style={{ background: 'rgba(56,139,253,0.06)', border: '1px solid rgba(56,139,253,0.2)', borderRadius: 6, padding: '5px 8px', marginBottom: 8, fontSize: 10, color: '#8b949e', lineHeight: 1.5 }}>
          {i18n.operationHint}
        </div>
        <div style={sectionTitle}>{t.sketchExtrude || 'Operation'}</div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {(['extrude', 'revolve', 'extrudeCut'] as ExtrudeMode[]).map(mode => {
            const active = config.mode === mode;
            const labels: Record<ExtrudeMode, string> = {
              extrude: t.sketchExtrude || 'Extrude',
              revolve: t.sketchRevolve || 'Revolve',
              extrudeCut: t.sketchExtrudeCut || 'Cut',
            };
            const icons: Record<ExtrudeMode, string> = {
              extrude: '⬆',
              revolve: '↻',
              extrudeCut: '▼',
            };
            return (
              <button
                key={mode}
                onClick={() => onConfigChange({ ...config, mode })}
                style={{
                  flex: 1, padding: '5px 4px', borderRadius: 6,
                  border: active ? '2px solid #388bfd' : '1px solid #30363d',
                  background: active ? 'linear-gradient(135deg, #388bfd 0%, #1f6feb 100%)' : '#161b22',
                  color: active ? '#fff' : '#8b949e', fontWeight: 700, fontSize: 10, cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {icons[mode]} {labels[mode]}
              </button>
            );
          })}
        </div>

        {config.mode === 'extrude' && (
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>{t.sketchDepth || 'Depth'}</span>
            <input type="range" min={1} max={500} step={1} value={config.depth}
              onChange={e => onConfigChange({ ...config, depth: Number(e.target.value) })}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{config.depth}</span>
          </div>
        )}

        {config.mode === 'extrudeCut' && (
          <div style={sliderRowStyle}>
            <span style={sliderLabelStyle}>Cut Depth</span>
            <input type="range" min={1} max={500} step={1} value={config.cutDepth ?? config.depth}
              onChange={e => onConfigChange({ ...config, cutDepth: Number(e.target.value) })}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{config.cutDepth ?? config.depth}</span>
          </div>
        )}

        {config.mode === 'revolve' && (
          <>
            <div style={sliderRowStyle}>
              <span style={sliderLabelStyle}>{t.sketchAngle || 'Angle'}</span>
              <input type="range" min={10} max={360} step={5} value={config.revolveAngle}
                onChange={e => onConfigChange({ ...config, revolveAngle: Number(e.target.value) })}
                style={sliderStyle} />
              <span style={sliderValueStyle}>{config.revolveAngle}°</span>
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              {(['x', 'y'] as const).map(axis => {
                const active = config.revolveAxis === axis;
                return (
                  <button
                    key={axis}
                    onClick={() => onConfigChange({ ...config, revolveAxis: axis })}
                    style={{
                      flex: 1, padding: '4px 8px', borderRadius: 6,
                      border: active ? '2px solid #388bfd' : '1px solid #30363d',
                      background: active ? '#0d1117' : '#161b22',
                      color: active ? '#388bfd' : '#8b949e', fontWeight: 700, fontSize: 10, cursor: 'pointer',
                    }}
                  >
                    {axis.toUpperCase()} Axis
                  </button>
                );
              })}
            </div>
            <div style={sliderRowStyle}>
              <span style={sliderLabelStyle}>{t.sketchSegments || 'Segs'}</span>
              <input type="range" min={8} max={64} step={4} value={config.segments}
                onChange={e => onConfigChange({ ...config, segments: Number(e.target.value) })}
                style={sliderStyle} />
              <span style={sliderValueStyle}>{config.segments}</span>
            </div>
          </>
        )}
      </div>
      )} {/* end sketchStep === 'setup3d' extrude section */}

      {/* ── Actions (setup3d 단계에서만 Generate 버튼 표시) ── */}
      <div style={sectionSep}>
        {onToggleSketchHistory && (
          <button
            onClick={onToggleSketchHistory}
            style={{
              width: '100%', padding: '5px 10px', borderRadius: 6,
              border: `1px solid ${showSketchHistory ? '#388bfd' : '#30363d'}`,
              background: showSketchHistory ? '#1a2332' : '#161b22',
              color: showSketchHistory ? '#388bfd' : '#8b949e',
              fontWeight: 700, fontSize: 10, cursor: 'pointer', transition: 'all 0.15s',
              marginBottom: 5, display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <span>🕐</span>
            {t.sketchHistory || 'Sketch History'}
            <span style={{ marginLeft: 'auto', fontSize: 9 }}>{showSketchHistory ? '▲' : '▼'}</span>
          </button>
        )}

        {sketchStep === 'setup3d' && (
        <button
          onClick={onGenerate}
          disabled={!canGenerate}
          style={{
            width: '100%', padding: '9px 14px', borderRadius: 8,
            border: editingFeatureId ? '2px solid #d29922' : 'none',
            background: canGenerate
              ? editingFeatureId
                ? 'linear-gradient(135deg, #d29922 0%, #b07d10 100%)'
                : 'linear-gradient(135deg, #388bfd 0%, #1f6feb 100%)'
              : '#21262d',
            color: canGenerate ? '#fff' : '#484f58',
            fontWeight: 800, fontSize: 13, cursor: canGenerate ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s',
            boxShadow: canGenerate ? '0 4px 16px rgba(56,139,253,0.3)' : 'none',
            marginBottom: 5,
          }}
        >
          {editingFeatureId
            ? (t.updateFeature || 'Update Feature')
            : (t.sketchGenerate || 'Generate 3D')}
        </button>
        )}

        {confirmClear ? (
          <div style={{ padding: '8px 10px', borderRadius: 7, border: '1px solid #f85149', background: '#2d0e0e', marginBottom: 2 }}>
            <p style={{ fontSize: 11, color: '#f85149', fontWeight: 700, margin: '0 0 6px', textAlign: 'center' }}>
              {i18n.confirmClear}
            </p>
            <div style={{ display: 'flex', gap: 5 }}>
              <button
                onClick={() => setConfirmClear(false)}
                style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #30363d', background: '#161b22', color: '#c9d1d9', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}
              >
                {i18n.cancel}
              </button>
              <button
                onClick={() => { onClear(); setConfirmClear(false); }}
                style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid #f85149', background: '#3d1010', color: '#f85149', fontWeight: 800, fontSize: 11, cursor: 'pointer' }}
              >
                {i18n.clearAll}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 5 }}>
            <button
              onClick={onUndo}
              disabled={profile.segments.length === 0}
              title={profile.segments.length === 0 ? i18n.nothingUndo : i18n.undoLast}
              style={{
                flex: 1, padding: '6px 8px', borderRadius: 6,
                border: '1px solid #30363d', background: '#161b22',
                color: profile.segments.length > 0 ? '#c9d1d9' : '#6e7681',
                fontWeight: 600, fontSize: 11,
                cursor: profile.segments.length > 0 ? 'pointer' : 'not-allowed',
              }}
            >
              ↩ {t.sketchUndo || 'Undo'}
            </button>
            <button
              onClick={() => profile.segments.length > 0 && setConfirmClear(true)}
              disabled={profile.segments.length === 0}
              title={profile.segments.length === 0 ? i18n.nothingClear : i18n.clearAllTip}
              style={{
                flex: 1, padding: '6px 8px', borderRadius: 6,
                border: '1px solid #30363d', background: '#161b22',
                color: profile.segments.length > 0 ? '#f85149' : '#6e7681',
                fontWeight: 600, fontSize: 11,
                cursor: profile.segments.length > 0 ? 'pointer' : 'not-allowed',
              }}
            >
              ✕ {t.sketchClear || 'Clear'}
            </button>
          </div>
        )}
      </div>

      {/* ── Add to Feature Tree ── */}
      {onAddSketchFeature && (
        <div style={{ ...sectionSep, borderColor: '#388bfd44' }}>
          <div style={{ ...sectionTitle, color: '#58a6ff' }}>
            {t.addToFeatureTree || 'Add to Feature Tree'}
          </div>

          {canGenerate ? (
            <>
          {/* Plane selector */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 5 }}>
            {(['xy', 'xz', 'yz'] as const).map(p => (
              <button
                key={p}
                onClick={() => onSketchPlaneChange?.(p)}
                style={{
                  flex: 1, padding: '4px 6px', borderRadius: 5,
                  border: sketchPlane === p ? '2px solid #388bfd' : '1px solid #30363d',
                  background: sketchPlane === p ? '#0d1a2e' : '#161b22',
                  color: sketchPlane === p ? '#388bfd' : '#8b949e',
                  fontWeight: 700, fontSize: 10, cursor: 'pointer',
                }}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Plane offset */}
          <div style={{ ...sliderRowStyle, marginBottom: 5 }}>
            <span style={sliderLabelStyle}>Offset</span>
            <input type="range" min={-500} max={500} step={1} value={sketchPlaneOffset}
              onChange={e => onSketchPlaneOffsetChange?.(Number(e.target.value))}
              style={sliderStyle} />
            <span style={sliderValueStyle}>{sketchPlaneOffset}</span>
          </div>

          {/* Operation selector */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {(['add', 'subtract'] as const).map(op => {
              const active = sketchOperation === op;
              const labels: Record<'add' | 'subtract', string> = {
                add: t.sketchAdd || 'Add',
                subtract: t.sketchSubtract || 'Subtract',
              };
              const icons = { add: '+', subtract: '−' };
              return (
                <button
                  key={op}
                  onClick={() => onSketchOperationChange?.(op)}
                  style={{
                    flex: 1, padding: '5px 6px', borderRadius: 6,
                    border: active ? '2px solid #388bfd' : '1px solid #30363d',
                    background: active ? 'linear-gradient(135deg, #388bfd 0%, #1f6feb 100%)' : '#161b22',
                    color: active ? '#fff' : '#8b949e', fontWeight: 700, fontSize: 11, cursor: 'pointer',
                  }}
                >
                  {icons[op]} {labels[op]}
                </button>
              );
            })}
          </div>
            </>
          ) : (
            <p style={{ fontSize: 10, color: '#8b949e', margin: '0 0 10px', lineHeight: 1.45 }}>
              {i18n.unlockHint}
            </p>
          )}

          {/* Finish & Add button */}
          <button
            onClick={onAddSketchFeature}
            disabled={!canGenerate}
            style={{
              width: '100%', padding: '9px 14px', borderRadius: 8, border: 'none',
              background: canGenerate
                ? 'linear-gradient(135deg, #3fb950 0%, #238636 100%)'
                : '#21262d',
              color: canGenerate ? '#fff' : '#484f58',
              fontWeight: 800, fontSize: 12, cursor: canGenerate ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              boxShadow: canGenerate ? '0 4px 14px rgba(63,185,80,0.3)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}
          >
            <span style={{ fontSize: 13 }}>✏️</span>
            {t.addToFeatureTree || 'Finish & Add to Feature Tree'}
          </button>
        </div>
      )}

      {/* ── Tips ── */}
      <div style={{ ...sectionSep, borderStyle: 'dashed' }}>
        <p style={{ fontSize: 10, color: '#6e7681', lineHeight: 1.4, margin: 0 }}>
          {t.sketchTip || 'Click to place points. Double-click or click first point to close. Ctrl+Z to undo.'}
        </p>
      </div>
    </div>
  );
}
