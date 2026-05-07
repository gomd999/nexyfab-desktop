'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import type { FeatureType } from './features/types';
import type { SketchProfile, SketchConfig } from './sketch/types';
import type { Face } from './topology/optimizer/types';

/* ─── i18n dictionary ────────────────────────────────────────────────────── */

const dict = {
  ko: {
    toastStreamCut: 'AI 응답이 중간에 끊겼습니다. 다시 시도해주세요.',
    toastRateLimit: 'Rate limit exceeded / 요청 한도 초과',
    toastServerError: 'Server error / 서버 오류',
    toastAuthRequired: 'Authentication required / 인증 필요',
    errAiConnect: 'AI 연결 실패',
    errNetwork: '네트워크 연결을 확인해주세요',
    errParse: 'AI 응답 파싱 오류',
    errTimeout: '요청 시간 초과',
    toastAiFailed: 'AI 응답에 실패했습니다. 다시 시도해주세요.',
    aiNoResponse: '응답 없음',
    aiPreviewReady: '미리보기 준비됨 — 뷰포트에서 확인하세요',
    aiPreviewApply: '적용',
    aiPreviewCancel: '취소',
    aiRetry: '다시 시도',
    modeApplied: '적용됨',
    aiTyping: 'AI가 입력 중',
    bomParts: '개 부품으로 분해',
    bomAddAll: '전체 장바구니에 담기',
    cartPcs: '개',
    aiContinuing: '이어서:',
    tryLabel: '예시:',
    tryFilletEdge: '"모서리 R2 필렛"',
    tryAddHole: '"홀 추가"',
    tryHalfSize: '"50% 크기로"',
    tryShell: '"shell로 가볍게"',
    tryBracket: '"브라켓 설계"',
    tryStarSketch: '"별 모양 스케치"',
    tryFanAssembly: '"선풍기 조립체"',
    tryVase: '"꽃병 회전체"',
    tryFixLoad: '"왼쪽 고정, 오른쪽에 하중"',
    tryVolReduce: '"체적 20%로 줄여줘"',
    voiceListening: '🎙 음성 인식 중…',
    phPlaceholderDesc: '만들고 싶은 부품을 설명하세요... (예: "브라켓", "기어", "I-빔")',
    phPlaceholderModify: '현재 형상을 수정하세요... (예: "구멍 추가", "모서리 둥글게", "더 크게")',
    phFallbackOpt: '"알루미늄 빔 최적화" 또는 "바닥 고정, 위에 하중"',
    phFallbackDesign: '"선풍기 만들어줘" 또는 "직경 50mm 실린더"',
    micStop: '음성 입력 중지',
    micStart: '음성 입력',
    micUnsupported: '이 브라우저는 음성 인식을 지원하지 않습니다.',
    quick1: '더 크게 만들어',
    quick2: '구멍 추가해줘',
    quick3: '둥글게 다듬어줘',
    quick4: '최적화해줘',
    quick5: '몰드 베이스 자동 조립해줘',
    blank1: 'M6 볼트홀 4개 있는 마운팅 플레이트',
    blank2: 'I-빔 단면 300mm 돌출',
    blank3: '꽃병 프로파일 회전체',
    blank4: '탁상 선풍기 조립체',
    blank5: '기어 모듈3 치수20',
    blank6: '알루미늄 브라켓 경량화 설계',
    mod1: '모서리 둥글게 R3 필렛',
    mod2: '중앙에 Ø10 관통홀 추가',
    mod3: '두께를 절반으로 줄여줘',
    mod4: '볼트홀 4개 원형 패턴',
    mod5: '사각 슬롯 추가 (boolean)',
    mod6: '가볍게 만들어줘 (shell)',
    des1: '직경 50mm, 높이 100mm 실린더',
    des2: '100x60x30 박스에 관통홀',
    des3: '별 모양 단면 20mm 돌출',
    des4: '박스에 원형 홈 파기 (boolean)',
    des5: '선풍기 만들어줘',
    des6: '꽃병 프로파일 회전체',
    opt1: '알루미늄 200x100x200 빔 최적화',
    opt2: '바닥 고정, 위에 1000N 하중',
    opt3: '체적 30%로 경량화 해줘',
    opt4: '티타늄 브라켓 위상 최적화',
    voiceLang: 'ko-KR',
  },
  en: {
    toastStreamCut: 'AI response was cut off. Please try again.',
    toastRateLimit: 'Rate limit exceeded',
    toastServerError: 'Server error',
    toastAuthRequired: 'Authentication required',
    errAiConnect: 'Error connecting to AI',
    errNetwork: 'Check your network connection',
    errParse: 'AI response parse error',
    errTimeout: 'Request timed out',
    toastAiFailed: 'AI response failed. Please try again.',
    aiNoResponse: 'No response',
    aiPreviewReady: 'Preview ready — check the viewport',
    aiPreviewApply: 'Apply',
    aiPreviewCancel: 'Cancel',
    aiRetry: 'Retry',
    modeApplied: 'applied',
    aiTyping: 'AI is typing',
    bomParts: ' parts',
    bomAddAll: 'Add all to cart',
    cartPcs: ' pcs',
    aiContinuing: 'Continuing:',
    tryLabel: 'Try:',
    tryFilletEdge: '"R2 fillet edges"',
    tryAddHole: '"Add hole"',
    tryHalfSize: '"50% size"',
    tryShell: '"Lighten with shell"',
    tryBracket: '"Design a bracket"',
    tryStarSketch: '"Star sketch"',
    tryFanAssembly: '"Fan assembly"',
    tryVase: '"Vase revolve"',
    tryFixLoad: '"Fix left, load right"',
    tryVolReduce: '"Reduce volume to 20%"',
    voiceListening: '🎙 Listening…',
    phPlaceholderDesc: 'Describe the part you want... (e.g. "bracket", "gear", "I-beam")',
    phPlaceholderModify: 'Modify current shape... (e.g. "add hole", "round edges", "bigger")',
    phFallbackOpt: '"Optimize aluminum beam" or "fix bottom, load top"',
    phFallbackDesign: '"Make a fan" or "50mm diameter cylinder"',
    micStop: 'Stop voice input',
    micStart: 'Voice input',
    micUnsupported: 'This browser does not support voice recognition.',
    quick1: 'Make it bigger',
    quick2: 'Add a hole',
    quick3: 'Round the edges',
    quick4: 'Optimize it',
    quick5: 'Auto-assemble mold base',
    blank1: 'Mounting plate with 4 M6 bolt holes',
    blank2: 'I-beam section 300mm extrude',
    blank3: 'Vase profile revolve',
    blank4: 'Desk fan assembly',
    blank5: 'Gear module 3, 20 teeth',
    blank6: 'Lightweight aluminum bracket',
    mod1: 'R3 fillet on edges',
    mod2: 'Add Ø10 through hole at center',
    mod3: 'Halve the thickness',
    mod4: 'Circular pattern of 4 bolt holes',
    mod5: 'Add rectangular slot (boolean)',
    mod6: 'Lighten with shell',
    des1: 'Cylinder Ø50mm × 100mm',
    des2: '100x60x30 box with through hole',
    des3: 'Star section 20mm extrude',
    des4: 'Cut circular pocket in box (boolean)',
    des5: 'Make a fan',
    des6: 'Vase profile revolve',
    opt1: 'Optimize aluminum 200x100x200 beam',
    opt2: 'Fix bottom, 1000N load on top',
    opt3: 'Lightweight to 30% volume',
    opt4: 'Topology optimize titanium bracket',
    voiceLang: 'en-US',
  },
  ja: {
    toastStreamCut: 'AI応答が途切れました。もう一度お試しください。',
    toastRateLimit: 'レート制限超過',
    toastServerError: 'サーバーエラー',
    toastAuthRequired: '認証が必要です',
    errAiConnect: 'AI接続失敗',
    errNetwork: 'ネットワーク接続を確認してください',
    errParse: 'AI応答の解析エラー',
    errTimeout: 'リクエストタイムアウト',
    toastAiFailed: 'AI応答に失敗しました。再試行してください。',
    aiNoResponse: '応答なし',
    aiPreviewReady: 'プレビュー準備完了 — ビューポートで確認',
    aiPreviewApply: '適用',
    aiPreviewCancel: 'キャンセル',
    aiRetry: '再試行',
    modeApplied: '適用済み',
    aiTyping: 'AIが入力中',
    bomParts: '個の部品に分解',
    bomAddAll: 'すべてカートに追加',
    cartPcs: '個',
    aiContinuing: '続き:',
    tryLabel: '例:',
    tryFilletEdge: '「エッジR2フィレット」',
    tryAddHole: '「穴を追加」',
    tryHalfSize: '「50%サイズ」',
    tryShell: '「shellで軽量化」',
    tryBracket: '「ブラケット設計」',
    tryStarSketch: '「星型スケッチ」',
    tryFanAssembly: '「扇風機アセンブリ」',
    tryVase: '「花瓶回転体」',
    tryFixLoad: '「左固定、右に荷重」',
    tryVolReduce: '「体積を20%に」',
    voiceListening: '🎙 音声認識中…',
    phPlaceholderDesc: '作りたい部品を説明... (例: 「ブラケット」、「ギア」、「I梁」)',
    phPlaceholderModify: '現在の形状を修正... (例: 「穴追加」、「エッジを丸く」、「大きく」)',
    phFallbackOpt: '「アルミ梁最適化」または「底固定、上に荷重」',
    phFallbackDesign: '「扇風機作って」または「直径50mmシリンダー」',
    micStop: '音声入力停止',
    micStart: '音声入力',
    micUnsupported: 'このブラウザは音声認識に対応していません。',
    quick1: 'もっと大きく',
    quick2: '穴を追加',
    quick3: '角を丸く',
    quick4: '最適化',
    quick5: 'モールドベース自動組み立て',
    blank1: 'M6ボルト穴4つ付きマウントプレート',
    blank2: 'I梁断面300mm押し出し',
    blank3: '花瓶プロファイル回転体',
    blank4: '卓上扇風機アセンブリ',
    blank5: 'ギア モジュール3 歯数20',
    blank6: 'アルミブラケット軽量化設計',
    mod1: 'エッジR3フィレット',
    mod2: '中央にØ10貫通穴',
    mod3: '厚さを半分に',
    mod4: 'ボルト穴4つ円形パターン',
    mod5: '矩形スロット追加 (boolean)',
    mod6: 'shellで軽量化',
    des1: '直径50mm×高さ100mmシリンダー',
    des2: '100x60x30ボックス貫通穴付き',
    des3: '星型断面20mm押し出し',
    des4: 'ボックスに円形ポケット (boolean)',
    des5: '扇風機作って',
    des6: '花瓶プロファイル回転体',
    opt1: 'アルミ200x100x200梁最適化',
    opt2: '底固定、上に1000N荷重',
    opt3: '体積30%に軽量化',
    opt4: 'チタンブラケットトポロジー最適化',
    voiceLang: 'ja-JP',
  },
  zh: {
    toastStreamCut: 'AI响应中断,请重试。',
    toastRateLimit: '请求频率超限',
    toastServerError: '服务器错误',
    toastAuthRequired: '需要身份验证',
    errAiConnect: 'AI连接失败',
    errNetwork: '请检查网络连接',
    errParse: 'AI响应解析错误',
    errTimeout: '请求超时',
    toastAiFailed: 'AI响应失败,请重试。',
    aiNoResponse: '无响应',
    aiPreviewReady: '预览就绪 — 请在视口中查看',
    aiPreviewApply: '应用',
    aiPreviewCancel: '取消',
    aiRetry: '重试',
    modeApplied: '已应用',
    aiTyping: 'AI输入中',
    bomParts: '个零件',
    bomAddAll: '全部加入购物车',
    cartPcs: '件',
    aiContinuing: '继续:',
    tryLabel: '示例:',
    tryFilletEdge: '"边缘R2圆角"',
    tryAddHole: '"添加孔"',
    tryHalfSize: '"50%尺寸"',
    tryShell: '"shell减重"',
    tryBracket: '"支架设计"',
    tryStarSketch: '"星形草图"',
    tryFanAssembly: '"风扇组件"',
    tryVase: '"花瓶旋转体"',
    tryFixLoad: '"左固定,右加载"',
    tryVolReduce: '"体积减至20%"',
    voiceListening: '🎙 语音识别中…',
    phPlaceholderDesc: '描述您要制作的零件... (如"支架"、"齿轮"、"工字梁")',
    phPlaceholderModify: '修改当前形状... (如"加孔"、"倒圆角"、"加大")',
    phFallbackOpt: '"优化铝梁" 或 "底部固定,顶部加载"',
    phFallbackDesign: '"做一个风扇" 或 "直径50mm圆柱"',
    micStop: '停止语音输入',
    micStart: '语音输入',
    micUnsupported: '此浏览器不支持语音识别。',
    quick1: '做大一点',
    quick2: '加个孔',
    quick3: '倒圆角',
    quick4: '优化',
    quick5: '自动组装模架',
    blank1: '带4个M6螺栓孔的安装板',
    blank2: '工字梁截面挤出300mm',
    blank3: '花瓶轮廓旋转体',
    blank4: '桌面风扇组件',
    blank5: '齿轮模数3齿数20',
    blank6: '铝支架轻量化设计',
    mod1: '边缘R3圆角',
    mod2: '中心加Ø10通孔',
    mod3: '厚度减半',
    mod4: '4个螺栓孔圆形阵列',
    mod5: '添加矩形槽 (boolean)',
    mod6: 'shell减重',
    des1: '直径50mm × 高100mm圆柱',
    des2: '100x60x30盒体带通孔',
    des3: '星形截面挤出20mm',
    des4: '盒体切圆形凹槽 (boolean)',
    des5: '做一个风扇',
    des6: '花瓶轮廓旋转体',
    opt1: '铝200x100x200梁优化',
    opt2: '底部固定,顶部1000N载荷',
    opt3: '轻量化至30%体积',
    opt4: '钛支架拓扑优化',
    voiceLang: 'zh-CN',
  },
  es: {
    toastStreamCut: 'La respuesta de IA se interrumpió. Inténtalo de nuevo.',
    toastRateLimit: 'Límite de solicitudes excedido',
    toastServerError: 'Error del servidor',
    toastAuthRequired: 'Autenticación requerida',
    errAiConnect: 'Error al conectar con IA',
    errNetwork: 'Verifica tu conexión de red',
    errParse: 'Error al analizar respuesta de IA',
    errTimeout: 'Tiempo de solicitud agotado',
    toastAiFailed: 'La respuesta de IA falló. Inténtalo de nuevo.',
    aiNoResponse: 'Sin respuesta',
    aiPreviewReady: 'Vista previa lista — revisa el viewport',
    aiPreviewApply: 'Aplicar',
    aiPreviewCancel: 'Cancelar',
    aiRetry: 'Reintentar',
    modeApplied: 'aplicado',
    aiTyping: 'IA está escribiendo',
    bomParts: ' piezas',
    bomAddAll: 'Añadir todo al carrito',
    cartPcs: ' uds',
    aiContinuing: 'Continuando:',
    tryLabel: 'Prueba:',
    tryFilletEdge: '"Fillet R2 en bordes"',
    tryAddHole: '"Añadir agujero"',
    tryHalfSize: '"50% de tamaño"',
    tryShell: '"Aligerar con shell"',
    tryBracket: '"Diseñar soporte"',
    tryStarSketch: '"Boceto estrella"',
    tryFanAssembly: '"Ensamble de ventilador"',
    tryVase: '"Jarrón revolve"',
    tryFixLoad: '"Fijar izquierda, cargar derecha"',
    tryVolReduce: '"Reducir volumen a 20%"',
    voiceListening: '🎙 Escuchando…',
    phPlaceholderDesc: 'Describe la pieza que quieres... (ej. "soporte", "engranaje", "viga I")',
    phPlaceholderModify: 'Modifica la forma actual... (ej. "añadir agujero", "redondear bordes", "más grande")',
    phFallbackOpt: '"Optimizar viga de aluminio" o "fijar abajo, cargar arriba"',
    phFallbackDesign: '"Hacer un ventilador" o "cilindro de 50mm de diámetro"',
    micStop: 'Detener entrada de voz',
    micStart: 'Entrada de voz',
    micUnsupported: 'Este navegador no admite reconocimiento de voz.',
    quick1: 'Hazlo más grande',
    quick2: 'Añade un agujero',
    quick3: 'Redondea los bordes',
    quick4: 'Optimízalo',
    quick5: 'Ensamblaje automático de molde',
    blank1: 'Placa de montaje con 4 agujeros M6',
    blank2: 'Sección viga I extrude 300mm',
    blank3: 'Jarrón perfil revolve',
    blank4: 'Ensamble ventilador de escritorio',
    blank5: 'Engranaje módulo 3, 20 dientes',
    blank6: 'Soporte de aluminio ligero',
    mod1: 'Fillet R3 en bordes',
    mod2: 'Añadir agujero pasante Ø10 al centro',
    mod3: 'Reducir grosor a la mitad',
    mod4: 'Patrón circular de 4 agujeros',
    mod5: 'Añadir ranura rectangular (boolean)',
    mod6: 'Aligerar con shell',
    des1: 'Cilindro Ø50mm × 100mm',
    des2: 'Caja 100x60x30 con agujero pasante',
    des3: 'Sección estrella extrude 20mm',
    des4: 'Cortar bolsillo circular en caja (boolean)',
    des5: 'Hacer un ventilador',
    des6: 'Jarrón perfil revolve',
    opt1: 'Optimizar viga aluminio 200x100x200',
    opt2: 'Fijar abajo, 1000N en la parte superior',
    opt3: 'Aligerar al 30% del volumen',
    opt4: 'Optimización topológica soporte titanio',
    voiceLang: 'es-ES',
  },
  ar: {
    toastStreamCut: 'انقطعت استجابة الذكاء الاصطناعي. حاول مرة أخرى.',
    toastRateLimit: 'تم تجاوز حد الطلبات',
    toastServerError: 'خطأ في الخادم',
    toastAuthRequired: 'المصادقة مطلوبة',
    errAiConnect: 'فشل الاتصال بالذكاء الاصطناعي',
    errNetwork: 'تحقق من اتصال الشبكة',
    errParse: 'خطأ في تحليل استجابة الذكاء الاصطناعي',
    errTimeout: 'انتهت مهلة الطلب',
    toastAiFailed: 'فشلت استجابة الذكاء الاصطناعي. حاول مرة أخرى.',
    aiNoResponse: 'لا توجد استجابة',
    aiPreviewReady: 'المعاينة جاهزة — تحقق من العرض',
    aiPreviewApply: 'تطبيق',
    aiPreviewCancel: 'إلغاء',
    aiRetry: 'إعادة المحاولة',
    modeApplied: 'مُطبَّق',
    aiTyping: 'الذكاء الاصطناعي يكتب',
    bomParts: ' قطع',
    bomAddAll: 'إضافة الكل إلى السلة',
    cartPcs: ' قطعة',
    aiContinuing: 'متابعة:',
    tryLabel: 'جرّب:',
    tryFilletEdge: '"Fillet R2 للحواف"',
    tryAddHole: '"إضافة ثقب"',
    tryHalfSize: '"نصف الحجم"',
    tryShell: '"تخفيف بـ shell"',
    tryBracket: '"تصميم حامل"',
    tryStarSketch: '"رسم نجمة"',
    tryFanAssembly: '"تجميع مروحة"',
    tryVase: '"مزهرية دوران"',
    tryFixLoad: '"تثبيت اليسار، حمل اليمين"',
    tryVolReduce: '"تقليل الحجم إلى 20%"',
    voiceListening: '🎙 يستمع…',
    phPlaceholderDesc: 'صف القطعة التي تريدها... (مثل "حامل"، "ترس"، "عارضة I")',
    phPlaceholderModify: 'عدّل الشكل الحالي... (مثل "إضافة ثقب"، "تدوير الحواف"، "أكبر")',
    phFallbackOpt: '"تحسين عارضة ألومنيوم" أو "تثبيت القاع، حمل القمة"',
    phFallbackDesign: '"اصنع مروحة" أو "اسطوانة قطر 50mm"',
    micStop: 'إيقاف إدخال الصوت',
    micStart: 'إدخال صوتي',
    micUnsupported: 'هذا المتصفح لا يدعم التعرف على الصوت.',
    quick1: 'اجعله أكبر',
    quick2: 'أضف ثقبًا',
    quick3: 'دوّر الحواف',
    quick4: 'حسّنه',
    quick5: 'تجميع آلي لقاعدة القالب',
    blank1: 'لوحة تركيب بـ 4 ثقوب M6',
    blank2: 'مقطع عارضة I إكسترود 300mm',
    blank3: 'مزهرية بروفايل دوران',
    blank4: 'تجميع مروحة مكتب',
    blank5: 'ترس موديول 3 أسنان 20',
    blank6: 'تصميم حامل ألومنيوم خفيف',
    mod1: 'Fillet R3 على الحواف',
    mod2: 'إضافة ثقب نافذ Ø10 في المنتصف',
    mod3: 'تقليل السمك إلى النصف',
    mod4: 'نمط دائري لـ 4 ثقوب',
    mod5: 'إضافة فتحة مستطيلة (boolean)',
    mod6: 'تخفيف بـ shell',
    des1: 'اسطوانة Ø50mm × 100mm',
    des2: 'صندوق 100x60x30 بثقب نافذ',
    des3: 'مقطع نجمي إكسترود 20mm',
    des4: 'قطع جيب دائري في الصندوق (boolean)',
    des5: 'اصنع مروحة',
    des6: 'مزهرية بروفايل دوران',
    opt1: 'تحسين عارضة ألومنيوم 200x100x200',
    opt2: 'تثبيت القاع، حمل 1000N أعلى',
    opt3: 'تخفيف إلى 30% من الحجم',
    opt4: 'تحسين طوبولوجي لحامل تيتانيوم',
    voiceLang: 'ar-SA',
  },
} as const;

