// Partner agreement v1.0 — public render of the source markdown.
//
// Renders the canonical partner-agreement-v1.md content as HTML so we can
// link to a stable URL (`/legal/partner-agreement`) instead of exposing
// the raw .md file. The source file remains the single edit point — this
// route just wraps it in a printable layout.

import fs from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-static';

async function loadAgreement(): Promise<string> {
  const filePath = path.join(process.cwd(), 'public', 'legal', 'partner-agreement-v1.md');
  return fs.readFile(filePath, 'utf-8');
}

// Minimal markdown → HTML transform. Covers headings, bullets, bold,
// links, and paragraphs — sufficient for legal text we author ourselves.
function renderMarkdown(md: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^### /.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h3>${escape(line.slice(4))}</h3>`);
    } else if (/^## /.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h2>${escape(line.slice(3))}</h2>`);
    } else if (/^# /.test(line)) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h1>${escape(line.slice(2))}</h1>`);
    } else if (/^[-*] /.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${formatInline(escape(line.slice(2)))}</li>`);
    } else if (line === '') {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push('');
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<p>${formatInline(escape(line))}</p>`);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

function formatInline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export default async function PartnerAgreementPage() {
  const md = await loadAgreement().catch(() => '# Partner agreement\n\n약관 파일을 불러올 수 없습니다.');
  const html = renderMarkdown(md);
  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '40px 20px', fontFamily: 'system-ui, sans-serif', color: '#1f2937', lineHeight: 1.7 }}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <hr style={{ margin: '40px 0', border: 'none', borderTop: '1px solid #e5e7eb' }} />
      <p style={{ fontSize: 12, color: '#6b7280' }}>
        이 페이지는 NexyFab 파트너 약관 v1.0의 공식 공개본입니다.
        문의: <a href="mailto:nexyfab@nexysys.com">nexyfab@nexysys.com</a>
      </p>
    </main>
  );
}
