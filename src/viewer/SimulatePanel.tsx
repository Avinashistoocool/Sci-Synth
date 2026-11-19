import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useState } from 'react';

/** Mirrors simulator/backend/models.py (Manifest). */
interface Manifest {
  eq_type: string;
  description: string;
  variables: Record<string, number>;
  t_span: [number, number];
  t_points: number;
}

export const SIM_DISABLED_NOTE =
  'Simulation is disabled pending a safe solver (no LLM-generated code is executed). The earlier prototype executed LLM-generated Python; that path is removed.';

/**
 * Optional "Simulate (local backend)" card. Hidden unless the user sets a backend URL in settings.
 * It only sends the PDF to {backend}/api/extract and shows the extracted manifest.
 */
export function SimulatePanel({ pdf, backendUrl }: { pdf: PDFDocumentProxy; backendUrl: string }) {
  const [state, setState] = useState<
    { s: 'idle' } | { s: 'busy' } | { s: 'error'; msg: string } | { s: 'done'; manifest: Manifest }
  >({ s: 'idle' });
  const base = backendUrl.trim().replace(/\/+$/, '');
  if (!base) return null;

  const extract = async () => {
    setState({ s: 'busy' });
    try {
      const bytes = await pdf.getData();
      const form = new FormData();
      form.append('file', new Blob([bytes.slice()], { type: 'application/pdf' }), 'document.pdf');
      const res = await fetch(`${base}/api/extract`, { method: 'POST', body: form });
      const body = (await res.json().catch(() => ({ detail: res.statusText }))) as Manifest & { detail?: string };
      if (!res.ok) throw new Error(body.detail ?? `HTTP ${res.status}`);
      setState({ s: 'done', manifest: body });
    } catch (e) {
      setState({ s: 'error', msg: `${(e as Error).message}. Check that the local backend runs at ${base}.` });
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
      <p className="muted small">Sends this PDF to {base}/api/extract. Use only a backend you run yourself.</p>
      <button className="btn small" disabled title={SIM_DISABLED_NOTE}>
        Run simulation (disabled)
      </button>
      <p className="warn-text small-note">{SIM_DISABLED_NOTE}</p>
      {state.s === 'error' && <p className="err">{state.msg}</p>}
      {state.s === 'done' && (
        <>
          <p className="muted small">
            {state.manifest.eq_type} · t = {state.manifest.t_span[0]} … {state.manifest.t_span[1]} ·{' '}
            {state.manifest.t_points} points
          </p>
          <pre className="brief">{JSON.stringify(state.manifest, null, 2)}</pre>
        </>
      )}
    </div>
  );
}
