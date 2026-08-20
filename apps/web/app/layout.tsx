import type { Metadata, Viewport } from "next";
import { Figtree, Syne } from "next/font/google";
import type { ReactNode } from "react";

import { ServiceWorkerRegister } from "@/components/service-worker-register";

import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Prism",
    template: "%s · Prism",
  },
  description: "Atmospheric multi-device music visualizer companion.",
  applicationName: "Prism",
  appleWebApp: {
    capable: true,
    title: "Prism",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a1c28",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${syne.variable} ${figtree.variable}`}>
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
