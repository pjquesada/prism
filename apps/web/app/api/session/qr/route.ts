import QRCode from "qrcode";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url).searchParams.get("url")?.trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return Response.json(
      { error: { code: "invalid_url", message: "Invalid join URL." } },
      { status: 400 },
    );
  }
  // Only allow same-origin-ish join paths for safety when APP_URL is set.
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.startsWith("/join")) {
      return Response.json(
        { error: { code: "invalid_url", message: "Invalid join URL." } },
        { status: 400 },
      );
    }
  } catch {
    return Response.json(
      { error: { code: "invalid_url", message: "Invalid join URL." } },
      { status: 400 },
    );
  }

  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
    color: { dark: "#061018", light: "#e6f2f5" },
  });
  return Response.json({ dataUrl });
}
