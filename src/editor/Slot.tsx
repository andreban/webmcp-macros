import { type Dispatch, Fragment, type ReactNode, useContext, useId, useRef, useState } from "react";
import type { BinaryOp, Expr, Json, Macro, MacroTool, Stmt } from "../macro/types";
import { ExprPicker, formatLiteral, type LiteralType, parseLiteral, variableNames } from "./ExprPicker";
import { type Slot as SlotDef, type SlotValue, type SlotValues, expressions, exprKind, readSlot } from "./registry";
import { type ArgSlot, argOptions, type EnumOption, literalType, missingArgs, newArg, requiredArgs, schemaSlots, toolArgSlots } from "./schemaSlots";
import { type EditorAction, isOptionalSlot, type Path } from "./state";
import { resultFields } from "./resultFields";
import { PageToolsContext, toolEntry } from "./ToolPalette";

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
  /** The values a literal here is picked from, as a dropdown: an enum's options. */
  options?: readonly EnumOption[];
  /** The slot may be empty: it offers to add a value, and the picker to remove it. */
  optional?: boolean;
}

/**
 * An expression slot, edited in place: leaf fields are inline controls, nested
 * expressions are nested slots. Its button (Enter or click) opens the picker
 * that replaces the whole expression.
 */
export function Slot({ macro, path, expr, dispatch, label, type = "any", options, optional = false }: SlotProps) {
  const [picking, setPicking] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setPicking(false);
    button.current?.focus();
  };
  return (
    <span className="wmm-slot">
      {expr ? <ExprEditor macro={macro} path={path} expr={expr} dispatch={dispatch} type={type} options={options} /> : null}
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
  options?: readonly EnumOption[] | undefined;
}

