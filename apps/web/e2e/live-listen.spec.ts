import { expect, test } from "@playwright/test";

test.describe("Phase 1E Capture Music", () => {
  test("demo shell can open Capture Music and recover from denied browser capture", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getDisplayMedia: () =>
            Promise.reject(
              Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }),
            ),
          getUserMedia: () =>
            Promise.reject(
              Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }),
            ),
        },
      });
    });

    await page.goto("/demo");
    await expect(page.getByRole("button", { name: /Capture Music/i })).toBeVisible();
    await page.getByTestId("audio-mode-browser_capture").click();
    const status = page.getByTestId("capture-music-status");
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute("data-live-listen-status", "denied");
    await expect(page.getByRole("button", { name: /Try again/i })).toBeVisible();
    await expect(page.getByTestId("capture-music-privacy")).toBeVisible();
    await page.getByRole("button", { name: /Use Demo Track/i }).click();
    await expect(page.getByTestId("audio-mode-demo_track")).toHaveAttribute("aria-pressed", "true");
  });

  test("combined mode keeps Demo Track as the default source", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByText(/Combined · Demo Track/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Capture Music/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Microphone$/i })).toBeVisible();
  });

  test("paired display follows compact envelopes and never requests capture APIs", async ({
    browser,
  }) => {
    const controllerContext = await browser.newContext();
    const displayContext = await browser.newContext();
    await controllerContext.addInitScript(() => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.frequency.value = 220;
      osc.connect(dest);
      osc.start();
      const videoTrack = dest.stream.getAudioTracks()[0] ? dest.stream.getAudioTracks()[0] : null;
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getDisplayMedia: async () => {
            const stream = dest.stream;
            // Simulate a display-media stream that also has a dummy video track API.
            const tracks = [...stream.getAudioTracks()];
            return {
              getTracks: () => tracks,
              getAudioTracks: () => stream.getAudioTracks(),
              getVideoTracks: () => [],
            } as unknown as MediaStream;
          },
          getUserMedia: async () => dest.stream,
        },
      });
      void videoTrack;
    });
    await displayContext.addInitScript(() => {
      const target = window as unknown as {
        __prismGumCalls: number;
        __prismGdmCalls: number;
        __prismAudioElements: number;
      };
      target.__prismGumCalls = 0;
      target.__prismGdmCalls = 0;
      target.__prismAudioElements = 0;
      const OriginalAudio = window.Audio;
      function PatchedAudio(src?: string) {
        target.__prismAudioElements += 1;
        return src ? new OriginalAudio(src) : new OriginalAudio();
      }
      PatchedAudio.prototype = OriginalAudio.prototype;
      Object.defineProperty(window, "Audio", { configurable: true, value: PatchedAudio });
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            target.__prismGumCalls += 1;
            throw new Error("display must not request a microphone");
          },
          getDisplayMedia: async () => {
            target.__prismGdmCalls += 1;
            throw new Error("display must not request display media");
          },
        },
      });
    });

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
    await expect(display.getByTestId("display-silent")).toBeVisible();
    await expect(
      display.getByRole("button", { name: /Enable audio on this display/i }),
    ).toHaveCount(0);

    const demoBroadcast = controller.waitForRequest((req) => {
      if (req.method() !== "POST" || !req.url().includes("/broadcast")) return false;
      const data = req.postData() ?? "";
      return (
        data.includes("audio.features") && data.includes("levels") && !data.includes('"bands"')
      );
    });
    await controller.getByRole("button", { name: /^Play$/i }).click();
    const demoRequest = await demoBroadcast;
    expect(demoRequest.postData() ?? "").not.toMatch(
      /pcm|fft|microphone|MediaStream|frequencyData|getDisplayMedia/,
    );
    await expect(display.getByTestId("remote-feature-energy")).toBeVisible({ timeout: 15_000 });

    await controller.getByTestId("audio-mode-browser_capture").click();
    await expect(display.getByTestId("capture-music-follower")).toBeVisible({ timeout: 15_000 });
    await expect(controller.getByTestId("capture-music-status")).toBeVisible({ timeout: 15_000 });
    const gumCalls = await display.evaluate(
      () => (window as unknown as { __prismGumCalls: number }).__prismGumCalls,
    );
    const gdmCalls = await display.evaluate(
      () => (window as unknown as { __prismGdmCalls: number }).__prismGdmCalls,
    );
    const audioElements = await display.evaluate(
      () => (window as unknown as { __prismAudioElements: number }).__prismAudioElements,
    );
    expect(gumCalls).toBe(0);
    expect(gdmCalls).toBe(0);
    expect(audioElements).toBe(0);

    await controller.getByTestId("audio-mode-demo_track").click();
    await expect(controller.getByTestId("audio-mode-demo_track")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await controllerContext.close();
    await displayContext.close();
  });
});
