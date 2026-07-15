'use client';

/**
 * Md — 의존성 없는 초경량 마크다운 렌더러(챗 말풍선용).
 * dangerouslySetInnerHTML 미사용: 전부 React 요소로 조립해 XSS 표면이 없다.
 * 지원 서브셋: 제목(#~###), 굵게/기울임, `code`, ``` 블록, - / 1. 리스트,
 * | 표 |, 링크 [t](https://…)(http(s)만), 수평선. 그 외는 문단 그대로.
 */

import React from 'react';

const CODE_BG = 'rgba(127,127,127,0.16)';

function inline(text: string, keyBase: string): React.ReactNode[] {
  // 토큰 우선순위: `code` → **bold** → *italic* → [link](url)
  const out: React.ReactNode[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;
  let last = 0; let m: RegExpExecArray | null; let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${k++}`;
    if (tok.startsWith('`')) {
      out.push(<code key={key} style={{ background: CODE_BG, borderRadius: 4, padding: '1px 5px', fontSize: '0.92em' }}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**')) {
      out.push(<b key={key}>{tok.slice(2, -2)}</b>);
    } else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(tok);
      if (mm) out.push(<a key={key} href={mm[2]} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--nx-accent, #2563eb)', textDecoration: 'underline' }}>{mm[1]}</a>);
      else out.push(tok);
    } else {
      out.push(<i key={key}>{tok.slice(1, -1)}</i>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Md({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0; let k = 0;
  const P_STYLE: React.CSSProperties = { margin: '0.15em 0', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' };

  while (i < lines.length) {
    const line = lines[i];

    // ``` 코드 블록
    if (/^```/.test(line)) {
      const buf: string[] = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // 닫는 ```
      blocks.push(<pre key={k++} style={{ background: CODE_BG, borderRadius: 8, padding: '8px 10px', overflowX: 'auto', fontSize: '0.9em', margin: '6px 0' }}>{buf.join('\n')}</pre>);
      continue;
    }

    // | 표 | — 헤더행+구분행 필수
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const parseRow = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = parseRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(parseRow(lines[i])); i++; }
      blocks.push(
        <div key={k++} style={{ overflowX: 'auto', margin: '6px 0' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.92em', minWidth: 240 }}>
            <thead><tr>{head.map((h, j) => <th key={j} style={{ border: '1px solid var(--nx-border, #d0d5dc)', padding: '4px 8px', textAlign: 'left', background: CODE_BG }}>{inline(h, `th${k}-${j}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, j) => <td key={j} style={{ border: '1px solid var(--nx-border, #d0d5dc)', padding: '4px 8px' }}>{inline(r[j] ?? '', `td${k}-${ri}-${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 리스트(- · 1.) — 연속 구간 묶기
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')); i++; }
      const Li = items.map((it, j) => <li key={j} style={{ margin: '2px 0', lineHeight: 1.5 }}>{inline(it, `li${k}-${j}`)}</li>);
      blocks.push(ordered
        ? <ol key={k++} style={{ margin: '4px 0', paddingLeft: 22 }}>{Li}</ol>
        : <ul key={k++} style={{ margin: '4px 0', paddingLeft: 20 }}>{Li}</ul>);
      continue;
    }

    // 제목 / 수평선 / 문단
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const size = h[1].length === 1 ? '1.15em' : h[1].length === 2 ? '1.07em' : '1em';
      blocks.push(<div key={k++} style={{ fontWeight: 800, fontSize: size, margin: '8px 0 3px' }}>{inline(h[2], `h${k}`)}</div>);
    } else if (/^\s*(---+|___+)\s*$/.test(line)) {
      blocks.push(<hr key={k++} style={{ border: 'none', borderTop: '1px solid var(--nx-border, #d0d5dc)', margin: '8px 0' }} />);
    } else if (line.trim() === '') {
      blocks.push(<div key={k++} style={{ height: 6 }} />);
    } else {
      blocks.push(<div key={k++} style={P_STYLE}>{inline(line, `p${k}`)}</div>);
    }
    i++;
  }
  return <div>{blocks}</div>;
}
