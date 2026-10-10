import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Donut, RING_CIRCUMFERENCE } from "./Donut";

const arcLengths = (c: HTMLElement) =>
  [...c.querySelectorAll("circle[data-arc]")].map((a) => Number(a.getAttribute("stroke-dasharray")!.split(" ")[0]));

const SEGMENTS = [
  { label: "Text", value: 75, color: "var(--chart-1)" },
  { label: "Media", value: 20, color: "var(--chart-2)" },
  { label: "Other", value: 5, color: "var(--chart-3)" },
];

describe("Donut", () => {
  it("splits the ring by value: arcs add up to the whole ring", () => {
    const { container } = render(<Donut segments={SEGMENTS} />);
    const lens = arcLengths(container);
    expect(lens).toHaveLength(3);
    expect(lens.reduce((a, b) => a + b, 0)).toBeCloseTo(RING_CIRCUMFERENCE, 6);
    expect(lens[0]! / RING_CIRCUMFERENCE).toBeCloseTo(0.75, 6);
    expect(lens[2]! / RING_CIRCUMFERENCE).toBeCloseTo(0.05, 6);
  });

  it("shows the total and a legend with each count and percentage", () => {
    render(<Donut segments={SEGMENTS} />);
    expect(screen.getByTestId("donut-total")).toHaveTextContent("100");
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["Text7575%", "Media2020%", "Other55%"]);
    expect(within(rows[0]!).getByText("75%")).toHaveClass("tabular");
  });

  it("shows <1% for a tiny non-zero share and skips zero segments in the ring", () => {
    const { container } = render(
      <Donut
        segments={[
          { label: "Text", value: 999, color: "var(--chart-1)" },
          { label: "Media", value: 1, color: "var(--chart-2)" },
          { label: "Other", value: 0, color: "var(--chart-3)" },
        ]}
      />,
    );
    expect(arcLengths(container)).toHaveLength(2);
    expect(screen.getByText("<1%")).toBeInTheDocument();
    expect(screen.getByText((1000).toLocaleString())).toBeInTheDocument();
  });

  it("shows an empty ring with No data when every value is zero", () => {
    const { container } = render(
      <Donut
        segments={[
          { label: "Text", value: 0, color: "var(--chart-1)" },
          { label: "Media", value: 0, color: "var(--chart-2)" },
        ]}
      />,
    );
    expect(arcLengths(container)).toEqual([]);
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.getAllByText("0%")).toHaveLength(2);
  });

  it("renders labels as text, never as HTML, isolated for RTL", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const { container } = render(<Donut segments={[{ label: evil, value: 1, color: "var(--chart-1)" }]} />);
    const label = screen.getByText(evil);
    expect(label.tagName).toBe("BDI");
    expect(label).toHaveAttribute("dir", "auto");
    expect(container.querySelector("img")).toBeNull();
  });
});
