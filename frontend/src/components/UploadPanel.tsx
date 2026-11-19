"use client";

import { useCallback, useState } from "react";
import { extractFromPDF, type Manifest } from "@/lib/api";

interface Props {
  onManifest: (manifest: Manifest) => void;
}

export default function UploadPanel({ onManifest }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setError("Please upload a PDF file.");
        return;
      }
      setError(null);
      setLoading(true);
      try {
        const manifest = await extractFromPDF(file);
        onManifest(manifest);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [onManifest]
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="w-full max-w-lg">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          "flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl",
          "border-2 border-dashed p-14 transition-colors select-none",
          dragging
            ? "border-blue-400 bg-blue-50 dark:bg-blue-950/40"
            : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500",
        ].join(" ")}
      >
        <input
          type="file"
          accept=".pdf,application/pdf"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          disabled={loading}
        />

        {loading ? (
          <>
            <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-blue-500 border-t-transparent" />
            <p className="text-sm text-zinc-500">Extracting physics from PDF…</p>
            <p className="text-xs text-zinc-400">This may take 15–30 s</p>
          </>
        ) : (
          <>
            <svg
              className="h-10 w-10 text-zinc-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.4}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                Drop a physics PDF here
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                or click to browse · max 20 MB
              </p>
            </div>
          </>
        )}
      </label>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600 dark:bg-red-950/50 dark:text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
