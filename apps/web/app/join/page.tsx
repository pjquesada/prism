import Link from "next/link";
import type { Metadata } from "next";

import { JoinSessionPanel } from "@/components/session/join-session-panel";

export const metadata: Metadata = {
  title: "Join session",
};

export default function JoinPage() {
  return (
    <main className="prism-shell">
      <div className="prism-ember-haze" aria-hidden="true" />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6 py-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="font-display text-2xl font-bold tracking-tight">
            Prism
          </Link>
          <Link href="/start" className="prism-btn prism-btn-ghost">
            Start
          </Link>
        </header>
        <section className="mt-12 flex flex-1 flex-col">
          <h1 className="font-display text-4xl font-semibold tracking-tight text-prism-foam sm:text-5xl">
            Join
          </h1>
          <p className="mt-3 max-w-xl text-prism-mist">
            Enter a six-character code or open a QR join link from the controller.
          </p>
          <div className="mt-10">
            <JoinSessionPanel />
          </div>
        </section>
      </div>
    </main>
  );
}
