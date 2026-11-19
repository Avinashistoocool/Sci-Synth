import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PageData } from './extract';
import type { Concept, ThoughtNode } from './graph';

export interface DocRecord {
  fp: string;
  title: string;
  numPages: number;
  brief?: string;
  briefModel?: string;
  openedAt: number;
}

export interface PageRecord extends PageData {
  fp: string;
}

interface Schema extends DBSchema {
  docs: { key: string; value: DocRecord };
  pages: { key: [string, number]; value: PageRecord };
  answers: { key: string; value: { key: string; text: string; at: number } };
  nodes: { key: string; value: ThoughtNode; indexes: { fp: string } };
  concepts: { key: string; value: Concept; indexes: { fp: string } };
}

const DB_NAME = 'pdf-ai-explorer';
let dbp: Promise<IDBPDatabase<Schema>> | null = null;
/** After one failed open, don't make every call wait for the timeout again. */
let unavailableUntil = 0;

const DB_TIMEOUT_MS = 4000;

/** Resolves to null if IndexedDB is blocked (e.g. an old tab holds an older version) or fails. */
function openWithTimeout(): Promise<IDBPDatabase<Schema> | null> {
  const open = openDB<Schema>(DB_NAME, 2, {
    // Another tab with a newer version wants to upgrade: let go so it isn't stuck.
    blocking() {
      void open.then((d) => d.close());
      dbp = null;
    },
    blocked() {
      console.warn('Sci-Synth: database upgrade blocked by another open viewer tab — close old tabs.');
    },
    terminated() {
      dbp = null;
    },
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('docs', { keyPath: 'fp' });
        d.createObjectStore('pages', { keyPath: ['fp', 'page'] });
        d.createObjectStore('answers', { keyPath: 'key' });
      }
      if (oldVersion < 2) {
        d.createObjectStore('nodes', { keyPath: 'id' }).createIndex('fp', 'fp');
        d.createObjectStore('concepts', { keyPath: 'id' }).createIndex('fp', 'fp');
      }
    },
  });
  let t = 0;
  const timeout = new Promise<null>((res) => {
    t = window.setTimeout(() => {
      console.warn('Sci-Synth: IndexedDB did not open in time — running without cache. Close other viewer tabs.');
      res(null);
    }, DB_TIMEOUT_MS);
  });
  return Promise.race([open.catch((e) => (console.warn('IndexedDB failed', e), null)), timeout]).finally(() =>
    clearTimeout(t),
  );
}

function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbp && Date.now() < unavailableUntil) return Promise.reject(new DbUnavailable());
  dbp ??= openWithTimeout().then((d) => {
    if (!d) {
      dbp = null;
      unavailableUntil = Date.now() + 30_000;
      throw new DbUnavailable();
    }
    return d;
  });
  return dbp;
}

class DbUnavailable extends Error {
  constructor() {
    super('IndexedDB unavailable');
  }
}

/** Storage must never stop a PDF from opening: on failure, reads return a fallback and writes are dropped. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof DbUnavailable)) console.warn('IndexedDB op failed', e);
    return fallback;
  }
}

/** Persistent doubt tree + concept graph (per PDF). Not cleared by "Clear cache". */
export const graphStore = {
  load: (fp: string) =>
    safe(
      async () => {
        const d = await db();
        const [nodes, concepts] = await Promise.all([
          d.getAllFromIndex('nodes', 'fp', fp),
          d.getAllFromIndex('concepts', 'fp', fp),
        ]);
        return { nodes, concepts };
      },
      { nodes: [] as ThoughtNode[], concepts: [] as Concept[] },
    ),
  putNode: (n: ThoughtNode) => safe(async () => void (await (await db()).put('nodes', n)), undefined),
  putConcept: (c: Concept) => safe(async () => void (await (await db()).put('concepts', c)), undefined),
  deleteNodes: (ids: string[]) =>
    safe(async () => {
      const tx = (await db()).transaction('nodes', 'readwrite');
      await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
    }, undefined),
  deleteConcepts: (ids: string[]) =>
    safe(async () => {
      const tx = (await db()).transaction('concepts', 'readwrite');
      await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
    }, undefined),
  clear: () =>
    safe(async () => {
      const d = await db();
      await Promise.all([d.clear('nodes'), d.clear('concepts')]);
    }, undefined),
  count: () =>
    safe(
      async () => {
        const d = await db();
        const [nodes, concepts] = await Promise.all([d.count('nodes'), d.count('concepts')]);
        return { nodes, concepts };
      },
      { nodes: 0, concepts: 0 },
    ),
};

export const cache = {
  getDoc: (fp: string) => safe(async () => (await db()).get('docs', fp), undefined),
  putDoc: (rec: DocRecord) => safe(async () => void (await (await db()).put('docs', rec)), undefined),
  getPage: (fp: string, page: number) => safe(async () => (await db()).get('pages', [fp, page]), undefined),
  putPage: (rec: PageRecord) => safe(async () => void (await (await db()).put('pages', rec)), undefined),
  getAnswer: (key: string) => safe(async () => (await (await db()).get('answers', key))?.text, undefined),
  putAnswer: (key: string, text: string) =>
    safe(async () => void (await (await db()).put('answers', { key, text, at: Date.now() })), undefined),
  clearAll: () =>
    safe(async () => {
      const d = await db();
      await Promise.all([d.clear('docs'), d.clear('pages'), d.clear('answers')]);
    }, undefined),
  stats: () =>
    safe(
      async () => {
        const d = await db();
        const [docs, pages, answers] = await Promise.all([d.count('docs'), d.count('pages'), d.count('answers')]);
        return { docs, pages, answers };
      },
      { docs: 0, pages: 0, answers: 0 },
    ),
};
export async function hashKey(...parts: (string | number)[]): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\u241F')));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
