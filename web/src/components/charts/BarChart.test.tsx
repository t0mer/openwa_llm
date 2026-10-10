import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BarChart, niceMax, type Bar } from "./BarChart";
import { ChartCard } from "./ChartCard";

function setWidth(w: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => w);
}

afterEach(() => vi.restoreAllMocks());

const bars = (values: number[], label = (i: number) => `D${i}`): Bar[] =>
  values.map((value, i) => ({ label: label(i), value, title: `${label(i)}: ${value} messages` }));

const heights = (c: HTMLElement) => [...c.querySelectorAll("rect[data-bar]")].map((r) => Number(r.getAttribute("height")));
const xLabels = (c: HTMLElement) => [...c.querySelectorAll("text[data-xlabel]")].map((t) => t.textContent);
const yTicks = (c: HTMLElement) => [...c.querySelectorAll("text[data-ytick]")].map((t) => t.textContent);

describe("niceMax", () => {
  it.each([
    [0, 4],
    [1, 4],
    [4, 4],
    [5, 8],
    [9, 10],
    [11, 20],
    [21, 40],
    [42, 50],
    [51, 100],
    [101, 200],
    [450, 500],
    [1234, 2000],
    [4001, 5000],
    [60000, 100000],
  ])("niceMax(%i) = %i", (n, expected) => {
    expect(niceMax(n)).toBe(expected);
  });

  it("falls back to 4 for values that are not finite", () => {
    expect(niceMax(Number.NaN)).toBe(4);
    expect(niceMax(Number.POSITIVE_INFINITY)).toBe(4);
  });

  it("is never below the input and always splits into whole halves", () => {
    for (let n = 0; n < 20000; n += 7) {
      const m = niceMax(n);
      expect(m).toBeGreaterThanOrEqual(n);
      expect(Number.isInteger(m / 2)).toBe(true);
    }
  });
});

