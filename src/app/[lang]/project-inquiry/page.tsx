'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { analytics } from '@/lib/analytics';
import { useToast } from '@/components/ToastProvider';

const dict = {
  ko: {
    title: '프로젝트 문의',
    titleSub: '(Technical & R&D Consultation)',
    heroKicker: 'Nexyfab · Project Inquiry.',
    heroDesc: '개발, 자동화, 플랜트, R&D 등이 필요한<br/>프로젝트에 대해 알려주세요.<br/>아래 정보를 남겨주시면 담당자가 확인 후 연락드립니다.',
    badge1: '필수', badge2: '파일 첨부 가능', badge3: '검토 후 회신',
    anchor: '폼으로 이동 ↓',
    requiredNote: '* 표시는 필수 입력 사항입니다.',
    name: '이름',
    namePl: '성명을 입력해주세요.',
    company: '회사명',
    companyPl: '회사명(기관명)을 입력해주세요.',
    phone: '전화번호',
    phonePl: '전화번호를 입력해주세요.',
    email: '이메일',
    emailPl: '답변 받을 이메일 주소를 입력해주세요.',
    reqField: '요청분야',
    rf1: '제품 개발', rf2: '자동화 설비', rf3: '플랜트', rf4: '첨단 R&D', rf5: '기타',
    scope: '범위',
    sc1: '개발', sc2: '양산/도입', sc3: '기타',
    budget: '예산 범위(선택)',
    budgetPl: '예: 1,000만원 ~ 3,000만원',
    message: '내용',
    messagePl: '예: “자동화 설비 라인 개발 필요”, “휴대용 카메라 시제품 제작 필요” 등',
    attach: '첨부(선택)',
    attachNote: 'PDF/이미지/오피스/ZIP 업로드 가능 (여러 개 선택 가능)',
    checkboxHead: '체크박스',
    agree1: '(필수) 이용약관에 동의합니다.',
    agree2: '(필수) 개인정보 처리방침에 동의합니다.',
    agree3: '(필수) 보안 정책(NDA)에 동의합니다.',
    submit: '제출하기',
    successMsg: '성공적으로 접수되었습니다.',
    errorFailed: '제출에 실패했습니다. 다시 시도하시거나 문의 바랍니다.',
    errorOccurred: '제출 중 오류가 발생했습니다.'
  },
  en: {
    title: 'Project Inquiry',
    titleSub: '(Technical & R&D Consultation)',
    heroKicker: 'Nexyfab · Project Inquiry.',
    heroDesc: 'Please tell us about your project<br/>that requires development, automation, plant, R&D, etc.<br/>Leave the information below and our specialist will contact you after review.',
    badge1: 'Required', badge2: 'Files Allowed', badge3: 'Fast Response',
    anchor: 'Go to form ↓',
    requiredNote: '* indicates a required field.',
    name: 'Name',
    namePl: 'Please enter your name.',
    company: 'Company',
    companyPl: 'Please enter your company name.',
    phone: 'Phone',
    phonePl: 'Please enter a phone number.',
    email: 'Email',
    emailPl: 'Please enter your Email address.',
    reqField: 'Request Field',
    rf1: 'Product Development', rf2: 'Automation Equipment', rf3: 'Plant', rf4: 'Advanced R&D', rf5: 'Other',
    scope: 'Scope',
    sc1: 'Development', sc2: 'Mass Production', sc3: 'Other',
    budget: 'Budget Range (Optional)',
    budgetPl: 'e.g., $10,000 ~ $30,000',
    message: 'Message',
    messagePl: 'e.g., "Need to develop automation equipment line", "Need portable camera prototype", etc.',
    attach: 'Attachment (Optional)',
    attachNote: 'Upload PDF/Image/Office/ZIP (Multiple selections allowed)',
    checkboxHead: 'Agreements',
    agree1: '(Required) I agree to the Terms of Use.',
    agree2: '(Required) I agree to the Privacy Policy.',
    agree3: '(Required) I agree to the Security Policy (NDA).',
    submit: 'Submit',
    successMsg: 'Successfully submitted.',
    errorFailed: 'Failed to submit. Please try again or contact us.',
    errorOccurred: 'An error occurred during submission.'
  },
  ja: {
    title: 'プロジェクトお問い合わせ',
    titleSub: '(Technical & R&D Consultation)',
    heroKicker: 'Nexyfab · Project Inquiry.',
    heroDesc: '開発、自動化、プラント、R&Dなどが必要な<br/>プロジェクトについて教えてください。<br/>以下の情報を残していただければ、担当者が確認後ご連絡いたします。',
    badge1: '必須', badge2: 'ファイル添付可能', badge3: '確認後返信',
    anchor: 'フォームへ移動 ↓',
    requiredNote: '* は必須項目です。',
    name: '氏名',
    namePl: '氏名を入力してください。',
    company: '会社名',
    companyPl: '会社名（機関名）を入力してください。',
    phone: '電話番号',
    phonePl: '電話番号を入力してください。',
    email: 'メール',
    emailPl: '返信用のメールアドレスを入力してください。',
    reqField: '要請分野',
    rf1: '製品開発', rf2: '自動化設備', rf3: 'プラント', rf4: '先端 R&D', rf5: 'その他',
    scope: '範囲',
    sc1: '開発', sc2: '量産/導入', sc3: 'その他',
    budget: '予算範囲（任意）',
    budgetPl: '例: 100万円 〜 300万円',
    message: '内容',
    messagePl: '例:「自動化設備ラインの開発が必要」「携帯カメラの試作品が必要」など',
    attach: '添付ファイル（任意）',
    attachNote: 'PDF/画像/Office/ZIP アップロード可能（複数選択可能）',
    checkboxHead: '同意事項',
    agree1: '（必須）利用規約に同意します。',
    agree2: '（必須）プライバシーポリシーに同意します。',
    agree3: '（必須）セキュリティポリシー(NDA)に同意します。',
    submit: '提出する',
    successMsg: '正常に受け付けられました。',
    errorFailed: '提出に失敗しました。再度お試しいただくか、お問い合わせください。',
    errorOccurred: '提出中にエラーが発生しました。'
  },
  zh: {
    title: '项目咨询',
    titleSub: '(Technical & R&D Consultation)',
    heroKicker: 'Nexyfab · Project Inquiry.',
    heroDesc: '请告诉我们您需要开发、自动化、工厂、研发等方面的项目。<br/>留下以下信息，我们的专员将在审核后与您联系。',
    badge1: '必填', badge2: '可上传文件', badge3: '快速回复',
    anchor: '前往表格 ↓',
    requiredNote: '* 为必填项。',
    name: '姓名',
    namePl: '请输入您的姓名。',
    company: '公司名称',
    companyPl: '请输入公司(机构)名称。',
    phone: '电话号码',
    phonePl: '请输入电话号码。',
    email: '电子邮箱',
    emailPl: '请输入接收回复的电子邮箱。',
    reqField: '需求领域',
    rf1: '产品开发', rf2: '自动化设备', rf3: '工厂', rf4: '尖端研发', rf5: '其他',
    scope: '范围',
    sc1: '开发', sc2: '量产/引入', sc3: '其他',
    budget: '预算范围(选填)',
    budgetPl: '例：10万元 ~ 30万元',
    message: '具体内容',
    messagePl: '例：“需要开发自动化设备流水线”、“需要便携式相机原型”等',
    attach: '附件(选填)',
    attachNote: '可上传 PDF/图片/Office/ZIP（可多选）',
    checkboxHead: '同意事项',
    agree1: '（必填）我同意服务条款。',
    agree2: '（必填）我同意隐私政策。',
    agree3: '（必填）我同意安全政策(NDA)。',
    submit: '提交',
    successMsg: '提交成功。',
    errorFailed: '提交失败，请重试或联系我们。',
    errorOccurred: '提交过程中出现错误。'
  },
  es: {
    title: 'Consulta de Proyecto',
    titleSub: '(Technical & R&D Consultation)',
    heroKicker: 'Nexyfab · Project Inquiry.',
    heroDesc: 'Cuéntenos sobre su proyecto<br/>que requiere desarrollo, automatización, planta, I+D, etc.<br/>Deje la información a continuación y nuestro especialista se pondrá en contacto después de la revisión.',
    badge1: 'Requerido', badge2: 'Archivos permitidos', badge3: 'Respuesta rápida',
    anchor: 'Ir al formulario ↓',
    requiredNote: '* indica un campo obligatorio.',
    name: 'Nombre',
    namePl: 'Ingrese su nombre.',
    company: 'Empresa',
    companyPl: 'Ingrese el nombre de su empresa.',
    phone: 'Teléfono',
    phonePl: 'Ingrese un número de teléfono.',
    email: 'Correo electrónico',
    emailPl: 'Ingrese su dirección de correo electrónico.',
    reqField: 'Campo de solicitud',
    rf1: 'Desarrollo de producto', rf2: 'Equipo de automatización', rf3: 'Planta', rf4: 'I+D avanzado', rf5: 'Otro',
    scope: 'Alcance',
    sc1: 'Desarrollo', sc2: 'Producción en masa', sc3: 'Otro',
    budget: 'Rango de presupuesto (Opcional)',
    budgetPl: 'ej., $10,000 ~ $30,000',
    message: 'Mensaje',
    messagePl: 'ej., "Necesito desarrollar una línea de automatización", "Necesito un prototipo de cámara portátil", etc.',
    attach: 'Adjunto (Opcional)',
    attachNote: 'Suba PDF/Imagen/Office/ZIP (Se permiten múltiples archivos)',
    checkboxHead: 'Acuerdos',
    agree1: '(Requerido) Acepto los Términos de Uso.',
    agree2: '(Requerido) Acepto la Política de Privacidad.',
    agree3: '(Requerido) Acepto la Política de Seguridad (NDA).',
    submit: 'Enviar',
    successMsg: 'Enviado exitosamente.',
    errorFailed: 'Error al enviar. Por favor, inténtelo de nuevo o contáctenos.',
    errorOccurred: 'Ocurrió un error durante el envío.'
  },
  ar: {
    title: 'استفسار عن المشروع',
    titleSub: '(Technical & R&D Consultation)',
    heroKicker: 'Nexyfab · Project Inquiry.',
    heroDesc: 'أخبرنا عن مشروعك<br/>الذي يتطلب التطوير والأتمتة والمصانع والبحث والتطوير وما إلى ذلك.<br/>اترك المعلومات أدناه وسيتواصل معك المختص بعد المراجعة.',
    badge1: 'مطلوب', badge2: 'مرفقات متاحة', badge3: 'رد سريع',
    anchor: 'انتقل إلى النموذج ↓',
    requiredNote: '* يشير إلى حقل مطلوب.',
    name: 'الاسم',
    namePl: 'يرجى إدخال اسمك.',
    company: 'الشركة',
    companyPl: 'يرجى إدخال اسم شركتك.',
    phone: 'الهاتف',
    phonePl: 'يرجى إدخال رقم الهاتف.',
    email: 'البريد الإلكتروني',
    emailPl: 'يرجى إدخال عنوان بريدك الإلكتروني.',
    reqField: 'مجال الطلب',
    rf1: 'تطوير المنتج', rf2: 'معدات الأتمتة', rf3: 'مصنع', rf4: 'بحث وتطوير متقدم', rf5: 'أخرى',
    scope: 'النطاق',
    sc1: 'تطوير', sc2: 'إنتاج ضخم', sc3: 'أخرى',
    budget: 'نطاق الميزانية (اختياري)',
    budgetPl: 'مثال: $10,000 ~ $30,000',
    message: 'الرسالة',
    messagePl: 'مثال: "أحتاج إلى تطوير خط أتمتة"، "أحتاج إلى نموذج أولي لكاميرا محمولة"، إلخ.',
    attach: 'مرفق (اختياري)',
    attachNote: 'تحميل PDF/صور/Office/ZIP (يمكن تحديد ملفات متعددة)',
    checkboxHead: 'الموافقات',
    agree1: '(مطلوب) أوافق على شروط الاستخدام.',
    agree2: '(مطلوب) أوافق على سياسة الخصوصية.',
    agree3: '(مطلوب) أوافق على سياسة الأمان (NDA).',
    submit: 'إرسال',
    successMsg: 'تم الإرسال بنجاح.',
    errorFailed: 'فشل الإرسال. يرجى المحاولة مرة أخرى أو الاتصال بنا.',
    errorOccurred: 'حدث خطأ أثناء الإرسال.'
  }
};

