'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';

const dict = {
  ko: {
    heroKicker: 'Nexyfab · Auto Order.',
    heroTitle: '📦 빠른 자동 발주',
    titleSub: '(Automated Procurement System)',
    heroDesc: '품목/수량/납품 정보를 입력하면,<br/>제품은 자동적으로 배송됩니다.',
    badge1: '완제품 배송', badge2: '제조/부품 배송', badge3: '원스톱 발주',
    cardTitle: '자동 발주',
    anchor: '발주 정보 입력 ↓',
    item: '품목명',
    itemPl: '예: 개발 제품명',
    qty: '수량',
    qtyPl: '예: 100',
    company: '회사명',
    companyPl: '회사명(기관명)을 입력해주세요',
    phone: '전화번호',
    phonePl: '예: 010-1234-5678',
    email: '이메일',
    emailPl: '답변 받을 이메일 주소',
    address: '주소',
    addressPl: '납품 주소(도시/구/상세)',
    password: '고객 확인용 패스워드',
    passwordPl: '요청 조회/확인용 비밀번호',
    passwordHelp: '* 내부 확인 목적이며 외부 공개되지 않습니다.',
    submit: '🚀 자동 발주 완료하기',
    note: '제출 후 담당자가 내용을 확인하고, <br/>납기일/견적을 안내드립니다.',
    successMsg: '성공적으로 접수되었습니다.',
    errorMsg: '전송 중 오류가 발생했습니다.',
    actionFailed: '처리 실패'
  },
  en: {
    heroKicker: 'Nexyfab · Auto Order.',
    heroTitle: '📦 Quick Auto Order',
    titleSub: '(Automated Procurement System)',
    heroDesc: 'Enter item/qty/delivery info,<br/>and products will be delivered automatically.',
    badge1: 'Finished Goods', badge2: 'Parts Delivery', badge3: 'One-stop Order',
    cardTitle: 'Auto Order',
    anchor: 'Enter Order Info ↓',
    item: 'Item Name',
    itemPl: 'e.g., Development product name',
    qty: 'Quantity',
    qtyPl: 'e.g., 100',
    company: 'Company',
    companyPl: 'Please enter your company name',
    phone: 'Phone',
    phonePl: 'e.g., +82-10-1234-5678',
    email: 'Email',
    emailPl: 'Email address for response',
    address: 'Address',
    addressPl: 'Delivery address (City/Dist/Detail)',
    password: 'Customer Verification Password',
    passwordPl: 'Password for request inquiry',
    passwordHelp: '* For internal verification purposes only.',
    submit: '🚀 Submit Auto Order',
    note: 'After submission, a specialist will review it and guide you on delivery dates/quotes.',
    successMsg: 'Successfully submitted.',
    errorMsg: 'An error occurred while sending.',
    actionFailed: 'Action Failed'
  },
  ja: {
    heroKicker: 'Nexyfab · Auto Order.',
    heroTitle: '📦 クイック自動発注',
    titleSub: '(Automated Procurement System)',
    heroDesc: '品目/数量/納品情報を入力すると、<br/>製品は自動的に配送されます。',
    badge1: '完成品配送', badge2: '製造/部品配送', badge3: 'ワンストップ発注',
    cardTitle: '自動発注',
    anchor: '発注情報の入力 ↓',
    item: '品目名',
    itemPl: '例: 開発製品名',
    qty: '数量',
    qtyPl: '例: 100',
    company: '会社名',
    companyPl: '会社名（機関名）を入力してください',
    phone: '電話番号',
    phonePl: '例: 010-1234-5678',
    email: 'メール',
    emailPl: '返信用のメールアドレス',
    address: '住所',
    addressPl: '納品先住所（都市/区/詳細）',
    password: '顧客確認用パスワード',
    passwordPl: '要請照会/確認用パスワード',
    passwordHelp: '* 内部確認用であり、外部には公開されません。',
    submit: '🚀 自動発注を完了する',
    note: '提出後、担当者が内容を確認し、納期/見積もりをご案内します。',
    successMsg: '正常に受け付けられました。',
    errorMsg: '送信中にエラーが発生しました。',
    actionFailed: '処理に失敗しました'
  },
  zh: {
    heroKicker: 'Nexyfab · Auto Order.',
    heroTitle: '📦 快捷自动下单',
    titleSub: '(Automated Procurement System)',
    heroDesc: '输入品目/数量/交付信息，<br/>产品将自动送达。',
    badge1: '成品交付', badge2: '零件交付', badge3: '一站式下单',
    cardTitle: '自动下单',
    anchor: '填写下单信息 ↓',
    item: '品目名称',
    itemPl: '例：开发产品名称',
    qty: '数量',
    qtyPl: '例：100',
    company: '公司名称',
    companyPl: '请输入公司（机构）名称',
    phone: '电话号码',
    phonePl: '例：010-1234-5678',
    email: '电子邮箱',
    emailPl: '接收回复的电子邮箱',
    address: '地址',
    addressPl: '交付地址（城市/区/详细地址）',
    password: '客户确认密码',
    passwordPl: '查询/请求确认用的密码',
    passwordHelp: '* 仅用于内部确认，不对外公开。',
    submit: '🚀 提交自动下单',
    note: '提交后，专员将核实内容并告知交期/报价。',
    successMsg: '提交成功。',
    errorMsg: '发送过程中出现错误。',
    actionFailed: '操作失败'
  }
};

