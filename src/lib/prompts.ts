import type { Settings } from './settings';
import type { TargetKind } from './target';

export function explainSystemPrompt(title: string, brief: string | undefined, style: Settings['style']): string {
  const length =
    style === 'concise'
      ? 'Be fast and tight: 2–4 short sentences or a few bullets, under 120 words (equations/figures may use up to 170).'
      : 'Be thorough but readable: up to ~280 words, use short bullets where helpful.';
  return [
    'You are an expert reading companion built into a PDF viewer. The reader is pointing at one part of the document and wants to understand it.',
    '',
    'Rules:',
    '- Explain what the TARGET means and why it matters here. Do not just paraphrase it.',
    '- Define jargon, acronyms and symbols when they matter. Use the surrounding text and the document brief to resolve references like "Eq. 3", "this method", "above".',
    '- If an IMAGE is attached it is the exact rendering of the target: trust it over the extracted text (which may be garbled for math, tables and scans).',
    '- Write math as LaTeX: inline $...$, display $$...$$ on its own line.',
    '- If the text looks garbled (bad extraction/OCR), infer the intended meaning.',
    '- Never repeat the whole target back. No preamble like "This passage says". Light markdown only (bold, bullets, `code`).',
    `- ${length}`,
    '',
    `DOCUMENT TITLE: ${title || 'Untitled'}`,
    brief ? `DOCUMENT BRIEF (pre-built overview of the whole PDF):\n${brief}` : 'DOCUMENT BRIEF: not available yet.',
    '',
    META_INSTRUCTIONS,
  ].join('\n');
}

/** Appended to every answer so the doubt graph can tag concepts without an extra AI call. */
export const META_INSTRUCTIONS = [
  'AFTER your answer, on a new line, output exactly `<<<META` followed by one line of compact JSON:',
  '{"concepts":[{"name":"...","note":"..."}],"links":[["A","B","relation"]],"followups":["...","..."]}',
  '- concepts: 1–4 key concepts this answer is about. Short canonical names (e.g. "Hamiltonian", "Wavefunction normalization"). note = one-line definition. Reuse a name from KNOWN CONCEPTS when it is the same idea.',
  '- links: 0–3 meaningful relations between concepts (may include KNOWN CONCEPTS), relation in 1–4 words (e.g. "is derived from", "special case of").',
  '- followups: 2–3 short, *diverse* next questions the reader might have (one deeper, one broader/connecting, one practical/intuitive). Never just rephrase the question.',
  'The reader never sees the META line.',
].join('\n');

export function knownConceptsLine(names: string[]): string {
  return names.length ? `KNOWN CONCEPTS (already in the reader's notes): ${names.join('; ')}` : '';
}

