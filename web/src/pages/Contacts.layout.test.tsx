import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Contacts from "./Contacts";
import { api } from "../api";
import { mockViewport } from "../hooks/mockViewport";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { listContacts: vi.fn(), patchContact: vi.fn() } };
});
vi.mock("../alerts");

const items = [
  { jid: "1@s.whatsapp.net", push_name: "דנה", opted_out: true },
  { jid: "2@s.whatsapp.net", push_name: null, opted_out: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listContacts).mockResolvedValue({ items, total: 120 });
  vi.mocked(api.patchContact).mockResolvedValue(items[1]);
});

describe("Contacts at phone width", () => {
  beforeEach(() => void mockViewport(390));

  it("renders cards, not a table, with one of every control", async () => {
    render(<Contacts />);
    const list = await screen.findByRole("list", { name: "Contacts" });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Edit 1@s.whatsapp.net" })).toHaveLength(1);
    expect(within(list).getByText("Opted out")).toBeInTheDocument();
  });

  it("renders Hebrew names inside bdi", async () => {
    render(<Contacts />);
    expect((await screen.findByText("דנה")).tagName).toBe("BDI");
  });

  it("gives touch controls a 44px target", async () => {
    render(<Contacts />);
    const li = (await screen.findAllByRole("listitem"))[0];
    expect(within(li).getByRole("button", { name: /^Edit/ })).toHaveClass("min-h-11");
    await userEvent.click(within(li).getByRole("button", { name: /^Edit/ }));
    expect(within(li).getByRole("textbox")).toHaveClass("min-h-11");
    expect(within(li).getByRole("button", { name: "Save" })).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Next" })).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "All contacts" })).toHaveClass("min-h-11");
  });

  it("shows skeleton cards while loading and the empty state when nothing matches", async () => {
    vi.mocked(api.listContacts).mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = render(<Contacts />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    unmount();
    vi.mocked(api.listContacts).mockResolvedValue({ items: [], total: 0 });
    render(<Contacts />);
    expect(await screen.findByText("No contacts match.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Contacts" })).not.toBeInTheDocument();
  });

  it("shows the save error inside the card being edited", async () => {
    vi.mocked(api.patchContact).mockRejectedValueOnce(new Error("boom"));
    render(<Contacts />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit 2@s.whatsapp.net" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("boom");
    expect(alert.closest("li")).not.toBeNull();
  });
});

describe("Contacts table on tablets", () => {
  it("keeps 44px row actions until lg", async () => {
    mockViewport(800);
    render(<Contacts />);
    const edit = await screen.findByRole("button", { name: "Edit 1@s.whatsapp.net" });
    expect(edit).toHaveClass("min-h-11", "lg:min-h-9");
    await userEvent.click(edit);
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("min-h-11", "lg:min-h-9");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("min-h-11", "lg:min-h-9");
    expect(screen.getByRole("button", { name: "Next" })).toHaveClass("lg:min-h-9");
  });
});

describe("Contacts across a viewport resize", () => {
  it("swaps table and cards without duplicating controls or losing state", async () => {
    const vp = mockViewport(1024);
    render(<Contacts />);
    await screen.findByRole("table", { name: "Contacts" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search contacts" }), { target: { value: "draft" } });
    await userEvent.click(screen.getByRole("button", { name: "Opted out" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.listContacts).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50, opted_out: true })));
    await userEvent.click(await screen.findByRole("button", { name: "Edit 2@s.whatsapp.net" }));
    await userEvent.type(screen.getByLabelText("Name for 2@s.whatsapp.net"), "Eli");

    for (const [width, kind] of [[600, "list"], [1024, "table"]] as const) {
      vp.setWidth(width);
      expect(await screen.findByRole(kind, { name: "Contacts" })).toBeInTheDocument();
      expect(screen.queryByRole(kind === "list" ? "table" : "list", { name: "Contacts" })).not.toBeInTheDocument();
      expect(screen.getAllByLabelText("Name for 2@s.whatsapp.net")).toHaveLength(1);
      expect(screen.getByLabelText("Name for 2@s.whatsapp.net")).toHaveValue("Eli");
      expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "Edit 1@s.whatsapp.net" })).toHaveLength(1);
      expect(screen.getByRole("textbox", { name: "Search contacts" })).toHaveValue("draft");
      expect(screen.getByRole("button", { name: "Opted out" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
    }
  });
});

describe("Contacts focus", () => {
  const user = userEvent.setup();

  it("moves focus into the name input on Edit and back to the row's Edit button on Cancel", async () => {
    mockViewport(1024);
    render(<Contacts />);
    await user.click(await screen.findByRole("button", { name: "Edit 2@s.whatsapp.net" }));
    expect(screen.getByLabelText("Name for 2@s.whatsapp.net")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Edit 2@s.whatsapp.net" })).toHaveFocus();
  });

  it("returns focus to the Edit button after a successful Save", async () => {
    mockViewport(390);
    render(<Contacts />);
    await user.click(await screen.findByRole("button", { name: "Edit 2@s.whatsapp.net" }));
    expect(screen.getByLabelText("Name for 2@s.whatsapp.net")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit 2@s.whatsapp.net" })).toHaveFocus());
  });

  it("puts focus back in the input after a failed Save", async () => {
    mockViewport(1024);
    vi.mocked(api.patchContact).mockRejectedValueOnce(new Error("boom"));
    render(<Contacts />);
    await user.click(await screen.findByRole("button", { name: "Edit 2@s.whatsapp.net" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByLabelText("Name for 2@s.whatsapp.net")).toHaveFocus());
  });

  it("keeps focus in the edit input across a table/cards swap, and does not steal it otherwise", async () => {
    const vp = mockViewport(1024);
    render(<Contacts />);
    await user.click(await screen.findByRole("button", { name: "Edit 2@s.whatsapp.net" }));
    await user.type(screen.getByLabelText("Name for 2@s.whatsapp.net"), "Eli");
    vp.setWidth(600);
    await screen.findByRole("list", { name: "Contacts" });
    expect(screen.getByLabelText("Name for 2@s.whatsapp.net")).toHaveFocus();
    expect(screen.getByLabelText("Name for 2@s.whatsapp.net")).toHaveValue("Eli");
    await user.click(screen.getByRole("textbox", { name: "Search contacts" }));
    vp.setWidth(1024);
    await screen.findByRole("table", { name: "Contacts" });
    expect(screen.getByRole("textbox", { name: "Search contacts" })).toHaveFocus();
  });
});
