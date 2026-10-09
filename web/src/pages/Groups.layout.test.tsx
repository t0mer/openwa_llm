import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Groups from "./Groups";
import { api } from "../api";
import { mockViewport } from "../hooks/mockViewport";
import type { Group } from "../types";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { listGroups: vi.fn(), patchGroup: vi.fn() } };
});
vi.mock("../alerts");
import { confirm, toast } from "../alerts";

const base: Group = {
  group_jid: "1@g.us", group_name: "WA name", display_name: null, group_topic: null,
  owner_jid: null, managed: false, notify_on_spam: false, summary_language: null,
  community_keys: ["fam"], last_summary_sync: "2026-01-02T03:04:05", last_ingest: "2026-01-02T03:04:05",
  message_count: 12, schedule_count: 2,
};

function setup(groups: Group[]) {
  vi.mocked(api.listGroups).mockResolvedValue({ items: groups, total: groups.length });
  vi.mocked(api.patchGroup).mockImplementation(async (jid, patch) => ({ ...groups.find((g) => g.group_jid === jid)!, ...patch }) as Group);
  return render(<Groups />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(confirm).mockResolvedValue(true);
});

describe("Groups toolbar (desktop)", () => {
  beforeEach(() => void mockViewport(1024));

  it("searches on submit with the trimmed text and resets the offset", async () => {
    setup([base]);
    await screen.findByRole("table", { name: "Groups" });
    await userEvent.type(screen.getByRole("textbox", { name: "Search groups" }), "  fam  ");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(api.listGroups).toHaveBeenLastCalledWith(expect.objectContaining({ search: "fam", offset: 0 })));
  });

  it("filters with chips, exposing the active one with aria-pressed", async () => {
    setup([base]);
    await screen.findByRole("table");
    const group = screen.getByRole("group", { name: "Filter" });
    const chip = (n: string) => within(group).getByRole("button", { name: n });
    expect(chip("All")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(chip("Enabled"));
    await waitFor(() => expect(api.listGroups).toHaveBeenLastCalledWith(expect.objectContaining({ managed: true })));
    expect(chip("Enabled")).toHaveAttribute("aria-pressed", "true");
    expect(chip("All")).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(chip("Disabled"));
    await waitFor(() => expect(api.listGroups).toHaveBeenLastCalledWith(expect.objectContaining({ managed: false })));
    await userEvent.click(chip("All"));
    await waitFor(() => expect(api.listGroups).toHaveBeenLastCalledWith(expect.objectContaining({ managed: undefined })));
  });

  it("announces the count politely so filter results are heard", async () => {
    setup([base]);
    const count = await screen.findByText("1 groups");
    expect(count).toHaveAttribute("aria-live", "polite");
  });

  it("shows the total count", async () => {
    vi.mocked(api.listGroups).mockResolvedValue({ items: [base], total: 7 });
    render(<Groups />);
    expect(await screen.findByText("7 groups")).toBeInTheDocument();
  });

  it("renders Respond and Spam notice as named switches reflecting state", async () => {
    setup([{ ...base, managed: true }]);
    expect(await screen.findByRole("switch", { name: "Respond in 1@g.us" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Spam notice in 1@g.us" })).not.toBeChecked();
  });

  it("disables the switches and the language select while saving", async () => {
    setup([base]);
    let release!: () => void;
    vi.mocked(api.patchGroup).mockReturnValueOnce(new Promise((r) => { release = () => r(base); }));
    await userEvent.click(await screen.findByRole("switch", { name: /spam/i }));
    expect(screen.getByRole("switch", { name: /spam/i })).toBeDisabled();
    expect(screen.getByRole("switch", { name: /respond/i })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: /summary language/i })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole("switch", { name: /spam/i })).toBeEnabled());
  });

  it("does not enable the bot when the confirm is declined, and confirms with the last summary time", async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    setup([base]);
    await userEvent.click(await screen.findByRole("switch", { name: /respond/i }));
    expect(vi.mocked(confirm).mock.calls[0][0]).toMatchObject({ confirmText: "Enable bot" });
    expect(api.patchGroup).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("renders Hebrew names inside bdi and lets the text direction follow the content", async () => {
    setup([{ ...base, display_name: "קבוצת בדיקה", group_topic: "נושא" }]);
    const name = await screen.findByText("קבוצת בדיקה");
    expect(name.tagName).toBe("BDI");
    expect(name.parentElement).toHaveAttribute("dir", "auto");
    expect(screen.getByText("נושא").tagName).toBe("BDI");
    expect(screen.getByText("1@g.us").tagName).toBe("BDI");
  });

  it("shows loading skeleton rows, then the table", async () => {
    let resolve!: (v: { items: Group[]; total: number }) => void;
    vi.mocked(api.listGroups).mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<Groups />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    resolve({ items: [base], total: 1 });
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows an empty state with an icon", async () => {
    setup([]);
    const msg = await screen.findByText("No groups match.");
    expect(msg.parentElement?.querySelector("svg")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a load failure inline and as a toast", async () => {
    vi.mocked(api.listGroups).mockRejectedValue(new Error("server down"));
    render(<Groups />);
    expect(await screen.findByRole("alert")).toHaveTextContent("server down");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("server down"));
  });
});

describe("Groups at phone width", () => {
  beforeEach(() => void mockViewport(390));

  it("renders cards instead of a table, with the same accessible names and no duplicates", async () => {
    setup([{ ...base, display_name: "My alias" }]);
    const list = await screen.findByRole("list", { name: "Groups" });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getAllByRole("switch", { name: /respond in 1@g\.us/i })).toHaveLength(1);
    expect(screen.getAllByRole("combobox", { name: "Summary language for My alias" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Schedules for My alias" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Edit 1@g.us" })).toHaveLength(1);
    for (const label of ["Respond", "Spam notice", "Summary language", "Community keys", "Messages", "Last summary"]) {
      expect(within(list).getByText(label)).toBeInTheDocument();
    }
    expect(list).toHaveTextContent("fam");
  });

  it("labels the schedule count visibly on the card", async () => {
    setup([base]);
    const li = (await screen.findAllByRole("listitem"))[0];
    const label = within(li).getByText("Schedules", { selector: "dt" });
    expect(label.nextElementSibling).toHaveTextContent("2");
    expect(within(li).getByRole("button", { name: "Schedules for WA name" })).toBeInTheDocument();
  });

  it("keeps list semantics (role=list) on the card list", async () => {
    setup([base]);
    expect(await screen.findByRole("list", { name: "Groups" })).toHaveAttribute("role", "list");
  });

  it("keeps the behaviour: confirm then PATCH, language revert on failure", async () => {
    setup([base]);
    await userEvent.click(await screen.findByRole("switch", { name: /respond/i }));
    await waitFor(() => expect(api.patchGroup).toHaveBeenCalledWith("1@g.us", { managed: true }));
    vi.mocked(api.patchGroup).mockRejectedValueOnce(new Error("boom"));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /summary language/i }), "ru");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("boom"));
    await waitFor(() => expect(screen.getByRole("combobox", { name: /summary language/i })).toHaveValue(""));
  });

  it("gives touch controls a 44px target and the actions full-width buttons", async () => {
    setup([base]);
    const li = (await screen.findAllByRole("listitem"))[0];
    expect(within(li).getByRole("combobox")).toHaveClass("min-h-11");
    expect(within(li).getByRole("button", { name: /^Edit/ })).toHaveClass("min-h-11");
    expect(within(li).getByRole("button", { name: /^Schedules for/ })).toHaveClass("min-h-11");
    expect(within(li).getByRole("switch", { name: /respond/i }).className).toContain("after:-inset-2.5");
    expect(screen.getByRole("button", { name: "Next" })).toHaveClass("min-h-11");
    for (const n of ["All", "Enabled", "Disabled"]) {
      expect(screen.getByRole("button", { name: n })).toHaveClass("min-h-11");
    }
  });

  it("shows the empty state, not the card list, when nothing matches", async () => {
    setup([]);
    expect(await screen.findByText("No groups match.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Groups" })).not.toBeInTheDocument();
  });

  it("renders Hebrew names inside bdi on cards", async () => {
    setup([{ ...base, display_name: "קבוצה" }]);
    expect((await screen.findByText("קבוצה")).tagName).toBe("BDI");
  });
});

