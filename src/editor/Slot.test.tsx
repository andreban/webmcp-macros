import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MACRO_VERSION, type Expr, type Macro, type Stmt } from "../macro/types";
import { statements } from "./registry";
import { Slot, type SlotProps, StmtSlot } from "./Slot";
import { PageToolsContext, type PageTools } from "./ToolPalette";

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

  it("suggests a result's fields from its tool's outputSchema, keeping the field free text", () => {
    const outputSchema = { type: "object", properties: { child: { type: "string" }, wishes: { type: "array" } } };
    const withSchema: Macro = {
      ...macro,
      tools: { look: { site: "app", name: "look_around", outputSchema } },
      program: [{ op: "call", tool: "look", saveAs: "letter" }],
    };
    const html = render({ get: { var: "letter" }, path: [] }, { macro: withSchema });
    expect(html).toMatch(/aria-label="field"[^>]* list="[^"]+"/);
    expect(html).toContain('<option value="child"></option><option value="wishes"></option>');
    expect(render({ get: { var: "count" }, path: [] })).not.toMatch(/aria-label="field"[^>]* list=/);
  });

  it("edits a tool call's tool and arguments", () => {
    const html = render({ call: "look", args: { dir: { lit: "north" } } });
    expect(html).toMatch(/<option value="look" selected="">look_around<\/option>/);
    expect(html).toContain("dir: ");
    expect(html).toContain('aria-label="Remove dir"');
    expect(html).toContain('aria-label="new argument name"');
  });

  it("offers the page's tools that the macro does not use yet, so a new macro can pick one", () => {
    const pageTools: PageTools = {
      site: "app",
      tools: [
        { name: "look_around", live: true },
        { name: "open_door", live: true },
        { name: "framed", live: true, origin: "https://frame.example" },
        { name: "gone", live: false },
      ],
    };
    const html = renderToStaticMarkup(
      <PageToolsContext value={pageTools}>
        <Slot macro={macro} path={["program", 0, "value"]} expr={{ call: "" }} dispatch={() => {}} label="value" />
      </PageToolsContext>,
    );
    expect(html).toContain('<option value="" selected="">Choose tool</option>');
    expect(html).toContain('<optgroup label="In this macro"><option value="look">look_around</option></optgroup>');
    // look_around is already declared, and a tool the page no longer registers is not offered.
    expect(html).toContain(
      '<optgroup label="On this page"><option value="page:0">open_door</option><option value="page:1">framed (https://frame.example)</option></optgroup>',
    );
  });

  it("says why a tool slot has nothing to offer", () => {
    const empty = { ...macro, tools: {} };
    const slot = <Slot macro={empty} path={["program", 0, "value"]} expr={{ call: "" }} dispatch={() => {}} label="value" />;
    expect(renderToStaticMarkup(slot)).toContain("No page to read tools from");
    const html = renderToStaticMarkup(<PageToolsContext value={{ site: "app", tools: [] }}>{slot}</PageToolsContext>);
    expect(html).toContain("This page registers no tools");
  });

  it("picks enum arguments from a dropdown, keeping a value outside the options", () => {
    const fly = { site: "app", name: "fly", inputSchema: {
      type: "object",
      properties: { to: { enum: ["Moon", "Mars"] }, crewed: { type: "boolean" }, note: { type: "string" } },
    } };
    const withSchema = { ...macro, tools: { ...macro.tools, fly } };
    const html = render({ call: "fly", args: { to: { lit: "Mars" }, crewed: { lit: true }, note: { lit: "hi" } } }, { macro: withSchema });
    expect(html).toContain('<select aria-label="value"><option value="&quot;Moon&quot;">Moon</option><option value="&quot;Mars&quot;" selected="">Mars</option></select>');
    expect(html).toMatch(/aria-label="value"[^>]* value="true"/); // a boolean is still typed in
    expect(html).toMatch(/aria-label="value"[^>]* value="hi"/); // a string is still typed in
    const odd = render({ call: "fly", args: { to: { lit: "Pluto" } } }, { macro: withSchema });
    expect(odd).toContain('<option value="&quot;Pluto&quot;" selected="">Pluto (not an option)</option><option value="&quot;Moon&quot;">Moon</option>');
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
    expect(html).not.toContain('aria-label="new argument name"'); // the schema's fields are offered instead
  });

  it("keeps free-form arguments without a schema, and for objects and procedures", () => {
    for (const expr of [{ call: "look", args: {} }, { obj: {} }, { callProc: "p", args: {} }] satisfies Expr[]) {
      const html = render(expr);
      expect(html).not.toContain('aria-label="add argument"');
      // An object's entries are keys, a call's are arguments; the placeholder says which.
      expect(html).toContain("obj" in expr ? 'placeholder="+ key"' : 'placeholder="+ argument"');
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
    expect(html).toContain('aria-label="new argument name"'); // absent args edit as none
    expect(html).toMatch(/ as <input[^>]*aria-label="variable"[^>]* value="seen"/);
    expect(html).toContain('aria-label="Remove save result"');
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
    expect(renderStmt({ op: "popFront", var: "queue" })).toContain(">+ save result</button>");
    // A call's result is named after its tool, so the first click gives a meaningful name.
    expect(renderStmt({ op: "call", tool: "look" })).toContain(">+ save result</button>");
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