export default function AutoOrderPage() {
  const pathname = usePathname();
  const langCode = pathname.split('/')[1] || 'en';
  const lang = ['en', 'kr', 'ja', 'cn'].includes(langCode) ? langCode : 'en';
  const t = dict[lang === 'cn' ? 'zh' : lang === 'kr' ? 'ko' : lang as keyof typeof dict];

  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

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
    formData.append('action', 'send_auto_order');
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

      const data = await res.json();
      if (res.ok && data.success) {
        toast('success', t.successMsg);
        form.reset();
      } else {
        toast('error', t.actionFailed + ": " + (data.error || "Unknown error"));
      }
    } catch (err) {
      console.error(err);
      toast('error', t.errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div id="Nexyfab-autoorder">
      <section className="hat-hero hat-hero-auto">
        <div className="hat-hero-inner">
          <p className="hat-kicker">{t.heroKicker}</p>
          <h1 className="hat-hero-title">
            {t.heroTitle} <span className="hat-hero-sub">{t.titleSub}</span>
          </h1>
          <p className="hat-hero-copy" dangerouslySetInnerHTML={{ __html: t.heroDesc }} />
          <div className="hat-hero-meta">
            <span className="hat-pill">{t.badge1}</span>
            <span className="hat-pill">{t.badge2}</span>
            <span className="hat-pill">{t.badge3}</span>
          </div>
          <a href="#form" className="hat-anchor">{t.anchor}</a>
        </div>
      </section>

      <section id="form" className="hat-section reveal">
        <div className="hat-wrap hat-wrap-auto">
          <div className="hat-form-head">
            <div className="hat-title">
              <div className="ko">{t.cardTitle}</div>
            </div>
          </div>

          <form className="hat-form" onSubmit={handleSubmit}>
            <div className="hat-grid">
              <div className="hat-field reveal">
                <label htmlFor="ao_item">{t.item} <span className="req">*</span></label>
                <input id="ao_item" name="item" placeholder={t.itemPl} required type="text" />
              </div>
              <div className="hat-field reveal">
                <label htmlFor="ao_qty">{t.qty} <span className="req">*</span></label>
                <input id="ao_qty" name="qty" min="1" placeholder={t.qtyPl} required type="number" />
              </div>
              <div className="hat-field reveal">
                <label htmlFor="ao_company">{t.company} <span className="req">*</span></label>
                <input id="ao_company" name="company" placeholder={t.companyPl} required type="text" />
              </div>
              <div className="hat-field reveal">
                <label htmlFor="ao_phone">{t.phone} <span className="req">*</span></label>
                <input id="ao_phone" name="phone" placeholder={t.phonePl} required type="text" />
              </div>
              <div className="hat-field reveal">
                <label htmlFor="ao_email">{t.email} <span className="req">*</span></label>
                <input id="ao_email" name="email" placeholder={t.emailPl} required type="email" />
              </div>
              <div className="hat-field reveal">
                <label htmlFor="ao_address">{t.address} <span className="req">*</span></label>
                <input id="ao_address" name="address" placeholder={t.addressPl} required type="text" />
              </div>
              <div className="hat-field hat-full reveal">
                <label htmlFor="ao_pass">{t.password} <span className="req">*</span></label>
                <input id="ao_pass" name="pass" placeholder={t.passwordPl} required type="password" />
                <p className="hat-help">{t.passwordHelp}</p>
              </div>
            </div>

            <div className="hat-actions hat-actions-column reveal">
              <button className="hat-btn hat-btn-auto" type="submit" disabled={isSubmitting}>
                {isSubmitting ? '...' : t.submit}
              </button>
              <p className="hat-note" style={{ marginTop: '16px', textAlign: 'center' }} dangerouslySetInnerHTML={{ __html: t.note }} />
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
