'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePartnerLang } from '../_lib/partnerLang';
import { registerDict } from '../_lib/dicts/register';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FormData {
  // Step 1 — company
  companyName: string;
  bizNumber: string;
  ceoName: string;
  foundedYear: string;
  employeeCount: string;
  // Step 2 — contact
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactTitle: string;
  // Step 3 — capability
  processes: string[];
  certifications: string[];
  monthlyCapacity: string;
  industries: string[];
  // Step 4 — bio / portfolio
  bio: string;
  homepage: string;
}

const INITIAL: FormData = {
  companyName: '', bizNumber: '', ceoName: '', foundedYear: '', employeeCount: '',
  contactName: '', contactEmail: '', contactPhone: '', contactTitle: '',
  processes: [], certifications: [], monthlyCapacity: '', industries: [],
  bio: '', homepage: '',
};

const PROCESS_OPTIONS = ['CNC가공', '판금', '사출성형', '도금', '도장', '용접', '3D프린팅', 'PCB', '레이저가공', '주조'];
const CERT_OPTIONS = ['ISO9001', 'ISO14001', 'IATF16949', 'AS9100'];
const CAPACITY_OPTIONS = ['~50건', '50-200건', '200-500건', '500건+'];
const INDUSTRY_OPTIONS = ['자동차', '전자/반도체', '의료기기', '항공우주', '일반 제조'];
const EMPLOYEE_OPTIONS = ['1-9', '10-49', '50-199', '200+'];

const TOTAL_STEPS = 4;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBizNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return digits.slice(0, 3) + '-' + digits.slice(3);
  return digits.slice(0, 3) + '-' + digits.slice(3, 5) + '-' + digits.slice(5);
}

function isValidBizNumber(v: string): boolean {
  return /^\d{3}-\d{2}-\d{5}$/.test(v);
}

function toggleArray(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
      {children}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string;
  onChange: (v: string) => void;
}

function Input({ value, onChange, ...props }: InputProps) {
  return (
    <input
      {...props}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
    />
  );
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}

function Select({ value, onChange, children, ...props }: SelectProps) {
  return (
    <select
      {...props}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
    >
      {children}
    </select>
  );
}

