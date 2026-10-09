import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Contacts from "./Contacts";
import { ApiError, api } from "../api";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { listContacts: vi.fn(), patchContact: vi.fn() } };
});

vi.mock("../alerts");
import { toast } from "../alerts";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listContacts).mockResolvedValue({
    items: [
      { jid: "1@s.whatsapp.net", push_name: "Dana", opted_out: true },
      { jid: "2@s.whatsapp.net", push_name: null, opted_out: false },
    ],
    total: 2,
  });
  vi.mocked(api.patchContact).mockResolvedValue({ jid: "2@s.whatsapp.net", push_name: "Eli", opted_out: false });
});

describe("Contacts page", () => {
  it("lists contacts with an opted-out badge", async () => {
    render(<Contacts />);
    expect(await screen.findByText("Dana")).toBeInTheDocument();
    expect(screen.getByText("Opted out", { selector: ".badge" })).toBeInTheDocument();
  });

  it("edits a name and clears it when emptied", async () => {
    render(<Contacts />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit 2@s.whatsapp.net" }));
    const input = screen.getByLabelText("Name for 2@s.whatsapp.net");
    await userEvent.type(input, "Eli");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.patchContact).toHaveBeenCalledWith("2@s.whatsapp.net", "Eli"));
    await userEvent.click(await screen.findByRole("button", { name: "Edit 1@s.whatsapp.net" }));
    await userEvent.clear(screen.getByLabelText("Name for 1@s.whatsapp.net"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.patchContact).toHaveBeenLastCalledWith("1@s.whatsapp.net", null));
  });

  it("filters by search and opted-out", async () => {
    render(<Contacts />);
    await screen.findByText("Dana");
    await userEvent.type(screen.getByLabelText("Search contacts"), "dan{Enter}");
    await waitFor(() => expect(api.listContacts).toHaveBeenLastCalledWith(expect.objectContaining({ search: "dan", offset: 0 })));
    await userEvent.selectOptions(screen.getByLabelText("Filter"), "opted");
    await waitFor(() => expect(api.listContacts).toHaveBeenLastCalledWith(expect.objectContaining({ opted_out: true })));
  });

  it("keeps the editor, typed name and error when saving fails, and reloads", async () => {
    vi.mocked(api.patchContact).mockRejectedValueOnce(new ApiError(500, "boom"));
    render(<Contacts />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit 2@s.whatsapp.net" }));
    await userEvent.type(screen.getByLabelText("Name for 2@s.whatsapp.net"), "Eli");
    const before = vi.mocked(api.listContacts).mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(screen.getByLabelText("Name for 2@s.whatsapp.net")).toHaveValue("Eli");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(api.patchContact).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(vi.mocked(api.listContacts).mock.calls.length).toBe(before + 1));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables Save while a save is in flight", async () => {
    let resolve!: (v: never) => void;
    vi.mocked(api.patchContact).mockReturnValueOnce(new Promise((r) => { resolve = r as never; }));
    render(<Contacts />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit 2@s.whatsapp.net" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    resolve(undefined as never);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
    expect(api.patchContact).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state", async () => {
    vi.mocked(api.listContacts).mockResolvedValue({ items: [], total: 0 });
    render(<Contacts />);
    expect(await screen.findByText("No contacts match.")).toBeInTheDocument();
  });

  it("shows the load error separately from action errors", async () => {
    vi.mocked(api.listContacts).mockRejectedValue(new ApiError(500, "load failed"));
    render(<Contacts />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("load failed"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("resets the offset when the filter changes", async () => {
    vi.mocked(api.listContacts).mockResolvedValue({
      items: [{ jid: "1@s.whatsapp.net", push_name: "Dana", opted_out: false }],
      total: 120,
    });
    render(<Contacts />);
    await screen.findByText("Dana");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.listContacts).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })));
    await userEvent.selectOptions(screen.getByLabelText("Filter"), "not");
    await waitFor(() => expect(api.listContacts).toHaveBeenLastCalledWith(expect.objectContaining({ opted_out: false, offset: 0 })));
  });

  it("disables other rows' Edit buttons while a save is in flight", async () => {
    let resolve!: (v: never) => void;
    vi.mocked(api.patchContact).mockReturnValueOnce(new Promise((r) => { resolve = r as never; }));
    render(<Contacts />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit 2@s.whatsapp.net" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("button", { name: "Edit 1@s.whatsapp.net" })).toBeDisabled();
    resolve(undefined as never);
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit 1@s.whatsapp.net" })).toBeEnabled());
  });

  it("closes the editor when the filter changes", async () => {
    render(<Contacts />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit 2@s.whatsapp.net" }));
    expect(screen.getByLabelText("Name for 2@s.whatsapp.net")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Filter"), "opted");
    await waitFor(() => expect(screen.queryByLabelText("Name for 2@s.whatsapp.net")).not.toBeInTheDocument());
  });

  it("moves to the last valid page when a refresh shrinks the total", async () => {
    const item = { jid: "1@s.whatsapp.net", push_name: "Dana", opted_out: false };
    vi.mocked(api.listContacts).mockImplementation(async (p) => ({ items: [item], total: (p.offset ?? 0) >= 100 ? 60 : 120 }));
    render(<Contacts />);
    await screen.findByText("Dana");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.listContacts).toHaveBeenCalledWith(expect.objectContaining({ offset: 100 })));
    await waitFor(() => expect(api.listContacts).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })));
  });

  it("resets the offset to 0 when a search is submitted from a later page", async () => {
    vi.mocked(api.listContacts).mockResolvedValue({
      items: [{ jid: "1@s.whatsapp.net", push_name: "Dana", opted_out: false }],
      total: 120,
    });
    render(<Contacts />);
    await screen.findByText("Dana");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.listContacts).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })));
    await userEvent.type(screen.getByLabelText("Search contacts"), "dan{Enter}");
    await waitFor(() => expect(api.listContacts).toHaveBeenLastCalledWith(expect.objectContaining({ search: "dan", offset: 0 })));
  });
});
