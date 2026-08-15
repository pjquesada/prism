import Link from "next/link";
import type { Metadata } from "next";

import { StartSessionPanel } from "@/components/session/start-session-panel";

export const metadata: Metadata = {
  title: "Start session",
};

export default function StartPage() {
  return (
    <main className="prism-shell">
      <div className="prism-aurora-band" aria-hidden="true" />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6 py-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="font-display text-2xl font-bold tracking-tight">
            Prism
          </Link>
          <Link href="/join" className="prism-btn prism-btn-ghost">
            Join
          </Link>
        </header>
        <section className="mt-12 flex flex-1 flex-col">
          <h1 className="font-display text-4xl font-semibold tracking-tight text-prism-foam sm:text-5xl">
            Start
          </h1>
          <p className="mt-3 max-w-xl text-prism-mist">
            Guest session pairing for controller and display devices.
          </p>
          <div className="mt-10">
            <StartSessionPanel />
          </div>
        </section>
      </div>
    </main>
  );
}
