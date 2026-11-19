const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// -------------------------------------------------------------------------
// Shared types (also exported so components can import from here)
// -------------------------------------------------------------------------

export interface Manifest {
  eq_type: "ODE" | "PDE" | "quantum" | "statistical";
  description: string;
  variables: Record<string, number>;
  t_span: [number, number];
  t_points: number;
}

export interface Point {
  t: number;
  x: number;
  y: number;
}

// -------------------------------------------------------------------------
// API helpers
// -------------------------------------------------------------------------

/**
 * POST /api/extract
 * Sends a PDF file and returns the parsed Manifest.
 */
export async function extractFromPDF(file: File): Promise<Manifest> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${API_BASE}/api/extract`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail ?? "Extraction failed");
  }

  return res.json() as Promise<Manifest>;
}

/**
 * POST /api/simulate
 * Streams NDJSON lines and yields parsed {t, x, y} points.
 * Stops automatically when the sentinel line "DONE" is received.
 */
export async function* runSimulation(
  manifest: Manifest
): AsyncGenerator<Point> {
  const res = await fetch(`${API_BASE}/api/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(manifest),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail ?? "Simulation failed");
  }

  if (!res.body) throw new Error("Response body is null");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // last partial line stays in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "DONE") return;

      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        // Surface backend errors thrown inside the stream
        if ("error" in parsed) throw new Error(String(parsed.error));
        yield parsed as unknown as Point;
      } catch (err) {
        if (err instanceof Error && err.message !== trimmed) throw err;
        // silently skip unparseable lines
      }
    }
  }
}
