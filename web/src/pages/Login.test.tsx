import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Login from "./Login";

vi.mock("../auth", () => ({ useAuth: () => ({ status: "anonymous", login: vi.fn() }) }));

describe("Login", () => {
  it("renders the submit button as a primary button", () => {
    render(<MemoryRouter><Login /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /log in/i })).toHaveClass("primary");
  });
});
