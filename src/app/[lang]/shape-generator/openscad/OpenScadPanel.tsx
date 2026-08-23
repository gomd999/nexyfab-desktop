'use client';
import { ACCEPT_RASTER } from '@/lib/drawingInput';
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/hooks/useAuth';
import * as THREE from 'three';
import { runJscadCode } from './jscadRunner';
import { generateVerifiedJscad } from './verifiedJscadGen';
import { useJscadWorker } from '../workers/useJscadWorker';
import { verifyGeneratedModel, formatVerificationCritique } from '../analysis/verifyGeneratedModel';
import { loadHistory, saveToHistory, deleteFromHistory, type JscadHistoryItem } from './jscadHistory';
import { extractParams, updateParam, type JscadParam } from './jscadParams';
import { extractScadSliders, applyScadSlider } from '@/lib/openscad-render/scadParamSliders';
import { scadFromIntent, type StoredIntent } from '@/lib/openscad-render/intentToScad';
import { parseCustomizerParams, applyCustomizerValue } from '@/lib/openscad-render/customizerParams';
import type { ElementSelectionInfo, FaceSelectionInfo } from '../editing/selectionInfo';
import { downloadBlob } from '@/lib/platform';
import VerifySpecPanel from './VerifySpecPanel';
import { useAnalysisStore } from '../store/analysisStore';
import type { SpecVerificationResult } from '@/lib/ai/scad-agent/specVerification';

