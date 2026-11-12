import { type Dispatch, Fragment, type ReactNode, useId, useRef, useState } from "react";
import type { BinaryOp, Expr, Macro, Stmt } from "../macro/types";
import { ExprPicker, formatLiteral, type LiteralType, parseLiteral, variableNames } from "./ExprPicker";
import { type Slot as SlotDef, type SlotValue, type SlotValues, expressions, exprKind, readSlot } from "./registry";
import { type ArgSlot, literalType, missingArgs, newArg, toolArgSlots } from "./schemaSlots";
import { type EditorAction, isOptionalSlot, type Path } from "./state";

export interface SlotProps {
  macro: Macro;
  /** Where the expression lives, such as `["program", 0, "cond"]`. */
  path: Path;
  /** The slot's expression; `undefined` while an optional slot is empty. */
  expr: Expr | undefined;
  dispatch: Dispatch<EditorAction>;
  /** Names the slot for assistive technology, such as "condition". */
  label: string;
  /** What a literal typed here must be. Nested slots accept any value. */
  type?: LiteralType;
  /** The slot may be empty: it offers to add a value, and the picker to remove it. */
  optional?: boolean;
}

/**
 * An expression slot, edited in place: leaf fields are inline controls, nested
 * expressions are nested slots. Its button (Enter or click) opens the picker
 * that replaces the whole expression.
 */
export function Slot({ macro, path, expr, dispatch, label, type = "any", optional = false }: SlotProps) {
  const [picking, setPicking] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setPicking(false);
    button.current?.focus();
  };
  return (
    <span className="wmm-slot">
      {expr ? <ExprEditor macro={macro} path={path} expr={expr} dispatch={dispatch} type={type} /> : null}
      <button
        ref={button}
        type="button"
        className="wmm-slot-button"
        aria-label={`${expr ? "Change" : "Add"} ${label}`}
        aria-expanded={picking}
        onClick={() => setPicking(true)}
      >
        {expr ? "▾" : `+ ${label}`}
      </button>
      {picking ? (
        <ExprPicker
          macro={macro}
          current={expr}
          optional={optional}
          label={label}
          onCancel={close}
          onPick={(next) => {
            dispatch(next ? { type: "replaceNode", at: path, node: next } : { type: "clearSlot", at: path });
            close();
          }}
        />
      ) : null}
    </span>
  );
}

interface EditorProps {
  macro: Macro;
  path: Path;
  expr: Expr;
  dispatch: Dispatch<EditorAction>;
  type: LiteralType;
}

/** Renders the expression's registry label, with a control for each of its slots. */
function ExprEditor({ macro, path, expr, dispatch, type }: EditorProps) {
  const { label, bare } = expressions[exprKind(expr)];
  // Only a tool call's arguments have a schema; `obj` and `callProc` share the slot type.
  const schema = "call" in expr ? toolArgSlots(macro, expr.call) : undefined;
  const parts = label.map((part, index) => {
    // A label is fixed per kind, so the position is a stable key.
    if (typeof part === "string") return <Fragment key={index}>{part}</Fragment>;
    const slot = readSlot(expr, part);
    if (!slot) return null;
    // `SlotOf` admits a slot only for a field holding its slot type's values, so
    // writing a value of that type keeps `expr` the same variant.
    const update = (value: SlotValues[SlotDef["type"]]) =>
      dispatch({ type: "replaceNode", at: path, node: { ...expr, [part.slot]: value } as Expr });
    const at = [...path, part.slot];
    return (
      <Fragment key={index}>
        <Field macro={macro} path={at} slot={slot} dispatch={dispatch} type={type} update={update} schema={schema} />
      </Fragment>
    );
  });
  return bare ? parts : <span className="wmm-pill">{parts}</span>;
}

const BIN_OPS: Record<BinaryOp, true> = {
  "+": true, "-": true, "*": true, "/": true, "%": true, "==": true, "!=": true,
  "<": true, "<=": true, ">": true, ">=": true, and: true, or: true,
};
const isBinOp = (value: string): value is BinaryOp => Object.hasOwn(BIN_OPS, value);

interface FieldProps extends Omit<EditorProps, "expr"> {
  slot: SlotValue;
  update: (value: SlotValues[SlotDef["type"]]) => void;
  /** For an `args` slot of a tool call: the tool's schema arguments, when the macro saved its schema. */
  schema?: readonly ArgSlot[];
}

