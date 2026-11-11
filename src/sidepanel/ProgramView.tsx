import type { Expr, Macro, Stmt } from "../macro/types";

/**
 * Read-only block rendering of a macro's program: one component per AST
 * node, nested the way the program nests. The block editor will grow out of
 * this by making the same components editable.
 */
export function ProgramView({ macro }: { macro: Macro }) {
  return <Body macro={macro} body={macro.program} />;
}

function Body({ macro, body }: { macro: Macro; body: Stmt[] }) {
  return (
    <ol className="blocks">
      {body.map((stmt, index) => (
        <li key={index}>
          <Block macro={macro} stmt={stmt} />
        </li>
      ))}
    </ol>
  );
}

function Block({ macro, stmt }: { macro: Macro; stmt: Stmt }) {
  const tool = (alias: string) => <code className="tool">{macro.tools[alias]?.name ?? alias}</code>;
  switch (stmt.op) {
    case "call":
      return (
        <div className="block call">
          call {tool(stmt.tool)} <Args macro={macro} args={stmt.args} />
          {stmt.saveAs && (
            <>
              {" "}
              → <span className="pill var">{stmt.saveAs}</span>
            </>
          )}
        </div>
      );
    case "set":
      return (
        <div className="block data">
          set <span className="pill var">{stmt.var}</span> to <Value macro={macro} expr={stmt.value} />
        </div>
      );
    case "if":
      return (
        <div className="block control">
          if <Value macro={macro} expr={stmt.cond} />
          <Body macro={macro} body={stmt.then} />
          {stmt.else && (
            <>
              else
              <Body macro={macro} body={stmt.else} />
            </>
          )}
        </div>
      );
    case "repeat":
      return (
        <div className="block control">
          repeat <Value macro={macro} expr={stmt.times} /> times
          <Body macro={macro} body={stmt.body} />
        </div>
      );
    case "while":
      return (
        <div className="block control">
          while <Value macro={macro} expr={stmt.cond} />
          <Body macro={macro} body={stmt.body} />
        </div>
      );
    case "forEach":
      return (
        <div className="block control">
          for each <span className="pill var">{stmt.var}</span> in <Value macro={macro} expr={stmt.list} />
          <Body macro={macro} body={stmt.body} />
        </div>
      );
    case "waitForTool":
      return <div className="block control">wait until {tool(stmt.tool)} is available</div>;
    case "wait":
      return <div className="block control">wait {stmt.ms} ms</div>;
    case "message":
      return (
        <div className="block user">
          show <Value macro={macro} expr={stmt.text} />
        </div>
      );
    case "stop":
      return <div className="block control">stop {stmt.message && <Value macro={macro} expr={stmt.message} />}</div>;
    case "fail":
      return (
        <div className="block control">
          fail with <Value macro={macro} expr={stmt.message} />
        </div>
      );
  }
}

function Args({ macro, args }: { macro: Macro; args?: Record<string, Expr> }) {
  const entries = Object.entries(args ?? {});
  if (entries.length === 0) return null;
  return (
    <span className="args">
      {entries.map(([key, expr]) => (
        <span key={key} className="arg">
          {key}: <Value macro={macro} expr={expr} />
        </span>
      ))}
    </span>
  );
}

function Value({ macro, expr }: { macro: Macro; expr: Expr }) {
  if ("lit" in expr) return <span className="pill lit">{JSON.stringify(expr.lit)}</span>;
  if ("input" in expr) {
    const label = macro.inputs?.find((input) => input.key === expr.input)?.label ?? expr.input;
    return <span className="pill input">{label}</span>;
  }
  if ("var" in expr) return <span className="pill var">{expr.var}</span>;
  if ("get" in expr) {
    return (
      <span className="pill">
        {expr.path.join(".")} of <Value macro={macro} expr={expr.get} />
      </span>
    );
  }
  if ("not" in expr) {
    return (
      <span className="pill">
        not <Value macro={macro} expr={expr.not} />
      </span>
    );
  }
  if ("bin" in expr) {
    return (
      <span className="pill">
        <Value macro={macro} expr={expr.left} /> {expr.bin} <Value macro={macro} expr={expr.right} />
      </span>
    );
  }
  if ("toolAvailable" in expr) {
    return <span className="pill">{macro.tools[expr.toolAvailable]?.name ?? expr.toolAvailable} available?</span>;
  }
  if ("call" in expr) {
    return (
      <span className="pill">
        result of <code className="tool">{macro.tools[expr.call]?.name ?? expr.call}</code>{" "}
        <Args macro={macro} args={expr.args} />
      </span>
    );
  }
  if ("list" in expr) {
    return (
      <span className="pill">
        [
        {expr.list.map((item, index) => (
          <Value key={index} macro={macro} expr={item} />
        ))}
        ]
      </span>
    );
  }
  return (
    <span className="pill">
      {"{"}
      <Args macro={macro} args={expr.obj} />
      {"}"}
    </span>
  );
}