function errorMessageFromUnknown(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Quote/RFQ is intentionally not part of the CAD workspace. */
const CAD_QUOTE_FLOW_ENABLED = false;

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
    scadFromIntentBtn: '↓ 현재 형상으로 SCAD 채우기',
    scadFromIntentBusy: '변환 중…',
    scadFromIntentHint: '디자인 트리의 현재 형상을 결정론적 OpenSCAD 코드로 변환합니다.',
    scadFromIntentNoShape: '현재 형상이 없습니다. 먼저 형상을 선택하세요.',
    scadFromIntentEmpty: '서버가 빈 SCAD 응답을 반환했습니다.',
    scadNlLabel: '✨ 자연어로 SCAD 생성',
    scadNlPlaceholder: '예: M8 볼트 4개 들어가는 플랜지, PCD 70, 외경 100, 두께 12',
    scadNlBtn: 'SCAD 생성',
    scadNlBusy: '생성 중…',
    scadNlEmpty: '프롬프트를 입력하세요.',
    scadNlBudgetReached: '오늘 AI 사용 예산을 모두 썼어요. 24시간 후 자동 초기화됩니다.',
    scadNlBudgetWarn: 'AI 일일 예산 사용량이 임계치에 근접했습니다',
    verifyToggle: '🔍 사양 검증',
    intentJsonLabel: '의도 JSON (shapeId + params + features)',
    intentJsonPlaceholder: '{\n  "shapeId": "box",\n  "params": { "width": 50, "height": 50, "depth": 50 },\n  "features": []\n}',
    runVerify: '검증 실행',
    verifying: '검증 중…',
    jsonParseError: '의도 JSON을 파싱할 수 없습니다. 형식을 확인하세요.',
    routeFailed: '검증 요청 실패',
    verifyFromAgent: '마지막 에이전트 실행 결과',
    sliderHeader: '─── 슬라이더 ───',
    sliderAutoVerify: '자동 검증',
    sliderApply: 'JSON에 반영',
    sliderReset: '초기화',
    sliderDebounceHint: '🔄 자동 검증 활성화 (800ms 지연)',
    sliderWas: '원본',
    sliderEmpty: '슬라이더로 조정할 수치 파라미터가 없습니다.',
    imageIntentToggle: '📷 이미지에서 CAD 추출 (Pro)',
    imageHintLabel: '힌트 (선택) — 크기·재질 등',
    imageHintPlaceholder: '예: 가로 50mm 알루미늄 bracket',
    extractIntent: '의도 추출',
    extracting: '추출 중…',
    applyToVerify: '↓ 검증 섹션에 적용',
    imageRouteFailed: '이미지에서 의도 추출 실패',
    reToggle: '🔬 역설계 (STL → 의도)',
    analyze: '분석',
    analyzing: '분석 중…',
    applyCandidate: '↓ 검증 섹션에 적용',
    reRouteFailed: '메시 역설계 실패',
    reFleetToggle: 'AI 정밀 복원 (Pro)',
    reFleetHint: 'LLM 반복 복원 · 일일 예산·월 슬롯 차감. 복잡 부품은 미검증(정직)이 정상.',
    reFleetPass: 'AI 복원 검증 통과',
    reFleetFail: '미검증 (정직 non-pass)',
    reFleetAttempts: '시도',
    reFleetSeriesSwitch: '계열 전환',
    reFleetFamilies: '모델 계열',
    quoteToggle: '💰 견적 요청',
    quoteProcessLabel: '공정',
    quoteMaterialLabel: '재질',
    quoteQuantityLabel: '수량',
    getQuote: '견적 받기',
    quoteRouteFailed: '견적 요청 실패',
    imageTooLarge: '이미지가 너무 큽니다 (최대 6MB)',
    freeformLabel: '자유형',
    imageLabel: '이미지',
    sliderSectionHint: '📐 치수 조정 — AI 재생성 없이 즉시 반영',
    customizerSectionHint: '🎛️ 파라미터 (자유형) — 코드 변경, AI 재호출 없음',
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
    scadFromIntentBtn: '↓ Fill SCAD from current shape',
    scadFromIntentBusy: 'Converting…',
    scadFromIntentHint: 'Convert the current design-tree shape into deterministic OpenSCAD source.',
    scadFromIntentNoShape: 'No current shape. Select a shape first.',
    scadFromIntentEmpty: 'Server returned empty SCAD source.',
    scadNlLabel: '✨ Generate SCAD from natural language',
    scadNlPlaceholder: 'e.g. flange with 4 M8 bolt holes, PCD 70, OD 100, thickness 12',
    scadNlBtn: 'Generate',
    scadNlBusy: 'Generating…',
    scadNlEmpty: 'Enter a prompt first.',
    scadNlBudgetReached: 'Daily AI spend cap reached. Resets in 24h.',
    scadNlBudgetWarn: 'Approaching daily AI budget limit',
    verifyToggle: '🔍 Verify spec',
    intentJsonLabel: 'Intent JSON (shapeId + params + features)',
    intentJsonPlaceholder: '{\n  "shapeId": "box",\n  "params": { "width": 50, "height": 50, "depth": 50 },\n  "features": []\n}',
    runVerify: 'Run verify',
    verifying: 'Verifying…',
    jsonParseError: 'Intent JSON could not be parsed. Check the syntax.',
    routeFailed: 'Verification request failed',
    verifyFromAgent: 'from last agent run',
    sliderHeader: '─── Sliders ───',
    sliderAutoVerify: 'Auto-verify',
    sliderApply: 'Apply to JSON',
    sliderReset: 'Reset',
    sliderDebounceHint: '🔄 auto-verify on (800ms debounce)',
    sliderWas: 'was',
    sliderEmpty: 'No numeric parameters to adjust with sliders.',
    imageIntentToggle: '📷 Image-to-CAD (Pro)',
    imageHintLabel: 'Hint (optional) — describe the part, size, material',
    imageHintPlaceholder: 'e.g. aluminum bracket, ~50mm wide',
    extractIntent: 'Extract intent',
    extracting: 'Extracting…',
    applyToVerify: '↓ Apply to verify section',
    imageRouteFailed: 'Image-to-CAD extraction failed',
    reToggle: '🔬 Reverse engineer (STL → intent)',
    analyze: 'Analyze',
    analyzing: 'Analyzing…',
    applyCandidate: '↓ Apply to verify section',
    reRouteFailed: 'Mesh reverse engineering failed',
    reFleetToggle: 'AI precision reconstruction (Pro)',
    reFleetHint: 'Iterative LLM reconstruction · uses daily budget + monthly slot. A non-pass on complex parts is expected (honest).',
    reFleetPass: 'AI reconstruction verified',
    reFleetFail: 'Unverified (honest non-pass)',
    reFleetAttempts: 'attempts',
    reFleetSeriesSwitch: 'series switch',
    reFleetFamilies: 'model families',
    quoteToggle: '💰 Request quote',
    quoteProcessLabel: 'Process',
    quoteMaterialLabel: 'Material',
    quoteQuantityLabel: 'Quantity',
    getQuote: 'Get quote',
    quoteRouteFailed: 'Quote request failed',
    imageTooLarge: 'Image is too large (max 6MB)',
    freeformLabel: 'Free-form',
    imageLabel: 'Image',
    sliderSectionHint: '📐 Dimension adjust — applies instantly, no AI regeneration',
    customizerSectionHint: '🎛️ Parameters (free-form) — edits code, no AI re-call',
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
    scadFromIntentBtn: '↓ 現在の形状から SCAD を生成',
    scadFromIntentBusy: '変換中…',
    scadFromIntentHint: 'デザインツリーの現在の形状を決定論的な OpenSCAD コードに変換します。',
    scadFromIntentNoShape: '現在の形状がありません。まず形状を選択してください。',
    scadFromIntentEmpty: 'サーバーが空の SCAD 応答を返しました。',
    scadNlLabel: '✨ 自然言語から SCAD 生成',
    scadNlPlaceholder: '例: M8 ボルト 4 本のフランジ、PCD 70、外径 100、厚さ 12',
    scadNlBtn: '生成',
    scadNlBusy: '生成中…',
    scadNlEmpty: 'プロンプトを入力してください。',
    scadNlBudgetReached: '本日のAI予算上限に達しました。24時間後にリセットされます。',
    scadNlBudgetWarn: '本日のAI予算上限に近づいています',
    verifyToggle: '🔍 仕様検証',
    intentJsonLabel: '意図 JSON (shapeId + params + features)',
    intentJsonPlaceholder: '{\n  "shapeId": "box",\n  "params": { "width": 50, "height": 50, "depth": 50 },\n  "features": []\n}',
    runVerify: '検証実行',
    verifying: '検証中…',
    jsonParseError: '意図 JSON を解析できません。書式を確認してください。',
    routeFailed: '検証リクエスト失敗',
    verifyFromAgent: '最後のエージェント実行結果',
    sliderHeader: '─── スライダー ───',
    sliderAutoVerify: '自動検証',
    sliderApply: 'JSON に反映',
    sliderReset: 'リセット',
    sliderDebounceHint: '🔄 自動検証オン (800ms デバウンス)',
    sliderWas: '元値',
    sliderEmpty: 'スライダーで調整できる数値パラメータがありません。',
    imageIntentToggle: '📷 画像から CAD (Pro)',
    imageHintLabel: 'ヒント (任意) — サイズ・素材など',
    imageHintPlaceholder: '例: 幅 50mm のアルミ bracket',
    extractIntent: '意図を抽出',
    extracting: '抽出中…',
    applyToVerify: '↓ 検証セクションに適用',
    imageRouteFailed: '画像からの意図抽出に失敗しました',
    reToggle: '🔬 リバースエンジニア (STL → 意図)',
    analyze: '解析',
    analyzing: '解析中…',
    applyCandidate: '↓ 検証セクションに適用',
    reRouteFailed: 'メッシュのリバースエンジニアに失敗しました',
    reFleetToggle: 'AI精密復元 (Pro)',
    reFleetHint: 'LLM反復復元 · 日次予算・月次スロット消費。複雑部品の非合格(正直)は想定内。',
    reFleetPass: 'AI復元 検証合格',
    reFleetFail: '未検証 (正直な非合格)',
    reFleetAttempts: '試行',
    reFleetSeriesSwitch: '系列切替',
    reFleetFamilies: 'モデル系列',
    quoteToggle: '💰 見積依頼',
    quoteProcessLabel: '工程',
    quoteMaterialLabel: '材質',
    quoteQuantityLabel: '数量',
    getQuote: '見積を取得',
    quoteRouteFailed: '見積依頼に失敗しました',
    imageTooLarge: '画像が大きすぎます（最大6MB）',
    freeformLabel: '自由形式',
    imageLabel: '画像',
    sliderSectionHint: '📐 寸法調整 — AI再生成なしで即時反映',
    customizerSectionHint: '🎛️ パラメータ（自由形式）— コードを変更、AI再呼び出しなし',
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
    scadFromIntentBtn: '↓ 用当前形状填充 SCAD',
    scadFromIntentBusy: '转换中…',
    scadFromIntentHint: '将设计树中的当前形状确定性地转换为 OpenSCAD 代码。',
    scadFromIntentNoShape: '当前没有形状。请先选择形状。',
    scadFromIntentEmpty: '服务器返回了空 SCAD 响应。',
    scadNlLabel: '✨ 自然语言生成 SCAD',
    scadNlPlaceholder: '例: 4 个 M8 螺栓孔的法兰，PCD 70，外径 100，厚度 12',
    scadNlBtn: '生成',
    scadNlBusy: '生成中…',
    scadNlEmpty: '请先输入提示词。',
    scadNlBudgetReached: '今日 AI 用量已达上限,24 小时后自动重置。',
    scadNlBudgetWarn: '今日 AI 用量接近上限',
    verifyToggle: '🔍 规格验证',
    intentJsonLabel: '意图 JSON (shapeId + params + features)',
    intentJsonPlaceholder: '{\n  "shapeId": "box",\n  "params": { "width": 50, "height": 50, "depth": 50 },\n  "features": []\n}',
    runVerify: '运行验证',
    verifying: '验证中…',
    jsonParseError: '无法解析意图 JSON。请检查格式。',
    routeFailed: '验证请求失败',
    verifyFromAgent: '来自上次智能体运行',
    sliderHeader: '─── 滑块 ───',
    sliderAutoVerify: '自动验证',
    sliderApply: '应用到 JSON',
    sliderReset: '重置',
    sliderDebounceHint: '🔄 自动验证已开启 (800ms 防抖)',
    sliderWas: '原始',
    sliderEmpty: '没有可用滑块调整的数值参数。',
    imageIntentToggle: '📷 图像生成 CAD (Pro)',
    imageHintLabel: '提示（可选）— 描述部件、尺寸、材质',
    imageHintPlaceholder: '例如：宽 50mm 的铝制 bracket',
    extractIntent: '提取意图',
    extracting: '提取中…',
    applyToVerify: '↓ 应用到验证区',
    imageRouteFailed: '从图像提取意图失败',
    reToggle: '🔬 逆向工程 (STL → 意图)',
    analyze: '分析',
    analyzing: '分析中…',
    applyCandidate: '↓ 应用到验证区',
    reRouteFailed: '网格逆向工程失败',
    reFleetToggle: 'AI 精密重建 (Pro)',
    reFleetHint: 'LLM 迭代重建 · 消耗每日预算与每月配额。复杂零件未通过(诚实)属正常。',
    reFleetPass: 'AI 重建已验证',
    reFleetFail: '未验证 (诚实未通过)',
    reFleetAttempts: '尝试',
    reFleetSeriesSwitch: '系列切换',
    reFleetFamilies: '模型系列',
    quoteToggle: '💰 申请报价',
    quoteProcessLabel: '工艺',
    quoteMaterialLabel: '材料',
    quoteQuantityLabel: '数量',
    getQuote: '获取报价',
    quoteRouteFailed: '报价请求失败',
    imageTooLarge: '图片过大（最大 6MB）',
    freeformLabel: '自由形式',
    imageLabel: '图片',
    sliderSectionHint: '📐 尺寸调整 — 无需 AI 重新生成，立即生效',
    customizerSectionHint: '🎛️ 参数（自由形式）— 修改代码，不调用 AI',
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
    scadFromIntentBtn: '↓ Rellenar SCAD desde la forma actual',
    scadFromIntentBusy: 'Convirtiendo…',
    scadFromIntentHint: 'Convierte la forma actual del árbol de diseño en código OpenSCAD determinista.',
    scadFromIntentNoShape: 'No hay forma actual. Selecciona una forma primero.',
    scadFromIntentEmpty: 'El servidor devolvió una respuesta SCAD vacía.',
    scadNlLabel: '✨ Generar SCAD desde lenguaje natural',
    scadNlPlaceholder: 'ej: brida con 4 agujeros M8, PCD 70, diámetro exterior 100, grosor 12',
    scadNlBtn: 'Generar',
    scadNlBusy: 'Generando…',
    scadNlEmpty: 'Introduce un prompt primero.',
    scadNlBudgetReached: 'Límite diario de IA alcanzado. Se restablece en 24 h.',
    scadNlBudgetWarn: 'Acercándose al límite diario de IA',
    verifyToggle: '🔍 Verificar especificación',
    intentJsonLabel: 'Intent JSON (shapeId + params + features)',
    intentJsonPlaceholder: '{\n  "shapeId": "box",\n  "params": { "width": 50, "height": 50, "depth": 50 },\n  "features": []\n}',
    runVerify: 'Ejecutar verificación',
    verifying: 'Verificando…',
    jsonParseError: 'No se pudo analizar el JSON de intención. Revisa la sintaxis.',
    routeFailed: 'La solicitud de verificación falló',
    verifyFromAgent: 'desde la última ejecución del agente',
    sliderHeader: '─── Deslizadores ───',
    sliderAutoVerify: 'Auto-verificar',
    sliderApply: 'Aplicar al JSON',
    sliderReset: 'Restablecer',
    sliderDebounceHint: '🔄 auto-verificación activada (800 ms de espera)',
    sliderWas: 'original',
    sliderEmpty: 'No hay parámetros numéricos para ajustar con deslizadores.',
    imageIntentToggle: '📷 Imagen a CAD (Pro)',
    imageHintLabel: 'Pista (opcional) — describe la pieza, tamaño, material',
    imageHintPlaceholder: 'p. ej. bracket de aluminio, ~50 mm de ancho',
    extractIntent: 'Extraer intención',
    extracting: 'Extrayendo…',
    applyToVerify: '↓ Aplicar a la sección de verificación',
    imageRouteFailed: 'Fallo al extraer intención de la imagen',
    reToggle: '🔬 Ingeniería inversa (STL → intención)',
    analyze: 'Analizar',
    analyzing: 'Analizando…',
    applyCandidate: '↓ Aplicar a la sección de verificación',
    reRouteFailed: 'Fallo al hacer ingeniería inversa de la malla',
    reFleetToggle: 'Reconstrucción de precisión IA (Pro)',
    reFleetHint: 'Reconstrucción iterativa con LLM · consume presupuesto diario y cupo mensual. Un no-aprobado en piezas complejas es esperable (honesto).',
    reFleetPass: 'Reconstrucción IA verificada',
    reFleetFail: 'No verificado (no-aprobado honesto)',
    reFleetAttempts: 'intentos',
    reFleetSeriesSwitch: 'cambio de serie',
    reFleetFamilies: 'familias de modelo',
    quoteToggle: '💰 Solicitar cotización',
    quoteProcessLabel: 'Proceso',
    quoteMaterialLabel: 'Material',
    quoteQuantityLabel: 'Cantidad',
    getQuote: 'Obtener cotización',
    quoteRouteFailed: 'Fallo en la solicitud de cotización',
    imageTooLarge: 'La imagen es demasiado grande (máx. 6 MB)',
    freeformLabel: 'Forma libre',
    imageLabel: 'Imagen',
    sliderSectionHint: '📐 Ajuste de dimensiones — se aplica al instante, sin regenerar con IA',
    customizerSectionHint: '🎛️ Parámetros (forma libre) — modifica el código, sin volver a llamar a la IA',
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
    scadFromIntentBtn: '↓ ملء SCAD من الشكل الحالي',
    scadFromIntentBusy: 'جارٍ التحويل…',
    scadFromIntentHint: 'حوّل الشكل الحالي في شجرة التصميم إلى مصدر OpenSCAD حتمي.',
    scadFromIntentNoShape: 'لا يوجد شكل حالي. اختر شكلًا أولًا.',
    scadFromIntentEmpty: 'أعاد الخادم استجابة SCAD فارغة.',
    scadNlLabel: '✨ توليد SCAD من اللغة الطبيعية',
    scadNlPlaceholder: 'مثال: شفة بأربعة فتحات M8، PCD 70، القطر الخارجي 100، السماكة 12',
    scadNlBtn: 'توليد',
    scadNlBusy: 'جارٍ التوليد…',
    scadNlEmpty: 'أدخل المحفز أولًا.',
    scadNlBudgetReached: 'تم الوصول إلى حد إنفاق الذكاء الاصطناعي اليومي. ستتم إعادة الضبط خلال 24 ساعة.',
    scadNlBudgetWarn: 'تقترب من حد إنفاق الذكاء الاصطناعي اليومي',
    apiMonthlyLimit: 'تم بلوغ الحد الشهري لعرض OpenSCAD على الخادم. قم بترقية الخطة أو أعد المحاولة لاحقًا.',
    apiRateLimit: 'طلبات كثيرة جدًا. حاول بعد قليل.',
    apiScadRequired: 'مصدر scad فارغ.',
    apiOutputTooLarge: 'الشبكة تتجاوز حد الاستجابة المضمنة. بسِّط النموذج أو استخدم العرض غير المتزامن.',
    verifyToggle: '🔍 التحقق من المواصفات',
    intentJsonLabel: 'JSON النية (shapeId + params + features)',
    intentJsonPlaceholder: '{\n  "shapeId": "box",\n  "params": { "width": 50, "height": 50, "depth": 50 },\n  "features": []\n}',
    runVerify: 'تشغيل التحقق',
    verifying: 'جارٍ التحقق…',
    jsonParseError: 'تعذر تحليل JSON النية. تحقق من الصياغة.',
    routeFailed: 'فشل طلب التحقق',
    verifyFromAgent: 'من آخر تشغيل للوكيل',
    sliderHeader: '─── شرائط التمرير ───',
    sliderAutoVerify: 'تحقق تلقائي',
    sliderApply: 'تطبيق على JSON',
    sliderReset: 'إعادة تعيين',
    sliderDebounceHint: '🔄 التحقق التلقائي مفعّل (تأخير 800 مللي ثانية)',
    sliderWas: 'الأصلي',
    sliderEmpty: 'لا توجد معاملات رقمية لضبطها بشرائط التمرير.',
    imageIntentToggle: '📷 من صورة إلى CAD (Pro)',
    imageHintLabel: 'تلميح (اختياري) — صف القطعة والحجم والمادة',
    imageHintPlaceholder: 'مثال: bracket ألومنيوم بعرض 50 مم',
    extractIntent: 'استخراج النية',
    extracting: 'جارٍ الاستخراج…',
    applyToVerify: '↓ تطبيق على قسم التحقق',
    imageRouteFailed: 'فشل استخراج النية من الصورة',
    reToggle: '🔬 الهندسة العكسية (STL ← نية)',
    analyze: 'تحليل',
    analyzing: 'جارٍ التحليل…',
    applyCandidate: '↓ تطبيق على قسم التحقق',
    reRouteFailed: 'فشل الهندسة العكسية للشبكة',
    reFleetToggle: 'إعادة بناء دقيقة بالذكاء الاصطناعي (Pro)',
    reFleetHint: 'إعادة بناء تكرارية عبر LLM · تستهلك الميزانية اليومية والحصة الشهرية. عدم الاجتياز للقطع المعقدة أمر متوقع (بصدق).',
    reFleetPass: 'تم التحقق من إعادة البناء بالذكاء الاصطناعي',
    reFleetFail: 'غير مُتحقق (عدم اجتياز صادق)',
    reFleetAttempts: 'محاولات',
    reFleetSeriesSwitch: 'تبديل السلسلة',
    reFleetFamilies: 'عائلات النماذج',
    quoteToggle: '💰 طلب عرض سعر',
    quoteProcessLabel: 'العملية',
    quoteMaterialLabel: 'المادة',
    quoteQuantityLabel: 'الكمية',
    getQuote: 'الحصول على عرض السعر',
    quoteRouteFailed: 'فشل طلب عرض السعر',
    imageTooLarge: 'الصورة كبيرة جدًا (الحد الأقصى 6 ميغابايت)',
    freeformLabel: 'شكل حر',
    imageLabel: 'صورة',
    sliderSectionHint: '📐 ضبط الأبعاد — يُطبَّق فورًا دون إعادة توليد بالذكاء الاصطناعي',
    customizerSectionHint: '🎛️ المعاملات (شكل حر) — تعدّل الكود دون إعادة استدعاء الذكاء الاصطناعي',
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
  modelId?: string;
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

const EXAMPLE_PROMPTS: Record<string, string[]> = {
  ko: [
    '볼트 구멍 4개 있는 브라켓 50×30×5mm',
    'M8 볼트용 플랜지 커플링',
    '두께 3mm 사각 박스 하우징',
    '기어 이빨 16개 소형 스퍼 기어',
    '손잡이 있는 레버 암 120mm',
    'L형 앵글 브라켓 40×40×4mm',
  ],
  en: [
    'bracket 50×30×5mm with 4 bolt holes',
    'M8 bolt flange coupling',
    '3mm-thick square box housing',
    'small spur gear with 16 teeth',
    '120mm lever arm with a handle',
    'L-angle bracket 40×40×4mm',
  ],
  ja: [
    'ボルト穴4つの bracket 50×30×5mm',
    'M8ボルト用フランジカップリング',
    '厚さ3mmの角型ボックスハウジング',
    '歯数16の小型スパーギア',
    '取っ手付きレバーアーム 120mm',
    'L型アングル bracket 40×40×4mm',
  ],
  zh: [
    '带 4 个螺栓孔的 bracket 50×30×5mm',
    'M8 螺栓法兰联轴器',
    '壁厚 3mm 的方形箱体外壳',
    '16 齿小型直齿轮',
    '带手柄的 120mm 杠杆臂',
    'L 形角撑 bracket 40×40×4mm',
  ],
  es: [
    'bracket 50×30×5mm con 4 agujeros para tornillo',
    'Acoplamiento de brida para tornillo M8',
    'Caja rectangular con pared de 3mm',
    'Piñón recto pequeño de 16 dientes',
    'Brazo de palanca de 120mm con mango',
    'Bracket en L 40×40×4mm',
  ],
  ar: [
    'bracket بمقاس 50×30×5 مم مع 4 ثقوب براغي',
    'وصلة شفة ببرغي M8',
    'صندوق مربع بسماكة 3 مم',
    'ترس مستقيم صغير بـ16 سناً',
    'ذراع رافعة 120 مم بمقبض',
    'bracket زاوية L بمقاس 40×40×4 مم',
  ],
};

// STL export from BufferGeometry
async function exportSTL(geo: THREE.BufferGeometry, filename = 'model.stl') {
  const pos = geo.attributes.position;
  const triCount = Math.floor(pos.count / 3);
  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  let offset = 80;
  view.setUint32(offset, triCount, true); offset += 4;
  const _v = new THREE.Vector3();
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

/* ─── Slider helpers (extract / apply / serialise) ─────────────────────────
 * Walk `intent.params` + each `intent.features[i].params` for NUMERIC values
 * and produce a flat list of slider-able rows with dotted-path tokens like
 * `params.width` or `features[0].params.diameter`.
 *
 * Range policy = [max(0.1, default * 0.1), default * 5] · step 0.1mm. The
 * lower bound is clamped to 0.1 so dimensions never collapse to zero/negative
 * (which crashes most SCAD primitives). Defaults of 0 fall back to a small
 * exploratory range (0.1..5).
 */
interface NumericPath {
  path: string;
  value: number;
  minRange: number;
  maxRange: number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function rangeForDefault(def: number): { minRange: number; maxRange: number } {
  if (!Number.isFinite(def) || def <= 0) return { minRange: 0.1, maxRange: 5 };
  return { minRange: Math.max(0.1, def * 0.1), maxRange: def * 5 };
}

export function extractNumericPaths(intent: unknown): NumericPath[] {
  if (!isPlainObject(intent)) return [];
  const out: NumericPath[] = [];
  const params = intent.params;
  if (isPlainObject(params)) {
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        out.push({ path: `params.${k}`, value: v, ...rangeForDefault(v) });
      }
    }
  }
  const features = intent.features;
  if (Array.isArray(features)) {
    features.forEach((feat, i) => {
      if (!isPlainObject(feat)) return;
      const fparams = feat.params;
      if (!isPlainObject(fparams)) return;
      for (const [k, v] of Object.entries(fparams)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          out.push({ path: `features[${i}].params.${k}`, value: v, ...rangeForDefault(v) });
        }
      }
    });
  }
  return out;
}

