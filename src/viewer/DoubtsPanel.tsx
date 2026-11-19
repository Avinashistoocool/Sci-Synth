import { useState } from 'react';
import type { Concept, DoubtGraph, ThoughtNode, Understanding } from '../lib/graph';

const STATE_LABEL: Record<Understanding, string> = { new: 'New', shaky: 'Shaky', understood: 'Got it' };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function TreeNode({
  graph,
  node,
  activeId,
  onOpen,
  depth,
}: {
  graph: DoubtGraph;
  node: ThoughtNode;
  activeId: string | null;
  onOpen: (id: string) => void;
  depth: number;
}) {
  const kids = graph.children(node.id);
  const [open, setOpen] = useState(depth < 2);
  return (
    <li>
      <div className={`tn ${activeId === node.id ? 'active' : ''}`}>
        {kids.length > 0 ? (
          <button className="tw" onClick={() => setOpen((v) => !v)}>
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tw" />
        )}
        <button className="tl" onClick={() => onOpen(node.id)} title={node.question}>
          <span className={`ti ${node.kind}`}>{node.kind === 'hover' ? '✦' : '?'}</span>
          {clip(node.kind === 'hover' && node.anchor ? node.anchor.text : node.question, 70)}
          {node.anchor && <small> p.{node.anchor.page}</small>}
        </button>
      </div>
      {open && kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <TreeNode key={k.id} graph={graph} node={k} activeId={activeId} onOpen={onOpen} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function DoubtTree({
  graph,
  activeId,
  onOpen,
}: {
  graph: DoubtGraph;
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  const [limit, setLimit] = useState(25);
  const [onlyQuestions, setOnlyQuestions] = useState(false);
  const roots = graph
    .roots()
    .filter((r) => !onlyQuestions || r.kind === 'question' || graph.children(r.id).length > 0);
  if (!graph.nodes.size) return <p className="muted">Nothing yet. Explanations and questions you ask build up here.</p>;
  return (
    <>
      <label className="mini-check">
        <input type="checkbox" checked={onlyQuestions} onChange={(e) => setOnlyQuestions(e.target.checked)} />
        Only threads with questions
      </label>
      <ul className="tree">
        {roots.slice(0, limit).map((r) => (
          <TreeNode key={r.id} graph={graph} node={r} activeId={activeId} onOpen={onOpen} depth={0} />
        ))}
      </ul>
      {roots.length > limit && (
        <button className="link" onClick={() => setLimit((l) => l + 25)}>
          Show more ({roots.length - limit})
        </button>
      )}
    </>
  );
}

export function ConceptList({
  graph,
  openId,
  setOpenId,
  onOpenNode,
  onJump,
}: {
  graph: DoubtGraph;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onOpenNode: (id: string) => void;
  onJump: (page: number) => void;
}) {
  const order: Record<Understanding, number> = { shaky: 0, new: 1, understood: 2 };
  const list = [...graph.concepts.values()].sort(
    (a, b) => order[a.state] - order[b.state] || b.nodeIds.length - a.nodeIds.length || b.updatedAt - a.updatedAt,
  );
  if (!list.length) return <p className="muted">Concepts appear as you explore.</p>;
  return (
    <ul className="concepts">
      {list.map((c) => (
        <ConceptRow
          key={c.id}
          graph={graph}
          c={c}
          open={openId === c.id}
          toggle={() => setOpenId(openId === c.id ? null : c.id)}
          onOpenNode={onOpenNode}
          onConcept={setOpenId}
          onJump={onJump}
        />
      ))}
    </ul>
  );
}

function ConceptRow({
  graph,
  c,
  open,
  toggle,
  onOpenNode,
  onConcept,
  onJump,
}: {
  graph: DoubtGraph;
  c: Concept;
  open: boolean;
  toggle: () => void;
  onOpenNode: (id: string) => void;
  onConcept: (id: string) => void;
  onJump: (page: number) => void;
}) {
  const related = Object.entries(c.related)
    .map(([id, e]) => ({ c: graph.concepts.get(id), ...e }))
    .filter((x) => x.c)
    .sort((a, b) => b.w - a.w)
    .slice(0, 6);
  const nodes = c.nodeIds.map((id) => graph.nodes.get(id)).filter((n): n is ThoughtNode => !!n);
  return (
    <li className={`cr ${open ? 'open' : ''}`} id={`concept-${CSS.escape(c.id)}`}>
      <button className="ch" onClick={toggle}>
        <span className={`dot st-${c.state}`} />
        <span className="cn">{c.name}</span>
        <small>{c.nodeIds.length}</small>
      </button>
      {open && (
        <div className="cd">
          {c.note && <p>{c.note}</p>}
          <div className="states">
            {(['new', 'shaky', 'understood'] as Understanding[]).map((s) => (
              <button key={s} className={c.state === s ? `on st-${s}` : ''} onClick={() => void graph.setState(c.id, s)}>
                {STATE_LABEL[s]}
              </button>
            ))}
          </div>
          {c.pages.length > 0 && (
            <div className="row-links">
              Pages:{' '}
              {[...c.pages]
                .sort((a, b) => a - b)
                .map((p) => (
                  <button key={p} className="link" onClick={() => onJump(p)}>
                    {p}
                  </button>
                ))}
            </div>
          )}
          {related.length > 0 && (
            <div className="chips">
              {related.map((r) => (
                <button key={r.c!.id} className={`chip st-${r.c!.state}`} onClick={() => onConcept(r.c!.id)} title={r.rel}>
                  {r.rel ? <i>{r.rel} </i> : '↔ '}
                  {r.c!.name}
                </button>
              ))}
            </div>
          )}
          <ul className="cnodes">
            {nodes.map((n) => (
              <li key={n.id}>
                <button className="link" onClick={() => onOpenNode(n.id)}>
                  {n.kind === 'hover' ? '✦ ' : '? '}
                  {clip(n.question, 80)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
