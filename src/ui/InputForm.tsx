// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useId, useState, type FormEvent } from "react";
import { resolveRelativeDate } from "../macro/relativeDate";
import type { Json, JsonSchema, Macro, MacroInput } from "../macro/types";
import { applyPreset } from "../presets";
import { loadRememberedInputs } from "../storage";
import { PresetPicker } from "./PresetPicker";

/** How an input is edited. Derived from the schema, which the macro's author controls. */
export type FieldSpec =
  | { kind: "select"; options: Json[] }
  | { kind: "checkbox" }
  | { kind: "number"; min?: number; max?: number; integer: boolean }
  | { kind: "date" }
  | { kind: "text"; pattern?: string };

/** A field's value while it is edited: checkboxes hold booleans, every other field the text of its control. */
export type FormValue = string | boolean;

export type CoerceResult = { ok: true; values: Record<string, Json> } | { ok: false; key: string; error: string };

const finite = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** The field for a schema: `enum`, then `type`, then `format: date`, else text. */
export function fieldFor(schema: JsonSchema): FieldSpec {
  if (Array.isArray(schema.enum)) return { kind: "select", options: schema.enum.filter(isOption) };
  if (schema.type === "boolean") return { kind: "checkbox" };
  if (schema.type === "number" || schema.type === "integer") {
    return { kind: "number", min: finite(schema.minimum), max: finite(schema.maximum), integer: schema.type === "integer" };
  }
  if (schema.format === "date") return { kind: "date" };
  return { kind: "text", pattern: typeof schema.pattern === "string" ? schema.pattern : undefined };
}