function Field({ macro, path, slot, dispatch, type, update, schema }: FieldProps) {
  const listId = useId();
  const nested = (expr: Expr, at: Path, label: string, literal?: LiteralType) => (
    <Slot macro={macro} path={at} expr={expr} dispatch={dispatch} label={label} type={literal} />
  );
  switch (slot.type) {
    case "value":
      return nested(slot.value, path, "value");
    case "literal":
      return (
        <DraftField
          label="value"
          value={formatLiteral(slot.value, type)}
          commit={(text) => {
            const parsed = parseLiteral(text, type);
            if (!parsed.ok) return parsed.error;
            update(parsed.value);
          }}
        />
      );
    case "var":
      return (
        <>
          <DraftField label="variable" value={slot.value} list={listId} commit={(text) => (text.trim() ? update(text.trim()) : "Name the variable.")} />
          <datalist id={listId}>
            {variableNames(macro.program).map((name) => <option key={name} value={name} />)}
          </datalist>
        </>
      );
    case "path":
      return (
        <DraftField
          label="field"
          value={slot.value.join(".")}
          commit={(text) => update(text.split(".").filter(Boolean).map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg)))}
        />
      );
    case "input":
      return <Choose label="input" value={slot.value} options={(macro.inputs ?? []).map((input) => [input.key, input.label])} onChange={update} />;
    case "tool":
      return <Choose label="tool" value={slot.value} options={Object.entries(macro.tools).map(([alias, tool]) => [alias, tool.name])} onChange={update} />;
    case "site":
      return <Choose label="site" value={slot.value} options={Object.keys(macro.sites).map((key) => [key, key])} onChange={update} />;
    case "binOp":
      return <Choose label="operator" value={slot.value} options={Object.keys(BIN_OPS).map((op) => [op, op])} onChange={(op) => isBinOp(op) && update(op)} />;
    case "args": {
      const records = slot.value;
      const add = (key: string) => update({ ...records, [key]: newArg(schema, key) });
      const missing = schema ? missingArgs(schema, records) : [];
      return (
        <span className="wmm-args">
          {Object.entries(records).map(([key, value]) => {
            // A key outside the schema edits untyped, so an outdated argument can still be fixed.
            const known = schema?.find((arg) => arg.key === key);
            return (
              <span key={key} className="wmm-arg" title={known?.description}>
                {key}
                {known?.required ? <abbr title="required">*</abbr> : null}: {nested(value, [...path, key], key, known && literalType(known.kind))}
                <button type="button" aria-label={`Remove ${key}`} onClick={() => update(Object.fromEntries(Object.entries(records).filter(([other]) => other !== key)))}>
                  ×
                </button>
              </span>
            );
          })}
          {missing.length > 0 ? (
            <select aria-label="add argument" value="" onChange={(event) => event.target.value && add(event.target.value)}>
              <option value="">+ argument</option>
              {missing.map((arg) => (
                <option key={arg.key} value={arg.key} title={arg.description}>
                  {arg.required ? `${arg.key} (required)` : arg.key}
                </option>
              ))}
            </select>
          ) : null}
          <DraftField
            label={schema ? "other field name" : "new field name"}
            value=""
            commit={(text) => {
              const key = text.trim();
              if (Object.hasOwn(records, key)) return `${key} is already set.`;
              if (key) add(key);
            }}
          />
        </span>
      );
    }
    case "items":
      return (
        <>
          {slot.value.map((item, index) => (
            <span key={index} className="wmm-item">
              {nested(item, [...path, index], `item ${index + 1}`)}
              <button type="button" aria-label={`Remove item ${index + 1}`} onClick={() => update(slot.value.toSpliced(index, 1))}>
                ×
              </button>
            </span>
          ))}
          <button type="button" onClick={() => update([...slot.value, { lit: null }])}>
            + item
          </button>
        </>
      );
    case "ms":
      return (
        <>
          <DraftField
            label="milliseconds"
            value={String(slot.value)}
            commit={(text) => {
              const ms = Number(text.trim());
              if (text.trim() === "" || !Number.isInteger(ms) || ms < 0) return "Enter a whole number of milliseconds.";
              update(ms);
            }}
          />{" "}
          ms
        </>
      );
    case "body":
      return null; // the program editor renders bodies as blocks
    default:
      throw new Error(`Unknown slot: ${JSON.stringify(slot satisfies never)}`);
  }
}

