'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import {
  type UserPart,
  loadUserParts,
  addUserPart,
  updateUserPart,
  deleteUserPart,
  exportUserPartsJSON,
  importUserPartsJSON,
} from './userPartsStore';

export interface UserPartsPanelProps {
  lang: string;
  onClose: () => void;
  currentShapeId: string;
  currentParams: Record<string, number>;
  currentFeatureGraphJson?: string;
  onLoadPart: (part: UserPart) => void;
  captureThumbnail?: () => string | null;
}

interface Translations {
  title: string; save: string; empty: string; load: string; delete: string;
  rename: string; export: string; import: string; search: string; namePh: string;
  confirmDelete: string; tags: string;
  importedN: (n: number) => string;
}

const dict: Record<'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar', Translations> = {
  ko: {
    title: '내 부품 라이브러리', save: '현재 저장', empty: '저장된 부품이 없습니다.',
    load: '불러오기', delete: '삭제', rename: '이름 변경', export: '내보내기',
    import: '가져오기', search: '검색...', namePh: '부품 이름',
    confirmDelete: '이 부품을 삭제하시겠습니까?',
    importedN: (n: number) => `${n}개의 부품을 가져왔습니다.`,
    tags: '태그 (쉼표 구분)',
  },
  en: {
    title: 'My Parts Library', save: 'Save Current', empty: 'No parts saved yet.',
    load: 'Load', delete: 'Delete', rename: 'Rename', export: 'Export JSON',
    import: 'Import JSON', search: 'Search...', namePh: 'Part name',
    confirmDelete: 'Delete this part?',
    importedN: (n: number) => `Imported ${n} parts.`,
    tags: 'Tags (comma-separated)',
  },
  ja: {
    title: 'マイパーツライブラリ', save: '現在を保存', empty: '保存されたパーツがありません。',
    load: '読み込む', delete: '削除', rename: '名前変更', export: 'JSONエクスポート',
    import: 'JSONインポート', search: '検索...', namePh: 'パーツ名',
    confirmDelete: 'このパーツを削除しますか？',
    importedN: (n: number) => `${n}個のパーツをインポートしました。`,
    tags: 'タグ (カンマ区切り)',
  },
  zh: {
    title: '我的零件库', save: '保存当前', empty: '尚未保存任何零件。',
    load: '加载', delete: '删除', rename: '重命名', export: '导出 JSON',
    import: '导入 JSON', search: '搜索...', namePh: '零件名称',
    confirmDelete: '删除此零件？',
    importedN: (n: number) => `已导入 ${n} 个零件。`,
    tags: '标签 (逗号分隔)',
  },
  es: {
    title: 'Mi Biblioteca de Piezas', save: 'Guardar Actual', empty: 'Sin piezas guardadas.',
    load: 'Cargar', delete: 'Eliminar', rename: 'Renombrar', export: 'Exportar JSON',
    import: 'Importar JSON', search: 'Buscar...', namePh: 'Nombre de pieza',
    confirmDelete: '¿Eliminar esta pieza?',
    importedN: (n: number) => `${n} piezas importadas.`,
    tags: 'Etiquetas (separadas por coma)',
  },
  ar: {
    title: 'مكتبة القطع الخاصة بي', save: 'حفظ الحالي', empty: 'لا توجد قطع محفوظة.',
    load: 'تحميل', delete: 'حذف', rename: 'إعادة تسمية', export: 'تصدير JSON',
    import: 'استيراد JSON', search: 'بحث...', namePh: 'اسم القطعة',
    confirmDelete: 'حذف هذه القطعة؟',
    importedN: (n: number) => `تم استيراد ${n} قطعة.`,
    tags: 'علامات (مفصولة بفواصل)',
  },
};