/** Enum options are shown as text, so only scalars that survive `String()` distinctly are offered. */
function isOption(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * A stored value as its field's initial text. Defaults, presets and remembered
 * values all pass through here, so a relative date such as `today+14d` is
 * resolved when the form opens for a run.
 */
function toFormValue(spec: FieldSpec, value: Json | undefined): FormValue {
  if (spec.kind === "checkbox") return value === true;
  if (spec.kind === "date" && typeof value === "string") return resolveRelativeDate(value) ?? value;
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/**
 * Initial field values: the remembered value for `remember` inputs, then the
 * input's default, then empty. `remembered` comes from storage and may predate
 * a schema change, so a value of the wrong shape falls back to empty.
 */
export function initialValues(inputs: MacroInput[], remembered: Record<string, Json>): Record<string, FormValue> {
  return Object.fromEntries(
    inputs.map((input) => {
      const stored = input.mode === "remember" ? remembered[input.key] : undefined;
      return [input.key, toFormValue(fieldFor(input.schema), stored ?? input.default)];
    }),
  );
}

/**
 * Turns field values into the typed values a run receives (numbers as
 * numbers, enum options as their original JSON). Native validation runs first
 * in the browser; this is the check that holds when it does not.
 */
export function coerceValues(inputs: MacroInput[], values: Record<string, FormValue>): CoerceResult {
  const typed: Record<string, Json> = {};
  for (const input of inputs) {
    const spec = fieldFor(input.schema);
    const value = values[input.key] ?? "";
    const fail = (error: string): CoerceResult => ({ ok: false, key: input.key, error: `${input.label}: ${error}` });
    if (spec.kind === "checkbox") {
      typed[input.key] = value === true;
      continue;
    }
    const text = String(value);
    if (text === "") return fail("required");
    if (spec.kind === "select") {
      const option = spec.options.find((candidate) => String(candidate) === text);
      if (option === undefined) return fail("not one of the options");
      typed[input.key] = option;
    } else if (spec.kind === "number") {
      const number = Number(text);
      if (!Number.isFinite(number)) return fail("not a number");
      if (spec.integer && !Number.isInteger(number)) return fail("not a whole number");
      typed[input.key] = number;
    } else {
      typed[input.key] = text;
    }
  }
  return { ok: true, values: typed };
}

/** The fields that are valid on their own, typed, for saving as a preset. Empty or invalid fields are left out. */
export function presetValues(inputs: MacroInput[], values: Record<string, FormValue>): Record<string, Json> {
  return Object.fromEntries(
    inputs.flatMap((input) => {
      const result = coerceValues([input], values);
      return result.ok ? Object.entries(result.values) : [];
    }),
  );
}

/** `current` with the preset's still-applicable values filled in; fields the preset does not hold keep their value. */
export function fillFromPreset(
  inputs: MacroInput[],
  current: Record<string, FormValue>,
  stored: Record<string, Json>,
): Record<string, FormValue> {
  const applied = applyPreset(inputs, stored);
  const filled = inputs.filter((input) => Object.hasOwn(applied, input.key));
  return { ...current, ...Object.fromEntries(filled.map((input) => [input.key, toFormValue(fieldFor(input.schema), applied[input.key])])) };
}

interface Props {
  macro: Macro;
  submitLabel: string;
  onSubmit(values: Record<string, Json>): void;
  onCancel?(): void;
}

/**
 * The start-input form for a macro, one field per input chosen from its JSON
 * Schema, pre-filled from the macro's remembered inputs once they load. It
 * carries only unstyled `wmm-` class names and imports no CSS, so each surface
 * styles it and the launcher can inject styles into its shadow root.
 */
export function InputForm(props: Props) {
  const [loaded, setLoaded] = useState<{ macroId: string; remembered: Record<string, Json> } | null>(null);
  const macroId = props.macro.id;

  useEffect(() => {
    let cancelled = false;
    // A storage failure only loses the pre-fill; the form still works.
    const remembered = loadRememberedInputs(macroId).catch((): Record<string, Json> => ({}));
    void remembered.then((values) => {
      if (!cancelled) setLoaded({ macroId, remembered: values });
    });
    return () => {
      cancelled = true;
    };
  }, [macroId]);

  // Until this macro's values arrive, render nothing rather than defaults that would then be replaced.
  if (loaded?.macroId !== macroId) return null;
  return <InputFormView key={macroId} {...props} remembered={loaded.remembered} />;
}

/** The form itself, with remembered values passed in. Field values are set at mount, then only by the user or a chosen preset. */
export function InputFormView({ macro, remembered, submitLabel, onSubmit, onCancel }: Props & { remembered: Record<string, Json> }) {
  const inputs = macro.inputs ?? [];
  const id = useId();
  const [values, setValues] = useState(() => initialValues(inputs, remembered));
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = coerceValues(inputs, values);
    setError(result.ok ? null : result.error);
    if (result.ok) onSubmit(result.values);
  };

  return (
    <form className="wmm-form" onSubmit={submit}>
      {inputs.length > 0 ? (
        <PresetPicker
          macroId={macro.id}
          currentValues={() => presetValues(inputs, values)}
          onChoose={(stored) => setValues((current) => fillFromPreset(inputs, current, stored))}
        />
      ) : null}
      {inputs.map((input, index) => (
        <div key={input.key} className="wmm-field">
          <label htmlFor={`${id}-${index}`}>{input.label}</label>
          <Field
            id={`${id}-${index}`}
            spec={fieldFor(input.schema)}
            value={values[input.key] ?? ""}
            onChange={(value) => setValues((current) => ({ ...current, [input.key]: value }))}
          />
        </div>
      ))}
      {error === null ? null : (
        <p role="alert" className="wmm-error">
          {error}
        </p>
      )}
      <div className="wmm-actions">
        {onCancel ? (
          <button type="button" className="wmm-secondary" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="submit">{submitLabel}</button>
      </div>
    </form>
  );
}

function Field({ id, spec, value, onChange }: { id: string; spec: FieldSpec; value: FormValue; onChange(value: FormValue): void }) {
  switch (spec.kind) {
    case "select":
      return (
        <select id={id} value={String(value)} onChange={(event) => onChange(event.target.value)} required>
          {/* An empty first option makes a required select invalid until the user picks one. */}
          <option value="">Choose…</option>
          {spec.options.map((option) => (
            <option key={String(option)} value={String(option)}>
              {String(option)}
            </option>
          ))}
        </select>
      );
    case "checkbox":
      return <input id={id} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />;
    case "number":
      return (
        <input
          id={id}
          type="number"
          value={String(value)}
          min={spec.min}
          max={spec.max}
          step={spec.integer ? 1 : "any"}
          onChange={(event) => onChange(event.target.value)}
          required
        />
      );
    case "date":
    case "text":
      return (
        <input
          id={id}
          type={spec.kind}
          value={String(value)}
          // HTML anchors `pattern` itself, so a schema's own `^…$` is harmless.
          pattern={spec.kind === "text" ? spec.pattern : undefined}
          onChange={(event) => onChange(event.target.value)}
          required
        />
      );
    default:
      throw new Error(`Unknown field: ${JSON.stringify(spec satisfies never)}`);
  }
}
