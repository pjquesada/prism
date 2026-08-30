import { expect, test } from "@playwright/test";

function sampleEnvelope(frameSeq: number) {
  return {
    frameSeq,
    timestampMs: Date.now(),
    rms: 0.7,
    energy: 0.8,
    bass: 0.6,
    mid: 0.5,
    high: 0.4,
    levels: [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1],
    onset: false,
    beatStrength: 0,
    centroid: 0.4,
  };
}

test.describe("Feature transport controller to display", () => {
  test("display consumes durable fallback when realtime is blocked", async ({ browser }) => {
    const controllerContext = await browser.newContext();
    const displayContext = await browser.newContext();
    await controllerContext.addInitScript(() => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.frequency.value = 220;
      osc.connect(dest);
      osc.start();
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getDisplayMedia: async () => dest.stream,
          getUserMedia: async () => dest.stream,
        },
      });
    });

    const controller = await controllerContext.newPage();
    const display = await displayContext.newPage();

    await controller.goto("/start");
    await controller.getByRole("button", { name: /Start guest session/i }).click();
    const pairingCode = (await controller.getByTestId("pairing-code").textContent())?.trim();
    await controller.getByRole("button", { name: /Open controller/i }).click();
    const sessionId = (await controller.getByTestId("controller-session-id").textContent())?.trim();

    await display.goto("/join");
    await display.getByTestId("join-code-input").fill(pairingCode!);
    await display.getByRole("button", { name: /Join as display/i }).click();
    await expect(display.getByTestId("display-visualizer")).toBeVisible({ timeout: 15_000 });

    await controller.getByTestId("audio-mode-browser_capture").click();
    await expect(display.getByTestId("capture-music-follower")).toBeVisible({ timeout: 15_000 });

    await display.route("**/api/session/**/events", (route) => route.abort());
    await display.route("**/realtime/**", (route) => route.abort());

    const publishRes = await controller.evaluate(async ({ sessionId: sid }) => {
      const envelope = {
        frameSeq: Date.now() * 1000,
        timestampMs: Date.now(),
        rms: 0.7,
        energy: 0.8,
        bass: 0.6,
        mid: 0.5,
        high: 0.4,
        levels: [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1],
        onset: false,
        beatStrength: 0,
        centroid: 0.4,
      };
      const res = await fetch(`/api/session/${sid}/features`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envelope }),
      });
      return { ok: res.ok, status: res.status, body: await res.json() };
    }, { sessionId });
    expect(publishRes.ok).toBe(true);
    expect(publishRes.body.accepted).toBe(true);
    expect(publishRes.body.durableFallback).toBe("stored");

    await expect
      .poll(
        async () => {
          const energy = await display.getByTestId("remote-feature-energy").getAttribute("data-energy");
          return Number(energy ?? "0");
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

    await controllerContext.close();
    await displayContext.close();
  });

  test("deduplicates realtime and fallback duplicates", async ({ browser }) => {
    const controllerContext = await browser.newContext();
    const displayContext = await browser.newContext();
    const controller = await controllerContext.newPage();
    const display = await displayContext.newPage();

    await controller.goto("/start");
    await controller.getByRole("button", { name: /Start guest session/i }).click();
    const pairingCode = (await controller.getByTestId("pairing-code").textContent())?.trim();
    await controller.getByRole("button", { name: /Open controller/i }).click();
    const sessionId = (await controller.getByTestId("controller-session-id").textContent())?.trim();

    await display.goto("/join");
    await display.getByTestId("join-code-input").fill(pairingCode!);
    await display.getByRole("button", { name: /Join as display/i }).click();
    await expect(display.getByTestId("display-visualizer")).toBeVisible({ timeout: 15_000 });

    await controller.evaluate(
      async ({ sessionId: sid }) => {
        const envelope = {
          frameSeq: Date.now() * 1000,
          timestampMs: Date.now(),
          rms: 0.7,
          energy: 0.8,
          bass: 0.6,
          mid: 0.5,
          high: 0.4,
          levels: [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1],
          onset: false,
          beatStrength: 0,
          centroid: 0.4,
        };
        await fetch(`/api/session/${sid}/features`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ envelope }),
        });
      },
      { sessionId },
    );

    await expect
      .poll(
        async () => display.getByTestId("remote-feature-energy").getAttribute("data-energy"),
        { timeout: 15_000 },
      )
      .not.toBe("0.000");

    await controllerContext.close();
    await displayContext.close();
  });
});
