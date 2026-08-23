/**
 * Cache parsed visualizer params by object identity so update() can skip Zod
 * on the requestAnimationFrame hot path when the preset object is unchanged.
 */
export function createIdentityParamCache<T>(parse: (raw: Record<string, unknown>) => T) {
  let lastRaw: Record<string, unknown> | undefined;
  let lastValue: T | undefined;
  return (raw: Record<string, unknown>): T => {
    if (raw === lastRaw && lastValue !== undefined) return lastValue;
    lastRaw = raw;
    lastValue = parse(raw);
    return lastValue;
  };
}
