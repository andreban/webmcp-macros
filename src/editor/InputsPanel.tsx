import { type Dispatch, type KeyboardEvent, useState } from "react";
import type { Json, JsonSchema, Macro, MacroInput } from "../macro/types";
import { fieldFor } from "../ui/InputForm";
import { describePath, type EditorAction, inputKeyError, inputReferences } from "./state";

/** The input types offered here; each is one field kind of the run form. */
export type InputType = "text" | "number" | "integer" | "boolean" | "date" | "choice";

const TYPE_LABELS: Record<InputType, string> = {
  text: "Text",
  number: "Number",
  integer: "Whole number",
  boolean: "Yes / no",
  date: "Date",
  choice: "Choice",
};

const isInputType = (value: string): value is InputType => Object.hasOwn(TYPE_LABELS, value);

/** Read through `fieldFor`, so the type shown is the field the run form will draw. */
export function inputType(schema: JsonSchema): InputType {
  const field = fieldFor(schema);
  if (field.kind === "select") return "choice";
  if (field.kind === "checkbox") return "boolean";
  if (field.kind === "number") return field.integer ? "integer" : "number";
  return field.kind === "date" ? "date" : "text";
}

export function schemaFor(type: InputType): JsonSchema {
  if (type === "choice") return { type: "string", enum: [] };
  if (type === "date") return { type: "string", format: "date" };
  return { type: type === "text" ? "string" : type };
}

/**
 * The default as typed; empty means none. A date's default stays free text,
 * so relative dates such as "today+14d" are kept for the run form to resolve.
 */
export function parseDefault(type: InputType, text: string): { value: Json | undefined } | { error: string } {
  if (text.trim() === "") return { value: undefined };
  if (type !== "number" && type !== "integer") return { value: text };
  const number = Number(text);
  if (!Number.isFinite(number)) return { error: "Not a number." };
  return type === "integer" && !Number.isInteger(number) ? { error: "Not a whole number." } : { value: number };
}

export const parseOptions = (text: string): string[] =>
  text.split(",").flatMap((option) => (option.trim() ? [option.trim()] : []));

function withDefault(input: MacroInput, value: Json | undefined): MacroInput {
  const { default: _old, ...rest } = input;
  return value === undefined ? rest : { ...rest, default: value };
}

/** A new text input with the first free `inputN` key. */
export function newInput(macro: Macro): MacroInput {
  const keys = new Set((macro.inputs ?? []).map((input) => input.key));
  let n = 1;
  while (keys.has(`input${n}`)) n += 1;
  return { key: `input${n}`, label: `Input ${n}`, schema: { type: "string" }, mode: "ask" };
}

/** Why an input cannot be removed yet, or "" when it can. */
export function removeBlocker(macro: Macro, input: MacroInput): string {
  const uses = inputReferences(macro, input.key).map(describePath);
  return uses.length
    ? `"${input.label || input.key}" is still used in ${uses.join(", ")}. Remove those uses first.`
    : "";
}

type Props = { macro: Macro; dispatch: Dispatch<EditorAction> };

/** Declares the macro's start inputs. Every change is a reducer action. */
export function InputsPanel({ macro, dispatch }: Props) {
  const [notice, setNotice] = useState("");
  const remove = (index: number, input: MacroInput) => {
    const blocker = removeBlocker(macro, input);
    setNotice(blocker);
    if (!blocker) dispatch({ type: "removeInput", index });
  };
  return (
    <section aria-labelledby="inputs-heading">
      <h2 id="inputs-heading">Inputs</h2>
      {notice ? <p role="alert">{notice}</p> : null}
      <ol>
        {(macro.inputs ?? []).map((input, index) => (
          <InputRow
            key={input.key}
            macro={macro}
            dispatch={dispatch}
            index={index}
            onRemove={() => remove(index, input)}
          />
        ))}
      </ol>
      <button
        type="button"
        className="secondary"
        onClick={() => dispatch({ type: "addInput", input: newInput(macro) })}
      >
        Add input
      </button>
    </section>
  );
}

