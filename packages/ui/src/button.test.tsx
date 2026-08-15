import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button.js";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Start as guest</Button>);
    expect(screen.getByRole("button", { name: "Start as guest" })).toBeTruthy();
  });
});
