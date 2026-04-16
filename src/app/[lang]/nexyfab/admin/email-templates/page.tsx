'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  html_body: string;
  variables: string[];
  created_at: number;
  updated_at: number;
}

type EditorMode = 'edit' | 'preview';

const T = {
  ko: {
    title: '이메일 템플릿 관리',
    templateList: '템플릿 목록',
    newTemplate: '새 템플릿',
    idLabel: 'ID',
    nameLabel: '이름',
    subjectLabel: '제목',
    variablesLabel: '변수 (쉼표로 구분)',
    bodyLabel: 'HTML 본문',
    saveBtn: '저장',
    saving: '저장 중...',
    deleteBtn: '삭제',
    deleting: '삭제 중...',
    editTab: '편집',
    previewTab: '미리보기',
    loading: '로딩 중...',
    empty: '템플릿이 없습니다.',
    selectHint: '템플릿을 선택하세요.',
    saveOk: '저장되었습니다.',
    saveFail: '저장 실패',
    deleteOk: '삭제되었습니다.',
    deleteFail: '삭제 실패',
    loadFail: '템플릿을 불러오지 못했습니다.',
    confirmDelete: '이 템플릿을 삭제할까요?',
    variablesHint: '사용 가능한 변수:',
    idReadonly: 'ID (편집 불가)',
    idNew: 'ID (직접 입력 또는 자동 생성)',
    updated: (t: number) => `수정: ${new Date(t).toLocaleDateString('ko-KR')}`,
    noBody: '(본문 없음)',
  },
  en: {
    title: 'Email Template Manager',
    templateList: 'Templates',
    newTemplate: 'New Template',
    idLabel: 'ID',
    nameLabel: 'Name',
    subjectLabel: 'Subject',
    variablesLabel: 'Variables (comma-separated)',
    bodyLabel: 'HTML Body',
    saveBtn: 'Save',
    saving: 'Saving...',
    deleteBtn: 'Delete',
    deleting: 'Deleting...',
    editTab: 'Edit',
    previewTab: 'Preview',
    loading: 'Loading...',
    empty: 'No templates found.',
    selectHint: 'Select a template to edit.',
    saveOk: 'Saved.',
    saveFail: 'Save failed',
    deleteOk: 'Deleted.',
    deleteFail: 'Delete failed',
    loadFail: 'Failed to load templates.',
    confirmDelete: 'Delete this template?',
    variablesHint: 'Available variables:',
    idReadonly: 'ID (read-only)',
    idNew: 'ID (enter or leave blank for auto)',
    updated: (t: number) => `Updated: ${new Date(t).toLocaleDateString('en-US')}`,
    noBody: '(no body)',
  },
};


