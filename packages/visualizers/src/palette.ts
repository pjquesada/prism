/**
 * Local palette extraction from ImageData — no network, no uploads.
 * Uses a coarse hue histogram to pick dominant colors.
 */

export type Rgb = { r: number; g: number; b: number };

export type ExtractedPalette = {
  colors: Rgb[];
  average: Rgb;
};

function clampByte(value: number): number {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value | 0;
}

function rgbToHueBucket(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return Math.floor(h / 30) % 12; // 12 buckets
}

/**
 * Extract up to `count` palette colors from raw RGBA ImageData.
 * Skips near-black / near-white samples for more useful accents.
 */
export function extractPaletteFromImageData(
  data: Uint8ClampedArray | Uint8Array,
  count = 4,
): ExtractedPalette {
  const buckets = Array.from({ length: 12 }, () => ({ r: 0, g: 0, b: 0, n: 0 }));
  let ar = 0;
  let ag = 0;
  let ab = 0;
  let an = 0;

  for (let i = 0; i + 3 < data.length; i += 16) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const a = data[i + 3] ?? 255;
    if (a < 16) continue;
    const lum = (r + g + b) / 3;
    if (lum < 18 || lum > 245) continue;
    const bucket = rgbToHueBucket(r, g, b);
    const entry = buckets[bucket];
    if (!entry) continue;
    entry.r += r;
    entry.g += g;
    entry.b += b;
    entry.n += 1;
    ar += r;
    ag += g;
    ab += b;
    an += 1;
  }

  const ranked = buckets
    .map((entry, hueBucket) => ({ ...entry, hueBucket }))
    .filter((entry) => entry.n > 0)
    .sort((a, b) => b.n - a.n);

  const colors: Rgb[] = [];
  for (let i = 0; i < ranked.length && colors.length < count; i += 1) {
    const entry = ranked[i];
    if (!entry || entry.n === 0) continue;
    colors.push({
      r: clampByte(entry.r / entry.n),
      g: clampByte(entry.g / entry.n),
      b: clampByte(entry.b / entry.n),
    });
  }

  if (colors.length === 0) {
    colors.push({ r: 46, g: 196, b: 182 }, { r: 224, g: 122, b: 61 });
  }

  const average: Rgb =
    an > 0
      ? { r: clampByte(ar / an), g: clampByte(ag / an), b: clampByte(ab / an) }
      : { r: 14, g: 36, b: 48 };

  return { colors, average };
}

export function rgbToCss(rgb: Rgb): string {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}
