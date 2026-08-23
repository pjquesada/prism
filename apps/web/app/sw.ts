/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/** Bump when Capture Music / display-silence clients must drop stale bundles. */
const PRISM_SW_CACHE_VERSION = "v2-capture-music";

const DEMO_AUDIO_CACHE = `prism-demo-audio-${PRISM_SW_CACHE_VERSION}`;
const ARTWORK_CACHE = `prism-artwork-${PRISM_SW_CACHE_VERSION}`;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Do not skipWaiting/clientsClaim automatically — a waiting worker notifies the UI
  // so an active session is not interrupted mid-capture without user consent.
  skipWaiting: false,
  clientsClaim: false,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/audio/"),
      handler: new CacheFirst({
        cacheName: DEMO_AUDIO_CACHE,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 4,
            maxAgeSeconds: 60 * 60 * 24 * 30,
          }),
        ],
      }),
    },
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/artwork/"),
      handler: new CacheFirst({
        cacheName: ARTWORK_CACHE,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 8,
            maxAgeSeconds: 60 * 60 * 24 * 30,
          }),
        ],
      }),
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();

self.addEventListener("message", (event) => {
  if (event.data?.type === "PRISM_SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => {
            if (!key.startsWith("prism-demo-audio-") && !key.startsWith("prism-artwork-")) {
              return false;
            }
            return key !== DEMO_AUDIO_CACHE && key !== ARTWORK_CACHE;
          })
          .map((key) => caches.delete(key)),
      );
      // Claim clients only after this worker has been explicitly activated.
      await self.clients.claim();
    })(),
  );
});
