import { useEffect, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { flushSync } from 'react-dom';
import type { Element, ElementContent } from 'hast';
import { highlightCode } from './markdown-math';
import { observeCodeHighlight, preserveCodeHighlightRanges } from './viewport-highlight';

function highlightable(className: string | undefined) {
  const classes = className?.split(/\s+/) ?? [];
  return !classes.some(value => value === 'nohighlight' || value === 'no-highlight')
    && classes.some(value => /^(?:lang|language)-.+/.test(value));
}

export function pendingCodeClassName(className: string | undefined) {
  return highlightable(className) && !className?.split(/\s+/).includes('hljs') ? `hljs ${className}` : className;
}

function tokens(children: ElementContent[]): ReactNode {
  return children.map((child, index) => child.type === 'text' ? child.value
    : child.type === 'element' && child.tagName === 'span'
      ? <span key={index} className={Array.isArray(child.properties.className) ? child.properties.className.join(' ') : undefined}>
        {tokens(child.children)}
      </span> : null);
}

export function useViewportCodeHighlight(ref: RefObject<HTMLElement | null>, text: string | undefined, className: string | undefined) {
  const [result, setResult] = useState<{ text: string; className: string; node: Element }>();
  useEffect(() => {
    const element = ref.current;
    if (!element || text === undefined || !className || !highlightable(className)) return;
    return observeCodeHighlight(element, () => {
      let node: Element;
      try { node = highlightCode(text, className); }
      catch { return; } // A coloring failure must leave the complete, copyable source readable.
      // Commit while the queue's selection/pointer check still holds, not in a later React task.
      preserveCodeHighlightRanges(element, () => flushSync(() => setResult({ text, className, node })));
    });
  }, [ref, text, className]);
  if (!result || result.text !== text || result.className !== className) return undefined;
  return { className: (result.node.properties.className as string[]).join(' '), children: tokens(result.node.children) };
}
