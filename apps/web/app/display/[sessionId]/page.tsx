import type { Metadata } from "next";

import { DisplaySessionPanel } from "@/components/session/display-session-panel";

export const metadata: Metadata = {
  title: "Display",
};

export default function DisplaySessionPage() {
  return <DisplaySessionPanel />;
}
