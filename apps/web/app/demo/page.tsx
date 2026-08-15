import Link from "next/link";

import { DemoExperience } from "@/components/demo-experience";
import { visualizerIdSchema } from "@prism/contracts";

type DemoShellPageProps = {
  searchParams: Promise<{ preset?: string; visualizer?: string }>;
};

/**
 * Local Demo Track + visualizer experience (Phase 1C).
 */
export default async function DemoShellPage({ searchParams }: DemoShellPageProps) {
  const params = await searchParams;
  const visualizerParsed = visualizerIdSchema.safeParse(params.visualizer ?? "spectrum");
  const initialVisualizerId = visualizerParsed.success
    ? visualizerParsed.data === "dreamscape"
      ? "spectrum"
      : visualizerParsed.data
    : "spectrum";

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
          <DemoExperience
            variant="demo"
            initialVisualizerId={initialVisualizerId}
            initialPresetId={params.preset}
          />

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/app" className="prism-btn prism-btn-ghost">
              Open combined mode
            </Link>
            <Link href="/presets" className="prism-btn prism-btn-ghost">
              Presets
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
