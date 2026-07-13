'use client';

/**
 * ChatHero — 채팅-우선 랜딩 히어로 (Genspark/GPT형).
 *
 * 중앙 채팅 입력 + 하단 5개 분야 칩(기계설계·토목·건축·조경·인테리어).
 * 사용자가 자연어로 물으면 /api/eng-chat 을 도메인과 함께 호출해 실제 AI 응답을
 * 인라인으로 렌더한다. 전문가 CAD(expert)는 사람에게 직접 노출하지 않고, 여기서
 * AI가 상담·안내한 뒤 필요한 경우에만 결정론 데모/견적/스튜디오로 이어 준다.
 */

import React, { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type * as ThreeNS from 'three';
import { DomainIcon } from './_domainIcons';

// three/R3F 뷰어는 SSR 불가 → 클라이언트에서만 로드.
const ChatCadViewer = dynamic(() => import('./ChatCadViewer'), {
  ssr: false,
  loading: () => (
    <div style={{ width: '100%', height: 240, borderRadius: 10, background: '#0b1020', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 12 }}>3D…</div>
  ),
});

type Domain = 'mechanical' | 'civil' | 'architecture' | 'landscape' | 'interior';
type CheckRow = { name: string; pass: boolean; detail: string };
type CalcResult = { verdict: string; title: string; checks: CheckRow[]; refs: string[]; remaining?: number; error?: string };
type ComposeIntent = { name?: string; features?: Array<Record<string, unknown>> };
type AssemblyPlan = { name?: string; parts?: Array<Record<string, unknown>> };
// 기계 CAD 결과. 단일부품(compose→STEP) 또는 멀티바디 조립체(assemble→GA) 스테이지.
type CadResult = {
  composing?: boolean;          // 생성 진행 중(십수 초)
  error?: string;
  scad?: string;
  gateErrors?: string[];         // 결정론 게이트 위반(빈배열=통과)
  spec?: string[];               // 사람이 검토할 치수 사양/부품목록(체크포인트)
  // 단일부품
  composeIntent?: ComposeIntent; // export-step 입력
  // 멀티바디 조립체
  isAssembly?: boolean;
  assembly?: AssemblyPlan;       // render-html 입력
  interferences?: Array<Record<string, unknown>>;
  welds?: Array<Record<string, unknown>>;  // 용접 조인트 개산
  weldTotalMm?: number;
};
type CableRow = { from?: unknown; to?: unknown; type?: unknown; cores?: unknown; mm2?: unknown; lengthM?: unknown; note?: unknown };
type Msg = { role: 'user' | 'assistant'; content: string; calc?: CalcResult; cad?: CadResult; wiring?: CableRow[] };

// 실행형 도메인(엔진 연동). 인테리어는 얕아 대화만(스트리밍 유지).
const ACTION_DOMAINS: Domain[] = ['civil', 'architecture', 'landscape', 'mechanical'];
const ENG_API = 'https://nexyfab-eng-api.gomd999.workers.dev';

// compose intent → 사람이 읽을 치수 사양 라인(체크포인트 검토용).
function summarizeFeatures(intent: ComposeIntent | undefined): string[] {
  const feats = intent?.features;
  if (!Array.isArray(feats)) return [];
  return feats.map((f) => {
    const kind = String(f.kind ?? '');
    const sub = f.op === 'subtract';
    const pre = sub ? '− ' : '';
    const sz = Array.isArray(f.size) ? (f.size as unknown[]).join('×') : null;
    const d = f.diameter ?? f.d; const h = f.height ?? f.h;
    if ((kind === 'box' || kind === 'prism') && sz) return `${pre}${kind === 'box' ? '박스' : '프리즘'} ${sz} mm`;
    if (kind === 'cylinder' || kind === 'pipe') return `${pre}${sub ? '구멍' : '실린더'} ⌀${d ?? '?'}${h ? `×${h}` : ''} mm`;
    if (kind === 'sphere') return `${pre}구 ⌀${d ?? '?'} mm`;
    if (kind === 'cone') return `${pre}원뿔 ⌀${d ?? '?'}×${h ?? '?'} mm`;
    if (kind === 'revolve' || kind === 'polygon') return `${pre}회전체(단면 프로파일)`;
    return `${pre}${kind || 'feature'}`;
  });
}

// ISO 2768-m 일반 선형공차 (결정론·표준, 모호성 없음). 개별 GD&T 는 앱(§12.6).
function iso2768m(dim: number): number {
  const a = Math.abs(dim);
  if (a <= 6) return 0.1;
  if (a <= 30) return 0.2;
  if (a <= 120) return 0.3;
  if (a <= 400) return 0.5;
  if (a <= 1000) return 0.8;
  return 1.2;
}
// intent/assembly 를 순회해 선형 치수만 수집(위치 tx/ty/tz·각도·좌표 제외).
function collectDims(obj: unknown): number[] {
  const out: number[] = [];
  const skip = new Set(['tx', 'ty', 'tz', 'rx', 'ry', 'rz', 'x', 'y', 'op', 'kind', 'type', 'id', 'name', 'boltCount']);
  const walk = (v: unknown) => {
    if (typeof v === 'number' && isFinite(v) && v > 0) out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v as Record<string, unknown>)) if (!skip.has(k)) walk(val);
  };
  walk(obj);
  return out;
}
function toleranceRange(obj: unknown): string | null {
  const tols = collectDims(obj).map(iso2768m);
  if (!tols.length) return null;
  const lo = Math.min(...tols), hi = Math.max(...tols);
  return lo === hi ? `±${lo}` : `±${lo}~±${hi} mm`;
}

// compose assembly → 부품 목록(독립 body) 사양 라인.
function summarizeParts(assembly: AssemblyPlan | undefined): string[] {
  const parts = assembly?.parts;
  if (!Array.isArray(parts)) return [];
  return parts.map((p) => {
    const id = String(p.id ?? p.type ?? 'part');
    const type = String(p.type ?? '');
    const at = p.at as Record<string, unknown> | undefined;
    const pos = at ? ` @(${Number(at.tx ?? 0)},${Number(at.ty ?? 0)},${Number(at.tz ?? 0)})` : '';
    return `${id} · ${type}${pos}`;
  });
}

// 기계 멀티바디: 자연어 → drawing/assemble(AI 어셈블리 + 게이트-교정 + 간섭검사).
async function runAssemblePipeline(prompt: string): Promise<CadResult> {
  const r = await fetch('/api/nexyfab/drawing/assemble/', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: prompt }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) {
    const ge = Array.isArray(j?.gateErrors) ? j.gateErrors.join(', ') : '';
    return { error: (j && (j.error || ge)) || '조립체 생성에 실패했어요.' };
  }
  return {
    isAssembly: true,
    assembly: j.assembly as AssemblyPlan,
    scad: typeof j.openscad === 'string' ? j.openscad : undefined,
    interferences: Array.isArray(j.interferences) ? j.interferences : [],
    welds: Array.isArray(j.welds) ? j.welds : [],
    weldTotalMm: typeof j.weldTotalMm === 'number' ? j.weldTotalMm : 0,
    gateErrors: [],
    spec: summarizeParts(j.assembly as AssemblyPlan),
  };
}