/* ─── Data types ─────────────────────────────────────────────────────────── */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface BomPart {
  name: string;
  description: string;
  shapeId: string;
  params: Record<string, number>;
  features: Array<{ type: FeatureType; params: Record<string, number> }>;
  quantity: number;
  suggestedMaterial: string;
  suggestedProcess: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
}

export interface SingleResult {
  mode: 'single';
  shapeId: string | null;
  params: Record<string, number>;
  features: Array<{ type: FeatureType; params: Record<string, number> }>;
  message: string;
  error?: string;
}

interface BomResult {
  mode: 'bom';
  productName: string;
  parts: BomPart[];
  message: string;
  error?: string;
}

export interface SketchResult {
  mode: 'sketch';
  profile: SketchProfile;
  config: Partial<SketchConfig>;
  message: string;
  error?: string;
}

export interface OptimizeResult {
  mode: 'optimize';
  dimX: number;
  dimY: number;
  dimZ: number;
  materialKey: string;
  fixedFaces: Face[];
  loads: Array<{ face: Face; force: [number, number, number] }>;
  volfrac: number;
  resolution?: 'low' | 'medium' | 'high';
  message: string;
  error?: string;
}

export interface ModifyResult {
  mode: 'modify';
  actions: Array<{
    type: 'param' | 'feature';
    key?: string;
    value?: number;
    featureType?: FeatureType;
    params?: Record<string, number>;
    description: string;
  }>;
  message: string;
  error?: string;
}

