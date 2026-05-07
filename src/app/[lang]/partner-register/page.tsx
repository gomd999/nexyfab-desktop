'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import { analytics } from '@/lib/analytics';
import { useToast } from '@/components/ToastProvider';
import { richText } from '@/lib/richText';

const dict = {
  ko: {
    title: '파트너 등록',
    titleSub: '(Business Partnership Application)',
    heroKicker: 'Nexyfab · Partners.',
    heroDesc: '제조·자동화, 플랜트, R&D 등<br/>프로젝트 파트너를 찾고 있습니다.<br/>아래 정보를 남겨주시면 검토 후 연락드리겠습니다.',
    badge1: '필수 입력', badge2: '첨부파일 가능', badge3: '확인 후 회신',
    anchor: '등록 폼으로 이동 ↓',
    requiredNote: '* 표시는 필수 입력 사항입니다.',
    partnerTypeHead: '기업/프리랜서',
    pt1: '기업', pt2: '프리랜서',
    matchFieldHead: '매칭분야',
    mf1: '제품 개발', mf2: '자동화 설비', mf3: '플랜트', mf4: '첨단 R&D', mf5: '기타',
    mfPl: '상세 내용을 입력해주세요.',
    name: '이름',
    namePl: '성명을 입력해주세요.',
    company: '회사명',
    companyPl: '회사명(기관명)을 입력해주세요.',
    phone: '전화번호',
    phonePl: '전화번호를 입력해주세요.',
    email: '이메일',
    emailPl: '답변 받을 이메일 주소를 입력해주세요.',
    refFile: '레퍼런스 첨부(선택)',
    refNote: 'PDF/이미지/오피스/ZIP 파일 업로드 가능 (여러 개 선택 가능)',
    techExp: '기술/경험',
    techPl: '예: 자동화 설비 라인 구축, 로봇 티칭, PCB·MCU 개발, 배터리 팩 설계 등',
    refCount: '레퍼런스(건수)',
    refCountPl: '지금까지 수행한 프로젝트 전체 건수 (공동/사내 포함)',
    amount: '누적 금액',
    amountPl: '대략적인 규모 (예: 1억원)',
    checkboxHead: '체크박스',
    agree1: '(필수) 이용약관에 동의합니다.',
    agree2: '(필수) 개인정보 처리방침에 동의합니다.',
    agree3: '(필수) 보안 정책(NDA)에 동의합니다.',
    submit: '등록하기',
    successMsg: '성공적으로 접수되었습니다.',
    errorFailed: '제출에 실패했습니다. 다시 시도하시거나 문의 바랍니다.',
    errorOccurred: '제출 중 오류가 발생했습니다.'
  },
  en: {
    title: 'Partner Registration',
    titleSub: '(Business Partnership Application)',
    heroKicker: 'Nexyfab · Partners.',
    heroDesc: 'We are looking for project partners<br/>in manufacturing, automation, plant, R&D, etc.<br/>Please leave the information below and we will contact you after review.',
    badge1: 'Required', badge2: 'Files Allowed', badge3: 'Fast Response',
    anchor: 'Go to form ↓',
    requiredNote: '* indicates a required field.',
    partnerTypeHead: 'Company/Freelancer',
    pt1: 'Company', pt2: 'Freelancer',
    matchFieldHead: 'Matching Field',
    mf1: 'Product Dev', mf2: 'Automation', mf3: 'Plant', mf4: 'Advanced R&D', mf5: 'Other',
    mfPl: 'Specify details',
    name: 'Name',
    namePl: 'Please enter your name.',
    company: 'Company',
    companyPl: 'Please enter your company name.',
    phone: 'Phone',
    phonePl: 'Please enter a phone number.',
    email: 'Email',
    emailPl: 'Please enter your Email address.',
    refFile: 'Reference Attach (Optional)',
    refNote: 'Upload PDF/Image/Office/ZIP (Multiple selections allowed)',
    techExp: 'Tech/Experience',
    techPl: 'e.g., Automation line setup, Robot teaching, PCB/MCU dev, Battery pack design.',
    refCount: 'Reference Count',
    refCountPl: 'Total number of projects (including joint/in-house)',
    amount: 'Total Amount',
    amountPl: 'Approx. size (e.g., $100k)',
    checkboxHead: 'Agreements',
    agree1: '(Required) I agree to the Terms of Use.',
    agree2: '(Required) I agree to the Privacy Policy.',
    agree3: '(Required) I agree to the Security Policy (NDA).',
    submit: 'Register',
    successMsg: 'Successfully registered.',
    errorFailed: 'Failed to submit. Please try again or contact us.',
    errorOccurred: 'An error occurred during submission.'
  },
  ja: {
    title: 'パートナー登録',
    titleSub: '(Business Partnership Application)',
    heroKicker: 'Nexyfab · Partners.',
    heroDesc: '製造・自動化、プラント、R&Dなどの<br/>プロジェクトパートナーを探しています。<br/>以下の情報を残していただければ、検討後ご連絡いたします。',
    badge1: '必須項目', badge2: 'ファイル添付可能', badge3: '確認後返信',
    anchor: 'フォームへ移動 ↓',
    requiredNote: '* は必須項目です。',
    partnerTypeHead: '企業/フリーランス',
    pt1: '企業', pt2: 'フリーランス',
    matchFieldHead: 'マッチング分野',
    mf1: '製品開発', mf2: '自動化設備', mf3: 'プラント', mf4: '先端 R&D', mf5: 'その他',
    mfPl: '詳細を入力してください。',
    name: '氏名',
    namePl: '氏名を入力してください。',
    company: '会社名',
    companyPl: '会社名（機関名）を入力してください。',
    phone: '電話番号',
    phonePl: '電話番号を入力してください。',
    email: 'メール',
    emailPl: '返信用のメールアドレスを入力してください。',
    refFile: 'レファレンス添付（任意）',
    refNote: 'PDF/画像/Office/ZIP アップロード可能（複数選択可能）',
    techExp: '技術/経験',
    techPl: '例: 自動化ライン構築、ロボットティーチング、PCB・MCU開発など',
    refCount: 'レファレンス件数',
    refCountPl: 'これまでに実行したプロジェクトの総件数',
    amount: '累積金額',
    amountPl: 'おおよその規模 (例: 1,000万円)',
    checkboxHead: '同意事項',
    agree1: '（必須）利用規約に同意します。',
    agree2: '（必須）プライバシーポリシーに同意します。',
    agree3: '（必須）セキュリティポリシー(NDA)に同意します。',
    submit: '登録する',
    successMsg: '正常に受け付けられました。',
    errorFailed: '提出に失敗しました。再度お試しいただくか、お問い合わせください。',
    errorOccurred: '提出中にエラーが発生しました。'
  },
  zh: {
    title: '合作伙伴注册',
    titleSub: '(Business Partnership Application)',
    heroKicker: 'Nexyfab · Partners.',
    heroDesc: '我们正在寻找制造、自动化、工厂、研发等方面的项目合作伙伴。<br/>留下以下信息，我们将在审核后与您联系。',
    badge1: '必填项目', badge2: '可上传文件', badge3: '审核后回复',
    anchor: '前往表格 ↓',
    requiredNote: '* 为必填项。',
    partnerTypeHead: '企业/自由职业者',
    pt1: '企业', pt2: '自由职业者',
    matchFieldHead: '匹配领域',
    mf1: '产品开发', mf2: '自动化设备', mf3: '工厂', mf4: '尖端研发', mf5: '其他',
    mfPl: '请输入详细内容',
    name: '姓名',
    namePl: '请输入您的姓名。',
    company: '公司名称',
    companyPl: '请输入公司(机构)名称。',
    phone: '电话号码',
    phonePl: '请输入电话号码。',
    email: '电子邮箱',
    emailPl: '请输入接收回复的电子邮箱。',
    refFile: '上传成功案例(选填)',
    refNote: '可上传 PDF/图片/Office/ZIP（可多选）',
    techExp: '技术/经验',
    techPl: '例：自动化线搭建，机器人示教，PCB/MCU 开发，电池包设计等',
    refCount: '案例数量',
    refCountPl: '迄今执行的中项目总数',
    amount: '累计金额',
    amountPl: '大概规模 (例：100万)',
    checkboxHead: '同意事项',
    agree1: '（必填）我同意服务条款。',
    agree2: '（必填）我同意隐私政策。',
    agree3: '（必填）我同意安全政策(NDA)。',
    submit: '注册',
    successMsg: '注册成功。',
    errorFailed: '提交失败，请重试或联系我们。',
    errorOccurred: '提交过程中出现错误。'
  }
};