/**
 * Plug current slider values back into a deep-cloned intent. Paths are the
 * exact tokens emitted by `extractNumericPaths`. Unknown paths are silently
 * skipped (defensive — the user may have edited the JSON between extracts).
 */
export function applySliderValuesToIntent(
  originalIntent: unknown,
  sliderValues: ReadonlyMap<string, number>,
): unknown {
  if (!isPlainObject(originalIntent)) return originalIntent;
  // Shallow-typed deep clone via JSON round-trip — intent JSON is plain data.
  const clone: Record<string, unknown> = JSON.parse(JSON.stringify(originalIntent));
  for (const [path, val] of sliderValues) {
    if (path.startsWith('params.')) {
      const key = path.slice('params.'.length);
      if (!isPlainObject(clone.params)) clone.params = {};
      (clone.params as Record<string, unknown>)[key] = val;
      continue;
    }
    const featMatch = /^features\[(\d+)\]\.params\.(.+)$/.exec(path);
    if (featMatch) {
      const idx = Number(featMatch[1]);
      const key = featMatch[2];
      if (!Array.isArray(clone.features)) continue;
      const feat = clone.features[idx];
      if (!isPlainObject(feat)) continue;
      if (!isPlainObject(feat.params)) feat.params = {};
      (feat.params as Record<string, unknown>)[key] = val;
    }
  }
  return clone;
}

export function intentToJsonString(intent: unknown): string {
  return JSON.stringify(intent, null, 2);
}

/** "Refine previous result" checkbox label per UI language. */
const REFINE_LABEL: Record<string, string> = {
  ko: '이전 결과 수정', en: 'Refine previous', ja: '前の結果を修正',
  zh: '修改上一结果', es: 'Refinar anterior', ar: 'تعديل السابق',
};

