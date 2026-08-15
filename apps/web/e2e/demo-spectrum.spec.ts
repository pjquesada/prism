import { expect, test } from "@playwright/test";

test.describe("Phase 1C Demo visualizers", () => {
  test("demo route can switch visualizers on a single canvas host", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.getByRole("heading", { name: "Spectrum" })).toBeVisible();
    const play = page.getByRole("button", { name: /^Play$/i });
    await expect(play).toBeVisible();
    await play.click();

    await expect(page.locator("[data-visualizer='spectrum']")).toBeVisible();
    await expect(page.locator("[data-visualizer] canvas")).toHaveCount(1);

    await page.getByRole("button", { name: /^Particles$/i }).click();
    await expect(page.getByRole("heading", { name: "Particles" })).toBeVisible();
    await expect(page.locator("[data-visualizer='particles']")).toBeVisible();
    await expect(page.locator("[data-visualizer] canvas")).toHaveCount(1);

    await page.getByRole("button", { name: /^Album World$/i }).click();
    await expect(page.getByRole("heading", { name: "Album World" })).toBeVisible();
    await expect(page.locator("[data-visualizer='album_world']")).toBeVisible();
    await expect(page.locator("[data-visualizer] canvas")).toHaveCount(1);
  });

  test("presets page lists built-in presets", async ({ page }) => {
    await page.goto("/presets");
    await expect(page.getByRole("heading", { name: "Presets" })).toBeVisible();
    await expect(page.getByText(/Spectrum Calm/i)).toBeVisible();
  });

  test("combined mode hosts the Demo Track experience", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByText(/Combined · Demo Track/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Play$/i })).toBeVisible();
  });
});
