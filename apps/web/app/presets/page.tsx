import Link from "next/link";

import { PresetBrowser } from "@/components/preset-browser";

export default function PresetsPage() {
  return (
    <main className="prism-shell">
      <div className="prism-aurora-band" aria-hidden="true" />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6 py-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="font-display text-2xl font-bold tracking-tight">
            Prism
          </Link>
          <p className="text-sm text-prism-mist">Guest presets · local only</p>
        </header>
        <section className="mt-10 flex flex-1 flex-col">
          <h1 className="font-display text-4xl font-semibold text-prism-foam">Presets</h1>
          <p className="mt-3 max-w-xl text-prism-mist">
            Built-in presets are immutable. Your copies stay in this browser&apos;s local storage.
          </p>
          <div className="mt-8">
            <PresetBrowser />
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/demo" className="prism-btn prism-btn-ghost">
              Open demo
            </Link>
            <Link href="/app" className="prism-btn prism-btn-ghost">
              Combined mode
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
