import Link from "next/link";

import { qualityTierSchema } from "@prism/contracts";

import { DemoExperience } from "@/components/demo-experience";

const defaultQuality = qualityTierSchema.parse(process.env.NEXT_PUBLIC_DEFAULT_QUALITY ?? "high");

/**
 * Combined mode route from the build specification (`/app`).
 * Phase 1B: Demo Track + Spectrum on one device.
 */
export default function AppShellPage() {
  return (
    <main className="prism-shell">
      <div className="prism-aurora-band" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6 py-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="font-display text-2xl font-bold tracking-tight">
            Prism
          </Link>
          <p className="text-sm text-prism-mist">Combined mode</p>
        </header>

        <section className="mt-10 flex flex-1 flex-col">
          <DemoExperience variant="combined" quality={defaultQuality} />

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/demo" className="prism-btn prism-btn-ghost">
              Open demo shell
            </Link>
            <Link href="/presets" className="prism-btn prism-btn-ghost">
              Presets
            </Link>
            <Link href="/" className="prism-btn prism-btn-ghost">
              Back to entry
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
