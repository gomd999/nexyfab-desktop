'use client';
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import * as THREE from 'three';
import { runJscadCode } from './jscadRunner';
import { loadHistory, saveToHistory, deleteFromHistory, type JscadHistoryItem } from './jscadHistory';
import { extractParams, updateParam, type JscadParam } from './jscadParams';
import type { ElementSelectionInfo, FaceSelectionInfo } from '../editing/selectionInfo';
import { downloadBlob } from '@/lib/platform';

const dict = {
  ko: {
    tabShape: '⚙ AI 형상',
    tabHistory: '📜 이력',
    tabLibrary: '📚 라이브러리',
    currentShapeDetected: '현재 형상 감지됨',
    converting: '변환 중…',
    importToJscad: 'JSCAD로 가져오기',
    selectedFace: '선택된 면',
    addHole: '구멍 추가',
    addHoleHint: '이 면에 관통 구멍을 추가해줘.',
    offset: '오프셋',
    offsetHint: '이 면을 2mm 오프셋(돌출)해줘.',
    chamfer: 'Chamfer',
    chamferHint: '이 면 가장자리에 1mm Chamfer를 추가해줘.',
    pocket: '포켓',
    pocketHint: '이 면에 깊이 3mm 직사각형 포켓을 추가해줘.',
    refineDesc: '수정 내용을 입력하면 기존 형상을 유지하며 변경합니다.',
    generateDesc: '자연어로 형상을 설명하면 AI가 정밀 3D 솔리드를 생성합니다.',
    placeholderRefine: '예: 구멍 지름을 8mm로 변경, 높이를 10mm 늘려줘',
    placeholderGenerate: '예: 볼트 구멍 4개 있는 bracket 50×30×5mm',
    refine: '수정',
    generate: '생성',
    restart: '↩ 새로 시작',
    saveToLibrary: '★ 라이브러리에 저장',
    saveTooltip: '이 프롬프트를 라이브러리에 저장',
    appliedToViewer: '✓ 3D 형상 뷰어 적용 완료',
    triangles: '삼각형',
    aiFixing: 'AI 수정 중…',
    aiAutoFix: '✨ AI 자동 수정',
    manualRetry: '수동 재시도',
    paramsLabel: '🎚 파라미터',
    paramsCount: '개',
    paramsHint: '슬라이더 조정 시 실시간으로 3D 형상이 재생성됩니다.',
    jscadCode: 'JSCAD 코드',
    copied: '✓ 복사됨',
    copy: '복사',
    compiling: '컴파일 중…',
    apply: '적용',
    codeApplyHint: '코드 수정 후 "적용" 버튼으로 즉시 반영됩니다.',
    personal: '👤 개인',
    team: '👥 팀',
    loading: '불러오는 중…',
    noPersonal: '저장된 개인 프롬프트가 없습니다.',
    noOrg: '소속된 조직이 없습니다.',
    noShared: '팀에 공유된 프롬프트가 없습니다.',
    libSaveHint: '생성 탭에서 ★ 버튼으로 저장하세요.',
    teamTag: '팀',
    sharedTag: '· 공유받음',
    editPrompt: '프롬프트 수정',
    savePrompt: '프롬프트 라이브러리에 저장',
    title: '제목',
    titlePlaceholder: '예: 표준 bracket 50×30',
    descOptional: '설명 (선택)',
    descPlaceholder: '용도 또는 메모',
    shareScope: '공유 범위',
    personalScope: '👤 개인용',
    teamScope: '👥 팀 공유',
    org: '조직',
    promptPreview: '프롬프트 미리보기',
    cancel: '취소',
    saving: '저장 중…',
    save: '저장',
    noHistory: '아직 생성한 형상이 없습니다.',
    statGenerate: '생성',
    statGenerating: '생성 중…',
    statCompile: '컴파일…',
    statFixing: 'AI 수정 중…',
    statRefining: '수정 중…',
    statConverting: '변환 중…',
    ideaSource: '아이디어로 설계',
    ideaSourceShort: '아이디어 설계',
    errCompile: '컴파일 오류',
    errAI: 'AI 오류',
    errUnknown: '알 수 없는 오류',
    errRefine: '수정 오류',
    errAutoFix: '자동 수정 실패',
    errFaceOp: '면 작업 오류',
    errConvert: '변환 오류',
    errTitleRequired: '제목을 입력하세요.',
    errOrgRequired: '조직을 선택하세요.',
    errSaveFail: '저장 실패',
    confirmDelete: '이 프롬프트를 삭제하시겠습니까?',
    jscadConvertSuffix: 'JSCAD 변환',
    localeString: 'ko-KR',
    runtimeEngineNote:
      '브라우저에서 JSCAD (@jscad/modeling)로 실행됩니다. OpenSCAD(.scad) CLI 병행은 로드맵 — docs/strategy/JSCAD_OPENSCAD_BRIDGE.md',
    tabOpenScad: '🧊 OpenSCAD(.scad)',
    scadTabNote:
      '서버에서 OpenSCAD CLI로 렌더합니다. OPENSCAD_BIN 미설정 시 설치 경로의 openscad(또는 Windows의 openscad.com)가 필요합니다.',
    scadPlaceholder: 'cube([10,10,10], center=true);',
    renderScadSync: '동기 렌더',
    renderScadAsync: '비동기 작업',
    scadRendering: '렌더 중…',
    scadJobPoll: '작업 상태',
    scadDownloadStl: 'STL 다운로드',
    scadImportHint: '뷰어에 넣으려면 워크스페이스에서 STL 가져오기를 사용하세요.',
    scadStoredRemoteHint: '메시가 원격 저장소에 있습니다. STL 다운로드 또는 서명 URL을 사용하세요.',
    scadError: 'OpenSCAD 오류',
    apiMonthlyLimit: '이번 달 OpenSCAD 서버 렌더 한도를 초과했습니다. 플랜을 확인하거나 잠시 후 다시 시도하세요.',
    apiRateLimit: '요청이 너무 잦습니다. 잠시 후 다시 시도하세요.',
    apiScadRequired: 'scad 코드가 비어 있습니다.',
    apiOutputTooLarge: '렌더 결과가 인라인 응답 한도를 초과했습니다. 모델을 단순화하거나 비동기 작업을 사용하세요.',
  },
  en: {
    tabShape: '⚙ AI Shape',
    tabHistory: '📜 History',
    tabLibrary: '📚 Library',
    currentShapeDetected: 'Current shape detected',
    converting: 'Converting…',
    importToJscad: 'Import to JSCAD',
    selectedFace: 'Selected face',
    addHole: 'Add Hole',
    addHoleHint: 'Add a through Hole on this face.',
    offset: 'Offset',
    offsetHint: 'Offset (Extrude) this face by 2mm.',
    chamfer: 'Chamfer',
    chamferHint: 'Add a 1mm Chamfer to the edges of this face.',
    pocket: 'Pocket',
    pocketHint: 'Add a 3mm deep rectangular pocket on this face.',
    refineDesc: 'Enter changes to modify the existing shape while preserving it.',
    generateDesc: 'Describe the shape in natural language and AI will generate a precise 3D solid.',
    placeholderRefine: 'e.g. change Hole diameter to 8mm, increase height by 10mm',
    placeholderGenerate: 'e.g. bracket 50×30×5mm with 4 bolt holes',
    refine: 'Refine',
    generate: 'Generate',
    restart: '↩ Restart',
    saveToLibrary: '★ Save to Library',
    saveTooltip: 'Save this prompt to the library',
    appliedToViewer: '✓ Applied to 3D viewer',
    triangles: 'triangles',
    aiFixing: 'AI fixing…',
    aiAutoFix: '✨ AI Auto-Fix',
    manualRetry: 'Manual retry',
    paramsLabel: '🎚 Parameters',
    paramsCount: '',
    paramsHint: 'Adjusting sliders regenerates the 3D shape in real time.',
    jscadCode: 'JSCAD code',
    copied: '✓ Copied',
    copy: 'Copy',
    compiling: 'Compiling…',
    apply: 'Apply',
    codeApplyHint: 'Edit code and click "Apply" to take effect immediately.',
    personal: '👤 Personal',
    team: '👥 Team',
    loading: 'Loading…',
    noPersonal: 'No saved personal prompts.',
    noOrg: 'You do not belong to any organization.',
    noShared: 'No prompts shared with the team.',
    libSaveHint: 'Save from the Generate tab using the ★ button.',
    teamTag: 'Team',
    sharedTag: '· Shared',
    editPrompt: 'Edit prompt',
    savePrompt: 'Save to prompt library',
    title: 'Title',
    titlePlaceholder: 'e.g. Standard bracket 50×30',
    descOptional: 'Description (optional)',
    descPlaceholder: 'Purpose or notes',
    shareScope: 'Sharing scope',
    personalScope: '👤 Personal',
    teamScope: '👥 Team share',
    org: 'Organization',
    promptPreview: 'Prompt preview',
    cancel: 'Cancel',
    saving: 'Saving…',
    save: 'Save',
    noHistory: 'No shapes generated yet.',
    statGenerate: 'Generate',
    statGenerating: 'Generating…',
    statCompile: 'Compiling…',
    statFixing: 'AI fixing…',
    statRefining: 'Refining…',
    statConverting: 'Converting…',
    ideaSource: 'Design from idea',
    ideaSourceShort: 'Idea design',
    errCompile: 'Compile error',
    errAI: 'AI error',
    errUnknown: 'Unknown error',
    errRefine: 'Refine error',
    errAutoFix: 'Auto-fix failed',
    errFaceOp: 'Face operation error',
    errConvert: 'Conversion error',
    errTitleRequired: 'Please enter a title.',
    errOrgRequired: 'Please select an organization.',
    errSaveFail: 'Save failed',
    confirmDelete: 'Delete this prompt?',
    jscadConvertSuffix: 'JSCAD conversion',
    localeString: 'en-US',
    runtimeEngineNote:
      'Runs as JSCAD (@jscad/modeling) in the browser. Native OpenSCAD (.scad) CLI is a separate roadmap — docs/strategy/JSCAD_OPENSCAD_BRIDGE.md',
    tabOpenScad: '🧊 OpenSCAD(.scad)',
    scadTabNote:
      'Renders on the server via OpenSCAD CLI. Set OPENSCAD_BIN if the binary is not on PATH (Windows: openscad.com).',
    scadPlaceholder: 'cube([10,10,10], center=true);',
    renderScadSync: 'Render (sync)',
    renderScadAsync: 'Enqueue job',
    scadRendering: 'Rendering…',
    scadJobPoll: 'Job status',
    scadDownloadStl: 'Download STL',
    scadImportHint: 'To load in the viewer, use workspace File → import STL.',
    scadStoredRemoteHint: 'Mesh is stored remotely — use Download STL or the signed URL.',
    scadError: 'OpenSCAD error',
    apiMonthlyLimit: 'Monthly OpenSCAD server render limit reached. Upgrade your plan or try again later.',
    apiRateLimit: 'Too many requests. Try again shortly.',
    apiScadRequired: 'scad source is empty.',
    apiOutputTooLarge: 'Rendered mesh exceeds inline response limit. Simplify the model or use async render.',
  },
  ja: {
    tabShape: '⚙ AI 形状',
    tabHistory: '📜 履歴',
    tabLibrary: '📚 ライブラリ',
    currentShapeDetected: '現在の形状を検出',
    converting: '変換中…',
    importToJscad: 'JSCADに取り込む',
    selectedFace: '選択された面',
    addHole: 'Hole 追加',
    addHoleHint: 'この面に貫通 Hole を追加して。',
    offset: 'オフセット',
    offsetHint: 'この面を2mm オフセット（Extrude）して。',
    chamfer: 'Chamfer',
    chamferHint: 'この面のエッジに1mmの Chamfer を追加して。',
    pocket: 'ポケット',
    pocketHint: 'この面に深さ3mmの長方形ポケットを追加して。',
    refineDesc: '変更内容を入力すると、既存の形状を保持したまま変更します。',
    generateDesc: '自然言語で形状を説明すると、AIが精密な3Dソリッドを生成します。',
    placeholderRefine: '例: Hole 直径を8mmに変更、高さを10mm伸ばす',
    placeholderGenerate: '例: bolt Hole 4つの bracket 50×30×5mm',
    refine: '修正',
    generate: '生成',
    restart: '↩ やり直す',
    saveToLibrary: '★ ライブラリに保存',
    saveTooltip: 'このプロンプトをライブラリに保存',
    appliedToViewer: '✓ 3Dビューアに適用完了',
    triangles: '三角形',
    aiFixing: 'AI修正中…',
    aiAutoFix: '✨ AI自動修正',
    manualRetry: '手動で再試行',
    paramsLabel: '🎚 パラメータ',
    paramsCount: '個',
    paramsHint: 'スライダーを調整するとリアルタイムで3D形状が再生成されます。',
    jscadCode: 'JSCADコード',
    copied: '✓ コピー済み',
    copy: 'コピー',
    compiling: 'コンパイル中…',
    apply: '適用',
    codeApplyHint: 'コード変更後「適用」ボタンで即時反映されます。',
    personal: '👤 個人',
    team: '👥 チーム',
    loading: '読み込み中…',
    noPersonal: '保存された個人プロンプトがありません。',
    noOrg: '所属する組織がありません。',
    noShared: 'チームに共有されたプロンプトがありません。',
    libSaveHint: '生成タブの★ボタンで保存してください。',
    teamTag: 'チーム',
    sharedTag: '· 共有受領',
    editPrompt: 'プロンプト編集',
    savePrompt: 'プロンプトライブラリに保存',
    title: 'タイトル',
    titlePlaceholder: '例: 標準 bracket 50×30',
    descOptional: '説明（任意）',
    descPlaceholder: '用途またはメモ',
    shareScope: '共有範囲',
    personalScope: '👤 個人用',
    teamScope: '👥 チーム共有',
    org: '組織',
    promptPreview: 'プロンプトプレビュー',
    cancel: 'キャンセル',
    saving: '保存中…',
    save: '保存',
    noHistory: 'まだ生成した形状がありません。',
    statGenerate: '生成',
    statGenerating: '生成中…',
    statCompile: 'コンパイル…',
    statFixing: 'AI修正中…',
    statRefining: '修正中…',
    statConverting: '変換中…',
    ideaSource: 'アイデアから設計',
    ideaSourceShort: 'アイデア設計',
    errCompile: 'コンパイルエラー',
    errAI: 'AIエラー',
    errUnknown: '不明なエラー',
    errRefine: '修正エラー',
    errAutoFix: '自動修正失敗',
    errFaceOp: '面操作エラー',
    errConvert: '変換エラー',
    errTitleRequired: 'タイトルを入力してください。',
    errOrgRequired: '組織を選択してください。',
    errSaveFail: '保存失敗',
    confirmDelete: 'このプロンプトを削除しますか？',
    jscadConvertSuffix: 'JSCAD変換',
    localeString: 'ja-JP',
    runtimeEngineNote:
      'ブラウザで JSCAD (@jscad/modeling) として実行。OpenSCAD(.scad) CLI は別ロードマップ — docs/strategy/JSCAD_OPENSCAD_BRIDGE.md',
    tabOpenScad: '🧊 OpenSCAD(.scad)',
    scadTabNote:
      'サーバーで OpenSCAD CLI を実行。PATH に無い場合は OPENSCAD_BIN を設定（Windows: openscad.com）。',
    scadPlaceholder: 'cube([10,10,10], center=true);',
    renderScadSync: '同期レンダー',
    renderScadAsync: '非同期ジョブ',
    scadRendering: 'レンダ中…',
    scadJobPoll: 'ジョブ状態',
    scadDownloadStl: 'STL をダウンロード',
    scadImportHint: 'ビューアへはワークスペースの STL 取り込みを使用してください。',
    scadStoredRemoteHint: 'メッシュはリモートに保存されています。STL ダウンロードまたは署名付き URL を使用してください。',
    scadError: 'OpenSCAD エラー',
    apiMonthlyLimit: '今月の OpenSCAD サーバーレンダー上限に達しました。プランを確認するか、しばらくしてから再試行してください。',
    apiRateLimit: 'リクエストが多すぎます。しばらくしてから再試行してください。',
    apiScadRequired: 'scad ソースが空です。',
    apiOutputTooLarge: 'インライン応答上限を超えるメッシュです。モデルを単純化するか非同期レンダーを使ってください。',
  },
  zh: {
    tabShape: '⚙ AI 形状',
    tabHistory: '📜 历史',
    tabLibrary: '📚 库',
    currentShapeDetected: '检测到当前形状',
    converting: '转换中…',
    importToJscad: '导入到 JSCAD',
    selectedFace: '已选面',
    addHole: '添加 Hole',
    addHoleHint: '在此面上添加贯通 Hole。',
    offset: '偏移',
    offsetHint: '将此面偏移（Extrude）2mm。',
    chamfer: 'Chamfer',
    chamferHint: '在此面边缘添加 1mm 的 Chamfer。',
    pocket: '凹槽',
    pocketHint: '在此面上添加深度 3mm 的矩形凹槽。',
    refineDesc: '输入修改内容，保留现有形状并进行变更。',
    generateDesc: '用自然语言描述形状，AI 将生成精确的 3D 实体。',
    placeholderRefine: '例如：Hole 直径改为 8mm，高度增加 10mm',
    placeholderGenerate: '例如：带 4 个 bolt Hole 的 bracket 50×30×5mm',
    refine: '修改',
    generate: '生成',
    restart: '↩ 重新开始',
    saveToLibrary: '★ 保存到库',
    saveTooltip: '将此提示保存到库',
    appliedToViewer: '✓ 已应用到 3D 查看器',
    triangles: '三角形',
    aiFixing: 'AI 修复中…',
    aiAutoFix: '✨ AI 自动修复',
    manualRetry: '手动重试',
    paramsLabel: '🎚 参数',
    paramsCount: '个',
    paramsHint: '调整滑块时会实时重新生成 3D 形状。',
    jscadCode: 'JSCAD 代码',
    copied: '✓ 已复制',
    copy: '复制',
    compiling: '编译中…',
    apply: '应用',
    codeApplyHint: '修改代码后点击"应用"按钮立即生效。',
    personal: '👤 个人',
    team: '👥 团队',
    loading: '加载中…',
    noPersonal: '没有已保存的个人提示。',
    noOrg: '未加入任何组织。',
    noShared: '团队尚未共享任何提示。',
    libSaveHint: '在生成选项卡中使用 ★ 按钮保存。',
    teamTag: '团队',
    sharedTag: '· 已共享',
    editPrompt: '编辑提示',
    savePrompt: '保存到提示库',
    title: '标题',
    titlePlaceholder: '例如：标准 bracket 50×30',
    descOptional: '描述（可选）',
    descPlaceholder: '用途或备注',
    shareScope: '共享范围',
    personalScope: '👤 个人',
    teamScope: '👥 团队共享',
    org: '组织',
    promptPreview: '提示预览',
    cancel: '取消',
    saving: '保存中…',
    save: '保存',
    noHistory: '尚未生成形状。',
    statGenerate: '生成',
    statGenerating: '生成中…',
    statCompile: '编译…',
    statFixing: 'AI 修复中…',
    statRefining: '修改中…',
    statConverting: '转换中…',
    ideaSource: '从创意设计',
    ideaSourceShort: '创意设计',
    errCompile: '编译错误',
    errAI: 'AI 错误',
    errUnknown: '未知错误',
    errRefine: '修改错误',
    errAutoFix: '自动修复失败',
    errFaceOp: '面操作错误',
    errConvert: '转换错误',
    errTitleRequired: '请输入标题。',
    errOrgRequired: '请选择组织。',
    errSaveFail: '保存失败',
    confirmDelete: '要删除此提示吗？',
    jscadConvertSuffix: 'JSCAD 转换',
    localeString: 'zh-CN',
    runtimeEngineNote:
      '在浏览器中以 JSCAD (@jscad/modeling) 运行。OpenSCAD (.scad) CLI 为独立路线图 — docs/strategy/JSCAD_OPENSCAD_BRIDGE.md',
    tabOpenScad: '🧊 OpenSCAD(.scad)',
    scadTabNote: '在服务器通过 OpenSCAD CLI 渲染。若不在 PATH，请设置 OPENSCAD_BIN（Windows: openscad.com）。',
    scadPlaceholder: 'cube([10,10,10], center=true);',
    renderScadSync: '同步渲染',
    renderScadAsync: '异步任务',
    scadRendering: '渲染中…',
    scadJobPoll: '任务状态',
    scadDownloadStl: '下载 STL',
    scadImportHint: '导入查看器请使用工作区 File → 导入 STL。',
    scadStoredRemoteHint: '网格已保存在远程存储。请使用 STL 下载或签名链接。',
    scadError: 'OpenSCAD 错误',
    apiMonthlyLimit: '本月 OpenSCAD 服务器渲染次数已达上限。请升级方案或稍后重试。',
    apiRateLimit: '请求过于频繁，请稍后重试。',
    apiScadRequired: 'scad 源码为空。',
    apiOutputTooLarge: '渲染网格超过内联响应上限。请简化模型或使用异步渲染。',
  },
  es: {
    tabShape: '⚙ Forma IA',
    tabHistory: '📜 Historial',
    tabLibrary: '📚 Biblioteca',
    currentShapeDetected: 'Forma actual detectada',
    converting: 'Convirtiendo…',
    importToJscad: 'Importar a JSCAD',
    selectedFace: 'Cara seleccionada',
    addHole: 'Añadir Hole',
    addHoleHint: 'Añade un Hole pasante en esta cara.',
    offset: 'Desfase',
    offsetHint: 'Desfasa (Extrude) esta cara 2 mm.',
    chamfer: 'Chamfer',
    chamferHint: 'Añade un Chamfer de 1 mm a los bordes de esta cara.',
    pocket: 'Bolsillo',
    pocketHint: 'Añade un bolsillo rectangular de 3 mm de profundidad en esta cara.',
    refineDesc: 'Escribe los cambios para modificar la forma existente manteniéndola.',
    generateDesc: 'Describe la forma en lenguaje natural y la IA generará un sólido 3D preciso.',
    placeholderRefine: 'ej.: cambiar el diámetro del Hole a 8 mm, aumentar altura en 10 mm',
    placeholderGenerate: 'ej.: bracket 50×30×5 mm con 4 bolt holes',
    refine: 'Refinar',
    generate: 'Generar',
    restart: '↩ Reiniciar',
    saveToLibrary: '★ Guardar en biblioteca',
    saveTooltip: 'Guardar este prompt en la biblioteca',
    appliedToViewer: '✓ Aplicado al visor 3D',
    triangles: 'triángulos',
    aiFixing: 'IA corrigiendo…',
    aiAutoFix: '✨ Auto-corrección IA',
    manualRetry: 'Reintentar manualmente',
    paramsLabel: '🎚 Parámetros',
    paramsCount: '',
    paramsHint: 'Al ajustar los deslizadores, la forma 3D se regenera en tiempo real.',
    jscadCode: 'Código JSCAD',
    copied: '✓ Copiado',
    copy: 'Copiar',
    compiling: 'Compilando…',
    apply: 'Aplicar',
    codeApplyHint: 'Edita el código y pulsa "Aplicar" para aplicarlo al instante.',
    personal: '👤 Personal',
    team: '👥 Equipo',
    loading: 'Cargando…',
    noPersonal: 'No hay prompts personales guardados.',
    noOrg: 'No perteneces a ninguna organización.',
    noShared: 'No hay prompts compartidos con el equipo.',
    libSaveHint: 'Guarda desde la pestaña Generar con el botón ★.',
    teamTag: 'Equipo',
    sharedTag: '· Compartido',
    editPrompt: 'Editar prompt',
    savePrompt: 'Guardar en biblioteca de prompts',
    title: 'Título',
    titlePlaceholder: 'ej.: bracket estándar 50×30',
    descOptional: 'Descripción (opcional)',
    descPlaceholder: 'Uso o notas',
    shareScope: 'Ámbito de compartir',
    personalScope: '👤 Personal',
    teamScope: '👥 Compartir con equipo',
    org: 'Organización',
    promptPreview: 'Vista previa del prompt',
    cancel: 'Cancelar',
    saving: 'Guardando…',
    save: 'Guardar',
    noHistory: 'Aún no se han generado formas.',
    statGenerate: 'Generar',
    statGenerating: 'Generando…',
    statCompile: 'Compilando…',
    statFixing: 'IA corrigiendo…',
    statRefining: 'Refinando…',
    statConverting: 'Convirtiendo…',
    ideaSource: 'Diseñar desde idea',
    ideaSourceShort: 'Diseño de idea',
    errCompile: 'Error de compilación',
    errAI: 'Error de IA',
    errUnknown: 'Error desconocido',
    errRefine: 'Error al refinar',
    errAutoFix: 'Fallo en auto-corrección',
    errFaceOp: 'Error de operación de cara',
    errConvert: 'Error de conversión',
    errTitleRequired: 'Introduce un título.',
    errOrgRequired: 'Selecciona una organización.',
    errSaveFail: 'Fallo al guardar',
    confirmDelete: '¿Eliminar este prompt?',
    jscadConvertSuffix: 'Conversión JSCAD',
    localeString: 'es-ES',
    runtimeEngineNote:
      'Se ejecuta como JSCAD (@jscad/modeling) en el navegador. La CLI nativa OpenSCAD (.scad) es hoja de ruta aparte — docs/strategy/JSCAD_OPENSCAD_BRIDGE.md',
    tabOpenScad: '🧊 OpenSCAD(.scad)',
    scadTabNote:
      'Render en servidor con OpenSCAD CLI. Configure OPENSCAD_BIN si no está en PATH (Windows: openscad.com).',
    scadPlaceholder: 'cube([10,10,10], center=true);',
    renderScadSync: 'Render (sync)',
    renderScadAsync: 'Encolar trabajo',
    scadRendering: 'Renderizando…',
    scadJobPoll: 'Estado del trabajo',
    scadDownloadStl: 'Descargar STL',
    scadImportHint: 'Para el visor: Archivo → importar STL en el workspace.',
    scadStoredRemoteHint: 'La malla está en almacenamiento remoto: use Descargar STL o el enlace firmado.',
    scadError: 'Error OpenSCAD',
    apiMonthlyLimit: 'Se alcanzó el límite mensual de render OpenSCAD en servidor. Actualiza el plan o reintenta más tarde.',
    apiRateLimit: 'Demasiadas solicitudes. Intenta de nuevo en breve.',
    apiScadRequired: 'El código scad está vacío.',
    apiOutputTooLarge: 'La malla supera el límite de respuesta en línea. Simplifica el modelo o usa render asíncrono.',
  },
  ar: {
    tabShape: '⚙ شكل الذكاء الاصطناعي',
    tabHistory: '📜 السجل',
    tabLibrary: '📚 المكتبة',
    currentShapeDetected: 'تم اكتشاف الشكل الحالي',
    converting: 'جارٍ التحويل…',
    importToJscad: 'استيراد إلى JSCAD',
    selectedFace: 'الوجه المحدد',
    addHole: 'إضافة Hole',
    addHoleHint: 'أضف Hole نافذاً على هذا الوجه.',
    offset: 'إزاحة',
    offsetHint: 'أزِح (Extrude) هذا الوجه بمقدار 2 مم.',
    chamfer: 'Chamfer',
    chamferHint: 'أضف Chamfer بمقدار 1 مم إلى حواف هذا الوجه.',
    pocket: 'جيب',
    pocketHint: 'أضف جيباً مستطيلاً بعمق 3 مم على هذا الوجه.',
    refineDesc: 'أدخل التغييرات لتعديل الشكل الحالي مع الحفاظ عليه.',
    generateDesc: 'صف الشكل بلغة طبيعية وسينشئ الذكاء الاصطناعي مجسماً ثلاثي الأبعاد دقيقاً.',
    placeholderRefine: 'مثال: غيّر قطر Hole إلى 8 مم، زد الارتفاع 10 مم',
    placeholderGenerate: 'مثال: bracket 50×30×5 مم مع 4 bolt holes',
    refine: 'تعديل',
    generate: 'إنشاء',
    restart: '↩ إعادة البدء',
    saveToLibrary: '★ حفظ في المكتبة',
    saveTooltip: 'حفظ هذه المطالبة في المكتبة',
    appliedToViewer: '✓ تم التطبيق على العارض ثلاثي الأبعاد',
    triangles: 'مثلثات',
    aiFixing: 'الذكاء الاصطناعي يُصلح…',
    aiAutoFix: '✨ إصلاح تلقائي بالذكاء الاصطناعي',
    manualRetry: 'إعادة المحاولة يدوياً',
    paramsLabel: '🎚 المعاملات',
    paramsCount: '',
    paramsHint: 'عند تعديل المنزلقات يتم إعادة إنشاء الشكل ثلاثي الأبعاد فورياً.',
    jscadCode: 'كود JSCAD',
    copied: '✓ تم النسخ',
    copy: 'نسخ',
    compiling: 'جارٍ الترجمة…',
    apply: 'تطبيق',
    codeApplyHint: 'عدّل الكود ثم اضغط "تطبيق" لتفعيله فوراً.',
    personal: '👤 شخصي',
    team: '👥 فريق',
    loading: 'جارٍ التحميل…',
    noPersonal: 'لا توجد مطالبات شخصية محفوظة.',
    noOrg: 'لا تنتمي إلى أي منظمة.',
    noShared: 'لا توجد مطالبات مشتركة مع الفريق.',
    libSaveHint: 'احفظ من تبويب الإنشاء باستخدام زر ★.',
    teamTag: 'فريق',
    sharedTag: '· مشترك',
    editPrompt: 'تعديل المطالبة',
    savePrompt: 'الحفظ في مكتبة المطالبات',
    title: 'العنوان',
    titlePlaceholder: 'مثال: bracket قياسي 50×30',
    descOptional: 'الوصف (اختياري)',
    descPlaceholder: 'الاستخدام أو ملاحظات',
    shareScope: 'نطاق المشاركة',
    personalScope: '👤 شخصي',
    teamScope: '👥 مشاركة الفريق',
    org: 'المنظمة',
    promptPreview: 'معاينة المطالبة',
    cancel: 'إلغاء',
    saving: 'جارٍ الحفظ…',
    save: 'حفظ',
    noHistory: 'لم يتم إنشاء أشكال بعد.',
    statGenerate: 'إنشاء',
    statGenerating: 'جارٍ الإنشاء…',
    statCompile: 'جارٍ الترجمة…',
    statFixing: 'الذكاء الاصطناعي يُصلح…',
    statRefining: 'جارٍ التعديل…',
    statConverting: 'جارٍ التحويل…',
    ideaSource: 'تصميم من فكرة',
    ideaSourceShort: 'تصميم فكرة',
    errCompile: 'خطأ في الترجمة',
    errAI: 'خطأ في الذكاء الاصطناعي',
    errUnknown: 'خطأ غير معروف',
    errRefine: 'خطأ في التعديل',
    errAutoFix: 'فشل الإصلاح التلقائي',
    errFaceOp: 'خطأ في عملية الوجه',
    errConvert: 'خطأ في التحويل',
    errTitleRequired: 'يرجى إدخال عنوان.',
    errOrgRequired: 'يرجى اختيار منظمة.',
    errSaveFail: 'فشل الحفظ',
    confirmDelete: 'حذف هذه المطالبة؟',
    jscadConvertSuffix: 'تحويل JSCAD',
    localeString: 'ar-SA',
    runtimeEngineNote:
      'يعمل كـ JSCAD (@jscad/modeling) داخل المتصفح. واجهة OpenSCAD (.scad) الأصلية في خارطة طريق منفصلة — docs/strategy/JSCAD_OPENSCAD_BRIDGE.md',
    tabOpenScad: '🧊 OpenSCAD(.scad)',
    scadTabNote:
      'التصيير على الخادم عبر OpenSCAD CLI. اضبط OPENSCAD_BIN إذا لم يكن في PATH (Windows: openscad.com).',
    scadPlaceholder: 'cube([10,10,10], center=true);',
    renderScadSync: 'Render (sync)',
    renderScadAsync: 'Enqueue job',
    scadRendering: 'Rendering…',
    scadJobPoll: 'Job status',
    scadDownloadStl: 'Download STL',
    scadImportHint: 'To load in the viewer, use workspace File → import STL.',
    scadStoredRemoteHint: 'Mesh is stored remotely — use Download STL or the signed URL.',
    scadError: 'OpenSCAD error',
    apiMonthlyLimit: 'تم بلوغ الحد الشهري لعرض OpenSCAD على الخادم. قم بترقية الخطة أو أعد المحاولة لاحقًا.',
    apiRateLimit: 'طلبات كثيرة جدًا. حاول بعد قليل.',
    apiScadRequired: 'مصدر scad فارغ.',
    apiOutputTooLarge: 'الشبكة تتجاوز حد الاستجابة المضمنة. بسِّط النموذج أو استخدم العرض غير المتزامن.',
  },
} as const;

