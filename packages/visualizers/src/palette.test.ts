import { describe, expect, it } from "vitest";

import { extractPaletteFromImageData } from "./palette.js";

describe("extractPaletteFromImageData", () => {
  it("returns fallback colors for empty buffers", () => {
    const palette = extractPaletteFromImageData(new Uint8ClampedArray(0), 3);
    expect(palette.colors.length).toBeGreaterThan(0);
  });

  it("extracts a dominant hue from synthetic pixels", () => {
    const data = new Uint8ClampedArray(64 * 4);
    for (let i = 0; i < 64; i += 1) {
      const o = i * 4;
      data[o] = 40;
      data[o + 1] = 180;
      data[o + 2] = 160;
      data[o + 3] = 255;
    }
    const palette = extractPaletteFromImageData(data, 2);
    expect(palette.colors[0]?.g).toBeGreaterThan(palette.colors[0]?.r ?? 0);
    expect(palette.average.g).toBeGreaterThan(100);
  });
});
