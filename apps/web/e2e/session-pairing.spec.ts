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
    expect(display.url()).not.toMatch(/token=/);
    expect(display.url()).not.toMatch(/credential=/);

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

  test("display joins from canonical snapshot after controller is gone", async ({ browser }) => {
    const controllerContext = await browser.newContext();
    const displayContext = await browser.newContext();
    const controller = await controllerContext.newPage();
    const display = await displayContext.newPage();

    await controller.goto("/start");
    await controller.getByRole("button", { name: /Start guest session/i }).click();
    const pairingCode = (await controller.getByTestId("pairing-code").textContent())?.trim();
    expect(pairingCode).toMatch(/^[A-Z2-9]{6}$/);
    await controller.getByRole("button", { name: /Open controller/i }).click();
    await expect(controller.getByTestId("viz-particles")).toBeEnabled({ timeout: 10_000 });
    await controller.getByTestId("viz-particles").click();
    await expect(controller.getByTestId("viz-particles")).toHaveAttribute("aria-pressed", "true", {
      timeout: 10_000,
    });
    await controllerContext.close();

    await display.goto("/join");
    await display.getByTestId("join-code-input").fill(pairingCode!);
    await display.getByRole("button", { name: /Join as display/i }).click();
    await expect(display.getByTestId("display-visualizer")).toHaveText(/particles/i, {
      timeout: 15_000,
    });
    await displayContext.close();
  });

  test("join and restore work when localStorage is blocked", async ({ browser }) => {
    const controllerContext = await browser.newContext();
    const displayContext = await browser.newContext();
    await displayContext.addInitScript(() => {
      const blocked: Storage = {
        get length() {
          return 0;
        },
        key: () => null,
        getItem: () => null,
        setItem: () => {
          throw new DOMException("blocked", "QuotaExceededError");
        },
        removeItem: () => undefined,
        clear: () => undefined,
      };
      Object.defineProperty(window, "localStorage", { configurable: true, value: blocked });
    });
    const controller = await controllerContext.newPage();
    const display = await displayContext.newPage();

    await controller.goto("/start");
    await controller.getByRole("button", { name: /Start guest session/i }).click();
    const pairingCode = (await controller.getByTestId("pairing-code").textContent())?.trim();
    await display.goto("/join");
    await display.getByTestId("join-code-input").fill(pairingCode!);
    await display.getByRole("button", { name: /Join as display/i }).click();
    await expect(display.getByTestId("display-visualizer")).toBeVisible({ timeout: 15_000 });
    const tokenInStorage = await display.evaluate(() => {
      try {
        return `${window.sessionStorage.getItem("prism.session.meta.v1") ?? ""} ${JSON.stringify(window.sessionStorage)}`;
      } catch {
        return "";
      }
    });
    expect(tokenInStorage).not.toMatch(/\.[A-Za-z0-9_-]{20,}\./);
    await controllerContext.close();
    await displayContext.close();
  });

  test("restore errors show a retry action instead of looping", async ({ browser }) => {
    const controllerContext = await browser.newContext();
    const displayContext = await browser.newContext();
    const controller = await controllerContext.newPage();
    const display = await displayContext.newPage();

    await controller.goto("/start");
    await controller.getByRole("button", { name: /Start guest session/i }).click();
    const pairingCode = (await controller.getByTestId("pairing-code").textContent())?.trim();

    await display.route("**/api/session/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === "GET" && /^\/api\/session\/[0-9a-f-]{36}$/i.test(path)) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await display.goto("/join");
    await display.getByTestId("join-code-input").fill(pairingCode!);
    await display.getByRole("button", { name: /Join as display/i }).click();
    await expect(display.getByTestId("restore-retry")).toBeVisible({ timeout: 20_000 });
    await expect(display.getByText(/Connecting…/i)).toHaveCount(0);

    await controllerContext.close();
    await displayContext.close();
  });
});
