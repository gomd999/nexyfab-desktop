'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useToast } from '@/components/ToastProvider';
import { formatDate } from '@/lib/formatDate';

interface Template {
  id: string;
  name: string;
  category: string;
  content: string;
  variables: string[];
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_OPTIONS = ['일반', '제조', '정밀가공', '금속', '플라스틱', '전자', '화학', '기타'];

const COMMON_VARIABLES = [
  'projectName', 'clientName', 'factoryName', 'contractAmount',
  'contractDate', 'warrantyPeriod', 'deadline', 'partnerEmail',
];

function TemplateModal({
  initial,
  onSave,
  onClose,
}: {
  initial: Partial<Template> | null;
  onSave: (data: { id?: string; name: string; category: string; content: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name || '');
  const [category, setCategory] = useState(initial?.category || '일반');
  const [content, setContent] = useState(initial?.content || '');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertVariable = (varName: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const before = content.slice(0, start);
    const after = content.slice(end);
    const inserted = `{{${varName}}}`;
    setContent(before + inserted + after);
    // 커서 위치 복원
    setTimeout(() => {
      el.focus();
      el.selectionStart = start + inserted.length;
      el.selectionEnd = start + inserted.length;
    }, 0);
  };

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await onSave({ id: initial?.id, name, category, content });
    } finally {
      setSaving(false);
    }
  };

  // 현재 content에서 추출된 변수
  const detectedVars = Array.from(
    new Set([...content.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">
            {initial?.id ? '템플릿 편집' : '새 템플릿'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">템플릿명 *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 정밀가공 표준 계약서"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">카테고리</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 변수 삽입 팔레트 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">변수 삽입 (클릭하면 커서 위치에 삽입)</label>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => insertVariable(v)}
                  className="text-xs bg-gray-100 hover:bg-blue-50 hover:text-blue-700 border border-gray-200 hover:border-blue-300 px-2 py-1 rounded font-mono transition-colors"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
          </div>

          {/* 본문 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">본문 *</label>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={14}
              placeholder="계약서 본문을 입력하세요. 변수는 {{projectName}} 형태로 입력합니다."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 resize-none font-mono leading-relaxed"
            />
          </div>

          {/* 감지된 변수 */}
          {detectedVars.length > 0 && (
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-blue-700 mb-1.5">감지된 변수 ({detectedVars.length}개)</p>
              <div className="flex flex-wrap gap-1.5">
                {detectedVars.map((v) => (
                  <span key={v} className="text-xs bg-white text-blue-700 border border-blue-200 px-2 py-0.5 rounded font-mono">
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t flex gap-2">
          <button
            onClick={handleSave}
            disabled={!name.trim() || !content.trim() || saving}
            className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

const SAMPLE_VALUES: Record<string, string> = {
  projectName: '알루미늄 케이스 가공',
  clientName: '김철수',
  factoryName: '정밀기계 주식회사',
  contractAmount: '12,500,000',
  contractDate: formatDate(new Date()),
  warrantyPeriod: '12개월',
  deadline: formatDate(new Date(Date.now() + 30 * 86_400_000)),
  partnerEmail: 'factory@example.com',
};

function applyVariables(content: string, values: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    values[key] !== undefined ? values[key] : `{{${key}}}`
  );
}

function PreviewModal({ template, onClose }: { template: Template; onClose: () => void }) {
  const [showRaw, setShowRaw] = useState(false);
  const [customValues, setCustomValues] = useState<Record<string, string>>({ ...SAMPLE_VALUES });
  const detectedVars = Array.from(
    new Set([...template.content.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))
  );
  const rendered = applyVariables(template.content, customValues);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{template.name}</h2>
            <p className="text-xs text-gray-400">카테고리: {template.category} · 변수 {detectedVars.length}개</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRaw(v => !v)}
              className={`text-xs font-semibold px-3 py-1 rounded-lg border transition ${showRaw ? 'bg-gray-100 text-gray-700' : 'bg-blue-50 text-blue-700 border-blue-200'}`}
            >
              {showRaw ? '미리보기' : '원본'}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-2">×</button>
          </div>
        </div>

        {/* Variable editor */}
        {detectedVars.length > 0 && (
          <div className="px-6 py-3 bg-gray-50 border-b">
            <p className="text-xs font-semibold text-gray-500 mb-2">샘플 값 편집 (미리보기에 반영)</p>
            <div className="flex flex-wrap gap-2">
              {detectedVars.map(v => (
                <div key={v} className="flex items-center gap-1">
                  <span className="text-xs font-mono text-gray-400">{`{{${v}}}`}</span>
                  <span className="text-xs text-gray-400">=</span>
                  <input
                    value={customValues[v] ?? ''}
                    onChange={e => setCustomValues(prev => ({ ...prev, [v]: e.target.value }))}
                    placeholder={SAMPLE_VALUES[v] ?? v}
                    className="text-xs px-2 py-1 border border-gray-200 rounded focus:outline-none focus:border-blue-400 w-28"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {showRaw ? (
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed bg-gray-50 rounded-lg p-4 border">
              {template.content}
            </pre>
          ) : (
            <div className="prose prose-sm max-w-none">
              <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed bg-white rounded-lg p-4 border border-gray-100">
                {rendered}
              </pre>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {detectedVars.length > 0 ? `${detectedVars.length}개 변수 감지됨` : '변수 없음'}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editModal, setEditModal] = useState<Partial<Template> | null | false>(false);
  const [previewModal, setPreviewModal] = useState<Template | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/templates');
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch {
      setError('템플릿을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleSave = async (data: { id?: string; name: string; category: string; content: string }) => {
    const method = data.id ? 'PATCH' : 'POST';
    const res = await fetch('/api/templates', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setEditModal(false);
      fetchTemplates();
    } else {
      toast('error', '저장에 실패했습니다.');
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/templates?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      setDeleteConfirm(null);
      fetchTemplates();
    } else {
      toast('error', '삭제에 실패했습니다.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">계약서 템플릿 관리</h1>
        <button
          onClick={() => setEditModal({})}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
        >
          + 새 템플릿
        </button>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-12">불러오는 중...</div>
      ) : error ? (
        <div className="text-center text-red-500 py-12">{error}</div>
      ) : templates.length === 0 ? (
        <div className="text-center text-gray-400 py-12">등록된 템플릿이 없습니다.</div>
      ) : (
        <div className="space-y-3">
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex items-center justify-between gap-4 flex-wrap"
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="text-2xl mt-0.5">📄</div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{tpl.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    카테고리: {tpl.category} · 변수 {tpl.variables.length}개 · 수정: {formatDate(tpl.updatedAt)}
                  </p>
                  {tpl.variables.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {tpl.variables.slice(0, 5).map((v) => (
                        <span key={v} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono">
                          {`{{${v}}}`}
                        </span>
                      ))}
                      {tpl.variables.length > 5 && (
                        <span className="text-xs text-gray-400">+{tpl.variables.length - 5}개</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setPreviewModal(tpl)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  미리보기
                </button>
                <button
                  onClick={() => setEditModal(tpl)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50"
                >
                  편집
                </button>
                <button
                  onClick={() => setDeleteConfirm(tpl.id)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50"
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 편집 모달 */}
      {editModal !== false && (
        <TemplateModal
          initial={editModal}
          onSave={handleSave}
          onClose={() => setEditModal(false)}
        />
      )}

      {/* 미리보기 모달 */}
      {previewModal && (
        <PreviewModal template={previewModal} onClose={() => setPreviewModal(null)} />
      )}

      {/* 삭제 확인 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-bold text-gray-900 mb-2">템플릿 삭제</h3>
            <p className="text-sm text-gray-500 mb-5">이 템플릿을 삭제하면 복구할 수 없습니다. 계속하시겠습니까?</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors"
              >
                삭제
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
