import type { ReactNode } from "react";
import type { Expr, Macro, Stmt } from "../macro/types";

/**
 * Read-only block rendering of a macro's program: one component per AST node
 * kind (statement list, statement, expression, argument list), nested the way
 * the program nests. The block editor grows out of this by making the same
 * components editable.
 *
 * Styles live in `blocks.css`, namespaced under `wmm-`. The component does not
 * import them, so that the on-page launcher can inject them into its shadow
 * root as a string instead of leaking a stylesheet into the host page.
 */
export function ProgramView({ macro }: { macro: Macro }) {
  return (
    <div className="wmm-program">
      <Body macro={macro} body={macro.program} />
    </div>
  );
}

function Body({ macro, body }: { macro: Macro; body: Stmt[] }) {
  return (
    <ol className="wmm-blocks">
      {body.map((stmt, index) => (
        // Statements have no identity of their own; the position is the key.
        <li key={index}>
          <Block macro={macro} stmt={stmt} />
        </li>
      ))}
    </ol>
  );
}

type Category = "call" | "control" | "data" | "user";

/** A block always opens with its verb, so colour is never the only cue. */
function Shell({ category, verb, children }: { category: Category; verb: string; children?: ReactNode }) {
  return (
    <div className={`wmm-block wmm-block--${category}`}>
      <span className="wmm-verb">{verb}</span> {children}
    </div>
  );
}

function Block({ macro, stmt }: { macro: Macro; stmt: Stmt }) {
  switch (stmt.op) {
    case "call":
      return (
        <Shell category="call" verb="call">
          <Tool macro={macro} alias={stmt.tool} /> <Args macro={macro} args={stmt.args} />
          {stmt.saveAs ? <> as <Var name={stmt.saveAs} /></> : null}
        </Shell>
      );
    case "set":
      return (
        <Shell category="data" verb="set">
          <Var name={stmt.var} /> to <Value macro={macro} expr={stmt.value} />
        </Shell>
      );
    case "if":
      return (
        <Shell category="control" verb="if">
          <Value macro={macro} expr={stmt.cond} />
          <Body macro={macro} body={stmt.then} />
          {stmt.else ? (
            <>
              <span className="wmm-verb">else</span>
              <Body macro={macro} body={stmt.else} />
            </>
          ) : null}
        </Shell>
      );
    case "repeat":
      return (
        <Shell category="control" verb="repeat">
          <Value macro={macro} expr={stmt.times} /> times
          <Body macro={macro} body={stmt.body} />
        </Shell>
      );
    case "while":
      return (
        <Shell category="control" verb="while">
          <Value macro={macro} expr={stmt.cond} />
          <Body macro={macro} body={stmt.body} />
        </Shell>
      );
    case "forEach":
      return (
        <Shell category="control" verb="for each">
          <Var name={stmt.var} /> in <Value macro={macro} expr={stmt.list} />
          <Body macro={macro} body={stmt.body} />
        </Shell>
      );
    case "waitForTool":
      return (
        <Shell category="control" verb="wait until">
          <Tool macro={macro} alias={stmt.tool} /> is available
          {stmt.timeoutMs === undefined ? null : `, at most ${stmt.timeoutMs} ms`}
        </Shell>
      );
    case "wait":
      return <Shell category="control" verb="wait">{`${stmt.ms} ms`}</Shell>;
    case "message":
      return (
        <Shell category="user" verb="show">
          <Value macro={macro} expr={stmt.text} />
        </Shell>
      );
    case "stop":
      return (
        <Shell category="control" verb="stop">
          {stmt.message ? <Value macro={macro} expr={stmt.message} /> : null}
        </Shell>
      );
    case "fail":
      return (
        <Shell category="control" verb="fail with">
          <Value macro={macro} expr={stmt.message} />
        </Shell>
      );
    case "setKey":
      return (
        <Shell category="data" verb="set key">
          <Value macro={macro} expr={stmt.key} /> of <Var name={stmt.var} /> to <Value macro={macro} expr={stmt.value} />
        </Shell>
      );
    case "push":
      return (
        <Shell category="data" verb="add">
          <Value macro={macro} expr={stmt.value} /> to the end of <Var name={stmt.var} />
        </Shell>
      );
    case "popFront":
    case "popBack":
      return (
        <Shell category="data" verb={stmt.op === "popFront" ? "take first of" : "take last of"}>
          <Var name={stmt.var} />
          {stmt.saveAs ? <> as <Var name={stmt.saveAs} /></> : null}
        </Shell>
      );
    default:
      throw new Error(`Unknown statement: ${JSON.stringify(stmt satisfies never)}`);
  }
}

