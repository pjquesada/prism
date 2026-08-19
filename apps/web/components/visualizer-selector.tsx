"use client";

import type { VisualizerId } from "@prism/contracts";
import { listVisualizerPlugins } from "@prism/visualizers";

type VisualizerSelectorProps = {
  value: VisualizerId;
  disabled?: boolean;
  onSelect: (id: VisualizerId) => void;
};

export function VisualizerSelector({ value, disabled = false, onSelect }: VisualizerSelectorProps) {
  const plugins = listVisualizerPlugins();

  return (
    <div
      className="flex flex-wrap gap-2 sm:gap-3"
      role="group"
      aria-label="Visualizer"
      data-testid="visualizer-selector"
    >
      {plugins.map((plugin) => {
        const selected = plugin.id === value;
        return (
          <button
            key={plugin.id}
            type="button"
            className={
              selected
                ? "prism-btn prism-btn-primary min-w-[7.5rem] flex-1 sm:flex-none"
                : "prism-btn prism-btn-ghost min-w-[7.5rem] flex-1 sm:flex-none"
            }
            data-testid={`viz-${plugin.id}`}
            disabled={disabled}
            aria-pressed={selected}
            aria-current={selected ? "true" : undefined}
            title={plugin.description}
            onClick={() => {
              if (plugin.id !== value) onSelect(plugin.id);
            }}
          >
            {plugin.label}
          </button>
        );
      })}
    </div>
  );
}
