"use client";

import { useCallback, useState } from "react";
import { type Manifest, type Point, runSimulation } from "@/lib/api";
import UploadPanel from "@/components/UploadPanel";
import SliderPanel from "@/components/SliderPanel";
import SimCanvas from "@/components/SimCanvas";

export default function Home() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [variables, setVariables] = useState<Record<string, number>>({});
  const [points, setPoints] = useState<Point[]>([]);
  const [running, setRunning] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  const handleManifest = useCallback((m: Manifest) => {
    setManifest(m);
    setVariables(m.variables);
    setPoints([]);
    setSimError(null);
  }, []);

  const handleSimulate = useCallback(async () => {
    if (!manifest) return;
    setRunning(true);
    setPoints([]);
    setSimError(null);

    try {
      const activeManifest: Manifest = { ...manifest, variables };
      for await (const point of runSimulation(activeManifest)) {
        setPoints((prev) => [...prev, point]);
      }
    } catch (err) {
      setSimError(err instanceof Error ? err.message : "Simulation failed");
    } finally {
      setRunning(false);
    }
  }, [manifest, variables]);

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-10 px-6 py-12">
      {/* Header */}
      <header>
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Sci-Synth
        </h1>
        <p className="mt-1 text-zinc-500">
          Upload a physics paper → Gemini extracts the equations → live simulation
        </p>
      </header>

      {/* Upload */}
      <section className="flex flex-col items-center">
        <UploadPanel onManifest={handleManifest} />
      </section>

      {manifest && (
        <>
          {/* Manifest dump */}
          <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
              Extracted manifest
            </h2>
            <pre className="overflow-auto rounded-lg bg-zinc-50 p-4 text-xs text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              {JSON.stringify(manifest, null, 2)}
            </pre>
          </section>

          {/* Controls row */}
          <section className="flex flex-col gap-8 sm:flex-row sm:items-start">
            {/* Sliders */}
            <div className="flex-1 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
              <SliderPanel
                manifest={{ ...manifest, variables }}
                onVariablesChange={setVariables}
              />
            </div>

            {/* Run button */}
            <div className="flex flex-col gap-3 sm:pt-7">
              <button
                onClick={handleSimulate}
                disabled={running}
                className="rounded-full bg-blue-600 px-8 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running ? "Simulating…" : "Run Simulation"}
              </button>
              {simError && (
                <p className="max-w-xs rounded-lg bg-red-50 px-4 py-2 text-xs text-red-600 dark:bg-red-950/50 dark:text-red-400">
                  {simError}
                </p>
              )}
            </div>
          </section>

          {/* Output canvas */}
          <section>
            <SimCanvas points={points} running={running} />
          </section>
        </>
      )}
    </main>
  );
}
