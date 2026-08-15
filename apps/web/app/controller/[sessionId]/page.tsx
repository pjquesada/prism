import type { Metadata } from "next";

import { ControllerSessionPanel } from "@/components/session/controller-session-panel";

export const metadata: Metadata = {
  title: "Controller",
};

export default function ControllerSessionPage() {
  return (
    <main className="prism-shell">
      <div className="prism-aurora-band" aria-hidden="true" />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6 py-10">
        <ControllerSessionPanel />
      </div>
    </main>
  );
}
