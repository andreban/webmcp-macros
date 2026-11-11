import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MACRO_VERSION, type Macro } from "../macro/types";
import { ProgramView } from "./ProgramView";

// Uses every statement and every expression kind at least once.
const macro: Macro = {
  wmm: MACRO_VERSION,
  id: "all-kinds",
  name: "All kinds",
  sites: { shop: { match: ["https://shop.example/*"] } },
  tools: {
    search: { site: "shop", name: "search_products" },
    add: { site: "shop", name: "add_to_cart" },
  },
  trigger: { site: "shop", anyOf: [["search"]] },
  inputs: [{ key: "q", label: "What to buy", schema: { type: "string" } }],
  program: [
    { op: "waitForTool", tool: "search", timeoutMs: 5000 },
    { op: "call", tool: "search", args: { query: { input: "q" } }, saveAs: "found" },
    { op: "set", var: "count", value: { lit: 0 } },
    {
      op: "if",
      cond: { not: { toolAvailable: "add" } },
      then: [{ op: "fail", message: { lit: "No cart" } }],
      else: [{ op: "message", text: { lit: "Cart ready" } }],
    },
    {
      op: "forEach",
      list: { get: { var: "found" }, path: ["items", 0] },
      var: "item",
      body: [{ op: "call", tool: "add", args: { id: { obj: { sku: { var: "item" } } } } }],
    },
    {
      op: "while",
      cond: { bin: "<", left: { var: "count" }, right: { lit: 3 } },
      body: [{ op: "wait", ms: 250 }],
    },
    {
      op: "repeat",
      times: { lit: 2 },
      body: [{ op: "message", text: { call: "search", args: { query: { list: [{ lit: "a" }, { lit: "b" }] } } } }],
    },
    { op: "stop", message: { lit: "Done" } },
  ],
};

const html = renderToStaticMarkup(<ProgramView macro={macro} />);
const verbs = (markup: string) =>
  [...markup.matchAll(/<span class="wmm-verb">([^<]*)<\/span>/g)].map((match) => match[1]);

describe("ProgramView", () => {
  it("opens every block with its verb, in program order", () => {
    expect(verbs(html)).toEqual([
      "wait until",
      "call",
      "set",
      "if",
      "fail with",
      "else",
      "show",
      "for each",
      "call",
      "while",
      "wait",
      "repeat",
      "show",
      "stop",
    ]);
  });

  it("shows tool names and input labels, not aliases and keys", () => {
    expect(html).toContain("search_products");
    expect(html).toContain("add_to_cart");
    expect(html).toContain("What to buy");
    expect(html).not.toMatch(/>search<|>add<|>q</);
  });

  it("renders every expression kind", () => {
    for (const text of ["not ", "available?", "items.0 of ", " &lt; ", "sku: ", "list ", "result of ", "&quot;Done&quot;"]) {
      expect(html).toContain(text);
    }
  });

  it("nests bodies inside their block", () => {
    expect(html).toMatch(/<span class="wmm-verb">repeat<\/span>.*?<ol class="wmm-blocks"><li><div[^>]*><span class="wmm-verb">show/);
  });

  it("falls back to the alias and key when they are not declared", () => {
    const bare = renderToStaticMarkup(
      <ProgramView macro={{ ...macro, inputs: [], program: [{ op: "call", tool: "missing", args: { a: { input: "k" } } }] }} />,
    );
    expect(bare).toContain("missing");
    expect(bare).toContain(">k<");
  });
});

describe("ProgramView data blocks", () => {
  const data = renderToStaticMarkup(
    <ProgramView
      macro={{
        ...macro,
        program: [
          { op: "setKey", var: "seen", key: { var: "cell" }, value: { length: { keys: { var: "seen" } } } },
          { op: "push", var: "queue", value: { getKey: { var: "grid" }, key: { lit: "0,0" } } },
          { op: "popFront", var: "queue", saveAs: "cell" },
          { op: "popBack", var: "queue" },
          { op: "if", cond: { hasKey: { var: "seen" }, key: { lit: "a" } }, then: [] },
          { op: "if", cond: { contains: { var: "queue" }, item: { lit: 1 } }, then: [] },
        ],
      }}
    />,
  );

  it("opens data statements with their verbs", () => {
    expect(verbs(data)).toEqual(["set key", "add", "take first of", "take last of", "if", "if"]);
  });

  it("renders data expressions", () => {
    for (const text of ["length of ", "keys of ", " has ", " contains ", "to the end of ", "&quot;0,0&quot;</span> of "]) {
      expect(data).toContain(text);
    }
  });
});
