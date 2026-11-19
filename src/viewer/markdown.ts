import katex from 'katex';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const mathCache = new Map<string, string>();
function tex(src: string, display: boolean): string {
  const k = `${display ? 'D' : 'I'}${src}`;
  let html = mathCache.get(k);
  if (html === undefined) {
    try {
      html = katex.renderToString(src, { displayMode: display, throwOnError: false, output: 'html', strict: 'ignore' });
    } catch {
      html = `<code>${escape(src)}</code>`;
    }
    if (mathCache.size > 500) mathCache.clear();
    mathCache.set(k, html);
  }
  return html;
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}

/**
 * Tiny, safe (escape-first) markdown renderer for streamed LLM output, with KaTeX math.
 * Math is pulled out before escaping and replaced by placeholders so markdown rules can't touch it.
 */
export function renderMarkdown(md: string): string {
  const math: string[] = [];
  const hold = (html: string) => `\u0000${math.push(html) - 1}\u0000`;
  let src = md
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => `\n${hold(tex(m.trim(), true))}\n`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n${hold(tex(m.trim(), true))}\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => hold(tex(m.trim(), false)))
    .replace(/(^|[^\\$\w])\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?![\w$])/g, (_, pre, m) => pre + hold(tex(m, false)));
  // Hide an unterminated $$ block while streaming instead of flashing raw LaTeX.
  const open = src.lastIndexOf('$$');
  if (open >= 0) src = `${src.slice(0, open)}\n${hold('<span class="math-pending">…</span>')}`;

  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };

  for (const raw of escape(src).split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const head = /^#{1,6}\s+(.*)$/.exec(line);
    if (bullet || num) {
      const kind = bullet ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((bullet ?? num)![1])}</li>`);
    } else if (head) {
      closeList();
      out.push(`<h4>${inline(head[1])}</h4>`);
    } else if (!line.trim()) {
      closeList();
    } else if (/^\u0000\d+\u0000$/.test(line.trim())) {
      closeList();
      out.push(`<div class="math-display">${line.trim()}</div>`);
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => math[Number(i)]);
}
