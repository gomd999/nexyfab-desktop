'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  html_body: string;
  variables: string[];
  created_at: number;
  updated_at: number;
}

type EditorTab = 'edit' | 'preview';

// ── Well-known seed templates (shown as placeholders when DB is empty) ────────

const SEED_TEMPLATES: Pick<EmailTemplate, 'id' | 'name' | 'subject' | 'variables'>[] = [
  { id: 'quote_reminder',   name: '견적 만료 리마인더',     subject: '[NexyFab] 견적 마감 {{hoursLeft}}시간 전 — {{projectName}}', variables: ['projectName', 'hoursLeft', 'quoteId', 'validUntil'] },
  { id: 'contract_signed',  name: '계약 체결 완료',          subject: '[NexyFab] 계약이 체결되었습니다 — {{projectName}}',           variables: ['projectName', 'contractId', 'customerName'] },
  { id: 'rfq_matched',      name: 'RFQ 매칭 알림',           subject: '[NexyFab] 새 견적 요청이 도착했습니다',                       variables: ['rfqId', 'shapeName', 'quantity', 'material'] },
  { id: 'welcome',          name: '회원가입 환영',            subject: '[NexyFab] 가입을 환영합니다, {{userName}}님!',               variables: ['userName', 'email'] },
  { id: 'password_reset',   name: '비밀번호 재설정',          subject: '[NexyFab] 비밀번호 재설정 링크',                             variables: ['resetUrl', 'userName'] },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function parseVars(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminEmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);

  const [form, setForm] = useState({
    id: '',
    name: '',
    subject: '',
    html_body: '',
    variables: '',
  });

  const [tab, setTab] = useState<EditorTab>('edit');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (text: string, ok: boolean) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, ok });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  };

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const res = await fetch('/api/admin/email-templates', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { templates: EmailTemplate[] };
      setTemplates(data.templates ?? []);
    } catch (err) {
      setListError('템플릿을 불러오지 못했습니다.');
      console.error('[email-templates]', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchTemplates(); }, [fetchTemplates]);

  // ── Selection helpers ──────────────────────────────────────────────────────

  const selectTemplate = (tpl: EmailTemplate) => {
    setSelectedId(tpl.id);
    setIsNew(false);
    setForm({
      id: tpl.id,
      name: tpl.name,
      subject: tpl.subject,
      html_body: tpl.html_body,
      variables: tpl.variables.join(', '),
    });
    setTab('edit');
  };

  const startNew = (seed?: (typeof SEED_TEMPLATES)[number]) => {
    setSelectedId(null);
    setIsNew(true);
    setForm({
      id: seed?.id ?? '',
      name: seed?.name ?? '',
      subject: seed?.subject ?? '',
      html_body: '',
      variables: (seed?.variables ?? []).join(', '),
    });
    setTab('edit');
  };

  const clearSelection = () => {
    setSelectedId(null);
    setIsNew(false);
  };

  // ── Save (POST = new, PATCH = update) ─────────────────────────────────────

  const handleSave = async () => {
    if (!form.name.trim() || !form.subject.trim() || !form.html_body.trim()) {
      showToast('이름, 제목, 본문은 필수입니다.', false);
      return;
    }
    setSaving(true);
    const variables = parseVars(form.variables);
    try {
      if (isNew) {
        const body: Record<string, unknown> = {
          name: form.name,
          subject: form.subject,
          html_body: form.html_body,
          variables,
        };
        if (form.id.trim()) body.id = form.id.trim();

        const res = await fetch('/api/admin/email-templates', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { template: EmailTemplate };
        await fetchTemplates();
        if (data.template) selectTemplate(data.template);
        showToast('저장되었습니다.', true);
      } else if (selectedId) {
        const res = await fetch('/api/admin/email-templates', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: selectedId,
            name: form.name,
            subject: form.subject,
            html_body: form.html_body,
            variables,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { template: EmailTemplate };
        await fetchTemplates();
        if (data.template) selectTemplate(data.template);
        showToast('저장되었습니다.', true);
      }
    } catch (err) {
      showToast('저장 실패. 다시 시도해 주세요.', false);
      console.error('[email-templates save]', err);
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!confirm('이 템플릿을 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/admin/email-templates?id=${encodeURIComponent(selectedId)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchTemplates();
      clearSelection();
      showToast('템플릿이 삭제되었습니다.', true);
    } catch (err) {
      showToast('삭제 실패. 다시 시도해 주세요.', false);
      console.error('[email-templates delete]', err);
    } finally {
      setDeleting(false);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const varsList = parseVars(form.variables);
  const hasPanel = isNew || selectedId !== null;

  // Which seed templates haven't been created yet
  const existingIds = new Set(templates.map((t) => t.id));
  const unseededTemplates = SEED_TEMPLATES.filter((s) => !existingIds.has(s.id));

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">이메일 템플릿 관리</h1>
          <p className="text-sm text-gray-500 mt-1">
            DB에 저장된 커스텀 이메일 템플릿 편집 — 변수는 {`{{변수명}}`} 형식
          </p>
        </div>
        <button
          onClick={() => startNew()}
          className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition"
        >
          + 새 템플릿
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`mb-4 px-4 py-2.5 rounded-xl text-sm font-semibold border ${
            toast.ok
              ? 'bg-green-50 text-green-700 border-green-200'
              : 'bg-red-50 text-red-600 border-red-200'
          }`}
        >
          {toast.text}
        </div>
      )}

      <div className="flex gap-6 items-start">
        {/* ── Left panel: template list ─────────────────────────────────── */}
        <div className="w-72 shrink-0 flex flex-col gap-4">
          {/* Existing templates */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="text-sm font-bold text-gray-700">저장된 템플릿</span>
              <button
                onClick={fetchTemplates}
                disabled={loading}
                className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
              >
                새로고침
              </button>
            </div>

            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">로딩 중...</div>
            ) : listError ? (
              <div className="px-4 py-4 text-sm text-red-500">{listError}</div>
            ) : templates.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">
                저장된 템플릿이 없습니다
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {templates.map((tpl) => {
                  const active = selectedId === tpl.id && !isNew;
                  return (
                    <button
                      key={tpl.id}
                      onClick={() => selectTemplate(tpl)}
                      className={`w-full text-left px-4 py-3 transition-colors ${
                        active ? 'bg-blue-50 border-l-2 border-blue-500' : 'hover:bg-gray-50 border-l-2 border-transparent'
                      }`}
                    >
                      <div className="text-sm font-semibold text-gray-800 truncate">{tpl.name}</div>
                      <div className="text-[11px] font-mono text-gray-400 truncate mt-0.5">{tpl.id}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">{fmtDate(tpl.updated_at)}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Seed templates (quick-start for templates not yet in DB) */}
          {unseededTemplates.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <span className="text-sm font-bold text-gray-700">빠른 시작 템플릿</span>
                <p className="text-[11px] text-gray-400 mt-0.5">클릭하면 편집기에 미리 채워집니다</p>
              </div>
              <div className="divide-y divide-gray-50">
                {unseededTemplates.map((seed) => (
                  <button
                    key={seed.id}
                    onClick={() => startNew(seed)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="text-sm font-semibold text-gray-700 truncate">{seed.name}</div>
                    <div className="text-[11px] font-mono text-gray-400 truncate mt-0.5">{seed.id}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right panel: editor ───────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {!hasPanel ? (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-8 py-20 text-center text-gray-400 text-sm">
              왼쪽에서 템플릿을 선택하거나 새 템플릿을 만드세요
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              {/* Form fields */}
              <div className="flex flex-col gap-5">
                {/* ID */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    {isNew ? 'ID (비워두면 자동 생성)' : 'ID (변경 불가)'}
                  </label>
                  <input
                    type="text"
                    value={form.id}
                    readOnly={!isNew}
                    onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                    placeholder={isNew ? 'e.g. quote_reminder' : ''}
                    className={`w-full rounded-lg border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                      isNew
                        ? 'border-gray-300 bg-white text-gray-800'
                        : 'border-gray-200 bg-gray-50 text-gray-500 cursor-default'
                    }`}
                  />
                </div>

                {/* Name */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    이름
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. 견적 만료 리마인더"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800"
                  />
                </div>

                {/* Subject */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    제목 (Subject)
                  </label>
                  <input
                    type="text"
                    value={form.subject}
                    onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                    placeholder="e.g. [NexyFab] 견적 마감 {{hoursLeft}}시간 전"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800"
                  />
                </div>

                {/* Variables */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    변수 목록 (쉼표로 구분)
                  </label>
                  <input
                    type="text"
                    value={form.variables}
                    onChange={(e) => setForm((f) => ({ ...f, variables: e.target.value }))}
                    placeholder="e.g. userName, projectName, rfqId"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800"
                  />
                  {varsList.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className="text-xs text-gray-400">사용 가능:</span>
                      {varsList.map((v) => (
                        <span
                          key={v}
                          className="inline-block rounded bg-blue-50 border border-blue-200 text-blue-700 text-xs font-mono px-1.5 py-0.5"
                        >
                          {`{{${v}}}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* HTML Body — Edit / Preview tabs */}
                <div>
                  <div className="flex gap-1 mb-0">
                    {(['edit', 'preview'] as EditorTab[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={`px-4 py-1.5 text-xs font-semibold rounded-t-lg border border-b-0 transition-colors ${
                          tab === t
                            ? 'bg-white border-gray-300 text-gray-800 relative z-10'
                            : 'bg-gray-50 border-gray-200 text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        {t === 'edit' ? 'HTML 편집' : '미리보기'}
                      </button>
                    ))}
                  </div>

                  {tab === 'edit' ? (
                    <div>
                      <textarea
                        value={form.html_body}
                        onChange={(e) => setForm((f) => ({ ...f, html_body: e.target.value }))}
                        rows={22}
                        spellCheck={false}
                        placeholder="<!DOCTYPE html>..."
                        className="w-full rounded-b-lg rounded-tr-lg border border-gray-300 px-3 py-2.5 text-xs font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800 bg-gray-50 min-h-64"
                      />
                    </div>
                  ) : (
                    <div className="rounded-b-lg rounded-tr-lg border border-gray-300 overflow-hidden bg-gray-50">
                      {form.html_body ? (
                        <iframe
                          ref={iframeRef}
                          srcDoc={form.html_body}
                          sandbox="allow-same-origin"
                          title="이메일 미리보기"
                          className="w-full border-none bg-white"
                          style={{ minHeight: 460 }}
                        />
                      ) : (
                        <div className="py-20 text-center text-sm text-gray-400">
                          HTML 본문을 입력하면 미리보기가 표시됩니다
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition"
                  >
                    {saving ? '저장 중...' : '저장'}
                  </button>

                  {!isNew && selectedId && (
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="px-5 py-2 rounded-xl border border-red-300 text-red-600 text-sm font-semibold hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed transition"
                    >
                      {deleting ? '삭제 중...' : '삭제'}
                    </button>
                  )}

                  <button
                    onClick={clearSelection}
                    className="px-4 py-2 rounded-xl border border-gray-200 text-gray-500 text-sm hover:bg-gray-50 transition ml-auto"
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
