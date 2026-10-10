import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BarChart } from "./BarChart";
import { ChartCard } from "./ChartCard";
import { Donut } from "./Donut";
import { useWidth } from "./useWidth";

type Callback = () => void;

/** A ResizeObserver whose callbacks the test fires by hand. */
function mockResizeObserver() {
  const callbacks = new Set<Callback>();
  const disconnect = vi.fn();
  class RO {
    cb: Callback;
    constructor(cb: Callback) {
      this.cb = cb;
      callbacks.add(cb);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      callbacks.delete(this.cb);
      disconnect();
    }
  }
  vi.stubGlobal("ResizeObserver", RO);
  return { fire: () => callbacks.forEach((cb) => cb()), count: () => callbacks.size, disconnect };
}

function mockClientWidth(initial: number) {
  let width = initial;
  const spy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  return { set: (w: number) => (width = w), spy };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Probe({ fallback }: { fallback?: number }) {
  const [ref, width] = useWidth(fallback);
  return (
    <div ref={ref} data-testid="probe">
      {width}
    </div>
  );
}

describe("useWidth", () => {
  it("reads the element width and follows resizes", () => {
    const ro = mockResizeObserver();
    const cw = mockClientWidth(320);
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("320");
    cw.set(900);
    act(() => ro.fire());
    expect(screen.getByTestId("probe")).toHaveTextContent("900");
  });

  it("keeps the fallback while the element has no layout width (0)", () => {
    mockResizeObserver();
    mockClientWidth(0);
    render(<Probe fallback={500} />);
    expect(screen.getByTestId("probe")).toHaveTextContent("500");
  });

  it("disconnects the observer on unmount", () => {
    const ro = mockResizeObserver();
    mockClientWidth(300);
    const { unmount } = render(<Probe />);
    expect(ro.count()).toBe(1);
    unmount();
    expect(ro.disconnect).toHaveBeenCalled();
    expect(ro.count()).toBe(0);
  });
});

const TABLE = {
  columns: ["Day", "Messages"],
  rows: [
    ["Mon 13 Oct", 1234],
    ["Tue 14 Oct", 0],
  ] as (string | number)[][],
};

describe("ChartCard", () => {
  it("shows a titled card with the chart as one labelled group", () => {
    render(
      <ChartCard title="Messages over time" description="Per day" summary="1,234 messages over 2 days" table={TABLE}>
        <svg data-testid="chart" />
      </ChartCard>,
    );
    expect(screen.getByRole("heading", { name: "Messages over time" })).toBeInTheDocument();
    expect(screen.getByText("Per day")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "1,234 messages over 2 days" });
    expect(within(group).getByTestId("chart")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "1,234 messages over 2 days" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("toggles to an accessible table with the same numbers and back", async () => {
    const user = userEvent.setup();
    render(
      <ChartCard title="Messages over time" summary="1,234 messages over 2 days" table={TABLE}>
        <svg data-testid="chart" />
      </ChartCard>,
    );
    const toggle = screen.getByRole("button", { name: "Show as table" });
    expect(toggle).not.toHaveAttribute("aria-pressed");

    await user.click(toggle);
    expect(toggle).toHaveAccessibleName("Show chart");
    expect(toggle).not.toHaveAttribute("aria-pressed");
    expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: "1,234 messages over 2 days" });
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Day", "Messages"]);
    expect(within(table).getByRole("rowheader", { name: "Mon 13 Oct" })).toBeInTheDocument();
    const cells = within(table).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual([(1234).toLocaleString(), "0"]);

    await user.click(toggle);
    expect(toggle).toHaveAccessibleName("Show as table");
    expect(screen.getByTestId("chart")).toBeInTheDocument();
  });

  it("renders names in the table as text, never as HTML", async () => {
    const user = userEvent.setup();
    const evil = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <ChartCard title="Top groups" summary="Top groups" table={{ columns: ["Group", "Messages"], rows: [[evil, 3]] }}>
        <div />
      </ChartCard>,
    );
    await user.click(screen.getByRole("button", { name: "Show as table" }));
    expect(screen.getByText(evil)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps bars and legend items reachable by assistive tech inside the card", () => {
    render(
      <ChartCard title="Mixed" summary="Mixed charts" table={TABLE}>
        <BarChart data={[{ label: "Mon", value: 4, title: "Mon: 4 messages" }]} />
        <Donut segments={[{ label: "Text", value: 3, color: "var(--chart-1)" }]} />
      </ChartCard>,
    );
    const group = screen.getByRole("group", { name: "Mixed charts" });
    expect(within(group).getByRole("img", { name: "Mon: 4 messages" })).toBeInTheDocument();
    expect(within(group).getByRole("listitem")).toHaveTextContent("Text");
  });

  it("shows negative or non-finite numbers in the table as 0", async () => {
    const user = userEvent.setup();
    render(
      <ChartCard
        title="T"
        summary="S"
        table={{ columns: ["Day", "A", "B", "C"], rows: [["Mon", -3, Number.NaN, Number.POSITIVE_INFINITY]] }}
      >
        <div />
      </ChartCard>,
    );
    await user.click(screen.getByRole("button", { name: "Show as table" }));
    expect(screen.getAllByRole("cell").map((c) => c.textContent)).toEqual(["0", "0", "0"]);
  });
});
