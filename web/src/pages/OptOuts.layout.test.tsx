import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OptOuts from "./OptOuts";
import { ApiError, api } from "../api";
import { mockViewport } from "../hooks/mockViewport";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { listOptOuts: vi.fn(), addOptOut: vi.fn(), removeOptOut: vi.fn() } };
});
vi.mock("../alerts");
import { confirm, toast } from "../alerts";

const rows = [
  { jid: "1@s.whatsapp.net", push_name: "דנה", created_at: "2026-01-01T00:00:00Z" },
  { jid: "2@s.whatsapp.net", push_name: null, created_at: "2026-01-02T00:00:00Z" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listOptOuts).mockResolvedValue(rows);
  vi.mocked(api.addOptOut).mockResolvedValue(rows[0]);
  vi.mocked(api.removeOptOut).mockResolvedValue(undefined);
  vi.mocked(confirm).mockResolvedValue(true);
});

describe("Opt-outs at phone width", () => {
  beforeEach(() => void mockViewport(390));

  it("renders cards, not a table, with one Remove per person", async () => {
    render(<OptOuts />);
    const list = await screen.findByRole("list", { name: "Opt-outs" });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Remove 1@s.whatsapp.net" })).toHaveLength(1);
    expect(within(list).getAllByText(/^Since /)).toHaveLength(2);
  });

  it("renders Hebrew names inside bdi", async () => {
    render(<OptOuts />);
    expect((await screen.findByText("דנה")).tagName).toBe("BDI");
  });

  it("gives the form and Remove a 44px target and confirms naming the JID", async () => {
    render(<OptOuts />);
    const li = (await screen.findAllByRole("listitem"))[0];
    const remove = within(li).getByRole("button", { name: "Remove 1@s.whatsapp.net" });
    expect(remove).toHaveClass("min-h-11");
    expect(screen.getByLabelText("Phone number or JID")).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Add" })).toHaveClass("min-h-11");
    await userEvent.click(remove);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("1@s.whatsapp.net"), danger: true }));
    await waitFor(() => expect(api.removeOptOut).toHaveBeenCalledWith("1@s.whatsapp.net"));
  });

  it("links the hint to the input and keeps the typed value on a rejected add", async () => {
    vi.mocked(api.addOptOut).mockRejectedValueOnce(new ApiError(422, "not a phone number"));
    render(<OptOuts />);
    const input = await screen.findByLabelText("Phone number or JID");
    expect(input).toHaveAccessibleDescription(/International format/);
    await userEvent.type(input, "abc");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("not a phone number"));
    expect(input).toHaveValue("abc");
  });

  it("shows skeletons while loading, then the empty state", async () => {
    vi.mocked(api.listOptOuts).mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = render(<OptOuts />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    unmount();
    vi.mocked(api.listOptOuts).mockResolvedValue([]);
    render(<OptOuts />);
    expect(await screen.findByText("Nobody has opted out.")).toBeInTheDocument();
  });

  it("shows a failed first load only inline, with nothing else under it", async () => {
    vi.mocked(api.listOptOuts).mockRejectedValue(new ApiError(500, "load failed"));
    render(<OptOuts />);
    expect(await screen.findByRole("alert")).toHaveTextContent("load failed");
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByRole("list", { name: "Opt-outs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("toasts only when a refresh fails while rows are on screen", async () => {
    render(<OptOuts />);
    await screen.findByRole("list", { name: "Opt-outs" });
    vi.mocked(api.listOptOuts).mockRejectedValue(new ApiError(500, "refresh failed"));
    await userEvent.click(screen.getByRole("button", { name: "Remove 1@s.whatsapp.net" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("refresh failed"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Opt-outs add form", () => {
  it("keeps the hint outside the input row so the button aligns with the input", async () => {
    mockViewport(1024);
    render(<OptOuts />);
    const input = await screen.findByLabelText("Phone number or JID");
    const add = screen.getByRole("button", { name: "Add" });
    const row = add.parentElement!;
    expect(row).toContainElement(input);
    expect(row).toHaveClass("sm:items-end");
    const hint = screen.getByText(/International format/);
    expect(row).not.toContainElement(hint);
    expect(input).toHaveAccessibleDescription(/International format/);
  });
});

describe("Opt-outs table on tablets", () => {
  it("keeps a 44px Remove until lg", async () => {
    mockViewport(800);
    render(<OptOuts />);
    expect(await screen.findByRole("button", { name: "Remove 1@s.whatsapp.net" })).toHaveClass("min-h-11", "lg:min-h-9");
  });
});

describe("Opt-outs across a viewport resize", () => {
  it("swaps table and cards keeping the typed value and a pending remove", async () => {
    const vp = mockViewport(1024);
    render(<OptOuts />);
    await screen.findByRole("table", { name: "Opt-outs" });
    let release!: () => void;
    vi.mocked(api.removeOptOut).mockReturnValueOnce(new Promise((r) => { release = () => r(undefined); }));
    await userEvent.click(screen.getByRole("button", { name: "Remove 1@s.whatsapp.net" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove 2@s.whatsapp.net" })).toBeDisabled());

    for (const [width, kind] of [[600, "list"], [1024, "table"]] as const) {
      vp.setWidth(width);
      expect(await screen.findByRole(kind, { name: "Opt-outs" })).toBeInTheDocument();
      expect(screen.queryByRole(kind === "list" ? "table" : "list", { name: "Opt-outs" })).not.toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Remove 1@s.whatsapp.net" })).toHaveLength(1);
      expect(screen.getAllByLabelText("Phone number or JID")).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Remove 1@s.whatsapp.net" })).toBeDisabled();
    }
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove 1@s.whatsapp.net" })).toBeEnabled());
  });

  it("keeps a typed value across the swap", async () => {
    const vp = mockViewport(1024);
    render(<OptOuts />);
    await userEvent.type(await screen.findByLabelText("Phone number or JID"), "972501");
    vp.setWidth(600);
    await screen.findByRole("list", { name: "Opt-outs" });
    expect(screen.getByLabelText("Phone number or JID")).toHaveValue("972501");
  });
});

describe("Opt-outs focus after Remove", () => {
  const user = userEvent.setup();

  it("moves focus to the next row's Remove, then the previous, then the Add field", async () => {
    mockViewport(1024);
    const three = [...rows, { jid: "3@s.whatsapp.net", push_name: "C", created_at: "2026-01-03T00:00:00Z" }];
    let current = three;
    vi.mocked(api.listOptOuts).mockImplementation(async () => current);
    vi.mocked(api.removeOptOut).mockImplementation(async (j) => { current = current.filter((o) => o.jid !== j); });
    render(<OptOuts />);
    await user.click(await screen.findByRole("button", { name: "Remove 1@s.whatsapp.net" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove 2@s.whatsapp.net" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Remove 3@s.whatsapp.net" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove 2@s.whatsapp.net" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Remove 2@s.whatsapp.net" }));
    await waitFor(() => expect(screen.getByLabelText("Phone number or JID")).toHaveFocus());
  });

  it("keeps focus on the same Remove when it fails", async () => {
    mockViewport(390);
    vi.mocked(api.removeOptOut).mockRejectedValueOnce(new ApiError(500, "nope"));
    render(<OptOuts />);
    await user.click(await screen.findByRole("button", { name: "Remove 1@s.whatsapp.net" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("nope"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove 1@s.whatsapp.net" })).toHaveFocus());
  });
});