export type ChatResult = SingleResult | BomResult | SketchResult | OptimizeResult | ModifyResult;

/* ─── Props ──────────────────────────────────────────────────────────────── */

/** Current design state passed to AI for context-aware responses */
export interface DesignContext {
  /** Current shape or null if blank sketch */
  shapeId: string | null;
  /** Current shape params */
  params: Record<string, number>;
  /** Applied features */
  features: Array<{ type: FeatureType; params: Record<string, number> }>;
  /** Whether in sketch mode */
  isSketchMode: boolean;
  /** Whether a sketch result (3D) exists */
  hasSketchResult: boolean;
  /** Current bounding box if geometry exists */
  bbox: { w: number; h: number; d: number } | null;
  /** Volume in cm³ */
  volume_cm3: number | null;
  /** Best DFM manufacturability score (0-100), null if not yet analyzed */
  dfmScore: number | null;
  /** Top DFM issues for AI context (max 5) */
  dfmIssues: Array<{ type: string; severity: string; description: string }> | null;
  // ── Phase C: multimodal context ──
  /** FEA max Von Mises stress (MPa), null if FEA not run */
  feaMaxStressMPa: number | null;
  /** FEA safety factor (yield / maxStress), null if FEA not run */
  feaSafetyFactor: number | null;
  /** Estimated mass in grams (volume × material density), null if no geometry */
  massG: number | null;
  /** Cheapest process unit cost estimate in USD, null if no geometry */
  estimatedUnitCostUSD: number | null;
  /** Currently selected face or edge (from 3D viewport click), null if none */
  selectedElement?: import('./editing/selectionInfo').ElementSelectionInfo | null;
}