interface CurrentShape {
  shapeId: string | null;
  params: Record<string, number>;
  features: Array<{ type: string; params: Record<string, number> }>;
  bbox: { w: number; h: number; d: number } | null;
}

interface Props {
  onGeometryReady: (geo: THREE.BufferGeometry, description: string) => void;
  selectedElement?: ElementSelectionInfo | null;
  currentShape?: CurrentShape | null;
}

type Tab = 'generate' | 'history' | 'library' | 'openscad';
type GenStatus = 'idle' | 'generating' | 'compiling' | 'fixing' | 'refining' | 'converting' | 'done' | 'error';
type LibScope = 'personal' | 'org';

interface PromptLibraryEntry {
  id: string;
  scope: 'personal' | 'org';
  orgId: string | null;
  ownerId: string;
  title: string;
  prompt: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
  isMine: boolean;
}

interface OrgInfo { id: string; name: string }

const EXAMPLE_PROMPTS = [
  '볼트 구멍 4개 있는 브라켓 50×30×5mm',
  'M8 볼트용 플랜지 커플링',
  '두께 3mm 사각 박스 하우징',
  '기어 이빨 16개 소형 스퍼 기어',
  '손잡이 있는 레버 암 120mm',
  'L형 앵글 브라켓 40×40×4mm',
];

