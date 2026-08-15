import Link from "next/link";

import { PresetEditor } from "@/components/preset-editor";

type PresetDetailPageProps = {
  params: Promise<{ presetId: string }>;
};

export default async function PresetDetailPage({ params }: PresetDetailPageProps) {
  const { presetId } = await params;
  return (
    <main className="prism-shell">
      <div className="prism-ember-haze" aria-hidden="true" />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-6 py-10">
        <header className="flex items-center justify-between gap-4">
          <Link href="/presets" className="font-display text-2xl font-bold tracking-tight">
            Prism
          </Link>
          <p className="text-sm text-prism-mist">Preset editor</p>
        </header>
        <section className="mt-10 flex flex-1 flex-col">
          <PresetEditor presetId={presetId} />
        </section>
      </div>
    </main>
  );
}