export default function OpenScadPanel({ onGeometryReady, modelId, selectedElement, currentShape }: Props) {
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
  const [scadFromIntentBusy, setScadFromIntentBusy] = useState(false);
  const [scadNlPrompt, setScadNlPrompt] = useState('');
  const [scadNlBusy, setScadNlBusy] = useState(false);
  // Refine: keep the last generated intent so a follow-up prompt ("make it
  // taller", "add a hole") modifies it instead of starting fresh.
  const [lastScadIntent, setLastScadIntent] = useState<unknown>(null);
  const [scadNlRefine, setScadNlRefine] = useState(false);
  // Auto-extracted parametric sliders (CADAM-style): adjustable dimensions
  // pulled from the generated intent. Dragging a slider re-emits the .scad
  // LOCALLY via scadFromIntent — no AI re-call, no server round-trip.
  const scadSliders = useMemo(
    () => extractScadSliders(lastScadIntent as StoredIntent | null),
    [lastScadIntent],
  );
  const onScadSliderChange = useCallback((path: (string | number)[], value: number) => {
    setLastScadIntent((prev: unknown) => {
      if (prev == null) return prev;
      const next = applyScadSlider(prev as StoredIntent, path, value);
      const out = scadFromIntent(next);
      if (out.ok) setScadSource(out.scad);
      return next;
    });
  }, []);
  // Free-form (CADAM-style) mode: the AI writes a complete OpenSCAD program.
  // `scadNlFreeform` opts in before generating; `scadIsFreeform` is set when a
  // free-form result arrives. Its sliders come from parsing the .scad
  // Customizer annotations directly (not an intent).
  const [scadNlFreeform, setScadNlFreeform] = useState(false);
  const [scadIsFreeform, setScadIsFreeform] = useState(false);
  // Image-to-3D: a reference image (data-URL) sent to the vision model, which
  // writes parametric OpenSCAD from it. An image implies free-form.
  const [scadNlImage, setScadNlImage] = useState<string | null>(null);
  const [scadNlImageName, setScadNlImageName] = useState<string | null>(null);
  const onPickScadImage = useCallback((file: File | null | undefined) => {
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { setScadErr(t.imageTooLarge); return; }
    const reader = new FileReader();
    reader.onload = () => { setScadNlImage(typeof reader.result === 'string' ? reader.result : null); setScadNlImageName(file.name); };
    reader.readAsDataURL(file);
  }, [t]);
  const customizerParams = useMemo(
    () => (scadIsFreeform ? parseCustomizerParams(scadSource) : []),
    [scadIsFreeform, scadSource],
  );
  const onCustomizerChange = useCallback((name: string, value: number | boolean | string) => {
    setScadSource(prev => applyCustomizerValue(prev, name, value));
  }, []);
  const [scadNlSummary, setScadNlSummary] = useState<string | null>(null);
  /** Per-user budget cool-down: epoch ms until input unlocks. Set on 402. */
  const [scadNlBudgetLockUntil, setScadNlBudgetLockUntil] = useState<number | null>(null);
  /** Approaching-budget advisory (server-flagged, ≥80%). Dismissable, session-once. */
  const [scadNlBudgetAdvisory, setScadNlBudgetAdvisory] = useState<{ fraction: number; limitUsd: number | null } | null>(null);
  const scadNlBudgetAdvisoryShownRef = useRef(false);
  const [scadNlBudgetNow, setScadNlBudgetNow] = useState(() => Date.now());

  /** Spec-verify panel state — collapsed until the user toggles it open. */
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyIntentJson, setVerifyIntentJson] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyErr, setVerifyErr] = useState('');
  const [verifyResult, setVerifyResult] = useState<SpecVerificationResult | null>(null);

  /** Image-to-CAD panel state — Pro+ feature, collapsed until toggled.
   *  imageDataUrl is stored as a data URL so we can re-display the preview
   *  AND POST the same string to the route without a second FileReader. */
  const [imageIntentOpen, setImageIntentOpen] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState<string>('');
  const [imageHint, setImageHint] = useState('');
  const [extractBusy, setExtractBusy] = useState(false);
  const [imageErr, setImageErr] = useState('');
  const [extractedIntent, setExtractedIntent] = useState<unknown>(null);
  const [extractedSummary, setExtractedSummary] = useState('');

  // Kept temporarily as inert state while the legacy quote JSX is removed in
  // a follow-up cleanup. The enclosing policy flag prevents it from mounting,
  // and requestQuote performs no network or external action.
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteProcess, setQuoteProcess] = useState<'fdm' | 'sla' | 'cnc_mill' | 'sheet' | 'injection_molding' | 'die_cast'>('cnc_mill');
  const [quoteMaterial, setQuoteMaterial] = useState<'aluminum_6061' | 'steel_a36' | 'steel_4140' | 'stainless_304' | 'pla' | 'abs'>('aluminum_6061');
  const [quoteQuantity, setQuoteQuantity] = useState(1);
  const [quoteProviderId, setQuoteProviderId] = useState<'internal' | 'xometry'>('internal');
  const [quoteBusy] = useState(false);
  const [quoteErr] = useState('');
  const quoteReadiness: { level: 'concept_only' | 'review_required'; manufacturingAllowed: boolean } = {
    level: 'concept_only', manufacturingAllowed: false,
  };
  const quoteResult = null as null | {
    providerName: string; totalUsd: number; unitPriceUsd: number; leadTimeDays: number;
    confidence: 'binding' | 'indicative' | 'rough';
    lineItems: Array<{ label: string; amountUsd: number; unit?: string }>;
    notes: string[];
  };
  const requestQuote = useCallback(async () => undefined, []);

  /** Mesh reverse-engineering panel state — Pro+ feature, collapsed until
   *  toggled. The classifier returns multiple candidates; the user picks one
   *  and the "Apply" button copies the intent into the verify section. */
  const [reOpen, setReOpen] = useState(false);
  const [reStlBase64, setReStlBase64] = useState<string>('');
  const [reStlName, setReStlName] = useState<string>('');
  const [reBusy, setReBusy] = useState(false);
  const [reErr, setReErr] = useState('');
  const [reCandidates, setReCandidates] = useState<Array<{
    intent: unknown;
    confidence: number;
    summary: string;
    evidence: string[];
    counterEvidence: string[];
  }>>([]);
  // Verified-reconstruction gate: the top candidate is rendered back to STL and
  // compared (bbox/genus/watertight) to the uploaded mesh. 'pass'/'fail' are a
  // real source-fidelity verdict; 'unavailable' means the render/gate couldn't
  // run (never a fabricated pass).
  const [reGate, setReGate] = useState<
    | { status: 'pass' | 'fail'; score: number; stage: string; checks: unknown; feedback: string }
    | { status: 'unavailable'; reason: string }
    | null
  >(null);
  // AI-fleet (lever F) — opt-in Pro-gated frontier reconstruction. When ON, the
  // analyze request sends { mode: 'ai-fleet' } and the route returns an aiFleet
  // verdict (gate-verified pass, or an HONEST non-pass on exhaustion — never a
  // fabricated pass). A non-pass on a complex part is expected, not a product
  // failure; the UI presents it that way.
  const [reFleetMode, setReFleetMode] = useState(false);
  const [reFleet, setReFleet] = useState<
    | {
        passed: boolean;
        attemptsUsed: number;
        seriesSwitched: boolean;
        familiesUsed: string[];
        singleFamily?: boolean;
        feedback: string | null;
        note: string;
        referenceCount?: number;
      }
    | { error: string }
    | null
  >(null);

  /** Live-preview sliders — one row per numeric param in the last-parsed
   *  intent. Only built AFTER a successful verify (verifiable === true). */
  const [sliderRows, setSliderRows] = useState<NumericPath[]>([]);
  const [sliderValues, setSliderValues] = useState<Map<string, number>>(new Map());
  const [sliderSnapshot, setSliderSnapshot] = useState<Map<string, number>>(new Map());
  const [sliderIntent, setSliderIntent] = useState<unknown>(null);
  const [sliderJsonAtBuild, setSliderJsonAtBuild] = useState<string>('');
  const [autoVerifyOn, setAutoVerifyOn] = useState(true);

  // Auto-feed: the ScadAgentPanel writes here whenever an agent run emits
  // a verify_spec tool_result. We prefer the manual button result when
  // present (most recent user action), else fall back to the agent's.
  const agentVerifyResult = useAnalysisStore(s => s.latestVerifySpecResult);
  const agentVerifyAtMs = useAnalysisStore(s => s.latestVerifySpecAtMs);
  const effectiveVerifyResult = verifyResult ?? agentVerifyResult;
  const verifyResultFromAgent = verifyResult === null && agentVerifyResult !== null;
  useEffect(() => {
    if (!scadNlBudgetLockUntil || scadNlBudgetLockUntil <= Date.now()) {
      setScadNlBudgetLockUntil(null);
      return;
    }
    const id = setInterval(() => {
      const now = Date.now();
      setScadNlBudgetNow(now);
      if (scadNlBudgetLockUntil <= now) setScadNlBudgetLockUntil(null);
    }, 30_000);
    return () => clearInterval(id);
  }, [scadNlBudgetLockUntil]);

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
  // Layer-1 verification critique of the last compiled model (errors/warnings),
  // fed back to the AI on auto-fix so it can repair geometry flaws.
  const lastVerifyCritiqueRef = useRef<string>('');

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
    } catch (err) { console.error('[OpenScadPanel] caught', err); }
    return () => { prevGeoRef.current?.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const params = useMemo(() => (code ? extractParams(code) : []), [code]);

  // O2 — run JSCAD off the main thread (hard-terminable). Falls back to the
  // main-thread runner inside `compile` if the worker is unavailable.
  const { runJscad } = useJscadWorker();

  const compile = useCallback((codeStr: string, desc: string) => {
    if (!codeStr.trim()) return;
    setStatus('compiling');
    setErrorMsg('');
    setWarnings([]);
    const onOk = (result: { geometry: THREE.BufferGeometry; warnings: string[]; triCount: number }) => {
      prevGeoRef.current?.dispose();
      prevGeoRef.current = result.geometry;
      lastGeoRef.current = result.geometry;
      // Layer-1 verification: the code rendered, but is the geometry sound
      // (watertight, manifold, sized)? Surface flaws + stash for auto-fix.
      const critique = formatVerificationCritique(verifyGeneratedModel(result.geometry));
      lastVerifyCritiqueRef.current = critique;
      setWarnings(critique ? [...result.warnings, ...critique.split('\n')] : result.warnings);
      setTriCount(result.triCount);
      setStatus('done');
      onGeometryReady(result.geometry, desc);
    };
    const onErr = (e: unknown) => {
      setStatus('error');
      setErrorMsg(errorMessageFromUnknown(e) || t.errCompile);
    };
    // Off-main-thread first (hard-terminable on runaway). If the worker is
    // unavailable (bundling/init), fall back to the main-thread runner so the
    // panel still compiles; real timeouts surface instead of re-blocking.
    runJscad(codeStr).then(onOk).catch((workerErr: unknown) => {
      const msg = workerErr instanceof Error ? workerErr.message : String(workerErr);
      if (/timed out|terminated|superseded|cancelled/i.test(msg)) { onErr(workerErr); return; }
      setTimeout(() => {
        try { onOk(runJscadCode(codeStr)); } catch (e) { onErr(e); }
      }, 0);
    });
  }, [onGeometryReady, t, runJscad]);

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

  // ── Generate (new shape) — render-verify-repair loop ──
  // Generation runs through generateVerifiedJscad: the AI's code is rendered +
  // Layer-1 verified in-process and, on a render error or hard verification
  // failure, the critique is fed back so the model repairs it (bounded retries)
  // — instead of dead-ending on the first imperfect generation. The panel used
  // to compute the verification critique and throw it away; this closes the loop.
  const generate = useCallback(async (text?: string) => {
    const p = (text ?? prompt).trim();
    if (!p) return;
    setCode(''); setDescription(''); setTriCount(0); setErrorMsg(''); setWarnings([]);

    // Worker-first render (hard-terminable on runaway), main-thread fallback when
    // the worker is unavailable — mirrors `compile`. A real timeout rejects so
    // the loop treats it as a render error and repairs.
    const render = (codeStr: string): Promise<THREE.BufferGeometry> =>
      runJscad(codeStr).then(r => r.geometry).catch((werr: unknown) => {
        const msg = werr instanceof Error ? werr.message : String(werr);
        if (/timed out|terminated|superseded|cancelled/i.test(msg)) throw werr;
        return runJscadCode(codeStr).geometry;
      });

    const aiGenerate = async (args: { priorCode: string | null; critique: string | null; attempt: number }) => {
      if (args.attempt === 1 || !args.priorCode) {
        return callAI({ prompt: p, mode: 'generate' }, 'generating');
      }
      // Repair pass: hand the model its prior code + the blocking critique.
      return callAI(
        { prompt: `${p}\n\nThe previous attempt failed verification. Fix exactly this:\n${args.critique ?? ''}`, currentCode: args.priorCode, mode: 'refine' },
        'refining',
      );
    };

    try {
      const result = await generateVerifiedJscad(p, { aiGenerate, render }, { maxAttempts: 3 });
      setCode(result.code);
      setDescription(result.description || p);
      if (result.ok && result.geometry) {
        prevGeoRef.current?.dispose();
        prevGeoRef.current = result.geometry;
        lastGeoRef.current = result.geometry;
        lastVerifyCritiqueRef.current = result.warnings;
        const tri = (result.geometry.attributes.position?.count ?? 0) / 3;
        setWarnings(result.warnings ? result.warnings.split('\n') : []);
        setTriCount(tri);
        setStatus('done');
        onGeometryReady(result.geometry, result.description || p);
        saveToHistory({ prompt: p, code: result.code, description: result.description, triCount: tri });
        setHistory(loadHistory());
      } else {
        setStatus('error');
        setErrorMsg(result.finalCritique || t.errCompile);
      }
    } catch (e: unknown) {
      setStatus('error');
      setErrorMsg(errorMessageFromUnknown(e) || t.errUnknown);
    }
  }, [prompt, callAI, t, runJscad, onGeometryReady]);

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
    } catch (e: unknown) {
      setStatus('error');
      setErrorMsg(errorMessageFromUnknown(e) || t.errRefine);
    }
  }, [prompt, code, description, callAI, compile, t]);

  // ── Auto-fix compile error ──
  const autoFix = useCallback(async () => {
    // Fixable when there's a compile error OR a Layer-1 geometry critique.
    const critique = lastVerifyCritiqueRef.current;
    if (!code || (!errorMsg && !critique)) return;
    try {
      // Combine the compile error (if any) with the geometry verification
      // critique so the model repairs both syntax and shape soundness.
      const combinedError = [errorMsg, critique].filter(Boolean).join('\n');
      const data = await callAI({ currentCode: code, errorMsg: combinedError, mode: 'fix' }, 'fixing');
      setCode(data.code);
      compile(data.code, description);
    } catch (e: unknown) {
      setStatus('error');
      setErrorMsg(errorMessageFromUnknown(e) || t.errAutoFix);
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
    } catch (e: unknown) {
      setStatus('error');
      setErrorMsg(errorMessageFromUnknown(e) || t.errFaceOp);
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
    } catch (e: unknown) {
      setStatus('error');
      setErrorMsg(errorMessageFromUnknown(e) || t.errConvert);
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
    } catch (e: unknown) {
      setSaveErr(errorMessageFromUnknown(e) || t.errSaveFail);
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

  /**
   * Take the current parametric shape (shapeId + params + features from the
   * design tree) and convert it deterministically to OpenSCAD source. This
   * fills the textarea so the user can review the SCAD before sending it to
   * the renderer. No AI call — same input always yields the same output.
   */
  const generateScadFromCurrentShape = useCallback(async () => {
    if (!currentShape?.shapeId) {
      setScadErr(t.scadFromIntentNoShape);
      return;
    }
    setScadFromIntentBusy(true);
    setScadErr('');
    try {
      const res = await fetch('/api/nexyfab/scad-from-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shapeId: currentShape.shapeId,
          params: currentShape.params,
          features: currentShape.features,
        }),
      });
      const data = await res.json().catch(() => ({} as { error?: string; scad?: string }));
      if (!res.ok) {
        setScadErr(data.error ?? `Server ${res.status}`);
        return;
      }
      if (typeof data.scad === 'string' && data.scad.length > 0) {
        setScadSource(data.scad);
      } else {
        setScadErr(t.scadFromIntentEmpty);
      }
    } catch (e: unknown) {
      setScadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScadFromIntentBusy(false);
    }
  }, [currentShape, t]);

  /**
   * Natural-language → AI emits JSON intent → deterministic SCAD source.
   * AI never writes raw OpenSCAD code; the intent is hard-validated against
   * the converter's whitelist before SCAD generation, so syntax errors are
   * impossible.
   */
  const generateScadFromNlPrompt = useCallback(async () => {
    const prompt = scadNlPrompt.trim();
    if (!prompt && !scadNlImage) {
      setScadErr(t.scadNlEmpty);
      return;
    }
    setScadNlBusy(true);
    setScadErr('');
    setScadNlSummary(null);
    try {
      const doRefine = scadNlRefine && lastScadIntent != null && !scadNlFreeform && !scadNlImage;
      const reqBody = scadNlImage
        ? { prompt, image: scadNlImage, freeform: true, modelId }
        : scadNlFreeform
          ? { prompt, freeform: true, modelId }
          : doRefine
            ? { prompt, previousIntent: lastScadIntent, modelId }
            : { prompt, modelId };
      const res = await fetch('/api/nexyfab/scad-intent-from-nl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(useAuthStore.getState().token ? { Authorization: `Bearer ${useAuthStore.getState().token}` } : {}) },
        body: JSON.stringify(reqBody),
      });
      const data = await res.json().catch(() => ({} as { error?: string; scad?: string; summary?: string; reason?: string; code?: string; resetAtMs?: number }));
      if (!res.ok) {
        // 402 COST_BUDGET → friendlier message + lock the input.
        if (res.status === 402 && data.code === 'COST_BUDGET') {
          let extra = '';
          if (typeof data.resetAtMs === 'number' && data.resetAtMs > Date.now()) {
            setScadNlBudgetLockUntil(data.resetAtMs);
            const mins = Math.ceil((data.resetAtMs - Date.now()) / 60_000);
            const hours = Math.floor(mins / 60);
            const rem = mins % 60;
            extra = hours > 0 ? ` (${hours}h ${rem}m)` : ` (${mins}m)`;
          }
          setScadErr(t.scadNlBudgetReached + extra);
          return;
        }
        setScadErr(data.reason ?? data.error ?? `Server ${res.status}`);
        return;
      }
      if (typeof data.scad === 'string' && data.scad.length > 0) {
        setScadSource(data.scad);
        const isFreeform = (data as { freeform?: boolean }).freeform === true;
        setScadIsFreeform(isFreeform);
        if (isFreeform) {
          setLastScadIntent(null); // free-form has no intent; sliders come from the .scad
        } else if ((data as { intent?: unknown }).intent != null) {
          setLastScadIntent((data as { intent?: unknown }).intent);
        }
        if (typeof data.summary === 'string') setScadNlSummary(data.summary);
        // Surface "approaching budget" advisory when server flagged it.
        const warning = (data as { budgetWarning?: { fraction: number; limitUsd: number | null } }).budgetWarning;
        if (warning && !scadNlBudgetAdvisoryShownRef.current) {
          scadNlBudgetAdvisoryShownRef.current = true;
          setScadNlBudgetAdvisory({ fraction: warning.fraction, limitUsd: warning.limitUsd });
        }
      } else {
        setScadErr(t.scadFromIntentEmpty);
      }
    } catch (e: unknown) {
      setScadErr(e instanceof Error ? e.message : String(e));
    } finally {
      setScadNlBusy(false);
    }
  }, [scadNlPrompt, t, scadNlRefine, lastScadIntent, scadNlFreeform, scadNlImage, modelId]);

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

  /**
   * Run spec verification: parse the intent JSON locally, then POST it
   * together with the current SCAD textarea to /api/nexyfab/verify-spec.
   * Result is stored in `verifyResult` and rendered by VerifySpecPanel.
   *
   * Parse failures short-circuit with a localized error — the route is
   * never called with a malformed intent.
   */
  const runVerify = useCallback(async (overrideIntent?: unknown) => {
    if (!scadSource.trim() || verifyBusy) return;
    setVerifyErr('');
    let intent: unknown;
    if (overrideIntent !== undefined) {
      intent = overrideIntent;
    } else {
      try {
        intent = JSON.parse(verifyIntentJson);
      } catch {
        setVerifyErr(t.jsonParseError);
        return;
      }
    }
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
      setVerifyErr(t.jsonParseError);
      return;
    }
    setVerifyBusy(true);
    try {
      const res = await fetch('/api/nexyfab/verify-spec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scad: scadSource, intent }),
      });
      const data = await res.json().catch(() => ({} as { ok?: boolean; error?: string; result?: SpecVerificationResult }));
      if (!res.ok || data.ok === false) {
        const msg = typeof data.error === 'string' ? data.error : `${t.routeFailed} (${res.status})`;
        setVerifyErr(msg);
        return;
      }
      if (data.result) {
        setVerifyResult(data.result);
        // Build / refresh slider rows when verifiable. Snapshot is captured
        // only on the FIRST build for a given textarea-JSON so "Reset" goes
        // back to what the user originally typed, not the most recent
        // auto-verify roundtrip.
        if (data.result.verifiable) {
          const rows = extractNumericPaths(intent);
          setSliderRows(rows);
          setSliderIntent(intent);
          const nextValues = new Map<string, number>();
          for (const r of rows) nextValues.set(r.path, r.value);
          setSliderValues(nextValues);
          // If this verify was invoked from the textarea (no override), the
          // textarea is the new canonical source — capture a fresh snapshot.
          if (overrideIntent === undefined) {
            setSliderSnapshot(new Map(nextValues));
            setSliderJsonAtBuild(verifyIntentJson);
          }
        }
      }
    } catch (e: unknown) {
      setVerifyErr(e instanceof Error ? e.message : t.routeFailed);
    } finally {
      setVerifyBusy(false);
    }
  }, [scadSource, verifyIntentJson, verifyBusy, t]);

  /** Read a user-picked file into a data URL so we can preview it AND
   *  POST it to /api/nexyfab/intent-from-image. We cap at ~7MB raw
   *  (~5MB decoded base64 after multipart bloat) to mirror the route's
   *  413 gate — better to surface here than after an upload round-trip. */
  const handleImageFile = useCallback((file: File | null) => {
    setImageErr('');
    setExtractedIntent(null);
    setExtractedSummary('');
    if (!file) { setImageDataUrl(''); return; }
    if (file.size > 7 * 1024 * 1024) {
      setImageErr(`${t.imageRouteFailed}: file too large (${(file.size / 1024 / 1024).toFixed(1)} MB, max 5 MB after decode)`);
      setImageDataUrl('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') setImageDataUrl(result);
    };
    reader.onerror = () => {
      setImageErr(`${t.imageRouteFailed}: file read failed`);
    };
    reader.readAsDataURL(file);
  }, [t]);

  /** POST the data URL + optional hint to /api/nexyfab/intent-from-image
   *  and stash the extracted intent + summary on success. The result has
   *  an "Apply to verify section" button that copies the JSON into the
   *  existing verifyIntentJson textarea. */
  const extractIntentFromImage = useCallback(async () => {
    if (!imageDataUrl || extractBusy) return;
    setImageErr('');
    setExtractedIntent(null);
    setExtractedSummary('');
    setExtractBusy(true);
    try {
      const res = await fetch('/api/nexyfab/intent-from-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: imageDataUrl, hintText: imageHint.trim() || undefined, modelId }),
      });
      const data = await res.json().catch(() => ({} as { ok?: boolean; error?: string; intent?: unknown; summary?: string }));
      if (!res.ok || data.ok === false) {
        const msg = typeof data.error === 'string' ? data.error : `${t.imageRouteFailed} (${res.status})`;
        setImageErr(msg);
        return;
      }
      if (data.intent && typeof data.intent === 'object') {
        setExtractedIntent(data.intent);
      }
      if (typeof data.summary === 'string') setExtractedSummary(data.summary);
    } catch (e: unknown) {
      setImageErr(e instanceof Error ? e.message : t.imageRouteFailed);
    } finally {
      setExtractBusy(false);
    }
  }, [imageDataUrl, imageHint, extractBusy, modelId, t]);

  /** Copy the extracted intent JSON into the verify-spec textarea and
   *  reveal the verify section. The user can then click "Run verify" or
   *  adjust sliders without retyping the intent. */
  const applyExtractedToVerify = useCallback(() => {
    if (!extractedIntent) return;
    setVerifyIntentJson(JSON.stringify(extractedIntent, null, 2));
    setVerifyOpen(true);
  }, [extractedIntent]);

  /** FileReader for the reverse-engineer STL upload. Same shape as the
   *  image upload handler — we stash the data URL so it can be POSTed
   *  straight to the route without a second decode pass. */
  const handleReStlFile = useCallback((file: File | null) => {
    setReErr('');
    setReCandidates([]);
    if (!file) { setReStlBase64(''); setReStlName(''); return; }
    if (file.size > 9 * 1024 * 1024) {
      setReErr(`${t.reRouteFailed}: file too large (${(file.size / 1024 / 1024).toFixed(1)} MB, max 8 MB after decode)`);
      setReStlBase64(''); setReStlName('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        setReStlBase64(result);
        setReStlName(file.name);
      }
    };
    reader.onerror = () => {
      setReErr(`${t.reRouteFailed}: file read failed`);
    };
    reader.readAsDataURL(file);
  }, [t]);

  /** POST the STL data URL to /api/nexyfab/reverse-engineer and stash the
   *  ranked candidate list. Each candidate has its own "Apply" button that
   *  copies the proposed intent into the verify section. */
  const analyzeReverseMesh = useCallback(async () => {
    if (!reStlBase64 || reBusy) return;
    setReErr('');
    setReCandidates([]);
    setReGate(null);
    setReFleet(null);
    setReBusy(true);
    try {
      const res = await fetch('/api/nexyfab/reverse-engineer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // AI-fleet mode (Pro) sends { mode: 'ai-fleet' } so the route runs the
        // reconstruction fleet and returns an aiFleet verdict; default stays cheap.
        body: JSON.stringify(reFleetMode ? { stlBase64: reStlBase64, mode: 'ai-fleet' } : { stlBase64: reStlBase64 }),
      });
      const data = await res.json().catch(() => ({} as { ok?: boolean; error?: string; candidates?: unknown[] }));
      if (!res.ok || data.ok === false) {
        const msg = typeof data.error === 'string' ? data.error : `${t.reRouteFailed} (${res.status})`;
        setReErr(msg);
        return;
      }
      if (Array.isArray(data.candidates)) {
        setReCandidates(data.candidates as Array<{
          intent: unknown;
          confidence: number;
          summary: string;
          evidence: string[];
          counterEvidence: string[];
        }>);
      }
      const g = (data as { reconstructionGate?: unknown }).reconstructionGate;
      if (g && typeof g === 'object') setReGate(g as typeof reGate);
      const fleet = (data as { aiFleet?: unknown }).aiFleet;
      if (fleet && typeof fleet === 'object') setReFleet(fleet as typeof reFleet);
    } catch (e: unknown) {
      setReErr(e instanceof Error ? e.message : t.reRouteFailed);
    } finally {
      setReBusy(false);
    }
  }, [reStlBase64, reBusy, reFleetMode, t]);

  /** Copy a chosen candidate's intent into the verify-spec textarea and
   *  reveal the verify section so the user can immediately round-trip. */
  const applyCandidateToVerify = useCallback((intent: unknown) => {
    if (!intent) return;
    setVerifyIntentJson(JSON.stringify(intent, null, 2));
    setVerifyOpen(true);
  }, []);

  /** Slider change handler — updates the local working copy + marks the
   *  change. The auto-verify effect picks up sliderValues changes. */
  const handleSliderChange = useCallback((path: string, val: number) => {
    setSliderValues(prev => {
      const next = new Map(prev);
      next.set(path, val);
      return next;
    });
  }, []);

  /** Apply current slider values back to the textarea JSON — makes the
   *  round-trip visible to the user. After this, the textarea is in sync
   *  with the sliders again. */
  const applySlidersToJson = useCallback(() => {
    if (!sliderIntent) return;
    const updated = applySliderValuesToIntent(sliderIntent, sliderValues);
    const jsonStr = intentToJsonString(updated);
    setVerifyIntentJson(jsonStr);
    setSliderIntent(updated);
    setSliderJsonAtBuild(jsonStr);
    // After apply, snapshot now reflects the new "saved" baseline so a
    // subsequent Reset goes back to what's now in the textarea.
    setSliderSnapshot(new Map(sliderValues));
  }, [sliderIntent, sliderValues]);

  /** Reset sliders to the snapshot taken when the rows were first built
   *  (or when "Apply to JSON" was last clicked). */
  const resetSliders = useCallback(() => {
    setSliderValues(new Map(sliderSnapshot));
  }, [sliderSnapshot]);

  /** Invalidate the slider working copy when the user manually edits the
   *  textarea JSON — the textarea is the canonical source, sliders are a
   *  derived view that must be rebuilt on the next verify. */
  useEffect(() => {
    if (!sliderJsonAtBuild) return;
    if (verifyIntentJson !== sliderJsonAtBuild) {
      // User typed in the textarea after sliders were built; hide sliders
      // until they Re-run verify.
      setSliderRows([]);
      setSliderValues(new Map());
      setSliderSnapshot(new Map());
      setSliderIntent(null);
      setSliderJsonAtBuild('');
    }
  }, [verifyIntentJson, sliderJsonAtBuild]);

  /** Debounced auto-verify: when sliders move AND autoVerifyOn, re-run
   *  /verify-spec after 800ms idle with the slider-modified intent. */
  useEffect(() => {
    if (!autoVerifyOn) return;
    if (sliderRows.length === 0) return;
    if (!sliderIntent) return;
    // Skip when the current sliderValues exactly match the snapshot — no
    // user-driven change to debounce on (e.g. immediately after row build).
    let changed = false;
    for (const [k, v] of sliderValues) {
      if (sliderSnapshot.get(k) !== v) { changed = true; break; }
    }
    if (!changed) return;
    const handle = setTimeout(() => {
      const updated = applySliderValuesToIntent(sliderIntent, sliderValues);
      void runVerify(updated);
    }, 800);
    return () => { clearTimeout(handle); };
  }, [sliderValues, sliderSnapshot, sliderIntent, sliderRows.length, autoVerifyOn, runVerify]);

  /** Sliders visible only when intent JSON parsed cleanly AND verify ran
   *  at least once with verifiable=true (which sets sliderRows). */
  const slidersVisible = sliderRows.length > 0 && verifyResult !== null && verifyResult.verifiable;

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
                  if (hasCode && prompt.trim()) refine();
                  else generate();
                }
              }}
              placeholder={hasCode ? t.placeholderRefine : t.placeholderGenerate}
              className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400 text-xs"
              disabled={isWorkingOrScad}
            />
            <button
              onClick={() => {
                if (hasCode && prompt.trim()) refine();
                else generate();
              }}
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
              {(EXAMPLE_PROMPTS[langMap[seg] ?? 'en'] ?? EXAMPLE_PROMPTS.en).map(ex => (
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
          <div className="flex flex-col gap-1.5 bg-gray-900/40 border border-indigo-700/30 rounded p-2.5">
            <label className="text-[11px] text-indigo-200/80 font-medium">{t.scadNlLabel}</label>
            {scadNlBudgetLockUntil && scadNlBudgetLockUntil > scadNlBudgetNow && (() => {
              const remainingMs = scadNlBudgetLockUntil - scadNlBudgetNow;
              const mins = Math.ceil(remainingMs / 60_000);
              const hours = Math.floor(mins / 60);
              const label = hours > 0 ? `${hours}h ${mins % 60}m` : `${mins}m`;
              return (
                <div className="text-[11px] bg-red-950/40 border border-red-900/50 text-red-200 rounded px-2 py-1.5 flex items-center gap-2">
                  <span aria-hidden>⏳</span>
                  <span className="flex-1">{t.scadNlBudgetReached}</span>
                  <span className="font-mono font-semibold">{label}</span>
                </div>
              );
            })()}
            {scadNlBudgetAdvisory && !scadNlBudgetLockUntil && (
              <div className="text-[11px] bg-amber-950/40 border border-amber-700/50 text-amber-200 rounded px-2 py-1.5 flex items-center gap-2">
                <span aria-hidden>⚠️</span>
                <span className="flex-1">
                  {t.scadNlBudgetWarn} ({Math.round(scadNlBudgetAdvisory.fraction * 100)}%
                  {scadNlBudgetAdvisory.limitUsd != null && ` / $${scadNlBudgetAdvisory.limitUsd}`})
                </span>
                <button
                  onClick={() => setScadNlBudgetAdvisory(null)}
                  className="text-amber-400 hover:text-amber-200 px-1"
                  aria-label="dismiss"
                >✕</button>
              </div>
            )}
            <textarea
              value={scadNlPrompt}
              onChange={e => setScadNlPrompt(e.target.value)}
              spellCheck={false}
              placeholder={t.scadNlPlaceholder}
              rows={2}
              disabled={scadNlBusy || scadBusy || (scadNlBudgetLockUntil !== null && scadNlBudgetLockUntil > scadNlBudgetNow)}
              className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 resize-y focus:outline-none focus:border-indigo-500/60 min-h-[44px]"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void generateScadFromNlPrompt()}
                disabled={scadNlBusy || scadBusy || !scadNlPrompt.trim() || (scadNlBudgetLockUntil !== null && scadNlBudgetLockUntil > scadNlBudgetNow)}
                className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded font-medium"
              >
                {scadNlBusy ? t.scadNlBusy : t.scadNlBtn}
              </button>
              <label className="flex items-center gap-1 text-[11px] text-gray-300 cursor-pointer select-none" title="Free-form: the AI writes a full OpenSCAD program (cars, vases, anything) instead of catalog shapes">
                <input
                  type="checkbox"
                  checked={scadNlFreeform}
                  onChange={e => setScadNlFreeform(e.target.checked)}
                  className="accent-emerald-500"
                />
                {t.freeformLabel}
              </label>
              <label className="flex items-center gap-1 text-[11px] text-emerald-300 cursor-pointer select-none" title="Image → 3D: upload a reference photo/sketch; the vision model writes parametric OpenSCAD from it">
                <input type="file" accept="image/*" className="hidden" onChange={e => onPickScadImage(e.target.files?.[0])} />
                🖼️ {t.imageLabel}
              </label>
              {scadNlImage && (
                <span className="flex items-center gap-1 text-[11px] text-emerald-200/80">
                  <span className="truncate max-w-[100px]" title={scadNlImageName ?? ''}>{scadNlImageName}</span>
                  <button type="button" className="text-gray-400 hover:text-gray-200" onClick={() => { setScadNlImage(null); setScadNlImageName(null); }} aria-label="remove image">✕</button>
                </span>
              )}
              {lastScadIntent != null && !scadNlFreeform && (
                <label className="flex items-center gap-1 text-[11px] text-gray-300 cursor-pointer select-none" title="Treat the prompt as a change to the last result">
                  <input
                    type="checkbox"
                    checked={scadNlRefine}
                    onChange={e => setScadNlRefine(e.target.checked)}
                    className="accent-indigo-500"
                  />
                  {REFINE_LABEL[langMap[seg] ?? 'en'] ?? 'Refine previous'}
                </label>
              )}
              {scadNlSummary && (
                <span className="text-[11px] text-indigo-200/70 truncate">{scadNlSummary}</span>
              )}
            </div>
          </div>
          {scadSliders.length > 0 && (
            <div className="border border-gray-700 rounded p-2 bg-gray-950/60 flex flex-col gap-1.5" data-testid="scad-param-sliders">
              <div className="text-[11px] text-indigo-200/80 font-medium">{t.sliderSectionHint}</div>
              {scadSliders.map(s => (
                <label key={s.id} className="flex items-center gap-2 text-[11px] text-gray-300">
                  <span className="w-28 truncate" title={s.label}>{s.label}</span>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={s.value}
                    onChange={e => onScadSliderChange(s.path, parseFloat(e.target.value))}
                    className="flex-1 accent-indigo-500"
                  />
                  <span className="w-12 text-right tabular-nums text-gray-100">{s.step < 1 ? s.value.toFixed(1) : Math.round(s.value)}</span>
                </label>
              ))}
            </div>
          )}
          {scadIsFreeform && customizerParams.length > 0 && (
            <div className="border border-emerald-800/60 rounded p-2 bg-gray-950/60 flex flex-col gap-1.5" data-testid="scad-customizer-params">
              <div className="text-[11px] text-emerald-300/90 font-medium">{t.customizerSectionHint}</div>
              {customizerParams.map(p => {
                const label = p.description || p.name;
                if (p.kind === 'bool') {
                  return (
                    <label key={p.name} className="flex items-center gap-2 text-[11px] text-gray-300">
                      <input type="checkbox" checked={p.value as boolean} onChange={e => onCustomizerChange(p.name, e.target.checked)} className="accent-emerald-500" />
                      <span className="truncate" title={p.name}>{label}</span>
                    </label>
                  );
                }
                if (p.kind === 'slider') {
                  const v = p.value as number;
                  return (
                    <label key={p.name} className="flex items-center gap-2 text-[11px] text-gray-300">
                      <span className="w-28 truncate" title={`${p.name}${p.group ? ' · ' + p.group : ''}`}>{label}</span>
                      <input type="range" min={p.min} max={p.max} step={p.step} value={v}
                        onChange={e => onCustomizerChange(p.name, parseFloat(e.target.value))}
                        className="flex-1 accent-emerald-500" />
                      <span className="w-12 text-right tabular-nums text-gray-100">{(p.step ?? 1) < 1 ? v.toFixed(1) : Math.round(v)}</span>
                    </label>
                  );
                }
                if (p.kind === 'dropdown') {
                  return (
                    <label key={p.name} className="flex items-center gap-2 text-[11px] text-gray-300">
                      <span className="w-28 truncate" title={p.name}>{label}</span>
                      <select value={String(p.value)} onChange={e => onCustomizerChange(p.name, typeof p.value === 'number' ? parseFloat(e.target.value) : e.target.value)}
                        className="flex-1 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-gray-100">
                        {(p.options ?? []).map(o => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
                      </select>
                    </label>
                  );
                }
                // string / colour
                return (
                  <label key={p.name} className="flex items-center gap-2 text-[11px] text-gray-300">
                    <span className="w-28 truncate" title={p.name}>{label}</span>
                    <input type="text" value={String(p.value)} onChange={e => onCustomizerChange(p.name, e.target.value)}
                      className="flex-1 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-gray-100 font-mono" />
                  </label>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={() => void generateScadFromCurrentShape()}
            disabled={scadFromIntentBusy || scadBusy || !currentShape?.shapeId}
            title={t.scadFromIntentHint}
            className="text-xs px-3 py-2 bg-indigo-700/80 hover:bg-indigo-600 disabled:opacity-40 text-white rounded font-medium border border-indigo-500/40 self-start"
          >
            {scadFromIntentBusy ? t.scadFromIntentBusy : t.scadFromIntentBtn}
          </button>
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

          {/* Legacy quote markup is policy-disabled and cannot mount or call a service. */}
          {CAD_QUOTE_FLOW_ENABLED && (<div className="flex flex-col gap-2 border-t border-gray-800 pt-3 mt-1">
            <button
              type="button"
              data-testid="quote-toggle"
              onClick={() => setQuoteOpen(v => !v)}
              className="self-start text-xs px-3 py-1.5 bg-amber-700/70 hover:bg-amber-600 text-white rounded font-medium border border-amber-500/40"
            >
              {t.quoteToggle} {quoteOpen ? '▲' : '▼'}
            </button>
            {quoteOpen && (
              <div className="flex flex-col gap-2" data-testid="quote-section">
                <div
                  data-testid="quote-readiness"
                  className="text-[11px] rounded border border-amber-700/60 bg-amber-950/30 px-2.5 py-2 text-amber-200"
                >
                  <div className="font-semibold">
                    {quoteReadiness.level === 'review_required' ? 'Review required' : 'Concept only'}
                  </div>
                  <div className="mt-0.5 opacity-80">
                    OpenSCAD render/spec checks do not prove an analytic manufacturing STEP. Quote submission is blocked until that handoff is verified.
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-[11px] text-gray-400 font-medium">
                    {t.quoteProcessLabel}
                    <select
                      value={quoteProcess}
                      onChange={e => setQuoteProcess(e.target.value as typeof quoteProcess)}
                      disabled={quoteBusy}
                      data-testid="quote-process"
                      className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-amber-500/60"
                    >
                      <option value="fdm">FDM</option>
                      <option value="sla">SLA</option>
                      <option value="cnc_mill">CNC mill</option>
                      <option value="sheet">Sheet metal</option>
                      <option value="injection_molding">Injection molding</option>
                      <option value="die_cast">Die cast</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-gray-400 font-medium">
                    {t.quoteMaterialLabel}
                    <select
                      value={quoteMaterial}
                      onChange={e => setQuoteMaterial(e.target.value as typeof quoteMaterial)}
                      disabled={quoteBusy}
                      data-testid="quote-material"
                      className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-amber-500/60"
                    >
                      <option value="aluminum_6061">Aluminum 6061</option>
                      <option value="steel_a36">Steel A36</option>
                      <option value="steel_4140">Steel 4140</option>
                      <option value="stainless_304">Stainless 304</option>
                      <option value="pla">PLA</option>
                      <option value="abs">ABS</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-gray-400 font-medium">
                    {t.quoteQuantityLabel}
                    <input
                      type="number"
                      min={1}
                      max={100_000}
                      step={1}
                      value={quoteQuantity}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        setQuoteQuantity(Number.isFinite(v) && v > 0 ? v : 1);
                      }}
                      disabled={quoteBusy}
                      data-testid="quote-quantity"
                      className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-amber-500/60"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-gray-400 font-medium">
                    Provider
                    <select
                      value={quoteProviderId}
                      onChange={e => setQuoteProviderId(e.target.value as typeof quoteProviderId)}
                      disabled={quoteBusy}
                      data-testid="quote-provider"
                      className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-amber-500/60"
                    >
                      <option value="internal">NexyFab internal · Configured</option>
                      <option value="xometry">Xometry · Not configured</option>
                    </select>
                  </label>
                </div>
                <button
                  type="button"
                  data-testid="quote-submit"
                  onClick={() => void requestQuote()}
                  disabled={quoteBusy || !quoteReadiness.manufacturingAllowed}
                  className="self-start text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded font-medium"
                >
                  {quoteBusy ? t.quoteRouteFailed.replace(/failed.*$/i, '...') : t.getQuote}
                </button>
                {quoteErr && (
                  <div
                    data-testid="quote-error"
                    className="text-xs text-red-300 bg-red-950/40 border border-red-800/50 rounded p-2 whitespace-pre-wrap"
                  >
                    {quoteErr}
                  </div>
                )}
                {quoteResult && (
                  <div
                    data-testid="quote-result"
                    className="flex flex-col gap-1.5 border border-amber-700/30 rounded p-2 bg-amber-950/20"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-amber-100 font-mono">{quoteResult.providerName}</span>
                      <span
                        data-testid="quote-confidence"
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                          quoteResult.confidence === 'binding'
                            ? 'text-green-300 border-green-700/40 bg-green-950/40'
                            : quoteResult.confidence === 'indicative'
                              ? 'text-amber-300 border-amber-700/40 bg-amber-950/40'
                              : 'text-gray-300 border-gray-700/40 bg-gray-950/40'
                        }`}
                      >
                        {quoteResult.confidence}
                      </span>
                    </div>
                    <div className="text-sm text-amber-200 font-mono">
                      ${quoteResult.totalUsd.toFixed(2)}{' '}
                      <span className="text-[11px] text-amber-300/70">
                        (${quoteResult.unitPriceUsd.toFixed(2)} / unit · lead {quoteResult.leadTimeDays}d)
                      </span>
                    </div>
                    {quoteResult.lineItems.length > 0 && (
                      <ul className="text-[10px] text-amber-200/80 font-mono">
                        {quoteResult.lineItems.map((li, i) => (
                          <li key={i}>
                            {li.label}: ${li.amountUsd.toFixed(2)}
                            {li.unit ? ` (${li.unit})` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                    {quoteResult.notes.length > 0 && (
                      <p className="text-[10px] text-amber-300/70 italic">
                        {quoteResult.notes.join(' · ')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>)}

          {/* ── Reverse engineer (Pro+ collapsible) ── */}
          <div className="flex flex-col gap-2 border-t border-gray-800 pt-3 mt-1">
            <button
              type="button"
              data-testid="reverse-engineer-toggle"
              onClick={() => setReOpen(v => !v)}
              className="self-start text-xs px-3 py-1.5 bg-emerald-700/70 hover:bg-emerald-600 text-white rounded font-medium border border-emerald-500/40"
            >
              {t.reToggle} {reOpen ? '▲' : '▼'}
            </button>
            {reOpen && (
              <div className="flex flex-col gap-2" data-testid="reverse-engineer-section">
                <input
                  type="file"
                  accept=".stl"
                  data-testid="reverse-engineer-file"
                  onChange={e => handleReStlFile(e.target.files?.[0] ?? null)}
                  disabled={reBusy}
                  className="text-xs text-gray-300 file:mr-2 file:px-2 file:py-1 file:bg-emerald-700/70 file:hover:bg-emerald-600 file:text-white file:border-0 file:rounded file:cursor-pointer file:text-[11px]"
                />
                {reStlName && (
                  <p className="text-[11px] text-emerald-200/80" data-testid="reverse-engineer-filename">
                    {reStlName}
                  </p>
                )}
                <label
                  data-testid="reverse-engineer-fleet-toggle"
                  className="flex items-start gap-2 text-[11px] text-emerald-100/90 cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={reFleetMode}
                    onChange={e => setReFleetMode(e.target.checked)}
                    disabled={reBusy}
                    className="mt-0.5 accent-violet-500"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-1.5 font-medium">
                      {t.reFleetToggle}
                      <span className="text-[9px] px-1 py-px rounded bg-violet-700/70 text-violet-100 border border-violet-500/40 uppercase tracking-wide">Pro</span>
                    </span>
                    <span className="text-[10px] text-emerald-200/60">{t.reFleetHint}</span>
                  </span>
                </label>
                <button
                  type="button"
                  data-testid="reverse-engineer-analyze"
                  onClick={() => void analyzeReverseMesh()}
                  disabled={reBusy || !reStlBase64}
                  className="self-start text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded font-medium"
                >
                  {reBusy ? t.analyzing : t.analyze}
                </button>
                {reErr && (
                  <div
                    data-testid="reverse-engineer-error"
                    className="text-xs text-red-300 bg-red-950/40 border border-red-800/50 rounded p-2 whitespace-pre-wrap"
                  >
                    {reErr}
                  </div>
                )}
                {reGate && (
                  <div
                    data-testid="reverse-engineer-gate"
                    data-gate-status={reGate.status}
                    className={`flex flex-col gap-1 border rounded p-2 text-[11px] ${
                      reGate.status === 'pass'
                        ? 'border-emerald-600/50 bg-emerald-950/30 text-emerald-200'
                        : reGate.status === 'fail'
                          ? 'border-rose-600/50 bg-rose-950/30 text-rose-200'
                          : 'border-amber-600/40 bg-amber-950/20 text-amber-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-mono font-semibold">
                      <span>
                        {reGate.status === 'pass'
                          ? '✓ Verified against source (bbox / genus / watertight)'
                          : reGate.status === 'fail'
                            ? '✕ Reconstruction does not match source'
                            : 'Gate unavailable'}
                      </span>
                      {reGate.status !== 'unavailable' && (
                        <span>{(reGate.score * 100).toFixed(0)}%</span>
                      )}
                    </div>
                    <span className="text-[10px] opacity-80">
                      {reGate.status === 'unavailable'
                        ? `Could not render/compare the reconstruction (${reGate.reason}). Not reported as a pass.`
                        : reGate.feedback}
                    </span>
                  </div>
                )}
                {reFleet && 'error' in reFleet && (
                  <div
                    data-testid="reverse-engineer-fleet-error"
                    className="text-[11px] text-amber-200 bg-amber-950/20 border border-amber-700/40 rounded p-2"
                  >
                    {t.reFleetFail}: {reFleet.error}
                  </div>
                )}
                {reFleet && 'passed' in reFleet && (
                  <div
                    data-testid="reverse-engineer-fleet"
                    data-fleet-passed={reFleet.passed ? '1' : '0'}
                    className={`flex flex-col gap-1 border rounded p-2 text-[11px] ${
                      reFleet.passed
                        ? 'border-emerald-600/50 bg-emerald-950/30 text-emerald-200'
                        : 'border-amber-600/40 bg-amber-950/20 text-amber-200'
                    }`}
                  >
                    <div className="font-mono font-semibold">
                      {reFleet.passed ? `✓ ${t.reFleetPass}` : `⚠ ${t.reFleetFail}`}
                    </div>
                    <div className="text-[10px] opacity-80 font-mono">
                      {t.reFleetAttempts}: {reFleet.attemptsUsed}
                      {' · '}{t.reFleetSeriesSwitch}: {reFleet.seriesSwitched ? '✓' : '—'}
                      {' · '}{t.reFleetFamilies}: {reFleet.familiesUsed.length > 0 ? reFleet.familiesUsed.join(', ') : '—'}
                    </div>
                    {reFleet.feedback && (
                      <div className="text-[10px] opacity-80">{reFleet.feedback}</div>
                    )}
                    {reFleet.note && (
                      <div className="text-[10px] italic opacity-70">{reFleet.note}</div>
                    )}
                  </div>
                )}
                {reCandidates.length > 0 && (
                  <div className="flex flex-col gap-2" data-testid="reverse-engineer-results">
                    {reCandidates.map((c, idx) => {
                      const intentObj = c.intent as { shapeId?: string } | null;
                      const shapeId = intentObj?.shapeId ?? '?';
                      // Clamp the confidence bar at 100% so an over-eager
                      // rule (theoretically possible since rules are float)
                      // doesn't visually overflow the container.
                      const widthPct = Math.min(100, Math.max(0, c.confidence)).toFixed(0);
                      return (
                        <div
                          key={`${shapeId}-${idx}`}
                          data-testid={`reverse-engineer-candidate-${idx}`}
                          className="flex flex-col gap-1.5 border border-emerald-700/30 rounded p-2 bg-emerald-950/20"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-emerald-100 font-mono">{c.summary}</span>
                            <span className="text-[11px] text-emerald-300 font-mono">{c.confidence.toFixed(0)}%</span>
                          </div>
                          <div className="w-full h-1 bg-gray-800 rounded overflow-hidden">
                            <div
                              className="h-full bg-emerald-500"
                              style={{ width: `${widthPct}%` }}
                            />
                          </div>
                          {c.evidence.length > 0 && (
                            <ul className="text-[10px] text-emerald-200/70 list-disc list-inside">
                              {c.evidence.slice(0, 3).map((ev, i) => (
                                <li key={i}>{ev}</li>
                              ))}
                            </ul>
                          )}
                          <button
                            type="button"
                            data-testid={`reverse-engineer-apply-${idx}`}
                            onClick={() => applyCandidateToVerify(c.intent)}
                            className="self-start text-[11px] px-2.5 py-1 bg-violet-700/70 hover:bg-violet-600 text-white rounded font-medium border border-violet-500/40"
                          >
                            {t.applyCandidate}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Image-to-CAD (Pro+ collapsible) ── */}
          <div className="flex flex-col gap-2 border-t border-gray-800 pt-3 mt-1">
            <button
              type="button"
              data-testid="image-intent-toggle"
              onClick={() => setImageIntentOpen(v => !v)}
              className="self-start text-xs px-3 py-1.5 bg-pink-700/70 hover:bg-pink-600 text-white rounded font-medium border border-pink-500/40"
            >
              {t.imageIntentToggle} {imageIntentOpen ? '▲' : '▼'}
            </button>
            {imageIntentOpen && (
              <div className="flex flex-col gap-2" data-testid="image-intent-section">
                <input
                  type="file"
                  accept={ACCEPT_RASTER}
                  data-testid="image-intent-file"
                  onChange={e => handleImageFile(e.target.files?.[0] ?? null)}
                  disabled={extractBusy}
                  className="text-xs text-gray-300 file:mr-2 file:px-2 file:py-1 file:bg-pink-700/70 file:hover:bg-pink-600 file:text-white file:border-0 file:rounded file:cursor-pointer file:text-[11px]"
                />
                {imageDataUrl && (
                  <img
                    src={imageDataUrl}
                    alt="upload preview"
                    data-testid="image-intent-preview"
                    style={{ maxWidth: 150, maxHeight: 150 }}
                    className="rounded border border-gray-700 object-contain"
                  />
                )}
                <label className="text-[11px] text-gray-400 font-medium">{t.imageHintLabel}</label>
                <input
                  type="text"
                  value={imageHint}
                  onChange={e => setImageHint(e.target.value)}
                  placeholder={t.imageHintPlaceholder}
                  disabled={extractBusy}
                  data-testid="image-intent-hint"
                  maxLength={500}
                  className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:border-pink-500/60"
                />
                <button
                  type="button"
                  data-testid="image-intent-extract"
                  onClick={() => void extractIntentFromImage()}
                  disabled={extractBusy || !imageDataUrl}
                  className="self-start text-xs px-3 py-1.5 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white rounded font-medium"
                >
                  {extractBusy ? t.extracting : t.extractIntent}
                </button>
                {imageErr && (
                  <div
                    data-testid="image-intent-error"
                    className="text-xs text-red-300 bg-red-950/40 border border-red-800/50 rounded p-2 whitespace-pre-wrap"
                  >
                    {imageErr}
                  </div>
                )}
                {extractedIntent !== null && (
                  <div className="flex flex-col gap-1.5" data-testid="image-intent-result">
                    {extractedSummary && (
                      <p className="text-[11px] text-pink-200/90 italic">{extractedSummary}</p>
                    )}
                    <pre
                      data-testid="image-intent-json"
                      className="text-[11px] text-gray-100 bg-gray-950 border border-gray-700 rounded p-2 font-mono max-h-48 overflow-auto whitespace-pre-wrap"
                    >
                      {JSON.stringify(extractedIntent, null, 2)}
                    </pre>
                    <button
                      type="button"
                      data-testid="image-intent-apply"
                      onClick={applyExtractedToVerify}
                      className="self-start text-xs px-3 py-1.5 bg-violet-700/70 hover:bg-violet-600 text-white rounded font-medium border border-violet-500/40"
                    >
                      {t.applyToVerify}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Spec verification (collapsible) ── */}
          {scadSource.trim() && (
            <div className="flex flex-col gap-2 border-t border-gray-800 pt-3 mt-1">
              <button
                type="button"
                data-testid="verify-spec-toggle"
                onClick={() => setVerifyOpen(v => !v)}
                className="self-start text-xs px-3 py-1.5 bg-violet-700/70 hover:bg-violet-600 text-white rounded font-medium border border-violet-500/40"
              >
                {t.verifyToggle} {verifyOpen ? '▲' : '▼'}
              </button>
              {verifyOpen && (
                <div className="flex flex-col gap-2" data-testid="verify-spec-section">
                  <label className="text-[11px] text-gray-400 font-medium">{t.intentJsonLabel}</label>
                  <textarea
                    value={verifyIntentJson}
                    onChange={e => setVerifyIntentJson(e.target.value)}
                    spellCheck={false}
                    placeholder={t.intentJsonPlaceholder}
                    rows={6}
                    disabled={verifyBusy}
                    data-testid="verify-intent-json"
                    className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-100 font-mono resize-y focus:outline-none focus:border-violet-500/60"
                  />
                  <button
                    type="button"
                    data-testid="verify-run-button"
                    onClick={() => void runVerify()}
                    disabled={verifyBusy || !scadSource.trim()}
                    className="self-start text-xs px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded font-medium"
                  >
                    {verifyBusy ? t.verifying : t.runVerify}
                  </button>
                  {verifyErr && (
                    <div
                      data-testid="verify-error"
                      className="text-xs text-red-300 bg-red-950/40 border border-red-800/50 rounded p-2 whitespace-pre-wrap"
                    >
                      {verifyErr}
                    </div>
                  )}
                  {verifyResultFromAgent && (
                    <div
                      data-testid="verify-from-agent-badge"
                      className="text-[11px] text-blue-300/90 bg-blue-950/30 border border-blue-800/40 rounded px-2 py-1 inline-flex items-center gap-1.5"
                      title={agentVerifyAtMs ? new Date(agentVerifyAtMs).toLocaleString() : undefined}
                    >
                      <span>🤖</span>
                      <span>{t.verifyFromAgent ?? 'from last agent run'}</span>
                    </div>
                  )}
                  {/* Live-preview sliders. Gated on: verifyResult.verifiable
                      === true AND intent had ≥1 numeric param. */}
                  {slidersVisible && (
                    <div
                      data-testid="verify-sliders-section"
                      className="flex flex-col gap-2 border border-violet-700/30 rounded p-2.5 bg-violet-950/20"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-violet-200/90 font-medium font-mono">
                          {t.sliderHeader}
                        </span>
                        <div className="flex items-center gap-2">
                          <label className="text-[11px] text-violet-100/80 inline-flex items-center gap-1 cursor-pointer">
                            <input
                              type="checkbox"
                              data-testid="verify-slider-auto-toggle"
                              checked={autoVerifyOn}
                              onChange={e => setAutoVerifyOn(e.target.checked)}
                              className="accent-violet-500"
                            />
                            <span>{t.sliderAutoVerify}</span>
                          </label>
                          <button
                            type="button"
                            data-testid="verify-slider-apply"
                            onClick={applySlidersToJson}
                            className="text-[11px] px-2 py-0.5 bg-violet-600 hover:bg-violet-500 text-white rounded"
                          >
                            {t.sliderApply}
                          </button>
                          <button
                            type="button"
                            data-testid="verify-slider-reset"
                            onClick={resetSliders}
                            className="text-[11px] px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-100 rounded"
                          >
                            {t.sliderReset}
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        {sliderRows.map(row => {
                          const cur = sliderValues.get(row.path) ?? row.value;
                          const snap = sliderSnapshot.get(row.path) ?? row.value;
                          return (
                            <div key={row.path} className="flex flex-col gap-0.5">
                              <div className="flex justify-between text-[11px]">
                                <span className="text-gray-200 font-mono">{row.path}</span>
                                <span className="text-violet-300 font-mono">
                                  {cur.toFixed(1)} mm{' '}
                                  <span className="text-gray-500">
                                    ({t.sliderWas} {snap.toFixed(1)})
                                  </span>
                                </span>
                              </div>
                              <input
                                type="range"
                                data-testid={`verify-slider-${row.path}`}
                                min={row.minRange}
                                max={row.maxRange}
                                step={0.1}
                                value={cur}
                                onChange={e => handleSliderChange(row.path, parseFloat(e.target.value))}
                                className="w-full accent-violet-500 h-1.5"
                              />
                            </div>
                          );
                        })}
                      </div>
                      {autoVerifyOn && (
                        <p className="text-[10px] text-violet-300/70 self-end">
                          {t.sliderDebounceHint}
                        </p>
                      )}
                    </div>
                  )}
                  <VerifySpecPanel lang={seg} result={effectiveVerifyResult} />
                </div>
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
