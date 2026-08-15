import type { VisualizerId } from "@prism/contracts";
import type { VisualizerPlugin } from "@prism/visual-engine";

import { albumWorldPlugin } from "./album-world.js";
import { particlesPlugin } from "./particles.js";
import { spectrumPlugin } from "./spectrum.js";

const PHASE_1C_PLUGINS: readonly VisualizerPlugin[] = [
  spectrumPlugin,
  particlesPlugin,
  albumWorldPlugin,
];

const byId = new Map<VisualizerId, VisualizerPlugin>(
  PHASE_1C_PLUGINS.map((plugin) => [plugin.id, plugin]),
);

export function listVisualizerPlugins(): readonly VisualizerPlugin[] {
  return PHASE_1C_PLUGINS;
}

export function getVisualizerPlugin(id: VisualizerId): VisualizerPlugin | null {
  if (id === "dreamscape") return null;
  return byId.get(id) ?? null;
}

export function requireVisualizerPlugin(id: VisualizerId): VisualizerPlugin {
  const plugin = getVisualizerPlugin(id);
  if (!plugin) {
    return spectrumPlugin;
  }
  return plugin;
}
