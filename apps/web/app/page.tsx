import Link from "next/link";

export default function HomePage() {
  return (
    <main className="prism-shell">
      <div className="prism-ember-haze" aria-hidden="true" />
      <div className="prism-aurora-band" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col justify-end px-6 pb-16 pt-24 sm:justify-center sm:pb-24 sm:pt-20">
        <p className="font-display text-6xl font-bold tracking-tight text-prism-foam sm:text-7xl md:text-8xl">
          Prism
        </p>
        <h1 className="mt-5 max-w-xl font-display text-2xl font-medium leading-snug text-prism-mist sm:text-3xl">
          Music stays where it is. Visuals follow you.
        </h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-prism-mist/90 sm:text-lg">
          A calm companion visualizer for phones, tablets, and screens—local demo foundation first,
          synchronized displays next.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link href="/start" className="prism-btn prism-btn-primary">
            Start session
          </Link>
          <Link href="/demo" className="prism-btn prism-btn-ghost">
            Enter demo shell
          </Link>
          <Link href="/app" className="prism-btn prism-btn-ghost">
            Combined mode
          </Link>
          <Link href="/join" className="prism-btn prism-btn-ghost">
            Join
          </Link>
          <Link href="/presets" className="prism-btn prism-btn-ghost">
            Presets
          </Link>
          <Link href="/offline" className="prism-btn prism-btn-ghost">
            Offline fallback
          </Link>
        </div>
      </div>
    </main>
  );
}
