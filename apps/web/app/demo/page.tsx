import Link from "next/link";

import { DemoExperience } from "@/components/demo-experience";

/**
 * Phase 1B local Demo Track + Spectrum experience.
 */
export default function DemoShellPage() {
  return (
    <main className="prism-shell">
      <div className="prism-ember-haze" aria-hidden="true" />
      <div className="prism-aurora-band" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6 py-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="font-display text-2xl font-bold tracking-tight">
            Prism
          </Link>
          <p className="text-sm text-prism-mist">Local demo</p>
        </header>

        <section className="mt-10 flex flex-1 flex-col">
          <DemoExperience variant="demo" />

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/app" className="prism-btn prism-btn-ghost">
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
