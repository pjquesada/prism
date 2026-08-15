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

import DemoShellPage from "@/app/demo/page";

describe("DemoShellPage", () => {
  it("renders the local-only demo shell without audio controls", () => {
    render(<DemoShellPage />);
    expect(screen.getByRole("heading", { name: "Demo" })).toBeTruthy();
    expect(screen.getByText(/Demo Track player placeholder/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /play/i })).toBeNull();
  });
});
