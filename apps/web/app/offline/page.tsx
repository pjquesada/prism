import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="prism-shell">
      <div className="prism-ember-haze" aria-hidden="true" />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center px-6 py-16">
        <p className="font-display text-4xl font-bold tracking-tight text-prism-foam">Prism</p>
        <h1 className="mt-4 font-display text-3xl font-semibold text-prism-foam">
          You&apos;re offline
        </h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-prism-mist">
          The installable shell is still here. Demo Track playback and Spectrum will work offline
          after they ship and are cached.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/" className="prism-btn prism-btn-primary">
            Try entry again
          </Link>
          <Link href="/demo" className="prism-btn prism-btn-ghost">
            Open demo shell
          </Link>
          <Link href="/app" className="prism-btn prism-btn-ghost">
            Combined mode
          </Link>
        </div>
      </div>
    </main>
  );
}