/** Shows the tool's registered name; the alias is a macro-internal key. */
function Tool({ macro, alias }: { macro: Macro; alias: string }) {
  return <code className="wmm-tool">{macro.tools[alias]?.name ?? alias}</code>;
}

function Var({ name }: { name: string }) {
  return <span className="wmm-pill wmm-pill--var">{name}</span>;
}

function Args({ macro, args }: { macro: Macro; args?: Record<string, Expr> | undefined }) {
  const entries = Object.entries(args ?? {});
  if (entries.length === 0) return null;
  return (
    <span className="wmm-args">
      {entries.map(([key, expr]) => (
        <span key={key} className="wmm-arg">
          {key}: <Value macro={macro} expr={expr} />
        </span>
      ))}
    </span>
  );
}

/**
 * `Expr` variants are told apart by their single key, so this narrows with
 * `in` checks; the final `never` makes a new variant fail the build here.
 */
function Value({ macro, expr }: { macro: Macro; expr: Expr }) {
  if ("lit" in expr) return <span className="wmm-pill wmm-pill--lit">{JSON.stringify(expr.lit)}</span>;
  if ("input" in expr) {
    // The label, not the key: the key is a macro-internal name.
    const label = macro.inputs?.find((input) => input.key === expr.input)?.label ?? expr.input;
    return <span className="wmm-pill wmm-pill--input">{label}</span>;
  }
  if ("var" in expr) return <Var name={expr.var} />;
  if ("get" in expr) return <Pill>{expr.path.join(".")} of <Value macro={macro} expr={expr.get} /></Pill>;
  if ("bin" in expr) {
    return (
      <Pill>
        <Value macro={macro} expr={expr.left} /> {expr.bin} <Value macro={macro} expr={expr.right} />
      </Pill>
    );
  }
  if ("not" in expr) return <Pill>not <Value macro={macro} expr={expr.not} /></Pill>;
  if ("obj" in expr) return <Pill>{"{ "}<Args macro={macro} args={expr.obj} />{" }"}</Pill>;
  if ("list" in expr) {
    return (
      <Pill>
        {"list "}
        {expr.list.map((item, index) => (
          <span key={index} className="wmm-item">
            <Value macro={macro} expr={item} />
          </span>
        ))}
      </Pill>
    );
  }
  if ("toolAvailable" in expr) return <Pill><Tool macro={macro} alias={expr.toolAvailable} /> available?</Pill>;
  if ("call" in expr) {
    return (
      <Pill>
        result of <Tool macro={macro} alias={expr.call} /> <Args macro={macro} args={expr.args} />
      </Pill>
    );
  }
  if ("getKey" in expr) {
    return (
      <Pill>
        <Value macro={macro} expr={expr.key} /> of <Value macro={macro} expr={expr.getKey} />
      </Pill>
    );
  }
  if ("hasKey" in expr) {
    return (
      <Pill>
        <Value macro={macro} expr={expr.hasKey} /> has <Value macro={macro} expr={expr.key} />?
      </Pill>
    );
  }
  if ("length" in expr) return <Pill>length of <Value macro={macro} expr={expr.length} /></Pill>;
  if ("contains" in expr) {
    return (
      <Pill>
        <Value macro={macro} expr={expr.contains} /> contains <Value macro={macro} expr={expr.item} />?
      </Pill>
    );
  }
  if ("keys" in expr) return <Pill>keys of <Value macro={macro} expr={expr.keys} /></Pill>;
  throw new Error(`Unknown expression: ${JSON.stringify(expr satisfies never)}`);
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="wmm-pill">{children}</span>;
}