function InputRow({ macro, dispatch, index, onRemove }: Props & { index: number; onRemove: () => void }) {
  const inputs = macro.inputs ?? [];
  const input = inputs[index];
  if (!input) return null;
  const update = (next: MacroInput) => dispatch({ type: "updateInput", index, input: next });
  const move = (to: number) => dispatch({ type: "moveInput", from: index, to });
  const type = inputType(input.schema);
  const name = input.label || input.key;
  const options = Array.isArray(input.schema.enum) ? input.schema.enum.map(String) : [];
  const text = typeof input.default === "string" || typeof input.default === "number" ? String(input.default) : "";
  return (
    <li>
      <fieldset>
        <legend>{name}</legend>
        <TextField
          label="Key"
          value={input.key}
          onCommit={(key) => inputKeyError(macro, key, index) ?? update({ ...input, key })}
        />
        <TextField label="Label" value={input.label} onCommit={(label) => update({ ...input, label })} />
        <Select
          label="Type"
          value={type}
          options={Object.entries(TYPE_LABELS)}
          // A default of the old type may not fit the new one.
          onChange={(next) =>
            isInputType(next) && update(withDefault({ ...input, schema: schemaFor(next) }, undefined))
          }
        />
        {type === "choice" ? (
          <TextField
            label="Options, separated by commas"
            value={options.join(", ")}
            onCommit={(list) => update({ ...input, schema: { ...input.schema, enum: parseOptions(list) } })}
          />
        ) : null}
        {type === "boolean" ? (
          <label className="field">
            <span>Checked by default</span>
            <input
              type="checkbox"
              checked={input.default === true}
              onChange={(event) => update({ ...input, default: event.target.checked })}
            />
          </label>
        ) : type === "choice" ? (
          <Select
            label="Default"
            value={text}
            options={[["", "No default"], ...options.map((option): [string, string] => [option, option])]}
            onChange={(value) => update(withDefault(input, value || undefined))}
          />
        ) : (
          <TextField
            label="Default"
            value={text}
            placeholder={type === "date" ? "2026-12-24 or today+14d" : undefined}
            onCommit={(typed) => {
              const parsed = parseDefault(type, typed);
              return "error" in parsed ? parsed.error : update(withDefault(input, parsed.value));
            }}
          />
        )}
        <Select
          label="When run"
          value={input.mode ?? "ask"}
          options={[
            ["ask", "Ask, starting from the default"],
            ["remember", "Remember the last value"],
          ]}
          onChange={(mode) => update({ ...input, mode: mode === "remember" ? "remember" : "ask" })}
        />
        <button
          type="button"
          className="secondary"
          disabled={index === 0}
          aria-label={`Move ${name} up`}
          onClick={() => move(index - 1)}
        >
          Up
        </button>
        <button
          type="button"
          className="secondary"
          disabled={index === inputs.length - 1}
          aria-label={`Move ${name} down`}
          onClick={() => move(index + 1)}
        >
          Down
        </button>
        <button type="button" className="secondary" aria-label={`Remove ${name}`} onClick={onRemove}>
          Remove
        </button>
      </fieldset>
    </li>
  );
}

function Select(props: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Commits on blur or Enter, so typing is one undo step. `onCommit` may return
 * an error, which keeps the draft open and says why it was not applied.
 */
function TextField(props: {
  label: string;
  value: string;
  placeholder?: string | undefined;
  onCommit: (value: string) => string | void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const commit = () => {
    const failed = draft !== null && draft !== props.value ? props.onCommit(draft) : undefined;
    setError(failed ?? "");
    if (!failed) setDraft(null);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") commit();
    else if (event.key === "Escape") {
      setDraft(null);
      setError("");
    }
  };
  return (
    <label className="field">
      <span>{props.label}</span>
      <input
        type="text"
        value={draft ?? props.value}
        placeholder={props.placeholder}
        aria-invalid={error ? true : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {error ? <small role="alert">{error}</small> : null}
    </label>
  );
}