// STL export from BufferGeometry
async function exportSTL(geo: THREE.BufferGeometry, filename = 'model.stl') {
  const pos = geo.attributes.position;
  const triCount = Math.floor(pos.count / 3);
  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  let offset = 80;
  view.setUint32(offset, triCount, true); offset += 4;
  const v = new THREE.Vector3();
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  const edge1 = new THREE.Vector3(), edge2 = new THREE.Vector3(), norm = new THREE.Vector3();
  for (let i = 0; i < triCount; i++) {
    const base = i * 3;
    vA.fromBufferAttribute(pos, base);
    vB.fromBufferAttribute(pos, base + 1);
    vC.fromBufferAttribute(pos, base + 2);
    edge1.subVectors(vB, vA); edge2.subVectors(vC, vA);
    norm.crossVectors(edge1, edge2).normalize();
    view.setFloat32(offset, norm.x, true); view.setFloat32(offset + 4, norm.y, true); view.setFloat32(offset + 8, norm.z, true); offset += 12;
    for (const vtx of [vA, vB, vC]) {
      view.setFloat32(offset, vtx.x, true); view.setFloat32(offset + 4, vtx.y, true); view.setFloat32(offset + 8, vtx.z, true); offset += 12;
    }
    view.setUint16(offset, 0, true); offset += 2;
  }
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  await downloadBlob(filename, blob);
}