function ProjectInquiryPageInner() {
  const pathname = usePathname();
  const langCode = pathname.split('/')[1] || 'en';
  const lang = ['en', 'kr', 'ja', 'cn', 'es', 'ar'].includes(langCode) ? langCode : 'en';

  const langMap: Record<string, string> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'zh', es: 'es', ar: 'ar' };
  const strLang = langMap[lang] as keyof typeof dict;
  const t = dict[strLang];

  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [simBanner, setSimBanner] = useState('');
  const searchParams = useSearchParams();
  const formRef = useRef<HTMLFormElement>(null);

  // 공장 DB에서 넘어온 경우 자동 pre-fill
  useEffect(() => {
    const from = searchParams.get('from');
    if (from !== 'factory') return;

    const industry  = searchParams.get('industry')     || '';
    const tags      = searchParams.get('tags')         || '';
    const region    = searchParams.get('region')       || '';
    const search    = searchParams.get('search')       || '';
    const field     = searchParams.get('field')        || '';
    const country   = searchParams.get('country')      || 'ko';
    const countryLabel = country === 'cn' ? '중국' : '국내';

    if (formRef.current) {
      const messageArea = formRef.current.querySelector('textarea[name="message"]') as HTMLTextAreaElement | null;
      if (messageArea) {
        const lines = ['[공장 DB 연동 자동 작성]'];
        if (search)   lines.push(`검색어: ${search}`);
        if (field)    lines.push(`업종 필터: ${field}`);
        if (industry) lines.push(`공장 업종: ${industry}`);
        if (region)   lines.push(`지역: ${countryLabel} · ${region}`);
        if (tags)     lines.push(`제품 태그: ${tags}`);
        lines.push('', '추가 요청 사항:');
        messageArea.value = lines.join('\n');
      }
    }

    const bannerParts = [];
    if (search)   bannerParts.push(`검색어 "${search}"`);
    if (field)    bannerParts.push(field);
    if (region)   bannerParts.push(`${countryLabel} · ${region}`);
    setSimBanner(`공장 DB에서 연결되었습니다${bannerParts.length ? ` — ${bannerParts.join(' / ')}` : ''}`);
    setTimeout(() => setSimBanner(''), 10000);
  }, [searchParams]);

  // 시뮬레이터에서 넘어온 경우 자동 pre-fill
  useEffect(() => {
    const from = searchParams.get('from');
    if (from !== 'simulator') return;
    const projectName = searchParams.get('projectName') || '';
    const industry = searchParams.get('industry') || '';
    const location = searchParams.get('location') || '';
    const budget = searchParams.get('budget') || '';
    const volume = searchParams.get('volume') || '';

    if (formRef.current) {
      const budgetInput = formRef.current.querySelector('input[name="budget_range"]') as HTMLInputElement | null;
      const messageArea = formRef.current.querySelector('textarea[name="message"]') as HTMLTextAreaElement | null;
      if (budgetInput && budget) budgetInput.value = `${parseInt(budget, 10).toLocaleString()}원/개 (시뮬레이터 추정)`;
      if (messageArea) {
        const industryLabel: Record<string, string> = { electronics: 'IT/전자', automotive: '자동차부품', machinery: '기계설비', medical: '의료기기', plastic: '사출/주방', food: '식품', beauty: '화장품', semiconductor: '반도체', medical_device: '의료기기(특화)', automotive_tier: '자동차Tier' };
        messageArea.value = `[시뮬레이터 자동 작성]\n프로젝트명: ${projectName}\n업종: ${industryLabel[industry] || industry}\n생산지: ${location}\n예상 물량: ${parseInt(volume, 10).toLocaleString()}개\n예상 도착원가: ${parseInt(budget, 10).toLocaleString()}원/개\n\n추가 요청 사항:`;
      }
    }
    setSimBanner(`NexyFab 시뮬레이터에서 연결되었습니다 — "${projectName}" 프로젝트 예상 원가: ${parseInt(budget, 10).toLocaleString()}원/개`);
    setTimeout(() => setSimBanner(''), 8000);
  }, [searchParams]);

  // Animation logic for reveal classes
  // requestAnimationFrame ensures this runs after hydration is complete,
  // preventing server/client className mismatch on .reveal elements.
  React.useEffect(() => {
    let observer: IntersectionObserver;
    const raf = requestAnimationFrame(() => {
      observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('active');
          } else {
            entry.target.classList.remove('active');
          }
        });
      }, { threshold: 0.1 });
      document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
    });
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    formData.append('lang', lang);

    const form = e.currentTarget;
    try {
      // reCAPTCHA v3
      const token = await new Promise<string>((resolve) => {
        (window as any).grecaptcha.ready(() => {
          (window as any).grecaptcha.execute(process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY!, { action: 'submit' }).then(resolve);
        });
      });
      formData.append('g-recaptcha-response', token);

      const res = await fetch('/api/send-mail', {
        method: 'POST',
        body: formData,
      });

      if (res.ok || res.redirected) {
        analytics.projectInquiry();
        toast('success', t.successMsg);
        form.reset();
      } else {
        toast('error', t.errorFailed);
      }
    } catch (err) {
      console.error(err);
      toast('error', t.errorOccurred);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div id="Nexyfab-inquiry-page">
      <section className="hat-hero hat-hero-inquiry">
        <div className="hat-hero-inner">
          <p className="hat-kicker">{t.heroKicker}</p>
          <h1 className="hat-hero-title">
            {t.title} <span className="hat-hero-sub">{t.titleSub}</span>
          </h1>
          <p className="hat-hero-copy" dangerouslySetInnerHTML={{ __html: t.heroDesc }} />
          <div className="hat-hero-meta">
            <span className="hat-pill"><span className="req">*</span> {t.badge1}</span>
            <span className="hat-pill">{t.badge2}</span>
            <span className="hat-pill">{t.badge3}</span>
          </div>
          <a href="#form" className="hat-anchor">{t.anchor}</a>
        </div>
      </section>

      <section id="form" className="hat-section reveal">
        <div className="hat-wrap hat-wrap-inquiry">
          <div className="hat-form-head">
            <div className="hat-title">
              <div className="ko">{t.title}</div>
            </div>
            <div className="hat-required-note">
              <span className="req">*</span> {t.requiredNote.replace('* ', '')}
            </div>
          </div>

          {/* 시뮬레이터 연결 배너 */}
          {simBanner && (
            <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1.25rem', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '0.75rem', color: '#1e40af', fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>🏭</span>
              <span>{simBanner}</span>
              <button onClick={() => setSimBanner('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>&times;</button>
            </div>
          )}

          <form className="hat-form" ref={formRef} onSubmit={handleSubmit}>
            <input name="action" type="hidden" value="send_project_inquiry" />
            <div style={{ display: "none" }}>
              <label>Website</label>
              <input autoComplete="off" name="website" tabIndex={-1} type="text" value="" readOnly />
            </div>

            <div className="hat-row reveal">
              <div className="hat-label">
                <div className="ko">{t.name} <span className="req">*</span></div>
              </div>
              <div className="hat-field">
                <input className="hat-input" name="name" placeholder={t.namePl} required type="text" />
              </div>
            </div>

            <div className="hat-row reveal">
              <div className="hat-label">
                <div className="ko">{t.company} <span className="req">*</span></div>
              </div>
              <div className="hat-field">
                <input className="hat-input" name="company" placeholder={t.companyPl} required type="text" />
              </div>
            </div>

            <div className="hat-row reveal">
              <div className="hat-label">
                <div className="ko">{t.phone} <span className="req">*</span></div>
              </div>
              <div className="hat-field">
                <input className="hat-input" name="phone" placeholder={t.phonePl} required type="text" />
              </div>
            </div>

            <div className="hat-row reveal">
              <div className="hat-label">
                <div className="ko">{t.email} <span className="req">*</span></div>
              </div>
              <div className="hat-field">
                <input className="hat-input" name="email" placeholder={t.emailPl} required type="email" />
              </div>
            </div>

            <div className="hat-row reveal">
              <div className="hat-label">
                <div className="ko">{t.reqField} <span className="req">*</span></div>
              </div>
              <div className="hat-field">
                <div className="hat-radio-inline hat-radio-wrap">
                  <label><input name="request_field" required type="radio" value={t.rf1} /> {t.rf1}</label>
                  <label><input name="request_field" required type="radio" value={t.rf2} /> {t.rf2}</label>
                  <label><input name="request_field" required type="radio" value={t.rf3} /> {t.rf3}</label>
                  <label><input name="request_field" required type="radio" value={t.rf4} /> {t.rf4}</label>
                  <label><input name="request_field" required type="radio" value={t.rf5} /> {t.rf5}</label>
                </div>
              </div>
            </div>

            <div className="hat-row reveal">
              <div className="hat-label">
                <div className="ko">{t.scope} <span className="req">*</span></div>
              </div>
              <div className="hat-field">
                <div className="hat-radio-inline hat-radio-wrap">
                  <label><input name="scope" required type="radio" value={t.sc1} /> {t.sc1}</label>
                  <label><input name="scope" required type="radio" value={t.sc2} /> {t.sc2}</label>
                  <label><input name="scope" required type="radio" value={t.sc3} /> {t.sc3}</label>
                </div>
              </div>
            </div>

            <div className="hat-row reveal">
              <div className="hat-label">
                <div className="ko">{t.budget}</div>
              </div>
              <div className="hat-field">
                <input className="hat-input" name="budget_range" placeholder={t.budgetPl} type="text" />
              </div>
            </div>

            <div className="hat-row hat-row-textarea">
              <div className="hat-label">
                <div className="ko">{t.message} <span className="req">*</span></div>
              </div>
              <div className="hat-field">
                <textarea className="hat-textarea" name="message" placeholder={t.messagePl} required rows={7}></textarea>
              </div>
            </div>

            <div className="hat-row reveal">
              <div className="hat-label">
                <div className="ko">{t.attach}</div>
              </div>
              <div className="hat-field hat-file-field">
                <input accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip" className="hat-file" multiple name="attachments[]" type="file" />
                <div className="hat-file-note">{t.attachNote}</div>
              </div>
            </div>

            <div className="hat-row hat-row-consent">
              <div className="hat-label">
                <div className="ko">{t.checkboxHead} <span className="req">*</span></div>
              </div>
              <div className="hat-field">
                <label className="hat-check">
                  <input name="agree_terms" required type="checkbox" />
                  <a href={`/${langCode}/terms-of-use`} rel="noopener noreferrer" target="_blank">{t.agree1}</a>
                </label>
                <label className="hat-check">
                  <input name="agree_privacy" required type="checkbox" />
                  <a href={`/${langCode}/privacy-policy`} rel="noopener noreferrer" target="_blank">{t.agree2}</a>
                </label>
                <label className="hat-check">
                  <input name="agree_nda" required type="checkbox" />
                  <a href={`/${langCode}/security-policy`} rel="noopener noreferrer" target="_blank">{t.agree3}</a>
                </label>
              </div>
            </div>

            <div className="hat-actions reveal">
              <button className="hat-btn hat-btn-inquiry" type="submit" disabled={isSubmitting}>
                {isSubmitting ? '...' : t.submit}
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}

export default function ProjectInquiryPage() {
  return (
    <Suspense fallback={null}>
      <ProjectInquiryPageInner />
    </Suspense>
  );
}