export default function AdminEmailTemplatesPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = use(params);
  const t = lang === 'ko' ? T.ko : T.en;

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listErr, setListErr] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);

  const [form, setForm] = useState<{
    id: string; name: string; subject: string; html_body: string; variables: string;
  }>({ id: '', name: '', subject: '', html_body: '', variables: '' });

  const [editorMode, setEditorMode] = useState<EditorMode>('edit');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgOk, setMsgOk] = useState(true);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  const showMsg = (text: string, ok: boolean) => {
    setMsg(text);
    setMsgOk(ok);
    setTimeout(() => setMsg(''), 4000);
  };

  const fetchTemplates = useCallback(async () => {
    setLoadingList(true);
    setListErr('');
    try {
      const res = await fetch('/api/admin/email-templates', { credentials: 'include' });
      if (!res.ok) throw new Error();
      const data = await res.json() as { templates: EmailTemplate[] };
      setTemplates(data.templates ?? []);
    } catch {
      setListErr(t.loadFail);
    } finally {
      setLoadingList(false);
    }
  }, [t.loadFail]);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

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
    setEditorMode('edit');
    setMsg('');
  };

  const handleNew = () => {
    setSelectedId(null);
    setIsNew(true);
    setForm({ id: '', name: '', subject: '', html_body: '', variables: '' });
    setEditorMode('edit');
    setMsg('');
  };

  const parseVariables = (v: string): string[] =>
    v.split(',').map((s) => s.trim()).filter(Boolean);

  const handleSave = async () => {
    if (!form.name || !form.subject || !form.html_body) {
      showMsg(lang === 'ko' ? '이름, 제목, 본문은 필수입니다.' : 'Name, subject, and body are required.', false);
      return;
    }
    setSaving(true);
    setMsg('');
    const variables = parseVariables(form.variables);
    try {
      if (isNew) {
        // POST
        const body: Record<string, unknown> = { name: form.name, subject: form.subject, html_body: form.html_body, variables };
        if (form.id.trim()) body.id = form.id.trim();
        const res = await fetch('/api/admin/email-templates', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error();
        const data = await res.json() as { template: EmailTemplate };
        await fetchTemplates();
        if (data.template) {
          selectTemplate(data.template);
          setIsNew(false);
        }
        showMsg(t.saveOk, true);
      } else if (selectedId) {
        // PATCH
        const res = await fetch('/api/admin/email-templates', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedId, name: form.name, subject: form.subject, html_body: form.html_body, variables }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json() as { template: EmailTemplate };
        await fetchTemplates();
        if (data.template) selectTemplate(data.template);
        showMsg(t.saveOk, true);
      }
    } catch {
      showMsg(t.saveFail, false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    if (!confirm(t.confirmDelete)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/email-templates?id=${encodeURIComponent(selectedId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error();
      await fetchTemplates();
      setSelectedId(null);
      setIsNew(false);
      setForm({ id: '', name: '', subject: '', html_body: '', variables: '' });
      showMsg(t.deleteOk, true);
    } catch {
      showMsg(t.deleteFail, false);
    } finally {
      setDeleting(false);
    }
  };

  const variablesList = parseVariables(form.variables);

  const inputStyle: React.CSSProperties = {
    background: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 6,
    color: '#c9d1d9',
    padding: '8px 12px',
    fontSize: 13,
    width: '100%',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    color: '#8b949e',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  };

  const hasSelection = isNew || selectedId !== null;

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#c9d1d9', fontFamily: 'system-ui, sans-serif' }}>
      {/* Top bar */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid #21262d', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#f0f6fc' }}>{t.title}</h1>
      </div>

      <div style={{ display: 'flex', height: 'calc(100vh - 65px)' }}>
        {/* Left panel: template list */}
        <div style={{ width: 260, minWidth: 200, background: '#161b22', borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* New template button */}
          <div style={{ padding: 12, borderBottom: '1px solid #21262d' }}>
            <button
              onClick={handleNew}
              style={{ width: '100%', background: '#1f6feb', border: 'none', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              + {t.newTemplate}
            </button>
          </div>
          <div style={{ padding: '8px 0', flex: 1, overflowY: 'auto' }}>
            {loadingList ? (
              <div style={{ padding: '16px', textAlign: 'center', color: '#8b949e', fontSize: 13 }}>{t.loading}</div>
            ) : listErr ? (
              <div style={{ padding: '16px', color: '#f85149', fontSize: 13 }}>{listErr}</div>
            ) : templates.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', color: '#8b949e', fontSize: 13 }}>{t.empty}</div>
            ) : (
              templates.map((tpl) => (
                <div
                  key={tpl.id}
                  onClick={() => selectTemplate(tpl)}
                  style={{
                    padding: '10px 14px',
                    cursor: 'pointer',
                    borderLeft: `3px solid ${selectedId === tpl.id && !isNew ? '#1f6feb' : 'transparent'}`,
                    background: selectedId === tpl.id && !isNew ? '#1f6feb1a' : 'transparent',
                    borderBottom: '1px solid #21262d',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#f0f6fc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tpl.name}
                  </div>
                  <div style={{ fontSize: 11, color: '#484f58', marginTop: 2, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tpl.id}
                  </div>
                  <div style={{ fontSize: 11, color: '#6e7681', marginTop: 2 }}>
                    {t.updated(tpl.updated_at)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right panel: editor */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {!hasSelection ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b949e', fontSize: 14 }}>
              {t.selectHint}
            </div>
          ) : (
            <div style={{ maxWidth: 900 }}>
              {/* Status message */}
              {msg && (
                <div style={{
                  background: msgOk ? '#1f4e2b' : '#4e1f1f',
                  border: `1px solid ${msgOk ? '#2ea04333' : '#f8514933'}`,
                  color: msgOk ? '#3fb950' : '#f85149',
                  borderRadius: 6,
                  padding: '8px 14px',
                  marginBottom: 16,
                  fontSize: 13,
                }}>
                  {msg}
                </div>
              )}

              {/* Form fields */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* ID */}
                <div>
                  <label style={labelStyle}>{isNew ? t.idNew : t.idReadonly}</label>
                  <input
                    type="text"
                    value={form.id}
                    readOnly={!isNew}
                    onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                    placeholder={isNew ? (lang === 'ko' ? '비워두면 자동 생성' : 'Leave blank for auto-generate') : ''}
                    style={{ ...inputStyle, opacity: isNew ? 1 : 0.6, cursor: isNew ? 'text' : 'default', fontFamily: 'monospace' }}
                  />
                </div>

                {/* Name */}
                <div>
                  <label style={labelStyle}>{t.nameLabel}</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    style={inputStyle}
                  />
                </div>

                {/* Subject */}
                <div>
                  <label style={labelStyle}>{t.subjectLabel}</label>
                  <input
                    type="text"
                    value={form.subject}
                    onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                    style={inputStyle}
                  />
                </div>

                {/* Variables */}
                <div>
                  <label style={labelStyle}>{t.variablesLabel}</label>
                  <input
                    type="text"
                    value={form.variables}
                    onChange={(e) => setForm((f) => ({ ...f, variables: e.target.value }))}
                    placeholder="e.g. userName, companyName, rfqId"
                    style={inputStyle}
                  />
                  {variablesList.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: '#8b949e' }}>{t.variablesHint}</span>
                      {variablesList.map((v) => (
                        <span
                          key={v}
                          style={{
                            background: '#1c2d3e',
                            border: '1px solid #1f6feb55',
                            color: '#79c0ff',
                            borderRadius: 4,
                            padding: '2px 8px',
                            fontFamily: 'monospace',
                            fontSize: 12,
                          }}
                        >
                          {`{{${v}}}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Body editor / preview */}
                <div>
                  {/* Tabs */}
                  <div style={{ display: 'flex', gap: 0, marginBottom: 8 }}>
                    {(['edit', 'preview'] as EditorMode[]).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setEditorMode(tab)}
                        style={{
                          background: editorMode === tab ? '#161b22' : 'transparent',
                          border: '1px solid #30363d',
                          borderBottom: editorMode === tab ? '1px solid #161b22' : '1px solid #30363d',
                          color: editorMode === tab ? '#f0f6fc' : '#8b949e',
                          padding: '6px 16px',
                          fontSize: 13,
                          cursor: 'pointer',
                          borderRadius: tab === 'edit' ? '6px 0 0 0' : '0 6px 0 0',
                          marginBottom: editorMode === tab ? -1 : 0,
                          position: 'relative',
                          zIndex: editorMode === tab ? 1 : 0,
                        }}
                      >
                        {tab === 'edit' ? t.editTab : t.previewTab}
                      </button>
                    ))}
                  </div>

                  {editorMode === 'edit' ? (
                    <>
                      <label style={labelStyle}>{t.bodyLabel}</label>
                      <textarea
                        value={form.html_body}
                        onChange={(e) => setForm((f) => ({ ...f, html_body: e.target.value }))}
                        rows={20}
                        spellCheck={false}
                        style={{
                          ...inputStyle,
                          fontFamily: 'monospace',
                          fontSize: 12,
                          lineHeight: 1.6,
                          resize: 'vertical',
                          minHeight: 320,
                        }}
                      />
                    </>
                  ) : (
                    <div style={{ border: '1px solid #30363d', borderRadius: '0 6px 6px 6px', overflow: 'hidden' }}>
                      {form.html_body ? (
                        <iframe
                          ref={iframeRef}
                          srcDoc={form.html_body}
                          sandbox="allow-same-origin"
                          style={{ width: '100%', minHeight: 400, border: 'none', background: '#fff' }}
                          title="Email preview"
                        />
                      ) : (
                        <div style={{ padding: 32, textAlign: 'center', color: '#8b949e', fontSize: 14 }}>{t.noBody}</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 10, paddingTop: 4, paddingBottom: 24 }}>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                      background: saving ? '#1a3a5c' : '#1f6feb',
                      border: 'none',
                      color: '#fff',
                      padding: '9px 20px',
                      borderRadius: 6,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: saving ? 'not-allowed' : 'pointer',
                      opacity: saving ? 0.7 : 1,
                    }}
                  >
                    {saving ? t.saving : t.saveBtn}
                  </button>

                  {!isNew && selectedId && (
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      style={{
                        background: 'transparent',
                        border: '1px solid #f85149',
                        color: '#f85149',
                        padding: '9px 20px',
                        borderRadius: 6,
                        fontSize: 14,
                        cursor: deleting ? 'not-allowed' : 'pointer',
                        opacity: deleting ? 0.6 : 1,
                      }}
                    >
                      {deleting ? t.deleting : t.deleteBtn}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
