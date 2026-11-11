import { useEffect, useState, type FormEvent } from "react";
import type { Json, Macro, MacroInput } from "../macro/types";
import { loadRememberedInputs } from "../storage";

interface Props {
  macro: Macro;
  submitLabel: string;
  onSubmit(values: Record<string, Json>): void;
  onCancel?(): void;
}

function initialValue(input: MacroInput, remembered: Record<string, Json>): Json {
  if (input.mode === "remember" && remembered[input.key] !== undefined) return remembered[input.key]!;
  if (input.default !== undefined) return input.default;
  return input.schema.type === "boolean" ? false : "";
}

/** The start-data form for a macro, generated from each input's JSON Schema. */
export function InputForm({ macro, submitLabel, onSubmit, onCancel }: Props) {
  const inputs = macro.inputs ?? [];
  const [values, setValues] = useState<Record<string, Json> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadRememberedInputs(macro.id).then((remembered) => {
      if (cancelled) return;
      setValues(Object.fromEntries(inputs.map((input) => [input.key, initialValue(input, remembered)])));
    });
    return () => {
      cancelled = true;
    };
    // Inputs are derived from the macro; re-run only when the macro changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [macro.id]);

  if (!values) return null;
  const set = (key: string, value: Json) => setValues({ ...values, [key]: value });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const typed: Record<string, Json> = {};
    for (const input of inputs) {
      const value = values[input.key] ?? "";
      const numeric = input.schema.type === "number" || input.schema.type === "integer";
      typed[input.key] = numeric ? Number(value) : value;
    }
    onSubmit(typed);
  };

  return (
    <form className="wmm-form" onSubmit={submit}>
      {inputs.map((input) => (
        <label key={input.key} className="wmm-field">
          <span>{input.label}</span>
          <Field input={input} value={values[input.key] ?? ""} onChange={(value) => set(input.key, value)} />
        </label>
      ))}
      <div className="wmm-actions">
        {onCancel && (
          <button type="button" className="wmm-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}

function Field({ input, value, onChange }: { input: MacroInput; value: Json; onChange(value: Json): void }) {
  const schema = input.schema;
  if (Array.isArray(schema.enum)) {
    return (
      <select value={String(value)} onChange={(event) => onChange(event.target.value)} required>
        {(schema.enum as Json[]).map((option) => (
          <option key={String(option)} value={String(option)}>
            {String(option)}
          </option>
        ))}
      </select>
    );
  }
  if (schema.type === "boolean") {
    return <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />;
  }
  if (schema.type === "number" || schema.type === "integer") {
    return (
      <input
        type="number"
        value={String(value)}
        min={schema.minimum as number | undefined}
        max={schema.maximum as number | undefined}
        step={schema.type === "integer" ? 1 : "any"}
        onChange={(event) => onChange(event.target.value)}
        required
      />
    );
  }
  return (
    <input
      type={schema.format === "date" ? "date" : "text"}
      value={String(value)}
      pattern={typeof schema.pattern === "string" ? schema.pattern.replace(/^\^|\$$/g, "") : undefined}
      onChange={(event) => onChange(event.target.value)}
      required
    />
  );
}
