import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@prism/ui";

describe("shared UI stub", () => {
  it("renders the Button primitive", () => {
    render(<Button>Start as guest</Button>);
    expect(screen.getByRole("button", { name: "Start as guest" })).toBeTruthy();
  });
});