export function tutorSystemPrompt(title: string, brief: string | undefined, style: Settings['style']): string {
  const length =
    style === 'concise'
      ? 'Aim for under ~180 words unless a derivation genuinely needs more.'
      : 'Up to ~400 words; use structure (short bullets, small steps).';
  return [
    'You are a patient, sharp tutor helping ONE reader understand a PDF they are studying. You keep a memory of their earlier doubts.',
    '',
    'How to answer:',
    '- Answer the CURRENT QUESTION directly first. It is the priority.',
    '- Use the thread so far to understand what they mean (e.g. "why?" refers to the previous answer).',
    '- RELATED NOTES are the reader’s earlier doubts/concepts. Use them only when they genuinely help: connect the new idea to something they already learned ("this is the same X you asked about on p.12"), or address a recurring confusion. Do NOT steer back to old topics, and do not mention notes that are irrelevant.',
    '- If the question goes beyond the document, answer from general knowledge and say so briefly.',
    '- Build intuition: plain-language idea → precise statement → tiny example or analogy when helpful.',
    '- Math in LaTeX: inline $...$, display $$...$$ on its own line. Light markdown only.',
    `- ${length}`,
    '',
    `DOCUMENT TITLE: ${title || 'Untitled'}`,
    brief ? `DOCUMENT BRIEF:\n${brief}` : '',
    '',
    META_INSTRUCTIONS,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export function tutorUserPrompt(o: {
  question: string;
  thread: { q: string; a: string; page?: number }[];
  related: { name: string; note: string; state: string; pages: number[]; links: string[] }[];
  passage?: { page: number; kind: string; text: string };
  known: string[];
}): string {
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
  return [
    o.passage ? `PASSAGE the thread started from (p.${o.passage.page}, ${o.passage.kind}):\n"""${clip(o.passage.text, 1200)}"""` : '',
    o.thread.length
      ? `THREAD SO FAR (oldest → newest):\n${o.thread
          .map((t, i) => `${i + 1}. Q: ${clip(t.q, 200)}\n   A: ${clip(t.a, i === o.thread.length - 1 ? 900 : 350)}`)
          .join('\n')}`
      : '',
    o.related.length
      ? `RELATED NOTES (reader's earlier doubts; use only if relevant):\n${o.related
          .map(
            (c) =>
              `- ${c.name} [${c.state}${c.pages.length ? `, p.${c.pages.slice(0, 4).join(',')}` : ''}]: ${clip(c.note, 140)}${
                c.links.length ? ` (links: ${c.links.join('; ')})` : ''
              }`,
          )
          .join('\n')}`
      : '',
    knownConceptsLine(o.known),
    `CURRENT QUESTION: ${o.question}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const TASK: Record<TargetKind, string> = {
  word: 'Define this word/term/symbol AS USED IN THIS DOCUMENT, in 1–3 sentences. Mention the general meaning only if it differs.',
  sentence: 'Explain this sentence in context: what it claims and why it matters here.',
  paragraph: 'Explain this paragraph: its main point and how it fits the surrounding argument.',
  heading: 'Explain what this section is about and what the reader should expect from it.',
  caption: 'Explain what this caption describes and the takeaway of the figure/table it belongs to.',
  math:
    'This is an equation. 1) Rewrite it cleanly in LaTeX ($$...$$). 2) Say in plain words what it states/computes. 3) Briefly define each symbol (bullets). 4) One line on intuition or why it matters here.',
  figure:
    'This is a figure/diagram/chart. Describe what it shows (type, axes/components), the key trend or relationships, and the main takeaway in context.',
  table: 'This is a table. Say what it compares (rows/columns), the most important numbers or patterns, and the takeaway.',
  region:
    'This is a region of a scanned page (image only). Read the content in the image and explain it; if it is math, give LaTeX.',
};

export function explainUserPrompt(o: {
  page: number;
  kind: TargetKind;
  before: string;
  target: string;
  after: string;
  caption?: string;
  hasImage: boolean;
  ocr?: boolean;
}): string {
  const label = o.kind === 'math' ? 'EQUATION' : o.kind === 'figure' || o.kind === 'table' ? o.kind.toUpperCase() : 'TARGET';
  const targetText =
    o.target.trim() ||
    (o.hasImage ? '(no extractable text — see attached image)' : '(no extractable text)');
  return [
    `Page ${o.page}. TASK: ${TASK[o.kind]}`,
    o.hasImage ? 'An image of the target region is attached.' : '',
    o.ocr ? 'Note: text on this page comes from OCR and may contain recognition errors.' : '',
    o.caption ? `CAPTION: """${o.caption}"""` : '',
    o.before ? `TEXT BEFORE:\n"""${o.before}"""` : '',
    `${label}${o.kind === 'figure' || o.kind === 'table' ? ' (extracted labels/cells)' : ''} (explain this):\n"""${targetText}"""`,
    o.after ? `TEXT AFTER:\n"""${o.after}"""` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const BRIEF_SYSTEM =
  'You create compact reference briefs of documents so another assistant can explain any passage quickly. Output plain text, no preamble.';

export function briefUserPrompt(title: string, numPages: number, sample: string): string {
  return [
    `Title: ${title || 'Untitled'} (${numPages} pages). Below is text sampled from the document (beginning, headings, and spread-out excerpts).`,
    '',
    'Write a brief of at most 220 words with these sections:',
    'WHAT: one or two sentences on what the document is and its main claim/purpose.',
    'FIELD & AUDIENCE: domain, assumed background.',
    'STRUCTURE: main sections in order.',
    'KEY TERMS: the most important terms, acronyms and symbols with one-line definitions.',
    '',
    '"""',
    sample,
    '"""',
  ].join('\n');
}
