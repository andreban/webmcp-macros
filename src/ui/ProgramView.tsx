import { Fragment, type ReactNode } from "react";
import { type Category, type Slot, type SlotValue, expressions, exprKind, readSlot, statements } from "../editor/registry";
import type { Expr, Macro, Stmt } from "../macro/types";

/**
 * Read-only block rendering of a macro's program, nested the way the program
 * nests. Blocks and expression pills are generated from the block registry,
 * so a new statement or expression kind needs only its registry entry.
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

/** A block always opens with its verb, so colour is never the only cue. */
function Shell({ category, verb, children }: { category: Category; verb: string; children?: ReactNode }) {
  return (
    <div className={`wmm-block wmm-block--${category}`}>
      <span className="wmm-verb">{verb}</span> {children}
    </div>
  );
}

function Block({ macro, stmt }: { macro: Macro; stmt: Stmt }) {
  const { category, verb, label } = statements[stmt.op];
  return (
    <Shell category={category} verb={verb}>
      <Parts macro={macro} node={stmt} label={label} />
    </Shell>
  );
}

/** Renders a registry label: text as is, each slot by its type. */
function Parts({ macro, node, label }: { macro: Macro; node: Stmt | Expr; label: readonly (string | Slot)[] }) {
  return label.map((part, index) => {
    // A label is fixed per kind, so the position is a stable key.
    if (typeof part === "string") return <Fragment key={index}>{part}</Fragment>;
    const slot = readSlot(node, part);
    if (slot === undefined) return null;
    const prefix = part.prefix === undefined ? null : slot.type === "body" ? <span className="wmm-verb">{part.prefix}</span> : part.prefix;
    return (
      <Fragment key={index}>
        {prefix}
        <SlotView macro={macro} slot={slot} />
      </Fragment>
    );
  });
}

/** One slot's value, read-only. */
export function SlotView({ macro, slot }: { macro: Macro; slot: SlotValue }) {
  switch (slot.type) {
    case "value":
      return <Value macro={macro} expr={slot.value} />;
    case "body":
      return <Body macro={macro} body={slot.value} />;
    case "tool":
      return <Tool macro={macro} alias={slot.value} />;
    case "var":
      return <Var name={slot.value} />;
    case "input": {
      // The label, not the key: the key is a macro-internal name.
      const label = macro.inputs?.find((input) => input.key === slot.value)?.label ?? slot.value;
      return <span className="wmm-pill wmm-pill--input">{label}</span>;
    }
    case "ms":
      return `${slot.value} ms`;
    case "args":
      return <Args macro={macro} args={slot.value} />;
    case "items":
      return slot.value.map((item, index) => (
        <span key={index} className="wmm-item">
          <Value macro={macro} expr={item} />
        </span>
      ));
    case "path":
      return slot.value.join(".");
    case "literal":
      return <span className="wmm-pill wmm-pill--lit">{JSON.stringify(slot.value)}</span>;
    case "site":
      return <code className="wmm-site">{slot.value}</code>;
    case "binOp":
      return slot.value;
    default:
      throw new Error(`Unknown slot: ${JSON.stringify(slot satisfies never)}`);
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

function Value({ macro, expr }: { macro: Macro; expr: Expr }) {
  const { label, bare } = expressions[exprKind(expr)];
  const parts = <Parts macro={macro} node={expr} label={label} />;
  return bare ? parts : <Pill>{parts}</Pill>;
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="wmm-pill">{children}</span>;
}
