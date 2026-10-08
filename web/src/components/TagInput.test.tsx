import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import TagInput from "./TagInput";

function Harness({ initial = [], spy }: { initial?: string[]; spy?: (t: string[]) => void }) {
  const [tags, setTags] = useState(initial);
  return (
    <TagInput
      value={tags}
      onChange={(t) => {
        setTags(t);
        spy?.(t);
      }}
      label="Keys"
    />
  );
}

describe("TagInput", () => {
  it("adds trimmed tags on Enter and comma, ignoring blanks and duplicates", async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    const input = screen.getByLabelText("Keys");
    await userEvent.type(input, "alpha{Enter}");
    await userEvent.type(input, "  beta ,");
    await userEvent.type(input, "alpha{Enter}");
    await userEvent.type(input, "   {Enter}");
    expect(spy).toHaveBeenLastCalledWith(["alpha", "beta"]);
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("removes a tag with its button and with Backspace on empty input", async () => {
    const spy = vi.fn();
    render(<Harness initial={["a", "b", "c"]} spy={spy} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove b" }));
    expect(spy).toHaveBeenLastCalledWith(["a", "c"]);
    await userEvent.type(screen.getByLabelText("Keys"), "{Backspace}");
    expect(spy).toHaveBeenLastCalledWith(["a"]);
  });

  it("commits pending text on blur", async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await userEvent.type(screen.getByLabelText("Keys"), "pending");
    await userEvent.tab();
    expect(spy).toHaveBeenLastCalledWith(["pending"]);
  });

  it("splits pasted comma-separated text into trimmed, de-duplicated tags", async () => {
    const spy = vi.fn();
    render(<Harness initial={["x"]} spy={spy} />);
    await userEvent.click(screen.getByLabelText("Keys"));
    await userEvent.paste("a, b ,,x, a");
    expect(spy).toHaveBeenLastCalledWith(["x", "a", "b"]);
    expect(screen.getByLabelText("Keys")).toHaveValue("");
  });

  it("does not add anything when a pasted list only has duplicates", async () => {
    const spy = vi.fn();
    render(<Harness initial={["a"]} spy={spy} />);
    await userEvent.click(screen.getByLabelText("Keys"));
    await userEvent.paste("a,a");
    expect(spy).not.toHaveBeenCalled();
  });
});
