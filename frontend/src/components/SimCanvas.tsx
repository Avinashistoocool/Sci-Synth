"use client";

// NOTE: This is the Phase-1 implementation — a plain JSON dump.
// Three.js / @react-three/fiber rendering is added in Phase 2,
// after the full backend pipeline is verified with curl.

import { type Point } from "@/lib/api";

interface Props {
  points: Point[];
  running?: boolean;
}

export default function SimCanvas({ points, running = false }: Props) {
  const isEmpty = points.length === 0;

  return (
    <div className="w-full rounded-xl border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
          Simulation output
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
          {running && (
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
          )}
          {running ? "streaming…" : `${points.length} points`}
        </span>
      </div>

      {/* Body */}
      <div className="p-4">
        {isEmpty ? (
          <p className="py-8 text-center text-sm text-zinc-400">
            {running ? "Waiting for first data point…" : "No data yet. Run a simulation."}
          </p>
        ) : (
          <pre className="max-h-96 overflow-auto text-xs text-zinc-700 dark:text-zinc-300">
            {JSON.stringify(points.slice(-50), null, 2)}
          </pre>
        )}
      </div>

      {/* Mini x/y range summary */}
      {!isEmpty && !running && (
        <div className="flex gap-6 border-t border-zinc-200 px-4 py-2 text-xs text-zinc-400 dark:border-zinc-800">
          <span>
            x ∈ [{Math.min(...points.map((p) => p.x)).toFixed(3)},{" "}
            {Math.max(...points.map((p) => p.x)).toFixed(3)}]
          </span>
          <span>
            y ∈ [{Math.min(...points.map((p) => p.y)).toFixed(3)},{" "}
            {Math.max(...points.map((p) => p.y)).toFixed(3)}]
          </span>
        </div>
      )}
    </div>
  );
}