interface ShapeChatProps {
  onApplySingle: (result: SingleResult) => void;
  onApplyBom: (parts: BomPart[], productName?: string) => void;
  onBomPreview?: (parts: BomPart[], productName: string) => void;
  onApplySketch?: (profile: SketchProfile, config: Partial<SketchConfig>) => void;
  onApplyOptimize?: (result: OptimizeResult) => void;
  onApplyModify?: (result: ModifyResult) => void;
  /** Called after a modify result is auto-applied — provides action count for undo toast */
  onModifyAutoApplied?: (actionCount: number) => void;
  /** Preview callback — show transparent preview before applying */
  onPreview?: (result: ChatResult) => void;
  /** Cancel preview callback */
  onCancelPreview?: () => void;
  activeTab?: 'design' | 'optimize';
  t: Record<string, string>;
  /** If provided, auto-sends this message on mount (from gallery chat bar) */
  initialMessage?: string;
  /** Current design state for context-aware AI */
  designContext?: DesignContext;
  /** Pre-populated message history (from cloud restore) */
  initialMessages?: ChatMessage[];
  /** Called whenever messages change (for persistence) */
  onMessagesChange?: (messages: ChatMessage[]) => void;
}

/* ─── Icons ──────────────────────────────────────────────────────────────── */

const SHAPE_ICONS: Record<string, string> = {
  box: '📦', cylinder: '🔩', pipe: '🔧', lBracket: '📐',
  flange: '⚙️', plateBend: '🔨', gear: '⚙️', fanBlade: '🌀',
  sprocket: '🔗', pulley: '🎡',
};

