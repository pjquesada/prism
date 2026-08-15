import Link from "next/link";

import { qualityTierSchema } from "@prism/contracts";

const defaultQuality = qualityTierSchema.parse(process.env.NEXT_PUBLIC_DEFAULT_QUALITY ?? "high");

/**
 * Combined mode route from the build specification (`/app`).
 * Controller + display on one device. Distinct from `/demo` (Demo Track shell).
 */
export default function AppShellPage() {
  return (
    <main className="prism-shell">
      <div className="prism-aurora-band" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-6 py-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="font-display text-2xl font-bold tracking-tight">
            Prism
          </Link>
          <p className="text-sm text-prism-mist">Combined mode</p>
        </header>

        <section className="mt-16 flex flex-1 flex-col justify-center">
          <h1 className="font-display text-4xl font-semibold tracking-tight text-prism-foam sm:text-5xl">
            Combined mode
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-prism-mist">
            Spec route for controller and display on one device. Foundation shell only—pairing,
            sessions, and reactive visuals arrive in later phases.
          </p>

          <div
            className="mt-10 rounded-sm border border-prism-slate bg-prism-deep/60 p-6"
            role="status"
            aria-live="polite"
          >
            <p className="text-sm uppercase tracking-[0.14em] text-prism-aurora">Empty canvas</p>
            <p className="mt-2 text-prism-foam">
              Visualizer surface placeholder · quality default: {defaultQuality}
            </p>
            <p className="mt-4 text-sm text-prism-mist">
              For the local Demo Track shell, use{" "}
              <Link href="/demo" className="text-prism-aurora underline-offset-2 hover:underline">
                /demo
              </Link>
              .
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/demo" className="prism-btn prism-btn-primary">
              Open demo shell
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
