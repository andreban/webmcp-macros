import { type Dispatch, Fragment, useId, useRef, useState } from "react";
import type { BinaryOp, Expr, Macro } from "../macro/types";
import { ExprPicker, formatLiteral, type LiteralType, parseLiteral, variableNames } from "./ExprPicker";
import { type Slot as SlotDef, type SlotValue, type SlotValues, expressions, exprKind, readSlot } from "./registry";
import type { EditorAction, Path } from "./state";

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
        <Field macro={macro} path={at} slot={slot} dispatch={dispatch} type={type} update={update} />
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
}

function Field({ macro, path, slot, dispatch, type, update }: FieldProps) {
  const listId = useId();
  const nested = (expr: Expr, at: Path, label: string) => (
    <Slot macro={macro} path={at} expr={expr} dispatch={dispatch} label={label} />
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
    case "binOp":
      return <Choose label="operator" value={slot.value} options={Object.keys(BIN_OPS).map((op) => [op, op])} onChange={(op) => isBinOp(op) && update(op)} />;
    case "args": {
      const records = slot.value;
      return (
        <span className="wmm-args">
          {Object.entries(records).map(([key, value]) => (
            <span key={key} className="wmm-arg">
              {key}: {nested(value, [...path, key], key)}
              <button type="button" aria-label={`Remove ${key}`} onClick={() => update(Object.fromEntries(Object.entries(records).filter(([other]) => other !== key)))}>
                ×
              </button>
            </span>
          ))}
          <DraftField
            label="new field name"
            value=""
            commit={(text) => {
              const key = text.trim();
              if (Object.hasOwn(records, key)) return `${key} is already set.`;
              if (key) update({ ...records, [key]: { lit: null } });
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
    case "body":
    case "ms":
      return null; // statement-only slot types
    default:
      throw new Error(`Unknown slot: ${JSON.stringify(slot satisfies never)}`);
  }
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