describe("BarChart", () => {
  it("draws bars proportional to their values against a niceMax axis with gridlines", () => {
    setWidth(640);
    const { container } = render(<BarChart data={bars([10, 20, 40])} />);
    const h = heights(container);
    expect(h).toHaveLength(3);
    // max 40 -> axis 40, plot height 160
    expect(h).toEqual([40, 80, 160]);
    expect(yTicks(container)).toEqual(["0", "20", "40"]);
    expect(container.querySelectorAll("line[data-grid]")).toHaveLength(3);
  });

  it("gives every bar, including zero ones, a focusable element with its title as aria-label", () => {
    setWidth(640);
    const data = bars([3, 0, 5]);
    const { container } = render(<BarChart data={data} />);
    const focusables = [...container.querySelectorAll("[data-bar-hit]")];
    expect(focusables.map((f) => f.getAttribute("aria-label"))).toEqual(data.map((d) => d.title));
    // One tab stop for the whole chart; arrows move between bars.
    expect(focusables.map((f) => f.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
  });

  it("shows the tooltip on focus and moves it with the arrow keys", async () => {
    setWidth(640);
    const user = userEvent.setup();
    const { container } = render(<BarChart data={bars([3, 0, 5])} />);
    expect(screen.queryByText("D0: 3 messages")).not.toBeInTheDocument();
    await user.tab();
    const first = container.querySelector("[data-bar-hit]");
    expect(first).toHaveFocus();
    expect(screen.getByText("D0: 3 messages")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("D1: 0 messages")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-bar-hit]")[1]).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByText("D2: 5 messages")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("D2: 5 messages")).toBeInTheDocument();
    await user.keyboard("{Home}");
    expect(screen.getByText("D0: 3 messages")).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByText("D0: 3 messages")).not.toBeInTheDocument();
  });

  it("shows the tooltip on hover", () => {
    setWidth(640);
    const { container } = render(<BarChart data={bars([3, 7])} />);
    fireEvent.mouseEnter(container.querySelectorAll("[data-bar-hit]")[1]);
    expect(screen.getByText("D1: 7 messages")).toBeInTheDocument();
    fireEvent.mouseLeave(container.querySelectorAll("[data-bar-hit]")[1]);
    expect(screen.queryByText("D1: 7 messages")).not.toBeInTheDocument();
  });

  it("labels every bar when wide and thins the labels out when narrow", () => {
    const data = bars(Array(30).fill(1), (i) => `Oct ${i + 1}`);
    setWidth(1920);
    const wide = render(<BarChart data={data} />);
    expect(xLabels(wide.container)).toHaveLength(30);
    wide.unmount();

    setWidth(320);
    const { container } = render(<BarChart data={data} />);
    const shown = xLabels(container);
    expect(shown.length).toBeGreaterThan(1);
    expect(shown.length).toBeLessThan(10);
    expect(shown[0]).toBe("Oct 1");
    const every = shown.length > 1 ? Number(shown[1]!.split(" ")[1]) - 1 : 0;
    expect(shown).toEqual(data.filter((_, i) => i % every === 0).map((d) => d.label));
    // But every bar keeps its own aria-label.
    expect(container.querySelectorAll("[data-bar-hit][aria-label]")).toHaveLength(30);
  });

  it("uses xLabelEvery as the minimum label step", () => {
    setWidth(1280);
    const data = bars(Array(24).fill(2), (i) => String(i).padStart(2, "0"));
    const { container } = render(<BarChart data={data} xLabelEvery={3} />);
    expect(xLabels(container)).toEqual(["00", "03", "06", "09", "12", "15", "18", "21"]);
  });

  it("fits a 320px width without bars spilling past it", () => {
    setWidth(320);
    const { container } = render(<BarChart data={bars(Array(90).fill(5))} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("320");
    for (const r of container.querySelectorAll("rect[data-bar]")) {
      const x = Number(r.getAttribute("x"));
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + Number(r.getAttribute("width"))).toBeLessThanOrEqual(320);
    }
  });

  it("draws a flat baseline with no bars when every value is zero, or there is no data", () => {
    setWidth(640);
    const zero = render(<BarChart data={bars([0, 0, 0])} />);
    expect(heights(zero.container)).toEqual([]);
    expect(zero.container.querySelector("line[data-baseline]")).not.toBeNull();
    expect(yTicks(zero.container)).toEqual(["0", "2", "4"]);
    zero.unmount();
    const empty = render(<BarChart data={[]} />);
    expect(empty.container.querySelector("line[data-baseline]")).not.toBeNull();
    expect(empty.container.querySelectorAll("[data-bar-hit]")).toHaveLength(0);
  });

  it("uses the given colour, defaulting to the first chart token", () => {
    setWidth(640);
    const a = render(<BarChart data={bars([1])} />);
    expect(a.container.querySelector("rect[data-bar]")).toHaveAttribute("fill", "var(--chart-1)");
    a.unmount();
    const b = render(<BarChart data={bars([1])} color="var(--chart-3)" />);
    expect(b.container.querySelector("rect[data-bar]")).toHaveAttribute("fill", "var(--chart-3)");
  });

  it("renders labels and titles as text, never as HTML", async () => {
    setWidth(640);
    const user = userEvent.setup();
    const evil = '<img src=x onerror="alert(1)">';
    const { container } = render(<BarChart data={[{ label: evil, value: 1, title: evil }]} />);
    await user.tab();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByText(evil).length).toBeGreaterThan(0);
  });

  it("has a table view in ChartCard with the same numbers as the bars", async () => {
    setWidth(640);
    const user = userEvent.setup();
    const data = bars([12, 0, 1500]);
    const { container } = render(
      <ChartCard
        title="Messages"
        summary="Messages per day"
        table={{ columns: ["Day", "Messages"], rows: data.map((d) => [d.label, d.value]) }}
      >
        <BarChart data={data} />
      </ChartCard>,
    );
    const labels = [...container.querySelectorAll("[data-bar-hit]")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["D0: 12 messages", "D1: 0 messages", "D2: 1500 messages"]);
    await user.click(screen.getByRole("button", { name: "Show as table" }));
    const cells = screen.getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(data.map((d) => d.value.toLocaleString()));
  });

  it("keeps the focused bar's tooltip after the mouse leaves another bar", async () => {
    setWidth(640);
    const user = userEvent.setup();
    const { container } = render(<BarChart data={bars([3, 7, 9])} />);
    const hits = container.querySelectorAll("[data-bar-hit]");
    await user.tab();
    expect(screen.getByText("D0: 3 messages")).toBeInTheDocument();
    fireEvent.mouseEnter(hits[2]!);
    expect(screen.getByText("D2: 9 messages")).toBeInTheDocument();
    expect(screen.queryByText("D0: 3 messages")).not.toBeInTheDocument();
    fireEvent.mouseLeave(hits[2]!);
    expect(screen.getByText("D0: 3 messages")).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByText(/messages$/)).not.toBeInTheDocument();
  });

  it("draws negative and non-finite values as zero", () => {
    setWidth(640);
    const data = [
      { label: "a", value: -5, title: "a" },
      { label: "b", value: Number.NaN, title: "b" },
      { label: "c", value: Number.POSITIVE_INFINITY, title: "c" },
      { label: "d", value: 8, title: "d" },
    ];
    const { container } = render(<BarChart data={data} />);
    expect(heights(container)).toEqual([160]);
    expect(yTicks(container)).toEqual(["0", "4", "8"]);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(container.querySelectorAll("[data-bar-hit]")).toHaveLength(4);
  });

  it("links each bar's aria-label to the table cell at the same index", async () => {
    setWidth(640);
    const user = userEvent.setup();
    const data = bars([5, 0, 42, 7]);
    const { container } = render(
      <ChartCard title="M" summary="S" table={{ columns: ["Day", "Messages"], rows: data.map((d) => [d.label, d.value]) }}>
        <BarChart data={data} />
      </ChartCard>,
    );
    const fromLabels = [...container.querySelectorAll("[data-bar-hit]")].map((b) => {
      const [day, rest] = b.getAttribute("aria-label")!.split(": ");
      return [day, rest!.split(" ")[0]];
    });
    await user.click(screen.getByRole("button", { name: "Show as table" }));
    const fromTable = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => [r.querySelector("th")!.textContent, r.querySelector("td")!.textContent]);
    expect(fromTable).toEqual(fromLabels);
  });
});
