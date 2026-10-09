import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Contacts from "./Contacts";
import Messages from "./Messages";
import OptOuts from "./OptOuts";
import { api } from "../api";

vi.mock("../alerts");
vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { listGroups: vi.fn(), listContacts: vi.fn(), listOptOuts: vi.fn(), listMessages: vi.fn() } };
});

const group = { group_jid: "1@g.us", group_name: "A", display_name: null, group_topic: "t", owner_jid: null, managed: true, notify_on_spam: false, summary_language: null, community_keys: ["k"], last_summary_sync: "2026-01-01T00:00:00", last_ingest: "2026-01-01T00:00:00", message_count: 1, schedule_count: 2 };

beforeEach(() => {
  vi.mocked(api.listGroups).mockResolvedValue({ items: [group], total: 1 });
  vi.mocked(api.listContacts).mockResolvedValue({ items: [{ jid: "1@s", push_name: "D", opted_out: true }], total: 1 });
  vi.mocked(api.listOptOuts).mockResolvedValue([{ jid: "1@s", push_name: "D", created_at: "2026-01-01T00:00:00Z" }]);
  vi.mocked(api.listMessages).mockResolvedValue({
    items: [{ message_id: "m", timestamp: "2026-01-01T00:00:00Z", text: "hi", sender_jid: "1@s", sender_name: "D", group_jid: "1@g.us", chat_jid: "1@g.us", reply_to_id: "x", reaction_count: 1, has_media: true }],
    next_cursor: null,
  });
});

describe("responsive tables", () => {
  it.each([["Contacts", Contacts], ["OptOuts", OptOuts], ["Messages", Messages]] as const)(
    "%s: every labelled cell has exactly one value wrapper",
    async (_n, Page) => {
      render(<Page />);
      await screen.findByRole("table");
      await screen.findAllByRole("cell");
      const cells = document.querySelectorAll("table.responsive tbody td[data-label]");
      expect(cells.length).toBeGreaterThan(0);
      for (const td of cells) {
        expect(td.children).toHaveLength(1);
        expect(td.children[0]).toHaveClass("cell-value");
      }
    },
  );
});
