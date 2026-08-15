"use client";

import { useEffect, useState } from "react";

type PairingQrProps = {
  joinUrl: string;
  label?: string;
};

function PairingQrImage({ joinUrl }: { joinUrl: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/session/qr?url=${encodeURIComponent(joinUrl)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("qr_failed");
        const data = (await res.json()) as { dataUrl?: string };
        if (!cancelled) setDataUrl(data.dataUrl ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("QR unavailable — use the code instead.");
      });
    return () => {
      cancelled = true;
    };
  }, [joinUrl]);

  if (dataUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={dataUrl}
        alt="Pairing QR code"
        width={180}
        height={180}
        className="rounded-sm border border-prism-slate bg-prism-foam p-2"
      />
    );
  }

  return (
    <div
      className="flex h-[180px] w-[180px] items-center justify-center border border-prism-slate bg-prism-deep/60 text-sm text-prism-mist"
      role="status"
    >
      {error ?? "Loading QR…"}
    </div>
  );
}

export function PairingQr({ joinUrl, label = "Scan to join" }: PairingQrProps) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-prism-mist">{label}</p>
      <PairingQrImage key={joinUrl} joinUrl={joinUrl} />
    </div>
  );
}