// 기계 스테이지1: 자연어 → drawing/compose(AI 조합 + 결정론 게이트) → intent+SCAD.
// 체크포인트로 반환(정밀 3D/STEP은 사용자 승인 후 export-step).
async function runComposePipeline(prompt: string): Promise<CadResult> {
  const r = await fetch('/api/nexyfab/drawing/compose/', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: prompt }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok || !j.intent) {
    const ge = Array.isArray(j?.gateErrors) ? j.gateErrors.join(', ') : '';
    return { error: (j && (j.error || ge)) || '형상 생성에 실패했어요.' };
  }
  return {
    composeIntent: j.intent as ComposeIntent,
    scad: typeof j.scad === 'string' ? j.scad : undefined,
    gateErrors: Array.isArray(j.gateErrors) ? j.gateErrors : [],
    spec: summarizeFeatures(j.intent as ComposeIntent),
  };
}

// 검토 항목 키 → 표시명 (없으면 키 그대로)
const CHECK_LABELS: Record<string, string> = {
  flexure: '휨', shear: '전단', deflection: '처짐', axial: '축력', buckling: '좌굴',
  overturning: '전도', sliding: '활동', bearing: '지지력', eccentricity: '편심',
  moment: '휨모멘트', combined: '조합', drift: '횡변위', bolt_shear: '볼트전단', bolt_bearing: '지압',
};

function parseChecks(checks: Record<string, Record<string, unknown>> | undefined): CheckRow[] {
  return Object.entries(checks ?? {}).map(([key, c]) => {
    let detail = '';
    if (typeof c.ratio === 'number') detail = `${(c.ratio * 100).toFixed(0)}%`;
    else if (typeof c.FS === 'number') detail = `FS ${(c.FS as number).toFixed(2)}${typeof c.min === 'number' ? ` / ≥${c.min}` : ''}`;
    else if (typeof c.qmax_kPa === 'number') detail = `q_max ${(c.qmax_kPa as number).toFixed(0)} kPa${typeof c.allow_kPa === 'number' ? ` / ≤${c.allow_kPa}` : ''}`;
    else if (typeof c.e_m === 'number') detail = `e ${(c.e_m as number).toFixed(2)} m${typeof c.limit_m === 'number' ? ` / ≤${(c.limit_m as number).toFixed(2)}` : ''}`;
    return { name: CHECK_LABELS[key] ?? key, pass: c.pass === true, detail };
  });
}