function openScadApiErrorMessage(
  t: (typeof dict)[keyof typeof dict],
  data: Record<string, unknown>,
): string {
  const code = typeof data.code === 'string' ? data.code : '';
  const err = typeof data.error === 'string' ? data.error : '';
  if (code === 'MONTHLY_LIMIT') return t.apiMonthlyLimit;
  if (code === 'RATE_LIMIT') return t.apiRateLimit;
  if (code === 'SCAD_REQUIRED') return t.apiScadRequired;
  if (code === 'OUTPUT_TOO_LARGE') return t.apiOutputTooLarge;
  return err || t.scadError;
}

export default function OpenScadPanel({ onGeometryReady, selectedElement, currentShape }: Props) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

  const [tab, setTab] = useState<Tab>('generate');
  const [prompt, setPrompt] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<GenStatus>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [triCount, setTriCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<JscadHistoryItem[]>([]);
  const [showParams, setShowParams] = useState(false);
  const [showCode, setShowCode] = useState(false);

  /** OpenSCAD(.scad) server CLI tab */
  const [scadSource, setScadSource] = useState('cube([10,10,10], center=true);');
  const [scadBusy, setScadBusy] = useState(false);
  const [scadErr, setScadErr] = useState('');
  const [scadJobId, setScadJobId] = useState<string | null>(null);
  const [scadJobStatus, setScadJobStatus] = useState('');
  const [scadResultB64, setScadResultB64] = useState<string | null>(null);
  const [scadArtifactUrl, setScadArtifactUrl] = useState<string | null>(null);

  // Library state
  const [library, setLibrary] = useState<PromptLibraryEntry[]>([]);
  const [libScope, setLibScope] = useState<LibScope>('personal');
  const [libLoading, setLibLoading] = useState(false);
  const [userOrgs, setUserOrgs] = useState<OrgInfo[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [saveScope, setSaveScope] = useState<LibScope>('personal');
  const [saveOrgId, setSaveOrgId] = useState<string>('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const lastGeoRef = useRef<THREE.BufferGeometry | null>(null);
  const prevGeoRef = useRef<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
    // Idea→Design Wizard 결과 코드가 sessionStorage 에 들어있으면 바로 로드
    try {
      const pendingCode = sessionStorage.getItem('nexyfab:pendingJscadCode');
      const pendingSrc = sessionStorage.getItem('nexyfab:pendingJscadSource');
      if (pendingCode) {
        setCode(pendingCode);
        setDescription(pendingSrc ?? t.ideaSource);
        setShowCode(true);
        setTab('generate');
        sessionStorage.removeItem('nexyfab:pendingJscadCode');
        sessionStorage.removeItem('nexyfab:pendingJscadSource');
        setTimeout(() => compile(pendingCode, pendingSrc ?? t.ideaSourceShort), 100);
      }
    } catch {}
    return () => { prevGeoRef.current?.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const params = useMemo(() => (code ? extractParams(code) : []), [code]);

  const compile = useCallback((codeStr: string, desc: string) => {
    if (!codeStr.trim()) return;
    setStatus('compiling');
    setErrorMsg('');
    setWarnings([]);
    setTimeout(() => {
      try {
        const result = runJscadCode(codeStr);
        prevGeoRef.current?.dispose();
        prevGeoRef.current = result.geometry;
        lastGeoRef.current = result.geometry;
        setWarnings(result.warnings);
        setTriCount(result.triCount);
        setStatus('done');
        onGeometryReady(result.geometry, desc);
      } catch (e: any) {
        setStatus('error');
        setErrorMsg(e.message ?? t.errCompile);
      }
    }, 0);
  }, [onGeometryReady, t]);

  // ── Core API call ──
  const callAI = useCallback(async (body: Record<string, unknown>, workingStatus: GenStatus) => {
    setStatus(workingStatus);
    setErrorMsg('');
    setWarnings([]);

    const res = await fetch('/api/nexyfab/jscad-gen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error ?? t.errAI);
    return data as { code: string; description: string };
  }, [t]);

  // ── Generate (new shape) ──
  const generate = useCallback(async (text?: string) => {
    const p = (text ?? prompt).trim();
    if (!p) return;
    setCode(''); setDescription(''); setTriCount(0);
    try {
      const data = await callAI({ prompt: p, mode: 'generate' }, 'generating');
      setCode(data.code);
      setDescription(data.description);
      compile(data.code, data.description || p);
      saveToHistory({ prompt: p, code: data.code, description: data.description, triCount: 0 });
      setHistory(loadHistory());
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e.message ?? t.errUnknown);
    }
  }, [prompt, callAI, compile, t]);

  // ── Refine (modify existing code) ──
  const refine = useCallback(async () => {
    const p = prompt.trim();
    if (!p || !code) return;
    try {
      const data = await callAI({ prompt: p, currentCode: code, mode: 'refine' }, 'refining');
      setCode(data.code);
      setDescription(data.description || description);
      compile(data.code, data.description || description);
      setPrompt('');
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e.message ?? t.errRefine);
    }
  }, [prompt, code, description, callAI, compile, t]);

  // ── Auto-fix compile error ──
  const autoFix = useCallback(async () => {
    if (!code || !errorMsg) return;
    try {
      const data = await callAI({ currentCode: code, errorMsg, mode: 'fix' }, 'fixing');
      setCode(data.code);
      compile(data.code, description);
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e.message ?? t.errAutoFix);
    }
  }, [code, errorMsg, description, callAI, compile, t]);

  // ── Face operation (selected face → JSCAD modification) ──
  const faceOp = useCallback(async (actionHint: string) => {
    if (!code || !selectedElement || selectedElement.type !== 'face') return;
    const face = selectedElement as FaceSelectionInfo;
    try {
      const data = await callAI({
        prompt: actionHint,
        currentCode: code,
        selectedFace: {
          normal: face.normal,
          normalLabel: face.normalLabel,
          area: face.area,
          position: face.position,
        },
        mode: 'face-op',
      }, 'refining');
      setCode(data.code);
      setDescription(data.description || description);
      compile(data.code, data.description || description);
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e.message ?? t.errFaceOp);
    }
  }, [code, selectedElement, description, callAI, compile, t]);

  // ── Convert current shape to JSCAD ──
  const convertShape = useCallback(async () => {
    if (!currentShape?.shapeId) return;
    setStatus('converting');
    setErrorMsg('');
    try {
      const res = await fetch('/api/nexyfab/shape-to-jscad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentShape),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? t.errAI);
      setCode(data.code);
      setDescription(data.description || `${currentShape.shapeId} ${t.jscadConvertSuffix}`);
      setPrompt('');
      compile(data.code, data.description || '');
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e.message ?? t.errConvert);
    }
  }, [currentShape, compile, t]);

  const recompile = useCallback(() => compile(code, description), [code, description, compile]);

  const handleParamChange = useCallback((param: JscadParam, newVal: number) => {
    const newCode = updateParam(code, param.name, newVal);
    setCode(newCode);
    compile(newCode, description);
  }, [code, description, compile]);

  const loadFromHistory = useCallback((item: JscadHistoryItem) => {
    setPrompt(item.prompt);
    setCode(item.code);
    setDescription(item.description);
    setStatus('idle');
    setTab('generate');
    compile(item.code, item.description);
  }, [compile]);

  const removeHistory = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteFromHistory(id);
    setHistory(loadHistory());
  }, []);

  // ── Prompt library ──
  const loadLibrary = useCallback(async (scope: LibScope) => {
    setLibLoading(true);
    try {
      const res = await fetch(`/api/nexyfab/prompt-library?scope=${scope}`, { credentials: 'include' });
      const data = await res.json();
      if (res.ok) setLibrary(data.entries ?? []);
      else setLibrary([]);
    } catch { setLibrary([]); }
    finally { setLibLoading(false); }
  }, []);

  useEffect(() => {
    if (tab === 'library') loadLibrary(libScope);
  }, [tab, libScope, loadLibrary]);

  // Fetch user orgs once (for save modal team option)
  useEffect(() => {
    let cancelled = false;
    fetch('/api/nexyfab/orgs', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { orgs: [] })
      .then(d => { if (!cancelled) setUserOrgs(d.orgs ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const openSaveModal = useCallback(() => {
    if (!prompt.trim() && !description) return;
    setEditingId(null);
    setSaveTitle(description.slice(0, 80) || prompt.slice(0, 80));
    setSaveDesc('');
    setSaveScope('personal');
    setSaveOrgId(userOrgs[0]?.id ?? '');
    setSaveErr('');
    setSaveOpen(true);
  }, [prompt, description, userOrgs]);

  const openEditModal = useCallback((entry: PromptLibraryEntry) => {
    setEditingId(entry.id);
    setSaveTitle(entry.title);
    setSaveDesc(entry.description ?? '');
    setSaveScope(entry.scope);
    setSaveOrgId(entry.orgId ?? userOrgs[0]?.id ?? '');
    setSaveErr('');
    setSaveOpen(true);
  }, [userOrgs]);

  const submitSave = useCallback(async () => {
    const title = saveTitle.trim();
    if (!title) { setSaveErr(t.errTitleRequired); return; }
    if (saveScope === 'org' && !saveOrgId) { setSaveErr(t.errOrgRequired); return; }
    setSaveBusy(true);
    setSaveErr('');
    try {
      const url = editingId
        ? `/api/nexyfab/prompt-library/${editingId}`
        : '/api/nexyfab/prompt-library';
      const body = editingId
        ? { title, description: saveDesc.trim() }
        : { scope: saveScope, orgId: saveScope === 'org' ? saveOrgId : undefined,
            title, prompt: prompt.trim() || description, description: saveDesc.trim() };
      const res = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? t.errSaveFail);
      setSaveOpen(false);
      if (tab === 'library') loadLibrary(libScope);
    } catch (e: any) {
      setSaveErr(e.message ?? t.errSaveFail);
    } finally {
      setSaveBusy(false);
    }
  }, [editingId, saveTitle, saveDesc, saveScope, saveOrgId, prompt, description, tab, libScope, loadLibrary, t]);

  const applyLibraryEntry = useCallback((entry: PromptLibraryEntry) => {
    setPrompt(entry.prompt);
    setTab('generate');
  }, []);

  const removeLibrary = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(t.confirmDelete)) return;
    const res = await fetch(`/api/nexyfab/prompt-library/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (res.ok) loadLibrary(libScope);
  }, [libScope, loadLibrary, t]);

  const copyCode = () => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const isWorking = ['generating', 'compiling', 'fixing', 'refining', 'converting'].includes(status);
  const isWorkingOrScad = isWorking || scadBusy;

  const pollOpenScadJob = useCallback(async (id: string) => {
    for (let i = 0; i < 180; i++) {
      const r = await fetch(`/api/nexyfab/openscad-render/job/${id}`, { credentials: 'include' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setScadErr(openScadApiErrorMessage(t, data as Record<string, unknown>));
        return;
      }
      setScadJobStatus(data.status ?? '');
      if (data.status === 'complete') {
        setScadResultB64(typeof data.dataBase64 === 'string' ? data.dataBase64 : null);
        setScadArtifactUrl(typeof data.artifactUrl === 'string' ? data.artifactUrl : null);
        return;
      }
      if (data.status === 'failed') {
        setScadErr(typeof data.error === 'string' ? data.error : t.scadError);
        return;
      }
      await new Promise<void>(res => { setTimeout(res, 1000); });
    }
    setScadErr('Job timeout');
  }, [t]);

  const renderOpenScad = useCallback(async (asyncMode: boolean) => {
    setScadBusy(true);
    setScadErr('');
    setScadJobId(null);
    setScadJobStatus('');
    setScadResultB64(null);
    setScadArtifactUrl(null);
    try {
      const res = await fetch('/api/nexyfab/openscad-render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ scad: scadSource, format: 'stl', async: asyncMode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(openScadApiErrorMessage(t, data as Record<string, unknown>));
      }
      if (data.mode === 'sync' && (data.dataBase64 || data.artifactUrl)) {
        setScadResultB64(typeof data.dataBase64 === 'string' ? data.dataBase64 : null);
        setScadArtifactUrl(typeof data.artifactUrl === 'string' ? data.artifactUrl : null);
        setScadJobStatus('complete');
        return;
      }
      if (data.mode === 'async' && data.jobId) {
        setScadJobId(data.jobId);
        await pollOpenScadJob(data.jobId);
        return;
      }
      throw new Error(data.error ?? 'Unexpected response');
    } catch (e: unknown) {
      setScadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScadBusy(false);
    }
  }, [scadSource, pollOpenScadJob, t]);

  const downloadScadStl = useCallback(async () => {
    if (scadResultB64) {
      try {
        const bin = atob(scadResultB64);
        const len = bin.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
        void downloadBlob('openscad-export.stl', new Blob([bytes], { type: 'model/stl' }));
      } catch {
        setScadErr(t.scadError);
      }
      return;
    }
    if (scadArtifactUrl) {
      try {
        const r = await fetch(scadArtifactUrl);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        void downloadBlob('openscad-export.stl', blob);
      } catch {
        setScadErr(t.scadError);
      }
    }
  }, [scadResultB64, scadArtifactUrl, t.scadError]);
  const hasCode = !!code;
  const hasSelectedFace = selectedElement?.type === 'face';
  const face = hasSelectedFace ? (selectedElement as FaceSelectionInfo) : null;

  const statusLabel: Record<GenStatus, string> = {
    idle: t.statGenerate, generating: t.statGenerating, compiling: t.statCompile,
    fixing: t.statFixing, refining: t.statRefining, converting: t.statConverting,
    done: t.statGenerate, error: t.statGenerate,
  };

  return (
    <div className="flex flex-col h-full text-sm">
      {/* 탭 */}
      <div className="flex border-b border-gray-700 flex-shrink-0">
        {(['generate', 'history', 'library', 'openscad'] as Tab[]).map(tb => (
          <button key={tb} onClick={() => setTab(tb)}
            className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 ${
              tab === tb ? 'border-indigo-400 text-indigo-300' : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}>
            {tb === 'generate' ? t.tabShape
              : tb === 'history' ? `${t.tabHistory} (${history.length})`
              : tb === 'library' ? t.tabLibrary
              : t.tabOpenScad}
          </button>
        ))}
      </div>

      <p className="text-[10px] text-gray-500 px-3 py-1.5 border-b border-gray-800 leading-snug shrink-0">
        {t.runtimeEngineNote}
      </p>

      {/* ── 생성 탭 ── */}
      {tab === 'generate' && (
        <div className="flex flex-col gap-3 p-3 overflow-y-auto flex-1">

          {/* 현재 형상 → JSCAD 변환 배너 */}
          {currentShape?.shapeId && !hasCode && (
            <div className="flex items-center justify-between bg-indigo-900/20 border border-indigo-700/40 rounded-lg px-3 py-2.5">
              <div className="flex flex-col">
                <span className="text-xs text-indigo-300 font-semibold">{t.currentShapeDetected}</span>
                <span className="text-xs text-gray-400">{currentShape.shapeId} · {currentShape.bbox ? `${currentShape.bbox.w}×${currentShape.bbox.h}×${currentShape.bbox.d}mm` : ''}</span>
              </div>
              <button
                onClick={convertShape}
                disabled={isWorkingOrScad}
                className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded font-medium whitespace-nowrap transition-colors"
              >
                {status === 'converting' ? t.converting : t.importToJscad}
              </button>
            </div>
          )}

          {/* 선택된 면 컨텍스트 */}
          {face && hasCode && (
            <div className="rounded-lg border border-cyan-700/40 bg-cyan-900/15 px-3 py-2.5">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee] flex-shrink-0" />
                <span className="text-xs font-semibold text-cyan-300">{t.selectedFace}: {face.normalLabel}</span>
                <span className="text-xs text-gray-500 ml-auto">{face.area.toFixed(0)}mm²</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { label: t.addHole, hint: t.addHoleHint },
                  { label: t.offset, hint: t.offsetHint },
                  { label: t.chamfer, hint: t.chamferHint },
                  { label: t.pocket, hint: t.pocketHint },
                ].map(a => (
                  <button key={a.label} onClick={() => faceOp(a.hint)} disabled={isWorkingOrScad}
                    className="text-xs px-2.5 py-1 bg-cyan-900/30 hover:bg-cyan-800/40 disabled:opacity-40 text-cyan-200 border border-cyan-700/30 rounded-full transition-colors">
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-gray-500 leading-relaxed">
            {hasCode ? t.refineDesc : t.generateDesc}
          </p>

          {/* 입력 */}
          <div className="flex gap-2">
            <input
              type="text"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !isWorkingOrScad) {
                  hasCode && prompt.trim() ? refine() : generate();
                }
              }}
              placeholder={hasCode ? t.placeholderRefine : t.placeholderGenerate}
              className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400 text-xs"
              disabled={isWorkingOrScad}
            />
            <button
              onClick={() => hasCode && prompt.trim() ? refine() : generate()}
              disabled={isWorkingOrScad || !prompt.trim()}
              className={`px-3 py-2 disabled:opacity-40 text-white rounded text-xs font-medium whitespace-nowrap transition-colors ${
                hasCode ? 'bg-emerald-700 hover:bg-emerald-600' : 'bg-indigo-600 hover:bg-indigo-500'
              }`}
            >
              {isWorking ? statusLabel[status] : hasCode ? t.refine : t.generate}
            </button>
          </div>

          {/* 예시 칩 (코드 없을 때만) */}
          {!hasCode && (
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_PROMPTS.map(ex => (
                <button key={ex} onClick={() => { setPrompt(ex); generate(ex); }} disabled={isWorkingOrScad}
                  className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 rounded-full transition-colors">
                  {ex}
                </button>
              ))}
            </div>
          )}

          {/* 새로 시작 / 저장 버튼 (코드 있을 때) */}
          {hasCode && !isWorkingOrScad && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setCode(''); setDescription(''); setPrompt(''); setStatus('idle'); setErrorMsg(''); setTriCount(0); }}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                {t.restart}
              </button>
              <button
                onClick={openSaveModal}
                disabled={!prompt.trim() && !description}
                className="text-xs text-amber-400 hover:text-amber-300 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
                title={t.saveTooltip}
              >
                {t.saveToLibrary}
              </button>
            </div>
          )}

          {/* 설명 */}
          {description && status !== 'error' && (
            <div className="bg-gray-800 rounded p-2.5 text-xs text-gray-300 leading-relaxed border border-gray-700">
              {description}
            </div>
          )}

          {/* 성공 */}
          {status === 'done' && (
            <div className="flex items-center justify-between text-green-400 text-xs font-medium bg-green-900/20 rounded p-2 border border-green-800/40">
              <span>{t.appliedToViewer}</span>
              <div className="flex items-center gap-2">
                {triCount > 0 && <span className="text-gray-400 font-normal">{triCount.toLocaleString()} {t.triangles}</span>}
                {lastGeoRef.current && (
                  <button
                    onClick={() => lastGeoRef.current && void exportSTL(lastGeoRef.current, 'nexyfab-model.stl')}
                    className="text-xs px-2 py-0.5 bg-green-800/50 hover:bg-green-700/50 text-green-300 rounded transition-colors"
                  >
                    ⬇ STL
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 경고 */}
          {warnings.length > 0 && (
            <div className="text-yellow-400 text-xs bg-yellow-900/30 rounded p-2 border border-yellow-700/40">
              ⚠ {warnings.join(' / ')}
            </div>
          )}

          {/* 오류 */}
          {status === 'error' && (
            <div className="flex flex-col gap-2 text-red-400 text-xs bg-red-900/30 rounded p-2.5 border border-red-700/40">
              <span>✗ {errorMsg}</span>
              <div className="flex gap-2">
                {code && (
                  <button onClick={autoFix} disabled={isWorkingOrScad}
                    className="px-2 py-1 bg-indigo-800/60 hover:bg-indigo-700/60 disabled:opacity-40 text-indigo-300 rounded text-xs transition-colors">
                    {isWorking ? t.aiFixing : t.aiAutoFix}
                  </button>
                )}
                {code && (
                  <button onClick={recompile} disabled={isWorkingOrScad}
                    className="px-2 py-1 bg-red-800/50 hover:bg-red-700/50 disabled:opacity-40 text-red-300 rounded text-xs transition-colors">
                    {t.manualRetry}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 파라미터 슬라이더 */}
          {code && params.length > 0 && (
            <div className="border border-gray-700 rounded overflow-hidden">
              <button onClick={() => setShowParams(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 hover:bg-gray-750 text-xs text-gray-300 font-medium transition-colors">
                <span>{t.paramsLabel} ({params.length}{t.paramsCount})</span>
                <span className="text-gray-500">{showParams ? '▲' : '▼'}</span>
              </button>
              {showParams && (
                <div className="p-3 flex flex-col gap-3 bg-gray-850">
                  {params.map(p => (
                    <div key={p.name} className="flex flex-col gap-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-gray-300 font-mono">{p.name}</span>
                        <span className="text-indigo-300 font-mono">{p.value}{p.unit}</span>
                      </div>
                      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value}
                        disabled={isWorkingOrScad}
                        onChange={e => handleParamChange(p, parseFloat(e.target.value))}
                        className="w-full accent-indigo-500 h-1.5 disabled:opacity-40" />
                      <div className="flex justify-between text-xs text-gray-600">
                        <span>{p.min}{p.unit}</span><span>{p.max}{p.unit}</span>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-gray-600">{t.paramsHint}</p>
                </div>
              )}
            </div>
          )}

          {/* 코드 에디터 (접힘 가능) */}
          {code && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <button onClick={() => setShowCode(v => !v)}
                  className="text-xs text-gray-400 font-medium hover:text-gray-200 transition-colors flex items-center gap-1">
                  <span>{t.jscadCode}</span>
                  <span className="text-gray-600">{showCode ? '▲' : '▼'}</span>
                </button>
                {showCode && (
                  <div className="flex gap-1.5">
                    <button onClick={copyCode} className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors">
                      {copied ? t.copied : t.copy}
                    </button>
                    <button onClick={recompile} disabled={isWorkingOrScad}
                      className="text-xs px-2 py-1 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 text-white rounded transition-colors">
                      {status === 'compiling' ? t.compiling : t.apply}
                    </button>
                  </div>
                )}
              </div>
              {showCode && (
                <>
                  <textarea
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    spellCheck={false}
                    className="w-full bg-gray-900 border border-gray-700 rounded p-2.5 text-xs text-green-300 font-mono resize-none focus:outline-none focus:border-indigo-500 leading-relaxed"
                    rows={12}
                  />
                  <p className="text-xs text-gray-500">{t.codeApplyHint}</p>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 라이브러리 탭 ── */}
      {tab === 'library' && (
        <div className="flex flex-col gap-2 p-3 overflow-y-auto flex-1">
          {/* 개인/팀 토글 */}
          <div className="flex gap-1 bg-gray-800 rounded p-1 flex-shrink-0">
            {(['personal', 'org'] as LibScope[]).map(s => (
              <button key={s} onClick={() => setLibScope(s)}
                className={`flex-1 text-xs px-2 py-1.5 rounded transition-colors ${
                  libScope === s ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
                }`}>
                {s === 'personal' ? t.personal : t.team}
              </button>
            ))}
          </div>

          {libLoading ? (
            <div className="text-center text-gray-500 text-xs py-8">{t.loading}</div>
          ) : library.length === 0 ? (
            <div className="text-center text-gray-500 text-xs py-8">
              {libScope === 'personal'
                ? t.noPersonal
                : userOrgs.length === 0
                  ? t.noOrg
                  : t.noShared}
              <p className="mt-2 text-gray-600">{t.libSaveHint}</p>
            </div>
          ) : (
            library.map(entry => (
              <div key={entry.id} onClick={() => applyLibraryEntry(entry)}
                className="flex flex-col gap-1.5 p-3 bg-gray-800 hover:bg-gray-750 rounded border border-gray-700 cursor-pointer transition-colors group">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span className="text-xs text-white font-medium truncate">{entry.title}</span>
                    {entry.scope === 'org' && (
                      <span className="text-xs px-1.5 py-0.5 bg-purple-900/40 text-purple-300 rounded flex-shrink-0">{t.teamTag}</span>
                    )}
                    {!entry.isMine && (
                      <span className="text-xs text-gray-500 flex-shrink-0">{t.sharedTag}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {entry.isMine && (
                      <button onClick={e => { e.stopPropagation(); openEditModal(entry); }}
                        className="text-gray-500 hover:text-indigo-300 text-xs px-1">✎</button>
                    )}
                    {entry.isMine && (
                      <button onClick={e => removeLibrary(entry.id, e)}
                        className="text-gray-500 hover:text-red-400 text-xs px-1">✕</button>
                    )}
                  </div>
                </div>
                {entry.description && (
                  <p className="text-xs text-gray-400 line-clamp-1">{entry.description}</p>
                )}
                <p className="text-xs text-gray-500 line-clamp-2 font-mono">{entry.prompt}</p>
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <span>{new Date(entry.updatedAt).toLocaleDateString(t.localeString)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── OpenSCAD(.scad) 서버 CLI 탭 ── */}
      {tab === 'openscad' && (
        <div className="flex flex-col gap-3 p-3 overflow-y-auto flex-1">
          <p className="text-[11px] text-gray-500 leading-snug">{t.scadTabNote}</p>
          <textarea
            value={scadSource}
            onChange={e => setScadSource(e.target.value)}
            spellCheck={false}
            placeholder={t.scadPlaceholder}
            rows={14}
            disabled={scadBusy}
            className="w-full bg-gray-900 border border-gray-700 rounded p-2.5 text-xs text-amber-100 font-mono resize-y focus:outline-none focus:border-amber-600/60 min-h-[180px]"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void renderOpenScad(false)}
              disabled={scadBusy || !scadSource.trim()}
              className="text-xs px-3 py-2 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white rounded font-medium"
            >
              {scadBusy ? t.scadRendering : t.renderScadSync}
            </button>
            <button
              type="button"
              onClick={() => void renderOpenScad(true)}
              disabled={scadBusy || !scadSource.trim()}
              className="text-xs px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-100 rounded font-medium border border-gray-600"
            >
              {scadBusy ? t.scadRendering : t.renderScadAsync}
            </button>
            {(scadResultB64 || scadArtifactUrl) && (
              <button
                type="button"
                onClick={() => void downloadScadStl()}
                className="text-xs px-3 py-2 bg-green-800/60 hover:bg-green-700/60 text-green-100 rounded font-medium"
              >
                {t.scadDownloadStl}
              </button>
            )}
          </div>
          {(scadJobId || scadJobStatus) && (
            <div className="text-xs text-gray-400 font-mono bg-gray-900/80 border border-gray-700 rounded px-2 py-1.5">
              {t.scadJobPoll}: {scadJobId ?? '—'} · {scadJobStatus || '—'}
            </div>
          )}
          {scadErr && (
            <div className="text-xs text-red-300 bg-red-950/40 border border-red-800/50 rounded p-2 whitespace-pre-wrap">
              {scadErr}
            </div>
          )}
          {(scadResultB64 || scadArtifactUrl) && !scadErr && (
            <div className="flex flex-col gap-1">
              {scadResultB64 ? (
                <p className="text-[11px] text-gray-500">{t.scadImportHint}</p>
              ) : (
                <p className="text-[11px] text-amber-200/80">{t.scadStoredRemoteHint}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 저장 모달 ── */}
      {saveOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={() => !saveBusy && setSaveOpen(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 w-full max-w-md flex flex-col gap-3"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-white">
              {editingId ? t.editPrompt : t.savePrompt}
            </h3>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">{t.title} <span className="text-red-400">*</span></label>
              <input type="text" value={saveTitle} onChange={e => setSaveTitle(e.target.value)}
                maxLength={120} disabled={saveBusy}
                placeholder={t.titlePlaceholder}
                className="bg-gray-800 border border-gray-600 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-400" />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">{t.descOptional}</label>
              <input type="text" value={saveDesc} onChange={e => setSaveDesc(e.target.value)}
                maxLength={500} disabled={saveBusy}
                placeholder={t.descPlaceholder}
                className="bg-gray-800 border border-gray-600 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-400" />
            </div>

            {!editingId && (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400">{t.shareScope}</label>
                  <div className="flex gap-1 bg-gray-800 rounded p-1">
                    <button onClick={() => setSaveScope('personal')} disabled={saveBusy}
                      className={`flex-1 text-xs px-2 py-1.5 rounded transition-colors ${
                        saveScope === 'personal' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'
                      }`}>{t.personalScope}</button>
                    <button onClick={() => setSaveScope('org')} disabled={saveBusy || userOrgs.length === 0}
                      className={`flex-1 text-xs px-2 py-1.5 rounded transition-colors ${
                        saveScope === 'org' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-gray-200 disabled:opacity-40'
                      }`}>{t.teamScope}</button>
                  </div>
                </div>

                {saveScope === 'org' && userOrgs.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-gray-400">{t.org}</label>
                    <select value={saveOrgId} onChange={e => setSaveOrgId(e.target.value)}
                      disabled={saveBusy}
                      className="bg-gray-800 border border-gray-600 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-400">
                      {userOrgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400">{t.promptPreview}</label>
                  <div className="bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 text-xs text-gray-300 font-mono max-h-24 overflow-y-auto">
                    {prompt.trim() || description || '—'}
                  </div>
                </div>
              </>
            )}

            {saveErr && (
              <div className="text-xs text-red-400 bg-red-900/30 rounded p-2 border border-red-700/40">
                {saveErr}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-1">
              <button onClick={() => setSaveOpen(false)} disabled={saveBusy}
                className="text-xs px-3 py-1.5 text-gray-400 hover:text-gray-200 transition-colors">
                {t.cancel}
              </button>
              <button onClick={submitSave} disabled={saveBusy || !saveTitle.trim()}
                className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded font-medium transition-colors">
                {saveBusy ? t.saving : editingId ? t.refine : t.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 이력 탭 ── */}
      {tab === 'history' && (
        <div className="flex flex-col gap-2 p-3 overflow-y-auto flex-1">
          {history.length === 0 ? (
            <div className="text-center text-gray-500 text-xs py-8">{t.noHistory}</div>
          ) : (
            history.map(item => (
              <div key={item.id} onClick={() => loadFromHistory(item)}
                className="flex flex-col gap-1.5 p-3 bg-gray-800 hover:bg-gray-750 rounded border border-gray-700 cursor-pointer transition-colors group">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs text-white font-medium line-clamp-2 flex-1">{item.prompt}</span>
                  <button onClick={e => removeHistory(item.id, e)}
                    className="text-gray-600 hover:text-red-400 text-xs flex-shrink-0 transition-colors opacity-0 group-hover:opacity-100">✕</button>
                </div>
                {item.description && <p className="text-xs text-gray-400 line-clamp-1">{item.description}</p>}
                <div className="flex items-center gap-3 text-xs text-gray-600">
                  <span>{new Date(item.createdAt).toLocaleDateString(t.localeString)}</span>
                  {item.triCount > 0 && <span>{item.triCount.toLocaleString()} {t.triangles}</span>}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
