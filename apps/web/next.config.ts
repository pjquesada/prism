import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@prism/ui",
    "@prism/contracts",
    "@prism/db",
    "@prism/sync-engine",
    "@prism/audio-engine",
    "@prism/visual-engine",
    "@prism/visualizers",
  ],
};

export default withSerwist(nextConfig);
