import { expect, test } from "@playwright/test";

test.describe("Phase 1E Live Listen", () => {
  test("demo shell can open Live Listen and recover from a denied microphone", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: () =>
            Promise.reject(
              Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }),
            ),
        },
      });
    });

    await page.goto("/demo");
    await expect(page.getByRole("button", { name: /^Live Listen$/i })).toBeVisible();
    await page.getByRole("button", { name: /^Live Listen$/i }).click();
    const status = page.getByTestId("live-listen-status");
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute("data-live-listen-status", "denied");
    await expect(page.getByRole("button", { name: /Try again/i })).toBeVisible();
    await page.getByRole("button", { name: /Use Demo Track/i }).click();
    await expect(page.getByTestId("audio-mode-demo_track")).toHaveAttribute("aria-pressed", "true");
  });

  test("combined mode keeps Demo Track as the default source", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByText(/Combined · Demo Track/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Live Listen$/i })).toBeVisible();
  });
});