export default function UserPartsPanel({
  lang, onClose, currentShapeId, currentParams, currentFeatureGraphJson,
  onLoadPart, captureThumbnail,
}: UserPartsPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang;
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];
  const [parts, setParts] = useState<UserPart[]>([]);
  const [newName, setNewName] = useState('');
  const [newTags, setNewTags] = useState('');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  useEffect(() => { setParts(loadUserParts()); }, []);

  const refresh = useCallback(() => setParts(loadUserParts()), []);

  const handleSave = useCallback(() => {
    const name = newName.trim() || `Part ${parts.length + 1}`;
    const tags = newTags.split(',').map(s => s.trim()).filter(Boolean);
    addUserPart({
      name,
      shapeId: currentShapeId,
      params: { ...currentParams },
      featureGraphJson: currentFeatureGraphJson,
      thumbnail: captureThumbnail ? captureThumbnail() ?? undefined : undefined,
      tags,
    });
    setNewName(''); setNewTags('');
    refresh();
  }, [newName, newTags, parts.length, currentShapeId, currentParams, currentFeatureGraphJson, captureThumbnail, refresh]);

  const handleDelete = useCallback((id: string) => {
    if (!confirm(t.confirmDelete)) return;
    deleteUserPart(id);
    refresh();
  }, [refresh, t]);

  const handleRename = useCallback((id: string) => {
    if (!editingName.trim()) { setEditingId(null); return; }
    updateUserPart(id, { name: editingName.trim() });
    setEditingId(null); setEditingName('');
    refresh();
  }, [editingName, refresh]);

  const handleExport = useCallback(() => {
    void (async () => {
      const { downloadBlob } = await import('@/lib/platform');
      const json = exportUserPartsJSON();
      const blob = new Blob([json], { type: 'application/json' });
      await downloadBlob(`user-parts-${Date.now()}.json`, blob);
    })();
  }, []);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const n = importUserPartsJSON(text, 'merge');
      alert(t.importedN(n));
      refresh();
    };
    input.click();
  }, [refresh, t]);

  const filtered = query.trim()
    ? parts.filter(p => {
        const q = query.toLowerCase();
        return p.name.toLowerCase().includes(q)
          || p.shapeId.toLowerCase().includes(q)
          || (p.tags ?? []).some(tag => tag.toLowerCase().includes(q));
      })
    : parts;

  return (
    <div style={{
      position: 'fixed', top: 80, left: 20, width: 380, maxHeight: 'calc(100vh - 120px)',
      background: '#0d1117', border: '1px solid #30363d', borderRadius: 8,
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex',
      flexDirection: 'column', color: '#c9d1d9', fontSize: 13,
    }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong>📚 {t.title}</strong>
        <button onClick={onClose} style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ padding: 10, borderBottom: '1px solid #30363d' }}>
        <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder={t.namePh}
          style={{ width: '100%', background: '#161b22', border: '1px solid #30363d', borderRadius: 4, padding: '5px 8px', color: '#c9d1d9', marginBottom: 6 }} />
        <input type="text" value={newTags} onChange={e => setNewTags(e.target.value)} placeholder={t.tags}
          style={{ width: '100%', background: '#161b22', border: '1px solid #30363d', borderRadius: 4, padding: '5px 8px', color: '#c9d1d9', marginBottom: 6 }} />
        <button onClick={handleSave}
          style={{ width: '100%', background: '#238636', color: '#fff', border: 'none', borderRadius: 4, padding: '6px', cursor: 'pointer', fontWeight: 600 }}>
          💾 {t.save}
        </button>
      </div>

      <div style={{ padding: '6px 10px', borderBottom: '1px solid #30363d' }}>
        <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder={t.search}
          style={{ width: '100%', background: '#161b22', border: '1px solid #30363d', borderRadius: 4, padding: '4px 8px', color: '#c9d1d9', fontSize: 12 }} />
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#6e7681', fontSize: 12 }}>{t.empty}</div>
        ) : filtered.map(p => (
          <div key={p.id} style={{ padding: 8, marginBottom: 6, background: '#161b22', border: '1px solid #30363d', borderRadius: 6 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {p.thumbnail && (
                <img src={p.thumbnail} alt={p.name} style={{ width: 64, height: 64, borderRadius: 4, objectFit: 'cover', border: '1px solid #30363d' }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                {editingId === p.id ? (
                  <input type="text" value={editingName} onChange={e => setEditingName(e.target.value)}
                    onBlur={() => handleRename(p.id)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(p.id); if (e.key === 'Escape') setEditingId(null); }}
                    autoFocus
                    style={{ width: '100%', background: '#0d1117', border: '1px solid #58a6ff', borderRadius: 3, padding: '2px 4px', color: '#c9d1d9', fontSize: 12 }} />
                ) : (
                  <div style={{ fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                )}
                <div style={{ fontSize: 10, color: '#6e7681', marginBottom: 4 }}>{p.shapeId}</div>
                {p.tags && p.tags.length > 0 && (
                  <div style={{ fontSize: 10, marginBottom: 4 }}>
                    {p.tags.map(tag => (
                      <span key={tag} style={{ background: '#1f2d3f', color: '#58a6ff', padding: '1px 6px', borderRadius: 8, marginRight: 3 }}>#{tag}</span>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => onLoadPart(p)}
                    style={{ background: '#1f6feb', color: '#fff', border: 'none', borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>
                    ↻ {t.load}
                  </button>
                  <button onClick={() => { setEditingId(p.id); setEditingName(p.name); }}
                    style={{ background: 'transparent', color: '#8b949e', border: '1px solid #30363d', borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>
                    ✎
                  </button>
                  <button onClick={() => handleDelete(p.id)}
                    style={{ background: 'transparent', color: '#f85149', border: '1px solid #f85149', borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 11, marginLeft: 'auto' }}>
                    🗑
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: 8, borderTop: '1px solid #30363d', display: 'flex', gap: 4 }}>
        <button onClick={handleExport}
          style={{ flex: 1, background: 'transparent', color: '#58a6ff', border: '1px solid #30363d', borderRadius: 3, padding: '4px', cursor: 'pointer', fontSize: 11 }}>
          📥 {t.export}
        </button>
        <button onClick={handleImport}
          style={{ flex: 1, background: 'transparent', color: '#58a6ff', border: '1px solid #30363d', borderRadius: 3, padding: '4px', cursor: 'pointer', fontSize: 11 }}>
          📤 {t.import}
        </button>
      </div>
    </div>
  );
}
