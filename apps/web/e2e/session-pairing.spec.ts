import { expect, test } from "@playwright/test";

test.describe("Phase 1D session pairing", () => {
  test("two browser contexts: controller change reaches display", async ({ browser }) => {
    const controllerContext = await browser.newContext();
    const displayContext = await browser.newContext();
    const controller = await controllerContext.newPage();
    const display = await displayContext.newPage();

    await controller.goto("/start");
    await expect(controller.getByRole("heading", { name: "Start" })).toBeVisible();
    await controller.getByRole("button", { name: /Start guest session/i }).click();
    const code = controller.getByTestId("pairing-code");
    await expect(code).toBeVisible();
    const pairingCode = (await code.textContent())?.trim();
    expect(pairingCode).toMatch(/^[A-Z2-9]{6}$/);

    await controller.getByRole("button", { name: /Open controller/i }).click();
    await expect(controller.getByTestId("controller-session-id")).toBeVisible();
    await expect(controller.getByTestId("viz-particles")).toBeEnabled({ timeout: 10_000 });

    await display.goto("/join");
    await display.getByTestId("join-code-input").fill(pairingCode!);
    await display.getByRole("button", { name: /Join as display/i }).click();
    await expect(display.getByTestId("display-visualizer")).toBeVisible({ timeout: 15_000 });
    await expect(display.getByTestId("display-visualizer")).toHaveText(/spectrum/i);

    await controller.getByTestId("viz-particles").click();
    await expect(controller.getByTestId("viz-particles")).toHaveAttribute("aria-pressed", "true", {
      timeout: 10_000,
    });
    await expect(display.getByTestId("display-visualizer")).toHaveText(/particles/i, {
      timeout: 15_000,
    });

    await controllerContext.close();
    await displayContext.close();
  });

  test("invalid pairing code shows recovery state", async ({ page }) => {
    await page.goto("/join");
    await page.getByTestId("join-code-input").fill("ZZZZZZ");
    await page.getByRole("button", { name: /Join as display/i }).click();
    await expect(page.getByTestId("join-error")).toBeVisible();
  });
});