function CheckboxGroup({ options, selected, onChange }: { options: string[]; selected: string[]; onChange: (val: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => {
        const checked = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(toggleArray(selected, opt))}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              checked
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
            }`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ step, labels, counterText }: { step: number; labels: string[]; counterText: string }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        {labels.map((label, i) => (
          <div key={i} className="flex-1 flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
              i + 1 < step
                ? 'bg-blue-600 border-blue-600 text-white'
                : i + 1 === step
                  ? 'bg-white border-blue-600 text-blue-600'
                  : 'bg-white border-gray-200 text-gray-400'
            }`}>
              {i + 1 < step ? '✓' : i + 1}
            </div>
            <span className={`mt-1 text-[11px] font-medium hidden sm:block ${i + 1 === step ? 'text-blue-600' : 'text-gray-400'}`}>
              {label}
            </span>
          </div>
        ))}
      </div>
      <div className="relative h-1.5 bg-gray-100 rounded-full mt-1">
        <div
          className="absolute left-0 top-0 h-full bg-blue-600 rounded-full transition-all duration-300"
          style={{ width: `${((step - 1) / (TOTAL_STEPS - 1)) * 100}%` }}
        />
      </div>
      <p className="text-xs text-gray-400 text-right mt-1">{counterText}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PartnerRegisterPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(INITIAL);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const lang = usePartnerLang();
  const t = registerDict(lang);
  const STEP_LABELS = [t.step1Label, t.step2Label, t.step3Label, t.step4Label];

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => ({ ...prev, [key]: undefined }));
  };

  // ── Validation ────────────────────────────────────────────────────────────

  function validateStep(s: number): boolean {
    const errs: Partial<Record<keyof FormData, string>> = {};
    if (s === 1) {
      if (!form.companyName.trim()) errs.companyName = t.errCompanyName;
      if (!form.bizNumber.trim()) errs.bizNumber = t.errBizNumber;
      else if (!isValidBizNumber(form.bizNumber)) errs.bizNumber = t.errBizNumberFormat;
      if (!form.ceoName.trim()) errs.ceoName = t.errCeoName;
      if (!form.foundedYear) errs.foundedYear = t.errFoundedYear;
      if (!form.employeeCount) errs.employeeCount = t.errEmployeeCount;
    }
    if (s === 2) {
      if (!form.contactName.trim()) errs.contactName = t.errContactName;
      if (!form.contactEmail.trim()) errs.contactEmail = t.errContactEmail;
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) errs.contactEmail = t.errContactEmailFormat;
      if (!form.contactPhone.trim()) errs.contactPhone = t.errContactPhone;
    }
    if (s === 3) {
      if (form.processes.length === 0) errs.processes = t.errProcesses;
      if (!form.monthlyCapacity) errs.monthlyCapacity = t.errMonthlyCapacity;
      if (form.industries.length === 0) errs.industries = t.errIndustries;
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleNext() {
    if (validateStep(step)) setStep(s => s + 1);
  }

  function handleBack() {
    setStep(s => s - 1);
    setErrors({});
  }

  async function handleSubmit() {
    if (!validateStep(4)) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch('/api/partner/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: form.companyName.trim(),
          biz_number: form.bizNumber.trim(),
          ceo_name: form.ceoName.trim(),
          founded_year: parseInt(form.foundedYear),
          employee_count: form.employeeCount,
          contact_name: form.contactName.trim(),
          contact_email: form.contactEmail.trim(),
          contact_phone: form.contactPhone.trim(),
          contact_title: form.contactTitle.trim(),
          processes: form.processes,
          certifications: form.certifications,
          monthly_capacity: form.monthlyCapacity,
          industries: form.industries,
          bio: form.bio.trim(),
          homepage: form.homepage.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || t.errSubmitGeneric);
        return;
      }
      setSubmitted(true);
    } catch {
      setSubmitError(t.errServer);
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Success Screen ────────────────────────────────────────────────────────

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <Link href="/" prefetch={false} className="inline-block">
              <span className="text-2xl font-black text-gray-900">NexyFab</span>
            </Link>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-3">{t.successHeading}</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-6 whitespace-pre-line">
              {t.successBody(form.contactEmail)}
            </p>
            <Link
              href={`/partner/login?lang=${lang}`}
              className="inline-block w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition text-sm"
            >
              {t.successBackToLogin}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ─── Year options ──────────────────────────────────────────────────────────

  const yearOptions: number[] = [];
  for (let y = 2026; y >= 1950; y--) yearOptions.push(y);

  // ─── Form ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" prefetch={false} className="inline-block">
            <span className="text-2xl font-black text-gray-900">NexyFab</span>
          </Link>
          <h1 className="text-xl font-bold text-gray-800 mt-3">{t.pageTitle}</h1>
          <p className="text-sm text-gray-500 mt-1">{t.pageSubtitle}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <ProgressBar step={step} labels={STEP_LABELS} counterText={t.stepCounter(step, TOTAL_STEPS)} />

          {/* Step 1 */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-base font-bold text-gray-900 mb-4">{t.step1Label}</h2>

              <div>
                <FieldLabel required>{t.step1FieldCompanyName}</FieldLabel>
                <Input value={form.companyName} onChange={v => set('companyName', v)} placeholder={t.step1PhCompanyName} />
                {errors.companyName && <p className="mt-1.5 text-xs text-red-600">{errors.companyName}</p>}
              </div>

              <div>
                <FieldLabel required>{t.step1FieldBizNumber}</FieldLabel>
                <Input
                  value={form.bizNumber}
                  onChange={v => set('bizNumber', formatBizNumber(v))}
                  placeholder="123-45-67890"
                  maxLength={12}
                  inputMode="numeric"
                />
                {errors.bizNumber && <p className="mt-1.5 text-xs text-red-600">{errors.bizNumber}</p>}
              </div>

              <div>
                <FieldLabel required>{t.step1FieldCeoName}</FieldLabel>
                <Input value={form.ceoName} onChange={v => set('ceoName', v)} placeholder={t.step1PhCeoName} />
                {errors.ceoName && <p className="mt-1.5 text-xs text-red-600">{errors.ceoName}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel required>{t.step1FieldFoundedYear}</FieldLabel>
                  <Select value={form.foundedYear} onChange={v => set('foundedYear', v)}>
                    <option value="">{t.selectPlaceholder}</option>
                    {yearOptions.map(y => <option key={y} value={String(y)}>{y}{t.yearSuffix}</option>)}
                  </Select>
                  {errors.foundedYear && <p className="mt-1.5 text-xs text-red-600">{errors.foundedYear}</p>}
                </div>
                <div>
                  <FieldLabel required>{t.step1FieldEmployeeCount}</FieldLabel>
                  <Select value={form.employeeCount} onChange={v => set('employeeCount', v)}>
                    <option value="">{t.selectPlaceholder}</option>
                    {EMPLOYEE_OPTIONS.map(o => <option key={o} value={o}>{o}{t.employeeSuffix}</option>)}
                  </Select>
                  {errors.employeeCount && <p className="mt-1.5 text-xs text-red-600">{errors.employeeCount}</p>}
                </div>
              </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-base font-bold text-gray-900 mb-4">{t.step2Label}</h2>

              <div>
                <FieldLabel required>{t.step2FieldContactName}</FieldLabel>
                <Input value={form.contactName} onChange={v => set('contactName', v)} placeholder={t.step2PhContactName} />
                {errors.contactName && <p className="mt-1.5 text-xs text-red-600">{errors.contactName}</p>}
              </div>

              <div>
                <FieldLabel required>{t.step2FieldContactEmail}</FieldLabel>
                <Input value={form.contactEmail} onChange={v => set('contactEmail', v)} type="email" placeholder="contact@company.com" />
                {errors.contactEmail && <p className="mt-1.5 text-xs text-red-600">{errors.contactEmail}</p>}
              </div>

              <div>
                <FieldLabel required>{t.step2FieldContactPhone}</FieldLabel>
                <Input value={form.contactPhone} onChange={v => set('contactPhone', v)} type="tel" placeholder="010-1234-5678" />
                {errors.contactPhone && <p className="mt-1.5 text-xs text-red-600">{errors.contactPhone}</p>}
              </div>

              <div>
                <FieldLabel>{t.step2FieldContactTitle}</FieldLabel>
                <Input value={form.contactTitle} onChange={v => set('contactTitle', v)} placeholder={t.step2PhContactTitle} />
              </div>
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="space-y-6">
              <h2 className="text-base font-bold text-gray-900 mb-4">{t.step3Label}</h2>

              <div>
                <FieldLabel required>{t.step3FieldProcesses}</FieldLabel>
                <CheckboxGroup
                  options={PROCESS_OPTIONS}
                  selected={form.processes}
                  onChange={v => set('processes', v)}
                />
                {errors.processes && <p className="mt-1.5 text-xs text-red-600">{errors.processes}</p>}
              </div>

              <div>
                <FieldLabel>{t.step3FieldCerts}</FieldLabel>
                <CheckboxGroup
                  options={CERT_OPTIONS}
                  selected={form.certifications}
                  onChange={v => set('certifications', v)}
                />
              </div>

              <div>
                <FieldLabel required>{t.step3FieldMonthlyCapacity}</FieldLabel>
                <Select value={form.monthlyCapacity} onChange={v => set('monthlyCapacity', v)}>
                  <option value="">{t.selectPlaceholder}</option>
                  {CAPACITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </Select>
                {errors.monthlyCapacity && <p className="mt-1.5 text-xs text-red-600">{errors.monthlyCapacity}</p>}
              </div>

              <div>
                <FieldLabel required>{t.step3FieldIndustries}</FieldLabel>
                <CheckboxGroup
                  options={INDUSTRY_OPTIONS}
                  selected={form.industries}
                  onChange={v => set('industries', v)}
                />
                {errors.industries && <p className="mt-1.5 text-xs text-red-600">{errors.industries}</p>}
              </div>
            </div>
          )}

          {/* Step 4 */}
          {step === 4 && (
            <div className="space-y-5">
              <h2 className="text-base font-bold text-gray-900 mb-4">{t.step4Label}</h2>

              <div>
                <FieldLabel>{t.step4FieldBio}</FieldLabel>
                <textarea
                  value={form.bio}
                  onChange={e => set('bio', e.target.value)}
                  maxLength={500}
                  rows={5}
                  placeholder={t.step4PhBio}
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition resize-none"
                />
                <p className="mt-1 text-right text-xs text-gray-400">{form.bio.length} / 500</p>
              </div>

              <div>
                <FieldLabel>{t.step4FieldHomepage}</FieldLabel>
                <Input value={form.homepage} onChange={v => set('homepage', v)} type="url" placeholder="https://www.company.com" />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <p className="text-sm text-blue-700 font-semibold">{t.step4PortfolioTitle}</p>
                <p className="text-xs text-blue-600 mt-1">{t.step4PortfolioHint}</p>
              </div>

              {submitError && (
                <div className="px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl font-semibold">
                  {submitError}
                </div>
              )}
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex gap-3 mt-8">
            {step > 1 && (
              <button
                type="button"
                onClick={handleBack}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition text-sm"
              >
                {t.btnBack}
              </button>
            )}
            {step < TOTAL_STEPS ? (
              <button
                type="button"
                onClick={handleNext}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition text-sm"
              >
                {t.btnNext}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition disabled:opacity-50 text-sm"
              >
                {submitting ? t.btnSubmitting : t.btnSubmit}
              </button>
            )}
          </div>
        </div>

        <p className="text-center mt-4 text-xs text-gray-400">
          {t.haveAccountPrefix}{' '}
          <Link href={`/partner/login?lang=${lang}`} className="text-blue-600 font-semibold hover:underline">{t.haveAccountLink}</Link>
        </p>
      </div>
    </div>
  );
}
