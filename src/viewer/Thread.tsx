import { useEffect, useMemo, useRef, useState } from 'react';
import type { DoubtGraph, ThoughtNode } from '../lib/graph';
import { renderMarkdown } from './markdown';

export interface PendingAsk {
  surface: 'popover' | 'sidebar';
  parentId: string | null;
  question: string;
  text: string;
  status: 'loading' | 'streaming' | 'error';
  error?: string;
}

export function Md({ text, streaming }: { text: string; streaming?: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className={`md ${streaming ? 'caret' : ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function ConceptChips({
  graph,
  node,
  onConcept,
}: {
  graph: DoubtGraph;
  node: ThoughtNode;
  onConcept: (id: string) => void;
}) {
  const cs = node.conceptIds.map((id) => graph.concepts.get(id)).filter((c) => !!c);
  if (!cs.length) return null;
  return (
    <div className="chips">
      {cs.map((c) => (
        <button key={c!.id} className={`chip st-${c!.state}`} onClick={() => onConcept(c!.id)} title={c!.note}>
          {c!.name}
          {c!.nodeIds.length > 1 && <small> ·{c!.nodeIds.length}</small>}
        </button>
      ))}
    </div>
  );
}

/**
 * A conversation thread = path root → leaf in the doubt tree, plus the in-flight question.
 * `skipRoot` is used in the hover popover, which already shows the root explanation itself.
 */
export function ThreadView({
  graph,
  leafId,
  pending,
  skipRoot,
  onAsk,
  onConcept,
  onJump,
  onFocus,
  placeholder,
}: {
  graph: DoubtGraph;
  leafId: string | null;
  pending: PendingAsk | null;
  skipRoot?: boolean;
  onAsk: (q: string) => void;
  onConcept: (id: string) => void;
  onJump?: (page: number) => void;
  onFocus?: () => void;
  placeholder?: string;
}) {
  const path = leafId ? graph.pathTo(leafId) : [];
  const shown = skipRoot ? path.slice(1) : path;
  const leaf = path[path.length - 1];
  const followups = !pending && leaf ? leaf.followups : [];
  const [q, setQ] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [pending?.text, pending?.status, leafId]);

  const submit = (text: string) => {
    const t = text.trim();
    if (!t || (pending && pending.status !== 'error')) return;
    setQ('');
    onAsk(t);
  };

  return (
    <div className="thread">
      {shown.map((n) => (
        <div key={n.id} className="turn">
          <div className={`q ${n.kind}`}>
            {n.kind === 'hover' ? '✦ ' : ''}
            {n.question}
            {n.anchor && onJump && n.kind === 'hover' && (
              <button className="link pg" onClick={() => onJump(n.anchor!.page)}>
                p.{n.anchor.page}
              </button>
            )}
          </div>
          <Md text={n.answer} />
          <ConceptChips graph={graph} node={n} onConcept={onConcept} />
        </div>
      ))}
      {pending && (
        <div className="turn">
          <div className="q question">{pending.question}</div>
          {pending.status === 'loading' && (
            <div className="dots">
              <span />
              <span />
              <span />
            </div>
          )}
          {pending.status === 'streaming' && <Md text={pending.text} streaming />}
          {pending.status === 'error' && <p className="err">{pending.error}</p>}
        </div>
      )}
      {followups.length > 0 && (
        <div className="followups">
          {followups.map((f) => (
            <button key={f} onClick={() => submit(f)}>
              {f}
            </button>
          ))}
        </div>
      )}
      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={onFocus}
          placeholder={placeholder ?? (leaf ? 'Ask a follow-up…' : 'Ask anything about this PDF…')}
          disabled={!!pending && pending.status !== 'error'}
        />
        <button type="submit" disabled={!q.trim() || (!!pending && pending.status !== 'error')}>
          Ask
        </button>
      </form>
      <div ref={endRef} />
    </div>
  );
}
