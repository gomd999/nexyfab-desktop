'use client';
/**
 * IntakeWizard.tsx — 아이디어 → IntakeSpec Q&A UI
 *
 * QUESTIONS 트리를 순차 진행하며 사용자 답변을 IntakeSpec 으로 수집.
 * 완료 시 onComplete(spec) 호출.
 */
import React from 'react';
import { usePathname } from 'next/navigation';
import { QUESTIONS, type Question } from './intakeQuestions';
import { EMPTY_SPEC, type IntakeSpec } from './intakeSpec';

const dict = {
  ko: {
    header: '💡 아이디어로 설계',
    qaMode: 'Q&A',
    textMode: '✨ 자유 설명',
    cancelTitle: '취소 (ESC)',
    freeTextTitle: '✨ 만들고 싶은 것을 자유롭게 설명해주세요',
    freeTextSub: 'AI 가 카테고리·기능·환경·재료 등을 자동으로 추출합니다 (검토 후 수정 가능)',
    freeTextPlaceholder: '예: 야외에 설치할 작은 알루미늄 카메라 마운트 브라켓이 필요합니다. 100×80mm 정도이고, M6 볼트 4개로 벽에 고정합니다. 방수가 되어야 하고 검정색 아노다이징 마감입니다. 50개 정도 양산할 예정이고 가격이 가장 중요합니다.',
    minLenError: '4자 이상 입력해주세요',
    requestFailed: (status: number) => `요청 실패 (${status})`,
    networkError: (msg: string) => `네트워크 오류: ${msg}`,
    footerHint: '추출 후 Q&A 마지막 단계에서 검토·수정 가능',
    parsing: '⏳ AI 분석 중...',
    autoFill: '✨ AI 로 자동 채우기 →',
    prev: '← 이전',
    skip: '건너뛰기',
    finalize: '✨ 설계 생성 →',
    next: '다음 →',
    widthLabel: '폭 (W)',
    heightLabel: '높이 (H)',
    depthLabel: '깊이 (D)',
    textPlaceholder: '예: 알루미늄으로 가벼웠으면 좋겠고, 검정색 아노다이징 처리해주세요...',
    examples: [
      '🔩 알루미늄 L 브라켓, 50×50mm, M5 볼트 2개, 10개 시제품',
      '📦 방수 IP65 전자 케이스, 200×150×60mm, 100개 양산',
      '⚙ 모터 축 커플링, 외경 30mm, 6mm 보어, 빠른 납기',
    ],
  },
  en: {
    header: '💡 Design from Idea',
    qaMode: 'Q&A',
    textMode: '✨ Free Description',
    cancelTitle: 'Cancel (ESC)',
    freeTextTitle: '✨ Describe what you want to make',
    freeTextSub: 'AI auto-extracts category, function, environment, material (review & edit after)',
    freeTextPlaceholder: 'e.g., I need a small aluminum camera mount bracket for outdoor use. Around 100×80mm, fixed to a wall with four M6 bolts. Must be waterproof with black anodized finish. Planning 50 units, cost is critical.',
    minLenError: 'Please enter at least 4 characters',
    requestFailed: (status: number) => `Request failed (${status})`,
    networkError: (msg: string) => `Network error: ${msg}`,
    footerHint: 'After extraction, review & edit in the final Q&A step',
    parsing: '⏳ AI analyzing...',
    autoFill: '✨ Auto-fill with AI →',
    prev: '← Back',
    skip: 'Skip',
    finalize: '✨ Generate Design →',
    next: 'Next →',
    widthLabel: 'Width (W)',
    heightLabel: 'Height (H)',
    depthLabel: 'Depth (D)',
    textPlaceholder: 'e.g., Should be lightweight aluminum with black anodized finish...',
    examples: [
      '🔩 Aluminum L-bracket, 50×50mm, 2 M5 bolts, 10 prototypes',
      '📦 Waterproof IP65 enclosure, 200×150×60mm, 100 units',
      '⚙ Motor shaft coupling, OD 30mm, 6mm bore, fast lead time',
    ],
  },
  ja: {
    header: '💡 アイデアから設計',
    qaMode: 'Q&A',
    textMode: '✨ 自由記述',
    cancelTitle: 'キャンセル (ESC)',
    freeTextTitle: '✨ 作りたいものを自由に説明してください',
    freeTextSub: 'AIがカテゴリ・機能・環境・材料などを自動抽出します (確認後に修正可能)',
    freeTextPlaceholder: '例: 屋外に設置する小さなアルミ製カメラマウントブラケットが必要です。約100×80mm、M6ボルト4本で壁に固定。防水で黒アノダイズ仕上げ。50個量産予定、コスト最優先。',
    minLenError: '4文字以上入力してください',
    requestFailed: (status: number) => `リクエスト失敗 (${status})`,
    networkError: (msg: string) => `ネットワークエラー: ${msg}`,
    footerHint: '抽出後、Q&A最終ステップで確認・修正できます',
    parsing: '⏳ AI解析中...',
    autoFill: '✨ AIで自動入力 →',
    prev: '← 戻る',
    skip: 'スキップ',
    finalize: '✨ 設計生成 →',
    next: '次へ →',
    widthLabel: '幅 (W)',
    heightLabel: '高さ (H)',
    depthLabel: '奥行 (D)',
    textPlaceholder: '例: 軽量なアルミで、黒アノダイズ仕上げにしてください...',
    examples: [
      '🔩 アルミLブラケット、50×50mm、M5ボルト2本、試作10個',
      '📦 防水IP65電子ケース、200×150×60mm、量産100個',
      '⚙ モーター軸カップリング、外径30mm、ボア6mm、短納期',
    ],
  },
  zh: {
    header: '💡 从创意设计',
    qaMode: 'Q&A',
    textMode: '✨ 自由描述',
    cancelTitle: '取消 (ESC)',
    freeTextTitle: '✨ 请自由描述您想制作的东西',
    freeTextSub: 'AI 自动提取类别、功能、环境、材料等 (可在之后审查并修改)',
    freeTextPlaceholder: '例如:我需要一个用于户外的小型铝制相机支架。约 100×80mm,用 4 个 M6 螺栓固定在墙上。需防水,黑色阳极氧化表面。计划量产 50 个,成本是关键。',
    minLenError: '请输入至少 4 个字符',
    requestFailed: (status: number) => `请求失败 (${status})`,
    networkError: (msg: string) => `网络错误:${msg}`,
    footerHint: '提取后,在 Q&A 最后一步审查并修改',
    parsing: '⏳ AI 分析中...',
    autoFill: '✨ 使用 AI 自动填充 →',
    prev: '← 上一步',
    skip: '跳过',
    finalize: '✨ 生成设计 →',
    next: '下一步 →',
    widthLabel: '宽度 (W)',
    heightLabel: '高度 (H)',
    depthLabel: '深度 (D)',
    textPlaceholder: '例如:希望采用轻质铝材,黑色阳极氧化处理...',
    examples: [
      '🔩 铝 L 型支架,50×50mm,2 颗 M5 螺栓,10 件样品',
      '📦 防水 IP65 电子外壳,200×150×60mm,量产 100 件',
      '⚙ 电机轴联轴器,外径 30mm,内孔 6mm,快速交期',
    ],
  },
  es: {
    header: '💡 Diseñar desde Idea',
    qaMode: 'Q&A',
    textMode: '✨ Descripción Libre',
    cancelTitle: 'Cancelar (ESC)',
    freeTextTitle: '✨ Describe lo que quieres hacer',
    freeTextSub: 'La IA extrae automáticamente categoría, función, entorno, material (revisa y edita después)',
    freeTextPlaceholder: 'p. ej., Necesito un soporte de cámara de aluminio pequeño para exteriores. Aproximadamente 100×80mm, fijado con 4 tornillos M6. Debe ser impermeable con acabado anodizado negro. Planeo 50 unidades, el costo es crítico.',
    minLenError: 'Por favor ingrese al menos 4 caracteres',
    requestFailed: (status: number) => `Solicitud fallida (${status})`,
    networkError: (msg: string) => `Error de red: ${msg}`,
    footerHint: 'Tras la extracción, revise y edite en el último paso Q&A',
    parsing: '⏳ IA analizando...',
    autoFill: '✨ Autocompletar con IA →',
    prev: '← Atrás',
    skip: 'Omitir',
    finalize: '✨ Generar Diseño →',
    next: 'Siguiente →',
    widthLabel: 'Ancho (W)',
    heightLabel: 'Alto (H)',
    depthLabel: 'Profundidad (D)',
    textPlaceholder: 'p. ej., Debe ser aluminio ligero con acabado anodizado negro...',
    examples: [
      '🔩 Soporte L de aluminio, 50×50mm, 2 pernos M5, 10 prototipos',
      '📦 Caja IP65 impermeable, 200×150×60mm, 100 unidades',
      '⚙ Acoplamiento de eje motor, OD 30mm, calibre 6mm, entrega rápida',
    ],
  },
  ar: {
    header: '💡 التصميم من فكرة',
    qaMode: 'Q&A',
    textMode: '✨ وصف حر',
    cancelTitle: 'إلغاء (ESC)',
    freeTextTitle: '✨ صف ما تريد صنعه',
    freeTextSub: 'يستخرج الذكاء الاصطناعي تلقائيًا الفئة والوظيفة والبيئة والمواد (يمكن المراجعة والتعديل لاحقًا)',
    freeTextPlaceholder: 'مثال: أحتاج إلى حامل كاميرا صغير من الألومنيوم للاستخدام الخارجي. حوالي 100×80 مم، مثبت بأربعة براغي M6. يجب أن يكون مقاومًا للماء وبلمسة نهائية سوداء مؤكسدة. تخطيط 50 وحدة، التكلفة حاسمة.',
    minLenError: 'يرجى إدخال 4 أحرف على الأقل',
    requestFailed: (status: number) => `فشل الطلب (${status})`,
    networkError: (msg: string) => `خطأ في الشبكة: ${msg}`,
    footerHint: 'بعد الاستخراج، راجع وعدّل في خطوة Q&A النهائية',
    parsing: '⏳ جاري تحليل AI...',
    autoFill: '✨ تعبئة تلقائية بالذكاء الاصطناعي →',
    prev: '← السابق',
    skip: 'تخطي',
    finalize: '✨ إنشاء التصميم →',
    next: 'التالي →',
    widthLabel: 'العرض (W)',
    heightLabel: 'الارتفاع (H)',
    depthLabel: 'العمق (D)',
    textPlaceholder: 'مثال: ألومنيوم خفيف الوزن مع لمسة نهائية سوداء مؤكسدة...',
    examples: [
      '🔩 حامل L من الألومنيوم، 50×50 مم، 2 براغي M5، 10 نماذج أولية',
      '📦 صندوق إلكتروني IP65 مقاوم للماء، 200×150×60 مم، 100 وحدة',
      '⚙ قارنة عمود المحرك، القطر الخارجي 30 مم، التجويف 6 مم، مهلة سريعة',
    ],
  },
};

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

