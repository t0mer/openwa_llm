import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Users } from "lucide-react";
import { cn } from "../../lib/cn";
import { Badge } from "./badge";
import { Button } from "./button";
import { buttonVariants } from "./button-variants";
import { Dialog, DialogContent, DialogTrigger } from "./dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown";
import { EmptyState } from "./empty-state";
import { Field, Input, Select, Textarea } from "./field";
import { FilterChip } from "./filter-chip";
import { InlineError } from "./inline-error";
import { PageHeader } from "./page-header";
import { Section } from "./section";
import { Skeleton } from "./skeleton";
import { Switch } from "./switch";

describe("cn", () => {
  it("lets later utilities win and drops falsy values", () => {
    expect(cn("px-4 py-2", false && "x", "px-3")).toBe("py-2 px-3");
  });
});

describe("Button", () => {
  it("defaults to the outline variant, default size and type=button", () => {
    render(<Button>Go</Button>);
    const b = screen.getByRole("button", { name: "Go" });
    expect(b).toHaveAttribute("type", "button");
    for (const c of ["border", "border-border-strong", "bg-surface", "min-h-10", "px-4", "rounded-md", "text-sm", "font-medium"])
      expect(b).toHaveClass(c);
  });

  it.each([
    ["primary", ["bg-primary", "text-primary-foreground"]],
    ["secondary", ["bg-surface-2", "text-foreground"]],
    ["outline", ["border-border-strong", "bg-surface"]],
    ["ghost", ["text-foreground", "hover:bg-surface-2"]],
    ["danger", ["bg-danger", "text-primary-foreground"]],
    ["danger-outline", ["border-danger/50", "text-danger"]],
    ["link", ["text-primary", "hover:underline"]],
  ] as const)("renders the %s variant", (variant, classes) => {
    render(<Button variant={variant}>x</Button>);
    for (const c of classes) expect(screen.getByRole("button")).toHaveClass(c);
  });

  it.each([
    ["default", "min-h-10"],
    ["sm", "min-h-9"],
    ["lg", "min-h-11"],
    ["icon", "size-10"],
  ] as const)("renders the %s size", (size, cls) => {
    expect(buttonVariants({ size })).toContain(cls);
  });

  it("asChild renders the child element (a link) with button styling and no type", () => {
    render(
      <Button asChild variant="primary">
        <a href="/x">Link</a>
      </Button>,
    );
    const a = screen.getByRole("link", { name: "Link" });
    expect(a).toHaveClass("bg-primary");
    expect(a).not.toHaveAttribute("type");
  });

  it("does not fire when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        x
      </Button>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Badge", () => {
  it.each([
    ["neutral", ["bg-surface-2", "text-muted-foreground"]],
    ["info", ["bg-primary-soft", "text-primary"]],
    ["danger", ["bg-danger-soft", "text-danger"]],
    ["warning", ["bg-warning-soft", "text-warning"]],
    ["success", ["bg-success-soft", "text-success"]],
  ] as const)("renders the %s tone with word and optional icon", (tone, classes) => {
    render(
      <Badge tone={tone} icon={Users} data-testid="b">
        Word
      </Badge>,
    );
    const b = screen.getByTestId("b");
    expect(b).toHaveTextContent("Word");
    for (const c of ["rounded-sm", "px-2", "py-0.5", "text-xs", "font-medium", ...classes]) expect(b).toHaveClass(c);
    expect(b.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Field, Input, Select, Textarea", () => {
  it("labels the control with the label text only; the hint is a description, not part of the name", () => {
    render(
      <Field label="Name" hint="Shown to members">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Name");
    expect(input).toHaveClass("min-h-11", "w-full", "rounded-md", "border-border-strong", "bg-surface");
    expect(screen.getByRole("textbox", { name: "Name" })).toBe(input);
    expect(input).toHaveAccessibleDescription("Shown to members");
    expect(screen.getByText("Shown to members")).toHaveClass("text-xs", "text-muted-foreground");
  });
  it("a Select's option text does not leak into its accessible name", () => {
    render(
      <Field label="Language">
        <Select defaultValue="en">
          <option value="en">English</option>
          <option value="he">Hebrew</option>
        </Select>
      </Field>,
    );
    expect(screen.getByLabelText("Language")).toBe(screen.getByRole("combobox", { name: "Language" }));
  });
  it("two fields get distinct ids and keep a caller-supplied aria-describedby", () => {
    render(
      <>
        <Field label="A" hint="ha">
          <Input aria-describedby="extra" />
        </Field>
        <Field label="B">
          <Input />
        </Field>
      </>,
    );
    expect(screen.getByLabelText("A").id).not.toBe(screen.getByLabelText("B").id);
    expect(screen.getByLabelText("A").getAttribute("aria-describedby")).toMatch(/^extra .+-hint$/);
  });
  it("Select is a native select with a chevron at the end side", () => {
    const { container } = render(
      <Select aria-label="Lang" defaultValue="en">
        <option value="en">EN</option>
      </Select>,
    );
    const sel = screen.getByRole("combobox", { name: "Lang" });
    expect(sel.tagName).toBe("SELECT");
    expect(sel).toHaveClass("appearance-none", "pe-9");
    const chevron = container.querySelector("svg")!;
    expect(chevron).toHaveClass("end-3", "pointer-events-none");
  });
  it("Textarea keeps the control look", () => {
    render(<Textarea aria-label="Notes" />);
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveClass("min-h-24", "rounded-md");
  });
});

describe("Switch", () => {
  it("toggles by keyboard (Space) and click and exposes aria-checked", async () => {
    const onChange = vi.fn();
    function T() {
      const [on, setOn] = useState(false);
      return (
        <Switch
          aria-label="Respond"
          checked={on}
          onCheckedChange={(v) => {
            onChange(v);
            setOn(v);
          }}
        />
      );
    }
    render(<T />);
    const sw = screen.getByRole("switch", { name: "Respond" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    sw.focus();
    await userEvent.keyboard(" ");
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(sw).toHaveClass("data-[state=checked]:bg-primary", "h-6", "w-11", "rounded-full");
    await userEvent.click(sw);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });
  it("does not toggle when disabled", async () => {
    const onChange = vi.fn();
    render(<Switch aria-label="x" disabled onCheckedChange={onChange} />);
    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("Dialog", () => {
  function Harness({ wide = false }: { wide?: boolean }) {
    return (
      <Dialog>
        <DialogTrigger asChild>
          <button>Open</button>
        </DialogTrigger>
        <DialogContent title="Edit group" description="Change things" wide={wide}>
          <input aria-label="First" />
          <button>Save</button>
        </DialogContent>
      </Dialog>
    );
  }

  it("opens as a named dialog, traps focus, closes on Escape and returns focus to the opener", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await userEvent.click(opener);
    const dlg = await screen.findByRole("dialog", { name: "Edit group" });
    expect(dlg).toHaveAccessibleDescription("Change things");
    expect(dlg).toHaveClass("rounded-t-xl", "md:max-w-md", "shadow-overlay");
    // focus stays inside the dialog while tabbing around
    for (let i = 0; i < 6; i++) {
      await userEvent.tab();
      expect(dlg.contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("wide uses the wider max width and the close button closes", async () => {
    render(<Harness wide />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    const dlg = await screen.findByRole("dialog");
    expect(dlg).toHaveClass("md:max-w-3xl");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("can be kept open (Escape ignored) and closeDisabled disables Close", async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent title="Saving" closeDisabled onEscapeKeyDown={(e) => e.preventDefault()}>
          body
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("DropdownMenu", () => {
  it("opens with the keyboard, selects an item and closes", async () => {
    const onSelect = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button>Account</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Log out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    screen.getByRole("button", { name: "Account" }).focus();
    await userEvent.keyboard("{Enter}");
    const item = await screen.findByRole("menuitem", { name: "Log out" });
    expect(item).toHaveClass("min-h-10", "rounded-sm");
    await userEvent.click(item);
    expect(onSelect).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });
});

describe("small pieces", () => {
  it("Skeleton is hidden from assistive tech and pulses", () => {
    const { container } = render(<Skeleton className="h-4" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
    expect(container.firstChild).toHaveClass("animate-pulse", "rounded-md", "bg-surface-2", "h-4");
  });
  it("EmptyState shows the icon disc, title, text and action", () => {
    const { container } = render(
      <EmptyState icon={Users} title="No groups" action={<button>Sync</button>}>
        Nothing yet
      </EmptyState>,
    );
    expect(container.firstElementChild).toHaveClass("px-6", "py-12");
    expect(container.querySelector("span")).toHaveClass("size-12", "rounded-full", "bg-primary-soft", "text-primary");
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync" })).toBeInTheDocument();
  });
  it("InlineError is an alert with the danger look", () => {
    render(<InlineError>Failed</InlineError>);
    expect(screen.getByRole("alert")).toHaveClass("rounded-md", "bg-danger-soft", "p-3", "text-sm", "text-danger");
  });
  it("FilterChip exposes pressed state and the active look", async () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <FilterChip active={false} onClick={onClick}>
        Managed
      </FilterChip>,
    );
    const chip = screen.getByRole("button", { name: "Managed" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip).toHaveClass("min-h-11", "md:min-h-9", "rounded-full", "border", "px-3.5", "text-sm", "font-medium");
    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalled();
    rerender(<FilterChip active>Managed</FilterChip>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button")).toHaveClass("border-primary", "bg-primary-soft", "text-primary");
  });
  it("PageHeader renders the h1, description, actions and sets the document title", () => {
    render(<PageHeader title="Groups" description="Manage groups" actions={<button>Add</button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Groups" })).toHaveClass("text-2xl", "font-semibold", "tracking-tight", "md:text-[28px]");
    expect(screen.getByText("Manage groups")).toHaveClass("text-sm", "text-muted-foreground");
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(document.title).toBe("Groups · WhatsApp Bot Admin");
  });
  it("Section is a bordered card with an h2", () => {
    render(
      <Section title="Danger" description="Careful">
        body
      </Section>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Danger" })).toHaveClass("text-lg", "font-semibold");
    expect(screen.getByText("body").closest("section")).toHaveClass("rounded-lg", "border", "bg-surface", "p-4", "sm:p-5");
  });
});

describe("Switch thumb geometry", () => {
  it("has equal 4px gaps in a 44px track: translate 4px off, 22px on, mirrored in RTL", () => {
    render(<Switch aria-label="x" />);
    const thumb = screen.getByRole("switch").firstElementChild!;
    // inner track = 44 - 2*1px border = 42px; thumb 16px: 4px + 16px + 22px = 42px - 4px gap on the right
    expect(thumb).toHaveClass("size-4", "translate-x-1", "data-[state=checked]:translate-x-[22px]");
    expect(thumb).toHaveClass("rtl:-translate-x-1", "rtl:data-[state=checked]:-translate-x-[22px]");
    expect(thumb.className).not.toMatch(/translate-x-6/);
  });
});

describe("Button asChild disabled", () => {
  it("makes an anchor inert and non-focusable without forwarding type or disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button asChild disabled onClick={onClick}>
        <a href="/x">Go</a>
      </Button>,
    );
    const a = screen.getByText("Go");
    expect(a).toHaveAttribute("aria-disabled", "true");
    expect(a).toHaveAttribute("tabindex", "-1");
    expect(a).toHaveClass("pointer-events-none");
    expect(a).not.toHaveAttribute("type");
    expect(a).not.toHaveAttribute("disabled");
    a.click();
    expect(onClick).not.toHaveBeenCalled();
  });
  it("an enabled anchor child still receives onClick", async () => {
    const onClick = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    render(
      <Button asChild onClick={onClick}>
        <a href="/x">Go</a>
      </Button>,
    );
    await userEvent.click(screen.getByRole("link"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("DialogContent closeDisabled", () => {
  function Harness({ disabled, extra }: { disabled: boolean; extra?: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button onClick={() => setOpen(true)}>outside</button>
        <Dialog
          open={open}
          onOpenChange={(v) => {
            onOpenChange(v);
            setOpen(v);
          }}
        >
          <DialogContent title="T" closeDisabled={disabled} onEscapeKeyDown={extra}>
            body
          </DialogContent>
        </Dialog>
      </>
    );
  }
  const onOpenChange = vi.fn();
  const user = userEvent.setup({ pointerEventsCheck: 0 }); // Radix sets pointer-events:none on <body>
  const outsidePointerDown = () =>
    user.pointer({ target: document.querySelector("[class*='backdrop-blur']")!, keys: "[MouseLeft]" });

  it("blocks Escape and outside pointer-down while closeDisabled; caller handler still runs", async () => {
    onOpenChange.mockClear();
    const extra = vi.fn();
    render(<Harness disabled extra={extra} />);
    await userEvent.keyboard("{Escape}");
    await outsidePointerDown();
    expect(extra).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("closes on Escape and outside pointer-down when not disabled", async () => {
    onOpenChange.mockClear();
    render(<Harness disabled={false} />);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    onOpenChange.mockClear();
    await user.click(screen.getByRole("button", { name: "outside" }));
    await screen.findByRole("dialog");
    await outsidePointerDown();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});

describe("Dialog inert outside", () => {
  function Stack() {
    const [a, setA] = useState(false);
    const [b, setB] = useState(false);
    return (
      <>
        <button onClick={() => setA(true)}>open A</button>
        <Dialog open={a} onOpenChange={setA}>
          <DialogContent title="A">
            <button onClick={() => setB(true)}>open B</button>
          </DialogContent>
        </Dialog>
        <Dialog open={b} onOpenChange={setB}>
          <DialogContent title="B">b</DialogContent>
        </Dialog>
      </>
    );
  }

  it("ref-counts inert across stacked dialogs and leaves nothing behind", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<Stack />);
    const app = screen.getByRole("button", { name: "open A" }).parentElement!;
    for (let round = 0; round < 2; round++) {
      await user.click(screen.getByRole("button", { name: "open A" }));
      const dlgA = await screen.findByRole("dialog", { name: "A" });
      expect(app).toHaveAttribute("inert");
      expect(dlgA.closest("[inert]")).toBeNull();
      await user.click(within(dlgA).getByRole("button", { name: "open B" }));
      const dlgB = await screen.findByRole("dialog", { name: "B" });
      expect(dlgA.closest("[inert]")).not.toBeNull(); // A is behind B now
      expect(dlgB.closest("[inert]")).toBeNull();
      await user.keyboard("{Escape}"); // closes B only
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "B" })).not.toBeInTheDocument());
      expect(app).toHaveAttribute("inert"); // A still open
      expect(screen.getByRole("dialog", { name: "A" }).closest("[inert]")).toBeNull();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    }
  });

  it("does not take over an inert attribute set by someone else", async () => {
    const other = document.createElement("div");
    other.setAttribute("inert", "");
    document.body.appendChild(other);
    const { unmount } = render(
      <Dialog defaultOpen>
        <DialogContent title="T">x</DialogContent>
      </Dialog>,
    );
    await screen.findByRole("dialog");
    unmount();
    expect(other).toHaveAttribute("inert");
    other.remove();
  });
});

describe("Button aria-disabled (soft disabled)", () => {
  it("keeps focus, looks disabled and ignores clicks and form submission", async () => {
    const onClick = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" aria-disabled onClick={onClick}>Save</Button>
      </form>,
    );
    const btn = screen.getByRole("button", { name: "Save" });
    btn.focus();
    await userEvent.click(btn);
    expect(btn).toHaveFocus();
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveClass("opacity-50");
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
