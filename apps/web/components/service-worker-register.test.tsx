import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceWorkerRegister } from "@/components/service-worker-register";

describe("ServiceWorkerRegister", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not auto-skipWaiting and can prompt Reload when a worker is waiting", async () => {
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const waiting = {
      postMessage: vi.fn(),
      state: "installed",
      addEventListener: vi.fn(),
    };
    const registration = {
      waiting,
      installing: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      update: vi.fn(async () => undefined),
    };
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: {
        controller: {},
        register: vi.fn(async () => registration),
        addEventListener,
        removeEventListener,
      },
    });

    render(<ServiceWorkerRegister />);
    await vi.waitFor(() => {
      expect(screen.getByTestId("sw-update-banner").textContent).toMatch(/Update available/i);
    });
    fireEvent.click(screen.getByTestId("sw-update-reload"));
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "PRISM_SKIP_WAITING" });

    process.env.NODE_ENV = previousEnv;
  });
});