export default function PartnerRegisterPage() {
  const pathname = usePathname();
  const langCode = pathname.split('/')[1] || 'en';
  const lang = ['en', 'kr', 'ja', 'cn'].includes(langCode) ? langCode : 'en';

  const langMap: Record<string, string> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'zh', es: 'en', ar: 'en' };
  const strLang = langMap[lang] as keyof typeof dict;
  const t = dict[strLang];

  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedMatchField, setSelectedMatchField] = useState('');

  // Animation logic for reveal classes
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
    return () => { cancelAnimationFrame(raf); observer?.disconnect(); };
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);
    formData.append('lang', lang);
    // Explicitly add 'field' instead of 'match_field' as expected by the PHP backend handling
    let mfValue = formData.get('match_field') as string;
    const customMfValue = formData.get('match_field_custom') as string;

    if (mfValue === t.mf5 && customMfValue) {
      mfValue = customMfValue;
    }

    if (mfValue) {
      formData.set('field', mfValue);
    }

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
        analytics.partnerRegister();
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
    <div id="Nexyfab-partner-register">
      <section className="hat-hero hat-hero-partner">
        <div className="hat-hero-inner">
          <p className="hat-kicker">{t.heroKicker}</p>
          <h1 className="hat-hero-title">
            {t.title} <span className="hat-hero-sub">{t.titleSub}</span>
          </h1>
          <p className="hat-hero-copy">{richText(t.heroDesc)}</p>
          <div className="hat-hero-meta">
            <span className="hat-pill"><span className="req">*</span> {t.badge1}</span>
            <span className="hat-pill">{t.badge2}</span>
            <span className="hat-pill">{t.badge3}</span>
          </div>
          <a href="#form" className="hat-anchor">{t.anchor}</a>
        </div>
      </section>

      <section id="form" className="hat-section reveal">
        <div className="hat-wrap">
          <div className="hat-form-head">
            <div className="hat-title">
              <div className="ko">{t.title}</div>
            </div>
            <div className="hat-required-note">
              <span className="req">*</span> {t.requiredNote.replace('* ', '')}
            </div>
          </div>

          <form className="hat-form" onSubmit={handleSubmit}>
            <input name="action" type="hidden" value="send_partner_register" />
            <div style={{ display: "none" }}>
              <label>Website</label>
              <input autoComplete="off" name="website" tabIndex={-1} type="text" value="" readOnly />
            </div>

            <div className="hat-row reveal">
              <div className="hat-label">
                <div className="ko">{t.partnerTypeHead} <span className="req">*</span></div>
              </div>
              <div className="hat-field">
                <div className="hat-radio-inline">
                  <label><input name="partner_type" required type="radio" value={t.pt1} /> {t.pt1}</label>
                  <label><input name="partner_type" required type="radio" value={t.pt2} /> {t.pt2}</label>
                </div>
              </div>
            </div>

            <div className="hat-row reveal">
              <div className="hat-label">
                <div className="ko">{t.matchFieldHead} <span className="req">*</span></div>
              </div>
              <div className="hat-field">
                <div className="hat-radio-inline hat-radio-wrap">
                  <label><input name="match_field" required type="radio" value={t.mf1} onChange={(e) => setSelectedMatchField(e.target.value)} /> {t.mf1}</label>
                  <label><input name="match_field" required type="radio" value={t.mf2} onChange={(e) => setSelectedMatchField(e.target.value)} /> {t.mf2}</label>
                  <label><input name="match_field" required type="radio" value={t.mf3} onChange={(e) => setSelectedMatchField(e.target.value)} /> {t.mf3}</label>
                  <label><input name="match_field" required type="radio" value={t.mf4} onChange={(e) => setSelectedMatchField(e.target.value)} /> {t.mf4}</label>
                  <label><input name="match_field" required type="radio" value={t.mf5} onChange={(e) => setSelectedMatchField(e.target.value)} /> {t.mf5}</label>
                  {selectedMatchField === t.mf5 && (
                    <input
                      className="hat-input"
                      name="match_field_custom"
                      placeholder={t.mfPl}
                      required
                      style={{
                        flex: '1',
                        minWidth: '200px',
                        maxWidth: '400px',
                        padding: '8px 14px',
                        borderRadius: '10px',
                        fontSize: '14px',
                        height: '38px'
                      }}
                      type="text"
                    />
                  )}
                </div>
              </div>
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
                <div className="ko">{t.refFile}</div>
              </div>
              <div className="hat-field hat-file-field">
                <input accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip" className="hat-file" multiple name="attachments[]" type="file" />
                <div className="hat-file-note">{t.refNote}</div>
              </div>
            </div>

            <div className="hat-row hat-row-textarea">
              <div className="hat-label">
                <div className="ko">{t.techExp} <span className="req">*</span></div>
              </div>
              <div className="hat-field">
                <textarea className="hat-textarea" name="tech_experience" placeholder={t.techPl} required rows={7}></textarea>
              </div>
            </div>

            <div className="hat-row reveal">
              <div className="hat-label">
                <div className="ko">{t.refCount}</div>
              </div>
              <div className="hat-field">
                <input className="hat-input" name="ref_count" placeholder={t.refCountPl} type="text" />
              </div>
            </div>

            <div className="hat-row reveal">
              <div className="hat-label">
                <div className="ko">{t.amount}</div>
              </div>
              <div className="hat-field">
                <input className="hat-input" name="accumulated_amount" placeholder={t.amountPl} type="text" />
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
