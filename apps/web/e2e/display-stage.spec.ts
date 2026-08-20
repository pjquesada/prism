import { expect, test, type Page } from "@playwright/test";

async function assertCanvasFillsStage(page: Page) {
  const stage = page.getByTestId("visualizer-stage");
  await expect(stage).toBeVisible();
  const canvas = page.locator("[data-testid='visualizer-stage'] canvas").first();
  await expect(canvas).toBeVisible();
  const stageBox = await stage.boundingBox();
  const canvasBox = await canvas.boundingBox();
  expect(stageBox).toBeTruthy();
  expect(canvasBox).toBeTruthy();
  expect(Math.abs((canvasBox?.width ?? 0) - (stageBox?.width ?? 0))).toBeLessThan(8);
  expect(Math.abs((canvasBox?.height ?? 0) - (stageBox?.height ?? 0))).toBeLessThan(8);
  expect(canvasBox?.height ?? 0).toBeGreaterThan(120);
}

test.describe("Phase 1E display stage fill", () => {
  test("Spectrum, Particles, and Album World fill the demo stage", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByRole("heading", { name: "Spectrum" })).toBeVisible();
    await assertCanvasFillsStage(page);

    await page.getByRole("button", { name: /^Particles$/i }).click();
    await expect(page.locator("[data-visualizer='particles']")).toBeVisible();
    await assertCanvasFillsStage(page);

    await page.getByRole("button", { name: /^Album World$/i }).click();
    await expect(page.locator("[data-visualizer='album_world']")).toBeVisible();
    await assertCanvasFillsStage(page);
  });

  test("desktop display route fills the stage after pairing", async ({ browser }) => {
    const controllerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const displayContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const controller = await controllerContext.newPage();
    const display = await displayContext.newPage();

    await controller.goto("/start");
    await controller.getByRole("button", { name: /Start guest session/i }).click();
    const pairingCode = (await controller.getByTestId("pairing-code").textContent())?.trim();
    await controller.getByRole("button", { name: /Open controller/i }).click();
    await expect(controller.getByTestId("viz-spectrum")).toBeVisible({ timeout: 10_000 });

    await display.goto("/join");
    await display.getByTestId("join-code-input").fill(pairingCode!);
    await display.getByRole("button", { name: /Join as display/i }).click();
    await expect(display.getByTestId("display-visualizer")).toBeVisible({ timeout: 15_000 });
    await assertCanvasFillsStage(display);
    await expect(display.getByTestId("display-fullscreen")).toBeVisible();

    await controllerContext.close();
    await displayContext.close();
  });

  test("mobile portrait and landscape demo stages stay filled", async ({ browser }) => {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.goto("/demo");
      await assertCanvasFillsStage(page);
      await context.close();
    }
  });
});
