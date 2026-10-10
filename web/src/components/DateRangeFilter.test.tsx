import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { DateRangeFilter, useRangeParams } from "./DateRangeFilter";
import type { CustomRange, RangeKey } from "../lib/dateRange";

const PRESETS = ["24 hours", "7 days", "30 days", "90 days", "All time"];

function renderFilter(key: RangeKey = "7d", custom?: CustomRange) {
  const onChange = vi.fn();
  render(<DateRangeFilter rangeKey={key} custom={custom} onChange={onChange} />);
  return onChange;
}

describe("DateRangeFilter", () => {
  it("offers the presets and Custom in a labelled group, marking the current one", () => {
    renderFilter("30d");
    const group = screen.getByRole("group", { name: "Date range" });
    const chips = within(group).getAllByRole("button").map((b) => b.textContent);
    expect(chips).toEqual([...PRESETS, "Custom"]);
    expect(screen.getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
  });

  it("reports a preset click", async () => {
    const onChange = renderFilter();
    await userEvent.click(screen.getByRole("button", { name: "All time" }));
    expect(onChange).toHaveBeenCalledWith("all", undefined);
    await userEvent.click(screen.getByRole("button", { name: "24 hours" }));
    expect(onChange).toHaveBeenLastCalledWith("24h", undefined);
  });

  it("opens labelled From/To inputs and applies a valid custom range", async () => {
    const onChange = renderFilter();
    const chip = screen.getByRole("button", { name: "Custom" });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("From"), "2026-10-01");
    await userEvent.type(screen.getByLabelText("To"), "2026-10-05");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith("custom", { from: "2026-10-01", to: "2026-10-05" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("accepts a single-day range (from equals to)", async () => {
    const onChange = renderFilter();
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    await userEvent.type(screen.getByLabelText("From"), "2026-10-05");
    await userEvent.type(screen.getByLabelText("To"), "2026-10-05");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith("custom", { from: "2026-10-05", to: "2026-10-05" });
  });

  it("shows an inline error and does not apply a reversed range", async () => {
    const onChange = renderFilter();
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    await userEvent.type(screen.getByLabelText("From"), "2026-10-05");
    await userEvent.type(screen.getByLabelText("To"), "2026-10-01");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The start date must not be after the end date.");
    expect(screen.getByLabelText("From")).toHaveAttribute("aria-invalid", "true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows an inline error and does not apply an empty or partial range", async () => {
    const onChange = renderFilter();
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid start and end date.");
    await userEvent.type(screen.getByLabelText("From"), "2026-10-05");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid start and end date.");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears the error once a valid range is applied", async () => {
    renderFilter();
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("From"), "2026-10-01");
    await userEvent.type(screen.getByLabelText("To"), "2026-10-02");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the applied custom range in the inputs", () => {
    renderFilter("custom", { from: "2026-09-01", to: "2026-09-30" });
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("From")).toHaveValue("2026-09-01");
    expect(screen.getByLabelText("To")).toHaveValue("2026-09-30");
  });

  it("says the custom dates are browser-local, linked to both inputs", async () => {
    renderFilter();
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByText("Dates are in your browser's local time.")).toBeInTheDocument();
    expect(screen.getByLabelText("From")).toHaveAccessibleDescription("Dates are in your browser's local time.");
    expect(screen.getByLabelText("To")).toHaveAccessibleDescription("Dates are in your browser's local time.");
  });

  it("keeps the local-time hint in the description next to an error", async () => {
    renderFilter();
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByLabelText("From")).toHaveAccessibleDescription(
      "Dates are in your browser's local time. Enter a valid start and end date.",
    );
  });

  it("follows a range changed from outside: closes the panel and resets the draft", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DateRangeFilter rangeKey="custom" custom={{ from: "2026-09-01", to: "2026-09-30" }} onChange={onChange} />,
    );
    await userEvent.clear(screen.getByLabelText("From"));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    rerender(<DateRangeFilter rangeKey="7d" onChange={onChange} />);
    expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    rerender(<DateRangeFilter rangeKey="custom" custom={{ from: "2026-08-01", to: "2026-08-02" }} onChange={onChange} />);
    expect(screen.getByLabelText("From")).toHaveValue("2026-08-01");
    expect(screen.getByLabelText("To")).toHaveValue("2026-08-02");
  });

  it("keeps an open draft when the parent re-renders with the same range", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<DateRangeFilter rangeKey="7d" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    await userEvent.type(screen.getByLabelText("From"), "2026-10-01");
    rerender(<DateRangeFilter rangeKey="7d" onChange={onChange} />);
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-01");
  });

  it("closes the custom inputs when a preset is picked", async () => {
    renderFilter();
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByLabelText("From")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "90 days" }));
    expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
  });
});

function Probe() {
  const [range, setRange] = useRangeParams();
  const loc = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => void navigate(-1)}>Back</button>
      <Link to="/">Home</Link>
      <output data-testid="path">{loc.pathname}</output>
      <output data-testid="range">{JSON.stringify(range)}</output>
      <output data-testid="search">{loc.search}</output>
      <DateRangeFilter rangeKey={range.key} custom={range.custom} onChange={setRange} />
    </>
  );
}

function renderAt(url: string) {
  // Two entries so a replace can be told apart from a push by the history index.
  render(
    <MemoryRouter initialEntries={["/elsewhere", url]} initialIndex={1}>
      <Probe />
    </MemoryRouter>,
  );
}

describe("useRangeParams", () => {
  it("defaults to 7 days without parameters", () => {
    renderAt("/");
    expect(screen.getByTestId("range")).toHaveTextContent('{"key":"7d"}');
  });

  it("restores a preset and a custom range from the URL", () => {
    renderAt("/?range=custom&from=2026-09-01&to=2026-09-30");
    expect(JSON.parse(screen.getByTestId("range").textContent!)).toEqual({
      key: "custom",
      custom: { from: "2026-09-01", to: "2026-09-30" },
    });
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "true");
  });

  it("falls back to 7 days for an invalid URL", () => {
    renderAt("/?range=custom&from=2026-09-30&to=2026-09-01");
    expect(screen.getByTestId("range")).toHaveTextContent('{"key":"7d"}');
  });

  it("closes the custom panel when a link drops the range from the URL", async () => {
    renderAt("/?range=custom&from=2026-09-01&to=2026-09-30");
    expect(screen.getByLabelText("From")).toHaveValue("2026-09-01");
    await userEvent.click(screen.getByRole("link", { name: "Home" }));
    expect(screen.getByTestId("range")).toHaveTextContent('{"key":"7d"}');
    expect(screen.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("From")).not.toBeInTheDocument();
  });

  it("writes the choice to the URL, replacing the entry", async () => {
    renderAt("/?range=7d");
    await userEvent.click(screen.getByRole("button", { name: "90 days" }));
    expect(screen.getByTestId("search")).toHaveTextContent("?range=90d");
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    await userEvent.type(screen.getByLabelText("From"), "2026-10-01");
    await userEvent.type(screen.getByLabelText("To"), "2026-10-03");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByTestId("search")).toHaveTextContent("?range=custom&from=2026-10-01&to=2026-10-03");
    // Both changes replaced the entry, so Back leaves the dashboard instead of stepping through ranges.
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("path")).toHaveTextContent("/elsewhere");
  });
});
