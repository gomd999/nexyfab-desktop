import { Fragment, type ReactNode } from 'react';

// Renders a translation string that contains inline HTML (<br>, <b>, <strong>,
// <em>) as safe React nodes.
//
// Why this exists: translation dictionaries historically embed "<br/>" or
// "<b>..</b>" because that is the easiest way to carry wrapped copy across
// locales. Using `dangerouslySetInnerHTML` to render those accumulates XSS
// surface area and breaks when strings later drift to user-sourced content.
//
// Supported tags: <br>, <br/>, <b>..</b>, <strong>..</strong>, <em>..</em>.
// Anything else is rendered as plain text (tags visible) so that unsupported
// markup is obvious and review-able rather than silently injected.

const INLINE_TAG_RE = /<(br\s*\/?|\/?b|\/?strong|\/?em)>/gi;

export function richText(input: string | null | undefined): ReactNode {
  if (!input) return null;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  const stack: { tag: 'b' | 'em'; start: number; buf: ReactNode[] }[] = [];
  let current: ReactNode[] = nodes;

  const pushText = (text: string) => {
    if (text) current.push(text);
  };

  const matches = [...input.matchAll(INLINE_TAG_RE)];
  for (const m of matches) {
    const token = m[1].toLowerCase();
    pushText(input.slice(cursor, m.index));
    cursor = (m.index ?? 0) + m[0].length;

    if (token.startsWith('br')) {
      current.push(<br key={`br-${key++}`} />);
    } else if (token === 'b' || token === 'strong') {
      stack.push({ tag: 'b', start: cursor, buf: current });
      current = [];
    } else if (token === '/b' || token === '/strong') {
      const frame = stack.pop();
      if (frame) {
        const inner = current;
        current = frame.buf;
        current.push(<strong key={`b-${key++}`}>{inner}</strong>);
      }
    } else if (token === 'em') {
      stack.push({ tag: 'em', start: cursor, buf: current });
      current = [];
    } else if (token === '/em') {
      const frame = stack.pop();
      if (frame) {
        const inner = current;
        current = frame.buf;
        current.push(<em key={`em-${key++}`}>{inner}</em>);
      }
    }
  }
  pushText(input.slice(cursor));

  // Unbalanced tags: flush remaining stack back as plain text-safe JSX.
  while (stack.length) {
    const frame = stack.pop()!;
    const inner = current;
    current = frame.buf;
    current.push(<Fragment key={`unclosed-${key++}`}>{inner}</Fragment>);
  }

  return <>{nodes}</>;
}
