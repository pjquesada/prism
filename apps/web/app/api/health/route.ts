import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "prism-web",
    phase: "1A",
  });
}