async function runDemoCalc(id: string, input: Record<string, unknown>): Promise<CalcResult> {
  const res = await fetch(`${ENG_API}/v1/demo/calc/${id}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || 'calc failed');
  return {
    verdict: j.verdict ?? (j.checks && Object.values(j.checks as Record<string, { pass?: boolean }>).every(c => c.pass) ? 'PASS' : 'FAIL'),
    title: j.calculator ?? id,
    checks: parseChecks(j.checks),
    refs: Array.isArray(j.refs) ? j.refs.slice(0, 3) : [],
    remaining: typeof j.remainingToday === 'number' ? j.remainingToday : undefined,
  };
}

const DOMAINS: Domain[] = ['mechanical', 'civil', 'architecture', 'landscape', 'interior'];
const DOMAIN_ACCENT: Record<Domain, string> = {
  mechanical: '#3b82f6', civil: '#8b5cf6', architecture: '#f59e0b', landscape: '#22c55e', interior: '#ec4899',
};

type Lang = 'kr' | 'en' | 'ja' | 'cn' | 'es' | 'ar';
const toLang = (l: string): Lang => (['kr', 'en', 'ja', 'cn', 'es', 'ar'].includes(l) ? (l as Lang) : 'en');

const DICT: Record<Lang, {
  title: string; sub: string; placeholder: string; send: string; thinking: string;
  disclaimer: string; error: string; reset: string; trust: string;
  calcRunning: string; calcPass: string; calcFail: string; calcRefs: string;
  cadGenerating: string; cadNoPreview: string; cadDownload: string;
  cadSpecTitle: string; cadConfirm: string; cadBuilding: string; cadStepDownload: string; cadGate: string;
  cadAssemblyTitle: string; cadParts: string; cadInterfNone: string; cadInterf: string; cadOpenGA: string; cadStlDownload: string; cadDfm: string;
  cadWeld: string; cadWeldTotal: string; cadTol: string; cadGdt: string; cadWiringTitle: string; cadWiringNote: string;
  chips: Record<Domain, string>;
  actDemo: string; actQuote: string; actContact: string;
}> = {
  kr: {
    title: '무엇을 설계할까요?',
    sub: 'AI에게 물어보세요. 기계설계부터 토목·건축·조경·인테리어까지, 하나의 창구에서.',
    placeholder: '예: 200L 스테인리스 응집 탱크를 설계하고 싶어요 / H-300 보 6m 스팬 검토',
    send: '보내기', thinking: '생각 중…',
    disclaimer: 'AI 응답은 비법정 참고자료입니다. 최종 검토·서명은 유자격 기술자의 책임입니다.',
    error: '응답을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.',
    reset: '새 대화',
    trust: '결정론 계산 엔진 · 엔지니어링 코퍼스 · 결과엔 기준 조항 근거 표시',
    chips: { mechanical: '기계설계', civil: '토목', architecture: '건축', landscape: '조경', interior: '인테리어' },
    actDemo: '검증 엔진 데모', actQuote: '정밀 견적 요청', actContact: '전문가 상담',
    calcRunning: '검토 실행 중…', calcPass: '적합', calcFail: '부적합', calcRefs: '근거',
    cadGenerating: '3D 모델 생성 중…', cadNoPreview: '이 형상의 3D 미리보기는 배포 환경에서 제공됩니다. 아래 SCAD로 확인하세요.', cadDownload: 'SCAD 다운로드',
    cadSpecTitle: '이 사양으로 정밀 3D를 생성할까요?', cadConfirm: '확인 · 정밀 3D 생성', cadBuilding: '정밀 형상(STEP) 생성 중…', cadStepDownload: 'STEP 다운로드', cadGate: '결정론 게이트',
    cadAssemblyTitle: '이 조립체로 생성할까요?', cadParts: '부품 (독립 body)', cadInterfNone: '간섭 없음', cadInterf: '간섭 {n}건', cadOpenGA: 'GA 프레젠테이션 열기', cadStlDownload: 'STL 다운로드', cadDfm: 'DFM·견적',
    cadWeld: '용접 개산', cadWeldTotal: '총 용접선', cadTol: '일반공차 ISO 2768-m', cadGdt: '개별 GD&T는 정밀검토(앱)', cadWiringTitle: '전기 결선표 (개산)', cadWiringNote: '개산 · 규격/길이 확인 필요 · 3D 하네스는 별도 ECAD',
  },
  en: {
    title: 'What do you want to design?',
    sub: 'Ask the AI. From mechanical design to civil, architecture, landscape and interior — one place.',
    placeholder: 'e.g. Design a 200L stainless coagulation tank / Check an H-300 beam over a 6m span',
    send: 'Send', thinking: 'Thinking…',
    disclaimer: 'AI replies are non-statutory references. Final review and sign-off remain a licensed engineer’s responsibility.',
    error: 'Could not get a reply. Please try again shortly.',
    reset: 'New chat',
    trust: 'Deterministic calc engine · engineering corpus · every result cites its code clause',
    chips: { mechanical: 'Mechanical', civil: 'Civil', architecture: 'Architecture', landscape: 'Landscape', interior: 'Interior' },
    actDemo: 'Verification engine demo', actQuote: 'Request a quote', actContact: 'Talk to an expert',
    calcRunning: 'Running check…', calcPass: 'PASS', calcFail: 'FAIL', calcRefs: 'Refs',
    cadGenerating: 'Generating 3D model…', cadNoPreview: 'A 3D preview of this shape is available in the deployed environment — see the SCAD below.', cadDownload: 'Download SCAD',
    cadSpecTitle: 'Generate the precise 3D from this spec?', cadConfirm: 'Confirm · build 3D', cadBuilding: 'Building precise geometry (STEP)…', cadStepDownload: 'Download STEP', cadGate: 'Deterministic gate',
    cadAssemblyTitle: 'Generate this assembly?', cadParts: 'Parts (independent bodies)', cadInterfNone: 'No interference', cadInterf: '{n} interference(s)', cadOpenGA: 'Open GA presentation', cadStlDownload: 'Download STL', cadDfm: 'DFM · estimate',
    cadWeld: 'Weld estimate', cadWeldTotal: 'Total weld', cadTol: 'General tol. ISO 2768-m', cadGdt: 'per-feature GD&T in app', cadWiringTitle: 'Cable schedule (est.)', cadWiringNote: 'Estimate · verify spec/length · 3D harness = separate ECAD',
  },
  ja: {
    title: '何を設計しますか？',
    sub: 'AIに聞いてください。機械設計から土木・建築・造園・インテリアまで、ひとつの窓口で。',
    placeholder: '例：200Lステンレス凝集タンクを設計したい / H-300 梁 6mスパンの検討',
    send: '送信', thinking: '考え中…',
    disclaimer: 'AIの回答は非法定の参考資料です。最終確認と署名は有資格技術者の責任です。',
    error: '回答を取得できませんでした。しばらくして再試行してください。',
    reset: '新しいチャット',
    trust: '決定論的計算エンジン · エンジニアリングコーパス · 結果に基準条項の根拠を明示',
    chips: { mechanical: '機械設計', civil: '土木', architecture: '建築', landscape: '造園', interior: 'インテリア' },
    actDemo: '検証エンジンのデモ', actQuote: '見積もり依頼', actContact: '専門家に相談',
    calcRunning: '検討を実行中…', calcPass: '適合', calcFail: '不適合', calcRefs: '根拠',
    cadGenerating: '3Dモデル生成中…', cadNoPreview: 'この形状の3Dプレビューは本番環境で提供されます。下のSCADをご確認ください。', cadDownload: 'SCADをダウンロード',
    cadSpecTitle: 'この仕様で精密3Dを生成しますか？', cadConfirm: '確認 · 精密3D生成', cadBuilding: '精密形状(STEP)を生成中…', cadStepDownload: 'STEPをダウンロード', cadGate: '決定論ゲート',
    cadAssemblyTitle: 'この組立体で生成しますか？', cadParts: '部品 (独立ボディ)', cadInterfNone: '干渉なし', cadInterf: '干渉 {n}件', cadOpenGA: 'GAプレゼンを開く', cadStlDownload: 'STLをダウンロード', cadDfm: 'DFM・見積',
    cadWeld: '溶接概算', cadWeldTotal: '総溶接長', cadTol: '普通公差 ISO 2768-m', cadGdt: '個別GD&Tはアプリ', cadWiringTitle: '結線表(概算)', cadWiringNote: '概算·仕様/長さ要確認·3DハーネスはECAD別途',
  },
  cn: {
    title: '您想设计什么？',
    sub: '向 AI 提问。从机械设计到土木、建筑、景观和室内，尽在一处。',
    placeholder: '例如：设计一个 200L 不锈钢混凝罐 / 复核 6m 跨度的 H-300 梁',
    send: '发送', thinking: '思考中…',
    disclaimer: 'AI 回复为非法定参考资料。最终审核与签署由持证工程师负责。',
    error: '未能获取回复，请稍后重试。',
    reset: '新对话',
    trust: '确定性计算引擎 · 工程语料库 · 结果标注规范条款依据',
    chips: { mechanical: '机械设计', civil: '土木', architecture: '建筑', landscape: '景观', interior: '室内' },
    actDemo: '验证引擎演示', actQuote: '请求报价', actContact: '咨询专家',
    calcRunning: '正在计算…', calcPass: '合格', calcFail: '不合格', calcRefs: '依据',
    cadGenerating: '正在生成3D模型…', cadNoPreview: '该形状的3D预览在部署环境中提供，请查看下方SCAD。', cadDownload: '下载SCAD',
    cadSpecTitle: '按此规格生成精确3D？', cadConfirm: '确认 · 生成3D', cadBuilding: '正在生成精确几何(STEP)…', cadStepDownload: '下载STEP', cadGate: '确定性门控',
    cadAssemblyTitle: '按此组件生成？', cadParts: '零件 (独立实体)', cadInterfNone: '无干涉', cadInterf: '干涉 {n}处', cadOpenGA: '打开GA演示', cadStlDownload: '下载STL', cadDfm: 'DFM·估价',
    cadWeld: '焊接估算', cadWeldTotal: '总焊缝', cadTol: '一般公差 ISO 2768-m', cadGdt: '单项GD&T在应用', cadWiringTitle: '电缆清单(估算)', cadWiringNote: '估算·核对规格/长度·3D线束另属ECAD',
  },
  es: {
    title: '¿Qué quieres diseñar?',
    sub: 'Pregúntale a la IA. De diseño mecánico a civil, arquitectura, paisajismo e interiores, en un solo lugar.',
    placeholder: 'ej.: Diseñar un tanque de coagulación de 200L / Verificar una viga H-300 en 6m',
    send: 'Enviar', thinking: 'Pensando…',
    disclaimer: 'Las respuestas de IA son referencias no normativas. La revisión y firma final son responsabilidad de un ingeniero colegiado.',
    error: 'No se pudo obtener respuesta. Inténtalo de nuevo en unos momentos.',
    reset: 'Nuevo chat',
    trust: 'Motor de cálculo determinista · corpus de ingeniería · cada resultado cita su norma',
    chips: { mechanical: 'Mecánico', civil: 'Civil', architecture: 'Arquitectura', landscape: 'Paisajismo', interior: 'Interior' },
    actDemo: 'Demo del motor de verificación', actQuote: 'Solicitar presupuesto', actContact: 'Hablar con un experto',
    calcRunning: 'Calculando…', calcPass: 'CUMPLE', calcFail: 'NO CUMPLE', calcRefs: 'Refs',
    cadGenerating: 'Generando modelo 3D…', cadNoPreview: 'La vista 3D de esta forma está disponible en el entorno desplegado — consulta el SCAD abajo.', cadDownload: 'Descargar SCAD',
    cadSpecTitle: '¿Generar el 3D preciso con esta especificación?', cadConfirm: 'Confirmar · generar 3D', cadBuilding: 'Generando geometría precisa (STEP)…', cadStepDownload: 'Descargar STEP', cadGate: 'Compuerta determinista',
    cadAssemblyTitle: '¿Generar este ensamblaje?', cadParts: 'Piezas (cuerpos independientes)', cadInterfNone: 'Sin interferencia', cadInterf: '{n} interferencia(s)', cadOpenGA: 'Abrir presentación GA', cadStlDownload: 'Descargar STL', cadDfm: 'DFM · estimación',
    cadWeld: 'Estimación de soldadura', cadWeldTotal: 'Soldadura total', cadTol: 'Tol. general ISO 2768-m', cadGdt: 'GD&T por rasgo en la app', cadWiringTitle: 'Lista de cables (est.)', cadWiringNote: 'Estimación · verificar · arnés 3D = ECAD aparte',
  },
  ar: {
    title: 'ماذا تريد أن تُصمّم؟',
    sub: 'اسأل الذكاء الاصطناعي. من التصميم الميكانيكي إلى المدني والمعماري والمناظر والديكور، في مكان واحد.',
    placeholder: 'مثال: تصميم خزان تخثّر ستانلس 200 لتر / فحص جائز H-300 على بحر 6م',
    send: 'إرسال', thinking: 'يفكّر…',
    disclaimer: 'ردود الذكاء الاصطناعي مراجع غير قانونية. المراجعة والاعتماد النهائي مسؤولية مهندس مرخّص.',
    error: 'تعذّر الحصول على رد. حاول مرة أخرى بعد قليل.',
    reset: 'محادثة جديدة',
    trust: 'محرك حساب حتمي · مكتبة هندسية · كل نتيجة تُسنَد إلى بند الكود',
    chips: { mechanical: 'ميكانيكي', civil: 'مدني', architecture: 'معماري', landscape: 'مناظر', interior: 'ديكور' },
    actDemo: 'عرض محرّك التحقق', actQuote: 'اطلب عرض سعر', actContact: 'تحدث مع خبير',
    calcRunning: 'جارٍ الفحص…', calcPass: 'مطابق', calcFail: 'غير مطابق', calcRefs: 'المراجع',
    cadGenerating: 'جارٍ إنشاء النموذج ثلاثي الأبعاد…', cadNoPreview: 'تتوفر معاينة ثلاثية الأبعاد لهذا الشكل في بيئة النشر — راجع SCAD أدناه.', cadDownload: 'تنزيل SCAD',
    cadSpecTitle: 'هل تُنشئ نموذجًا دقيقًا بهذه المواصفات؟', cadConfirm: 'تأكيد · بناء 3D', cadBuilding: 'جارٍ بناء الشكل الدقيق (STEP)…', cadStepDownload: 'تنزيل STEP', cadGate: 'بوابة حتمية',
    cadAssemblyTitle: 'هل تُنشئ هذا التجميع؟', cadParts: 'الأجزاء (أجسام مستقلة)', cadInterfNone: 'لا تداخل', cadInterf: '{n} تداخل', cadOpenGA: 'افتح عرض GA', cadStlDownload: 'تنزيل STL', cadDfm: 'DFM · تقدير',
    cadWeld: 'تقدير اللحام', cadWeldTotal: 'إجمالي اللحام', cadTol: 'تفاوت عام ISO 2768-m', cadGdt: 'GD&T لكل عنصر في التطبيق', cadWiringTitle: 'جدول الكابلات (تقديري)', cadWiringNote: 'تقديري · تحقّق · تسليك 3D = ECAD منفصل',
  },
};

// 분야별 시작 예시 프롬프트 (대화 시작 전 노출, 클릭 시 즉시 전송)
const SUGGEST: Record<Lang, Record<Domain, string[]>> = {
  kr: {
    mechanical: ['200L 스테인리스 응집 탱크 설계 포인트 알려줘', 'H형 브래킷을 판금으로 만들 때 DFM 주의점은?', '기어박스 하우징 재질을 알루미늄 vs 주철로 비교해줘'],
    civil: ['H=4m 옹벽 안정성 검토 항목 정리해줘', '경간 6m 단순보 처짐 검토는 어떻게?', '우수관로 관경 산정 흐름 알려줘'],
    architecture: ['RC 슬래브 두께 결정 기준은?', '소규모 근생 건물 피난 체크포인트 알려줘', 'BIM으로 물량 산출하는 워크플로우는?'],
    landscape: ['옥상정원 방수·배수 설계 포인트는?', '가로수 식재 간격과 토심 기준 알려줘', '우수 저류형 조경 방법 정리해줘'],
    interior: ['20평 카페 좌석 배치와 동선 제안해줘', '주방 마감재 선정 기준 알려줘', '간접조명 계획 시 고려사항은?'],
  },
  en: {
    mechanical: ['Key design points for a 200L stainless coagulation tank', 'DFM tips for making an H-bracket from sheet metal', 'Compare aluminum vs cast iron for a gearbox housing'],
    civil: ['Stability checks for a 4m retaining wall', 'How to check deflection of a 6m simple beam', 'Walk me through sizing a stormwater pipe'],
    architecture: ['How is RC slab thickness decided?', 'Egress checkpoints for a small commercial building', 'A BIM workflow for quantity take-off'],
    landscape: ['Waterproofing and drainage for a rooftop garden', 'Street-tree spacing and soil depth standards', 'Methods for stormwater-retention landscaping'],
    interior: ['Seating layout and flow for a 60㎡ cafe', 'How to choose kitchen finish materials', 'What to consider when planning indirect lighting'],
  },
  ja: {
    mechanical: ['200Lステンレス凝集タンクの設計ポイントは？', 'Hブラケットを板金で作る際のDFM注意点は？', 'ギヤボックス筐体をアルミvs鋳鉄で比較して'],
    civil: ['H=4mの擁壁の安定検討項目を整理して', 'スパン6mの単純梁のたわみ検討は？', '雨水管の管径算定の流れを教えて'],
    architecture: ['RCスラブ厚さの決定基準は？', '小規模店舗の避難チェックポイントは？', 'BIMで数量算出するワークフローは？'],
    landscape: ['屋上庭園の防水・排水の設計ポイントは？', '街路樹の植栽間隔と土壌深さの基準は？', '雨水貯留型ランドスケープの手法を整理して'],
    interior: ['60㎡カフェの座席配置と動線を提案して', 'キッチン仕上げ材の選定基準は？', '間接照明計画で考慮すべき点は？'],
  },
  cn: {
    mechanical: ['200L不锈钢混凝罐的设计要点', 'H型支架用钣金制作的DFM注意事项', '齿轮箱壳体铝合金与铸铁的对比'],
    civil: ['H=4m挡土墙的稳定性验算项目', '跨度6m简支梁的挠度如何验算', '雨水管管径计算流程'],
    architecture: ['RC楼板厚度的确定依据', '小型商业建筑的疏散检查要点', '用BIM进行工程量计算的流程'],
    landscape: ['屋顶花园的防水与排水设计要点', '行道树的种植间距与土层深度标准', '雨水滞留型景观的做法'],
    interior: ['60㎡咖啡馆的座位布置与动线', '厨房饰面材料的选择依据', '间接照明规划的注意事项'],
  },
  es: {
    mechanical: ['Puntos clave para un tanque de coagulación de 200L', 'Consejos DFM para un soporte en H de chapa', 'Aluminio vs fundición para la carcasa de un reductor'],
    civil: ['Verificaciones de estabilidad de un muro de 4m', 'Cómo revisar la flecha de una viga simple de 6m', 'Cálculo del diámetro de una tubería pluvial'],
    architecture: ['¿Cómo se decide el espesor de una losa de RC?', 'Puntos de evacuación de un local pequeño', 'Un flujo BIM para el cómputo de cantidades'],
    landscape: ['Impermeabilización y drenaje de un jardín en azotea', 'Separación de arbolado y profundidad de suelo', 'Métodos de paisajismo de retención pluvial'],
    interior: ['Distribución y circulación de un café de 60㎡', 'Cómo elegir los acabados de cocina', 'Qué considerar al planificar luz indirecta'],
  },
  ar: {
    mechanical: ['نقاط تصميم خزان تخثّر ستانلس 200 لتر', 'نصائح DFM لصنع كتيفة على شكل H من الصفائح', 'مقارنة الألمنيوم بالحديد الزهر لغلاف صندوق التروس'],
    civil: ['بنود فحص ثبات جدار استنادي بارتفاع 4م', 'كيفية فحص ترخيم جائز بسيط بحر 6م', 'خطوات حساب قطر أنبوب تصريف الأمطار'],
    architecture: ['كيف يُحدَّد سُمك بلاطة خرسانية مسلّحة؟', 'نقاط فحص إخلاء لمبنى تجاري صغير', 'سير عمل BIM لحصر الكميات'],
    landscape: ['نقاط تصميم العزل والتصريف لحديقة سطح', 'معايير تباعد أشجار الشوارع وعمق التربة', 'طرق تنسيق مواقع لاحتجاز مياه الأمطار'],
    interior: ['توزيع المقاعد ومسارات الحركة لمقهى 60م²', 'معايير اختيار تشطيبات المطبخ', 'ما يجب مراعاته عند تخطيط الإضاءة غير المباشرة'],
  },
};

/* ── 경량 마크다운 렌더러 (assistant 응답 전용) ──────────────────────────────
   AI가 반환하는 **굵게** / `코드` / - 불릿 / # 제목 / 번호목록 / 줄바꿈을 표시.
   dangerouslySetInnerHTML 을 쓰지 않고 React 노드로 조립 → XSS 안전. */
function renderInline(text: string, kp: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={`${kp}b${i}`}>{tok.slice(2, -2)}</strong>);
    else out.push(<code key={`${kp}c${i}`} style={{ background: 'rgba(255,255,255,0.12)', padding: '1px 5px', borderRadius: 4, fontSize: '0.92em' }}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length; i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function MarkdownLite({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      const items = bullets;
      blocks.push(
        <ul key={`ul${blocks.length}`} style={{ margin: '4px 0', paddingInlineStart: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {items.map((b, j) => <li key={j}>{renderInline(b, `l${blocks.length}_${j}`)}</li>)}
        </ul>,
      );
      bullets = [];
    }
  };
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\s+$/, '');
    const bullet = /^\s*[-*]\s+(.*)/.exec(line);
    if (bullet) { bullets.push(bullet[1]); return; }
    flush();
    const heading = /^\s*#{1,6}\s+(.*)/.exec(line);
    if (heading) { blocks.push(<div key={idx} style={{ fontWeight: 800, margin: '8px 0 2px' }}>{renderInline(heading[1], `h${idx}`)}</div>); return; }
    if (line.trim() === '') { blocks.push(<div key={idx} style={{ height: 5 }} />); return; }
    blocks.push(<div key={idx}>{renderInline(line, `p${idx}`)}</div>);
  });
  flush();
  return <>{blocks}</>;
}

// 결정론 계산 결과 카드 (eng-api demo 응답 → PASS/FAIL + 검토항목 + 근거).
function CalcCard({ calc, t, isRtl }: { calc: CalcResult; t: (typeof DICT)[Lang]; isRtl: boolean }) {
  if (calc.error) {
    return (
      <div style={{ maxWidth: '92%', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '11px 14px', fontSize: 12.5, color: '#fca5a5', textAlign: isRtl ? 'right' : 'left' }}>
        ⚠️ {calc.error}
      </div>
    );
  }
  const pass = calc.verdict === 'PASS';
  return (
    <div style={{ maxWidth: '92%', background: '#0d1117', border: `1px solid ${pass ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`, borderRadius: 14, padding: '14px 16px', textAlign: isRtl ? 'right' : 'left', boxShadow: '0 6px 24px rgba(0,0,0,0.3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 800, background: pass ? 'rgba(34,197,94,0.18)' : 'rgba(239,68,68,0.18)', color: pass ? '#4ade80' : '#f87171' }}>{pass ? `✓ ${t.calcPass}` : `✕ ${t.calcFail}`}</span>
        <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>{calc.title}</span>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {calc.checks.map((c, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '7px 11px', borderRadius: 8, background: c.pass ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${c.pass ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#e2e8f0' }}>{c.pass ? '✓' : '✕'} {c.name}</span>
            <span style={{ fontSize: 11.5, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{c.detail}</span>
          </div>
        ))}
      </div>
      {calc.refs.length > 0 && (
        <p style={{ marginTop: 10, fontSize: 10.5, color: '#8b949e', lineHeight: 1.6 }}>
          <strong style={{ color: '#94a3b8' }}>{t.calcRefs}:</strong> {calc.refs.join(' · ')}
        </p>
      )}
      <p style={{ marginTop: 6, fontSize: 10, color: '#6e7681', lineHeight: 1.5 }}>{t.disclaimer}</p>
    </div>
  );
}

// 공용 버튼 스타일
const btnPrimary = (accent: string): React.CSSProperties => ({ padding: '7px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', background: accent, color: '#fff', border: 'none' });
const btnGhost: React.CSSProperties = { padding: '7px 14px', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.14)' };

function download(text: string, name: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// 기계 CAD 결과 카드 — 단일부품(체크포인트→STEP 3D) / 멀티바디(부품목록+간섭→GA).
// 출력: STEP·STL·SCAD·GA(render-html). 기본 DFM/견적(fab).
function CadCard({ cad, t, accent, isRtl }: { cad: CadResult; t: (typeof DICT)[Lang]; accent: string; isRtl: boolean }) {
  const [stepText, setStepText] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [err, setErr] = useState('');
  const [geos, setGeos] = useState<unknown[] | null>(null);
  const [gaBusy, setGaBusy] = useState(false);
  const [dfm, setDfm] = useState<{ mass?: number; cost?: number; dxf?: string } | null>(null);
  const [dfmBusy, setDfmBusy] = useState(false);

  const confirmStep = async () => {
    if (!cad.composeIntent) return;
    setBuilding(true); setErr('');
    try {
      const r = await fetch('/api/nexyfab/drawing/export-step/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intent: cad.composeIntent }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok || typeof j.step !== 'string') throw new Error(j?.error || 'STEP build failed');
      setStepText(j.step);
    } catch (e) { setErr(e instanceof Error ? e.message : t.error); } finally { setBuilding(false); }
  };

  const openGA = async () => {
    setGaBusy(true); setErr('');
    try {
      const body = cad.isAssembly ? { assembly: cad.assembly } : { intent: cad.composeIntent };
      const r = await fetch('/api/nexyfab/drawing/render-html/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok || typeof j.html !== 'string') throw new Error(j?.error || 'GA build failed');
      const url = URL.createObjectURL(new Blob([j.html], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { setErr(e instanceof Error ? e.message : t.error); } finally { setGaBusy(false); }
  };

  const downloadStl = async () => {
    if (!geos || !geos.length) return;
    const THREE = await import('three');
    const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js');
    const group = new THREE.Group();
    for (const g of geos) group.add(new THREE.Mesh(g as ThreeNS.BufferGeometry));
    download(new STLExporter().parse(group), 'model.stl', 'model/stl');
  };

  const runDfm = async () => {
    const intent = cad.composeIntent; if (!intent) return;
    setDfmBusy(true); setErr('');
    try {
      const r = await fetch('/api/nexyfab/drawing/fab/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intent }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) throw new Error(j?.error || 'DFM failed');
      const est = (j.estimate ?? {}) as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
      setDfm({ mass: num(est.massKg ?? est.mass ?? j.massKg), cost: num(est.total ?? est.cost ?? j.cost), dxf: typeof j.dxf === 'string' ? j.dxf : undefined });
    } catch (e) { setErr(e instanceof Error ? e.message : t.error); } finally { setDfmBusy(false); }
  };

  const card: React.CSSProperties = { width: 'min(92%, 540px)', background: '#0d1117', border: `1px solid ${accent}44`, borderRadius: 14, padding: 14, textAlign: isRtl ? 'right' : 'left', boxShadow: '0 6px 24px rgba(0,0,0,0.3)' };
  if (cad.error) return <div style={{ ...card, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#fca5a5', fontSize: 12.5 }}>⚠️ {cad.error}</div>;
  if (cad.composing) return <div style={{ ...card, color: '#93c5fd', fontSize: 13 }}>{t.cadGenerating}</div>;

  const gateOk = !cad.gateErrors || cad.gateErrors.length === 0;
  const specBlock = cad.spec && cad.spec.length > 0 && (
    <div style={{ display: 'grid', gap: 5, marginBottom: 10 }}>
      {cad.spec.map((s, i) => (
        <div key={i} style={{ fontSize: 12.5, color: '#cbd5e1', padding: '6px 11px', borderRadius: 8, background: '#0b1020', border: '1px solid rgba(255,255,255,0.07)', fontVariantNumeric: 'tabular-nums' }}>{s}</div>
      ))}
    </div>
  );
  const gateBadge = (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, marginBottom: 12, padding: '3px 10px', borderRadius: 999, background: gateOk ? 'rgba(34,197,94,0.14)' : 'rgba(245,158,11,0.14)', color: gateOk ? '#4ade80' : '#fbbf24' }}>
      {gateOk ? '✓' : '!'} {t.cadGate}{!gateOk && `: ${cad.gateErrors!.join(', ')}`}
    </div>
  );
  const tolStr = toleranceRange(cad.isAssembly ? cad.assembly : cad.composeIntent);
  const tolBadge = tolStr && (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600, marginBottom: 12, padding: '3px 10px', borderRadius: 999, background: 'rgba(59,130,246,0.12)', color: '#93c5fd' }}>
      📐 {t.cadTol} {tolStr} · <span style={{ opacity: 0.75 }}>{t.cadGdt}</span>
    </div>
  );
  const scadDetails = cad.scad && (
    <details style={{ marginBottom: 12 }}>
      <summary style={{ fontSize: 12, color: '#8b949e', cursor: 'pointer', fontWeight: 600 }}>SCAD</summary>
      <pre style={{ marginTop: 8, maxHeight: 150, overflow: 'auto', fontSize: 11, lineHeight: 1.5, color: '#7dd3fc', background: '#0b1020', padding: '10px 12px', borderRadius: 8, fontFamily: 'ui-monospace, monospace' }}>{cad.scad}</pre>
    </details>
  );
  const dfmBlock = dfm && (
    <div style={{ marginTop: 8, fontSize: 12, color: '#cbd5e1', background: '#0b1020', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '8px 11px' }}>
      {dfm.mass !== undefined && <span>≈ {dfm.mass.toFixed(1)} kg&nbsp;&nbsp;</span>}
      {dfm.cost !== undefined && <span>≈ ₩{Math.round(dfm.cost).toLocaleString()}&nbsp;&nbsp;</span>}
      {dfm.dxf && <button onClick={() => download(dfm.dxf!, 'flat.dxf', 'application/dxf')} style={{ ...btnGhost, padding: '3px 10px' }}>⭳ DXF</button>}
      <div style={{ marginTop: 4, fontSize: 10, color: '#6e7681' }}>개산(비법정) · 조인트/용접 정량은 다음 단계</div>
    </div>
  );

  // ── 멀티바디 조립체 ──
  if (cad.isAssembly) {
    const nInterf = cad.interferences?.length ?? 0;
    return (
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#e6edf3', marginBottom: 10 }}>{t.cadAssemblyTitle}</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#8b949e', marginBottom: 6 }}>{t.cadParts}</div>
        {specBlock}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {gateBadge}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: nInterf ? 'rgba(239,68,68,0.14)' : 'rgba(34,197,94,0.14)', color: nInterf ? '#f87171' : '#4ade80' }}>
            {nInterf ? `✕ ${t.cadInterf.replace('{n}', String(nInterf))}` : `✓ ${t.cadInterfNone}`}
          </div>
          {tolBadge}
        </div>
        {cad.welds && cad.welds.length > 0 && (
          <div style={{ marginBottom: 12, fontSize: 12, color: '#cbd5e1', background: '#0b1020', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '9px 12px' }}>
            <div style={{ fontWeight: 700, marginBottom: 5 }}>🔩 {t.cadWeld} · {t.cadWeldTotal} ≈ {(cad.weldTotalMm ?? 0).toLocaleString()} mm</div>
            <div style={{ display: 'grid', gap: 2 }}>
              {cad.welds.slice(0, 8).map((w, i) => (
                <div key={i} style={{ fontSize: 11.5, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
                  {String(w.a)}–{String(w.b)}: {Number(w.lengthMm)}mm · 필렛 {Number(w.legMm)}mm · 목 {Number(w.throatMm)}mm · {Number(w.throatAreaMm2).toLocaleString()}mm²
                </div>
              ))}
            </div>
            <div style={{ marginTop: 5, fontSize: 10, color: '#6e7681' }}>전둘레 필렛 개산 · AABB 접촉 기준 · 비법정(정밀은 조인트 선언 후속)</div>
          </div>
        )}
        {scadDetails}
        {err && <div style={{ fontSize: 12, color: '#fca5a5', marginBottom: 8 }}>⚠️ {err}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={openGA} disabled={gaBusy} style={btnPrimary(accent)}>{gaBusy ? '…' : `⤢ ${t.cadOpenGA}`}</button>
          {cad.scad && <button onClick={() => download(cad.scad!, 'assembly.scad')} style={btnGhost}>⭳ {t.cadDownload}</button>}
        </div>
        <p style={{ marginTop: 10, fontSize: 10, color: '#6e7681', lineHeight: 1.5 }}>{t.disclaimer}</p>
      </div>
    );
  }

  // ── 단일부품: STEP 3D (승인 후) ──
  if (stepText) {
    return (
      <div style={card}>
        <ChatCadViewer stepText={stepText} accent={accent} onReady={setGeos} />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button onClick={() => download(stepText, 'model.step', 'application/step')} style={btnPrimary(accent)}>⭳ {t.cadStepDownload}</button>
          {geos && <button onClick={downloadStl} style={btnGhost}>⭳ {t.cadStlDownload}</button>}
          {cad.scad && <button onClick={() => download(cad.scad!, 'model.scad')} style={btnGhost}>⭳ {t.cadDownload}</button>}
          <button onClick={openGA} disabled={gaBusy} style={btnGhost}>{gaBusy ? '…' : `⤢ ${t.cadOpenGA}`}</button>
          <button onClick={runDfm} disabled={dfmBusy} style={btnGhost}>{dfmBusy ? '…' : t.cadDfm}</button>
        </div>
        {dfmBlock}
        {err && <div style={{ fontSize: 12, color: '#fca5a5', marginTop: 8 }}>⚠️ {err}</div>}
      </div>
    );
  }

  // ── 단일부품: 체크포인트(치수 사양 검토 → 승인) ──
  return (
    <div style={card}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#e6edf3', marginBottom: 10 }}>{t.cadSpecTitle}</div>
      {specBlock}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{gateBadge}{tolBadge}</div>
      {scadDetails}
      {err && <div style={{ fontSize: 12, color: '#fca5a5', marginBottom: 10 }}>⚠️ {err}</div>}
      <button onClick={confirmStep} disabled={building} style={{ padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: building ? 'wait' : 'pointer', background: building ? 'rgba(148,163,184,0.4)' : `linear-gradient(135deg, ${accent}, #6366f1)`, color: '#fff', border: 'none' }}>
        {building ? t.cadBuilding : `${t.cadConfirm} →`}
      </button>
      <p style={{ marginTop: 10, fontSize: 10, color: '#6e7681', lineHeight: 1.5 }}>{t.disclaimer}</p>
    </div>
  );
}

// 전기 결선표 카드 (개산) — from-to 케이블 목록. 3D 하네스는 별도 ECAD(정직 표기).
function WiringCard({ wiring, t, accent, isRtl }: { wiring: CableRow[]; t: (typeof DICT)[Lang]; accent: string; isRtl: boolean }) {
  return (
    <div style={{ width: 'min(92%, 540px)', background: '#0d1117', border: `1px solid ${accent}44`, borderRadius: 14, padding: 14, textAlign: isRtl ? 'right' : 'left', boxShadow: '0 6px 24px rgba(0,0,0,0.3)' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#e6edf3', marginBottom: 8 }}>🔌 {t.cadWiringTitle}</div>
      <div style={{ display: 'grid', gap: 4 }}>
        {wiring.map((w, i) => (
          <div key={i} style={{ fontSize: 12, color: '#cbd5e1', padding: '6px 11px', borderRadius: 8, background: '#0b1020', border: '1px solid rgba(255,255,255,0.07)', fontVariantNumeric: 'tabular-nums' }}>
            <b style={{ color: '#e6edf3' }}>{String(w.from ?? '')}</b> → <b style={{ color: '#e6edf3' }}>{String(w.to ?? '')}</b>
            {w.type ? ` · ${String(w.type)}` : ''}{w.cores ? ` ${Number(w.cores)}C` : ''}{w.mm2 ? `×${Number(w.mm2)}㎟` : ''}{Number(w.lengthM) > 0 ? ` · ${Number(w.lengthM)}m` : ''}
            {w.note ? <span style={{ color: '#8b949e' }}> · {String(w.note)}</span> : null}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: '#6e7681', lineHeight: 1.5 }}>{t.cadWiringNote}</div>
    </div>
  );
}

export default function ChatHero({ langCode }: { langCode: string }) {
  const lang = toLang(langCode);
  const t = DICT[lang];
  const isRtl = lang === 'ar';
  const [domain, setDomain] = useState<Domain>('mechanical');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const accent = DOMAIN_ACCENT[domain];
  const started = messages.length > 0;

  // 마지막 assistant 메시지 content 를 갱신 (스트리밍 토큰 누적).
  const updateLastAssistant = (content: string) => setMessages(m => {
    const copy = m.slice();
    for (let i = copy.length - 1; i >= 0; i--) {
      if (copy[i].role === 'assistant') { copy[i] = { ...copy[i], content }; break; }
    }
    return copy;
  });

  const send = useCallback(async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || loading) return;
    setError('');
    const history = messages.slice(-8);
    setMessages(m => [...m, { role: 'user', content: text }]);
    setInput('');
    setLoading(true);
    const autoscroll = () => requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); });
    try {
      if (ACTION_DOMAINS.includes(domain)) {
        // ── 실행형: 의도추출 → (calc면) 라이브 엔진 실행 → 결과카드 ──
        const res = await fetch('/api/eng-chat/action/', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: text, domain, history }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(j?.error || t.error);
          setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${j?.error || t.error}` }]);
        } else if (j.type === 'calc' && j.id) {
          setMessages(m => [...m, { role: 'assistant', content: String(j.reply || t.calcRunning) }]);
          autoscroll();
          try {
            const calc = await runDemoCalc(String(j.id), (j.input ?? {}) as Record<string, unknown>);
            setMessages(m => {
              const copy = m.slice();
              for (let i = copy.length - 1; i >= 0; i--) { if (copy[i].role === 'assistant') { copy[i] = { ...copy[i], calc }; break; } }
              return copy;
            });
          } catch (e) {
            const em = e instanceof Error ? e.message : t.error;
            setMessages(m => {
              const copy = m.slice();
              for (let i = copy.length - 1; i >= 0; i--) { if (copy[i].role === 'assistant') { copy[i] = { ...copy[i], calc: { verdict: 'ERROR', title: String(j.id), checks: [], refs: [], error: em } }; break; } }
              return copy;
            });
          }
        } else if ((j.type === 'scad' || j.type === 'assembly') && j.prompt) {
          // ── 기계: 단일부품(compose→STEP) 또는 멀티바디(assemble→GA) ──
          setMessages(m => [...m, { role: 'assistant', content: String(j.reply || t.cadGenerating), cad: { composing: true } }]);
          autoscroll();
          const setCad = (cad: CadResult) => setMessages(m => {
            const copy = m.slice();
            for (let i = copy.length - 1; i >= 0; i--) { if (copy[i].role === 'assistant') { copy[i] = { ...copy[i], cad }; break; } }
            return copy;
          });
          try {
            setCad(j.type === 'assembly'
              ? await runAssemblePipeline(String(j.prompt))
              : await runComposePipeline(String(j.prompt)));
          } catch (e) {
            setCad({ error: e instanceof Error ? e.message : t.error });
          }
        } else if (j.type === 'wiring' && Array.isArray(j.cables)) {
          // ── 전기 결선표(개산) — from-to 케이블 목록 ──
          setMessages(m => [...m, { role: 'assistant', content: String(j.reply || ''), wiring: j.cables as CableRow[] }]);
        } else {
          setMessages(m => [...m, { role: 'assistant', content: String(j.reply || t.error) }]);
        }
      } else {
      // ── 대화형(기계·인테리어): 스트리밍. 트레일링 슬래시 필수(308 회피) ──
      const res = await fetch('/api/eng-chat/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, domain, history, stream: true }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg = j?.error || t.error;
        setError(msg);
        setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${msg}` }]);
      } else if (res.headers.get('x-stream') === '1' && res.body) {
        // 스트리밍: 빈 assistant 메시지에 토큰을 누적
        setMessages(m => [...m, { role: 'assistant', content: '' }]);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let acc = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          updateLastAssistant(acc);
          autoscroll();
        }
        if (!acc.trim()) { setError(t.error); updateLastAssistant(`⚠️ ${t.error}`); }
      } else {
        // 비스트리밍 JSON 폴백
        const j = await res.json().catch(() => ({}));
        if (!j?.reply) {
          setError(j?.error || t.error);
          setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${j?.error || t.error}` }]);
        } else {
          setMessages(m => [...m, { role: 'assistant', content: String(j.reply) }]);
        }
      }
      }
    } catch {
      setError(t.error);
      setMessages(m => [...m, { role: 'assistant', content: `⚠️ ${t.error}` }]);
    } finally {
      setLoading(false);
      autoscroll();
    }
  }, [input, loading, messages, domain, t.error]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // 도메인별 후속 실동작 (전부 공개 실재 라우트).
  // expert(shape-generator) 직링크는 노출하지 않는다 — 게이트 취지상 사람은 채팅으로만
  // 진입하고 정밀 설계·연산은 AI가 백엔드로 수행. 견적/데모/상담으로만 이어 준다.
  const domainAction = (() => {
    if (domain === 'mechanical') return { label: t.actQuote, href: `/${langCode}/quick-quote/` };
    if (domain === 'interior') return { label: t.actContact, href: `/${langCode}/contact/` };
    return { label: t.actDemo, href: '#eng-demo' };
  })();

  return (
    <section id="nf-chat" dir={isRtl ? 'rtl' : 'ltr'} style={{
      position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(135deg, #0a0f1e 0%, #0d1b3e 45%, #0b1a38 100%)',
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '104px 20px 64px',
    }}>
      <div style={{ position: 'absolute', inset: 0, opacity: 0.06, backgroundImage: 'linear-gradient(rgba(59,130,246,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(59,130,246,0.5) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
      <div style={{ position: 'absolute', top: '12%', left: '50%', transform: 'translateX(-50%)', width: 640, height: 640, background: `radial-gradient(circle, ${accent}22 0%, transparent 70%)`, borderRadius: '50%', filter: 'blur(90px)', transition: 'background .4s' }} />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 780, textAlign: 'center' }}>
        {!started && (
          <>
            {/* 브랜드 락업 — N 모노그램 + 워드마크 */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
              <span style={{
                width: 34, height: 34, borderRadius: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(135deg, #3b82f6, #6366f1)', boxShadow: '0 4px 16px rgba(59,130,246,0.4)',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false"><path d="M5 19V5l14 14V5" /></svg>
              </span>
              <span style={{ fontSize: 19, fontWeight: 800, color: '#f0f4ff', letterSpacing: '-0.02em' }}>NexyFab</span>
            </div>

            <h1 style={{
              fontSize: 'clamp(28px, 4.5vw, 46px)', fontWeight: 900, lineHeight: 1.18,
              color: '#f0f4ff', letterSpacing: '-0.03em', marginBottom: 14, wordBreak: 'keep-all',
            }}>{t.title}</h1>
            <p style={{ fontSize: 'clamp(14px, 2vw, 17px)', lineHeight: 1.7, color: 'rgba(203,213,225,0.82)', maxWidth: 600, margin: '0 auto 18px', wordBreak: 'keep-all' }}>{t.sub}</p>

            {/* 신뢰 한 줄 — 실측 가능한 차별점만 (수치 과장 없음) */}
            <div dir={isRtl ? 'rtl' : 'ltr'} style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 30, padding: '5px 14px',
              borderRadius: 999, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.22)',
              fontSize: 12, fontWeight: 500, color: 'rgba(147,197,253,0.92)', maxWidth: '92%', lineHeight: 1.5,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" style={{ flexShrink: 0 }}><path d="M12 2l7 3v6c0 4.5-3 8.2-7 9.5-4-1.3-7-5-7-9.5V5z" /><path d="M9 12l2 2 4-4" /></svg>
              <span style={{ wordBreak: 'keep-all' }}>{t.trust}</span>
            </div>
          </>
        )}

        {/* 대화 패널 */}
        {started && (
          <div ref={scrollRef} style={{
            textAlign: isRtl ? 'right' : 'left', maxHeight: '46vh', overflowY: 'auto',
            marginBottom: 16, padding: '4px 2px', display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            {messages.map((m, i) => {
              const alignEnd = m.role === 'user' ? !isRtl : isRtl;
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: alignEnd ? 'flex-end' : 'flex-start', gap: 8 }}>
                  {(m.content || m.role === 'user') && (
                    <div style={{
                      maxWidth: '86%', padding: '11px 15px', borderRadius: 14, fontSize: 14, lineHeight: 1.7,
                      whiteSpace: m.role === 'user' ? 'pre-wrap' : 'normal', wordBreak: 'break-word',
                      background: m.role === 'user' ? accent : 'rgba(255,255,255,0.07)',
                      color: m.role === 'user' ? '#fff' : '#e2e8f0',
                      border: m.role === 'user' ? 'none' : '1px solid rgba(255,255,255,0.1)',
                    }}>{m.role === 'assistant' ? <MarkdownLite text={m.content} /> : m.content}</div>
                  )}
                  {m.calc && <CalcCard calc={m.calc} t={t} isRtl={isRtl} />}
                  {m.cad && <CadCard cad={m.cad} t={t} accent={accent} isRtl={isRtl} />}
                  {m.wiring && m.wiring.length > 0 && <WiringCard wiring={m.wiring} t={t} accent={accent} isRtl={isRtl} />}
                </div>
              );
            })}
            {loading && !(messages.length > 0 && messages[messages.length - 1].role === 'assistant' && messages[messages.length - 1].content.length > 0) && (
              <div style={{ display: 'flex', justifyContent: isRtl ? 'flex-end' : 'flex-start' }}>
                <div style={{ padding: '11px 15px', borderRadius: 14, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: '#93c5fd', fontSize: 13 }}>{t.thinking}</div>
              </div>
            )}
          </div>
        )}

        {/* 입력 카드 */}
        <div style={{
          background: 'rgba(255,255,255,0.06)', border: `1px solid ${accent}55`,
          borderRadius: 18, padding: 12, boxShadow: `0 12px 48px rgba(0,0,0,0.4)`,
          backdropFilter: 'blur(8px)', transition: 'border-color .3s',
        }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t.placeholder}
            rows={started ? 2 : 3}
            style={{
              width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent',
              color: '#f0f4ff', fontSize: 15, lineHeight: 1.6, padding: '8px 8px 4px', boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 4px 2px' }}>
            <span style={{ color: accent, display: 'inline-flex' }}><DomainIcon name={domain} size={20} /></span>
            <button onClick={() => send()} disabled={loading || !input.trim()} style={{
              padding: '9px 22px', borderRadius: 12, border: 'none',
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              fontSize: 14, fontWeight: 800, color: '#fff',
              background: loading || !input.trim() ? 'rgba(148,163,184,0.4)' : `linear-gradient(135deg, ${accent}, #6366f1)`,
              transition: 'background .2s',
            }}>{loading ? t.thinking : t.send}</button>
          </div>
        </div>

        {/* 분야 칩 */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 18 }}>
          {DOMAINS.map(d => {
            const on = d === domain;
            const c = DOMAIN_ACCENT[d];
            return (
              <button key={d} onClick={() => setDomain(d)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '8px 16px', borderRadius: 999, cursor: 'pointer',
                fontSize: 13, fontWeight: on ? 800 : 600,
                border: `1.5px solid ${on ? c : 'rgba(255,255,255,0.14)'}`,
                background: on ? `${c}22` : 'rgba(255,255,255,0.04)',
                color: on ? '#fff' : 'rgba(203,213,225,0.85)', transition: 'all .18s',
              }}>
                <span style={{ color: on ? c : 'inherit', display: 'inline-flex' }}><DomainIcon name={d} size={16} /></span>
                {t.chips[d]}
              </button>
            );
          })}
        </div>

        {/* 분야별 시작 예시 (대화 시작 전) */}
        {!started && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
            {SUGGEST[lang][domain].map((s, i) => (
              <button key={i} onClick={() => send(s)} disabled={loading} style={{
                padding: '8px 14px', borderRadius: 12, cursor: loading ? 'wait' : 'pointer',
                fontSize: 12.5, fontWeight: 500, textAlign: isRtl ? 'right' : 'left',
                border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.035)',
                color: 'rgba(203,213,225,0.9)', maxWidth: 340, lineHeight: 1.45, transition: 'all .18s',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = `${accent}1e`; e.currentTarget.style.borderColor = `${accent}55`; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.035)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
              >{s}</button>
            ))}
          </div>
        )}

        {/* 후속 실동작 + 새 대화 */}
        {started && (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
            <Link href={domainAction.href} style={{
              padding: '9px 20px', borderRadius: 11, fontSize: 13, fontWeight: 700, textDecoration: 'none',
              background: accent, color: '#fff',
            }}>{domainAction.label} →</Link>
            <button onClick={() => { setMessages([]); setError(''); }} style={{
              padding: '9px 18px', borderRadius: 11, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: 'rgba(255,255,255,0.06)', color: '#cbd5e1', border: '1px solid rgba(255,255,255,0.14)',
            }}>{t.reset}</button>
          </div>
        )}

        <p style={{ marginTop: 22, fontSize: 11, color: 'rgba(148,163,184,0.72)', lineHeight: 1.6, maxWidth: 560, margin: '22px auto 0', wordBreak: 'keep-all' }}>{t.disclaimer}</p>
      </div>
    </section>
  );
}
