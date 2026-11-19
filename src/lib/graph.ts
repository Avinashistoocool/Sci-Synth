import { graphStore } from './db';

/**
 * Per-PDF "doubt graph":
 *  - ThoughtNodes form a forest (each thread = a root + follow-up branches).
 *  - Concepts are the graph layer: nodes tag concepts, concepts link to each other
 *    (co-occurrence + AI-declared relations). Retrieval walks this graph to give the
 *    tutor *relevant* memory instead of the whole history.
 */

export interface NodeAnchor {
  page: number;
  kind: string;
  text: string;
}

export interface ThoughtNode {
  id: string;
  fp: string;
  parentId: string | null;
  rootId: string;
  kind: 'hover' | 'question';
  /** The doubt as the reader asked it (or "Explain …" for hovers). */
  question: string;
  anchor?: NodeAnchor;
  /** Stable key of the hovered target, to avoid duplicate hover nodes. */
  targetKey?: string;
  answer: string;
  conceptIds: string[];
  followups: string[];
  createdAt: number;
}

export type Understanding = 'new' | 'shaky' | 'understood';

export interface Concept {
  id: string;
  fp: string;
  name: string;
  note: string;
  aliases: string[];
  nodeIds: string[];
  pages: number[];
  related: Record<string, { w: number; rel?: string }>;
  /** Times the reader asked a question (not a hover) touching this concept. */
  doubts: number;
  state: Understanding;
  /** True once the reader set the state by hand (stop auto-updating it). */
  manual?: boolean;
  updatedAt: number;
}

export interface Meta {
  concepts: { name: string; note?: string }[];
  links: [string, string, string?][];
  followups: string[];
}

// ---------------------------------------------------------------------------
// text helpers
// ---------------------------------------------------------------------------

const STOP = new Set(
  'the a an and or but of to in on at for from by with as is are was were be been being this that these those it its into than then there their they them we you your our i me my what why how when where which who whom does do did can could should would will shall may might must not no yes also just about over under between more most less very such any each some all both either neither so if else because while explain mean means meaning page here thing things'.split(
    ' ',
  ),
);

export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

export const conceptKey = (name: string) => tokens(name).join(' ') || name.toLowerCase().trim();

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------------------
// meta block (appended by the model after its answer)
// ---------------------------------------------------------------------------

export const META_MARK = '<<<META';

/** Visible part of a streamed answer (hides the trailing metadata, even when half-streamed). */
export function visibleAnswer(raw: string): string {
  const i = raw.indexOf(META_MARK);
  if (i >= 0) return raw.slice(0, i).trimEnd();
  for (let k = Math.min(META_MARK.length - 1, raw.length); k > 0; k--) {
    if (raw.endsWith(META_MARK.slice(0, k))) return raw.slice(0, -k).trimEnd();
  }
  return raw;
}

