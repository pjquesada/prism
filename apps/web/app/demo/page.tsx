import Link from "next/link";

/**
 * Phase 1A local-only demo application shell.
 * UI only — Demo Track audio, Web Audio, and Spectrum arrive in Phase 1B.
 */
export default function DemoShellPage() {
  return (
    <main className="prism-shell">
      <div className="prism-ember-haze" aria-hidden="true" />
      <div className="prism-aurora-band" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-6 py-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="font-display text-2xl font-bold tracking-tight">
            Prism
          </Link>
          <p className="text-sm text-prism-mist">Local demo shell</p>
        </header>

        <section className="mt-16 flex flex-1 flex-col justify-center">
          <h1 className="font-display text-4xl font-semibold tracking-tight text-prism-foam sm:text-5xl">
            Demo
          </h1>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-prism-mist">
            Local-only application shell for the royalty-free Demo Track path. This page is
            foundation UI only—no audio playback, Web Audio graph, microphone, or visualizer canvas
            yet.
          </p>

          <div
            className="mt-10 space-y-4 rounded-sm border border-prism-slate bg-prism-deep/60 p-6"
            role="status"
            aria-live="polite"
          >
            <div>
              <p className="text-sm uppercase tracking-[0.14em] text-prism-aurora">Empty</p>
              <p className="mt-2 text-prism-foam">Demo Track player placeholder</p>
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.14em] text-prism-aurora">Fallback</p>
              <p className="mt-2 text-sm text-prism-mist">
                Audio and Spectrum land in Phase 1B. Until then this shell stays offline-friendly
                and network-free.
              </p>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/app" className="prism-btn prism-btn-primary">
              Open combined mode
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
