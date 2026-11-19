import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { cache, graphStore } from '../lib/db';
import { completeChat } from '../lib/llm';
import {
  DEFAULT_SETTINGS,
  PROVIDER_INFO,
  loadSettings,
  saveSettings,
  type Provider,
  type Settings,
  type TriggerKey,
} from '../lib/settings';
import type { Granularity } from '../lib/target';
import './options.css';

function Options() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'fail'; msg?: string }>({ state: 'idle' });
  const [stats, setStats] = useState<{ docs: number; pages: number; answers: number } | null>(null);
  const [notes, setNotes] = useState<{ nodes: number; concepts: number } | null>(null);

  useEffect(() => {
    void loadSettings().then(setS);
    void cache.stats().then(setStats);
    void graphStore.count().then(setNotes);
  }, []);

  if (!s) return null;
  const cfg = s.providers[s.provider];
  const info = PROVIDER_INFO[s.provider];

  const update = (patch: Partial<Settings>) => {
    setS({ ...s, ...patch });
    setSaved(false);
  };
  const updateCfg = (patch: Partial<typeof cfg>) =>
    update({ providers: { ...s.providers, [s.provider]: { ...cfg, ...patch } } });

  const save = async () => {
    await saveSettings(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const runTest = async () => {
    setTest({ state: 'running' });
    const t0 = performance.now();
    try {
      const out = await completeChat(s, {
        system: 'Reply with exactly: OK',
        user: 'Say OK.',
        maxTokens: 10,
      });
      setTest({ state: 'ok', msg: `Replied “${out.trim().slice(0, 40)}” in ${Math.round(performance.now() - t0)} ms` });
    } catch (e) {
      setTest({ state: 'fail', msg: (e as Error).message });
    }
  };

  return (
    <div className="wrap">
      <h1>✦ PDF AI Explorer</h1>
      <p className="muted">Your key is stored only in this browser and sent only to the provider you choose.</p>

      <section>
        <h2>AI provider</h2>
        <label>
          Provider
          <select value={s.provider} onChange={(e) => update({ provider: e.target.value as Provider })}>
            {(Object.keys(PROVIDER_INFO) as Provider[]).map((p) => (
              <option key={p} value={p}>
                {PROVIDER_INFO[p].label}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">{info.hint}</p>
        {info.needsKey && (
          <label>
            API key
            <input
              type="password"
              value={cfg.apiKey}
              placeholder="paste your key"
              autoComplete="off"
              onChange={(e) => updateCfg({ apiKey: e.target.value.trim() })}
            />
          </label>
        )}
        <label>
          Model
          <input value={cfg.model} onChange={(e) => updateCfg({ model: e.target.value })} />
        </label>
        <label>
          Base URL
          <input value={cfg.baseUrl} onChange={(e) => updateCfg({ baseUrl: e.target.value })} />
        </label>
        <div className="row">
          <button onClick={() => updateCfg({ ...DEFAULT_SETTINGS.providers[s.provider], apiKey: cfg.apiKey })}>
            Reset model/URL
          </button>
          <button onClick={runTest} disabled={test.state === 'running'}>
            {test.state === 'running' ? 'Testing…' : 'Test connection'}
          </button>
          {test.state === 'ok' && <span className="ok">✓ {test.msg}</span>}
          {test.state === 'fail' && <span className="fail">✗ {test.msg}</span>}
        </div>
        <p className="hint">
          For speed pick a small, fast model with vision: <code>gpt-4o-mini</code>, <code>claude-haiku-4-5</code>,{' '}
          <code>gemini-2.5-flash-lite</code>. Text-only options (e.g. Groq <code>llama-3.1-8b-instant</code> via{' '}
          <code>https://api.groq.com/openai/v1</code>) are faster but can't read equations/figures as images.
        </p>
      </section>

      <section>
        <h2>Behaviour</h2>
        <label>
          Trigger key (hold + hover)
          <select value={s.triggerKey} onChange={(e) => update({ triggerKey: e.target.value as TriggerKey })}>
            <option value="Alt">Alt</option>
            <option value="Control">Ctrl</option>
            <option value="Shift">Shift</option>
          </select>
        </label>
        <label>
          Hover delay before asking AI: <b>{s.dwellMs} ms</b>
          <input
            type="range"
            min={0}
            max={1000}
            step={50}
            value={s.dwellMs}
            onChange={(e) => update({ dwellMs: Number(e.target.value) })}
          />
        </label>
        <label>
          Default hover target
          <select value={s.granularity} onChange={(e) => update({ granularity: e.target.value as Granularity })}>
            <option value="auto">Auto – sentence in long paragraphs, whole block otherwise</option>
            <option value="word">Word / term</option>
            <option value="sentence">Sentence</option>
            <option value="paragraph">Paragraph</option>
          </select>
        </label>
        <p className="hint">
          Equations, figures and tables are always picked as a whole. While holding the trigger key, scroll the wheel or
          press 1–4 to switch.
        </p>
        <label className="check">
          <input type="checkbox" checked={s.vision} onChange={(e) => update({ vision: e.target.checked })} />
          Send an image of equations, figures, tables and scanned regions to the AI (needs a vision model; falls back to
          text automatically)
        </label>
        <label className="check">
          <input type="checkbox" checked={s.aiOcr} onChange={(e) => update({ aiOcr: e.target.checked })} />
          Read scanned / handwritten pages with your AI model (only the page you're on + next 2; ~1 call per page,
          cached forever). Much better than OCR for handwriting and math.
        </label>
        <label className="check">
          <input type="checkbox" checked={s.ocr} onChange={(e) => update({ ocr: e.target.checked })} />
          Quick offline OCR (Tesseract) as an instant first pass — free, but poor on handwriting
        </label>
        <label>
          Answer style
          <select value={s.style} onChange={(e) => update({ style: e.target.value as Settings['style'] })}>
            <option value="concise">Concise (fastest)</option>
            <option value="detailed">Detailed</option>
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={s.autoIntercept}
            onChange={(e) => update({ autoIntercept: e.target.checked })}
          />
          Open PDFs in AI Explorer automatically
        </label>
        <label className="check">
          <input type="checkbox" checked={s.buildBrief} onChange={(e) => update({ buildBrief: e.target.checked })} />
          Build a document brief when a PDF opens (one extra AI call per new PDF, makes answers smarter)
        </label>
      </section>

      <div className="row sticky">
        <button className="primary" onClick={save}>
          Save
        </button>
        {saved && <span className="ok">Saved ✓</span>}
      </div>

      <section>
        <h2>Cache</h2>
        <p className="muted">
          {stats ? `${stats.docs} documents · ${stats.pages} pages indexed · ${stats.answers} cached answers` : '…'}
        </p>
        <button
          onClick={async () => {
            await cache.clearAll();
            setStats(await cache.stats());
          }}
        >
          Clear cache
        </button>
      </section>

      <section>
        <h2>Your doubt notes</h2>
        <p className="muted">
          {notes ? `${notes.nodes} explanations/questions · ${notes.concepts} concepts` : '…'} — kept separately from the
          cache above.
        </p>
        <button
          onClick={async () => {
            if (!confirm('Delete ALL doubt trees and concept maps for every PDF?')) return;
            await graphStore.clear();
            setNotes(await graphStore.count());
          }}
        >
          Delete all notes
        </button>
      </section>

      <section>
        <h2>Local PDFs</h2>
        <p className="muted">
          To open <code>file://</code> PDFs, go to <code>edge://extensions</code> → PDF AI Explorer → Details → enable{' '}
          <b>Allow access to file URLs</b>. You can also drag & drop a PDF into the viewer.
        </p>
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Options />);
