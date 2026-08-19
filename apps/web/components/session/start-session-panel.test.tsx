import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StartSessionPanel } from "@/components/session/start-session-panel";

const useSessionClientMock = vi.fn();

vi.mock("@/lib/session/use-session-client", () => ({
  useSessionClient: () => useSessionClientMock(),
  stashSessionMeta: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

describe("StartSessionPanel backend status", () => {
  beforeEach(() => {
    useSessionClientMock.mockReturnValue({
      client: { create: vi.fn() },
      sync: { connection: "idle", snapshot: null },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows server misconfiguration instead of Offline when health reports misconfigured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/health")) {
          return new Response(
            JSON.stringify({
              ok: false,
              checks: { sessionBackend: { status: "misconfigured" } },
            }),
            { status: 503 },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );

    render(<StartSessionPanel />);

    await waitFor(() => {
      expect(screen.getAllByTestId("session-backend-banner")[0]?.getAttribute("data-backend-status")).toBe(
        "misconfigured",
      );
    });
    const banner = screen.getAllByTestId("session-backend-banner")[0]!;
    expect(banner.textContent).toMatch(/not configured on the server/i);
    expect(banner.textContent).not.toMatch(/^Offline$/);
    const startButton = screen.getByRole("button", { name: /Start guest session/i }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);
  });

  it("shows schema mismatch banner when migration is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/health")) {
          return new Response(
            JSON.stringify({
              ok: false,
              checks: { sessionBackend: { status: "schema_mismatch" } },
            }),
            { status: 503 },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );

    render(<StartSessionPanel />);

    await waitFor(() => {
      expect(screen.getAllByTestId("session-backend-banner")[0]?.getAttribute("data-backend-status")).toBe(
        "schema_mismatch",
      );
    });
    expect(screen.getAllByTestId("session-backend-banner")[0]?.textContent).toMatch(
      /schema is out of date/i,
    );
  });
});