const MODE_BADGES: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  single: { icon: '🧊', label: 'Part', color: '#58a6ff', bg: '#1a2332' },
  bom: { icon: '📋', label: 'BOM', color: '#39d2e0', bg: '#0d2a2e' },
  sketch: { icon: '✏️', label: 'Sketch', color: '#bc8cff', bg: '#1e1533' },
  optimize: { icon: '🔬', label: 'Optimize', color: '#3fb950', bg: '#0d2818' },
  modify: { icon: '🔧', label: 'Modify', color: '#d29922', bg: '#2a1f0a' },
};

/* ─── Animated typing dots ────────────────────────────────────────────────── */

function TypingDots() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <span style={{ animation: 'nf-dot 1.2s infinite 0s', display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: '#8b949e' }} />
      <span style={{ animation: 'nf-dot 1.2s infinite 0.2s', display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: '#8b949e' }} />
      <span style={{ animation: 'nf-dot 1.2s infinite 0.4s', display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: '#8b949e' }} />
    </span>
  );
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function ShapeChat({
  onApplySingle, onApplyBom, onBomPreview,
  onApplySketch, onApplyOptimize, onApplyModify, onModifyAutoApplied,
  onPreview, onCancelPreview,
  activeTab = 'design', t, initialMessage, designContext,
  initialMessages, onMessagesChange,
}: ShapeChatProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const tr = dict[langMap[seg] ?? 'en'];

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessages ?? []);
  const [loading, setLoading] = useState(false);
  const onMessagesChangeRef = useRef(onMessagesChange);
  useEffect(() => { onMessagesChangeRef.current = onMessagesChange; }, [onMessagesChange]);

  // initialMessages가 바뀌면(프로젝트 로드) 히스토리 교체
  const initialMessagesRef = useRef(initialMessages);
  useEffect(() => {
    if (initialMessages && initialMessages !== initialMessagesRef.current) {
      initialMessagesRef.current = initialMessages;
      setMessages(initialMessages);
    }
  }, [initialMessages]);

  // messages 변경 시 콜백 (최대 60개 유지)
  const updateMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessages(prev => {
      const next = updater(prev).slice(-60);
      onMessagesChangeRef.current?.(next);
      return next;
    });
  }, []);
  const [streamingText, setStreamingText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [bomResult, setBomResult] = useState<BomResult | null>(null);
  const [isListening, setIsListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const [lastMode, setLastMode] = useState<string | null>(null);
  const [pendingResult, setPendingResult] = useState<ChatResult | null>(null);
  const [lastShapeId, setLastShapeId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastFailedText, setLastFailedText] = useState<string | null>(null);
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const initialSent = useRef(false);

  /* ── Keep lastShapeId in sync with designContext ── */
  useEffect(() => {
    if (designContext?.shapeId) setLastShapeId(designContext.shapeId);
  }, [designContext?.shapeId]);

  /* ── Quick-prompt chips based on selected shape ── */
  const quickChips = [
    { key: 'aiSuggestion1', fallback: tr.quick1 },
    { key: 'aiSuggestion2', fallback: tr.quick2 },
    { key: 'aiSuggestion3', fallback: tr.quick3 },
    { key: 'aiSuggestion4', fallback: tr.quick4 },
    { key: 'aiSuggestion5', fallback: tr.quick5 },
  ];

  /** Parse a streaming SSE/NDJSON response and return full message text */
  const readStream = useCallback(async (res: Response): Promise<string> => {
    const reader = res.body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder();
    let accumulated = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // SSE lines: "data: {...}\n"
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const obj = JSON.parse(payload);
            const delta = obj.choices?.[0]?.delta?.content ?? '';
            accumulated += delta;
            setStreamingText(accumulated);
          } catch {
            // ignore malformed chunks
          }
        }
      }
    } catch {
      // Stream disconnected mid-response
      if (accumulated) {
        toast('error', tr.toastStreamCut);
      }
    }
    return accumulated;
  }, [toast, tr]);

  /** Parse the full JSON response text into a ChatResult */
  const parseResult = useCallback((raw: string): ChatResult => {
    let jsonStr = raw;
    jsonStr = jsonStr.replace(/```json?\s*/g, '').replace(/```/g, '');
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }
    const parsed = JSON.parse(jsonStr.trim());
    // Basic validation: must be a non-null object
    if (typeof parsed !== 'object' || parsed === null) {
      throw new SyntaxError('AI response is not a valid object');
    }
    return parsed as ChatResult;
  }, []);

  /** Core send function — can be called programmatically */
  const sendMessage = useCallback(async (text: string, history: ChatMessage[]) => {
    setExpanded(true);
    setBomResult(null);
    setLastMode(null);
    setErrorMsg(null);
    setLastFailedText(null);
    setStreamingText('');
    const userMsg: ChatMessage = { role: 'user', content: text };
    // Keep only last 6 messages (3 user + 3 assistant) for context
    const trimmedHistory = history.slice(-6);
    updateMessages(prev => [...prev, userMsg]);
    setLoading(true);

    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50);

    try {
      const res = await fetch('/api/shape-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: trimmedHistory, context: designContext || null }),
      });

      if (!res.ok) {
        const statusMsg = res.status === 429 ? tr.toastRateLimit
          : res.status >= 500 ? tr.toastServerError
          : res.status === 401 ? tr.toastAuthRequired
          : `HTTP ${res.status}`;
        throw new Error(statusMsg);
      }

      let data: ChatResult;

      // Check if the response is a stream (SSE) or plain JSON
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        const rawText = await readStream(res);
        setStreamingText('');
        try {
          data = parseResult(rawText);
        } catch {
          const assistantMsg: ChatMessage = { role: 'assistant', content: rawText };
          updateMessages(prev => [...prev, assistantMsg]);
          setLoading(false);
          return;
        }
      } else {
        data = await res.json();
      }

      setStreamingText('');
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: data.message || (data as unknown as Record<string, unknown>).error as string || tr.aiNoResponse,
      };
      updateMessages(prev => [...prev, assistantMsg]);
      setLastMode(data.mode);

      // Track last shape for multi-turn context banner
      if (data.mode === 'single' && (data as SingleResult).shapeId) {
        setLastShapeId((data as SingleResult).shapeId);
      }

      if (data.mode === 'bom' && (data as BomResult).parts?.length > 0) {
        const bomData = data as BomResult;
        setBomResult(bomData);
        if (onBomPreview) onBomPreview(bomData.parts, bomData.productName);
      } else if (data.mode === 'modify' && onApplyModify && !data.error) {
        // Auto-apply modify immediately — no confirm needed, undo via Ctrl+Z
        onApplyModify(data as ModifyResult);
        onModifyAutoApplied?.((data as ModifyResult).actions.length);
      } else if (!data.error) {
        setPendingResult(data);
        onPreview?.(data);
      }

      setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 100);

    } catch (err) {
      setStreamingText('');
      let msg: string = tr.errAiConnect;
      if (err instanceof TypeError && err.message.includes('fetch')) {
        msg = tr.errNetwork;
      } else if (err instanceof SyntaxError) {
        msg = tr.errParse;
      } else if (err instanceof Error && err.message.includes('timeout')) {
        msg = tr.errTimeout;
      } else if (err instanceof Error && err.message) {
        msg = err.message;
      }
      setErrorMsg(msg);
      setLastFailedText(text);
      updateMessages(prev => [...prev, { role: 'assistant', content: msg }]);
      toast('error', tr.toastAiFailed);
    } finally {
      setLoading(false);
    }
  }, [onApplySingle, onApplySketch, onApplyOptimize, onApplyModify, onModifyAutoApplied, onBomPreview, designContext, readStream, parseResult, toast, tr, updateMessages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    await sendMessage(text, messages);
  }, [input, loading, messages, sendMessage]);

  // Auto-send initial message from gallery
  React.useEffect(() => {
    if (initialMessage && !initialSent.current) {
      initialSent.current = true;
      sendMessage(initialMessage, []);
    }
  }, [initialMessage, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /** Retry last failed request */
  const handleRetry = useCallback(() => {
    if (!lastFailedText) return;
    const text = lastFailedText;
    setErrorMsg(null);
    setLastFailedText(null);
    // Remove the last assistant error message before retrying
    updateMessages(prev => {
      const copy = [...prev];
      if (copy.length > 0 && copy[copy.length - 1].role === 'assistant') copy.pop();
      return copy;
    });
    sendMessage(text, messages.slice(0, -1));
  }, [lastFailedText, messages, sendMessage]);

  // ── Preview Apply / Cancel ──
  const handleApplyPreview = useCallback(() => {
    if (!pendingResult) return;
    if (pendingResult.mode === 'single' && (pendingResult as SingleResult).shapeId) {
      onApplySingle(pendingResult as SingleResult);
    } else if (pendingResult.mode === 'sketch' && (pendingResult as SketchResult).profile) {
      onApplySketch?.((pendingResult as SketchResult).profile, (pendingResult as SketchResult).config || {});
    } else if (pendingResult.mode === 'optimize') {
      onApplyOptimize?.(pendingResult as OptimizeResult);
    } else if (pendingResult.mode === 'modify') {
      onApplyModify?.(pendingResult as ModifyResult);
    }
    setPendingResult(null);
  }, [pendingResult, onApplySingle, onApplySketch, onApplyOptimize, onApplyModify]);

  const handleCancelPreview = useCallback(() => {
    setPendingResult(null);
    onCancelPreview?.();
  }, [onCancelPreview]);

  const handleAddAllToCart = useCallback(() => {
    if (!bomResult) return;
    onApplyBom(bomResult.parts, bomResult.productName);
    setBomResult(null);
  }, [bomResult, onApplyBom]);

  const handleApplyPart = useCallback((part: BomPart) => {
    onApplySingle({
      mode: 'single',
      shapeId: part.shapeId,
      params: part.params,
      features: part.features,
      message: part.name,
    });
  }, [onApplySingle]);

  const handleExampleClick = (text: string) => {
    setInput(text);
    inputRef.current?.focus();
  };

  // Context-aware examples based on active tab and design state
  const isBlank = designContext?.shapeId === null && designContext?.isSketchMode;
  const hasShape = !!designContext?.shapeId || designContext?.hasSketchResult;

  const blankExamples = [
    { text: tr.blank1, icon: '📦' },
    { text: tr.blank2, icon: '✏️' },
    { text: tr.blank3, icon: '🏺' },
    { text: tr.blank4, icon: '🌀' },
    { text: tr.blank5, icon: '⚙️' },
    { text: tr.blank6, icon: '🔬' },
  ];

  const modifyExamples = [
    { text: tr.mod1, icon: '🔧' },
    { text: tr.mod2, icon: '🕳️' },
    { text: tr.mod3, icon: '📐' },
    { text: tr.mod4, icon: '🔩' },
    { text: tr.mod5, icon: '📦' },
    { text: tr.mod6, icon: '⚡' },
  ];

  const designExamples = [
    { text: t.chatExample1 || tr.des1, icon: '🔩' },
    { text: t.chatExample2 || tr.des2, icon: '📦' },
    { text: tr.des3, icon: '✏️' },
    { text: tr.des4, icon: '🔧' },
    { text: t.chatExample4 || tr.des5, icon: '🌀' },
    { text: tr.des6, icon: '🏺' },
  ];

  const optimizeExamples = [
    { text: tr.opt1, icon: '🔬' },
    { text: tr.opt2, icon: '📐' },
    { text: tr.opt3, icon: '⚡' },
    { text: tr.opt4, icon: '🏗️' },
  ];

  const examples = activeTab === 'optimize'
    ? optimizeExamples
    : isBlank
      ? blankExamples
      : hasShape
        ? modifyExamples
        : designExamples;

  // Multi-turn: show "Continuing from: [shape]" banner when user follows up with a shape in context
  const showContinuingBanner = messages.length > 0 && !loading && lastShapeId && hasShape;

  return (
    <div style={{
      background: '#161b22', borderRadius: 16, border: '1px solid #30363d',
      overflow: 'hidden',
      maxWidth: 800, margin: '0 auto 24px',
    }}>
      {/* Chat messages */}
      {expanded && messages.length > 0 && (
        <div ref={scrollRef} style={{
          maxHeight: 260, overflowY: 'auto', padding: '12px 16px',
          display: 'flex', flexDirection: 'column', gap: 8,
          borderBottom: '1px solid #30363d',
        }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 6 }}>
              {msg.role === 'assistant' && <span style={{ fontSize: 16, marginTop: 4, flexShrink: 0 }}>🤖</span>}
              <div style={{
                maxWidth: '85%', padding: '8px 14px', borderRadius: 14,
                fontSize: 13, lineHeight: 1.6,
                background: msg.role === 'user' ? '#388bfd' : '#21262d',
                color: msg.role === 'user' ? '#fff' : '#c9d1d9',
                borderBottomRightRadius: msg.role === 'user' ? 4 : 14,
                borderBottomLeftRadius: msg.role === 'assistant' ? 4 : 14,
              }}>
                {msg.content}
              </div>
            </div>
          ))}

          {/* Streaming token display */}
          {loading && streamingText && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 6 }}>
              <span style={{ fontSize: 16, marginTop: 4, flexShrink: 0 }}>🤖</span>
              <div style={{
                maxWidth: '85%', padding: '8px 14px', borderRadius: 14,
                fontSize: 13, lineHeight: 1.6,
                background: '#21262d', color: '#c9d1d9',
                borderBottomLeftRadius: 4,
              }}>
                {streamingText}
                <span style={{ display: 'inline-block', width: 2, height: 13, background: '#58a6ff', marginLeft: 3, animation: 'nf-blink 0.8s step-end infinite', verticalAlign: 'text-bottom' }} />
              </div>
            </div>
          )}

          {/* Preview Apply/Cancel card */}
          {!loading && pendingResult && MODE_BADGES[pendingResult.mode] && (
            <div style={{
              margin: '4px 0', padding: '10px 14px', borderRadius: 12,
              background: '#21262d',
              border: '2px solid #388bfd', position: 'relative',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  background: MODE_BADGES[pendingResult.mode].bg, color: MODE_BADGES[pendingResult.mode].color,
                }}>
                  {MODE_BADGES[pendingResult.mode].icon} {MODE_BADGES[pendingResult.mode].label}
                </span>
                <span style={{ fontSize: 11, color: '#58a6ff', fontWeight: 700 }}>
                  {t.aiPreviewReady || tr.aiPreviewReady}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleApplyPreview} style={{
                  flex: 1, padding: '9px 0', borderRadius: 10, border: 'none',
                  background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                  color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(22,163,74,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  ✓ {t.aiPreviewApply || tr.aiPreviewApply}
                </button>
                <button onClick={handleCancelPreview} style={{
                  padding: '9px 20px', borderRadius: 10,
                  border: '1px solid #30363d', background: '#0d1117',
                  color: '#ef4444', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                }}>
                  ✕ {t.aiPreviewCancel || tr.aiPreviewCancel}
                </button>
              </div>
            </div>
          )}

          {/* Error card with Retry button */}
          {!loading && errorMsg && (
            <div style={{
              margin: '4px 0', padding: '10px 14px', borderRadius: 12,
              background: '#2a1515', border: '1px solid #6e2424',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            }}>
              <span style={{ fontSize: 12, color: '#f87171' }}>⚠️ {errorMsg}</span>
              {lastFailedText && (
                <button onClick={handleRetry} style={{
                  padding: '6px 14px', borderRadius: 8, border: 'none',
                  background: '#388bfd', color: '#fff', fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', flexShrink: 0,
                }}>
                  ↺ {t.aiRetry || tr.aiRetry}
                </button>
              )}
            </div>
          )}

          {/* Mode badge (only when no pending preview and no error) */}
          {!loading && !pendingResult && !errorMsg && lastMode && MODE_BADGES[lastMode] && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', paddingLeft: 28 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                background: MODE_BADGES[lastMode].bg, color: MODE_BADGES[lastMode].color,
              }}>
                {MODE_BADGES[lastMode].icon} {MODE_BADGES[lastMode].label} {tr.modeApplied}
              </span>
            </div>
          )}

          {/* Typing indicator (no streaming text yet) */}
          {loading && !streamingText && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 6 }}>
              <span style={{ fontSize: 16, marginTop: 4 }}>🤖</span>
              <div style={{ padding: '10px 14px', borderRadius: 14, background: '#21262d', fontSize: 13, color: '#8b949e', borderBottomLeftRadius: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{t.aiTyping || tr.aiTyping}</span>
                <TypingDots />
              </div>
            </div>
          )}
        </div>
      )}

      {/* BOM Result Card */}
      {bomResult && bomResult.parts.length > 0 && (
        <div style={{ padding: '16px', borderBottom: '1px solid #30363d' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>📋</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#c9d1d9' }}>
                {bomResult.productName} BOM
              </div>
              <div style={{ fontSize: 12, color: '#8b949e' }}>
                {bomResult.parts.length}{t.bomParts || tr.bomParts}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
            {bomResult.parts.map((part, idx) => (
              <div key={idx} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 12,
                background: '#0d1117', border: '1px solid #30363d',
                cursor: 'pointer', transition: 'all 0.15s',
              }}
                onClick={() => handleApplyPart(part)}
                onMouseEnter={e => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.borderColor = '#58a6ff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#0d1117'; e.currentTarget.style.borderColor = '#30363d'; }}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', background: '#388bfd',
                  color: '#fff', fontSize: 12, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>{idx + 1}</div>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{SHAPE_ICONS[part.shapeId] || '🧊'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#c9d1d9' }}>
                    {part.name}
                    {part.quantity > 1 && <span style={{ fontSize: 11, color: '#58a6ff', marginLeft: 6 }}>×{part.quantity}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#8b949e', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {part.description}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0, flexWrap: 'wrap' }}>
                  {part.suggestedMaterial && (
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: '#1a2332', color: '#58a6ff' }}>{part.suggestedMaterial}</span>
                  )}
                  {part.suggestedProcess && (
                    <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: '#0d2818', color: '#3fb950' }}>{part.suggestedProcess}</span>
                  )}
                </div>
                <span style={{ fontSize: 12, color: '#58a6ff', flexShrink: 0 }}>→</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleAddAllToCart}
              style={{
                flex: 1, padding: '11px 0', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, #388bfd 0%, #58a6ff 100%)',
                color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(56,139,253,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              🛒 {t.bomAddAll || tr.bomAddAll} ({bomResult.parts.reduce((s, p) => s + (p.quantity || 1), 0)}{t.cartPcs || tr.cartPcs})
            </button>
            <button
              onClick={() => setBomResult(null)}
              style={{
                padding: '11px 16px', borderRadius: 12,
                border: '1px solid #30363d', background: '#0d1117',
                color: '#8b949e', fontWeight: 600, fontSize: 13, cursor: 'pointer',
              }}
            >✕</button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div style={{ padding: '12px 16px' }}>
        {/* Multi-turn context banner */}
        {showContinuingBanner && (
          <div style={{
            fontSize: 11, color: '#8b949e', marginBottom: 8,
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#21262d', borderRadius: 8, padding: '5px 10px',
          }}>
            <span style={{ color: '#58a6ff', fontWeight: 700 }}>
              {t.aiContinuing || tr.aiContinuing}
            </span>
            <span style={{ color: '#c9d1d9', fontWeight: 600 }}>
              {SHAPE_ICONS[lastShapeId!] || '🧊'} {lastShapeId}
            </span>
          </div>
        )}

        {/* Contextual hint */}
        {messages.length > 0 && !loading && !showContinuingBanner && (
          <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700 }}>{tr.tryLabel}</span>
            {activeTab === 'design' ? (
              hasShape ? (
                <>
                  <span style={{ color: '#58a6ff' }}>{tr.tryFilletEdge}</span>
                  <span style={{ color: '#484f58' }}>·</span>
                  <span style={{ color: '#d29922' }}>{tr.tryAddHole}</span>
                  <span style={{ color: '#484f58' }}>·</span>
                  <span style={{ color: '#bc8cff' }}>{tr.tryHalfSize}</span>
                  <span style={{ color: '#484f58' }}>·</span>
                  <span style={{ color: '#3fb950' }}>{tr.tryShell}</span>
                </>
              ) : (
                <>
                  <span style={{ color: '#58a6ff' }}>{tr.tryBracket}</span>
                  <span style={{ color: '#484f58' }}>·</span>
                  <span style={{ color: '#bc8cff' }}>{tr.tryStarSketch}</span>
                  <span style={{ color: '#484f58' }}>·</span>
                  <span style={{ color: '#39d2e0' }}>{tr.tryFanAssembly}</span>
                  <span style={{ color: '#484f58' }}>·</span>
                  <span style={{ color: '#3fb950' }}>{tr.tryVase}</span>
                </>
              )
            ) : (
              <>
                <span style={{ color: '#3fb950' }}>{tr.tryFixLoad}</span>
                <span style={{ color: '#484f58' }}>·</span>
                <span style={{ color: '#3fb950' }}>{tr.tryVolReduce}</span>
              </>
            )}
          </div>
        )}

        {/* Example chips (shown before first message) */}
        {messages.length === 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {examples.map((ex, i) => (
              <button key={i} onClick={() => handleExampleClick(ex.text)} style={{
                padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                border: '1px solid #30363d', background: '#21262d', color: '#8b949e',
                cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
                onMouseEnter={e => { e.currentTarget.style.background = '#30363d'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                <span style={{ fontSize: 13 }}>{ex.icon}</span> {ex.text}
              </button>
            ))}
          </div>
        )}

        {/* Quick-prompt chips (shown after first message, when shape is loaded) */}
        {messages.length > 0 && !loading && hasShape && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {quickChips.map((chip, i) => (
              <button key={i} onClick={() => handleExampleClick(t[chip.key] || chip.fallback)} style={{
                padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: 600,
                border: '1px solid #30363d', background: '#21262d', color: '#8b949e',
                cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = '#388bfd22'; e.currentTarget.style.borderColor = '#388bfd'; e.currentTarget.style.color = '#58a6ff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e'; }}
              >
                {t[chip.key] || chip.fallback}
              </button>
            ))}
          </div>
        )}

        {/* Input row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>🤖</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isListening ? tr.voiceListening : activeTab === 'optimize'
              ? (t.chatPlaceholderOpt || tr.phFallbackOpt)
              : isBlank
                ? tr.phPlaceholderDesc
                : hasShape
                  ? tr.phPlaceholderModify
                  : (t.chatPlaceholder || tr.phFallbackDesign)
            }
            disabled={loading}
            style={{
              flex: 1, padding: '11px 16px', borderRadius: 12,
              border: '2px solid #30363d', fontSize: 14, outline: 'none',
              color: '#c9d1d9',
              background: loading ? '#161b22' : '#0d1117',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = '#388bfd'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(56,139,253,0.15)'; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.boxShadow = 'none'; }}
          />
          {/* Mic button */}
          <button
            title={isListening ? tr.micStop : tr.micStart}
            onClick={() => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const w = window as any;
              const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
              if (!SR) { alert(tr.micUnsupported); return; }
              if (isListening) {
                recognitionRef.current?.stop();
                setIsListening(false);
                return;
              }
              const rec = new SR();
              rec.lang = tr.voiceLang;
              rec.interimResults = true;
              rec.continuous = false;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              rec.onresult = (e: any) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const transcript = Array.from(e.results).map((r: any) => r[0].transcript).join('');
                setInput(transcript);
              };
              rec.onend = () => setIsListening(false);
              rec.onerror = () => setIsListening(false);
              recognitionRef.current = rec;
              rec.start();
              setIsListening(true);
            }}
            style={{
              padding: '11px 13px', borderRadius: 12, border: 'none', flexShrink: 0,
              background: isListening ? '#f85149' : '#21262d',
              color: isListening ? '#fff' : '#8b949e',
              fontSize: 16, cursor: 'pointer', transition: 'all 0.2s',
              animation: isListening ? 'pulse 1.2s infinite' : 'none',
            }}
          >🎙</button>
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            style={{
              padding: '11px 18px', borderRadius: 12, border: 'none',
              background: input.trim() && !loading
                ? '#388bfd'
                : '#30363d',
              color: '#fff', fontWeight: 700, fontSize: 16,
              cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s', flexShrink: 0,
              boxShadow: input.trim() && !loading ? '0 2px 8px rgba(56,139,253,0.3)' : 'none',
            }}
          >↑</button>
        </div>

        {/* Capability bar */}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {Object.entries(MODE_BADGES).map(([key, badge]) => (
            <span key={key} style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600,
              background: badge.bg, color: badge.color, opacity: 0.7,
            }}>
              {badge.icon} {badge.label}
            </span>
          ))}
        </div>
      </div>

    </div>
  );
}
