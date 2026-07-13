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
import { DomainIcon } from './_domainIcons';

type Domain = 'mechanical' | 'civil' | 'architecture' | 'landscape' | 'interior';
type Msg = { role: 'user' | 'assistant'; content: string };

const DOMAINS: Domain[] = ['mechanical', 'civil', 'architecture', 'landscape', 'interior'];
const DOMAIN_ACCENT: Record<Domain, string> = {
  mechanical: '#3b82f6', civil: '#8b5cf6', architecture: '#f59e0b', landscape: '#22c55e', interior: '#ec4899',
};

type Lang = 'kr' | 'en' | 'ja' | 'cn' | 'es' | 'ar';
const toLang = (l: string): Lang => (['kr', 'en', 'ja', 'cn', 'es', 'ar'].includes(l) ? (l as Lang) : 'en');

const DICT: Record<Lang, {
  title: string; sub: string; placeholder: string; send: string; thinking: string;
  disclaimer: string; error: string; reset: string; trust: string;
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
      // 트레일링 슬래시 포함 — trailingSlash:true 라 '/api/eng-chat' 는 308 로
      // 리다이렉트되어 스트리밍 응답이 깨질 수 있음. 곧바로 정경로로 POST.
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
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? (isRtl ? 'flex-start' : 'flex-end') : (isRtl ? 'flex-end' : 'flex-start') }}>
                <div style={{
                  maxWidth: '86%', padding: '11px 15px', borderRadius: 14, fontSize: 14, lineHeight: 1.7,
                  whiteSpace: m.role === 'user' ? 'pre-wrap' : 'normal', wordBreak: 'break-word',
                  background: m.role === 'user' ? accent : 'rgba(255,255,255,0.07)',
                  color: m.role === 'user' ? '#fff' : '#e2e8f0',
                  border: m.role === 'user' ? 'none' : '1px solid rgba(255,255,255,0.1)',
                }}>{m.role === 'assistant' ? <MarkdownLite text={m.content} /> : m.content}</div>
              </div>
            ))}
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
