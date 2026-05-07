'use client';

import { useState } from 'react';
import Link from 'next/link';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FormData {
  // Step 1 — 회사 정보
  companyName: string;
  bizNumber: string;
  ceoName: string;
  foundedYear: string;
  employeeCount: string;
  // Step 2 — 담당자 정보
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactTitle: string;
  // Step 3 — 제조 역량
  processes: string[];
  certifications: string[];
  monthlyCapacity: string;
  industries: string[];
  // Step 4 — 소개
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
const STEP_LABELS = ['회사 정보', '담당자 정보', '제조 역량', '포트폴리오/소개'];

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

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        {STEP_LABELS.map((label, i) => (
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
      <p className="text-xs text-gray-400 text-right mt-1">{step} / {TOTAL_STEPS}</p>
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

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => ({ ...prev, [key]: undefined }));
  };

  // ── Validation ────────────────────────────────────────────────────────────

  function validateStep(s: number): boolean {
    const errs: Partial<Record<keyof FormData, string>> = {};
    if (s === 1) {
      if (!form.companyName.trim()) errs.companyName = '회사명을 입력해 주세요.';
      if (!form.bizNumber.trim()) errs.bizNumber = '사업자등록번호를 입력해 주세요.';
      else if (!isValidBizNumber(form.bizNumber)) errs.bizNumber = '올바른 형식으로 입력해 주세요 (예: 123-45-67890)';
      if (!form.ceoName.trim()) errs.ceoName = '대표자명을 입력해 주세요.';
      if (!form.foundedYear) errs.foundedYear = '설립연도를 선택해 주세요.';
      if (!form.employeeCount) errs.employeeCount = '직원 수를 선택해 주세요.';
    }
    if (s === 2) {
      if (!form.contactName.trim()) errs.contactName = '담당자명을 입력해 주세요.';
      if (!form.contactEmail.trim()) errs.contactEmail = '이메일을 입력해 주세요.';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) errs.contactEmail = '올바른 이메일을 입력해 주세요.';
      if (!form.contactPhone.trim()) errs.contactPhone = '전화번호를 입력해 주세요.';
    }
    if (s === 3) {
      if (form.processes.length === 0) errs.processes = '주요 공정을 1개 이상 선택해 주세요.';
      if (!form.monthlyCapacity) errs.monthlyCapacity = '월 생산 능력을 선택해 주세요.';
      if (form.industries.length === 0) errs.industries = '주요 납품 산업을 1개 이상 선택해 주세요.';
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
        setSubmitError(data.error || '제출에 실패했습니다. 다시 시도해 주세요.');
        return;
      }
      setSubmitted(true);
    } catch {
      setSubmitError('서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
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
            <h2 className="text-xl font-bold text-gray-900 mb-3">신청이 접수되었습니다</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-6">
              영업일 기준 2-3일 내 검토 후 안내드립니다.<br />
              담당자 이메일({form.contactEmail})로 결과를 보내드립니다.
            </p>
            <Link
              href="/partner/login"
              className="inline-block w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition text-sm"
            >
              파트너 로그인으로 돌아가기
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
          <h1 className="text-xl font-bold text-gray-800 mt-3">파트너 등록 신청</h1>
          <p className="text-sm text-gray-500 mt-1">제조 파트너로 등록하여 신규 수주를 확대하세요</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <ProgressBar step={step} />

          {/* Step 1 */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-base font-bold text-gray-900 mb-4">회사 정보</h2>

              <div>
                <FieldLabel required>회사명</FieldLabel>
                <Input value={form.companyName} onChange={v => set('companyName', v)} placeholder="주식회사 예시" />
                {errors.companyName && <p className="mt-1.5 text-xs text-red-600">{errors.companyName}</p>}
              </div>

              <div>
                <FieldLabel required>사업자등록번호</FieldLabel>
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
                <FieldLabel required>대표자명</FieldLabel>
                <Input value={form.ceoName} onChange={v => set('ceoName', v)} placeholder="홍길동" />
                {errors.ceoName && <p className="mt-1.5 text-xs text-red-600">{errors.ceoName}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel required>설립연도</FieldLabel>
                  <Select value={form.foundedYear} onChange={v => set('foundedYear', v)}>
                    <option value="">선택</option>
                    {yearOptions.map(y => <option key={y} value={String(y)}>{y}년</option>)}
                  </Select>
                  {errors.foundedYear && <p className="mt-1.5 text-xs text-red-600">{errors.foundedYear}</p>}
                </div>
                <div>
                  <FieldLabel required>직원 수</FieldLabel>
                  <Select value={form.employeeCount} onChange={v => set('employeeCount', v)}>
                    <option value="">선택</option>
                    {EMPLOYEE_OPTIONS.map(o => <option key={o} value={o}>{o}명</option>)}
                  </Select>
                  {errors.employeeCount && <p className="mt-1.5 text-xs text-red-600">{errors.employeeCount}</p>}
                </div>
              </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-base font-bold text-gray-900 mb-4">담당자 정보</h2>

              <div>
                <FieldLabel required>담당자명</FieldLabel>
                <Input value={form.contactName} onChange={v => set('contactName', v)} placeholder="김담당" />
                {errors.contactName && <p className="mt-1.5 text-xs text-red-600">{errors.contactName}</p>}
              </div>

              <div>
                <FieldLabel required>이메일</FieldLabel>
                <Input value={form.contactEmail} onChange={v => set('contactEmail', v)} type="email" placeholder="contact@company.com" />
                {errors.contactEmail && <p className="mt-1.5 text-xs text-red-600">{errors.contactEmail}</p>}
              </div>

              <div>
                <FieldLabel required>전화번호</FieldLabel>
                <Input value={form.contactPhone} onChange={v => set('contactPhone', v)} type="tel" placeholder="010-1234-5678" />
                {errors.contactPhone && <p className="mt-1.5 text-xs text-red-600">{errors.contactPhone}</p>}
              </div>

              <div>
                <FieldLabel>직책/부서</FieldLabel>
                <Input value={form.contactTitle} onChange={v => set('contactTitle', v)} placeholder="영업팀 팀장" />
              </div>
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="space-y-6">
              <h2 className="text-base font-bold text-gray-900 mb-4">제조 역량</h2>

              <div>
                <FieldLabel required>주요 공정</FieldLabel>
                <CheckboxGroup
                  options={PROCESS_OPTIONS}
                  selected={form.processes}
                  onChange={v => set('processes', v)}
                />
                {errors.processes && <p className="mt-1.5 text-xs text-red-600">{errors.processes}</p>}
              </div>

              <div>
                <FieldLabel>보유 인증</FieldLabel>
                <CheckboxGroup
                  options={CERT_OPTIONS}
                  selected={form.certifications}
                  onChange={v => set('certifications', v)}
                />
              </div>

              <div>
                <FieldLabel required>월 생산 능력</FieldLabel>
                <Select value={form.monthlyCapacity} onChange={v => set('monthlyCapacity', v)}>
                  <option value="">선택</option>
                  {CAPACITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </Select>
                {errors.monthlyCapacity && <p className="mt-1.5 text-xs text-red-600">{errors.monthlyCapacity}</p>}
              </div>

              <div>
                <FieldLabel required>주요 납품 산업</FieldLabel>
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
              <h2 className="text-base font-bold text-gray-900 mb-4">포트폴리오/소개</h2>

              <div>
                <FieldLabel>회사 소개</FieldLabel>
                <textarea
                  value={form.bio}
                  onChange={e => set('bio', e.target.value)}
                  maxLength={500}
                  rows={5}
                  placeholder="회사의 주요 역량, 납품 실적, 특장점 등을 자유롭게 소개해 주세요."
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition resize-none"
                />
                <p className="mt-1 text-right text-xs text-gray-400">{form.bio.length} / 500</p>
              </div>

              <div>
                <FieldLabel>홈페이지 URL</FieldLabel>
                <Input value={form.homepage} onChange={v => set('homepage', v)} type="url" placeholder="https://www.company.com" />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <p className="text-sm text-blue-700 font-semibold">포트폴리오 첨부</p>
                <p className="text-xs text-blue-600 mt-1">승인 후 파트너 포털에서 포트폴리오를 등록하실 수 있습니다.</p>
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
                이전
              </button>
            )}
            {step < TOTAL_STEPS ? (
              <button
                type="button"
                onClick={handleNext}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition text-sm"
              >
                다음
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition disabled:opacity-50 text-sm"
              >
                {submitting ? '제출 중...' : '신청 제출'}
              </button>
            )}
          </div>
        </div>

        <p className="text-center mt-4 text-xs text-gray-400">
          이미 계정이 있으신가요?{' '}
          <Link href="/partner/login" className="text-blue-600 font-semibold hover:underline">파트너 로그인</Link>
        </p>
      </div>
    </div>
  );
}
