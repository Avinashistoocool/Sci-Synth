const ABBREV = new Set(
  [
    'e.g', 'i.e', 'al', 'etc', 'vs', 'cf', 'fig', 'figs', 'eq', 'eqs', 'sec', 'secs', 'tab', 'ref', 'refs', 'no',
    'dr', 'mr', 'mrs', 'ms', 'prof', 'approx', 'resp', 'viz', 'ch', 'pp', 'vol', 'thm', 'def', 'prop', 'lem', 'alg',
    'eqn', 'app', 'st', 'jr', 'inc', 'ltd', 'co', 'resp',
  ].map((s) => s.toLowerCase()),
);

/** Splits text into sentence [start, end) spans, aware of common abbreviations, initials and decimals. */
export function sentenceSpans(text: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /[.!?]+["')\]\u201D]*\s+(?=["'(\[\u201C]?[A-Z0-9\u0391-\u03A9])/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const before = text.slice(start, m.index);
    const lastWord = /([A-Za-z.]+)$/.exec(before)?.[1] ?? '';
    if (ABBREV.has(lastWord.toLowerCase()) || /^[A-Z]$/.test(lastWord)) continue;
    const end = m.index + m[0].trimEnd().length;
    if (end - start > 1) out.push([start, end]);
    start = m.index + m[0].length;
  }
  if (start < text.length) out.push([start, text.length]);
  return out.length ? out : [[0, text.length]];
}

const WORD_CHAR = /[\p{L}\p{N}_\u2019'\-]/u;

/** Word around a character offset, or null if the offset isn't on a word. */
export function wordAt(text: string, offset: number): { start: number; end: number; word: string } | null {
  if (offset >= text.length) offset = text.length - 1;
  if (offset < 0 || !WORD_CHAR.test(text[offset] ?? '')) {
    if (offset > 0 && WORD_CHAR.test(text[offset - 1])) offset -= 1;
    else return null;
  }
  let s = offset;
  let e = offset + 1;
  while (s > 0 && WORD_CHAR.test(text[s - 1])) s--;
  while (e < text.length && WORD_CHAR.test(text[e])) e++;
  while (s < e && /['\u2019\-]/.test(text[s])) s++;
  while (e > s && /['\u2019\-]/.test(text[e - 1])) e--;
  const word = text.slice(s, e);
  return word ? { start: s, end: e, word } : null;
}
