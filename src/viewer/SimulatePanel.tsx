import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useState } from 'react';

/** Mirrors simulator/backend/models.py (OdeSpec, spec_version 1). */
interface OdeSpec {
  spec_version: 1;
  eq_type: 'ODE';
  description: string;
  state: string[];
  params: Record<string, number>;
  equations: Record<string, string>;
  initial: Record<string, number>;
  t_span: [number, number];
  t_points: number;
  plot: [string, string];
  method: 'RK45' | 'LSODA';
}

interface Review {
  enabled: boolean;
  warnings: string[];
  note: string;
}

interface Point {
  t: number;
  x: number;
  y: number;
}

type RunState =
  | { s: 'idle' }
  | { s: 'busy' }
  | { s: 'error'; msg: string }
  | { s: 'done'; points: Point[]; status?: string; message?: string };

export const SIM_SECURITY_NOTE =
  'The backend never runs code written by the model. It checks each equation against a fixed list of math operations and integrates it with SciPy under time and size limits.';

function errorText(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object' && 'message' in detail) {
    const d = detail as { message: string; errors?: { loc: string[]; msg: string }[] };
    const first = d.errors?.[0];
    return first ? `${d.message} (${first.loc.join('.')}: ${first.msg})` : d.message;
  }
  return fallback;
}

function Plot({ points, xLabel, yLabel }: { points: Point[]; xLabel: string; yLabel: string }) {
  if (points.length < 2) return <p className="muted small">Not enough points to plot.</p>;
  const W = 300;
  const H = 180;
  const P = 6;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (v: number) => P + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * P);
  const sy = (v: number) => H - P - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const fmt = (v: number) => (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : v.toFixed(3));
  return (
    <figure className="sim-plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} against ${xLabel}`}>
        <rect x="0" y="0" width={W} height={H} className="sim-plot-bg" />
        <path d={d} className="sim-plot-line" />
      </svg>
      <figcaption className="muted small">
        {yLabel} ∈ [{fmt(y0)}, {fmt(y1)}] against {xLabel} ∈ [{fmt(x0)}, {fmt(x1)}] · {points.length} points
      </figcaption>
    </figure>
  );
}

/**
 * Optional "Simulate (local backend)" card. Hidden unless the user sets a backend URL in settings.
 * 1. Sends the PDF to {backend}/api/extract and shows the validated equation spec (and advisory reviewer warnings).
 * 2. On "Run simulation", sends that spec to {backend}/api/simulate and plots the NDJSON stream.
 */
export function SimulatePanel({ pdf, backendUrl }: { pdf: PDFDocumentProxy; backendUrl: string }) {
  const [state, setState] = useState<
    { s: 'idle' } | { s: 'busy' } | { s: 'error'; msg: string } | { s: 'done'; spec: OdeSpec; review: Review }
  >({ s: 'idle' });
  const [run, setRun] = useState<RunState>({ s: 'idle' });
  const base = backendUrl.trim().replace(/\/+$/, '');
  if (!base) return null;

  const extract = async () => {
    setState({ s: 'busy' });
    setRun({ s: 'idle' });
    try {
      const bytes = await pdf.getData();
      const form = new FormData();
      form.append('file', new Blob([bytes.slice()], { type: 'application/pdf' }), 'document.pdf');
      const res = await fetch(`${base}/api/extract`, { method: 'POST', body: form });
      const body = (await res.json().catch(() => ({ detail: res.statusText }))) as {
        spec?: OdeSpec;
        review?: Review;
        detail?: unknown;
      };
      if (!res.ok || !body.spec) throw new Error(errorText(body.detail, `HTTP ${res.status}`));
      setState({ s: 'done', spec: body.spec, review: body.review ?? { enabled: false, warnings: [], note: '' } });
    } catch (e) {
      setState({ s: 'error', msg: `${(e as Error).message}. Check that the local backend runs at ${base}.` });
    }
  };

  const simulate = async (spec: OdeSpec) => {
    setRun({ s: 'busy' });
    try {
      const res = await fetch(`${base}/api/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ detail: res.statusText }))) as { detail?: unknown };
        throw new Error(errorText(body.detail, `HTTP ${res.status}`));
      }
      const text = await res.text();
      const points: Point[] = [];
      let status: string | undefined;
      let message: string | undefined;
      let done = false;
      for (const line of text.split('\n')) {
        const l = line.trim();
        if (!l) continue;
        if (l === 'DONE') {
          done = true;
          break;
        }
        const row = JSON.parse(l) as Partial<Point> & { status?: string; message?: string };
        if (typeof row.status === 'string') {
          status = row.status;
          message = row.message;
        } else if ([row.t, row.x, row.y].every((v) => typeof v === 'number' && Number.isFinite(v))) {
          points.push(row as Point);
        }
      }
      if (!done) throw new Error('The stream ended without DONE');
      setRun({ s: 'done', points, status, message });
    } catch (e) {
      setRun({ s: 'error', msg: (e as Error).message });
    }
  };

  return (
    <div className="card sim-card">
      <div className="card-h">
        <span>Simulate (local backend)</span>
        <button className="link" onClick={() => void extract()} disabled={state.s === 'busy'}>
          {state.s === 'busy' ? 'Extracting…' : 'Extract equations'}
        </button>
      </div>
      <p className="muted small">
        Sends this PDF to {base}/api/extract. Use only a backend you run yourself. {SIM_SECURITY_NOTE}
      </p>
      {state.s === 'error' && <p className="err">{state.msg}</p>}
      {state.s === 'done' && (
        <>
          {state.spec.description && <p className="small-note">{state.spec.description}</p>}
          <p className="muted small">The solver will integrate exactly this system:</p>
          <pre className="brief sim-spec">
            {state.spec.state.map((v) => `d${v}/dt = ${state.spec.equations[v]}`).join('\n')}
            {'\n\n'}
            {Object.keys(state.spec.params).length
              ? Object.entries(state.spec.params)
                  .map(([k, v]) => `${k} = ${v}`)
                  .join(', ')
              : '(no parameters)'}
            {'\n'}
            {'initial: '}
            {state.spec.state.map((v) => `${v}(${state.spec.t_span[0]}) = ${state.spec.initial[v]}`).join(', ')}
            {'\n'}
            t = {state.spec.t_span[0]} … {state.spec.t_span[1]} · {state.spec.t_points} points · {state.spec.method} · plot{' '}
            {state.spec.plot[1]} against {state.spec.plot[0]}
          </pre>
          {state.review.enabled && (
            <div className="sim-review">
              <p className="small-note">
                Reviewer (second LLM, advisory only; it cannot change what runs):{' '}
                {state.review.warnings.length ? '' : state.review.note || 'no warnings.'}
              </p>
              {state.review.warnings.length > 0 && (
                <ul className="warn-text small-note">
                  {state.review.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <button
            className="btn small"
            onClick={() => void simulate(state.spec)}
            disabled={run.s === 'busy'}
            title="Sends the spec above to the backend's fixed SciPy solver"
          >
            {run.s === 'busy' ? 'Running…' : 'Run simulation'}
          </button>
          {run.s === 'error' && <p className="err">{run.msg}</p>}
          {run.s === 'done' && (
            <>
              {run.status && run.status !== 'ok' && (
                <p className="warn-text small-note">
                  Run {run.status}: {run.message}
                </p>
              )}
              <Plot points={run.points} xLabel={state.spec.plot[0]} yLabel={state.spec.plot[1]} />
            </>
          )}
        </>
      )}
    </div>
  );
}
