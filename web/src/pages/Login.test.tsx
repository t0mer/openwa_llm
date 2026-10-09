import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";
import Login from "./Login";

const login = vi.fn();
let status = "anonymous";
vi.mock("../auth", () => ({ useAuth: () => ({ status, login }) }));

function setup() {
  render(<MemoryRouter><Login /></MemoryRouter>);
}
async function submit() {
  await userEvent.type(screen.getByLabelText("Password"), "pw");
  await userEvent.click(screen.getByRole("button", { name: /log in/i }));
}

beforeEach(() => {
  login.mockReset();
  status = "anonymous";
});

describe("Login", () => {
  it("renders a max-w-sm card with a primary submit button and the brand", () => {
    setup();
    expect(screen.getByRole("button", { name: /log in/i })).toHaveClass("bg-primary");
    expect(screen.getByRole("heading", { name: "Admin login" }).closest("form")).toHaveClass("max-w-sm", "rounded-xl", "border", "bg-surface", "p-6");
    expect(screen.getByText("WhatsApp Bot Admin")).toBeInTheDocument();
    expect(document.title).toBe("Log in · WhatsApp Bot Admin");
  });

  it("shows a spinner and disables the button while busy", async () => {
    let finish: () => void = () => {};
    login.mockReturnValue(new Promise<void>((r) => (finish = r)));
    setup();
    expect(screen.queryByTestId("login-spinner")).not.toBeInTheDocument();
    await submit();
    expect(screen.getByTestId("login-spinner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log in/i })).toBeDisabled();
    finish();
    expect(await screen.findByRole("button", { name: /log in/i })).toBeEnabled();
    expect(screen.queryByTestId("login-spinner")).not.toBeInTheDocument();
  });

  it.each([
    [401, "Wrong password."],
    [429, "Too many attempts. Try again in a minute."],
    [500, "Login failed."],
  ])("shows the message for a %i", async (code, msg) => {
    login.mockRejectedValue(new ApiError(code, "x"));
    setup();
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(msg);
  });

  it("shows a generic message for a non-API failure", async () => {
    login.mockRejectedValue(new Error("network"));
    setup();
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Login failed.");
  });

  it("shows the disabled notice", () => {
    status = "disabled";
    setup();
    expect(screen.getByText(/disabled on this server/i)).toBeInTheDocument();
  });
});
