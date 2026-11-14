// Copyright 2026 André Cipriani Bandarra
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import type { Json } from "../macro/types";
import { deletePreset, loadPresets, renamePreset, savePreset, type Preset } from "../presets";

interface Props {
  macroId: string;
  /** The form's current values, as a preset would store them. */
  currentValues(): Record<string, Json>;
  /** Fills the form from a preset's stored values. The user can still edit them before running. */
  onChoose(values: Record<string, Json>): void;
}

/**
 * Choose, save, rename and delete the macro's presets. It sits inside the run
 * form, so every button is `type="button"` and Enter in the name field saves
 * instead of submitting the run.
 */
export function PresetPicker({ macroId, currentValues, onChoose }: Props) {
  const id = useId();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [chosen, setChosen] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A storage failure only hides the presets; the form still works.
    void loadPresets(macroId)
      .catch((): Preset[] => [])
      .then((loaded) => {
        if (!cancelled) setPresets(loaded);
      });
    return () => {
      cancelled = true;
    };
  }, [macroId]);

  const update = (change: Promise<Preset[]>, nextChosen: string) => {
    void change.then(
      (next) => {
        setPresets(next);
        setChosen(nextChosen);
        setError(null);
      },
      (reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not save presets"),
    );
  };

  const choose = (presetName: string) => {
    setChosen(presetName);
    setName(presetName);
    const preset = presets.find((candidate) => candidate.name === presetName);
    if (preset) onChoose(preset.values);
  };

  const trimmed = name.trim();
  const save = () => {
    if (trimmed !== "") update(savePreset(macroId, trimmed, currentValues()), trimmed);
  };
  const saveOnEnter = (event: KeyboardEvent) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    save();
  };

  return (
    <fieldset className="wmm-presets">
      <legend>Presets</legend>
      {presets.length > 0 ? (
        <div className="wmm-field">
          <label htmlFor={`${id}-choose`}>Preset</label>
          <select id={`${id}-choose`} value={chosen} onChange={(event) => choose(event.target.value)}>
            <option value="">None</option>
            {presets.map((preset) => (
              <option key={preset.name} value={preset.name}>
                {preset.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="wmm-field">
        <label htmlFor={`${id}-name`}>Preset name</label>
        <input id={`${id}-name`} type="text" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={saveOnEnter} />
      </div>
      <div className="wmm-actions">
        <button type="button" className="wmm-secondary" disabled={trimmed === ""} onClick={save}>
          Save values
        </button>
        <button
          type="button"
          className="wmm-secondary"
          disabled={chosen === "" || trimmed === "" || trimmed === chosen}
          onClick={() => update(renamePreset(macroId, chosen, trimmed), trimmed)}
        >
          Rename
        </button>
        <button type="button" className="wmm-secondary" disabled={chosen === ""} onClick={() => update(deletePreset(macroId, chosen), "")}>
          Delete
        </button>
      </div>
      {error === null ? null : (
        <p role="alert" className="wmm-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
