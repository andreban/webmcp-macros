import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MACRO_VERSION, type Expr, type Macro } from "../macro/types";
import { Slot, type SlotProps } from "./Slot";

const macro: Macro = {
  wmm: MACRO_VERSION,
  id: "m",
  name: "M",
  sites: { app: { match: ["https://example.com/*"] } },
  tools: { look: { site: "app", name: "look_around" } },
  trigger: { site: "app", anyOf: [["look"]] },
  inputs: [{ key: "code", label: "Auth code", schema: { type: "string" } }],
  program: [{ op: "set", var: "count", value: { lit: 0 } }],
};

const render = (expr: Expr | undefined, props: Partial<SlotProps> = {}) =>
  renderToStaticMarkup(
    <Slot macro={macro} path={["program", 0, "value"]} expr={expr} dispatch={() => {}} label="value" {...props} />,
  );

describe("Slot", () => {
  it("shows a literal as an editable field formatted for the slot's type", () => {
    expect(render({ lit: "42" })).toContain('value="&quot;42&quot;"');
    expect(render({ lit: "42" }, { type: "text" })).toContain('value="42"');
    expect(render({ lit: 3 }, { type: "number" })).toMatch(/aria-label="value"[^>]* value="3"/);
    expect(render({ lit: 3 })).toContain('aria-label="Change value"');
  });

  it("edits nested expressions in place, each with its own picker button", () => {
    const html = render({ bin: "<", left: { var: "count" }, right: { get: { input: "code" }, path: ["a", 0] } });
    expect(html.match(/aria-label="Change value"/g)).toHaveLength(4);
    expect(html).toMatch(/<option value="&lt;" selected="">/);
    expect(html).toMatch(/aria-label="variable"[^>]* value="count"/);
    expect(html).toMatch(/aria-label="field"[^>]* value="a.0"/);
    expect(html).toMatch(/<option value="code" selected="">Auth code<\/option>/);
  });

  it("edits a tool call's tool and arguments", () => {
    const html = render({ call: "look", args: { dir: { lit: "north" } } });
    expect(html).toMatch(/<option value="look" selected="">look_around<\/option>/);
    expect(html).toContain("dir: ");
    expect(html).toContain('aria-label="Remove dir"');
    expect(html).toContain('aria-label="new field name"');
  });

  it("asks to choose a tool the macro no longer has", () => {
    expect(render({ toolAvailable: "gone" })).toContain('<option value="" selected="">Choose tool</option>');
  });

  it("lists items with a way to add and remove them", () => {
    const html = render({ list: [{ lit: 1 }, { lit: 2 }] });
    expect(html).toContain('aria-label="Remove item 2"');
    expect(html).toContain(">+ item</button>");
  });

  it("offers to add a value to an empty optional slot", () => {
    const html = render(undefined, { optional: true, label: "message" });
    expect(html).toContain('aria-label="Add message"');
    expect(html).toContain(">+ message</button>");
    expect(html).not.toContain("<input");
  });
});