interface Props {
  onComplete: (spec: IntakeSpec) => void;
  onCancel: () => void;
  initialSpec?: Partial<IntakeSpec>;
}

export default function IntakeWizard({ onComplete, onCancel, initialSpec }: Props) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const t = dict[langMap[seg] ?? 'en'];

  const [spec, setSpec] = React.useState<IntakeSpec>({ ...EMPTY_SPEC, ...initialSpec } as IntakeSpec);
  const [idx, setIdx] = React.useState(0);

  // ── 자유 텍스트 빠른 입력 모드 ──
  const [mode, setMode] = React.useState<'qa' | 'text'>('qa');
  const [freeText, setFreeText] = React.useState('');
  const [parsing, setParsing] = React.useState(false);
  const [parseError, setParseError] = React.useState<string | null>(null);

  const submitFreeText = async () => {
    if (freeText.trim().length < 4) {
      setParseError(t.minLenError);
      return;
    }
    setParsing(true);
    setParseError(null);
    try {
      const res = await fetch('/api/nexyfab/intake-from-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: freeText.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setParseError(data.error ?? t.requestFailed(res.status));
        return;
      }
      // 추출된 spec 으로 wizard 채워넣고 마지막 단계로 점프 (사용자 검토용)
      setSpec(data.spec);
      setMode('qa');
      // 마지막 질문(notes) 으로 — 사용자가 1-2번 다음만 누르면 완료
      setIdx(Math.max(0, QUESTIONS.length - 2));
    } catch (e: any) {
      setParseError(t.networkError(e?.message ?? String(e)));
    } finally {
      setParsing(false);
    }
  };

  // skipIf 필터 적용한 실제 질문 순서
  const activeQuestions = React.useMemo<Question[]>(
    () => QUESTIONS.filter((q) => !q.skipIf || !q.skipIf(spec)),
    [spec]
  );
  const safeIdx = Math.min(idx, activeQuestions.length - 1);
  const q = activeQuestions[safeIdx];
  const isLast = safeIdx >= activeQuestions.length - 1;
  const progress = Math.round(((safeIdx + 1) / activeQuestions.length) * 100);

  const current = (spec as any)[q.field];

  const canProceed = React.useMemo(() => {
    if (q.optional) return true;
    if (q.type === 'single') return !!current;
    if (q.type === 'multi') return Array.isArray(current) && current.length > 0;
    if (q.type === 'dimensions') return true; // 선택
    if (q.type === 'text') return true; // 선택
    return true;
  }, [q, current]);

  const update = (field: string, value: any) => {
    setSpec((prev) => ({ ...prev, [field]: value }));
  };

  const next = () => {
    if (isLast) onComplete(spec);
    else setIdx((i) => i + 1);
  };
  const prev = () => setIdx((i) => Math.max(0, i - 1));

  // ESC 로 취소
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      // Enter 는 textarea/input 안에서는 자체 동작에 양보
      if (e.key === 'Enter' && canProceed && mode === 'qa') {
        const tgt = e.target as HTMLElement | null;
        const tag = tgt?.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT') return;
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canProceed, isLast, spec, mode]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(6px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 720,
          maxHeight: '90vh',
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header — Progress + 모드 토글 */}
        <div style={{ padding: '14px 24px', borderBottom: '1px solid #1e293b' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 10,
              gap: 10,
            }}
          >
            <div style={{ fontSize: 13, color: '#94a3b8', flexShrink: 0 }}>
              {t.header} {mode === 'qa' && `· ${safeIdx + 1} / ${activeQuestions.length}`}
            </div>

            {/* 모드 토글 */}
            <div style={{ display: 'flex', gap: 0, background: '#1e293b', borderRadius: 6, padding: 2 }}>
              <button
                onClick={() => setMode('qa')}
                style={{
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 4,
                  border: 'none',
                  background: mode === 'qa' ? '#22d3ee' : 'transparent',
                  color: mode === 'qa' ? '#0f172a' : '#94a3b8',
                  cursor: 'pointer',
                }}
              >
                {t.qaMode}
              </button>
              <button
                onClick={() => setMode('text')}
                style={{
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 4,
                  border: 'none',
                  background: mode === 'text' ? '#22d3ee' : 'transparent',
                  color: mode === 'text' ? '#0f172a' : '#94a3b8',
                  cursor: 'pointer',
                }}
              >
                {t.textMode}
              </button>
            </div>

            <button
              onClick={onCancel}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                fontSize: 20,
                cursor: 'pointer',
                padding: 4,
                lineHeight: 1,
              }}
              title={t.cancelTitle}
            >
              ×
            </button>
          </div>
          {/* Progress bar (Q&A 모드에서만) */}
          {mode === 'qa' && (
            <div
              style={{
                height: 4,
                background: '#1e293b',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #0ea5e9, #22d3ee)',
                  transition: 'width 0.25s ease',
                }}
              />
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 24px 16px' }}>
          {mode === 'text' ? (
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 600, color: '#f1f5f9', margin: '0 0 8px' }}>
                {t.freeTextTitle}
              </h2>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px' }}>
                {t.freeTextSub}
              </p>
              <textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                placeholder={t.freeTextPlaceholder}
                rows={9}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: 10,
                  border: '1px solid #334155',
                  background: '#1e293b',
                  color: '#f1f5f9',
                  fontSize: 14,
                  outline: 'none',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  lineHeight: 1.6,
                }}
              />
              {parseError && (
                <div style={{
                  marginTop: 10,
                  padding: '8px 12px',
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid #ef4444',
                  borderRadius: 6,
                  color: '#fca5a5',
                  fontSize: 12,
                }}>
                  ⚠ {parseError}
                </div>
              )}
              <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {t.examples.map((eg, i) => (
                  <button
                    key={i}
                    onClick={() => setFreeText(eg.replace(/^\S+\s/, ''))}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 12,
                      border: '1px solid #334155',
                      background: 'transparent',
                      color: '#94a3b8',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    {eg}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: '#f1f5f9',
              margin: '0 0 8px',
              lineHeight: 1.4,
            }}
          >
            {q.title}
          </h2>
          {q.subtitle && (
            <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 20px' }}>{q.subtitle}</p>
          )}

          {q.type === 'single' && q.options && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
              {q.options.map((opt) => {
                const selected = current === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => update(q.field, opt.value)}
                    style={{
                      textAlign: 'left',
                      padding: '14px 16px',
                      borderRadius: 10,
                      border: selected ? '2px solid #22d3ee' : '1px solid #334155',
                      background: selected ? 'rgba(34,211,238,0.1)' : '#1e293b',
                      color: '#f1f5f9',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                    }}
                  >
                    {opt.icon && <span style={{ fontSize: 22, lineHeight: 1 }}>{opt.icon}</span>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{opt.label}</div>
                      {opt.description && (
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                          {opt.description}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {q.type === 'multi' && q.options && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
              {q.options.map((opt) => {
                const arr = Array.isArray(current) ? current : [];
                const selected = arr.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => {
                      const next = selected
                        ? arr.filter((v: any) => v !== opt.value)
                        : [...arr, opt.value];
                      update(q.field, next);
                    }}
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      borderRadius: 8,
                      border: selected ? '2px solid #22d3ee' : '1px solid #334155',
                      background: selected ? 'rgba(34,211,238,0.1)' : '#1e293b',
                      color: '#f1f5f9',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 13,
                    }}
                  >
                    <span
                      style={{
                        width: 16,
                        height: 16,
                        borderRadius: 4,
                        border: '1px solid #475569',
                        background: selected ? '#22d3ee' : 'transparent',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#0f172a',
                        fontSize: 12,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {selected ? '✓' : ''}
                    </span>
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {q.type === 'dimensions' && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              {(['w', 'h', 'd'] as const).map((axis) => (
                <div key={axis} style={{ flex: 1 }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: 12,
                      color: '#94a3b8',
                      marginBottom: 6,
                      textTransform: 'uppercase',
                    }}
                  >
                    {axis === 'w' ? t.widthLabel : axis === 'h' ? t.heightLabel : t.depthLabel}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="number"
                      value={current?.[axis] ?? ''}
                      placeholder="—"
                      onChange={(e) => {
                        const v = e.target.value === '' ? undefined : Number(e.target.value);
                        const prev = current ?? {};
                        update(q.field, { ...prev, [axis]: v });
                      }}
                      style={{
                        flex: 1,
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid #334155',
                        background: '#1e293b',
                        color: '#f1f5f9',
                        fontSize: 15,
                        outline: 'none',
                      }}
                    />
                    <span style={{ marginLeft: 6, fontSize: 12, color: '#64748b' }}>mm</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {q.type === 'text' && (
            <textarea
              value={current ?? ''}
              onChange={(e) => update(q.field, e.target.value)}
              placeholder={t.textPlaceholder}
              rows={5}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#1e293b',
                color: '#f1f5f9',
                fontSize: 14,
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          )}
            </>
          )}
        </div>

        {/* Footer — Nav */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid #1e293b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          {mode === 'text' ? (
            <>
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {t.footerHint}
              </div>
              <button
                onClick={submitFreeText}
                disabled={parsing || freeText.trim().length < 4}
                style={{
                  padding: '10px 22px',
                  borderRadius: 8,
                  border: 'none',
                  background:
                    parsing || freeText.trim().length < 4
                      ? '#334155'
                      : 'linear-gradient(135deg, #f59e0b, #ec4899)',
                  color: '#fff',
                  cursor: parsing || freeText.trim().length < 4 ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {parsing ? t.parsing : t.autoFill}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={prev}
                disabled={safeIdx === 0}
                style={{
                  padding: '10px 18px',
                  borderRadius: 8,
                  border: '1px solid #334155',
                  background: 'transparent',
                  color: safeIdx === 0 ? '#475569' : '#cbd5e1',
                  cursor: safeIdx === 0 ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                }}
              >
                {t.prev}
              </button>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {q.optional && (
                  <button
                    onClick={next}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'transparent',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    {t.skip}
                  </button>
                )}
                <button
                  onClick={next}
                  disabled={!canProceed}
                  style={{
                    padding: '10px 22px',
                    borderRadius: 8,
                    border: 'none',
                    background: canProceed
                      ? 'linear-gradient(135deg, #0ea5e9, #22d3ee)'
                      : '#334155',
                    color: '#fff',
                    cursor: canProceed ? 'pointer' : 'not-allowed',
                    fontSize: 14,
                    fontWeight: 600,
                    transition: 'all 0.15s',
                  }}
                >
                  {isLast ? t.finalize : t.next}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
