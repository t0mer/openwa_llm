import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HBarList } from "./HBarList";

const fills = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("[data-fill]")].map((f) => f.style.width);

describe("HBarList", () => {
  it("lists items in order with bars sized against the largest value and visible counts", () => {
    const { container } = render(
      <HBarList
        items={[
          { key: "a", label: "Alpha", value: 200 },
          { key: "b", label: "Beta", value: 50 },
          { key: "c", label: "Gamma", value: 0 },
        ]}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => within(r).getByText(/Alpha|Beta|Gamma/).textContent)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(within(rows[0]!).getByText("200")).toHaveClass("tabular");
    expect(within(rows[2]!).getByText("0")).toBeInTheDocument();
    expect(fills(container)).toEqual(["100%", "25%", "0%"]);
  });

  it("formats large counts with the locale", () => {
    render(<HBarList items={[{ key: "a", label: "Alpha", value: 12345 }]} />);
    expect(screen.getByText((12345).toLocaleString())).toBeInTheDocument();
  });

  it("isolates long Hebrew names and truncates them with the full name as a title", () => {
    const name = "קבוצת הוועד המנהל של הבניין ברחוב הרצל 42 – עדכונים שוטפים ודיונים ארוכים מאוד";
    render(<HBarList items={[{ key: "g1@g.us", label: name, value: 7 }]} />);
    const bdi = screen.getByText(name);
    expect(bdi.tagName).toBe("BDI");
    expect(bdi).toHaveAttribute("dir", "auto");
    expect(bdi).toHaveAttribute("title", name);
    expect(bdi).toHaveClass("truncate");
  });

  it("renders names as text, never as HTML", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const { container } = render(<HBarList items={[{ key: "x", label: evil, value: 1 }]} />);
    expect(screen.getByText(evil)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("handles all-zero values and an empty list", () => {
    const { container, unmount } = render(
      <HBarList
        items={[
          { key: "a", label: "A", value: 0 },
          { key: "b", label: "B", value: 0 },
        ]}
      />,
    );
    expect(fills(container)).toEqual(["0%", "0%"]);
    unmount();
    render(<HBarList items={[]} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("treats negative and non-finite values as 0 in the bar and the count", () => {
    const { container } = render(
      <HBarList
        items={[
          { key: "a", label: "A", value: -3 },
          { key: "b", label: "B", value: Number.NaN },
          { key: "c", label: "C", value: Number.POSITIVE_INFINITY },
          { key: "d", label: "D", value: 10 },
        ]}
      />,
    );
    expect(fills(container)).toEqual(["0%", "0%", "0%", "100%"]);
    expect(screen.getAllByRole("listitem").map((r) => r.querySelector(".tabular")!.textContent)).toEqual(["0", "0", "0", "10"]);
  });
});