describe("Groups across a viewport resize", () => {
  const controls = () => ({
    respond: screen.getAllByRole("switch", { name: /respond in 1@g\.us/i }),
    lang: screen.getAllByRole("combobox", { name: /summary language/i }),
    edit: screen.getAllByRole("button", { name: "Edit 1@g.us" }),
  });

  it("swaps table and cards without duplicating controls or losing state", async () => {
    const vp = mockViewport(1024);
    const many = Array.from({ length: 50 }, (_, i) => ({ ...base, group_jid: i === 0 ? "1@g.us" : `${i + 100}@g.us` }));
    vi.mocked(api.listGroups).mockResolvedValue({ items: many, total: 120 });
    render(<Groups />);
    await screen.findByRole("table");
    await userEvent.type(screen.getByRole("textbox", { name: "Search groups" }), "draft");
    await userEvent.click(screen.getByRole("button", { name: "Disabled" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.listGroups).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50, managed: false })));

    vp.setWidth(600);
    expect(await screen.findByRole("list", { name: "Groups" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(controls().respond).toHaveLength(1);
    expect(controls().edit).toHaveLength(1);
    expect(controls().lang).toHaveLength(50);
    expect(screen.getByRole("textbox", { name: "Search groups" })).toHaveValue("draft");
    expect(screen.getByRole("button", { name: "Disabled" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();

    vp.setWidth(1024);
    expect(await screen.findByRole("table", { name: "Groups" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Groups" })).not.toBeInTheDocument();
    expect(controls().respond).toHaveLength(1);
    expect(controls().edit).toHaveLength(1);
    expect(controls().lang).toHaveLength(50);
    expect(screen.getByRole("textbox", { name: "Search groups" })).toHaveValue("draft");
    expect(screen.getByRole("button", { name: "Disabled" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
  });

  it("keeps a pending save in its saving state across a resize", async () => {
    const vp = mockViewport(1024);
    setup([base]);
    let release!: () => void;
    vi.mocked(api.patchGroup).mockReturnValueOnce(new Promise((r) => { release = () => r(base); }));
    await userEvent.click(await screen.findByRole("switch", { name: /spam/i }));
    expect(screen.getByRole("switch", { name: /spam/i })).toBeDisabled();
    vp.setWidth(600);
    expect(await screen.findByRole("list", { name: "Groups" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /spam/i })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: /summary language/i })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(screen.getByRole("switch", { name: /spam/i })).toBeEnabled());
  });
});
