export { spectrumPlugin } from "./spectrum.js";
export { particlesPlugin, getParticlesActiveCount } from "./particles.js";
export { albumWorldPlugin, ALBUM_WORLD_PLACEHOLDER_URL } from "./album-world.js";
export { extractPaletteFromImageData, rgbToCss, type ExtractedPalette, type Rgb } from "./palette.js";
export {
  getVisualizerPlugin,
  listVisualizerPlugins,
  requireVisualizerPlugin,
} from "./registry.js";