export function parseMeta(raw: string): Meta | null {
  const i = raw.indexOf(META_MARK);
  if (i < 0) return null;
  const rest = raw.slice(i + META_MARK.length);
  const s = rest.indexOf('{');
  const e = rest.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  const body = rest.slice(s, e + 1);
  let j: Partial<Meta> | null = null;
  for (const attempt of [body, body.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')]) {
    try {
      j = JSON.parse(attempt);
      break;
    } catch {
      /* try next */
    }
  }
  if (!j) return null;
  const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
  return {
    concepts: (Array.isArray(j.concepts) ? j.concepts : [])
      .map((c) => (typeof c === 'string' ? { name: c } : { name: str(c?.name), note: str(c?.note) }))
      .filter((c) => c.name && c.name.length <= 60)
      .slice(0, 5),
    links: (Array.isArray(j.links) ? j.links : [])
      .filter((l) => Array.isArray(l) && l.length >= 2)
      .map((l) => [str(l[0]), str(l[1]), str(l[2]) || undefined] as [string, string, string?])
      .slice(0, 6),
    followups: (Array.isArray(j.followups) ? j.followups : []).map(str).filter(Boolean).slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// graph
// ---------------------------------------------------------------------------

export interface TutorContext {
  path: ThoughtNode[];
  concepts: Concept[];
  knownNames: string[];
}

export class DoubtGraph {
  nodes = new Map<string, ThoughtNode>();
  concepts = new Map<string, Concept>();
  private listeners = new Set<() => void>();
  version = 0;

  private constructor(readonly fp: string) {}

  static async load(fp: string): Promise<DoubtGraph> {
    const g = new DoubtGraph(fp);
    const { nodes, concepts } = await graphStore.load(fp);
    for (const n of nodes) g.nodes.set(n.id, n);
    for (const c of concepts) g.concepts.set(c.id, c);
    return g;
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private changed() {
    this.version++;
    for (const l of this.listeners) l();
  }

  // ---- tree ----------------------------------------------------------------

  roots(): ThoughtNode[] {
    return [...this.nodes.values()].filter((n) => !n.parentId).sort((a, b) => b.createdAt - a.createdAt);
  }

  children(id: string): ThoughtNode[] {
    return [...this.nodes.values()].filter((n) => n.parentId === id).sort((a, b) => a.createdAt - b.createdAt);
  }

  pathTo(id: string): ThoughtNode[] {
    const out: ThoughtNode[] = [];
    for (let n = this.nodes.get(id); n; n = n.parentId ? this.nodes.get(n.parentId) : undefined) out.unshift(n);
    return out;
  }

  findHover(targetKey: string) {
    for (const n of this.nodes.values()) if (n.kind === 'hover' && n.targetKey === targetKey) return n;
    return undefined;
  }

  createNode(p: Omit<ThoughtNode, 'id' | 'fp' | 'rootId' | 'conceptIds' | 'followups' | 'createdAt' | 'answer'> & { answer?: string }) {
    const id = uid();
    const parent = p.parentId ? this.nodes.get(p.parentId) : undefined;
    const node: ThoughtNode = {
      answer: '',
      ...p,
      id,
      fp: this.fp,
      rootId: parent?.rootId ?? id,
      conceptIds: [],
      followups: [],
      createdAt: Date.now(),
    };
    this.nodes.set(id, node);
    this.changed();
    return node;
  }

  /** Store the final answer + apply the model's metadata to the concept graph. */
  async complete(id: string, rawAnswer: string) {
    const node = this.nodes.get(id);
    if (!node) return;
    const meta = parseMeta(rawAnswer);
    node.answer = visibleAnswer(rawAnswer);
    if (meta) {
      node.followups = meta.followups;
      node.conceptIds = meta.concepts.map((c) => this.upsertConcept(c.name, c.note, node).id);
      // Co-occurrence: concepts discussed in the same answer are related.
      const ids = [...new Set(node.conceptIds)];
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) this.link(ids[a], ids[b], 1);
      // Thread structure: a follow-up's concepts relate to its parent's concepts (weaker).
      const parent = node.parentId ? this.nodes.get(node.parentId) : undefined;
      for (const a of ids) for (const b of parent?.conceptIds ?? []) if (a !== b) this.link(a, b, 0.5);
      for (const [x, y, rel] of meta.links) {
        const cx = this.findConcept(x) ?? this.upsertConcept(x, undefined, node);
        const cy = this.findConcept(y) ?? this.upsertConcept(y, undefined, node);
        if (cx.id !== cy.id) this.link(cx.id, cy.id, 2, rel);
      }
    }
    await graphStore.putNode(node);
    await Promise.all(
      [...new Set([...node.conceptIds, ...(meta?.links.flatMap(([x, y]) => [x, y]) ?? [])])]
        .map((k) => this.concepts.get(k) ?? this.findConcept(k))
        .filter((c): c is Concept => !!c)
        .map((c) => graphStore.putConcept(c)),
    );
    this.changed();
  }

  findConcept(name: string): Concept | undefined {
    const k = conceptKey(name);
    const direct = this.concepts.get(`${this.fp}:${k}`);
    if (direct) return direct;
    for (const c of this.concepts.values()) if (c.aliases.includes(k)) return c;
    return undefined;
  }

  private upsertConcept(name: string, note: string | undefined, node: ThoughtNode): Concept {
    let c = this.findConcept(name);
    if (!c) {
      const k = conceptKey(name);
      c = {
        id: `${this.fp}:${k}`,
        fp: this.fp,
        name,
        note: note ?? '',
        aliases: [k],
        nodeIds: [],
        pages: [],
        related: {},
        doubts: 0,
        state: 'new',
        updatedAt: Date.now(),
      };
      this.concepts.set(c.id, c);
    }
    if (note && (!c.note || c.note.length < 20)) c.note = note;
    if (!c.nodeIds.includes(node.id)) {
      c.nodeIds.push(node.id);
      if (node.kind === 'question') c.doubts++;
    }
    if (node.anchor && !c.pages.includes(node.anchor.page)) c.pages.push(node.anchor.page);
    if (!c.manual && c.doubts >= 3) c.state = 'shaky';
    c.updatedAt = Date.now();
    return c;
  }

  private link(a: string, b: string, w: number, rel?: string) {
    const ca = this.concepts.get(a);
    const cb = this.concepts.get(b);
    if (!ca || !cb) return;
    const ea = (ca.related[b] ??= { w: 0 });
    const eb = (cb.related[a] ??= { w: 0 });
    ea.w += w;
    eb.w += w;
    if (rel) ea.rel = rel;
  }

  async setState(conceptId: string, state: Understanding) {
    const c = this.concepts.get(conceptId);
    if (!c) return;
    c.state = state;
    c.manual = true;
    c.updatedAt = Date.now();
    await graphStore.putConcept(c);
    this.changed();
  }

  async deleteThread(id: string) {
    const doomed: string[] = [];
    const walk = (n: string) => {
      doomed.push(n);
      for (const ch of this.children(n)) walk(ch.id);
    };
    walk(id);
    const gone = new Set(doomed);
    for (const n of doomed) this.nodes.delete(n);
    const dead: string[] = [];
    for (const c of this.concepts.values()) {
      c.nodeIds = c.nodeIds.filter((n) => !gone.has(n));
      if (!c.nodeIds.length) dead.push(c.id);
    }
    for (const d of dead) this.concepts.delete(d);
    for (const c of this.concepts.values()) for (const d of dead) delete c.related[d];
    await graphStore.deleteNodes(doomed);
    await graphStore.deleteConcepts(dead);
    await Promise.all([...this.concepts.values()].map((c) => graphStore.putConcept(c)));
    this.changed();
  }

  // ---- retrieval -----------------------------------------------------------

  /**
   * Memory for the tutor: the thread path (nearest ancestors only) + the concepts most
   * relevant to *this* question (+1 hop of strong neighbours). Bounded on purpose so the
   * model isn't dragged back to old topics.
   */
  contextFor(question: string, parentId: string | null, anchor?: NodeAnchor): TutorContext {
    const fullPath = parentId ? this.pathTo(parentId) : [];
    const path = fullPath.length > 4 ? [fullPath[0], ...fullPath.slice(-3)] : fullPath;
    const pathConcepts = new Set(path.flatMap((n) => n.conceptIds));
    const q = new Set(tokens(`${question} ${anchor?.text.slice(0, 400) ?? ''}`));
    const now = Date.now();

    const scored = [...this.concepts.values()]
      .map((c) => {
        const nameHits = tokens(`${c.name} ${c.aliases.join(' ')}`).filter((t) => q.has(t)).length;
        const noteHits = tokens(c.note).filter((t) => q.has(t)).length;
        let s = nameHits * 3 + noteHits * 0.5;
        if (pathConcepts.has(c.id)) s += 2;
        if (anchor && c.pages.includes(anchor.page)) s += 1;
        if (s > 0) s += Math.max(0, 1 - (now - c.updatedAt) / (7 * 864e5)) * 0.5;
        return { c, s };
      })
      .filter((x) => x.s >= 1)
      .sort((a, b) => b.s - a.s)
      .slice(0, 5)
      .map((x) => x.c);

    const picked = new Map(scored.map((c) => [c.id, c]));
    for (const c of scored) {
      if (picked.size >= 8) break;
      const best = Object.entries(c.related).sort((a, b) => b[1].w - a[1].w)[0];
      const n = best && best[1].w >= 1.5 ? this.concepts.get(best[0]) : undefined;
      if (n) picked.set(n.id, n);
    }

    const knownNames = [...this.concepts.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 40)
      .map((c) => c.name);
    return { path, concepts: [...picked.values()], knownNames };
  }
}
