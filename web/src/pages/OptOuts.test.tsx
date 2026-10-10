import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OptOuts from "./OptOuts";
import { mockViewport } from "../hooks/mockViewport";
import { ApiError, api } from "../api";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { listOptOuts: vi.fn(), addOptOut: vi.fn(), removeOptOut: vi.fn() } };
});

vi.mock("../alerts");
import { confirm, toast } from "../alerts";

beforeEach(() => {
  vi.clearAllMocks();
  mockViewport(1024);
  vi.mocked(api.listOptOuts).mockResolvedValue([
    { jid: "1@s.whatsapp.net", push_name: "Dana", created_at: "2026-01-01T00:00:00Z" },
  ]);
  vi.mocked(api.addOptOut).mockResolvedValue({ jid: "9@s.whatsapp.net", push_name: null, created_at: "2026-01-01T00:00:00Z" });
  vi.mocked(api.removeOptOut).mockResolvedValue(undefined);
  vi.mocked(confirm).mockResolvedValue(true);
});

describe("OptOuts page", () => {
  it("lists opted-out contacts", async () => {
    render(<OptOuts />);
    expect(await screen.findByText("Dana")).toBeInTheDocument();
  });

  it("adds an opt-out from a typed number and clears the field", async () => {
    render(<OptOuts />);
    const input = await screen.findByLabelText("Phone number or JID");
    await userEvent.type(input, "+972 50-123-4567");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(api.addOptOut).toHaveBeenCalledWith("+972 50-123-4567"));
    expect(input).toHaveValue("");
  });

  it("shows the server's validation message when the input is rejected", async () => {
    vi.mocked(api.addOptOut).mockRejectedValueOnce(new ApiError(422, "not a phone number"));
    render(<OptOuts />);
    await userEvent.type(await screen.findByLabelText("Phone number or JID"), "abc");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("not a phone number"));
  });

  it("removes an opt-out after confirmation only", async () => {
    render(<OptOuts />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove 1@s.whatsapp.net" }));
    await waitFor(() => expect(api.removeOptOut).toHaveBeenCalledWith("1@s.whatsapp.net"));
    vi.mocked(api.removeOptOut).mockClear();
    vi.mocked(confirm).mockResolvedValue(false);
    await userEvent.click(await screen.findByRole("button", { name: "Remove 1@s.whatsapp.net" }));
    expect(api.removeOptOut).not.toHaveBeenCalled();
  });

  it("keeps the typed value on a rejected add and reloads", async () => {
    vi.mocked(api.addOptOut).mockRejectedValueOnce(new ApiError(422, "not a phone number"));
    render(<OptOuts />);
    const input = await screen.findByLabelText("Phone number or JID");
    await userEvent.type(input, "abc");
    const before = vi.mocked(api.listOptOuts).mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("not a phone number"));
    expect(input).toHaveValue("abc");
    expect(api.addOptOut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(vi.mocked(api.listOptOuts).mock.calls.length).toBe(before + 1));
  });

  it("toasts success after adding and removing", async () => {
    render(<OptOuts />);
    await userEvent.type(await screen.findByLabelText("Phone number or JID"), "972501234567");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    await userEvent.click(await screen.findByRole("button", { name: "Remove 1@s.whatsapp.net" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
  });

  it("disables Add while a request is in flight", async () => {
    let resolve!: (v: never) => void;
    vi.mocked(api.addOptOut).mockReturnValueOnce(new Promise((r) => { resolve = r as never; }));
    render(<OptOuts />);
    await userEvent.type(await screen.findByLabelText("Phone number or JID"), "123");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    resolve(undefined as never);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add" })).toBeEnabled());
    expect(api.addOptOut).toHaveBeenCalledTimes(1);
  });

  it("shows removal failure and still reloads", async () => {
    vi.mocked(api.removeOptOut).mockRejectedValueOnce(new ApiError(500, "cannot remove"));
    render(<OptOuts />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove 1@s.whatsapp.net" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("cannot remove"));
    expect(vi.mocked(api.listOptOuts).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("shows an empty state", async () => {
    vi.mocked(api.listOptOuts).mockResolvedValue([]);
    render(<OptOuts />);
    expect(await screen.findByText("Nobody has opted out.")).toBeInTheDocument();
  });

  it("sends no request for a whitespace-only submit", async () => {
    render(<OptOuts />);
    await userEvent.type(await screen.findByLabelText("Phone number or JID"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(api.addOptOut).not.toHaveBeenCalled();
  });

  it("disables the input while an add is in flight", async () => {
    let resolve!: (v: never) => void;
    vi.mocked(api.addOptOut).mockReturnValueOnce(new Promise((r) => { resolve = r as never; }));
    render(<OptOuts />);
    const input = await screen.findByLabelText("Phone number or JID");
    await userEvent.type(input, "123");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(input).toBeDisabled();
    resolve(undefined as never);
    await waitFor(() => expect(input).toBeEnabled());
  });

  it("disables Remove buttons while a remove is in flight", async () => {
    let resolve!: (v: never) => void;
    vi.mocked(api.removeOptOut).mockReturnValueOnce(new Promise((r) => { resolve = r as never; }));
    render(<OptOuts />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove 1@s.whatsapp.net" }));
    expect(screen.getByRole("button", { name: "Remove 1@s.whatsapp.net" })).toBeDisabled();
    resolve(undefined as never);
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove 1@s.whatsapp.net" })).toBeEnabled());
  });

  it("names the JID in the confirmation message", async () => {
    render(<OptOuts />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove 1@s.whatsapp.net" }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("1@s.whatsapp.net"), danger: true }));
  });
});
