"use client";

import { useId } from "react";
import { type Manifest } from "@/lib/api";

interface Props {
  manifest: Manifest;
  onVariablesChange: (vars: Record<string, number>) => void;
}

interface SliderRowProps {
  varKey: string;
  defaultVal: number;
  onChange: (key: string, value: number) => void;
}

function SliderRow({ varKey, defaultVal, onChange }: SliderRowProps) {
  const labelId = useId();
  // Avoid 0-based ranges that produce empty sliders
  const base = defaultVal === 0 ? 1 : Math.abs(defaultVal);
  const min = +(base * 0.1).toPrecision(4);
  const max = +(base * 10).toPrecision(4);
  const step = +((max - min) / 500).toPrecision(4);

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <label htmlFor={labelId} className="font-mono text-zinc-800 dark:text-zinc-200">
          {varKey}
        </label>
        <output
          htmlFor={labelId}
          className="tabular-nums text-zinc-500"
          id={`out-${labelId}`}
        >
          {defaultVal.toPrecision(4)}
        </output>
      </div>
      <input
        id={labelId}
        type="range"
        min={min}
        max={max}
        step={step}
        defaultValue={defaultVal}
        onChange={(e) => {
          const val = parseFloat(e.target.value);
          const out = document.getElementById(`out-${labelId}`);
          if (out) out.textContent = val.toPrecision(4);
          onChange(varKey, val);
        }}
        className="w-full accent-blue-500"
      />
    </div>
  );
}

export default function SliderPanel({ manifest, onVariablesChange }: Props) {
  const handleChange = (key: string, value: number) => {
    onVariablesChange({ ...manifest.variables, [key]: value });
  };

  const entries = Object.entries(manifest.variables);

  return (
    <div className="w-full space-y-5">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
        Parameters
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-zinc-400">No variables found in manifest.</p>
      ) : (
        entries.map(([key, val]) => (
          <SliderRow
            key={key}
            varKey={key}
            defaultVal={val}
            onChange={handleChange}
          />
        ))
      )}
    </div>
  );
}
