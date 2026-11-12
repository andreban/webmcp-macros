import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MACRO_VERSION, type Expr, type Macro, type Stmt } from "../macro/types";
import { statements } from "./registry";
import { Slot, type SlotProps, StmtSlot } from "./Slot";

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

  it("suggests a call's arguments from the tool's saved schema", () => {
    const launch = { site: "app", name: "prepare_launch", inputSchema: {
      type: "object",
      properties: { auth_code: { type: "string" }, trajectory: { enum: ["Moon", "Mars"] }, crew: { type: "integer" } },
      required: ["auth_code", "trajectory"],
    } };
    const withSchema = { ...macro, tools: { ...macro.tools, launch } };
    const html = render({ call: "launch", args: { auth_code: { lit: "x" }, legacy: { lit: 1 } } }, { macro: withSchema });
    expect(html).toContain('auth_code<abbr title="required">*</abbr>: ');
    expect(html).toMatch(/auth_code<abbr[^>]*>\*<\/abbr>: <span class="wmm-slot"><input[^>]* value="x"/); // a string edits unquoted
    expect(html).toContain("legacy: "); // keys outside the schema stay editable
    expect(html).toContain('aria-label="Remove legacy"');
    expect(html).toContain('<option value="trajectory">trajectory (required)</option>');
    expect(html).toContain('<option value="crew">crew</option>');
    expect(html).not.toContain('<option value="auth_code">');
    expect(html).toContain('aria-label="other field name"');
  });

  it("keeps free-form arguments without a schema, and for objects and procedures", () => {
    for (const expr of [{ call: "look", args: {} }, { obj: {} }, { callProc: "p", args: {} }] satisfies Expr[]) {
      const html = render(expr);
      expect(html).not.toContain('aria-label="add argument"');
      expect(html).toContain('aria-label="new field name"');
    }
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

/** Renders every slot of `stmt` as the program editor does, with bodies as a marker. */
const renderStmt = (stmt: Stmt) =>
  renderToStaticMarkup(
    <>
      {statements[stmt.op].label.map((part, index) =>
        typeof part === "string" ? null : (
          <StmtSlot
            key={index}
            macro={macro}
            at={["program", 0]}
            stmt={stmt}
            part={part}
            dispatch={() => {}}
            renderBody={(body, at) => <i>{`${at.join("/")}:${body.length}`}</i>}
          />
        ),
      )}
    </>,
  );

describe("StmtSlot", () => {
  it("edits leaf fields in place", () => {
    const html = renderStmt({ op: "call", tool: "look", saveAs: "seen" });
    expect(html).toMatch(/<option value="look" selected="">look_around<\/option>/);
    expect(html).toContain('aria-label="new field name"'); // absent args edit as none
    expect(html).toMatch(/ as <input[^>]*aria-label="variable"[^>]* value="seen"/);
    expect(html).toContain('aria-label="Remove result name"');
    expect(renderStmt({ op: "wait", ms: 250 })).toMatch(/aria-label="milliseconds"[^>]* value="250"/);
  });

  it("suggests a call statement's arguments from its tool's schema", () => {
    const schema = { type: "object", properties: { dir: { type: "string" } }, required: ["dir"] };
    const withSchema = { ...macro, tools: { look: { site: "app", name: "look_around", inputSchema: schema } } };
    const html = renderToStaticMarkup(
      <StmtSlot macro={withSchema} at={["program", 0]} stmt={{ op: "call", tool: "look" }} part={{ slot: "args", type: "args" }} dispatch={() => {}} renderBody={() => null} />,
    );
    expect(html).toContain('<option value="dir">dir (required)</option>');
  });

  it("offers to add an absent optional field, and only an optional one", () => {
    const html = renderStmt({ op: "waitForTool", tool: "look" });
    expect(html).toContain(">+ time limit</button>");
    expect(renderStmt({ op: "popFront", var: "queue" })).toContain(">+ result name</button>");
    expect(renderStmt({ op: "stop" })).toContain('aria-label="Add message"');
    expect(renderStmt({ op: "return" })).toContain('aria-label="Add value"');
    expect(renderStmt({ op: "set", var: "x", value: { lit: 1 } })).not.toContain("Remove");
  });

  it("renders bodies through the editor, with the else branch removable", () => {
    const withElse = renderStmt({ op: "if", cond: { lit: true }, then: [], else: [{ op: "stop" }] });
    expect(withElse).toContain("<i>program/0/then:0</i>");
    expect(withElse).toContain('<span class="wmm-verb">else</span><i>program/0/else:1</i>');
    expect(withElse).toContain('aria-label="Remove else"');
    expect(withElse).toContain('aria-label="Change condition"');
    expect(renderStmt({ op: "if", cond: { lit: true }, then: [] })).toContain(">+ else</button>");
  });
});
