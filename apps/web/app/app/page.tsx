import Link from "next/link";

import { qualityTierSchema } from "@prism/contracts";

const defaultQuality = qualityTierSchema.parse(process.env.NEXT_PUBLIC_DEFAULT_QUALITY ?? "high");

export default function AppShellPage() {
  return (
    <main className="prism-shell">
      <div className="prism-aurora-band" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-6 py-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="font-display text-2xl font-bold tracking-tight">
            Prism
          </Link>
          <p className="text-sm text-prism-mist">Local combined shell</p>
        </header>

        <section className="mt-16 flex flex-1 flex-col justify-center">
          <h1 className="font-display text-4xl font-semibold tracking-tight text-prism-foam sm:text-5xl">
            Combined mode
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-prism-mist">
            This local-only shell is ready for Demo Track and Spectrum in Phase 1B. No microphone,
            providers, or cloud sessions are wired yet.
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
              Loading, offline, and error states will deepen as audio and render engines land. For
              now the shell stays responsive without network calls.
            </p>
          </div>

          <div className="mt-8">
            <Link href="/" className="prism-btn prism-btn-ghost">
              Back to entry
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