/** Renders the expression's registry label, with a control for each of its slots. */
function ExprEditor({ macro, path, expr, dispatch, type, options }: EditorProps) {
  const { label, bare } = expressions[exprKind(expr)];
  // Only a tool call's arguments have a schema; `obj` and `callProc` share the slot type.
  const schema = "call" in expr ? toolArgSlots(macro, expr.call) : undefined;
  // Only a `get` has a path slot; its suggestions come from the value's outputSchema.
  const fields = "get" in expr ? resultFields(macro, expr.get) : undefined;
  const parts = label.map((part, index) => {
    // A label is fixed per kind, so the position is a stable key.
    if (typeof part === "string") return <Fragment key={index}>{part}</Fragment>;
    const slot = readSlot(expr, part);
    if (!slot) return null;
    // `SlotOf` admits a slot only for a field holding its slot type's values, so
    // writing a value of that type keeps `expr` the same variant.
    const update: Update = (value, tools) =>
      dispatch({ type: "replaceNode", at: path, node: { ...expr, [part.slot]: value } as Expr, tools });
    const at = [...path, part.slot];
    return (
      <Fragment key={index}>
        <Field macro={macro} path={at} slot={slot} dispatch={dispatch} type={type} options={options} update={update} schema={schema} fields={fields} />
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

/** Writes a slot's value; `tools` are merged into the macro in the same step (see `replaceNode`). */
type Update = (value: SlotValues[SlotDef["type"]], tools?: Record<string, MacroTool>) => void;

interface FieldProps extends Omit<EditorProps, "expr"> {
  slot: SlotValue;
  update: Update;
  /** For an `args` slot of a tool call: the tool's schema arguments, when the macro saved its schema. */
  schema?: readonly ArgSlot[];
  /** For a `path` slot: field paths the value's tool declares in its outputSchema. */
  fields?: readonly string[] | undefined;
}

function Field({ macro, path, slot, dispatch, type, options, update, schema, fields }: FieldProps) {
  const listId = useId();
  const nested = (expr: Expr, at: Path, label: string, known?: ArgSlot) => (
    <Slot
      macro={macro}
      path={at}
      expr={expr}
      dispatch={dispatch}
      label={label}
      type={known && literalType(known.kind)}
      options={known && argOptions(known.kind)}
    />
  );
  switch (slot.type) {
    case "value":
      return nested(slot.value, path, "value");
    case "literal":
      return options ? (
        <OptionChoose value={slot.value} options={options} onChange={update} />
      ) : (
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
        <>
          <DraftField
            label="field"
            value={slot.value.join(".")}
            list={fields?.length ? listId : undefined}
            commit={(text) => update(text.split(".").filter(Boolean).map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg)))}
          />
          {fields?.length ? (
            <datalist id={listId}>
              {fields.map((field) => <option key={field} value={field} />)}
            </datalist>
          ) : null}
        </>
      );
    case "input":
      return <Choose label="input" value={slot.value} options={(macro.inputs ?? []).map((input) => [input.key, input.label])} onChange={update} />;
    case "tool":
      return <ToolChoose macro={macro} value={slot.value} onChange={update} />;
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
                {known?.required ? <abbr title="required">*</abbr> : null}: {nested(value, [...path, key], key, known)}
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
  const update: Update = (value, tools) => {
    const node = { ...stmt, [part.slot]: value } as Stmt;
    // A call that has no arguments yet gets the newly chosen tool's required ones, as the tool palette's blocks do.
    const args = node.op === "call" && tools && !node.args ? requiredArgs(schemaSlots(tools[node.tool]?.inputSchema)) : {};
    if (node.op === "call" && Object.keys(args).length > 0) node.args = args;
    dispatch({ type: "replaceNode", at, node, tools });
  };
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

const PAGE_TOOL = "page:";

/**
 * Picks a tool: one the macro already declares, or one the page registers now,
 * which is added to the macro with its schema on pick. Without the page's
 * tools a new macro would have nothing to choose from.
 */
function ToolChoose({ macro, value, onChange }: { macro: Macro; value: string; onChange: Update }) {
  const page = useContext(PageToolsContext);
  const declared = Object.entries(macro.tools);
  const fresh = (page?.tools ?? []).filter(
    (tool) => tool.live && !declared.some(([, known]) => known.site === page?.site && known.name === tool.name && known.frameOrigin === tool.frameOrigin),
  );
  const known = declared.some(([alias]) => alias === value);
  const pick = (chosen: string) => {
    const tool = chosen.startsWith(PAGE_TOOL) ? fresh[Number(chosen.slice(PAGE_TOOL.length))] : undefined;
    if (!tool || !page) return onChange(chosen);
    const { alias, tools } = toolEntry(macro, tool, page.site);
    onChange(alias, tools);
  };
  return (
    <select aria-label="tool" value={known ? value : ""} onChange={(event) => pick(event.target.value)}>
      {known ? null : <option value="">Choose tool</option>}
      {declared.length > 0 ? (
        <optgroup label="In this macro">
          {declared.map(([alias, tool]) => (
            <option key={alias} value={alias}>
              {tool.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      {fresh.length > 0 ? (
        <optgroup label="On this page">
          {fresh.map((tool, index) => (
            <option key={`${tool.origin ?? ""} ${tool.name}`} value={`${PAGE_TOOL}${index}`}>
              {tool.origin === undefined ? tool.name : `${tool.name} (${tool.origin})`}
            </option>
          ))}
        </optgroup>
      ) : null}
      {declared.length === 0 && fresh.length === 0 ? (
        <option value="" disabled>
          {page ? "This page registers no tools" : "No page to read tools from"}
        </option>
      ) : null}
    </select>
  );
}

/**
 * A literal picked from a schema's options. A value outside them, from an
 * older schema or a hand edit, stays listed so the select never shows a
 * value other than the one in the macro.
 */
function OptionChoose({ value, options, onChange }: { value: Json; options: readonly EnumOption[]; onChange: (value: Json) => void }) {
  const known = options.some((option) => option === value);
  const shown: readonly Json[] = known ? options : [value, ...options];
  return (
    <select aria-label="value" value={JSON.stringify(value)} onChange={(event) => onChange(shown.find((option) => JSON.stringify(option) === event.target.value) ?? null)}>
      {shown.map((option) => (
        <option key={JSON.stringify(option)} value={JSON.stringify(option)}>
          {typeof option === "string" ? option : JSON.stringify(option)}
          {known || option !== value ? "" : " (not an option)"}
        </option>
      ))}
    </select>
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
