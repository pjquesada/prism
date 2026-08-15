import { describe, expect, it, beforeEach, vi } from "vitest";
import { createBuiltInPresets } from "@prism/contracts";

import {
  duplicatePreset,
  listMergedPresets,
  loadGuestPresets,
  saveGuestPresets,
  updatePresetParams,
} from "@/lib/guest-presets";

describe("guest presets local storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists user presets and keeps built-ins separate", () => {
    const builtin = createBuiltInPresets()[0];
    expect(builtin).toBeTruthy();
    if (!builtin) return;
    const copy = duplicatePreset(builtin, "My Calm");
    const saved = saveGuestPresets([copy]);
    expect(saved.ok).toBe(true);

    const loaded = loadGuestPresets();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toHaveLength(1);
    expect(listMergedPresets(loaded.value).length).toBeGreaterThan(1);
  });

  it("updates params for an editable preset", () => {
    const builtin = createBuiltInPresets()[0];
    expect(builtin).toBeTruthy();
    if (!builtin) return;
    const copy = duplicatePreset(builtin);
    const updated = updatePresetParams(copy, { ...copy.params, sensitivity: 2 });
    expect(updated.params.sensitivity).toBe(2);
    expect(updated.isBuiltIn).toBe(false);
  });

  it("surfaces local storage failures", () => {
    const boom = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const builtin = createBuiltInPresets()[1];
    expect(builtin).toBeTruthy();
    if (!builtin) return;
    const result = saveGuestPresets([duplicatePreset(builtin)]);
    expect(result.ok).toBe(false);
    boom.mockRestore();
  });
});
