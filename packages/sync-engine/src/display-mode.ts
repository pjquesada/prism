import type { DisplayMode } from "@prism/contracts";

/**
 * Deterministic complementary offset for multi-display variation.
 * Mirror mode returns params unchanged. Complementary nudges hue-like numeric fields.
 */
export function applyDisplayModeParams(
  params: Record<string, unknown>,
  displayMode: DisplayMode,
  deviceIndex: number,
): Record<string, unknown> {
  if (displayMode === "mirror" || deviceIndex <= 0) {
    return { ...params };
  }

  const next: Record<string, unknown> = { ...params };
  const offset = (deviceIndex % 5) * 0.08;

  for (const [key, value] of Object.entries(next)) {
    if (typeof value !== "number") continue;
    if (/hue|phase|angle|rotation|spin|tilt/i.test(key)) {
      next[key] = value + offset * 360;
    } else if (/speed|sensitivity|intensity|density/i.test(key)) {
      next[key] = Math.min(4, Math.max(0.1, value * (1 + offset)));
    }
  }

  return next;
}

export function displayDeviceIndex(
  devices: Array<{ deviceId: string; role: string }>,
  deviceId: string,
): number {
  const displays = devices.filter((d) => d.role === "display" || d.role === "combined");
  const idx = displays.findIndex((d) => d.deviceId === deviceId);
  return idx === -1 ? 0 : idx;
}
