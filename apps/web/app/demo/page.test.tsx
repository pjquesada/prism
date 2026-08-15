import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/demo-experience", () => ({
  DemoExperience: ({ variant }: { variant: string }) => (
    <div>
      <h1>Spectrum</h1>
      <button type="button">Play</button>
      <p>Mock demo experience ({variant})</p>
    </div>
  ),
}));

import DemoShellPage from "@/app/demo/page";

describe("DemoShellPage", () => {
  it("renders Demo Track experience with a Play control", () => {
    render(<DemoShellPage />);
    expect(screen.getByRole("heading", { name: "Spectrum" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /play/i })).toBeTruthy();
  });
});