// Readable names for statement fields whose key is not a word on its own.
const FIELD_LABELS: Readonly<Record<string, string>> = { cond: "condition", saveAs: "result name", timeoutMs: "time limit" };

// What an optional field starts as when added; value slots are filled through their picker instead.
const NEW_FIELD: { readonly [T in SlotDef["type"]]?: SlotValues[T] } = { var: "result", ms: 5000, body: [], args: {} };

export interface StmtSlotProps {
  macro: Macro;
  /** The statement's path; the slot lives at `[...at, part.slot]`. */
  at: Path;
  stmt: Stmt;
  part: SlotDef;
  dispatch: Dispatch<EditorAction>;
  /** Bodies are blocks, which only the program editor knows how to render. */
  renderBody: (body: Stmt[], at: Path) => ReactNode;
}

/**
 * One slot of a statement block, editable in place. An optional field that is
 * absent shows as a button that adds it, and a present one can be removed.
 */
export function StmtSlot({ macro, at, stmt, part, dispatch, renderBody }: StmtSlotProps) {
  const path = [...at, part.slot];
  const label = FIELD_LABELS[part.slot] ?? part.slot;
  const optional = isOptionalSlot(stmt.op, part.slot);
  // `call` without `args` means no arguments, so it edits as an empty record.
  const slot = readSlot(stmt, part) ?? (part.type === "args" ? { type: "args", value: {} } : undefined);
  // As in `ExprEditor`: `SlotOf` ties the slot type to the field's value type.
  const update = (value: SlotValues[SlotDef["type"]]) =>
    dispatch({ type: "replaceNode", at, node: { ...stmt, [part.slot]: value } as Stmt });
  const schema = stmt.op === "call" ? toolArgSlots(macro, stmt.tool) : undefined;
  if (part.type === "value") {
    const expr = slot?.type === "value" ? slot.value : undefined;
    return (
      <>
        {expr && part.prefix}
        <Slot macro={macro} path={path} expr={expr} dispatch={dispatch} label={label} optional={optional} />
      </>
    );
  }
  if (slot === undefined) {
    const value = NEW_FIELD[part.type];
    return value === undefined ? null : (
      <button type="button" className="wmm-slot-button" onClick={() => update(value)}>
        + {label}
      </button>
    );
  }
  const prefix = part.prefix && (slot.type === "body" ? <span className="wmm-verb">{part.prefix}</span> : part.prefix);
  return (
    <>
      {prefix}
      {slot.type === "body" ? (
        renderBody(slot.value, path)
      ) : (
        <Field macro={macro} path={path} slot={slot} dispatch={dispatch} type="any" update={update} schema={schema} />
      )}
      {optional && part.type !== "args" ? (
        <button type="button" className="wmm-slot-button" aria-label={`Remove ${label}`} onClick={() => dispatch({ type: "clearSlot", at: path })}>
          ×
        </button>
      ) : null}
    </>
  );
}

/** A select over `[value, text]` options; a value not among them shows as unchosen. */
function Choose({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  const known = options.some(([option]) => option === value);
  return (
    <select aria-label={label} value={known ? value : ""} onChange={(event) => onChange(event.target.value)}>
      {known ? null : <option value="">Choose {label}</option>}
      {options.map(([option, text]) => (
        <option key={option} value={option}>
          {text}
        </option>
      ))}
    </select>
  );
}

/**
 * A text field that commits on blur or Enter, so one edit is one undo step.
 * `commit` returns an error message to keep the draft and show it next to the
 * field; Escape drops the draft.
 */
function DraftField({ label, value, list, commit }: { label: string; value: string; list?: string; commit: (text: string) => string | undefined | void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const errorId = useId();
  const save = () => {
    if (draft === null) return;
    const message = draft === value ? undefined : commit(draft);
    setError(message ?? "");
    if (!message) setDraft(null);
  };
  const text = draft ?? value;
  return (
    <>
      <input
        className="wmm-slot-field"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        value={text}
        size={Math.max(3, text.length)}
        list={list}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
          else if (event.key === "Escape") {
            event.stopPropagation();
            setDraft(null);
            setError("");
          }
        }}
      />
      {error ? (
        <span id={errorId} role="alert" className="wmm-slot-error">
          {error}
        </span>
      ) : null}
    </>
  );
}
